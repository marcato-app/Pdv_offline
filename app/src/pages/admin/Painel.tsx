import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../lib/db';
import { money, qtyFmt, PAYMENT_LABELS, startOfDay } from '../../lib/format';
import { downloadText } from '../../lib/backup';
import { Link } from 'react-router-dom';

const RANGES = { hoje: 'Hoje', '7': 'Últimos 7 dias', '30': 'Últimos 30 dias' } as const;

export function Painel() {
  const [range, setRange] = useState<keyof typeof RANGES>('hoje');
  const from = range === 'hoje' ? startOfDay() : startOfDay() - (Number(range) - 1) * 86_400_000;
  const r = useLiveQuery(async () => {
    const sales = await db.sales.where('createdAt').aboveOrEqual(from).filter((s) => !s.deleted && s.status === 'completed').toArray();
    const total = sales.reduce((s, x) => s + x.total, 0);
    const byHour = Array(24).fill(0) as number[];
    const byDay: Record<string, number> = {};
    const byMethod: Record<string, number> = {};
    const prod: Record<string, { name: string; qty: number; total: number }> = {};
    for (const s of sales) {
      const d = new Date(s.createdAt);
      byHour[d.getHours()] += s.total;
      const k = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      byDay[k] = (byDay[k] || 0) + s.total;
      for (const p of s.payments) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
      if (s.change) byMethod.dinheiro = (byMethod.dinheiro || 0) - s.change;
      for (const i of s.items) {
        if (i.canceled) continue;
        prod[i.productId] ??= { name: i.description, qty: 0, total: 0 };
        prod[i.productId].qty += i.qty;
        prod[i.productId].total += i.total;
      }
    }
    const top = Object.values(prod).sort((a, b) => b.total - a.total).slice(0, 10);
    const products = await db.products.filter((p) => !p.deleted && !!p.active).toArray();
    const st = await db.stockCache.bulkGet(products.map((p) => p.id));
    const low = products.filter((p, i) => (st[i]?.qty ?? 0) < p.minStock).length;
    return { count: sales.length, total, avg: sales.length ? total / sales.length : 0, byHour, byDay, byMethod, top, low, sales };
  }, [from]);

  const alerts = useLiveQuery(async () => {
    const today = startOfDay();
    const bills = await db.bills.where('dueDate').below(today + 86_400_000).filter((b) => !b.deleted && !b.paidAt).toArray();
    const pending = await db.pendingProducts.filter((x) => !x.deleted).count();
    return { late: bills.filter((b) => b.dueDate < today), dueToday: bills.filter((b) => b.dueDate >= today), pending };
  }, []);
  if (!r) return null;
  const series = range === 'hoje' ? r.byHour.map((v, h) => [String(h).padStart(2, '0') + 'h', v] as [string, number]).filter((_, h) => h >= 6 && h <= 23) : Object.entries(r.byDay);
  const max = Math.max(1, ...series.map((x) => x[1]));
  const exportCsv = () => {
    const lines = ['numero;data;operador;total;pagamentos'];
    for (const s of r.sales) lines.push([s.number, new Date(s.createdAt).toLocaleString('pt-BR'), s.operatorName, s.total.toFixed(2).replace('.', ','), s.payments.map((p) => PAYMENT_LABELS[p.method]).join('+')].join(';'));
    downloadText(`vendas_${range}.csv`, '﻿' + lines.join('\n'), 'text/csv');
  };

  return (
    <>
      <div className="page-head"><h1>Painel</h1>
        <div className="row">
          {(['hoje', '7', '30'] as (keyof typeof RANGES)[]).map((k) => <button key={k} className={'btn sm ' + (range === k ? 'secondary' : '')} onClick={() => setRange(k)}>{RANGES[k]}</button>)}
          <button className="btn sm ghost" onClick={exportCsv}>Exportar CSV</button>
        </div>
      </div>
      {alerts && (alerts.late.length > 0 || alerts.dueToday.length > 0 || alerts.pending > 0) && (
        <div className="row">
          {alerts.late.length > 0 && <Link to="/financeiro" className="chip danger" style={{ padding: 10, textDecoration: 'none' }}>{alerts.late.length} {alerts.late.length === 1 ? 'conta vencida' : 'contas vencidas'}</Link>}
          {alerts.dueToday.length > 0 && <Link to="/financeiro" className="chip warn" style={{ padding: 10, textDecoration: 'none' }}>{alerts.dueToday.length} {alerts.dueToday.length === 1 ? 'conta vence' : 'contas vencem'} hoje</Link>}
          {alerts.pending > 0 && <Link to="/produtos" className="chip warn" style={{ padding: 10, textDecoration: 'none' }}>{alerts.pending} {alerts.pending === 1 ? 'produto vendido' : 'produtos vendidos'} sem cadastro</Link>}
        </div>
      )}
      <div className="grid">
        <div className="stat"><span className="muted small">Faturamento</span><b>{money(r.total)}</b></div>
        <div className="stat"><span className="muted small">Vendas</span><b>{r.count}</b></div>
        <div className="stat"><span className="muted small">Ticket médio</span><b>{money(r.avg)}</b></div>
        <div className="stat" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}><span className="small">Produtos abaixo do mínimo</span><b>{r.low}</b></div>
      </div>
      <div className="row" style={{ alignItems: 'stretch', gap: 20 }}>
        <div className="card" style={{ flex: '2 1 460px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2 style={{ fontSize: 16 }}>{range === 'hoje' ? 'Vendas por hora' : 'Vendas por dia'}</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 200, overflowX: 'auto' }}>
            {series.map(([label, v]) => (
              <div key={label} title={`${label}: ${money(v)}`} style={{ flex: '1 0 22px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                <div style={{ width: '100%', maxWidth: 28, height: `${(v / max) * 100}%`, minHeight: v ? 3 : 0, background: 'var(--secondary)', borderRadius: '4px 4px 0 0' }} />
                <span className="muted" style={{ fontSize: 10 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card" style={{ flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2 style={{ fontSize: 16 }}>Formas de pagamento</h2>
          {Object.entries(r.byMethod).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="spread small"><span>{PAYMENT_LABELS[k]}</span><b>{money(v)}</b></div>
              <div style={{ height: 8, background: 'var(--field)', borderRadius: 4 }}><div style={{ width: `${r.total ? (v / r.total) * 100 : 0}%`, height: '100%', background: 'var(--primary)', borderRadius: 4 }} /></div>
            </div>
          ))}
          {!r.count && <span className="muted small">Sem vendas no período</span>}
        </div>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 16 }}>Produtos mais vendidos</h2>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>#</th><th>Produto</th><th className="right">Quantidade</th><th className="right">Total</th></tr></thead>
            <tbody>{r.top.map((p, i) => <tr key={i}><td>{i + 1}</td><td>{p.name}</td><td className="right">{qtyFmt(p.qty)}</td><td className="right">{money(p.total)}</td></tr>)}</tbody>
          </table>
          {!r.top.length && <div className="empty">Sem vendas no período</div>}
        </div>
      </div>
    </>
  );
}
