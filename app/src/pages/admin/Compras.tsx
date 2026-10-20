import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSetting, setSetting, round3 } from '../../lib/db';
import { addStock } from '../../lib/pdv';
import { money, qtyFmt, parseNum, startOfDay } from '../../lib/format';
import { useApp } from '../../lib/app-context';
import { Modal } from '../../components/ui';
import { printHtml } from '../../lib/receipt';

const DAY = 86_400_000;

export interface Supplier { name: string; phone?: string }

interface Suggestion {
  productId: string;
  name: string;
  unit: string;
  supplier: string;
  stock: number;
  minStock: number;
  perDay: number;
  daysLeft: number | null;
  suggested: number;
  cost: number;
}

/**
 * Lista de compras automática: olha quanto vende por dia (últimos N dias), o estoque atual e o mínimo,
 * e sugere quanto comprar para durar X dias. Agrupa por fornecedor e manda o pedido no WhatsApp.
 */
export function Compras() {
  const { store } = useApp();
  const [days, setDays] = useState(30);
  const [cover, setCover] = useState(7);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [received, setReceived] = useState('');
  const suppliers = useLiveQuery(() => getSetting<Supplier[]>('suppliers', []), [], [] as Supplier[]);

  const list = useLiveQuery(async () => {
    const since = startOfDay() - days * DAY;
    const moves = await db.stockMoves.where('createdAt').aboveOrEqual(since).filter((m) => !m.deleted && (m.reason === 'venda' || m.reason === 'cancelamento')).toArray();
    const sold: Record<string, number> = {};
    for (const m of moves) sold[m.productId] = (sold[m.productId] || 0) - m.qty;
    const products = await db.products.filter((p) => !p.deleted && !!p.active).toArray();
    const stock = await db.stockCache.bulkGet(products.map((p) => p.id));
    const out: Suggestion[] = [];
    products.forEach((p, i) => {
      const st = stock[i]?.qty ?? 0;
      const perDay = Math.max(0, (sold[p.id] || 0) / days);
      const need = perDay * cover + (p.minStock || 0) - st;
      if (need <= 0.0001 && !(p.minStock && st < p.minStock)) return;
      const suggested = p.unit === 'KG' ? round3(Math.max(0, need)) : Math.max(1, Math.ceil(need));
      if (suggested <= 0) return;
      out.push({ productId: p.id, name: p.description, unit: p.unit, supplier: p.supplier || 'Sem fornecedor', stock: st, minStock: p.minStock || 0, perDay, daysLeft: perDay > 0 ? Math.max(0, st / perDay) : null, suggested, cost: p.cost || 0 });
    });
    return out.sort((a, b) => (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
  }, [days, cover]);

  useEffect(() => { setQty({}); }, [days, cover]);
  const groups = useMemo(() => {
    const g: Record<string, Suggestion[]> = {};
    for (const s of list || []) (g[s.supplier] ||= []).push(s);
    return Object.entries(g).sort((a, b) => (a[0] === 'Sem fornecedor' ? 1 : b[0] === 'Sem fornecedor' ? -1 : a[0].localeCompare(b[0])));
  }, [list]);

  const q = (s: Suggestion) => (qty[s.productId] !== undefined ? parseNum(qty[s.productId]) : s.suggested);
  const chosen = (items: Suggestion[]) => items.filter((s) => !off[s.productId] && q(s) > 0);
  const orderText = (supplier: string, items: Suggestion[]) =>
    `*Pedido · ${store.name}*\nFornecedor: ${supplier}\n\n${chosen(items).map((s) => `• ${qtyFmt(q(s))} ${s.unit === 'KG' ? 'kg' : 'un'} — ${s.name}`).join('\n')}\n\nObrigado!`;
  const phoneOf = (name: string) => suppliers.find((x) => x.name.toLowerCase() === name.toLowerCase())?.phone?.replace(/\D/g, '');

  const receive = async (items: Suggestion[]) => {
    if (!confirm('Dar entrada no estoque com estas quantidades?')) return;
    for (const s of chosen(items)) await addStock(s.productId, q(s), 'entrada');
    setReceived(`Entrada feita: ${chosen(items).length} produtos`);
  };

  return (
    <>
      <div className="page-head">
        <h1>Lista de compras</h1>
        <button className="btn" onClick={() => setSuppliersOpen(true)}>Fornecedores e WhatsApp</button>
      </div>
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
        <div className="field"><label htmlFor="cd">Basear nas vendas dos últimos</label>
          <select id="cd" className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 15, 30, 60, 90].map((d) => <option key={d} value={d}>{d} dias</option>)}</select>
        </div>
        <div className="field"><label htmlFor="cc">Comprar para durar</label>
          <select id="cc" className="input" value={cover} onChange={(e) => setCover(Number(e.target.value))}>{[3, 7, 10, 15, 30].map((d) => <option key={d} value={d}>{d} dias</option>)}</select>
        </div>
        <p className="muted small" style={{ margin: 0, flex: '1 1 260px' }}>A sugestão = venda por dia × dias + estoque mínimo − estoque atual. Ajuste as quantidades antes de enviar. Cadastre o fornecedor de cada produto no cadastro de produtos.</p>
      </div>
      {received && <span className="chip ok" style={{ padding: 10 }}>{received}</span>}
      {list && !list.length && <div className="card empty">Nada para comprar agora. Tudo acima do mínimo e com estoque para {cover} dias.</div>}
      {groups.map(([supplier, items]) => {
        const total = chosen(items).reduce((s, x) => s + q(x) * x.cost, 0);
        const phone = phoneOf(supplier);
        return (
          <div key={supplier} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="spread">
              <h2 style={{ fontSize: 18 }}>{supplier} <span className="muted" style={{ fontSize: 14 }}>({chosen(items).length} itens{total ? ` · ~${money(total)}` : ''})</span></h2>
              <div className="row">
                <button className="btn sm" onClick={() => navigator.clipboard?.writeText(orderText(supplier, items))}>Copiar pedido</button>
                <button className="btn sm" onClick={() => printHtml(`<!doctype html><meta charset="utf-8"><body style="font:14px sans-serif;padding:16px"><pre style="font:inherit;white-space:pre-wrap">${orderText(supplier, items).replace(/\*/g, '').replace(/</g, '&lt;')}</pre></body>`)}>Imprimir</button>
                <a className="btn sm primary" target="_blank" rel="noreferrer" href={`https://wa.me/${phone ? (phone.length <= 11 ? '55' + phone : phone) : ''}?text=${encodeURIComponent(orderText(supplier, items))}`}>Enviar no WhatsApp</a>
                <button className="btn sm secondary" onClick={() => receive(items)}>Chegou: dar entrada</button>
              </div>
            </div>
            <div className="table-wrap">
              <table className="t" style={{ minWidth: 720 }}>
                <thead><tr><th></th><th>Produto</th><th className="right">Estoque</th><th className="right">Mínimo</th><th className="right">Vende/dia</th><th className="right">Dura</th><th className="right" style={{ width: 120 }}>Comprar</th></tr></thead>
                <tbody>{items.map((s) => (
                  <tr key={s.productId} className={off[s.productId] ? 'cut' : ''}>
                    <td><input type="checkbox" aria-label="Incluir" checked={!off[s.productId]} onChange={(e) => setOff({ ...off, [s.productId]: !e.target.checked })} /></td>
                    <td>{s.name}</td>
                    <td className="right">{qtyFmt(s.stock)}</td>
                    <td className="right">{qtyFmt(s.minStock)}</td>
                    <td className="right">{qtyFmt(round3(s.perDay))}</td>
                    <td className="right">{s.daysLeft === null ? '—' : s.daysLeft < 1 ? <span className="chip danger">Acabando</span> : `${Math.floor(s.daysLeft)} dias`}</td>
                    <td className="right"><input className="input" style={{ height: 38, textAlign: 'right' }} inputMode="decimal" aria-label="Quantidade" value={qty[s.productId] ?? qtyFmt(s.suggested)} onChange={(e) => setQty({ ...qty, [s.productId]: e.target.value })} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        );
      })}
      {suppliersOpen && <SuppliersModal list={suppliers} onClose={() => setSuppliersOpen(false)} />}
    </>
  );
}

function SuppliersModal({ list, onClose }: { list: Supplier[]; onClose: () => void }) {
  const names = useLiveQuery(async () => [...new Set((await db.products.filter((p) => !p.deleted && !!p.supplier).toArray()).map((p) => p.supplier!))].sort(), [], [] as string[]);
  const [rows, setRows] = useState<Supplier[]>(list);
  useEffect(() => {
    const known = new Set(rows.map((r) => r.name.toLowerCase()));
    const extra = names.filter((n) => !known.has(n.toLowerCase())).map((n) => ({ name: n }));
    if (extra.length) setRows([...rows, ...extra]);
  }, [names.length]);
  return (
    <Modal title="Fornecedores" wide onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={async () => { await setSetting('suppliers', rows.filter((r) => r.name.trim())); onClose(); }}>Salvar</button></>}>
      <p className="muted small" style={{ margin: 0 }}>Coloque o WhatsApp de cada fornecedor para mandar o pedido com um toque.</p>
      {rows.map((r, i) => (
        <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
          <input className="input" aria-label="Nome" value={r.name} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
          <input className="input" aria-label="WhatsApp" placeholder="WhatsApp com DDD" value={r.phone || ''} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, phone: e.target.value } : x)))} />
          <button className="btn sm danger" onClick={() => setRows(rows.filter((_, k) => k !== i))}>Remover</button>
        </div>
      ))}
      <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => setRows([...rows, { name: '' }])}>+ Fornecedor</button>
    </Modal>
  );
}
