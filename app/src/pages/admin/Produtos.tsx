import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, save, remove, uid, stockOf, round2, type Product } from '../../lib/db';
import { setStock } from '../../lib/pdv';
import { money, parseNum, dec2, qtyFmt } from '../../lib/format';
import { resizeImage } from '../../lib/theme';
import { Photo } from '../../components/ui';

export function Produtos() {
  const [t, setT] = useState('');
  const [limit, setLimit] = useState(100);
  const list = useLiveQuery(async () => {
    const q = t.trim().toLowerCase();
    const rows = await db.products.orderBy('description').filter((p) => !p.deleted && (!q || p.description.toLowerCase().includes(q) || p.barcode.includes(q) || (p.brand || '').toLowerCase().includes(q))).limit(limit).toArray();
    const stock = await db.stockCache.bulkGet(rows.map((r) => r.id));
    return rows.map((r, i) => ({ ...r, stock: stock[i]?.qty ?? 0 }));
  }, [t, limit]);
  const count = useLiveQuery(() => db.products.filter((p) => !p.deleted).count(), [], 0);
  return (
    <>
      <div className="page-head">
        <h1>Produtos <span className="muted" style={{ fontSize: 16 }}>({count})</span></h1>
        <div className="row"><Link className="btn" to="/admin/importar">Importar planilha</Link><Link className="btn primary" to="/admin/produtos/novo">+ Novo produto</Link></div>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input className="input" placeholder="Buscar por nome, código ou marca" value={t} onChange={(e) => setT(e.target.value)} />
        <div className="table-wrap">
          <table className="t" style={{ minWidth: 720 }}>
            <thead><tr><th>Produto</th><th>Código</th><th>Marca</th><th>Categoria</th><th className="right">Preço</th><th className="right">Estoque</th></tr></thead>
            <tbody>
              {list?.map((p) => (
                <tr key={p.id} className="click" onClick={() => (location.hash = `#/admin/produtos/${p.id}`)}>
                  <td>{p.description}{!p.active && <span className="chip warn" style={{ marginLeft: 8 }}>Inativo</span>}</td>
                  <td>{p.barcode}</td><td>{p.brand}</td><td>{p.category}</td>
                  <td className="right">{money(p.price)}</td>
                  <td className="right">{qtyFmt(p.stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list && !list.length && <div className="empty">Nenhum produto. Cadastre ou importe sua planilha.</div>}
        </div>
        {list && list.length >= limit && <button className="btn ghost" onClick={() => setLimit(limit + 200)}>Mostrar mais</button>}
      </div>
    </>
  );
}

const EMPTY: Omit<Product, 'id' | 'updatedAt' | 'deleted'> = {
  barcode: '', description: '', unit: 'UN', cost: 0, price: 0, minStock: 0, active: 1,
};

export function ProdutoForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const isNew = !id || id === 'novo';
  const [p, setP] = useState<Partial<Product>>(EMPTY);
  const [txt, setTxt] = useState<Record<string, string>>({});
  const [stock, setStockState] = useState(0);
  const [stockTxt, setStockTxt] = useState('0');
  const [tab, setTab] = useState<'geral' | 'precos' | 'estoque' | 'fiscal'>('geral');
  const [err, setErr] = useState('');
  const cats = useLiveQuery(async () => {
    const all = await db.products.filter((x) => !x.deleted).toArray();
    const uniq = (k: keyof Product) => [...new Set(all.map((x) => x[k]).filter(Boolean) as string[])].sort();
    return { category: uniq('category'), subcategory: uniq('subcategory'), basket: uniq('basket'), brand: uniq('brand'), manufacturer: uniq('manufacturer') };
  }, []);

  useEffect(() => {
    if (isNew) return;
    db.products.get(id!).then(async (x) => {
      if (!x) return;
      setP(x);
      setTxt({ cost: dec2(x.cost), price: dec2(x.price), wholesalePrice: x.wholesalePrice ? dec2(x.wholesalePrice) : '', wholesaleMinQty: x.wholesaleMinQty ? String(x.wholesaleMinQty) : '', minStock: String(x.minStock || 0) });
      const s = await stockOf(x.id);
      setStockState(s);
      setStockTxt(qtyFmt(s));
    });
  }, [id]);

  const set = (k: keyof Product, v: unknown) => setP((o) => ({ ...o, [k]: v }));
  const num = (k: string) => txt[k] ?? '';
  const setNum = (k: string, v: string) => setTxt((o) => ({ ...o, [k]: v }));
  const cost = parseNum(num('cost'));
  const price = parseNum(num('price'));
  const margin = cost > 0 ? round2(((price - cost) / cost) * 100) : 0;

  const submit = async () => {
    setErr('');
    if (!p.description?.trim()) return setErr('Informe o descritivo');
    if (!p.barcode?.trim() && !p.internalCode?.trim()) return setErr('Informe o código de barras ou o código interno');
    if (p.barcode) {
      const dup = await db.products.where('barcode').equals(p.barcode.trim()).filter((x) => !x.deleted && x.id !== p.id).first();
      if (dup) return setErr(`Este código já está em "${dup.description}"`);
    }
    const rec = {
      ...EMPTY, ...p, id: p.id || uid(), barcode: (p.barcode || '').trim(), description: p.description.trim(),
      cost, price, wholesalePrice: parseNum(num('wholesalePrice')) || undefined, wholesaleMinQty: parseNum(num('wholesaleMinQty')) || undefined,
      minStock: parseNum(num('minStock')),
    } as Product;
    await save<Product>('products', rec);
    const newStock = parseNum(stockTxt);
    if (newStock !== stock) await setStock(rec.id, newStock, stock, isNew ? 'inicial' : 'ajuste');
    nav('/admin/produtos');
  };

  const F = (k: keyof Product, label: string, list?: string[]) => (
    <div className="field">
      <label htmlFor={'p-' + k}>{label}</label>
      <input id={'p-' + k} list={list ? 'dl-' + k : undefined} value={(p[k] as string) || ''} onChange={(e) => set(k, e.target.value)} />
      {list && <datalist id={'dl-' + k}>{list.map((x) => <option key={x} value={x} />)}</datalist>}
    </div>
  );
  const N = (k: string, label: string) => (
    <div className="field"><label htmlFor={'n-' + k}>{label}</label><input id={'n-' + k} inputMode="decimal" value={num(k)} onChange={(e) => setNum(k, e.target.value)} /></div>
  );

  return (
    <>
      <div className="page-head">
        <div><span className="muted small">Produtos › {isNew ? 'Novo' : 'Editar'}</span><h1>Cadastro de produto</h1></div>
        <div className="row" style={{ background: 'var(--field)', borderRadius: 24, padding: 3, gap: 2 }}>
          {(['geral', 'precos', 'estoque', 'fiscal'] as const).map((x) => (
            <button key={x} className="btn sm" style={{ background: tab === x ? '#fff' : 'transparent', borderRadius: 20 }} onClick={() => setTab(x)}>
              {{ geral: 'Geral', precos: 'Preços', estoque: 'Estoque', fiscal: 'Fiscal' }[x]}
            </button>
          ))}
        </div>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Photo src={p.photo} size={180} label="Sem foto" />
            <label className="btn sm" style={{ cursor: 'pointer' }}>
              {p.photo ? 'Trocar foto' : 'Adicionar foto'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('photo', await resizeImage(f)); }} />
            </label>
            {p.photo && <button className="btn sm ghost" onClick={() => set('photo', undefined)}>Remover foto</button>}
          </div>
          <div className="grid" style={{ flex: '1 1 420px' }}>
            {tab === 'geral' && <>
              {F("barcode", "Código de barras")}
              <div style={{ gridColumn: '1 / -1' }}>{F("description", "Descritivo")}</div>
              {F("brand", "Marca", cats?.brand)}
              {F("manufacturer", "Fabricante", cats?.manufacturer)}
              {F("content", "Conteúdo (ex.: 1 kg)")}
              {F("category", "Categoria", cats?.category)}
              {F("subcategory", "Subcategoria", cats?.subcategory)}
              {F("basket", "Cesta", cats?.basket)}
              <div className="field"><label htmlFor="un">Vendido por</label>
                <select id="un" value={p.unit} onChange={(e) => set('unit', e.target.value)}><option value="UN">Unidade</option><option value="KG">Quilo (balança)</option></select>
              </div>
              {F("internalCode", "Código interno / balança")}
              <div className="field"><label htmlFor="at">Situação</label>
                <select id="at" value={p.active} onChange={(e) => set('active', Number(e.target.value))}><option value={1}>Ativo</option><option value={0}>Inativo</option></select>
              </div>
            </>}
            {tab === 'precos' && <>
              {N("cost", "Preço de custo")}
              <div className="field"><label htmlFor="mg">Margem %</label><input id="mg" inputMode="decimal" value={dec2(margin)} onChange={(e) => setNum('price', dec2(cost * (1 + parseNum(e.target.value) / 100)))} /></div>
              {N("price", "Preço de venda")}
              {N("wholesalePrice", "Preço de atacado")}
              {N("wholesaleMinQty", "Atacado a partir de (qtd)")}
            </>}
            {tab === 'estoque' && <>
              <div className="field"><label htmlFor="st">Estoque atual</label><input id="st" inputMode="decimal" value={stockTxt} onChange={(e) => setStockTxt(e.target.value)} /></div>
              {N("minStock", "Estoque mínimo (avisar abaixo de)")}
            </>}
            {tab === 'fiscal' && <>
              {F("ncm", "NCM")}
              {F("cest", "CEST")}
              {F("cfop", "CFOP")}
            </>}
          </div>
        </div>
        {err && <div className="error">{err}</div>}
        <div className="spread">
          <span className="chip ok">Salvo neste aparelho e enviado para a nuvem</span>
          <div className="row">
            {!isNew && <button className="btn danger" onClick={async () => { if (confirm('Excluir este produto?')) { await remove('products', p.id!); nav('/admin/produtos'); } }}>Excluir</button>}
            <button className="btn" onClick={() => nav('/admin/produtos')}>Cancelar</button>
            <button className="btn primary" onClick={submit}>Salvar produto</button>
          </div>
        </div>
      </div>
    </>
  );
}
