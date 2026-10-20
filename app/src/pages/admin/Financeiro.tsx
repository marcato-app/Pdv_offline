import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, save, remove, uid, round2, type Bill, type BillCategory } from '../../lib/db';
import { money, parseNum, dec2, dateOnly, startOfDay } from '../../lib/format';
import { Modal } from '../../components/ui';

export const BILL_CATEGORIES: Record<BillCategory, string> = {
  boleto: 'Boleto',
  fornecedor: 'Fornecedor',
  custo_fixo: 'Custo fixo (aluguel, luz, água, internet)',
  salario: 'Salário',
  imposto: 'Imposto',
  outro: 'Outro',
};
const SHORT: Record<BillCategory, string> = { boleto: 'Boleto', fornecedor: 'Fornecedor', custo_fixo: 'Custo fixo', salario: 'Salário', imposto: 'Imposto', outro: 'Outro' };

const toInput = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fromInput = (s: string) => new Date(s + 'T00:00:00').getTime();
const monthStart = (y: number, m: number) => new Date(y, m, 1).getTime();

type Filter = 'abertas' | 'vencidas' | 'pagas' | 'todas';

export function Financeiro() {
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [filter, setFilter] = useState<Filter>('abertas');
  const [edit, setEdit] = useState<Bill | 'novo' | null>(null);
  const [paying, setPaying] = useState<Bill | null>(null);
  const start = monthStart(ym.y, ym.m);
  const end = monthStart(ym.y, ym.m + 1);
  const today = startOfDay();

  const data = useLiveQuery(async () => {
    const bills = await db.bills.where('dueDate').between(start, end, true, false).filter((b) => !b.deleted).toArray();
    const overdueAll = await db.bills.where('dueDate').below(today).filter((b) => !b.deleted && !b.paidAt).toArray();
    const sales = await db.sales.where('createdAt').between(start, end, true, false).filter((s) => !s.deleted && s.status === 'completed').toArray();
    return { bills: bills.sort((a, b) => a.dueDate - b.dueDate), overdueAll, revenue: sales.reduce((s, x) => s + x.total, 0) };
  }, [start, end, today]);

  if (!data) return null;
  const open = data.bills.filter((b) => !b.paidAt);
  const paid = data.bills.filter((b) => b.paidAt);
  const toPay = open.reduce((s, b) => s + b.amount, 0);
  const paidSum = paid.reduce((s, b) => s + (b.paidAmount ?? b.amount), 0);
  const expenses = data.bills.reduce((s, b) => s + (b.paidAt ? b.paidAmount ?? b.amount : b.amount), 0);
  const overdue = data.overdueAll;
  const shown = (filter === 'vencidas' ? overdue : data.bills).filter((b) => filter === 'todas' || filter === 'vencidas' || (filter === 'pagas' ? b.paidAt : !b.paidAt));
  const label = new Date(ym.y, ym.m, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const move = (d: number) => setYm(({ y, m }) => { const x = new Date(y, m + d, 1); return { y: x.getFullYear(), m: x.getMonth() }; });

  return (
    <>
      <div className="page-head">
        <h1>Financeiro</h1>
        <div className="row">
          <SalaryButton month={start} />
          <button className="btn primary" onClick={() => setEdit('novo')}>+ Nova conta</button>
        </div>
      </div>
      <div className="row">
        <button className="btn sm" aria-label="Mês anterior" onClick={() => move(-1)}>‹</button>
        <b style={{ minWidth: 160, textAlign: 'center', textTransform: 'capitalize' }}>{label}</b>
        <button className="btn sm" aria-label="Próximo mês" onClick={() => move(1)}>›</button>
      </div>
      {overdue.length > 0 && <div className="chip danger" style={{ padding: 12, fontSize: 14 }}>{overdue.length} {overdue.length === 1 ? 'conta vencida' : 'contas vencidas'} sem pagamento: {money(overdue.reduce((s, b) => s + b.amount, 0))}</div>}
      <div className="grid">
        <div className="stat"><span className="muted small">Vendas no mês</span><b>{money(data.revenue)}</b></div>
        <div className="stat" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}><span className="small">A pagar no mês</span><b>{money(toPay)}</b></div>
        <div className="stat"><span className="muted small">Já pago no mês</span><b>{money(paidSum)}</b></div>
        <div className="stat" style={{ background: data.revenue - expenses >= 0 ? 'var(--ok-bg)' : 'var(--danger-bg)', color: data.revenue - expenses >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
          <span className="small">Resultado do mês (vendas − contas)</span><b>{money(data.revenue - expenses)}</b>
        </div>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="row">
          {(['abertas', 'vencidas', 'pagas', 'todas'] as Filter[]).map((f) => (
            <button key={f} className={'btn sm ' + (filter === f ? 'secondary' : '')} onClick={() => setFilter(f)}>{{ abertas: 'A pagar', vencidas: 'Vencidas', pagas: 'Pagas', todas: 'Todas' }[f]}</button>
          ))}
        </div>
        <div className="table-wrap">
          <table className="t" style={{ minWidth: 760 }}>
            <thead><tr><th>Vencimento</th><th>Descrição</th><th>Tipo</th><th>Fornecedor</th><th className="right">Valor</th><th>Situação</th><th></th></tr></thead>
            <tbody>{shown.map((b) => {
              const late = !b.paidAt && b.dueDate < today;
              const isToday = !b.paidAt && b.dueDate === today;
              return (
                <tr key={b.id} className="click" onClick={() => setEdit(b)}>
                  <td>{dateOnly(b.dueDate)}</td>
                  <td>{b.description}{b.recurring && <span className="chip" style={{ marginLeft: 6 }}>Todo mês</span>}</td>
                  <td>{SHORT[b.category]}</td>
                  <td>{b.supplier}</td>
                  <td className="right">{money(b.paidAt ? b.paidAmount ?? b.amount : b.amount)}</td>
                  <td>{b.paidAt ? <span className="chip ok">Pago {dateOnly(b.paidAt)}</span> : late ? <span className="chip danger">Vencido</span> : isToday ? <span className="chip warn">Vence hoje</span> : <span className="chip">A pagar</span>}</td>
                  <td className="right" onClick={(e) => e.stopPropagation()}>
                    {!b.paidAt
                      ? <button className="btn sm primary" onClick={() => setPaying(b)}>Pagar</button>
                      : <button className="btn sm ghost" onClick={() => save<Bill>('bills', { ...b, paidAt: undefined, paidAmount: undefined })}>Desfazer</button>}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
          {!shown.length && <div className="empty">Nada aqui</div>}
        </div>
      </div>
      {edit && <BillModal bill={edit === 'novo' ? null : edit} onClose={() => setEdit(null)} />}
      {paying && <PayModal bill={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

function BillModal({ bill, onClose }: { bill: Bill | null; onClose: () => void }) {
  const employees = useLiveQuery(() => db.users.filter((u) => !u.deleted && !!u.active).toArray(), [], []);
  const [desc, setDesc] = useState(bill?.description || '');
  const [cat, setCat] = useState<BillCategory>(bill?.category || 'boleto');
  const [supplier, setSupplier] = useState(bill?.supplier || '');
  const [amount, setAmount] = useState(bill ? dec2(bill.amount) : '');
  const [due, setDue] = useState(toInput(bill?.dueDate || startOfDay()));
  const [code, setCode] = useState(bill?.barcode || '');
  const [notes, setNotes] = useState(bill?.notes || '');
  const [emp, setEmp] = useState(bill?.employeeId || '');
  const [repeat, setRepeat] = useState(bill ? 0 : 1);
  const [err, setErr] = useState('');

  const submit = async () => {
    const v = parseNum(amount);
    if (!desc.trim()) return setErr('Informe a descrição');
    if (v <= 0) return setErr('Informe o valor');
    const base = { description: desc.trim(), category: cat, supplier: supplier.trim() || undefined, amount: round2(v), barcode: code.trim() || undefined, notes: notes.trim() || undefined, employeeId: emp || undefined };
    if (bill) {
      await save<Bill>('bills', { ...bill, ...base, dueDate: fromInput(due) });
    } else {
      const seriesId = repeat > 1 ? uid() : undefined;
      const d0 = new Date(due + 'T00:00:00');
      for (let k = 0; k < Math.max(1, repeat); k++) {
        const d = new Date(d0.getFullYear(), d0.getMonth() + k, 1);
        // Mantém o mesmo dia do mês; em meses mais curtos, usa o último dia.
        const last = new Date(d0.getFullYear(), d0.getMonth() + k + 1, 0).getDate();
        d.setDate(Math.min(d0.getDate(), last));
        await save<Bill>('bills', { id: uid(), ...base, dueDate: d.getTime(), recurring: repeat > 1 ? 'mensal' : undefined, seriesId });
      }
    }
    onClose();
  };

  return (
    <Modal title={bill ? 'Editar conta' : 'Nova conta a pagar'} wide onClose={onClose} footer={<>
      {bill && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={async () => { if (confirm('Excluir esta conta?')) { await remove('bills', bill.id); onClose(); } }}>Excluir</button>}
      <button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn primary" onClick={submit}>Salvar</button>
    </>}>
      <div className="grid">
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="bd">Descrição</label><input id="bd" autoFocus placeholder="ex.: Conta de luz, Aluguel, Boleto Distribuidora" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        <div className="field"><label htmlFor="bc">Tipo</label><select id="bc" value={cat} onChange={(e) => setCat(e.target.value as BillCategory)}>{Object.entries(BILL_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="bv">Valor</label><input id="bv" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label htmlFor="bdue">Vencimento</label><input id="bdue" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
        {cat === 'salario'
          ? <div className="field"><label htmlFor="be">Funcionário</label><select id="be" value={emp} onChange={(e) => { setEmp(e.target.value); const u = employees.find((x) => x.id === e.target.value); if (u) { if (!desc) setDesc(`Salário ${u.name}`); if (u.salary && !amount) setAmount(dec2(u.salary)); } }}><option value="">—</option>{employees.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
          : <div className="field"><label htmlFor="bs">Fornecedor / favorecido</label><input id="bs" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></div>}
        {(cat === 'boleto' || cat === 'fornecedor' || cat === 'imposto') && <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="bb">Linha digitável do boleto</label><input id="bb" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></div>}
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="bn">Observação</label><input id="bn" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        {!bill && (
          <div className="field"><label htmlFor="br">Repetir</label>
            <select id="br" value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
              <option value={1}>Só esta vez</option><option value={3}>Todo mês por 3 meses</option><option value={6}>Todo mês por 6 meses</option><option value={12}>Todo mês por 12 meses</option><option value={24}>Todo mês por 24 meses</option>
            </select>
          </div>
        )}
      </div>
      {code && <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navigator.clipboard?.writeText(code.replace(/\D/g, ''))}>Copiar linha digitável</button>}
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}

function PayModal({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const [v, setV] = useState(dec2(bill.amount));
  const [d, setD] = useState(toInput(startOfDay()));
  const ok = async () => {
    await save<Bill>('bills', { ...bill, paidAt: fromInput(d) + 12 * 3600_000, paidAmount: round2(parseNum(v)) });
    onClose();
  };
  return (
    <Modal title={'Pagar · ' + bill.description} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={ok}>Confirmar pagamento</button></>}>
      <div className="grid">
        <div className="field"><label htmlFor="pv">Valor pago (com juros ou desconto)</label><input id="pv" autoFocus inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} /></div>
        <div className="field"><label htmlFor="pd">Data do pagamento</label><input id="pd" type="date" value={d} onChange={(e) => setD(e.target.value)} /></div>
      </div>
    </Modal>
  );
}

/** Cria as contas de salário do mês para todos os funcionários com salário cadastrado. */
function SalaryButton({ month }: { month: number }) {
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(5);
  const [msg, setMsg] = useState('');
  const run = async () => {
    const users = await db.users.filter((u) => !u.deleted && !!u.active && !!u.salary).toArray();
    const m = new Date(month);
    const due = new Date(m.getFullYear(), m.getMonth(), Math.min(day, new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate())).getTime();
    const existing = await db.bills.where('dueDate').between(month, new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime()).filter((b) => !b.deleted && b.category === 'salario').toArray();
    let n = 0;
    for (const u of users) {
      if (existing.some((b) => b.employeeId === u.id)) continue;
      await save<Bill>('bills', { id: uid(), description: `Salário ${u.name}`, category: 'salario', amount: u.salary!, dueDate: due, employeeId: u.id });
      n++;
    }
    setMsg(n ? `${n} ${n === 1 ? 'salário lançado' : 'salários lançados'}` : 'Nenhum salário novo (cadastre o salário em Funcionários)');
  };
  return (
    <>
      <button className="btn" onClick={() => { setOpen(true); setMsg(''); }}>Lançar salários do mês</button>
      {open && (
        <Modal title="Lançar salários do mês" onClose={() => setOpen(false)} footer={<><button className="btn" onClick={() => setOpen(false)}>Fechar</button><button className="btn primary" onClick={run}>Lançar</button></>}>
          <p style={{ margin: 0 }}>Cria uma conta de salário para cada funcionário que tem salário no cadastro. Quem já tem salário lançado neste mês é ignorado.</p>
          <div className="field"><label htmlFor="sd">Dia do pagamento</label><input id="sd" inputMode="numeric" value={day} onChange={(e) => setDay(Math.max(1, Math.min(31, Number(e.target.value.replace(/\D/g, '')) || 1)))} /></div>
          {msg && <span className="chip ok">{msg}</span>}
        </Modal>
      )}
    </>
  );
}
