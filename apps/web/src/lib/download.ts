import { getCsv, postBlob } from './api';

/** CSV indirme yardimcisi: Bearer'li GET → Blob → tarayici indirme. BOM, Excel'de UTF-8 icin. */
export async function downloadCsv(path: string, filename: string): Promise<void> {
  const csv = await getCsv(path);
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** PDF indirme: Bearer'li POST → Blob → tarayici indirme. */
export async function downloadPdf(path: string, filename: string, body?: unknown): Promise<void> {
  const blob = await postBlob(path, body);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
