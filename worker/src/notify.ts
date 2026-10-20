// Mensagens da plataforma para as lojas: e-mail (Resend) e WhatsApp (Z-API do Vision PDV).
// Usado na recuperação de senha e nos avisos de vencimento.

import type { Env, StoreRow } from './index';
import { getPlatform, type Platform } from './billing';
import { send as sendWa } from './whatsapp';
import { DAY } from './util';

export const SITE = 'https://visionpdv.marcatoapp.com.br';
const BRT = 3 * 3600_000;
const dayStart = (ms: number) => Math.floor((ms - BRT) / DAY) * DAY + BRT;
const date = (ms: number) => new Date(ms - BRT).toISOString().slice(0, 10).split('-').reverse().join('/');

export const canMail = (p: Platform) => !!p.resendKey;
export const canWa = (p: Platform) => !!(p.zapiInstance && p.zapiToken);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** E-mail simples com a cara do Vision PDV. */
function mailHtml(title: string, lines: string[], button?: { label: string; url: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f6f5fa;font-family:Arial,sans-serif;color:#1e1b2e">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table width="100%" style="max-width:520px;background:#fff;border-radius:16px;overflow:hidden" cellpadding="0" cellspacing="0">
<tr><td style="background:#5b3fa8;color:#fff;padding:18px 24px;font-size:20px;font-weight:bold">Vision PDV</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5">${esc(l)}</p>`).join('')}
${button ? `<p style="margin:20px 0"><a href="${button.url}" style="background:#15803d;color:#fff;text-decoration:none;padding:14px 22px;border-radius:12px;font-weight:bold;display:inline-block">${esc(button.label)}</a></p><p style="font-size:12px;color:#555067;word-break:break-all">Ou copie o link: ${button.url}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

export async function sendMail(p: Platform, to: string, subject: string, title: string, lines: string[], button?: { label: string; url: string }) {
  if (!p.resendKey) throw new Error('E-mail não configurado');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${p.resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: p.mailFrom || 'Vision PDV <nao-responda@marcatoapp.com.br>',
      to: [to],
      subject,
      html: mailHtml(title, lines, button),
      text: [title, '', ...lines, ...(button ? ['', `${button.label}: ${button.url}`] : [])].join('\n'),
      ...(p.companyEmail ? { reply_to: p.companyEmail } : {}),
    }),
  });
  if (!r.ok) throw new Error(`Envio de e-mail falhou (${r.status}): ${(await r.text()).slice(0, 160)}`);
}

export async function sendPlatformWa(p: Platform, to: string, text: string) {
  if (!canWa(p)) throw new Error('WhatsApp da plataforma não configurado');
  await sendWa({ provider: 'zapi', zapiInstance: p.zapiInstance, zapiToken: p.zapiToken, zapiClientToken: p.zapiClientToken }, to, text);
}

// ---------- Avisos de vencimento ----------
// 3 dias antes, no dia e 1 dia depois de vencer. Uma vez por data de vencimento (renovou, os avisos recomeçam).

type Kind = 'd3' | 'd0' | 'exp';

function noticeText(s: StoreRow, kind: Kind, until: number, trial: boolean) {
  const link = `${SITE}/config?aba=assinatura`;
  const what = trial ? 'o teste grátis' : 'a assinatura';
  const subject = kind === 'd3' ? `${trial ? 'Seu teste grátis' : 'Sua assinatura'} termina em 3 dias` : kind === 'd0' ? `${trial ? 'Seu teste grátis' : 'Sua assinatura'} termina hoje` : 'O caixa da sua loja está bloqueado';
  const lines = kind === 'exp'
    ? [`Olá! ${trial ? 'O teste grátis' : 'A assinatura'} do Vision PDV da loja ${s.name} venceu em ${date(until)} e o caixa parou de vender.`, 'Seus produtos, vendas e clientes continuam salvos. Assine para voltar a vender na hora.']
    : [`Olá! ${what[0].toUpperCase() + what.slice(1)} do Vision PDV da loja ${s.name} vai até ${date(until)}${kind === 'd0' ? ' (hoje)' : ''}.`, 'Para o caixa não parar, assine agora. Leva 1 minuto e a ativação é automática.'];
  return { subject, lines, link, wa: `*Vision PDV · ${s.name}*\n\n${lines.join('\n\n')}\n\nAssinar: ${link}` };
}

export async function sendExpiryNotices(env: Env) {
  const now = Date.now();
  if (new Date(now - BRT).getUTCHours() !== 9) return; // 9h da manhã em Brasília
  const p = await getPlatform(env);
  if (!canMail(p) && !canWa(p)) return;
  const today = dayStart(now);
  const { results } = await env.DB.prepare(
    `SELECT * FROM stores WHERE blocked = 0 AND MAX(trial_ends, paid_until) BETWEEN ? AND ?`,
  ).bind(now - 2 * DAY, now + 4 * DAY).all<StoreRow>();
  for (const s of results) {
    const until = Math.max(s.trial_ends, s.paid_until);
    const diff = Math.round((dayStart(until) - today) / DAY);
    const kind: Kind | null = diff === 3 ? 'd3' : diff === 0 ? 'd0' : diff === -1 ? 'exp' : null;
    if (!kind) continue;
    // Com cobrança automática ativa, só avisa se mesmo assim venceu (cartão recusado).
    if (s.sub_status === 'authorized' && kind !== 'exp') continue;
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO notice_log (store_id, kind, ref, sent_at) VALUES (?, ?, ?, ?)').bind(s.id, kind, until, now).run();
    if (!ins.meta.changes) continue;
    const t = noticeText(s, kind, until, s.paid_until < s.trial_ends);
    try { if (canMail(p) && s.email) await sendMail(p, s.email, t.subject, t.subject, t.lines, { label: 'Assinar agora', url: t.link }); } catch (e) { console.error('aviso e-mail', s.id, e); }
    try { if (canWa(p) && s.phone) await sendPlatformWa(p, s.phone, t.wa); } catch (e) { console.error('aviso WhatsApp', s.id, e); }
  }
}
