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
  mpPublicKey?: string; // Public Key (para os campos de cartão dentro do app)
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
const TEXT_KEYS = ['mpPublicKey', 'supportWhatsApp', 'company', 'companyDoc', 'companyEmail', 'mailFrom', 'zapiInstance', 'metaPixelId', 'googleTagId', 'googleAdsSignup', 'googleAdsPurchase'] as const;

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
    checkout: !!p.mpToken, mpPublicKey: p.mpToken ? p.mpPublicKey || null : null, recover: !!(p.resendKey || (p.zapiInstance && p.zapiToken)),
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

const SITE_ORIGIN = 'https://visionpdv.marcatoapp.com.br';

/** Motivo da recusa do cartão em português simples. */
function cardError(detail: string) {
  const d = detail.toLowerCase();
  const m: [string, string][] = [
    ['insufficient_amount', 'Cartão sem limite suficiente. Tente outro cartão ou o PIX.'],
    ['security_code', 'Código de segurança (CVV) inválido. Confira e tente de novo.'],
    ['bad_filled_date', 'Data de validade inválida. Confira e tente de novo.'],
    ['bad_filled', 'Algum dado do cartão está errado. Confira e tente de novo.'],
    ['call_for_authorize', 'O banco pediu autorização. Ligue para o banco do cartão e tente de novo.'],
    ['card_disabled', 'Cartão bloqueado ou inativo. Fale com o banco ou use outro cartão.'],
    ['duplicated', 'Pagamento repetido. Aguarde alguns minutos antes de tentar de novo.'],
    ['high_risk', 'O pagamento foi recusado por segurança. Tente outro cartão ou o PIX.'],
    ['max_attempts', 'Muitas tentativas. Use outro cartão ou o PIX.'],
    ['blacklist', 'O pagamento foi recusado. Use outro cartão ou o PIX.'],
  ];
  for (const [k, v] of m) if (d.includes(k)) return v;
  if (d.includes('rejected')) return 'O cartão foi recusado. Tente outro cartão ou o PIX.';
  return `Não foi possível pagar com o cartão (${detail.slice(0, 120)}). Tente de novo ou use o PIX.`;
}

const months = (days: number) => Math.min(12, Math.max(1, Math.round(days / 30)));

export async function billingApi(req: Request, env: Env, url: URL, storeId: string | null, isMaster: boolean): Promise<Response | null> {
  const p = url.pathname;

  if (p === '/api/plans' && req.method === 'GET') return json(publicPlatform(await getPlatform(env)));

  // Aberto no navegador: só explica (o Mercado Pago usa POST).
  if (p === '/api/billing/webhook' && req.method === 'GET') return json({ ok: true, info: 'Endereço de avisos do Mercado Pago funcionando. Cole este link em Webhooks; não precisa abrir.' });

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

  const payerEmail = (e?: string) => {
    const m = String(e || store.email || '').trim().toLowerCase();
    return /^\S+@\S+\.\S+$/.test(m) ? m : null;
  };
  const getPlan = (id?: string) => platform.plans.find((x) => x.id === id);
  const lic = async () => licenseOf(env, (await getStore(env, store.id)) as StoreRow);

  // PIX dentro do app: gera o QR e a loja fica olhando até cair.
  if (p === '/api/billing/pix' && req.method === 'POST') {
    if (!platform.mpToken) return json({ error: 'Pagamento online ainda não disponível. Fale com o suporte.' }, 400);
    const b = await req.json<{ plan?: string; email?: string }>();
    const plan = getPlan(b.plan);
    if (!plan) return json({ error: 'Plano inválido' }, 400);
    const email = payerEmail(b.email);
    if (!email) return json({ error: 'Informe um e-mail válido' }, 400);
    try {
      const pay = await mp(platform.mpToken, '/v1/payments', {
        method: 'POST',
        headers: { 'x-idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          transaction_amount: plan.price,
          description: `Vision PDV · plano ${plan.name}`,
          payment_method_id: 'pix',
          payer: { email },
          external_reference: `${store.id}:${plan.id}:${crypto.randomUUID().slice(0, 8)}`,
          notification_url: `${url.origin}/api/billing/webhook`,
          date_of_expiration: new Date(Date.now() + 30 * 60_000).toISOString().replace('Z', '-00:00'),
        }),
      });
      const td = ((pay.point_of_interaction as { transaction_data?: Record<string, string> } | undefined)?.transaction_data) || {};
      if (!td.qr_code) return json({ error: 'O Mercado Pago não gerou o PIX. Confira se a conta tem uma chave PIX cadastrada.' }, 502);
      return json({ id: String(pay.id), qr: td.qr_code, qrBase64: td.qr_code_base64 || null, amount: plan.price, expiresAt: Date.now() + 30 * 60_000 });
    } catch (e) { return fail(e); }
  }

  // Situação de um pagamento (PIX esperando cair, cartão em análise).
  if (p === '/api/billing/status' && req.method === 'GET') {
    const id = url.searchParams.get('id') || '';
    if (!platform.mpToken || !/^\d+$/.test(id)) return json({ error: 'Pagamento inválido' }, 400);
    const r = await processPayment(env, platform, id).catch(() => ({ ok: false, status: 'erro' }));
    return json({ status: r.status, license: r.ok ? await lic() : null });
  }

  // Cartão dentro do app. Os dados do cartão viram um "token" no aparelho (nunca passam por aqui).
  if ((p === '/api/billing/card' || p === '/api/billing/card-subscribe') && req.method === 'POST') {
    if (!platform.mpToken) return json({ error: 'Pagamento online ainda não disponível. Fale com o suporte.' }, 400);
    const b = await req.json<{ plan?: string; token?: string; paymentMethodId?: string; issuerId?: string | number; installments?: number; email?: string; docType?: string; docNumber?: string }>();
    const plan = getPlan(b.plan);
    if (!plan || !b.token) return json({ error: 'Dados do pagamento incompletos' }, 400);
    const email = payerEmail(b.email);
    if (!email) return json({ error: 'Informe um e-mail válido' }, 400);
    const identification = b.docNumber ? { type: b.docType || 'CPF', number: String(b.docNumber).replace(/\D/g, '') } : undefined;

    if (p === '/api/billing/card-subscribe') {
      try {
        const pre = await mp(platform.mpToken, '/preapproval', {
          method: 'POST',
          body: JSON.stringify({
            reason: `Vision PDV · plano ${plan.name}`,
            external_reference: `${store.id}:${plan.id}:sub`,
            payer_email: email,
            card_token_id: b.token,
            back_url: `${SITE_ORIGIN}/config?aba=assinatura`,
            status: 'authorized',
            auto_recurring: { frequency: months(plan.days), frequency_type: 'months', transaction_amount: plan.price, currency_id: 'BRL' },
          }),
        });
        await env.DB.prepare('UPDATE stores SET sub_id = ?, sub_status = ?, sub_plan = ? WHERE id = ?').bind(String(pre.id), String(pre.status || 'authorized'), plan.id, store.id).run();
        return json({ ok: true, preapprovalId: String(pre.id), status: String(pre.status || ''), license: await lic() });
      } catch (e) {
        return json({ error: cardError(e instanceof Error ? e.message : String(e)) }, 400);
      }
    }

    try {
      const pay = await mp(platform.mpToken, '/v1/payments', {
        method: 'POST',
        headers: { 'x-idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          transaction_amount: plan.price,
          token: b.token,
          description: `Vision PDV · plano ${plan.name}`,
          installments: Math.max(1, Math.min(12, Number(b.installments) || 1)),
          payment_method_id: b.paymentMethodId,
          issuer_id: b.issuerId ? Number(b.issuerId) : undefined,
          payer: { email, identification },
          external_reference: `${store.id}:${plan.id}:${crypto.randomUUID().slice(0, 8)}`,
          notification_url: `${url.origin}/api/billing/webhook`,
          statement_descriptor: 'VISIONPDV',
        }),
      });
      if (pay.status === 'approved') {
        await processPayment(env, platform, String(pay.id));
        return json({ ok: true, status: 'approved', id: String(pay.id), license: await lic() });
      }
      if (pay.status === 'in_process' || pay.status === 'pending') return json({ ok: true, status: 'pending', id: String(pay.id) });
      return json({ error: cardError(String(pay.status_detail || pay.status)) }, 400);
    } catch (e) {
      return json({ error: cardError(e instanceof Error ? e.message : String(e)) }, 400);
    }
  }

  // Pagamento avulso de um período (pelo site do Mercado Pago).
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
