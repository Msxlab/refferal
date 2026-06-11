/**
 * Minimal, bagimsiz CSV ayristirici (RFC4180 alt kumesi): tirnakli alan, "" kacisi,
 * alan ici virgul/yeni satir destegi. Disaridan parser bagimliligi yok (SPEC 5).
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
  // son alan/satir (dosya yeni satirla bitmiyorsa)
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // tamamen bos satirlari ele
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}
