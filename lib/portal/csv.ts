// ════════════════════════════════════════════════════════════════════════════
// Shared client-side CSV export (Batch 3C). Lifted from the cleanest existing
// inline copy (ProjectFinance csvDownload) so the 6 ad-hoc call sites can converge.
// Client-side over already-RLS-scoped rows — no server round-trip, no export deps.
// UTF-8 BOM so Excel opens Arabic correctly.
// ════════════════════════════════════════════════════════════════════════════
type Cell = string | number | null | undefined;

const esc = (v: Cell): string => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Download a 2D array of rows as a CSV file (first row is typically the header). */
export function csvDownload(fileName: string, rows: Cell[][]): void {
  const body = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
