import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, save, type Batch, type LossReason } from '../../lib/db';
import { dateOnly, money, qtyFmt, startOfDay } from '../../lib/format';
import { LossModal, LOSS_REASONS } from '../../components/LossModal';

const DAY = 86_400_000;

function badge(expiresAt: number) {
  const days = Math.round((expiresAt - startOfDay()) / DAY);
  if (days < 0) return <span className="chip danger">Vencido há {-days} {days === -1 ? 'dia' : 'dias'}</span>;
  if (days === 0) return <span className="chip danger">Vence hoje</span>;
  if (days <= 3) return <span className="chip warn">Vence em {days} {days === 1 ? 'dia' : 'dias'}</span>;
  if (days <= 7) return <span className="chip warn">Em {days} dias</span>;
  return <span className="chip">Em {days} dias</span>;
}

export function Validade() {
  const [tab, setTab] = useState<'validade' | 'perdas'>('validade');
  const [range, setRange] = useState(30);
  const [loss, setLoss] = useState<{ batch?: Batch } | null>(null);
  const batches = useLiveQuery(() => db.batches.where('status').equals('ativo').filter((b) => !b.deleted).sortBy('expiresAt'), [], [] as Batch[]);
  const shown = batches.filter((b) => b.expiresAt < startOfDay() + range * DAY);
  const losses = useLiveQuery(async () => {
    const since = startOfDay() - 29 * DAY;
    const moves = await db.stockMoves.where('createdAt').aboveOrEqual(since).filter((m) => !m.deleted && m.reason === 'perda').reverse().sortBy('createdAt');
    const prods = await db.products.bulkGet([...new Set(moves.map((m) => m.productId))]);
    const name = new Map(prods.filter(Boolean).map((p) => [p!.id, p!.description]));
    return moves.map((m) => ({ ...m, name: name.get(m.productId) || '—', cost: -m.qty * (m.unitCost || 0) }));
  }, [], []);
  const byReason = losses.reduce<Record<string, number>>((a, m) => { a[m.lossReason || 'outro'] = (a[m.lossReason || 'outro'] || 0) + m.cost; return a; }, {});
  const totalLoss = losses.reduce((s, m) => s + m.cost, 0);
  const expired = batches.filter((b) => b.expiresAt < startOfDay()).length;
  const week = batches.filter((b) => b.expiresAt >= startOfDay() && b.expiresAt < startOfDay() + 7 * DAY).length;

  return (
    <>
      <div className="page-head"><h1>Validade e perdas</h1><button className="btn danger" onClick={() => setLoss({})}>Registrar perda</button></div>
      <div className="grid">
        <div className="stat" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}><span className="small">Lotes vencidos</span><b>{expired}</b></div>
        <div className="stat" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}><span className="small">Vencem em 7 dias</span><b>{week}</b></div>
        <div className="stat"><span className="muted small">Perdas em 30 dias (custo)</span><b>{money(totalLoss)}</b></div>
      </div>
      <div className="row">
        <button className={'btn sm ' + (tab === 'validade' ? 'secondary' : '')} onClick={() => setTab('validade')}>Validade</button>
        <button className={'btn sm ' + (tab === 'perdas' ? 'secondary' : '')} onClick={() => setTab('perdas')}>Perdas</button>
      </div>
      {tab === 'validade' ? (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row">
            <span className="label">Mostrar o que vence em até</span>
            {[7, 15, 30, 90].map((d) => <button key={d} className={'btn sm ' + (range === d ? 'primary' : '')} onClick={() => setRange(d)}>{d} dias</button>)}
          </div>
          <div className="table-wrap">
            <table className="t" style={{ minWidth: 700 }}>
              <thead><tr><th>Produto</th><th>Validade</th><th>Situação</th><th className="right">Qtd do lote</th><th></th></tr></thead>
              <tbody>{shown.map((b) => (
                <tr key={b.id}>
                  <td>{b.productName}{b.note && <span className="muted small"> · {b.note}</span>}</td>
                  <td>{dateOnly(b.expiresAt)}</td>
                  <td>{badge(b.expiresAt)}</td>
                  <td className="right">{qtyFmt(b.qty)}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <Link className="btn sm" to={`/produtos/${b.productId}`}>Fazer promoção</Link>{' '}
                    <button className="btn sm" onClick={() => save<Batch>('batches', { ...b, status: 'resolvido' })}>Já vendeu</button>{' '}
                    <button className="btn sm danger" onClick={() => setLoss({ batch: b })}>Perda</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
            {!shown.length && <div className="empty">Nada vencendo nesse período. Informe a validade ao dar entrada de mercadoria em Estoque.</div>}
          </div>
        </div>
      ) : (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row">{Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} className="chip">{LOSS_REASONS[k as LossReason]}: {money(v)}</span>)}</div>
          <div className="table-wrap">
            <table className="t" style={{ minWidth: 640 }}>
              <thead><tr><th>Data</th><th>Produto</th><th>Motivo</th><th className="right">Qtd</th><th className="right">Custo perdido</th></tr></thead>
              <tbody>{losses.map((m) => (
                <tr key={m.id}><td>{dateOnly(m.createdAt)}</td><td>{m.name}{m.note && <span className="muted small"> · {m.note}</span>}</td><td>{LOSS_REASONS[m.lossReason || 'outro']}</td><td className="right">{qtyFmt(-m.qty)}</td><td className="right">{money(m.cost)}</td></tr>
              ))}</tbody>
            </table>
            {!losses.length && <div className="empty">Nenhuma perda nos últimos 30 dias</div>}
          </div>
        </div>
      )}
      {loss && <LossModal batch={loss.batch} onClose={() => setLoss(null)} />}
    </>
  );
}
