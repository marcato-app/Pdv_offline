import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { money } from '../lib/format';
import { payApi } from '../lib/payments';
import { pixCode, type PixKey } from '../lib/pix';

type Kind = 'pix-mp' | 'pix-static' | 'point';

/**
 * Painel que cobra o cliente fora do sistema (PIX ou maquininha) e espera a confirmação.
 * - pix-mp: QR do Mercado Pago; a venda fecha sozinha quando o PIX cai.
 * - pix-static: QR da chave da loja (funciona offline); o operador confirma.
 * - point: valor enviado para a maquininha Mercado Pago Point; fecha quando o cartão é aprovado.
 */
export function ExternalPay({ kind, amount, refId, pixKey, cardType, installments, onApproved, onCancel }: {
  kind: Kind; amount: number; refId: string; pixKey?: PixKey | null;
  cardType?: 'credit_card' | 'debit_card'; installments?: number;
  onApproved: (ref?: string) => void; onCancel: () => void;
}) {
  const [qr, setQr] = useState('');
  const [copy, setCopy] = useState('');
  const [status, setStatus] = useState('Gerando cobrança…');
  const [err, setErr] = useState('');
  const idRef = useRef<string | null>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;
    const finish = (ref?: string) => { if (!doneRef.current) { doneRef.current = true; onApproved(ref); } };
    (async () => {
      try {
        if (kind === 'pix-static') {
          const code = pixCode(pixKey!, amount, refId.replace(/-/g, '').slice(0, 25));
          setCopy(code);
          setQr(await QRCode.toDataURL(code, { margin: 1, width: 280 }));
          setStatus('Mostre o QR ao cliente e confirme quando o PIX cair na conta.');
          return;
        }
        if (kind === 'pix-mp') {
          const r = await payApi<{ id: string; qrCode: string; qrBase64: string }>('/api/pix/create', { amount, ref: refId, description: 'Compra' });
          if (!alive) return;
          idRef.current = r.id;
          setCopy(r.qrCode);
          setQr(r.qrBase64 ? `data:image/png;base64,${r.qrBase64}` : await QRCode.toDataURL(r.qrCode, { margin: 1, width: 280 }));
          setStatus('Aguardando o pagamento…');
          timer = setInterval(async () => {
            try {
              const s = await payApi<{ approved: boolean; status: string }>(`/api/pix/status/${r.id}`);
              if (s.approved) { clearInterval(timer!); setStatus('PIX recebido!'); finish(r.id); }
              else if (['cancelled', 'rejected', 'expired'].includes(s.status)) { clearInterval(timer!); setErr('PIX cancelado ou expirado'); }
            } catch { /* tenta de novo */ }
          }, 2500);
          return;
        }
        // Maquininha
        const r = await payApi<{ id: string }>('/api/point/create', { amount, ref: refId, type: cardType, installments });
        if (!alive) return;
        idRef.current = r.id;
        setStatus('Valor enviado para a maquininha. Peça para o cliente passar o cartão.');
        timer = setInterval(async () => {
          try {
            const s = await payApi<{ approved: boolean; failed: boolean; state: string }>(`/api/point/status/${r.id}`);
            if (s.approved) { clearInterval(timer!); setStatus('Cartão aprovado!'); finish(r.id); }
            else if (s.failed) { clearInterval(timer!); setErr('Pagamento não aprovado na maquininha'); }
            else if (s.state === 'PROCESSING') setStatus('Processando o cartão…');
          } catch { /* tenta de novo */ }
        }, 2500);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { alive = false; if (timer) clearInterval(timer); };
  }, []);

  const cancel = async () => {
    if (idRef.current && !doneRef.current) {
      const path = kind === 'point' ? `/api/point/cancel/${idRef.current}` : `/api/pix/cancel/${idRef.current}`;
      payApi(path, {}).catch(() => undefined);
    }
    onCancel();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
      <b style={{ fontSize: 26 }}>{money(amount)}</b>
      {kind !== 'point' && (qr ? <img src={qr} alt="QR Code PIX" style={{ width: 260, height: 260, background: '#fff', borderRadius: 12 }} /> : <div className="photo" style={{ width: 260, height: 260 }}>Gerando QR…</div>)}
      {kind === 'point' && <div className="photo" style={{ width: 260, height: 160, fontSize: 16 }}>Maquininha Mercado Pago</div>}
      {!err && <span className={'chip ' + (doneRef.current ? 'ok' : '')} style={{ padding: 10, fontSize: 14 }}>{status}</span>}
      {err && <span className="chip danger" style={{ padding: 10, fontSize: 14 }}>{err}</span>}
      {copy && <button className="btn sm ghost" onClick={() => navigator.clipboard?.writeText(copy)}>Copiar código PIX (copia e cola)</button>}
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn" onClick={cancel}>Voltar</button>
        {(kind === 'pix-static' || err) && <button className="btn primary" onClick={() => { doneRef.current = true; onApproved(); }}>Recebi o pagamento</button>}
      </div>
      {kind !== 'pix-static' && !err && <span className="muted small">Se o cliente já pagou e a tela não mudou, espere alguns segundos.</span>}
    </div>
  );
}
