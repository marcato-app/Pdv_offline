import { useState } from 'react';
import * as XLSX from 'xlsx';
import { readWorkbook } from '../../lib/sheet';
import { db, save, uid, SYNCED_TABLES, type Product } from '../../lib/db';
import { addStock } from '../../lib/pdv';
import { parseNum } from '../../lib/format';
import { contribute } from '../../lib/catalog';

export type FieldKey = 'barcode' | 'description' | 'brand' | 'manufacturer' | 'basket' | 'category' | 'subcategory' | 'content' | 'price' | 'cost' | 'stock' | 'unit' | 'internalCode' | 'ncm';

export const FIELDS: { key: FieldKey; label: string; guess: string[] }[] = [
  { key: 'barcode', label: 'Código de barras', guess: ['codigodebarra', 'codigodebarras', 'ean', 'gtin', 'codbarras', 'barcode', 'codigo'] },
  { key: 'description', label: 'Descritivo', guess: ['descritivo', 'descricao', 'produto', 'nome', 'description'] },
  { key: 'brand', label: 'Marca', guess: ['marca', 'brand'] },
  { key: 'manufacturer', label: 'Fabricante', guess: ['fabricante', 'manufacturer'] },
  { key: 'basket', label: 'Cesta', guess: ['cesta'] },
  { key: 'category', label: 'Categoria', guess: ['categoria', 'category', 'grupo', 'departamento'] },
  { key: 'subcategory', label: 'Subcategoria', guess: ['subcategoria', 'subgrupo'] },
  { key: 'content', label: 'Conteúdo', guess: ['contenido', 'conteudo', 'content', 'volume', 'peso'] },
  { key: 'price', label: 'Preço de venda', guess: ['precovenda', 'preco', 'venda', 'valor', 'price'] },
  { key: 'cost', label: 'Preço de custo', guess: ['custo', 'precocusto', 'cost'] },
  { key: 'stock', label: 'Estoque', guess: ['estoque', 'quantidade', 'qtd', 'saldo', 'stock'] },
  { key: 'unit', label: 'Unidade (UN/KG)', guess: ['unidade', 'un', 'unit', 'medida'] },
  { key: 'internalCode', label: 'Código interno', guess: ['codigointerno', 'codinterno', 'interno', 'plu'] },
  { key: 'ncm', label: 'NCM', guess: ['ncm'] },
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function guessMap(headers: string[]) {
  const map: Partial<Record<FieldKey, string>> = {};
  const used = new Set<string>();
  for (const f of FIELDS) {
    for (const g of f.guess) {
      const h = headers.find((x) => !used.has(x) && norm(x) === g);
      if (h) { map[f.key] = h; used.add(h); break; }
    }
  }
  for (const f of FIELDS) {
    if (map[f.key]) continue;
    const h = headers.find((x) => !used.has(x) && f.guess.some((g) => g.length > 3 && norm(x).includes(g)));
    if (h) { map[f.key] = h; used.add(h); }
  }
  return map;
}

export const cell = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'number' && Number.isInteger(v) ? v.toFixed(0) : String(v).trim());

export function Importar() {
  const [fileName, setFileName] = useState('');
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [sheet, setSheet] = useState('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Partial<Record<FieldKey, string>>>({});
  const [updateExisting, setUpdateExisting] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [err, setErr] = useState('');

  const loadSheet = (book: XLSX.WorkBook, name: string) => {
    const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[name], { defval: '', raw: true });
    const hs = data.length ? Object.keys(data[0]) : [];
    setSheet(name); setRows(data); setHeaders(hs); setMap(guessMap(hs)); setResult(null);
  };

  const onFile = async (f: File) => {
    setErr('');
    try {
      const book = await readWorkbook(f);
      setFileName(f.name); setWb(book); loadSheet(book, book.SheetNames[0]);
    } catch {
      setErr('Não consegui ler este arquivo. Use .xlsx, .xls ou .csv');
    }
  };

  const get = (r: Record<string, unknown>, k: FieldKey) => (map[k] ? cell(r[map[k]!]) : '');
  const noCode = rows.filter((r) => !get(r, 'barcode') && !get(r, 'internalCode')).length;

  const run = async () => {
    if (!map.description) return setErr('Escolha qual coluna é o Descritivo');
    if (!map.barcode && !map.internalCode) return setErr('Escolha qual coluna é o Código de barras');
    setErr('');
    const all = await db.products.filter((p) => !p.deleted).toArray();
    const byCode = new Map(all.filter((p) => p.barcode).map((p) => [p.barcode, p]));
    let created = 0, updated = 0, skipped = 0;
    setProgress({ done: 0, total: rows.length });
    const CHUNK = 300;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.outbox, db.stockCache], async () => {
        for (const r of part) {
          const barcode = get(r, 'barcode').replace(/\.0+$/, '');
          const description = get(r, 'description');
          if (!description || (!barcode && !get(r, 'internalCode'))) { skipped++; continue; }
          const existing = barcode ? byCode.get(barcode) : undefined;
          if (existing && !updateExisting) { skipped++; continue; }
          const unitRaw = get(r, 'unit').toUpperCase();
          const patch: Partial<Product> = { barcode, description };
          for (const k of ['brand', 'manufacturer', 'basket', 'category', 'subcategory', 'content', 'internalCode', 'ncm'] as const) {
            const v = get(r, k);
            if (v) patch[k] = v;
          }
          if (map.price && get(r, 'price')) patch.price = parseNum(get(r, 'price'));
          if (map.cost && get(r, 'cost')) patch.cost = parseNum(get(r, 'cost'));
          if (unitRaw) patch.unit = unitRaw.startsWith('K') ? 'KG' : 'UN';
          const rec = { unit: 'UN', cost: 0, price: 0, minStock: 0, active: 1, ...(existing || {}), ...patch, id: existing?.id || uid() } as Product;
          await save<Product>('products', rec);
          byCode.set(barcode, rec);
          if (map.stock && get(r, 'stock') && !existing) await addStock(rec.id, parseNum(get(r, 'stock')), 'inicial');
          if (existing) updated++; else created++;
        }
      });
      setProgress({ done: Math.min(rows.length, i + CHUNK), total: rows.length });
    }
    setProgress(null);
    setResult({ created, updated, skipped });
    contribute([...byCode.values()]);
  };

  return (
    <>
      <div className="page-head"><div><span className="muted small">Produtos › Importar</span><h1>Importar planilha do Excel</h1></div></div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="row">
          <label className="btn primary" style={{ cursor: 'pointer' }}>
            Escolher arquivo (.xlsx, .xls, .csv)
            <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          {fileName && <span className="chip">{fileName} · {rows.length} linhas</span>}
          {wb && wb.SheetNames.length > 1 && (
            <select className="input" style={{ width: 200 }} value={sheet} onChange={(e) => loadSheet(wb, e.target.value)}>
              {wb.SheetNames.map((s) => <option key={s}>{s}</option>)}
            </select>
          )}
        </div>
        {err && <div className="error">{err}</div>}
        {!!headers.length && (
          <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
            <section style={{ flex: '1 1 340px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ fontSize: 16 }}>Ligar colunas</h2>
              {FIELDS.map((f) => (
                <div key={f.key} className="spread" style={{ flexWrap: 'nowrap' }}>
                  <label htmlFor={'m-' + f.key} style={{ flex: '0 0 150px', fontSize: 14, fontWeight: 600 }}>{f.label}</label>
                  <select id={'m-' + f.key} className="input" value={map[f.key] || ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value || undefined })}>
                    <option value="">— não importar —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
              <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />Atualizar produtos que já existem (mesmo código de barras)</label>
            </section>
            <section style={{ flex: '1 1 380px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <h2 style={{ fontSize: 16 }}>Prévia</h2>
              <div className="table-wrap">
                <table className="t small">
                  <thead><tr><th>Código</th><th>Descritivo</th><th>Marca</th><th>Categoria</th><th>Conteúdo</th></tr></thead>
                  <tbody>{rows.slice(0, 8).map((r, i) => <tr key={i}><td>{get(r, 'barcode')}</td><td>{get(r, 'description')}</td><td>{get(r, 'brand')}</td><td>{get(r, 'category')}</td><td>{get(r, 'content')}</td></tr>)}</tbody>
                </table>
              </div>
              {noCode > 0 && <span className="chip warn">{noCode} linhas sem código serão ignoradas</span>}
              <p className="muted small" style={{ margin: 0 }}>Preço e estoque podem ser preenchidos depois, se não estiverem na planilha.</p>
            </section>
          </div>
        )}
        {progress && <div className="chip">Importando… {progress.done} de {progress.total}</div>}
        {result && <div className="chip ok" style={{ fontSize: 15, padding: 12 }}>Pronto: {result.created} novos, {result.updated} atualizados, {result.skipped} ignorados</div>}
        {!!headers.length && <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" disabled={!!progress} onClick={run}>Importar {rows.length} linhas</button></div>}
      </div>
    </>
  );
}
