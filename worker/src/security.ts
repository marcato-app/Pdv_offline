// Proteções do servidor: limite de tentativas erradas (login e chave mestra) e cabeçalhos de segurança.
import type { Env } from './index';

const WINDOW = 15 * 60_000; // 15 minutos
let ready = false;

async function ensure(env: Env) {
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS auth_fails (k TEXT NOT NULL, at INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS auth_fails_k ON auth_fails (k, at)'),
  ]);
  ready = true;
}

export const clientIp = (req: Request) => req.headers.get('cf-connecting-ip') || 'sem-ip';

/** Alguma das chaves passou do limite de erros nos últimos 15 minutos? */
export async function blocked(env: Env, rules: [key: string, limit: number][]): Promise<boolean> {
  await ensure(env);
  const since = Date.now() - WINDOW;
  for (const [k, limit] of rules) {
    const r = await env.DB.prepare('SELECT COUNT(*) n FROM auth_fails WHERE k = ? AND at > ?').bind(k, since).first<{ n: number }>();
    if ((r?.n || 0) >= limit) return true;
  }
  return false;
}

/** Anota uma tentativa errada (e apaga as muito antigas de vez em quando). */
export async function addFail(env: Env, keys: string[]) {
  await ensure(env);
  const now = Date.now();
  await env.DB.batch(keys.map((k) => env.DB.prepare('INSERT INTO auth_fails (k, at) VALUES (?, ?)').bind(k, now)));
  if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM auth_fails WHERE at < ?').bind(now - 24 * 3_600_000).run();
}

/** Acertou: zera os erros daquela chave. */
export async function clearFails(env: Env, key: string) {
  await ensure(env);
  await env.DB.prepare('DELETE FROM auth_fails WHERE k = ?').bind(key).run();
}

export const TOO_MANY = 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.';

/** Cabeçalhos de segurança para as páginas e respostas do servidor. */
export const SECURITY_HEADERS: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=(self "https://www.mercadopago.com.br"), serial=(self), usb=(self)',
};

/** Só deixa rodar scripts do próprio sistema e dos serviços que ele usa (Mercado Pago, Meta, Google). */
export const CSP = "default-src 'self'; script-src 'self' 'unsafe-eval' https://*.mercadopago.com https://*.mercadolibre.com https://*.mlstatic.com https://connect.facebook.net https://www.googletagmanager.com https://*.google-analytics.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com https://www.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.mlstatic.com; font-src 'self' data: https://fonts.gstatic.com https://*.mlstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https:; frame-src https:; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self' https://*.mercadopago.com; frame-ancestors 'self'";

// Parte que já vale (não quebra nada): sem plugins, sem trocar o endereço base, sem o site dentro de outro site.
export const CSP_ON = "object-src 'none'; base-uri 'self'; frame-ancestors 'self'";
// A lista completa fica em observação: o navegador só avisa o que bloquearia (em /api/csp-report).
// Depois de alguns dias sem avisos de coisas legítimas, ela passa a valer de vez.
export const CSP_WATCH = CSP + '; report-uri /api/csp-report';

export function withSecurity(res: Response): Response {
  const r = new Response(res.body, res);
  if ((r.headers.get('content-type') || '').includes('text/html') && !r.headers.has('content-security-policy')) {
    r.headers.set('content-security-policy', CSP_ON);
    r.headers.set('content-security-policy-report-only', CSP_WATCH);
  }
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) if (!r.headers.has(k)) r.headers.set(k, v);
  return r;
}

/** Guarda os avisos do navegador sobre scripts que a proteção bloquearia (no máximo 500 por dia). */
export async function saveCspReport(env: Env, req: Request) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS csp_reports (at INTEGER NOT NULL, directive TEXT, blocked TEXT, page TEXT)').run();
  const today = await env.DB.prepare('SELECT COUNT(*) n FROM csp_reports WHERE at > ?').bind(Date.now() - 86_400_000).first<{ n: number }>();
  if ((today?.n || 0) >= 500) return;
  const body = await req.text();
  let r: Record<string, string> = {};
  try { const j = JSON.parse(body); r = j['csp-report'] || j[0]?.body || j; } catch { return; }
  const pick = (...k: string[]) => String(k.map((x) => r[x]).find(Boolean) || '').slice(0, 300);
  await env.DB.prepare('INSERT INTO csp_reports (at, directive, blocked, page) VALUES (?, ?, ?, ?)')
    .bind(Date.now(), pick('violated-directive', 'effectiveDirective', 'effective-directive'), pick('blocked-uri', 'blockedURL'), pick('document-uri', 'documentURL')).run();
}
