import { useState } from 'react';
import { Modal } from './ui';
import { useApp } from '../lib/app-context';
import { exportReport, type ReportKind } from '../lib/exportReports';

const toInput = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fromInput = (s: string) => new Date(s + 'T00:00:00').getTime();
const KINDS: [ReportKind, string, string][] = [
  ['boletos', 'Boletos', 'Boleto por boleto: vencimento, fornecedor, valor, se foi pago e quando, linha digitável.'],
  ['vendas', 'Vendas', 'Venda por venda (data, hora, operador, pagamento, valor), item por item e o total de cada dia.'],
  ['custos', 'Custos fixos', 'Aluguel, luz, água, internet, salários e impostos, um por um, e o total de cada custo.'],
  ['tudo', 'Tudo junto', 'Boletos, vendas e custos fixos no mesmo arquivo, cada um numa aba.'],
];

/** Botão "Exportar relatórios" com a janela para escolher o relatório e o período. */
export function ExportReportsButton({ initial = 'tudo', className = 'btn' }: { initial?: ReportKind; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>Exportar relatórios</button>
      {open && <ExportReportsModal initial={initial} onClose={() => setOpen(false)} />}
    </>
  );
}

function ExportReportsModal({ initial, onClose }: { initial: ReportKind; onClose: () => void }) {
  const { store } = useApp();
  const now = new Date();
  const [kind, setKind] = useState<ReportKind>(initial);
  const [de, setDe] = useState(toInput(new Date(now.getFullYear(), now.getMonth(), 1).getTime()));
  const [ate, setAte] = useState(toInput(new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime()));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const preset = (m: number) => { setDe(toInput(new Date(now.getFullYear(), now.getMonth() + m, 1).getTime())); setAte(toInput(new Date(now.getFullYear(), now.getMonth() + m + 1, 0).getTime())); };
  const go = async () => {
    if (!de || !ate || fromInput(de) > fromInput(ate)) return setMsg({ ok: false, text: 'Confira as datas do período.' });
    setBusy(true); setMsg(null);
    try {
      const r = await exportReport(kind, fromInput(de), fromInput(ate), store.name);
      setMsg({ ok: true, text: `Pronto! Baixado: ${r.file}` + (r.count ? '' : ' (não havia lançamentos no período).') });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Não foi possível gerar o relatório.' }); }
    setBusy(false);
  };
  return (
    <Modal title="Exportar relatórios (Excel)" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Fechar</button><button className="btn primary" disabled={busy} onClick={go}>{busy ? 'Gerando…' : 'Baixar planilha'}</button></>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {KINDS.map(([k, t, d]) => (
          <label key={k} data-k={k} className={'xopt' + (kind === k ? ' on' : '')}>
            <input type="radio" name="rk" checked={kind === k} onChange={() => setKind(k)} style={{ marginTop: 4 }} />
            <span className="xt"><b>{t}</b><span className="muted small">{d}</span></span>
          </label>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn sm" onClick={() => preset(0)}>Este mês</button>
        <button className="btn sm" onClick={() => preset(-1)}>Mês passado</button>
      </div>
      <div className="row">
        <div className="field" style={{ flex: 1 }}><label htmlFor="xde">De</label><input id="xde" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div className="field" style={{ flex: 1 }}><label htmlFor="xate">Até</label><input id="xate" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
      </div>
      {msg && <span className={msg.ok ? 'chip ok' : 'error'} style={{ padding: 10 }}>{msg.text}</span>}
    </Modal>
  );
}
