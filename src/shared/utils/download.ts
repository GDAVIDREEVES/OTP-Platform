/** Browser-side file downloads for exports (JSON evidence notes, CSV grids).
 *  Pure client helpers — nothing here touches the backend. */

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename: string, data: unknown): void {
  downloadBlob(filename, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
}

/** RFC 4180-ish CSV: quotes any cell containing a comma, quote or newline. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  downloadBlob(filename, new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
}
