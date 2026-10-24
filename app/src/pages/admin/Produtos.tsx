import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, save, remove, uid, stockOf, round2, type Product, type PendingProduct } from '../../lib/db';
import { setStock, resolvePending } from '../../lib/pdv';
import { lookupBarcode, photoToDataUrl, contribute } from '../../lib/catalog';
import { money, parseNum, dec2, qtyFmt } from '../../lib/format';
import { resizeImage } from '../../lib/theme';
import { Photo } from '../../components/ui';
import { CameraButton } from '../../components/CameraScan';
import { TreePicker } from '../../components/TreePicker';
import { pathOf } from '../../lib/arvore';

export function Produtos() {
  const nav = useNavigate();
  const [t, setT] = useState('');
  const [limit, setLimit] = useState(100);
  const list = useLiveQuery(async () => {
    const q = t.trim().toLowerCase();
    const rows = await db.products.orderBy('description').filter((p) => !p.deleted && (!q || p.description.toLowerCase().includes(q) || p.barcode.includes(q) || (p.brand || '').toLowerCase().includes(q))).limit(limit).toArray();
    const stock = await db.stockCache.bulkGet(rows.map((r) => r.id));
    return rows.map((r, i) => ({ ...r, stock: stock[i]?.qty ?? 0 }));
  }, [t, limit]);
  const count = useLiveQuery(() => db.products.filter((p) => !p.deleted).count(), [], 0);
  const pending = useLiveQuery(() => db.pendingProducts.filter((x) => !x.deleted).reverse().sortBy('lastSeen'), [], [] as PendingProduct[]);
  return (
    <>
      <div className="page-head">
        <h1>Produtos <span className="muted" style={{ fontSize: 16 }}>({count})</span></h1>
        <div className="row"><Link className="btn" to="/importar">Importar planilha</Link><Link className="btn primary" to="/produtos/novo">+ Novo produto</Link></div>
      </div>
      {pending.length > 0 && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--warn-bg)', borderColor: '#fcd34d' }}>
          <b style={{ color: 'var(--warn)' }}>{pending.length} {pending.length === 1 ? 'produto foi vendido' : 'produtos foram vendidos'} sem cadastro</b>
          <span className="small" style={{ color: 'var(--warn)' }}>Ao cadastrar, as vendas feitas passam a contar para o produto e o estoque é atualizado.</span>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Código</th><th>Descrição no caixa</th><th className="right">Vendido</th><th className="right">Último preço</th><th></th></tr></thead>
              <tbody>{pending.map((x) => (
                <tr key={x.id}><td>{x.barcode}</td><td>{x.description}</td><td className="right">{x.qty} ({x.timesSold}x)</td><td className="right">{money(x.lastPrice)}</td>
                  <td className="right"><button className="btn sm primary" onClick={() => nav(`/produtos/novo?pendente=${x.id}`)}>Cadastrar</button></td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
          <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="Buscar por nome, código ou marca" value={t} onChange={(e) => setT(e.target.value)} />
          <CameraButton onCode={setT} />
        </div>
        <div className="table-wrap">
          <table className="t" style={{ minWidth: 720 }}>
            <thead><tr><th>Produto</th><th>Código</th><th>Marca</th><th>Categoria</th><th className="right">Preço</th><th className="right">Estoque</th></tr></thead>
            <tbody>
              {list?.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`/produtos/${p.id}`)}>
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
  const [pendingRow, setPendingRow] = useState<PendingProduct | null>(null);
  const [lookup, setLookup] = useState<'' | 'buscando' | 'achou' | 'nada'>('');
  const lastLooked = useRef('');
  // Cadastro automático: ao informar o código de barras, preenche o que estiver vazio.
  const autoFill = async (code: string) => {
    const c = code.replace(/\D/g, '');
    if (c.length < 8 || c === lastLooked.current) return;
    lastLooked.current = c;
    setLookup('buscando');
    const it = await lookupBarcode(c);
    if (!it) return setLookup('nada');
    const photo = !p.photo && it.photo ? await photoToDataUrl(it.photo) : undefined;
    setP((o) => {
      const n = { ...o };
      for (const k of ['description', 'brand', 'manufacturer', 'segment', 'department', 'category', 'subcategory', 'family', 'basket', 'content', 'ncm'] as const) {
        if (!n[k] && it[k]) n[k] = it[k] as string;
      }
      if (photo && !n.photo) n.photo = photo;
      return n;
    });
    setLookup('achou');
  };
  const cats = useLiveQuery(async () => {
    const all = await db.products.filter((x) => !x.deleted).toArray();
    const uniq = (k: keyof Product) => [...new Set(all.map((x) => x[k]).filter(Boolean) as string[])].sort();
    return { category: uniq('category'), subcategory: uniq('subcategory'), basket: uniq('basket'), brand: uniq('brand'), manufacturer: uniq('manufacturer'), supplier: uniq('supplier') };
  }, []);

  useEffect(() => {
    if (isNew) {
      const pid = new URLSearchParams(location.search).get('pendente');
      if (pid) db.pendingProducts.get(pid).then((x) => {
        if (!x) return;
        setPendingRow(x);
        setP((o) => ({ ...o, barcode: x.barcode, description: x.description === 'PRODUTO NÃO CADASTRADO' ? '' : x.description }));
        setTxt((o) => ({ ...o, price: dec2(x.lastPrice) }));
        autoFill(x.barcode);
      });
      return;
    }
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
    contribute([rec]);
    const newStock = parseNum(stockTxt);
    if (newStock !== stock) await setStock(rec.id, newStock, stock, isNew ? 'inicial' : 'ajuste');
    if (pendingRow) await resolvePending(pendingRow, rec);
    nav('/produtos');
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
        {pendingRow && <span className="chip warn" style={{ padding: 10 }}>Vendido {pendingRow.timesSold}x sem cadastro. Ao salvar, essas vendas passam a contar para este produto. Em "Estoque", informe a quantidade que tem hoje.</span>}
        <div className="row" style={{ alignItems: 'flex-start', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Photo src={p.photo} size={180} label="Sem foto" product={p} />
            <label className="btn sm" style={{ cursor: 'pointer' }}>
              {p.photo ? 'Trocar foto' : 'Adicionar foto'}
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => { const f = e.target.files?.[0]; if (f) set('photo', await resizeImage(f)); }} />
            </label>
            {p.photo && <button className="btn sm ghost" onClick={() => set('photo', undefined)}>Remover foto</button>}
          </div>
          <div className="grid" style={{ flex: '1 1 420px' }}>
            {tab === 'geral' && <>
              <div className="field">
                <label htmlFor="p-barcode">Código de barras</label>
                <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
                  <input id="p-barcode" style={{ flex: 1, minWidth: 0 }} value={p.barcode || ''} onChange={(e) => set('barcode', e.target.value)} onBlur={(e) => autoFill(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); autoFill((e.target as HTMLInputElement).value); } }} />
                  <CameraButton onCode={(c) => { set('barcode', c); autoFill(c); }} />
                </div>
                {lookup === 'buscando' && <span className="muted small">Procurando no banco de produtos…</span>}
                {lookup === 'achou' && <span className="small" style={{ color: 'var(--ok)', fontWeight: 700 }}>Dados preenchidos automaticamente. Confira.</span>}
                {lookup === 'nada' && <span className="muted small">Não encontrado no banco de produtos. Preencha à mão.</span>}
              </div>
              <div style={{ gridColumn: '1 / -1' }}>{F("description", "Descritivo")}</div>
              {F("brand", "Marca", cats?.brand)}
              {F("manufacturer", "Fabricante", cats?.manufacturer)}
              {F("supplier", "Fornecedor (de quem compra)", cats?.supplier)}
              {F("content", "Conteúdo (ex.: 1 kg)")}
              <TreePicker value={pathOf(p)} onChange={(v) => setP((o) => ({ ...o, segment: v[0] || undefined, department: v[1] || undefined, category: v[2] || undefined, subcategory: v[3] || undefined, family: v[4] || undefined }))} />
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
            {!isNew && <button className="btn danger" onClick={async () => { if (confirm('Excluir este produto?')) { await remove('products', p.id!); nav('/produtos'); } }}>Excluir</button>}
            <button className="btn" onClick={() => nav('/produtos')}>Cancelar</button>
            <button className="btn primary" onClick={submit}>Salvar produto</button>
          </div>
        </div>
      </div>
    </>
  );
}
