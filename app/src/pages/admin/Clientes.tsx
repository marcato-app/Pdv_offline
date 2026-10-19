import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, save, remove, uid, round2, type Customer, type CreditEntry } from '../../lib/db';
import { money, parseNum, dec2, formatCpf, onlyDigits, dateTime, isValidCpf } from '../../lib/format';
import { Modal } from '../../components/ui';

export function Clientes() {
  const [t, setT] = useState('');
  const [sel, setSel] = useState<string | 'novo' | null>(null);
  const data = useLiveQuery(async () => {
    const cs = await db.customers.filter((c) => !c.deleted).toArray();
    const entries = await db.creditEntries.filter((e) => !e.deleted).toArray();
    const bal: Record<string, number> = {};
    for (const e of entries) bal[e.customerId] = (bal[e.customerId] || 0) + (e.type === 'debit' ? e.amount : -e.amount);
    return cs.sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ ...c, balance: round2(bal[c.id] || 0) }));
  }, []);
  const q = t.trim().toLowerCase();
  const rows = (data || []).filter((c) => !q || c.name.toLowerCase().includes(q) || onlyDigits(c.cpf || '').includes(onlyDigits(q) || '#') || (c.phone || '').includes(q));
  const totalOwed = (data || []).reduce((s, c) => s + Math.max(0, c.balance), 0);

  return (
    <>
      <div className="page-head"><h1>Clientes e crediário</h1><button className="btn primary" onClick={() => setSel('novo')}>+ Novo cliente</button></div>
      <div className="grid">
        <div className="stat"><span className="muted small">Clientes</span><b>{data?.length ?? 0}</b></div>
        <div className="stat" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}><span className="small">Total a receber (fiado)</span><b>{money(totalOwed)}</b></div>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <input className="input" placeholder="Nome, CPF ou telefone" value={t} onChange={(e) => setT(e.target.value)} />
        <div className="table-wrap">
          <table className="t" style={{ minWidth: 600 }}>
            <thead><tr><th>Nome</th><th>CPF</th><th>Telefone</th><th className="right">Limite</th><th className="right">Deve</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="click" onClick={() => setSel(c.id)}>
                  <td>{c.name}</td><td>{c.cpf ? formatCpf(c.cpf) : ''}</td><td>{c.phone}</td>
                  <td className="right">{money(c.creditLimit)}</td>
                  <td className="right">{c.balance > 0 ? <span className="chip warn">{money(c.balance)}</span> : <span className="chip ok">Em dia</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && !rows.length && <div className="empty">Nenhum cliente</div>}
        </div>
      </div>
      {sel && <CustomerModal id={sel === 'novo' ? null : sel} onClose={() => setSel(null)} />}
    </>
  );
}

function CustomerModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [c, setC] = useState<Partial<Customer>>({ name: '', creditLimit: 0 });
  const [limit, setLimit] = useState('0,00');
  const [pay, setPay] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (id) db.customers.get(id).then((x) => { if (x) { setC(x); setLimit(dec2(x.creditLimit)); } });
  }, [id]);
  const entries = useLiveQuery(() => (id ? db.creditEntries.where('customerId').equals(id).filter((e) => !e.deleted).reverse().sortBy('createdAt') : []), [id], [] as CreditEntry[]);
  const balance = round2(entries.reduce((s, e) => s + (e.type === 'debit' ? e.amount : -e.amount), 0));
  const set = (k: keyof Customer, v: unknown) => setC((o) => ({ ...o, [k]: v }));

  const submit = async () => {
    if (!c.name?.trim()) return setErr('Informe o nome');
    if (c.cpf && !isValidCpf(c.cpf)) return setErr('CPF inválido');
    await save<Customer>('customers', { ...c, id: c.id || uid(), name: c.name.trim(), cpf: onlyDigits(c.cpf || '') || undefined, creditLimit: parseNum(limit) } as Customer);
    onClose();
  };
  const receive = async () => {
    const v = parseNum(pay);
    if (!id || v <= 0) return;
    await save<CreditEntry>('creditEntries', { id: uid(), customerId: id, type: 'payment', amount: round2(v), createdAt: Date.now() });
    setPay('');
  };

  return (
    <Modal title={id ? c.name || 'Cliente' : 'Novo cliente'} wide onClose={onClose} footer={<>
      {id && <button className="btn danger" style={{ marginRight: 'auto' }} onClick={async () => { if (confirm('Excluir cliente?')) { await remove('customers', id); onClose(); } }}>Excluir</button>}
      <button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={submit}>Salvar</button>
    </>}>
      <div className="grid">
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="cn">Nome</label><input id="cn" autoFocus value={c.name || ''} onChange={(e) => set('name', e.target.value)} /></div>
        <div className="field"><label htmlFor="cc">CPF</label><input id="cc" inputMode="numeric" value={formatCpf(c.cpf || '')} onChange={(e) => set('cpf', onlyDigits(e.target.value))} /></div>
        <div className="field"><label htmlFor="cp">Telefone / WhatsApp</label><input id="cp" value={c.phone || ''} onChange={(e) => set('phone', e.target.value)} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="ca">Endereço</label><input id="ca" value={c.address || ''} onChange={(e) => set('address', e.target.value)} /></div>
        <div className="field"><label htmlFor="cl">Limite de crediário (0 = sem limite)</label><input id="cl" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></div>
        <div className="field"><label htmlFor="cd">Dia de pagamento</label><input id="cd" inputMode="numeric" value={c.payDay || ''} onChange={(e) => set('payDay', Number(onlyDigits(e.target.value)) || undefined)} /></div>
      </div>
      {err && <div className="error">{err}</div>}
      {id && (
        <>
          <div className="spread" style={{ marginTop: 8 }}>
            <span className={'chip ' + (balance > 0 ? 'warn' : 'ok')} style={{ fontSize: 15, padding: 10 }}>Saldo devedor: {money(balance)}</span>
            <div className="row">
              <input className="input" style={{ width: 140 }} inputMode="decimal" placeholder="Valor" value={pay} onChange={(e) => setPay(e.target.value)} />
              <button className="btn primary" onClick={receive}>Receber pagamento</button>
            </div>
          </div>
          <div className="table-wrap" style={{ maxHeight: 240 }}>
            <table className="t">
              <thead><tr><th>Data</th><th>Lançamento</th><th className="right">Valor</th></tr></thead>
              <tbody>{entries.map((e) => <tr key={e.id}><td>{dateTime(e.createdAt)}</td><td>{e.type === 'debit' ? 'Compra no fiado' : 'Pagamento'}</td><td className="right">{e.type === 'debit' ? '' : '− '}{money(e.amount)}</td></tr>)}</tbody>
            </table>
            {!entries.length && <div className="empty">Sem lançamentos</div>}
          </div>
        </>
      )}
    </Modal>
  );
}
