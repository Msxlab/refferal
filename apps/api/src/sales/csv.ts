/**
 * Minimal standalone CSV parser (RFC4180 subset): quoted fields, "" escaping,
 * commas/newlines inside fields, and no external parser dependency (SPEC 5).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // Final field/row when the file does not end with a newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Remove fully blank rows.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** Spreadsheet formula injection guard for CSV exports. */
export function csvCell(value: string | number | bigint | null | undefined): string {
  let text = String(value ?? '');
  // Spreadsheet apps can trim leading spaces/control characters before evaluating
  // a formula, so inspect the first non-whitespace character rather than byte 0.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
