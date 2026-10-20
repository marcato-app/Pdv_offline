import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLicense, activateKey, startCheckout, confirmPayment, STATUS_LABEL, type License } from '../lib/license';
import { getPlatform, IS_NATIVE, whatsLink, type PlatformInfo } from '../lib/platform';
import { money } from '../lib/format';
import { dateOnly } from '../lib/format';
import { useApp } from '../lib/app-context';
import { canManage } from '../lib/auth';
import { Logo } from './ui';

/** Faixa no topo avisando o teste grátis ou o vencimento próximo. */
export function LicenseBanner() {
  const lic = useLicense();
  const { user } = useApp();
  if (!lic) return null;
  const soon = lic.status === 'trial' || (lic.status === 'active' && lic.daysLeft <= 5);
  if (!soon) return null;
  const text = lic.status === 'trial'
    ? `Teste grátis: ${lic.daysLeft === 1 ? 'falta 1 dia' : `faltam ${lic.daysLeft} dias`}`
    : `Sua assinatura vence em ${lic.daysLeft} ${lic.daysLeft === 1 ? 'dia' : 'dias'}`;
  return (
    <div className="spread" style={{ background: lic.daysLeft <= 2 ? 'var(--warn-bg)' : 'var(--secondary-soft)', color: lic.daysLeft <= 2 ? 'var(--warn)' : 'var(--secondary-dark)', borderRadius: 16, padding: '10px 16px', fontWeight: 700, fontSize: 14 }}>
      <span>{text}</span>
      {canManage(user) && <Link className="btn sm secondary" to="/config?aba=assinatura">Ativar agora</Link>}
    </div>
  );
}

export function ActivateBox({ lic }: { lic: License | null }) {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [plat, setPlat] = useState<PlatformInfo | null>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => { getPlatform().then(setPlat); }, []);

  // Voltou do Mercado Pago com o número do pagamento: confere e ativa na hora.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const pid = q.get('payment_id') || q.get('collection_id');
    if (!pid) return;
    const st = q.get('status') || q.get('collection_status');
    history.replaceState(null, '', location.pathname + '?aba=assinatura');
    if (st === 'rejected' || st === 'null') { setMsg({ ok: false, text: 'O pagamento não foi aprovado. Tente de novo ou use outra forma.' }); return; }
    setMsg({ ok: true, text: 'Conferindo o pagamento…' });
    confirmPayment(pid).then((r) => {
      if (r && 'ok' in r && r.ok === false) setMsg({ ok: true, text: ['pending', 'in_process'].includes(String(r.status)) ? 'Pagamento em análise. A ativação acontece sozinha assim que for aprovado.' : 'Pagamento ainda não aprovado. Assim que aprovar, a ativação é automática.' });
      else if (r && r.paidUntil > Date.now()) setMsg({ ok: true, text: `Pagamento aprovado! Assinatura válida até ${dateOnly(r.validUntil)}.` });
      else setMsg({ ok: true, text: 'Pagamento ainda não confirmado. Assim que aprovar, a ativação é automática.' });
    }).catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  }, []);

  const buy = async (plan: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const url = await startCheckout(plan);
      if (IS_NATIVE) { window.open(url, '_blank'); setOpened(true); setBusy(false); }
      else location.assign(url);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
      setBusy(false);
    }
  };
  const check = async () => {
    setBusy(true);
    try {
      const r = await confirmPayment();
      if (r && !('ok' in r && r.ok === false) && r.paidUntil > Date.now()) setMsg({ ok: true, text: `Assinatura ativa até ${dateOnly(r.validUntil)}.` });
      else setMsg({ ok: false, text: 'Ainda não recebemos o pagamento. Se já pagou, aguarde um minuto e tente de novo.' });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    setBusy(false);
  };
  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const l = await activateKey(code);
      setMsg({ ok: true, text: `Pronto! ${l.added} dias adicionados. Válida até ${dateOnly(l.validUntil)}.` });
      setCode('');
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {plat?.checkout && (
        <>
          <div className="grid">
            {plat.plans.map((pl) => (
              <div key={pl.id} className="stat" style={pl.highlight ? { outline: '2px solid var(--primary)' } : undefined}>
                <span className="muted small">Plano {pl.name}{pl.highlight ? ` · ${pl.highlight}` : ''}</span>
                <b>{money(pl.price)}</b>
                <span className="muted small">{pl.days} dias de uso</span>
                <button className={'btn ' + (pl.highlight ? 'primary' : 'secondary')} disabled={busy} onClick={() => buy(pl.id)}>Assinar {pl.name.toLowerCase()}</button>
              </div>
            ))}
          </div>
          <span className="muted small">Pague com PIX, cartão ou boleto pelo Mercado Pago. A ativação é automática.</span>
          {opened && <button className="btn" disabled={busy} onClick={check}>Já paguei: verificar agora</button>}
        </>
      )}
      {!plat?.checkout && lic?.checkoutUrl && (
        <a className="btn primary big" href={lic.checkoutUrl} target="_blank" rel="noreferrer">Comprar ativação</a>
      )}
      {!plat?.checkout && plat?.supportWhatsApp && (
        <a className="btn primary" href={whatsLink(plat.supportWhatsApp, 'Olá! Quero assinar o Vision PDV.')} target="_blank" rel="noreferrer">Assinar pelo WhatsApp</a>
      )}
      <div className="field">
        <label htmlFor="actk">Tenho uma chave de ativação</label>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input id="actk" className="input" placeholder="VPDV-XXXX-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && submit()} />
          <button className="btn secondary" disabled={busy || code.length < 10} onClick={submit}>Ativar</button>
        </div>
      </div>
      {msg && <span className={'chip ' + (msg.ok ? 'ok' : 'danger')} style={{ padding: 10 }}>{msg.text}</span>}
    </div>
  );
}

export function LicenseSummary({ lic }: { lic: License | null }) {
  if (!lic) return <span className="muted">Situação ainda não verificada. Conecte à internet.</span>;
  const tone = lic.status === 'active' ? 'ok' : lic.status === 'trial' ? '' : 'danger';
  return (
    <div className="grid">
      <div className="stat"><span className="muted small">Situação</span><b><span className={'chip ' + tone} style={{ fontSize: 16 }}>{STATUS_LABEL[lic.status]}</span></b></div>
      <div className="stat"><span className="muted small">Válida até</span><b>{dateOnly(lic.validUntil)}</b></div>
      <div className="stat"><span className="muted small">Dias restantes</span><b>{lic.daysLeft}</b></div>
    </div>
  );
}

/** Tela que aparece no caixa quando a licença venceu. Os dados continuam salvos. */
export function ExpiredScreen() {
  const lic = useLicense();
  const { store, user, setUser } = useApp();
  return (
    <div className="overlay" style={{ background: 'var(--bg)' }}>
      <div className="modal">
        <div className="modal-head"><div className="row"><Logo /><h2 style={{ fontSize: 20, fontWeight: 800 }}>{store.name}</h2></div></div>
        <div className="modal-body">
          <h2 style={{ fontSize: 24 }}>{lic?.status === 'blocked' ? 'Loja bloqueada' : lic?.status === 'expired' && lic.paidUntil === 0 ? 'Seu teste grátis terminou' : 'Sua assinatura venceu'}</h2>
          <p className="muted" style={{ margin: 0 }}>
            {lic?.status === 'blocked'
              ? 'Fale com o suporte do Vision PDV.'
              : 'Seus produtos, vendas e clientes continuam salvos. Ative para voltar a vender.'}
          </p>
          {lic?.status !== 'blocked' && (canManage(user) ? <ActivateBox lic={lic || null} /> : <p style={{ margin: 0 }}>Peça para o administrador da loja ativar o sistema.</p>)}
        </div>
        <div className="modal-foot">
          {canManage(user) && <Link className="btn" to="/painel">Ir para a gestão</Link>}
          <button className="btn" onClick={() => { setUser(null); location.assign(location.pathname.replace(/\/pdv.*$/, '/login')); }}>Sair</button>
        </div>
      </div>
    </div>
  );
}
