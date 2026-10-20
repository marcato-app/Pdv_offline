import * as XLSX from 'xlsx';

/** Lê planilha (.xlsx/.xls) ou CSV, acertando os acentos de CSV salvo em UTF-8 ou no padrão do Excel (Windows). */
export async function readWorkbook(f: File): Promise<XLSX.WorkBook> {
  if (/\.(csv|txt)$/i.test(f.name)) {
    const buf = await f.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
    return XLSX.read(text.replace(/^﻿/, ''), { type: 'string' });
  }
  return XLSX.read(await f.arrayBuffer(), { type: 'array' });
}
