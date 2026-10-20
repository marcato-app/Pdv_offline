import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, save, uid, round3, type Batch, type LossReason, type Product, type StockMove } from '../lib/db';
import { parseNum, qtyFmt, money } from '../lib/format';
import { searchProducts } from '../lib/pdv';
import { Modal } from './ui';

export const LOSS_REASONS: Record<LossReason, string> = {
  vencido: 'Venceu',
  quebra: 'Quebrou',
  avaria: 'Avaria / estragou',
  furto: 'Furto',
  consumo: 'Consumo interno',
  outro: 'Outro',
};

/** Registra uma perda: baixa o estoque e guarda o motivo e o custo perdido. */
export function LossModal({ product, batch, onClose }: { product?: Product | null; batch?: Batch | null; onClose: () => void }) {
  const [picked, setPicked] = useState<Product | null>(product || null);
  const [q, setQ] = useState('');
  const [qty, setQty] = useState(batch ? qtyFmt(batch.qty) : '1');
  const [reason, setReason] = useState<LossReason>(batch ? 'vencido' : 'avaria');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const results = useLiveQuery(() => (picked ? [] : searchProducts(q, 8)), [q, picked], [] as Product[]);
  useEffect(() => { if (batch && !picked) db.products.get(batch.productId).then((p) => setPicked(p || null)); }, [batch?.id]);

  const ok = async () => {
    const n = parseNum(qty);
    if (!picked) return setErr('Escolha o produto');
    if (n <= 0) return setErr('Informe a quantidade');
    await db.transaction('rw', [db.stockMoves, db.outbox, db.stockCache, db.batches], async () => {
      await save<StockMove>('stockMoves', { id: uid(), productId: picked.id, qty: -round3(n), reason: 'perda', lossReason: reason, unitCost: picked.cost || 0, note: note || undefined, refId: batch?.id, createdAt: Date.now() });
      if (batch) await save<Batch>('batches', { ...batch, qty: Math.max(0, round3(batch.qty - n)), status: n >= batch.qty ? 'resolvido' : 'ativo' });
    });
    onClose();
  };

  return (
    <Modal title="Registrar perda" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn danger" onClick={ok}>Registrar perda</button></>}>
      {picked ? (
        <div className="spread"><b>{picked.description}</b>{!product && !batch && <button className="btn sm ghost" onClick={() => setPicked(null)}>Trocar</button>}</div>
      ) : (
        <>
          <input className="input" autoFocus placeholder="Buscar produto" value={q} onChange={(e) => setQ(e.target.value)} />
          {results.map((p) => <button key={p.id} className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => setPicked(p)}>{p.description}</button>)}
        </>
      )}
      <div className="grid">
        <div className="field"><label htmlFor="lq">Quantidade perdida</label><input id="lq" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="field"><label htmlFor="lr">Motivo</label><select id="lr" value={reason} onChange={(e) => setReason(e.target.value as LossReason)}>{Object.entries(LOSS_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      </div>
      <div className="field"><label htmlFor="ln">Observação</label><input id="ln" value={note} onChange={(e) => setNote(e.target.value)} /></div>
      {picked && <span className="muted small">Custo perdido: {money((picked.cost || 0) * parseNum(qty))}</span>}
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}
