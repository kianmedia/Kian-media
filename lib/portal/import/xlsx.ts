// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/xlsx.ts — .xlsx reader built on the local ZIP + inflate.
//
// Reads: workbook.xml (sheet order + names + the 1904 date system flag),
// _rels (sheet → part path), sharedStrings.xml (where Excel puts every string,
// including all Arabic text), styles.xml (ONLY to learn which numeric cells are
// really dates), and each worksheet.
//
// DATE POLICY: a numeric cell becomes a date string ONLY when its style says so.
// An ambiguous number stays a number and the field validator rejects it with a
// warning. The engine never guesses a date and never substitutes "today".
// ════════════════════════════════════════════════════════════════════════════
import type { ImportWarning, ParsedWorkbook, Sheet, SheetRow } from "./types";
import { ZipArchive } from "./zip";
import { attrs, elements, xmlText } from "./xml";

/** Excel built-in numFmt ids that are date/time formats. */
const BUILTIN_DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormatCode(code: string): boolean {
  // Drop quoted literals, escaped chars, colour/condition blocks and currency,
  // then look for real date/time tokens.
  const stripped = code
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[$€£¥]/g, "");
  return /[ymdhs]/i.test(stripped) && !/^general$/i.test(code.trim());
}

/** column letters ("A", "AB") → 0-based index. */
export function colIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Excel serial → ISO string. Pure arithmetic on the workbook's own epoch. */
export function serialToIso(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  // 25569 = days from 1970-01-01 back to the 1900 system's day 0 (1899-12-30).
  const days = date1904 ? serial + 1462 : serial;
  const ms = Math.round((days - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString();
  const frac = Math.abs(days - Math.floor(days));
  return frac < 1e-6 ? iso.slice(0, 10) : iso.slice(0, 19);
}

function readSharedStrings(zip: ZipArchive, maxBytes: number): string[] {
  if (!zip.has("xl/sharedStrings.xml")) return [];
  const xml = zip.readText("xl/sharedStrings.xml", maxBytes);
  const out: string[] = [];
  for (const si of elements(xml, "si")) {
    // Phonetic hints (<rPh>) are metadata, not content — drop them, keep the rest.
    const body = si.inner.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
    let s = "";
    for (const t of elements(body, "t")) s += xmlText(t.inner);
    out.push(s);
  }
  return out;
}

function readDateStyles(zip: ZipArchive): Set<number> {
  const dateXfIndexes = new Set<number>();
  if (!zip.has("xl/styles.xml")) return dateXfIndexes;
  const xml = zip.readText("xl/styles.xml");
  const custom = new Map<number, string>();
  for (const nf of elements(xml, "numFmt")) {
    const a = attrs(nf.attrText);
    const id = parseInt(a.numFmtId ?? "", 10);
    if (Number.isFinite(id)) custom.set(id, a.formatCode ?? "");
  }
  const cellXfsMatch = xml.match(/<cellXfs[\s\S]*?<\/cellXfs>/);
  if (!cellXfsMatch) return dateXfIndexes;
  let i = 0;
  for (const xf of elements(cellXfsMatch[0], "xf")) {
    const a = attrs(xf.attrText);
    const id = parseInt(a.numFmtId ?? "0", 10);
    const code = custom.get(id);
    if (BUILTIN_DATE_IDS.has(id) || (code !== undefined && isDateFormatCode(code))) dateXfIndexes.add(i);
    i++;
  }
  return dateXfIndexes;
}

function readWorkbookSheets(zip: ZipArchive): { name: string; path: string; date1904: boolean }[] {
  const wb = zip.readText("xl/workbook.xml");
  const date1904 = /date1904\s*=\s*"(1|true)"/i.test(wb);
  const rels = zip.has("xl/_rels/workbook.xml.rels") ? zip.readText("xl/_rels/workbook.xml.rels") : "";
  const relMap = new Map<string, string>();
  for (const r of elements(rels, "Relationship")) {
    const a = attrs(r.attrText);
    if (a.Id && a.Target) relMap.set(a.Id, a.Target);
  }
  const out: { name: string; path: string; date1904: boolean }[] = [];
  let fallback = 1;
  for (const s of elements(wb, "sheet")) {
    const a = attrs(s.attrText);
    const rid = a["r:id"] ?? a["relationshipId"] ?? "";
    let target = relMap.get(rid) ?? "";
    if (!target) target = `worksheets/sheet${fallback}.xml`;
    const path = target.startsWith("/") ? target.slice(1) : target.startsWith("xl/") ? target : `xl/${target}`;
    out.push({ name: xmlText(a.name ?? `Sheet${fallback}`), path, date1904 });
    fallback++;
  }
  return out;
}

function readSheet(zip: ZipArchive, name: string, path: string, shared: string[], dateXfs: Set<number>, date1904: boolean, maxBytes: number): Sheet {
  if (!zip.has(path)) return { name, rows: [] };
  const xml = zip.readText(path, maxBytes);
  const rows: SheetRow[] = [];
  let implicitRow = 0;
  for (const row of elements(xml, "row")) {
    const ra = attrs(row.attrText);
    implicitRow = parseInt(ra.r ?? "", 10) || implicitRow + 1;
    const cells: string[] = [];
    let implicitCol = -1;
    for (const c of elements(row.inner, "c")) {
      const ca = attrs(c.attrText);
      const idx = ca.r ? colIndex(ca.r) : implicitCol + 1;
      implicitCol = idx;
      while (cells.length < idx) cells.push("");
      const t = ca.t ?? "n";
      let value = "";
      if (t === "inlineStr") {
        let s = "";
        for (const tt of elements(c.inner, "t")) s += xmlText(tt.inner);
        value = s;
      } else {
        const vm = c.inner.match(/<v[^>]*>([\s\S]*?)<\/v>/);
        const raw = vm ? xmlText(vm[1]) : "";
        if (t === "s") {
          const i = parseInt(raw, 10);
          value = Number.isFinite(i) && shared[i] !== undefined ? shared[i] : "";
        } else if (t === "b") {
          value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : raw;
        } else if (t === "e") {
          value = raw; // #REF!, #N/A … kept visible instead of silently blanked
        } else if (t === "str") {
          value = raw;
        } else {
          const styleIdx = parseInt(ca.s ?? "", 10);
          const num = raw === "" ? NaN : Number(raw);
          if (Number.isFinite(num) && Number.isFinite(styleIdx) && dateXfs.has(styleIdx)) {
            value = serialToIso(num, date1904) ?? raw;
          } else {
            value = raw;
          }
        }
      }
      cells.push(value);
    }
    rows.push({ rowNumber: implicitRow, cells });
  }
  return { name, rows };
}

/**
 * Total decompressed bytes one workbook may occupy. A 5 MB upload whose parts
 * expand to gigabytes is a denial-of-service, not a spreadsheet; past the budget
 * we stop reading further sheets and SAY so instead of dying.
 */
export const WORKBOOK_BYTE_BUDGET = 64 * 1024 * 1024;

/** Read an .xlsx (or .xlsm) workbook from raw bytes. */
export function parseXlsx(bytes: Uint8Array, fileName: string = "workbook.xlsx", byteBudget: number = WORKBOOK_BYTE_BUDGET): ParsedWorkbook {
  const zip = new ZipArchive(bytes);
  if (!zip.has("xl/workbook.xml")) {
    throw new Error("الملف ليس ملف Excel صالحًا (xl/workbook.xml غير موجود)");
  }
  const warnings: ImportWarning[] = [];
  let budget = byteBudget;

  // The shared-string table is not optional: every text cell points into it, so
  // a workbook whose strings alone blow the budget cannot be imported at all.
  let shared: string[];
  try {
    shared = readSharedStrings(zip, budget);
  } catch {
    throw new Error("جدول النصوص في الملف أكبر من الحدّ الآمن للاستيراد.");
  }
  budget -= Math.max(zip.sizeOf("xl/sharedStrings.xml"), 0);
  const dateXfs = readDateStyles(zip);

  const sheets: Sheet[] = [];
  for (const s of readWorkbookSheets(zip)) {
    const declared = zip.sizeOf(s.path);
    // Never start a read we cannot afford — degrade with an honest warning.
    if (budget <= 0 || declared > budget) {
      sheets.push({ name: s.name, rows: [] });
      warnings.push({ code: "truncated", message: `لم تُقرأ الورقة «${s.name}» — تجاوز الملف الحدّ الآمن لحجم البيانات.` });
      continue;
    }
    const allowance = declared > 0 ? declared : budget;
    const sheet = readSheet(zip, s.name, s.path, shared, dateXfs, s.date1904, allowance);
    budget -= declared > 0 ? declared : allowance;
    sheets.push(sheet);
  }
  return { format: "xlsx", fileName, sheets, warnings };
}

/** Cheap signature check — a ZIP always starts with "PK\x03\x04". */
export function looksLikeXlsx(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}
