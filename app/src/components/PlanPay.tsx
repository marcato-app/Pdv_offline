import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Modal } from './ui';
import { getDevice } from '../lib/db';
import { api } from '../lib/store';
import { saveLicense, confirmPayment, startCheckout, type License } from '../lib/license';
import { getPlatform, IS_NATIVE, type Plan } from '../lib/platform';
import { trackPurchase } from '../lib/tracking';
import { money, dateOnly } from '../lib/format';

// Pagar a assinatura sem sair do app: PIX (QR na tela) ou cartão (campos do Mercado Pago com as cores da loja).

type Tab = 'pix' | 'card';
type Done = { license: License | null; text: string };

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = await getDevice<string | null>('token', null);
  if (!token) throw new Error('Entre na loja com internet antes de assinar');
  return api<T>(path, body === undefined ? { token } : { method: 'POST', token, body: JSON.stringify(body) });
}

const SDK = 'https://sdk.mercadopago.com/js/v2';
let sdkLoad: Promise<void> | null = null;
function loadSdk() {
  sdkLoad ??= new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = SDK;
    s.onload = () => res();
    s.onerror = () => { sdkLoad = null; rej(new Error('Não consegui carregar o pagamento com cartão. Confira a internet.')); };
    document.head.appendChild(s);
  });
  return sdkLoad;
}

export function PlanPayModal({ plan, email: email0, onClose }: { plan: Plan; email: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('pix');
  const [email, setEmail] = useState(email0);
  const [done, setDone] = useState<Done | null>(null);
  const finish = async (license: License | null, text: string, value: number) => {
    if (license) await saveLicense(license);
    trackPurchase(value, plan.name).catch(() => undefined);
    setDone({ license, text });
  };

  return (
    <Modal title={`Plano ${plan.name} · ${money(plan.price)}`} onClose={onClose} wide>
      {done ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', textAlign: 'center', padding: '12px 0' }}>
          <span style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--ok-bg)', color: 'var(--ok)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34, fontWeight: 800 }}>✓</span>
          <h2 style={{ fontSize: 22 }}>Pagamento confirmado!</h2>
          <p style={{ margin: 0 }}>{done.text}</p>
          <button className="btn primary big" onClick={onClose}>Continuar</button>
        </div>
      ) : (
        <>
          <div className="row" role="tablist">
            <button role="tab" aria-selected={tab === 'pix'} className={'btn ' + (tab === 'pix' ? 'secondary' : '')} onClick={() => setTab('pix')}>PIX</button>
            <button role="tab" aria-selected={tab === 'card'} className={'btn ' + (tab === 'card' ? 'secondary' : '')} onClick={() => setTab('card')}>Cartão de crédito</button>
          </div>
          <div className="field" style={{ maxWidth: 420 }}>
            <label htmlFor="ppmail">E-mail para o recibo</label>
            <input id="ppmail" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {tab === 'pix' ? <PixPay plan={plan} email={email} onPaid={finish} /> : <CardPay plan={plan} email={email} onPaid={finish} />}
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={async () => {
            try {
              const url = await startCheckout(plan.id);
              if (IS_NATIVE) window.open(url, '_blank'); else location.assign(url);
            } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
          }}>Prefiro pagar pelo site do Mercado Pago (saldo ou cartão salvo)</button>
        </>
      )}
    </Modal>
  );
}

function PixPay({ plan, email, onPaid }: { plan: Plan; email: string; onPaid: (l: License | null, text: string, value: number) => void }) {
  const [pix, setPix] = useState<{ id: string; qr: string; img: string; expiresAt: number } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  const create = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await call<{ id: string; qr: string; qrBase64: string | null; expiresAt: number }>('/api/billing/pix', { plan: plan.id, email });
      const img = r.qrBase64 ? `data:image/png;base64,${r.qrBase64}` : await QRCode.toDataURL(r.qr, { margin: 1, width: 280 });
      setPix({ id: r.id, qr: r.qr, img, expiresAt: r.expiresAt });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  // Fica conferindo até o PIX cair.
  useEffect(() => {
    if (!pix) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      setNow(Date.now());
      try {
        const r = await call<{ status: string; license: License | null }>(`/api/billing/status?id=${pix.id}`);
        if (r.status === 'approved') { stop = true; onPaid(r.license, `Sua assinatura vale até ${r.license ? dateOnly(r.license.validUntil) : 'o fim do período'}.`, plan.price); return; }
      } catch { /* tenta de novo */ }
      if (!stop) setTimeout(tick, 4000);
    };
    const t = setTimeout(tick, 4000);
    return () => { stop = true; clearTimeout(t); };
  }, [pix]);

  if (!pix) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p className="muted" style={{ margin: 0 }}>Gere o QR Code e pague no app do seu banco. A ativação é na hora.</p>
      {err && <div className="error">{err}</div>}
      <button className="btn primary big" disabled={busy || !email.includes('@')} onClick={create}>{busy ? 'Gerando PIX…' : `Gerar PIX de ${money(plan.price)}`}</button>
    </div>
  );
  const left = Math.max(0, pix.expiresAt - now);
  const expired = left === 0;
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
      <img src={pix.img} alt="QR Code do PIX" width={220} height={220} style={{ borderRadius: 14, border: '1px solid var(--line)', background: '#fff', opacity: expired ? 0.3 : 1 }} />
      <div style={{ flex: '1 1 240px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <b style={{ fontSize: 22 }}>{money(plan.price)}</b>
        <span className="muted small">Abra o app do banco → PIX → Ler QR Code. Ou copie o código:</span>
        <button className="btn secondary" onClick={async () => { try { await navigator.clipboard.writeText(pix.qr); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { prompt('Copie o código PIX:', pix.qr); } }}>{copied ? 'Código copiado!' : 'Copiar código PIX'}</button>
        {expired
          ? <><span className="chip warn">Este PIX venceu.</span><button className="btn" onClick={() => { setPix(null); create(); }}>Gerar outro</button></>
          : <span className="chip"><span className="dot" style={{ animation: 'pulse 1.2s infinite' }} />Esperando o pagamento… vence em {Math.ceil(left / 60_000)} min</span>}
      </div>
    </div>
  );
}

interface BrickData { token: string; issuer_id?: string; payment_method_id: string; installments?: number; payer?: { email?: string; identification?: { type?: string; number?: string } } }
type MPCtor = new (key: string, o: { locale: string }) => { bricks: () => { create: (kind: string, el: string, settings: unknown) => Promise<{ unmount: () => void }> } };

function CardPay({ plan, email, onPaid }: { plan: Plan; email: string; onPaid: (l: License | null, text: string, value: number) => void }) {
  const [auto, setAuto] = useState(true);
  const [err, setErr] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'paying' | 'nokey'>('loading');
  const [pending, setPending] = useState('');
  const ctl = useRef<{ unmount: () => void } | null>(null);
  const emailRef = useRef(email);
  emailRef.current = email;
  const autoRef = useRef(auto);
  autoRef.current = auto;

  const submit = async (d: BrickData) => {
    setErr('');
    setState('paying');
    const body = { plan: plan.id, token: d.token, paymentMethodId: d.payment_method_id, issuerId: d.issuer_id, installments: d.installments, email: emailRef.current || d.payer?.email, docType: d.payer?.identification?.type, docNumber: d.payer?.identification?.number };
    try {
      if (autoRef.current) {
        const r = await call<{ preapprovalId: string; license: License }>('/api/billing/card-subscribe', body);
        // A primeira cobrança sai em instantes: espera até 1 minuto pela confirmação.
        for (let i = 0; i < 12; i++) {
          await new Promise((res) => setTimeout(res, 5000));
          const l = await confirmPayment(undefined, r.preapprovalId).catch(() => null);
          if (l && !('ok' in l && l.ok === false) && l.paidUntil > Date.now()) {
            onPaid(l, `Cobrança automática ativa: o cartão é cobrado sozinho a cada período. Válida até ${dateOnly(l.validUntil)}.`, plan.price);
            return;
          }
        }
        onPaid(r.license, 'Cobrança automática ativada. A primeira cobrança leva alguns minutos; a loja é ativada sozinha assim que ela for aprovada.', plan.price);
      } else {
        const r = await call<{ status: string; id: string; license?: License }>('/api/billing/card', body);
        if (r.status === 'approved') onPaid(r.license || null, `Sua assinatura vale até ${r.license ? dateOnly(r.license.validUntil) : 'o fim do período'}.`, plan.price);
        else { setPending('Pagamento em análise pelo Mercado Pago. Assim que aprovar (normalmente em minutos), a loja é ativada sozinha.'); setState('ready'); }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState('ready');
    }
  };
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = await getPlatform();
      if (!p.mpPublicKey) { setState('nokey'); return; }
      try {
        await loadSdk();
        if (!alive) return;
        const css = getComputedStyle(document.documentElement);
        const MP = (window as unknown as { MercadoPago: MPCtor }).MercadoPago;
        const mp = new MP(p.mpPublicKey, { locale: 'pt-BR' });
        ctl.current = await mp.bricks().create('cardPayment', 'mp-card-brick', {
          initialization: { amount: plan.price, payer: { email: emailRef.current } },
          customization: {
            paymentMethods: { maxInstallments: 1, minInstallments: 1 },
            visual: {
              hideFormTitle: true,
              style: {
                theme: 'default',
                customVariables: {
                  baseColor: css.getPropertyValue('--primary').trim() || '#15803d',
                  buttonTextColor: '#ffffff',
                  borderRadiusLarge: '16px', borderRadiusMedium: '12px', borderRadiusSmall: '10px',
                  formBackgroundColor: '#ffffff', inputBackgroundColor: css.getPropertyValue('--field').trim() || '#f3f1f8',
                  fontSizeMedium: '16px',
                },
              },
              texts: { formSubmit: `Pagar ${money(plan.price)}` },
            },
          },
          callbacks: {
            onReady: () => alive && setState('ready'),
            onSubmit: (d: BrickData) => submitRef.current(d),
            onError: (e: { message?: string }) => { console.error('cartão', e); },
          },
        });
        if (!alive) ctl.current.unmount();
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; ctl.current?.unmount(); ctl.current = null; };
  }, []);

  if (state === 'nokey') return <p className="muted" style={{ margin: 0 }}>O pagamento com cartão dentro do app ainda não foi ligado. Use o PIX ou pague pelo site do Mercado Pago (botão abaixo).</p>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: 12, borderRadius: 14, background: 'var(--field)' }}>
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} style={{ width: 20, height: 20, marginTop: 2, flex: '0 0 auto' }} />
        <span><b>Renovar automaticamente</b><br /><span className="muted small">O cartão é cobrado sozinho a cada período ({money(plan.price)}). Cancele quando quiser em Configurações → Assinatura.</span></span>
      </label>
      {state === 'loading' && <span className="muted">Carregando os campos do cartão…</span>}
      {state === 'paying' && <span className="chip">Processando o pagamento…</span>}
      <div id="mp-card-brick" style={state === 'paying' ? { opacity: 0.5, pointerEvents: 'none' } : undefined} />
      {pending && <span className="chip">{pending}</span>}
      {err && <div className="error">{err}</div>}
      <span className="muted small">Os dados do cartão vão direto e protegidos para o Mercado Pago. O Vision PDV não vê nem guarda o número do cartão.</span>
    </div>
  );
}
