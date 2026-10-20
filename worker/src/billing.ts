// Assinatura do Vision PDV: planos, pagamento pelo Mercado Pago (cartão ou PIX) e ativação automática.
// O dinheiro cai na conta Mercado Pago do dono do Vision PDV (token guardado nas configurações da plataforma).

import type { Env } from './index';
import { getStore, extendStore, licenseOf } from './index';
import { json } from './util';

export interface Plan {
  id: string;
  name: string;
  price: number;
  days: number;
  highlight?: string;
}

export interface Platform {
  plans: Plan[];
  mpToken?: string; // Access Token de produção da conta Mercado Pago do Vision PDV
  supportWhatsApp?: string;
  company?: string; // nome/razão social que aparece nos termos
  companyDoc?: string; // CNPJ ou CPF
  companyEmail?: string;
}

export const DEFAULT_PLATFORM: Platform = {
  plans: [
    { id: 'mensal', name: 'Mensal', price: 79.9, days: 30 },
    { id: 'anual', name: 'Anual', price: 799, days: 365, highlight: '2 meses grátis' },
  ],
};

export async function getPlatform(env: Env): Promise<Platform> {
  const row = await env.DB.prepare(`SELECT value FROM platform_config WHERE key = 'platform'`).first<{ value: string }>();
  return { ...DEFAULT_PLATFORM, ...(row ? JSON.parse(row.value) : {}) };
}

async function putPlatform(env: Env, p: Platform) {
  await env.DB.prepare(`INSERT INTO platform_config (key, value) VALUES ('platform', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(p)).run();
}

/** O que qualquer pessoa pode ver (página de vendas, termos, suporte). */
export function publicPlatform(p: Platform) {
  return { plans: p.plans, supportWhatsApp: p.supportWhatsApp || null, company: p.company || null, companyDoc: p.companyDoc || null, companyEmail: p.companyEmail || null, checkout: !!p.mpToken };
}

async function mp(token: string, path: string, init?: RequestInit) {
  const r = await fetch('https://api.mercadopago.com' + path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init?.headers || {}) },
  });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error((data.message as string) || `Mercado Pago respondeu ${r.status}`);
  return data;
}

/** Processa um pagamento aprovado (uma vez só): soma os dias do plano à loja. */
async function processPayment(env: Env, platform: Platform, paymentId: string) {
  const pay = await mp(platform.mpToken!, `/v1/payments/${paymentId}`);
  if (pay.status !== 'approved') return { ok: false, status: pay.status };
  const ref = String(pay.external_reference || '');
  const [storeId, planId] = ref.split(':');
  const plan = platform.plans.find((x) => x.id === planId);
  const store = storeId ? await getStore(env, storeId) : null;
  if (!plan || !store) return { ok: false, status: 'referencia-invalida' };
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO payments (id, store_id, days, amount, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`mp:${paymentId}`, store.id, plan.days, Number(pay.transaction_amount) || 0, 'mercadopago', Date.now()).run();
  if (ins.meta.changes) await extendStore(env, store, plan.days);
  return { ok: true, status: 'approved' };
}

export async function billingApi(req: Request, env: Env, url: URL, storeId: string | null, isMaster: boolean): Promise<Response | null> {
  const p = url.pathname;

  if (p === '/api/plans' && req.method === 'GET') return json(publicPlatform(await getPlatform(env)));

  // Aviso do Mercado Pago (webhook). Sempre confere o pagamento direto no Mercado Pago antes de ativar.
  if (p === '/api/billing/webhook' && req.method === 'POST') {
    const platform = await getPlatform(env);
    if (!platform.mpToken) return json({ ok: true });
    const body = (await req.json().catch(() => ({}))) as { type?: string; topic?: string; data?: { id?: string }; resource?: string };
    const id = body.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id') || (body.resource || '').split('/').pop();
    const kind = body.type || body.topic || url.searchParams.get('type') || url.searchParams.get('topic');
    if (id && (!kind || kind === 'payment') && /^\d+$/.test(String(id))) {
      try { await processPayment(env, platform, String(id)); } catch (e) { console.error('webhook', e); }
    }
    return json({ ok: true });
  }

  // Dono: configurações da plataforma (planos, Mercado Pago, suporte, dados da empresa).
  if (p === '/api/admin/platform') {
    if (!isMaster) return json({ error: 'Chave mestra inválida' }, 401);
    const cur = await getPlatform(env);
    if (req.method === 'GET') return json({ ...publicPlatform(cur), mpToken: cur.mpToken ? '••••' + cur.mpToken.slice(-4) : null });
    if (req.method === 'PUT') {
      const b = await req.json<Partial<Platform>>();
      const next: Platform = { ...cur };
      if (Array.isArray(b.plans)) {
        next.plans = b.plans
          .map((x) => ({ id: String(x.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20), name: String(x.name || '').slice(0, 40), price: Math.round(Number(x.price) * 100) / 100, days: Math.round(Number(x.days)), highlight: x.highlight ? String(x.highlight).slice(0, 40) : undefined }))
          .filter((x) => x.id && x.name && x.price > 0 && x.days > 0)
          .slice(0, 6);
      }
      for (const k of ['mpToken', 'supportWhatsApp', 'company', 'companyDoc', 'companyEmail'] as const) {
        if (k in b) next[k] = String(b[k] || '').trim() || undefined;
      }
      await putPlatform(env, next);
      return json({ ...publicPlatform(next), mpToken: next.mpToken ? '••••' + next.mpToken.slice(-4) : null });
    }
  }

  // Loja: abrir o pagamento de um plano.
  if (p === '/api/billing/checkout' && req.method === 'POST') {
    if (!storeId) return json({ error: 'Acesso expirado' }, 401);
    const platform = await getPlatform(env);
    if (!platform.mpToken) return json({ error: 'Pagamento online ainda não disponível. Fale com o suporte.' }, 400);
    const b = await req.json<{ plan?: string; back?: string }>();
    const plan = platform.plans.find((x) => x.id === b.plan);
    const store = await getStore(env, storeId);
    if (!plan || !store) return json({ error: 'Plano inválido' }, 400);
    const back = /^https:\/\/visionpdv\.marcatoapp\.com\.br\//.test(b.back || '') ? b.back! : `${url.origin}/config?aba=assinatura`;
    const pref = await mp(platform.mpToken, '/checkout/preferences', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ id: plan.id, title: `Vision PDV · plano ${plan.name}`, quantity: 1, unit_price: plan.price, currency_id: 'BRL' }],
        external_reference: `${store.id}:${plan.id}:${crypto.randomUUID().slice(0, 8)}`,
        notification_url: `${url.origin}/api/billing/webhook`,
        back_urls: { success: back, pending: back, failure: back },
        auto_return: 'approved',
        payer: store.email ? { email: store.email } : undefined,
        statement_descriptor: 'VISIONPDV',
      }),
    }).catch((e: Error) => ({ error: e.message }) as Record<string, unknown>);
    if (!pref.init_point) return json({ error: `Não foi possível abrir o pagamento (${pref.error || 'Mercado Pago'}). Tente de novo ou fale com o suporte.` }, 502);
    return json({ url: pref.init_point });
  }

  // Loja voltou do Mercado Pago: confere o pagamento informado na volta (caso o aviso ainda não tenha chegado).
  if (p === '/api/billing/confirm' && req.method === 'POST') {
    if (!storeId) return json({ error: 'Acesso expirado' }, 401);
    const platform = await getPlatform(env);
    const b = await req.json<{ paymentId?: string }>();
    if (platform.mpToken && b.paymentId && /^\d+$/.test(b.paymentId)) {
      const r = await processPayment(env, platform, b.paymentId).catch(() => ({ ok: false, status: 'erro' }));
      if (!r.ok) return json({ ok: false, status: r.status });
    }
    const s = await getStore(env, storeId);
    return json(s ? licenseOf(env, s) : { error: 'Loja não encontrada' });
  }
  return null;
}
