// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/csvParse.ts — RFC-4180 CSV/TSV reader, written natively.
//
// Native (not a dependency) because the whole job is ~100 lines and the two
// things that actually break Arabic imports — the UTF-8 BOM Excel writes, and
// the semicolon delimiter Excel uses in ar/fr locales — are exactly the things
// a generic library still needs to be told about. Row numbers reported here are
// PHYSICAL line numbers so an error message points at the line the user sees.
// ════════════════════════════════════════════════════════════════════════════
import type { Sheet, SheetRow } from "./types";
import { cleanCell, stripBom } from "./text";

const CANDIDATES = [",", ";", "\t", "|"] as const;

/** Count a delimiter outside quotes over the first few lines. */
function scoreDelimiter(text: string, d: string): number {
  let inQuotes = false;
  let count = 0;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 8; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && c === "\n") {
      lines++;
    } else if (!inQuotes && c === d) {
      count++;
    }
  }
  return count;
}

export function detectDelimiter(text: string): string {
  let best = ",";
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const s = scoreDelimiter(text, d);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return bestScore <= 0 ? "," : best;
}

export interface CsvParseOptions {
  delimiter?: string;
  sheetName?: string;
}

/**
 * Parse CSV text into a Sheet. Never throws on ragged rows — short rows are
 * padded and long rows are kept in full; the mapper decides what matters.
 */
export function parseCsv(raw: string, opts: CsvParseOptions = {}): Sheet {
  const text = stripBom(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const rows: SheetRow[] = [];

  let field = "";
  let cells: string[] = [];
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let sawAny = false;

  const endRow = (): void => {
    cells.push(field);
    field = "";
    // A row of nothing but empty strings is preserved positionally but marked
    // by the caller as blank — we do not silently renumber anything.
    rows.push({ rowNumber: rowStartLine, cells: cells.map((c) => cleanCell(c)) });
    cells = [];
    rowStartLine = line;
    sawAny = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      sawAny = true;
    } else if (c === delimiter) {
      cells.push(field);
      field = "";
      sawAny = true;
    } else if (c === "\n") {
      line++;
      endRow();
      rowStartLine = line;
    } else {
      field += c;
      sawAny = true;
    }
  }
  if (field !== "" || cells.length > 0 || sawAny) endRow();

  return { name: opts.sheetName ?? "CSV", rows };
}
