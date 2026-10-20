// Assinatura do Vision PDV: planos, pagamento pelo Mercado Pago e ativação automática.
// Dois jeitos de pagar:
//  - Pagamento avulso (PIX, cartão ou boleto): paga um período por vez.
//  - Cobrança automática no cartão (assinatura recorrente do Mercado Pago): renova sozinha todo período.
// O dinheiro cai na conta Mercado Pago do dono do Vision PDV (token guardado nas configurações da plataforma).

import type { Env, StoreRow } from './index';
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
  // Envio de e-mail (Resend) e WhatsApp da plataforma (Z-API): senha e avisos de vencimento
  resendKey?: string;
  mailFrom?: string;
  zapiInstance?: string;
  zapiToken?: string;
  zapiClientToken?: string;
  // Anúncios: medir cadastros e assinaturas
  metaPixelId?: string;
  googleTagId?: string; // G-XXXX (Analytics) ou AW-XXXX (Google Ads)
  googleAdsSignup?: string; // AW-XXXX/rótulo da conversão de cadastro
  googleAdsPurchase?: string; // AW-XXXX/rótulo da conversão de assinatura
}

const SECRET_KEYS = ['mpToken', 'resendKey', 'zapiToken', 'zapiClientToken'] as const;
const TEXT_KEYS = ['supportWhatsApp', 'company', 'companyDoc', 'companyEmail', 'mailFrom', 'zapiInstance', 'metaPixelId', 'googleTagId', 'googleAdsSignup', 'googleAdsPurchase'] as const;

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

/** O que qualquer pessoa pode ver (página de vendas, termos, suporte, pixels). */
export function publicPlatform(p: Platform) {
  return {
    plans: p.plans, supportWhatsApp: p.supportWhatsApp || null, company: p.company || null, companyDoc: p.companyDoc || null, companyEmail: p.companyEmail || null,
    checkout: !!p.mpToken, recover: !!(p.resendKey || (p.zapiInstance && p.zapiToken)),
    metaPixelId: p.metaPixelId || null, googleTagId: p.googleTagId || null, googleAdsSignup: p.googleAdsSignup || null, googleAdsPurchase: p.googleAdsPurchase || null,
  };
}

const mask = (v?: string) => (v ? '••••' + v.slice(-4) : null);
function adminView(p: Platform) {
  return { ...publicPlatform(p), mailFrom: p.mailFrom || null, zapiInstance: p.zapiInstance || null, mpToken: mask(p.mpToken), resendKey: mask(p.resendKey), zapiToken: mask(p.zapiToken), zapiClientToken: mask(p.zapiClientToken) };
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
async function processPayment(env: Env, platform: Platform, paymentId: string, fallbackRef?: string) {
  const pay = await mp(platform.mpToken!, `/v1/payments/${paymentId}`);
  if (pay.status !== 'approved') return { ok: false, status: String(pay.status) };
  const ref = String(pay.external_reference || fallbackRef || '');
  const [storeId, planId] = ref.split(':');
  const plan = platform.plans.find((x) => x.id === planId);
  const store = storeId ? await getStore(env, storeId) : null;
  if (!plan || !store) return { ok: false, status: 'referencia-invalida' };
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO payments (id, store_id, days, amount, provider, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(`mp:${paymentId}`, store.id, plan.days, Number(pay.transaction_amount) || 0, 'mercadopago', Date.now()).run();
  if (ins.meta.changes) await extendStore(env, store, plan.days);
  return { ok: true, status: 'approved', amount: Number(pay.transaction_amount) || 0 };
}

/** Atualiza a situação da cobrança automática da loja a partir do Mercado Pago. */
async function syncPreapproval(env: Env, platform: Platform, id: string) {
  const pre = await mp(platform.mpToken!, `/preapproval/${id}`);
  const [storeId, planId] = String(pre.external_reference || '').split(':');
  if (!storeId) return null;
  await env.DB.prepare('UPDATE stores SET sub_id = ?, sub_status = ?, sub_plan = ? WHERE id = ?').bind(id, String(pre.status || ''), planId || null, storeId).run();
  return { storeId, status: String(pre.status || ''), ref: String(pre.external_reference || '') };
}

/** Cobrança mensal/anual feita pela assinatura: acha o pagamento e ativa. */
async function processAuthorizedPayment(env: Env, platform: Platform, id: string) {
  const ap = await mp(platform.mpToken!, `/authorized_payments/${id}`);
  const payId = (ap.payment as { id?: number } | undefined)?.id;
  const preId = String(ap.preapproval_id || '');
  if (!payId || !preId) return;
  const pre = await syncPreapproval(env, platform, preId);
  await processPayment(env, platform, String(payId), pre?.ref);
}

const months = (days: number) => Math.min(12, Math.max(1, Math.round(days / 30)));

export async function billingApi(req: Request, env: Env, url: URL, storeId: string | null, isMaster: boolean): Promise<Response | null> {
  const p = url.pathname;

  if (p === '/api/plans' && req.method === 'GET') return json(publicPlatform(await getPlatform(env)));

  // Aviso do Mercado Pago (webhook). Sempre confere direto no Mercado Pago antes de ativar.
  if (p === '/api/billing/webhook' && req.method === 'POST') {
    const platform = await getPlatform(env);
    if (!platform.mpToken) return json({ ok: true });
    const body = (await req.json().catch(() => ({}))) as { type?: string; topic?: string; data?: { id?: string }; resource?: string };
    const id = String(body.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id') || (body.resource || '').split('/').pop() || '');
    const kind = body.type || body.topic || url.searchParams.get('type') || url.searchParams.get('topic') || '';
    try {
      if (/^\d+$/.test(id) && (!kind || kind === 'payment')) await processPayment(env, platform, id);
      else if (id && /^[\w-]+$/.test(id) && (kind === 'subscription_preapproval' || kind === 'preapproval')) await syncPreapproval(env, platform, id);
      else if (/^\d+$/.test(id) && kind === 'subscription_authorized_payment') await processAuthorizedPayment(env, platform, id);
    } catch (e) { console.error('webhook', kind, id, e); }
    return json({ ok: true });
  }

  // Dono: configurações da plataforma.
  if (p === '/api/admin/platform') {
    if (!isMaster) return json({ error: 'Chave mestra inválida' }, 401);
    const cur = await getPlatform(env);
    if (req.method === 'GET') return json(adminView(cur));
    if (req.method === 'PUT') {
      const b = await req.json<Partial<Platform>>();
      const next: Platform = { ...cur };
      if (Array.isArray(b.plans)) {
        next.plans = b.plans
          .map((x) => ({ id: String(x.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 20), name: String(x.name || '').slice(0, 40), price: Math.round(Number(x.price) * 100) / 100, days: Math.round(Number(x.days)), highlight: x.highlight ? String(x.highlight).slice(0, 40) : undefined }))
          .filter((x) => x.id && x.name && x.price > 0 && x.days > 0)
          .slice(0, 6);
      }
      // Segredos: vazio mantém o atual; "-" apaga.
      for (const k of SECRET_KEYS) {
        const v = String(b[k] ?? '').trim();
        if (v === '-') next[k] = undefined;
        else if (v) next[k] = v;
      }
      for (const k of TEXT_KEYS) if (k in b) next[k] = String(b[k] || '').trim().slice(0, 200) || undefined;
      await putPlatform(env, next);
      return json(adminView(next));
    }
  }

  if (!p.startsWith('/api/billing/')) return null;
  if (!storeId) return json({ error: 'Acesso expirado' }, 401);
  const platform = await getPlatform(env);
  const store = await getStore(env, storeId);
  if (!store) return json({ error: 'Loja não encontrada' }, 404);
  const back = (u?: string) => (/^https:\/\/visionpdv\.marcatoapp\.com\.br\//.test(u || '') ? u! : `${url.origin}/config?aba=assinatura`);
  const fail = (e: unknown) => json({ error: `Não foi possível abrir o pagamento (${e instanceof Error ? e.message : 'Mercado Pago'}). Tente de novo ou fale com o suporte.` }, 502);

  // Pagamento avulso de um período.
  if (p === '/api/billing/checkout' && req.method === 'POST') {
    if (!platform.mpToken) return json({ error: 'Pagamento online ainda não disponível. Fale com o suporte.' }, 400);
    const b = await req.json<{ plan?: string; back?: string }>();
    const plan = platform.plans.find((x) => x.id === b.plan);
    if (!plan) return json({ error: 'Plano inválido' }, 400);
    const to = back(b.back);
    try {
      const pref = await mp(platform.mpToken, '/checkout/preferences', {
        method: 'POST',
        body: JSON.stringify({
          items: [{ id: plan.id, title: `Vision PDV · plano ${plan.name}`, quantity: 1, unit_price: plan.price, currency_id: 'BRL' }],
          external_reference: `${store.id}:${plan.id}:${crypto.randomUUID().slice(0, 8)}`,
          notification_url: `${url.origin}/api/billing/webhook`,
          back_urls: { success: to, pending: to, failure: to },
          auto_return: 'approved',
          payer: store.email ? { email: store.email } : undefined,
          statement_descriptor: 'VISIONPDV',
        }),
      });
      return json({ url: pref.init_point });
    } catch (e) { return fail(e); }
  }

  // Cobrança automática no cartão (renova sozinha).
  if (p === '/api/billing/subscribe' && req.method === 'POST') {
    if (!platform.mpToken) return json({ error: 'Pagamento online ainda não disponível. Fale com o suporte.' }, 400);
    const b = await req.json<{ plan?: string; back?: string; email?: string }>();
    const plan = platform.plans.find((x) => x.id === b.plan);
    if (!plan) return json({ error: 'Plano inválido' }, 400);
    const email = String(b.email || store.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Informe o e-mail da sua conta Mercado Pago' }, 400);
    try {
      const pre = await mp(platform.mpToken, '/preapproval', {
        method: 'POST',
        body: JSON.stringify({
          reason: `Vision PDV · plano ${plan.name}`,
          external_reference: `${store.id}:${plan.id}:sub`,
          payer_email: email,
          back_url: back(b.back),
          status: 'pending',
          auto_recurring: { frequency: months(plan.days), frequency_type: 'months', transaction_amount: plan.price, currency_id: 'BRL' },
        }),
      });
      await env.DB.prepare('UPDATE stores SET sub_id = ?, sub_status = ?, sub_plan = ? WHERE id = ?').bind(String(pre.id), 'pending', plan.id, store.id).run();
      return json({ url: pre.init_point });
    } catch (e) { return fail(e); }
  }

  // Cancelar a cobrança automática (o tempo já pago continua valendo).
  if (p === '/api/billing/cancel' && req.method === 'POST') {
    if (!platform.mpToken || !store.sub_id) return json({ error: 'Não há cobrança automática ativa' }, 400);
    try {
      await mp(platform.mpToken, `/preapproval/${store.sub_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) });
    } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 502); }
    await env.DB.prepare(`UPDATE stores SET sub_status = 'cancelled' WHERE id = ?`).bind(store.id).run();
    return json(licenseOf(env, (await getStore(env, store.id)) as StoreRow));
  }

  // Loja voltou do Mercado Pago: confere o que foi pago (caso o aviso ainda não tenha chegado).
  if (p === '/api/billing/confirm' && req.method === 'POST') {
    const b = await req.json<{ paymentId?: string; preapprovalId?: string }>();
    let extra: Record<string, unknown> = {};
    if (platform.mpToken && b.paymentId && /^\d+$/.test(b.paymentId)) {
      const r = await processPayment(env, platform, b.paymentId).catch(() => ({ ok: false, status: 'erro', amount: 0 }));
      if (!r.ok) return json({ ok: false, status: r.status });
      extra = { amount: r.amount };
    }
    const preId = b.preapprovalId || store.sub_id;
    if (platform.mpToken && preId && /^[\w-]+$/.test(preId)) {
      await syncPreapproval(env, platform, preId).catch(() => null);
      // A primeira cobrança da assinatura pode já ter sido feita: procura e ativa.
      try {
        const s = await mp(platform.mpToken, `/authorized_payments/search?preapproval_id=${encodeURIComponent(preId)}`);
        for (const ap of ((s.results as { id: number }[]) || []).slice(0, 5)) await processAuthorizedPayment(env, platform, String(ap.id)).catch(() => null);
      } catch { /* sem cobranças ainda */ }
    }
    return json({ ...licenseOf(env, (await getStore(env, store.id)) as StoreRow), ...extra });
  }
  return null;
}
