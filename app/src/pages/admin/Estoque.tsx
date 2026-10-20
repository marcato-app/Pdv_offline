import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, save, uid, type Product, type Batch } from '../../lib/db';
import { LossModal } from '../../components/LossModal';
import { setStock, addStock } from '../../lib/pdv';
import { qtyFmt, parseNum, dateTime } from '../../lib/format';
import { Modal } from '../../components/ui';

type Row = Product & { stock: number };

export function Estoque() {
  const [t, setT] = useState('');
  const [filter, setFilter] = useState<'todos' | 'baixo' | 'zerado'>('todos');
  const [edit, setEdit] = useState<{ p: Row; mode: 'ajuste' | 'entrada' } | null>(null);
  const [hist, setHist] = useState<Row | null>(null);
  const [loss, setLoss] = useState<Row | null>(null);
  const data = useLiveQuery(async () => {
    const all = await db.products.filter((p) => !p.deleted && !!p.active).toArray();
    const st = await db.stockCache.bulkGet(all.map((p) => p.id));
    return all.map((p, i) => ({ ...p, stock: st[i]?.qty ?? 0 }));
  }, []);
  const q = t.trim().toLowerCase();
  const rows = (data || [])
    .filter((p) => !q || p.description.toLowerCase().includes(q) || p.barcode.includes(q) || (p.brand || '').toLowerCase().includes(q))
    .filter((p) => filter === 'todos' || (filter === 'zerado' ? p.stock <= 0 : p.stock > 0 && p.stock < p.minStock))
    .sort((a, b) => a.description.localeCompare(b.description))
    .slice(0, 300);
  const low = (data || []).filter((p) => p.stock > 0 && p.stock < p.minStock).length;
  const zero = (data || []).filter((p) => p.stock <= 0).length;

  return (
    <>
      <div className="page-head"><h1>Estoque</h1></div>
      <div className="grid">
        <div className="stat"><span className="muted small">Produtos ativos</span><b>{data?.length ?? 0}</b></div>
        <div className="stat" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}><span className="small">Abaixo do mínimo</span><b>{low}</b></div>
        <div className="stat" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}><span className="small">Zerados ou negativos</span><b>{zero}</b></div>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="row">
          <input className="input" style={{ flex: '1 1 260px' }} placeholder="Buscar por nome, código ou marca" value={t} onChange={(e) => setT(e.target.value)} />
          <select className="input" style={{ width: 200 }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="todos">Todos</option><option value="baixo">Abaixo do mínimo</option><option value="zerado">Zerados</option>
          </select>
        </div>
        <div className="table-wrap">
          <table className="t" style={{ minWidth: 700 }}>
            <thead><tr><th>Produto</th><th>Categoria</th><th className="right">Atual</th><th className="right">Mínimo</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.description}</td><td>{p.category}</td>
                  <td className="right">{qtyFmt(p.stock)} {p.unit}</td><td className="right">{qtyFmt(p.minStock)}</td>
                  <td>{p.stock <= 0 ? <span className="chip danger">Zerado</span> : p.stock < p.minStock ? <span className="chip warn">Baixo</span> : <span className="chip ok">OK</span>}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn sm" onClick={() => setEdit({ p, mode: 'entrada' })}>Entrada</button>{' '}
                    <button className="btn sm" onClick={() => setEdit({ p, mode: 'ajuste' })}>Ajustar</button>{' '}
                    <button className="btn sm danger" onClick={() => setLoss(p)}>Perda</button>{' '}
                    <button className="btn sm ghost" onClick={() => setHist(p)}>Histórico</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !rows.length && <div className="empty">Nada encontrado</div>}
        </div>
      </div>
      {edit && <StockModal row={edit.p} mode={edit.mode} onClose={() => setEdit(null)} />}
      {hist && <HistoryModal row={hist} onClose={() => setHist(null)} />}
      {loss && <LossModal product={loss} onClose={() => setLoss(null)} />}
    </>
  );
}

function StockModal({ row, mode, onClose }: { row: Row; mode: 'ajuste' | 'entrada'; onClose: () => void }) {
  const [v, setV] = useState(mode === 'ajuste' ? qtyFmt(row.stock) : '');
  const [exp, setExp] = useState('');
  const [note, setNote] = useState('');
  const ok = async () => {
    const n = parseNum(v);
    if (mode === 'ajuste') await setStock(row.id, n, row.stock, 'ajuste');
    else {
      await addStock(row.id, n, 'entrada');
      // Validade do lote: avisa antes de vencer (Validade e perdas).
      if (exp && n > 0) await save<Batch>('batches', { id: uid(), productId: row.id, productName: row.description, qty: n, expiresAt: new Date(exp + 'T00:00:00').getTime(), status: 'ativo', note: note || undefined, createdAt: Date.now() });
    }
    onClose();
  };
  return (
    <Modal title={mode === 'ajuste' ? 'Ajustar estoque' : 'Entrada de mercadoria'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={ok}>Salvar</button></>}>
      <b>{row.description}</b>
      <span className="muted">Estoque atual: {qtyFmt(row.stock)} {row.unit}</span>
      <div className="field"><label htmlFor="sv">{mode === 'ajuste' ? 'Quantidade correta (contada)' : 'Quantidade que chegou'}</label>
        <input id="sv" className="input big" autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
      </div>
      {mode === 'entrada' && (
        <div className="grid">
          <div className="field"><label htmlFor="sexp">Validade (opcional)</label><input id="sexp" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></div>
          <div className="field"><label htmlFor="snote">Lote / observação</label><input id="snote" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
      )}
    </Modal>
  );
}

const REASONS: Record<string, string> = { inicial: 'Estoque inicial', venda: 'Venda', cancelamento: 'Venda cancelada', ajuste: 'Ajuste', entrada: 'Entrada', inventario: 'Inventário', perda: 'Perda' };

function HistoryModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const moves = useLiveQuery(() => db.stockMoves.where('productId').equals(row.id).reverse().sortBy('createdAt'), [row.id]);
  return (
    <Modal title={'Histórico · ' + row.description} wide onClose={onClose}>
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table className="t">
          <thead><tr><th>Data</th><th>Motivo</th><th className="right">Quantidade</th></tr></thead>
          <tbody>{moves?.slice(0, 200).map((m) => <tr key={m.id}><td>{dateTime(m.createdAt)}</td><td>{REASONS[m.reason]}</td><td className="right">{m.qty > 0 ? '+' : ''}{qtyFmt(m.qty)}</td></tr>)}</tbody>
        </table>
      </div>
    </Modal>
  );
}
