/**
 * Minimal CSV reader and writer covering the RFC 4180 cases lead files
 * actually contain: quoted fields, embedded commas and newlines, doubled
 * quotes, and CRLF line endings. No dependencies, so the same module runs
 * in the browser (import wizard) and on the server (import, export).
 */

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/** Parses CSV text into a header row plus one record per data row. */
export function parseCsv(text: string): ParsedCsv {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let recordStarted = false;

  const pushField = () => {
    record.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
    recordStarted = false;
  };

  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      recordStarted = true;
    } else if (ch === ",") {
      pushField();
      recordStarted = true;
    } else if (ch === "\n") {
      pushRecord();
    } else if (ch === "\r") {
      // Handled by the \n branch; a lone \r also terminates a record.
      if (input[i + 1] !== "\n") {
        pushRecord();
      }
    } else {
      field += ch;
      recordStarted = true;
    }
  }
  if (recordStarted || field.length > 0 || record.length > 0) {
    pushRecord();
  }

  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  if (nonEmpty.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = nonEmpty[0].map((h) => h.trim());
  const rows = nonEmpty.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? "").trim();
    });
    return row;
  });
  return { headers, rows };
}

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialises rows to CSV text with a header line. */
export function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCell(row[h] ?? "")).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}
