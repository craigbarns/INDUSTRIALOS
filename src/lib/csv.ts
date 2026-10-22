export type CsvValue = string | number | boolean | null | undefined;

// Extracted values come from untrusted supplier documents. A leading formula character would make a
// spreadsheet evaluate the cell, so it is neutralized with an apostrophe (OWASP CSV injection guidance).
const formulaStart = /^[=+\-@\t\r]/;
function cell(value: CsvValue) {
  if (value === null || value === undefined) return "";
  let text = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  if (typeof value === "string" && formulaStart.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
/** RFC 4180 CSV with CRLF rows and a UTF-8 byte order mark so spreadsheets keep accents. */
export function toCsv(headers: string[], rows: CsvValue[][]) {
  return "﻿" + [headers, ...rows].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
export function csvResponse(name: string, body: string) {
  const fallback = name.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "") || "export";
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fallback}.csv"; filename*=UTF-8''${encodeURIComponent(`${name}.csv`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
