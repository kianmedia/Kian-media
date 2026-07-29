// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/mapping.ts — header row detection, column→field resolution,
// and the two value coercions that are allowed to fail loudly (date, number).
//
// DATE POLICY (non-negotiable): a due date is written ONLY when the file
// actually contained a date this module could read with certainty. There is no
// "default to today", no "assume end of month", no silent shifting. An
// unreadable date produces a warning and a NULL — the deliverable then keeps
// schedule_status = 'awaiting_schedule' and a human decides.
// ════════════════════════════════════════════════════════════════════════════
import type { ImportProfile, Sheet, SheetRow } from "./types";
import { cleanCell, headerKey, isBlank, toAsciiDigits } from "./text";
import { synonymIndex, synonymPairs } from "./profile";

export interface ColumnMapping {
  index: number;
  header: string;
  field: string | null;
  /** How the header was resolved — exact synonym or a contains-match. */
  match: "exact" | "fuzzy" | null;
}

export interface SheetMapping {
  headerRowNumber: number;
  headerRowIndex: number;
  columns: ColumnMapping[];
  /** canonical field → column index */
  byField: Map<string, number>;
  unmapped: string[];
  /** Fields the profile declares but the sheet does not carry. */
  missingFields: string[];
  /** Columns dropped because an earlier column already claimed the field. */
  duplicateColumns: { header: string; field: string }[];
}

const MAX_HEADER_SCAN = 30;

function scoreRow(row: SheetRow, idx: Map<string, string>): number {
  let score = 0;
  for (const cell of row.cells) {
    const k = headerKey(cell);
    if (k && idx.has(k)) score++;
  }
  return score;
}

/**
 * Find the header row. Real-world sheets start with a title row, a logo row, or
 * a blank row, so we score the first rows by how many known headers they carry
 * and take the best. Ties go to the earliest row.
 */
export function detectHeaderRow(sheet: Sheet, profile: ImportProfile): { rowIndex: number; score: number } {
  if (profile.headerRow && profile.headerRow > 0) {
    const i = sheet.rows.findIndex((r) => r.rowNumber === profile.headerRow);
    if (i >= 0) return { rowIndex: i, score: scoreRow(sheet.rows[i], synonymIndex(profile)) };
  }
  const idx = synonymIndex(profile);
  let bestIdx = -1;
  let bestScore = 0;
  const limit = Math.min(sheet.rows.length, MAX_HEADER_SCAN);
  for (let i = 0; i < limit; i++) {
    const s = scoreRow(sheet.rows[i], idx);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  if (bestIdx === -1) {
    // Nothing recognisable — fall back to the first non-empty row so the caller
    // can still show the user what was read and which columns went unmapped.
    bestIdx = sheet.rows.findIndex((r) => r.cells.some((c) => !isBlank(c)));
    if (bestIdx < 0) bestIdx = 0;
  }
  return { rowIndex: bestIdx, score: bestScore };
}

export function buildMapping(sheet: Sheet, profile: ImportProfile): SheetMapping {
  const { rowIndex } = detectHeaderRow(sheet, profile);
  const headerRow = sheet.rows[rowIndex] ?? { rowNumber: 1, cells: [] };
  const idx = synonymIndex(profile);
  const pairs = synonymPairs(profile);
  const columns: ColumnMapping[] = [];
  const byField = new Map<string, number>();
  const unmapped: string[] = [];
  const duplicateColumns: { header: string; field: string }[] = [];

  headerRow.cells.forEach((raw, i) => {
    const header = cleanCell(raw);
    if (header === "") {
      columns.push({ index: i, header, field: null, match: null });
      return;
    }
    const k = headerKey(header);
    let field = idx.get(k) ?? null;
    let match: "exact" | "fuzzy" | null = field ? "exact" : null;
    if (!field) {
      // Fuzzy: a header like "المنصات المستهدفة" still means platforms. Guarded
      // by a length floor so short words cannot swallow unrelated columns.
      for (const pair of pairs) {
        if (pair.key.length >= 4 && (k.includes(pair.key) || pair.key.includes(k))) {
          field = pair.field;
          match = "fuzzy";
          break;
        }
      }
    }
    if (field && byField.has(field)) {
      duplicateColumns.push({ header, field });
      columns.push({ index: i, header, field: null, match: null });
      unmapped.push(header);
      return;
    }
    if (field) byField.set(field, i);
    else unmapped.push(header);
    columns.push({ index: i, header, field, match });
  });

  const missingFields = Object.keys(profile.fields).filter((f) => !byField.has(f));
  return { headerRowNumber: headerRow.rowNumber, headerRowIndex: rowIndex, columns, byField, unmapped, missingFields, duplicateColumns };
}

// ─── value coercions ───────────────────────────────────────────────────────

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;
const DMY_RE = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/;
const YMD_SLASH_RE = /^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/;

function isoOf(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export type DateParse = { iso: string | null; reason?: "empty" | "unreadable" | "ambiguous_number" };

/**
 * Strict date reader. Accepts ISO (yyyy-mm-dd), day-first (dd/mm/yyyy — the
 * convention in every Kian sheet so far) and yyyy/mm/dd. A bare number is
 * REJECTED: in a text column it is far more likely a serial, a week number or a
 * quantity than a date, and guessing would fabricate a deadline.
 */
export function parseDateStrict(raw: unknown): DateParse {
  const s = toAsciiDigits(cleanCell(raw));
  if (s === "") return { iso: null, reason: "empty" };
  let m = ISO_RE.exec(s) ?? YMD_SLASH_RE.exec(s);
  if (m) return { iso: isoOf(+m[1], +m[2], +m[3]), reason: isoOf(+m[1], +m[2], +m[3]) ? undefined : "unreadable" };
  m = DMY_RE.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = +m[3];
    // day-first by default; fall back to month-first only when day-first is
    // impossible (e.g. 04/25/2026 written by a US-locale export).
    const iso = isoOf(y, b, a) ?? isoOf(y, a, b);
    return { iso, reason: iso ? undefined : "unreadable" };
  }
  if (/^\d+(\.\d+)?$/.test(s)) return { iso: null, reason: "ambiguous_number" };
  return { iso: null, reason: "unreadable" };
}

export function parseIntStrict(raw: unknown): { value: number | null; ok: boolean } {
  const s = toAsciiDigits(cleanCell(raw)).replace(/[,\s]/g, "");
  if (s === "") return { value: null, ok: true };
  if (!/^-?\d+$/.test(s)) {
    const f = Number(s);
    if (Number.isFinite(f)) return { value: Math.round(f), ok: true };
    return { value: null, ok: false };
  }
  return { value: parseInt(s, 10), ok: true };
}
