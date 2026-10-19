import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Sale, type CashSession } from '../../lib/db';
import { cancelSale, sessionSummary } from '../../lib/pdv';
import { money, dateTime, qtyFmt, dec2, PAYMENT_LABELS, startOfDay, formatCpf } from '../../lib/format';
import { receiptHtml, closingHtml, printHtml } from '../../lib/receipt';
import { Modal } from '../../components/ui';
import { useApp } from '../../lib/app-context';

const toInput = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fromInput = (s: string) => new Date(s + 'T00:00:00').getTime();

export function Vendas() {
  const [from, setFrom] = useState(toInput(startOfDay()));
  const [to, setTo] = useState(toInput(startOfDay()));
  const [sel, setSel] = useState<Sale | null>(null);
  const sales = useLiveQuery(() => db.sales.where('createdAt').between(fromInput(from), fromInput(to) + 86_400_000).filter((s) => !s.deleted).reverse().sortBy('createdAt'), [from, to]);
  const ok = (sales || []).filter((s) => s.status === 'completed');
  return (
    <>
      <div className="page-head"><h1>Vendas</h1>
        <div className="row">
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 170 }} aria-label="De" />
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 170 }} aria-label="Até" />
        </div>
      </div>
      <div className="grid">
        <div className="stat"><span className="muted small">Vendas</span><b>{ok.length}</b></div>
        <div className="stat"><span className="muted small">Total</span><b>{money(ok.reduce((s, x) => s + x.total, 0))}</b></div>
        <div className="stat"><span className="muted small">Canceladas</span><b>{(sales || []).length - ok.length}</b></div>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table className="t" style={{ minWidth: 640 }}>
            <thead><tr><th>Nº</th><th>Data</th><th>Operador</th><th>Pagamento</th><th className="right">Total</th><th></th></tr></thead>
            <tbody>
              {sales?.map((s) => (
                <tr key={s.id} className={'click ' + (s.status === 'canceled' ? 'cut' : '')} onClick={() => setSel(s)}>
                  <td>{s.number}</td><td>{dateTime(s.createdAt)}</td><td>{s.operatorName}</td>
                  <td>{s.payments.map((p) => PAYMENT_LABELS[p.method]).join(' + ')}</td>
                  <td className="right">{money(s.total)}</td>
                  <td>{s.status === 'canceled' && <span className="chip danger">Cancelada</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sales && !sales.length && <div className="empty">Nenhuma venda no período</div>}
        </div>
      </div>
      {sel && <SaleModal sale={sel} onClose={() => setSel(null)} />}
    </>
  );
}

function SaleModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const { user } = useApp();
  return (
    <Modal title={'Venda ' + sale.number} wide onClose={onClose} footer={<>
      {sale.status === 'completed' && user?.role !== 'operador' && (
        <button className="btn danger" style={{ marginRight: 'auto' }} onClick={async () => { if (confirm('Cancelar esta venda? O estoque volta e o fiado é estornado.')) { await cancelSale(sale); onClose(); } }}>Cancelar venda</button>
      )}
      <button className="btn" onClick={onClose}>Fechar</button>
      <button className="btn primary" onClick={async () => printHtml(await receiptHtml(sale))}>Reimprimir cupom</button>
    </>}>
      <div className="row muted small"><span>{dateTime(sale.createdAt)}</span><span>Operador: {sale.operatorName}</span>{sale.cpf && <span>CPF {formatCpf(sale.cpf)}</span>}</div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Produto</th><th>Qtd</th><th>Unit.</th><th className="right">Total</th></tr></thead>
          <tbody>{sale.items.map((i, k) => <tr key={k} className={i.canceled ? 'cut' : ''}><td>{i.description}</td><td>{qtyFmt(i.qty)} {i.unit}</td><td>{dec2(i.unitPrice)}</td><td className="right">{dec2(i.total)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="spread"><span>Subtotal</span><b>{money(sale.subtotal)}</b></div>
      {sale.discount > 0 && <div className="spread"><span>Desconto</span><b>− {money(sale.discount)}</b></div>}
      {sale.payments.map((p, i) => <div key={i} className="spread"><span>{PAYMENT_LABELS[p.method]}{p.installments ? ` ${p.installments}x` : ''}</span><b>{money(p.amount)}</b></div>)}
      {sale.change > 0 && <div className="spread"><span>Troco</span><b>{money(sale.change)}</b></div>}
      <div className="spread" style={{ fontSize: 20 }}><b>Total</b><b>{money(sale.total)}</b></div>
    </Modal>
  );
}

export function Caixas() {
  const sessions = useLiveQuery(() => db.cashSessions.orderBy('openedAt').reverse().filter((s) => !s.deleted).limit(100).toArray(), []);
  return (
    <>
      <div className="page-head"><h1>Caixas</h1></div>
      <div className="card">
        <div className="table-wrap">
          <table className="t" style={{ minWidth: 720 }}>
            <thead><tr><th>Caixa</th><th>Operador</th><th>Abertura</th><th>Fechamento</th><th className="right">Esperado</th><th className="right">Contado</th><th className="right">Diferença</th><th></th></tr></thead>
            <tbody>
              {sessions?.map((s) => <SessionRow key={s.id} s={s} />)}
            </tbody>
          </table>
          {sessions && !sessions.length && <div className="empty">Nenhum caixa aberto ainda</div>}
        </div>
      </div>
    </>
  );
}

function SessionRow({ s }: { s: CashSession }) {
  const diff = s.closedAt ? (s.countedAmount || 0) - (s.expectedCash || 0) : 0;
  return (
    <tr>
      <td>{s.register}</td><td>{s.operatorName}</td><td>{dateTime(s.openedAt)}</td>
      <td>{s.closedAt ? dateTime(s.closedAt) : <span className="chip ok">Aberto</span>}</td>
      <td className="right">{s.closedAt ? money(s.expectedCash || 0) : '—'}</td>
      <td className="right">{s.closedAt ? money(s.countedAmount || 0) : '—'}</td>
      <td className="right">{s.closedAt ? <span className={'chip ' + (Math.abs(diff) < 0.01 ? 'ok' : 'warn')}>{money(diff)}</span> : '—'}</td>
      <td>{s.closedAt && <button className="btn sm" onClick={async () => printHtml(await closingHtml(s, await sessionSummary(s)))}>Imprimir</button>}</td>
    </tr>
  );
}
