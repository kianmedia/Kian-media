// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/parse.ts — one entry point for "turn this uploaded file
// into sheets", whichever of the supported formats it is.
// ════════════════════════════════════════════════════════════════════════════
import type { ImportWarning, ParsedWorkbook, Sheet } from "./types";
import { parseCsv } from "./csvParse";
import { looksLikeXlsx, parseXlsx } from "./xlsx";
import { isBlank, utf8Decode } from "./text";

export class ImportParseError extends Error {
  readonly arabic: string;
  constructor(arabic: string, detail?: string) {
    super(detail ? `${arabic} — ${detail}` : arabic);
    this.name = "ImportParseError";
    this.arabic = arabic;
  }
}

const MAX_BYTES = 12 * 1024 * 1024; // 12 MiB — a 50k-row sheet is far below this

function decodeText(bytes: Uint8Array): string {
  // Excel's "Unicode Text (*.txt)" export is UTF-16LE with a BOM; naive UTF-8
  // decoding of it produces the classic NUL-separated mojibake.
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return utf8Decode(bytes);
}

export function sheetIsEmpty(sheet: Sheet): boolean {
  return !sheet.rows.some((r) => r.cells.some((c) => !isBlank(c)));
}

/**
 * Parse an uploaded file. `input` is raw bytes (upload) or already-decoded text
 * (paste / test). The file extension is a hint only — content sniffing wins, so
 * a .csv that is really an .xlsx still imports.
 */
export function parseWorkbook(input: Uint8Array | string, fileName: string = "import.csv"): ParsedWorkbook {
  const warnings: ImportWarning[] = [];
  let wb: ParsedWorkbook;

  if (typeof input === "string") {
    wb = { format: "csv", fileName, sheets: [parseCsv(input, { sheetName: fileName })], warnings };
  } else {
    if (input.length === 0) throw new ImportParseError("الملف فارغ.");
    if (input.length > MAX_BYTES) {
      throw new ImportParseError(`حجم الملف يتجاوز الحد المسموح (${Math.round(MAX_BYTES / 1024 / 1024)} ميجابايت).`);
    }
    if (looksLikeXlsx(input)) {
      try {
        wb = parseXlsx(input, fileName);
      } catch (e) {
        throw new ImportParseError("تعذّرت قراءة ملف Excel. تأكّد أنّه بصيغة .xlsx وغير تالف.", String(e));
      }
    } else {
      const text = decodeText(input);
      if (text.indexOf("\u0000") !== -1) {
        throw new ImportParseError("صيغة الملف غير مدعومة. المدعوم: .xlsx و .csv فقط.");
      }
      wb = { format: "csv", fileName, sheets: [parseCsv(text, { sheetName: fileName })], warnings };
    }
  }

  wb.warnings = wb.warnings.concat(warnings);
  const nonEmpty = wb.sheets.filter((s) => !sheetIsEmpty(s));
  if (nonEmpty.length === 0) throw new ImportParseError("لا توجد بيانات في الملف (كل الأوراق فارغة).");
  return wb;
}

/** Choose the sheet to import: the profile's named sheet, else the first with data. */
export function pickSheet(wb: ParsedWorkbook, sheetName?: string | null): { sheet: Sheet; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const nonEmpty = wb.sheets.filter((s) => !sheetIsEmpty(s));
  let sheet: Sheet | undefined;
  if (sheetName) {
    sheet = wb.sheets.find((s) => s.name.trim() === sheetName.trim());
    if (!sheet) {
      warnings.push({
        code: "extra_sheet_ignored",
        message: `الورقة «${sheetName}» غير موجودة في الملف؛ تمّت قراءة الورقة «${nonEmpty[0].name}» بدلًا منها.`,
      });
    }
  }
  if (!sheet) sheet = nonEmpty[0];
  for (const s of nonEmpty) {
    if (s !== sheet) {
      warnings.push({ code: "extra_sheet_ignored", message: `لم تُقرأ الورقة «${s.name}» — الاستيراد يقرأ ورقة واحدة في كل مرّة.` });
    }
  }
  return { sheet, warnings };
}
