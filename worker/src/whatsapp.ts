// Resumo do dia no WhatsApp do dono: vendas, produtos acabando, contas vencendo, validade.
// Enviado automaticamente no horário escolhido (verificação de hora em hora) ou na hora pelo botão de teste.

import type { Env } from './index';
import { json, DAY } from './util';
import { getSecrets, type Secrets } from './payments';

const BRT = 3 * 3600_000; // Brasília = UTC-3

/** Início do dia (meia-noite em Brasília) em milissegundos UTC. */
function dayStart(ms: number) {
  const local = ms - BRT;
  return Math.floor(local / DAY) * DAY + BRT;
}

const money = (n: number) => 'R$ ' + (n || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const LABELS: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Débito', credito: 'Crédito', credito_parcelado: 'Crédito parcelado', vale: 'Vale', crediario: 'Fiado' };

interface SaleRow { total: number; payments: { method: string; amount: number }[]; change: number; items: { description: string; qty: number; total: number; canceled?: boolean }[] }

async function salesBetween(env: Env, store: string, from: number, to: number) {
  const { results } = await env.DB.prepare(
    `SELECT data FROM records WHERE store_id = ? AND tbl = 'sales' AND deleted = 0
       AND json_extract(data, '$.status') = 'completed'
       AND json_extract(data, '$.createdAt') >= ? AND json_extract(data, '$.createdAt') < ?`,
  ).bind(store, from, to).all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data) as SaleRow);
}

export async function buildSummary(env: Env, store: string, now = Date.now()) {
  const storeRow = await env.DB.prepare('SELECT name FROM stores WHERE id = ?').bind(store).first<{ name: string }>();
  const today = dayStart(now);
  const [sales, yesterday] = await Promise.all([salesBetween(env, store, today, today + DAY), salesBetween(env, store, today - DAY, today)]);
  const total = sales.reduce((s, x) => s + x.total, 0);
  const totalY = yesterday.reduce((s, x) => s + x.total, 0);
  const pay: Record<string, number> = {};
  const prod: Record<string, { q: number; t: number }> = {};
  for (const s of sales) {
    for (const p of s.payments) pay[p.method] = (pay[p.method] || 0) + p.amount;
    if (s.change) pay.dinheiro = (pay.dinheiro || 0) - s.change;
    for (const i of s.items) {
      if (i.canceled) continue;
      prod[i.description] ??= { q: 0, t: 0 };
      prod[i.description].q += i.qty;
      prod[i.description].t += i.total;
    }
  }
  const top = Object.entries(prod).sort((a, b) => b[1].t - a[1].t).slice(0, 3);

  // Estoque abaixo do mínimo (estoque = soma dos movimentos).
  const { results: stock } = await env.DB.prepare(
    `SELECT p.id, json_extract(p.data, '$.description') name, json_extract(p.data, '$.minStock') minStock, COALESCE(m.qty, 0) qty
     FROM records p
     LEFT JOIN (SELECT json_extract(data, '$.productId') pid, SUM(json_extract(data, '$.qty')) qty FROM records
                WHERE store_id = ?1 AND tbl = 'stockMoves' AND deleted = 0 GROUP BY pid) m ON m.pid = p.id
     WHERE p.store_id = ?1 AND p.tbl = 'products' AND p.deleted = 0 AND json_extract(p.data, '$.active') = 1
       AND json_extract(p.data, '$.minStock') > 0 AND COALESCE(m.qty, 0) < json_extract(p.data, '$.minStock')
     LIMIT 50`,
  ).bind(store).all<{ name: string; qty: number; minStock: number }>();

  const { results: bills } = await env.DB.prepare(
    `SELECT json_extract(data, '$.description') d, json_extract(data, '$.amount') a, json_extract(data, '$.dueDate') due FROM records
     WHERE store_id = ? AND tbl = 'bills' AND deleted = 0 AND json_extract(data, '$.paidAt') IS NULL AND json_extract(data, '$.dueDate') < ?`,
  ).bind(store, today + 2 * DAY).all<{ d: string; a: number; due: number }>();
  const late = bills.filter((b) => b.due < today);
  const soon = bills.filter((b) => b.due >= today);

  const { results: expiring } = await env.DB.prepare(
    `SELECT json_extract(data, '$.productName') n, json_extract(data, '$.expiresAt') e FROM records
     WHERE store_id = ? AND tbl = 'batches' AND deleted = 0 AND json_extract(data, '$.status') = 'ativo' AND json_extract(data, '$.expiresAt') < ?`,
  ).bind(store, today + 4 * DAY).all<{ n: string; e: number }>();

  const pending = await env.DB.prepare(`SELECT COUNT(*) n FROM records WHERE store_id = ? AND tbl = 'pendingProducts' AND deleted = 0`).bind(store).first<{ n: number }>();

  const date = new Date(now - BRT).toISOString().slice(0, 10).split('-').reverse().join('/');
  const diff = totalY ? ((total - totalY) / totalY) * 100 : 0;
  const lines = [
    `*${storeRow?.name || 'Sua loja'} · resumo de ${date}*`,
    '',
    `💰 Vendas: *${money(total)}* em ${sales.length} ${sales.length === 1 ? 'venda' : 'vendas'}`,
    sales.length ? `🧾 Ticket médio: ${money(total / sales.length)}` : '',
    totalY ? `📊 ${diff >= 0 ? '+' : ''}${diff.toFixed(0)}% em relação a ontem (${money(totalY)})` : '',
    Object.keys(pay).length ? `💳 ${Object.entries(pay).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${LABELS[k] || k} ${money(v)}`).join(' · ')}` : '',
    top.length ? `\n🏆 Mais vendidos:\n${top.map(([n, v], i) => `${i + 1}. ${n} (${v.q.toLocaleString('pt-BR')}) ${money(v.t)}`).join('\n')}` : '',
    stock.length ? `\n📦 ${stock.length} ${stock.length === 1 ? 'produto abaixo' : 'produtos abaixo'} do mínimo: ${stock.slice(0, 5).map((s) => s.name).join(', ')}${stock.length > 5 ? '…' : ''}` : '',
    late.length ? `\n⚠️ ${late.length} ${late.length === 1 ? 'conta vencida' : 'contas vencidas'}: ${money(late.reduce((s, b) => s + b.a, 0))}` : '',
    soon.length ? `📅 Vencem hoje/amanhã: ${soon.map((b) => `${b.d} ${money(b.a)}`).join(' · ')}` : '',
    expiring.length ? `\n⏳ Validade nos próximos dias: ${expiring.slice(0, 5).map((x) => x.n).join(', ')}` : '',
    pending?.n ? `\n🔎 ${pending.n} ${pending.n === 1 ? 'produto vendido' : 'produtos vendidos'} sem cadastro` : '',
    '',
    '_Vision PDV_',
  ];
  return lines.filter((l, i) => l !== '' || (i > 0 && lines[i - 1] !== '')).join('\n').replace(/\n{3,}/g, '\n\n');
}

const digits = (s: string) => {
  const d = s.replace(/\D/g, '');
  return d.length <= 11 ? '55' + d : d;
};

async function send(w: NonNullable<Secrets['whatsapp']>, to: string, text: string) {
  const phone = digits(to);
  let r: Response;
  if (w.provider === 'meta') {
    r = await fetch(`https://graph.facebook.com/v20.0/${w.metaPhoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${w.metaToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(
        w.metaTemplate
          ? { messaging_product: 'whatsapp', to: phone, type: 'template', template: { name: w.metaTemplate, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: text.replace(/\n+/g, ' · ').slice(0, 1000) }] }] } }
          : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } },
      ),
    });
  } else if (w.provider === 'zapi') {
    r = await fetch(`https://api.z-api.io/instances/${w.zapiInstance}/token/${w.zapiToken}/send-text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(w.zapiClientToken ? { 'client-token': w.zapiClientToken } : {}) },
      body: JSON.stringify({ phone, message: text }),
    });
  } else if (w.provider === 'evolution') {
    r = await fetch(`${(w.evolutionUrl || '').replace(/\/+$/, '')}/message/sendText/${w.evolutionInstance}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: w.evolutionKey || '' },
      body: JSON.stringify({ number: phone, text }),
    });
  } else throw new Error('Escolha o serviço de WhatsApp');
  if (!r.ok) throw new Error(`O serviço de WhatsApp respondeu ${r.status}: ${(await r.text()).slice(0, 160)}`);
}

export async function whatsappApi(req: Request, env: Env, url: URL, storeId: string): Promise<Response | null> {
  if (url.pathname === '/api/whatsapp/summary' && req.method === 'GET') return json({ text: await buildSummary(env, storeId) });
  if (url.pathname === '/api/whatsapp/test' && req.method === 'POST') {
    const s = await getSecrets(env, storeId);
    const w = s.whatsapp;
    if (!w?.provider || !w.to?.length) return json({ error: 'Configure o serviço e os números do WhatsApp' }, 400);
    const text = await buildSummary(env, storeId);
    for (const to of w.to) await send(w, to, text);
    return json({ ok: true, sent: w.to.length });
  }
  return null;
}

/** Roda de hora em hora: manda o resumo das lojas cujo horário chegou. */
export async function sendDailySummaries(env: Env) {
  const now = Date.now();
  const hour = new Date(now - BRT).getUTCHours();
  const day = dayStart(now);
  const { results } = await env.DB.prepare('SELECT store_id, data FROM store_secrets').all<{ store_id: string; data: string }>();
  for (const r of results) {
    const s = JSON.parse(r.data) as Secrets;
    const w = s.whatsapp;
    if (!w?.provider || !w.to?.length || (w.hour ?? 20) !== hour) continue;
    const store = await env.DB.prepare('SELECT trial_ends, paid_until, blocked FROM stores WHERE id = ?').bind(r.store_id).first<{ trial_ends: number; paid_until: number; blocked: number }>();
    if (!store || store.blocked || Math.max(store.trial_ends, store.paid_until) < now) continue;
    const done = await env.DB.prepare('SELECT 1 FROM wa_log WHERE store_id = ? AND day = ?').bind(r.store_id, day).first();
    if (done) continue;
    try {
      const text = await buildSummary(env, r.store_id, now);
      for (const to of w.to) await send(w, to, text);
      await env.DB.prepare('INSERT OR IGNORE INTO wa_log (store_id, day, sent_at) VALUES (?, ?, ?)').bind(r.store_id, day, now).run();
    } catch (e) {
      console.error('WhatsApp', r.store_id, e);
    }
  }
}
