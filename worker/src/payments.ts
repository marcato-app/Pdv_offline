// Pagamentos integrados da loja:
// - PIX com QR na tela e baixa automática (Mercado Pago)
// - Maquininha Mercado Pago Point: o valor vai sozinho para a maquininha
// As credenciais de cada loja ficam só no servidor (tabela store_secrets), nunca nos aparelhos.

import type { Env } from './index';
import { json } from './util';

export interface Secrets {
  mpAccessToken?: string;
  mpPointDeviceId?: string;
  pixPayerEmail?: string;
  whatsapp?: {
    provider?: 'meta' | 'zapi' | 'evolution';
    to?: string[]; // números que recebem o resumo (com DDD)
    hour?: number; // hora do resumo diário (0-23, horário de Brasília)
    metaToken?: string;
    metaPhoneId?: string;
    metaTemplate?: string;
    zapiInstance?: string;
    zapiToken?: string;
    zapiClientToken?: string;
    evolutionUrl?: string;
    evolutionKey?: string;
    evolutionInstance?: string;
  };
}

export async function getSecrets(env: Env, storeId: string): Promise<Secrets> {
  const row = await env.DB.prepare('SELECT data FROM store_secrets WHERE store_id = ?').bind(storeId).first<{ data: string }>();
  return row ? JSON.parse(row.data) : {};
}

async function putSecrets(env: Env, storeId: string, s: Secrets) {
  await env.DB.prepare('INSERT INTO store_secrets (store_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (store_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .bind(storeId, JSON.stringify(s), Date.now()).run();
}

const mask = (v?: string) => (v ? '••••' + v.slice(-4) : null);

function publicView(s: Secrets) {
  const w = s.whatsapp || {};
  return {
    mercadoPago: !!s.mpAccessToken,
    mpAccessToken: mask(s.mpAccessToken),
    mpPointDeviceId: s.mpPointDeviceId || null,
    pixPayerEmail: s.pixPayerEmail || null,
    whatsapp: {
      provider: w.provider || null,
      to: w.to || [],
      hour: w.hour ?? 20,
      configured: !!(w.provider && ((w.provider === 'meta' && w.metaToken && w.metaPhoneId) || (w.provider === 'zapi' && w.zapiInstance && w.zapiToken) || (w.provider === 'evolution' && w.evolutionUrl && w.evolutionKey && w.evolutionInstance))),
      metaPhoneId: w.metaPhoneId || null,
      metaTemplate: w.metaTemplate || null,
      zapiInstance: w.zapiInstance || null,
      evolutionUrl: w.evolutionUrl || null,
      evolutionInstance: w.evolutionInstance || null,
    },
  };
}

export async function secretsApi(req: Request, env: Env, url: URL, storeId: string): Promise<Response | null> {
  if (url.pathname !== '/api/secrets') return null;
  if (req.method === 'GET') return json(publicView(await getSecrets(env, storeId)));
  if (req.method === 'PUT') {
    const patch = await req.json<Secrets>();
    const cur = await getSecrets(env, storeId);
    const next: Secrets = { ...cur };
    // Campo vazio ("") apaga; campo ausente mantém.
    for (const k of ['mpAccessToken', 'mpPointDeviceId', 'pixPayerEmail'] as const) {
      if (k in patch) next[k] = (patch[k] || '').trim() || undefined;
    }
    if (patch.whatsapp) {
      const w = { ...(cur.whatsapp || {}) } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch.whatsapp)) w[k] = typeof v === 'string' ? v.trim() || undefined : v;
      next.whatsapp = w as Secrets['whatsapp'];
    }
    await putSecrets(env, storeId, next);
    return json(publicView(next));
  }
  return null;
}

async function mp(token: string, path: string, init?: RequestInit) {
  const r = await fetch('https://api.mercadopago.com' + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const text = await r.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text); } catch { /* resposta vazia */ }
  if (!r.ok) {
    const msg = (data.message as string) || (data.error as string) || `Mercado Pago respondeu ${r.status}`;
    throw new Error(r.status === 401 ? 'Token do Mercado Pago inválido. Confira em Configurações › Pagamentos.' : msg);
  }
  return data;
}

export async function paymentsApi(req: Request, env: Env, url: URL, storeId: string): Promise<Response | null> {
  const p = url.pathname;
  if (!p.startsWith('/api/pix/') && !p.startsWith('/api/point/')) return null;
  const s = await getSecrets(env, storeId);
  if (!s.mpAccessToken) return json({ error: 'Mercado Pago não configurado. Vá em Configurações › Pagamentos.' }, 400);
  const tk = s.mpAccessToken;

  // ---------- PIX ----------
  if (p === '/api/pix/create' && req.method === 'POST') {
    const b = await req.json<{ amount?: number; description?: string; ref?: string }>();
    const amount = Math.round((Number(b.amount) || 0) * 100) / 100;
    if (amount <= 0) return json({ error: 'Valor inválido' }, 400);
    const ref = String(b.ref || crypto.randomUUID()).slice(0, 64);
    const d = await mp(tk, '/v1/payments', {
      method: 'POST',
      headers: { 'x-idempotency-key': `${storeId}-${ref}` },
      body: JSON.stringify({
        transaction_amount: amount,
        description: (b.description || 'Compra').slice(0, 120),
        payment_method_id: 'pix',
        external_reference: `${storeId}:${ref}`,
        date_of_expiration: new Date(Date.now() + 30 * 60_000).toISOString().replace('Z', '-00:00'),
        payer: { email: s.pixPayerEmail || 'cliente@visionpdv.com.br' },
      }),
    });
    const td = ((d.point_of_interaction as Record<string, unknown>)?.transaction_data || {}) as Record<string, string>;
    return json({ id: String(d.id), status: d.status, qrCode: td.qr_code, qrBase64: td.qr_code_base64 });
  }
  let m = p.match(/^\/api\/pix\/status\/(\d+)$/);
  if (m && req.method === 'GET') {
    const d = await mp(tk, `/v1/payments/${m[1]}`);
    if (!String(d.external_reference || '').startsWith(storeId + ':')) return json({ error: 'Pagamento não é desta loja' }, 403);
    return json({ id: m[1], status: d.status, approved: d.status === 'approved' });
  }
  m = p.match(/^\/api\/pix\/cancel\/(\d+)$/);
  if (m && req.method === 'POST') {
    await mp(tk, `/v1/payments/${m[1]}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) }).catch(() => undefined);
    return json({ ok: true });
  }

  // ---------- Maquininha Mercado Pago Point ----------
  if (p === '/api/point/devices' && req.method === 'GET') {
    const d = await mp(tk, '/point/integration-api/devices');
    const list = ((d.devices as Record<string, string>[]) || []).map((x) => ({ id: x.id, mode: x.operating_mode, store: x.store_id, pos: x.pos_id }));
    return json({ devices: list });
  }
  if (p === '/api/point/create' && req.method === 'POST') {
    const b = await req.json<{ amount?: number; ref?: string; type?: 'credit_card' | 'debit_card'; installments?: number }>();
    const device = s.mpPointDeviceId;
    if (!device) return json({ error: 'Escolha a maquininha em Configurações › Pagamentos' }, 400);
    const cents = Math.round((Number(b.amount) || 0) * 100);
    if (cents < 100) return json({ error: 'Valor mínimo na maquininha: R$ 1,00' }, 400);
    const body: Record<string, unknown> = { amount: cents, additional_info: { external_reference: `${storeId}:${b.ref || ''}`.slice(0, 64), print_on_terminal: true } };
    if (b.type) body.payment = { type: b.type, ...(b.type === 'credit_card' ? { installments: Math.max(1, Number(b.installments) || 1), installments_cost: 'seller' } : {}) };
    const d = await mp(tk, `/point/integration-api/devices/${encodeURIComponent(device)}/payment-intents`, { method: 'POST', body: JSON.stringify(body) });
    return json({ id: d.id });
  }
  m = p.match(/^\/api\/point\/status\/([\w-]+)$/);
  if (m && req.method === 'GET') {
    const d = await mp(tk, `/point/integration-api/payment-intents/${m[1]}`);
    const state = String(d.state || '');
    let approved = false;
    const payId = (d.payment as Record<string, unknown>)?.id;
    if (state === 'FINISHED' && payId) {
      const pay = await mp(tk, `/v1/payments/${payId}`).catch(() => null);
      approved = pay?.status === 'approved';
    }
    return json({ id: m[1], state, approved, failed: ['CANCELED', 'ERROR', 'ABANDONED'].includes(state) || (state === 'FINISHED' && !approved) });
  }
  m = p.match(/^\/api\/point\/cancel\/([\w-]+)$/);
  if (m && req.method === 'POST' && s.mpPointDeviceId) {
    await mp(tk, `/point/integration-api/devices/${encodeURIComponent(s.mpPointDeviceId)}/payment-intents/${m[1]}`, { method: 'DELETE' }).catch(() => undefined);
    return json({ ok: true });
  }
  return json({ error: 'Não encontrado' }, 404);
}
