// Servidor do Vision PDV (Cloudflare Worker + D1).
// - Entrega o site. Cada loja tem seu link: /codigo-da-loja/
// - API: criar loja, login na nuvem e sincronização dos aparelhos.

import { CORS, json } from './util';
import { catalogApi } from './catalog';
import { paymentsApi, secretsApi } from './payments';
import { whatsappApi, sendDailySummaries } from './whatsapp';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  API_KEY: string; // chave mestra: painel do dono (gerar chaves de ativação, ver lojas)
  TRIAL_DAYS?: string; // dias grátis para loja nova (padrão 7)
  CHECKOUT_URL?: string; // link de compra; recebe ?loja=<codigo>
  COSMOS_TOKEN?: string; // opcional: base de produtos Bluesoft Cosmos
}

const TABLES = new Set(['products', 'customers', 'creditEntries', 'sales', 'cashSessions', 'cashMoves', 'stockMoves', 'users', 'settings', 'pendingProducts', 'bills', 'batches']);
const MAX_PUSH = 500;
const MAX_PULL = 1000;
const TOKEN_DAYS = 365;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['api', 'sync', 'health', 'assets', 'admin', 'www', 'app', 'static']);

function safeEqual(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(env: Env, text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('vision-token:' + env.API_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

async function makeToken(env: Env, storeId: string) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_DAYS * 86400;
  const body = `${storeId}.${exp}`;
  return `${body}.${await hmac(env, body)}`;
}

async function readToken(env: Env, req: Request): Promise<string | null> {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [storeId, exp, sig] = parts;
  if (Number(exp) * 1000 < Date.now()) return null;
  return safeEqual(sig, await hmac(env, `${storeId}.${exp}`)) ? storeId : null;
}

interface StoreRow { id: string; name: string; email: string | null; phone: string | null; created_at: number; trial_ends: number; paid_until: number; plan: string | null; blocked: number }

async function getStore(env: Env, slug: string) {
  return env.DB.prepare('SELECT * FROM stores WHERE id = ?').bind(slug).first<StoreRow>();
}

const DAY = 86_400_000;

/** Situação da licença: teste grátis, ativa, vencida ou bloqueada. */
function licenseOf(env: Env, s: StoreRow) {
  const validUntil = Math.max(s.trial_ends, s.paid_until);
  const now = Date.now();
  const status = s.blocked ? 'blocked' : now > validUntil ? 'expired' : s.paid_until > now ? 'active' : 'trial';
  const checkout = env.CHECKOUT_URL ? `${env.CHECKOUT_URL}${env.CHECKOUT_URL.includes('?') ? '&' : '?'}loja=${encodeURIComponent(s.id)}` : null;
  return { status, trialEnds: s.trial_ends, paidUntil: s.paid_until, validUntil, daysLeft: Math.max(0, Math.ceil((validUntil - now) / DAY)), checkoutUrl: checkout };
}

/** Soma dias à licença, contando a partir de hoje ou do fim da licença atual (o que for maior). */
async function extendStore(env: Env, s: StoreRow, days: number) {
  const base = Math.max(Date.now(), s.trial_ends, s.paid_until);
  const until = base + days * DAY;
  await env.DB.prepare('UPDATE stores SET paid_until = ? WHERE id = ?').bind(until, s.id).run();
  return { ...s, paid_until: until };
}

const KEY_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newKey() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  const c = [...b].map((x) => KEY_ABC[x % KEY_ABC.length]).join('');
  return `VPDV-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}

const isMaster = (env: Env, req: Request) => safeEqual(req.headers.get('x-master-key') || '', env.API_KEY);

interface PushRecord {
  tbl: string;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: 0 | 1;
}

function upsertStmt(env: Env) {
  return env.DB.prepare(
    `INSERT INTO records (store_id, tbl, id, data, updated_at, deleted, seq)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records WHERE store_id = ?1))
     ON CONFLICT (store_id, tbl, id) DO UPDATE SET
       data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq
     WHERE excluded.updated_at > records.updated_at`,
  );
}

function validRecord(r: PushRecord) {
  return r && TABLES.has(r.tbl) && typeof r.id === 'string' && r.id.length > 0 && r.id.length < 100 && typeof r.updatedAt === 'number';
}

async function push(env: Env, storeId: string, body: { records?: PushRecord[] }) {
  const records = Array.isArray(body.records) ? body.records : [];
  if (records.length > MAX_PUSH) return json({ error: `Máximo de ${MAX_PUSH} registros por envio` }, 413);
  const stmt = upsertStmt(env);
  const batch = records.filter(validRecord).map((r) => stmt.bind(storeId, r.tbl, r.id, JSON.stringify(r.data), Math.floor(r.updatedAt), r.deleted ? 1 : 0));
  if (batch.length) await env.DB.batch(batch);
  return json({ ok: true, accepted: batch.length });
}

async function pull(env: Env, storeId: string, url: URL) {
  const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
  const limit = Math.min(MAX_PULL, Math.max(1, Number(url.searchParams.get('limit')) || 500));
  const { results } = await env.DB.prepare(
    'SELECT tbl, id, data, updated_at, deleted, seq FROM records WHERE store_id = ? AND seq > ? ORDER BY seq LIMIT ?',
  ).bind(storeId, since, limit + 1).all<{ tbl: string; id: string; data: string; updated_at: number; deleted: number; seq: number }>();
  const more = results.length > limit;
  const rows = more ? results.slice(0, limit) : results;
  return json({
    records: rows.map((r) => ({ tbl: r.tbl, id: r.id, data: JSON.parse(r.data), updatedAt: r.updated_at, deleted: r.deleted })),
    cursor: rows.length ? rows[rows.length - 1].seq : since,
    more,
  });
}

interface UserData { login: string; salt: string; passHash: string; active: number; deleted?: number; name: string; role: string; id: string }

async function findUser(env: Env, storeId: string, login: string): Promise<UserData | null> {
  const row = await env.DB.prepare(
    `SELECT data FROM records WHERE store_id = ? AND tbl = 'users' AND deleted = 0 AND json_extract(data, '$.login') = ? LIMIT 1`,
  ).bind(storeId, login).first<{ data: string }>();
  if (!row) return null;
  const u = JSON.parse(row.data) as UserData;
  return u.active ? u : null;
}

/** Procura o usuário pelo e-mail em todas as lojas (login só com e-mail e senha). */
async function findUserByEmail(env: Env, email: string): Promise<(UserData & { storeId: string }) | null> {
  if (!email.includes('@')) return null;
  const { results } = await env.DB.prepare(
    `SELECT store_id, data FROM records WHERE tbl = 'users' AND deleted = 0
       AND (lower(json_extract(data, '$.email')) = ?1 OR lower(json_extract(data, '$.login')) = ?1) LIMIT 5`,
  ).bind(email).all<{ store_id: string; data: string }>();
  for (const r of results) {
    const u = JSON.parse(r.data) as UserData;
    if (u.active) return { ...u, storeId: r.store_id };
  }
  // Lojas antigas: o administrador não tinha e-mail; usa o e-mail do cadastro da loja.
  const st = await env.DB.prepare('SELECT id FROM stores WHERE lower(email) = ? ORDER BY created_at LIMIT 1').bind(email).first<{ id: string }>();
  if (st) {
    const row = await env.DB.prepare(
      `SELECT data FROM records WHERE store_id = ? AND tbl = 'users' AND deleted = 0 AND json_extract(data, '$.role') = 'admin' ORDER BY updated_at LIMIT 1`,
    ).bind(st.id).first<{ data: string }>();
    if (row) {
      const u = JSON.parse(row.data) as UserData;
      if (u.active) return { ...u, storeId: st.id };
    }
  }
  return null;
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;

  // Dados públicos da loja para a tela de login (nome).
  if (p === '/api/store' && req.method === 'GET') {
    const slug = (url.searchParams.get('slug') || '').toLowerCase();
    const s = SLUG_RE.test(slug) ? await getStore(env, slug) : null;
    return s ? json({ slug: s.id, name: s.name }) : json({ error: 'Loja não encontrada' }, 404);
  }

  // Criar loja nova (cadastro aberto, com dias grátis).
  if (p === '/api/stores' && req.method === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') || '';
    if (!isMaster(env, req)) {
      const recent = await env.DB.prepare('SELECT COUNT(*) n FROM stores WHERE created_ip = ? AND created_at > ?').bind(ip, Date.now() - DAY).first<{ n: number }>();
      if ((recent?.n || 0) >= 3) return json({ error: 'Muitas lojas criadas a partir desta internet hoje. Tente amanhã ou fale com o suporte.' }, 429);
    }
    const body = await req.json<{ slug?: string; name?: string; email?: string; phone?: string; records?: PushRecord[] }>();
    let slug = (body.slug || '').toLowerCase();
    if (RESERVED.has(slug)) slug = `${slug}-loja`;
    if (!SLUG_RE.test(slug) || RESERVED.has(slug)) return json({ error: 'Código da loja inválido. Use letras minúsculas, números e hífen (3 a 40).' }, 400);
    if (!body.name?.trim()) return json({ error: 'Informe o nome da loja' }, 400);
    const email = (body.email || '').trim().toLowerCase();
    if (email && (await findUserByEmail(env, email))) return json({ error: 'Este e-mail já tem uma loja. Use "Entrar" com ele.' }, 409);
    // Código interno da loja: se já existir, acrescenta um número.
    let free = slug;
    for (let n = 2; await getStore(env, free); n++) {
      if (n > 50) return json({ error: 'Escolha outro nome de loja' }, 409);
      free = `${slug.slice(0, 36)}-${n}`;
    }
    slug = free;
    const trialDays = Math.max(0, Number(env.TRIAL_DAYS ?? 7) || 7);
    const stmt = upsertStmt(env);
    const recs = (Array.isArray(body.records) ? body.records : []).filter(validRecord).slice(0, 20);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO stores (id, name, email, phone, created_at, created_ip, trial_ends) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(slug, body.name.trim().slice(0, 80), (body.email || '').trim().slice(0, 120) || null, (body.phone || '').trim().slice(0, 30) || null, Date.now(), ip, Date.now() + trialDays * DAY),
      ...recs.map((r) => stmt.bind(slug, r.tbl, r.id, JSON.stringify(r.data), Math.floor(r.updatedAt), r.deleted ? 1 : 0)),
    ]);
    return json({ ok: true, slug, trialDays, token: await makeToken(env, slug), license: licenseOf(env, (await getStore(env, slug))!) });
  }

  // Login, passo 1: o "sal" da senha. Para usuário que não existe, devolve um sal falso e estável.
  if (p === '/api/salt' && req.method === 'GET') {
    const slug = (url.searchParams.get('slug') || '').toLowerCase();
    const login = (url.searchParams.get('login') || url.searchParams.get('email') || '').trim().toLowerCase();
    const u = slug ? (SLUG_RE.test(slug) ? await findUser(env, slug, login) : null) : await findUserByEmail(env, login);
    return json({ salt: u ? u.salt : (await hmac(env, `fake-salt:${slug}:${login}`)).slice(0, 36) });
  }

  // Login, passo 2: o aparelho manda a senha já embaralhada (PBKDF2) e recebe o acesso da loja.
  if (p === '/api/login' && req.method === 'POST') {
    const body = await req.json<{ slug?: string; login?: string; email?: string; passHash?: string }>();
    let slug = (body.slug || '').toLowerCase();
    let u: UserData | null = null;
    if (slug) {
      u = SLUG_RE.test(slug) ? await findUser(env, slug, (body.login || '').trim().toLowerCase()) : null;
    } else {
      const f = await findUserByEmail(env, (body.email || body.login || '').trim().toLowerCase());
      if (f) { u = f; slug = f.storeId; }
    }
    if (!u || !safeEqual(body.passHash || '', u.passHash)) return json({ error: 'E-mail ou senha incorretos' }, 401);
    const s = await getStore(env, slug);
    return json({ slug, storeName: s?.name, token: await makeToken(env, slug), user: { id: u.id, name: u.name, role: u.role }, license: s ? licenseOf(env, s) : null });
  }

  // ---------- Painel do dono (chave mestra) ----------
  if (p.startsWith('/api/admin/')) {
    if (!isMaster(env, req)) return json({ error: 'Chave mestra inválida' }, 401);
    if (p === '/api/admin/stores' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM stores ORDER BY created_at DESC LIMIT 500').all<StoreRow>();
      return json({ stores: results.map((s) => ({ id: s.id, name: s.name, email: s.email, phone: s.phone, createdAt: s.created_at, ...licenseOf(env, s), blocked: !!s.blocked })) });
    }
    if (p === '/api/admin/keys' && req.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT * FROM licenses ORDER BY created_at DESC LIMIT 500').all();
      return json({ keys: results });
    }
    if (p === '/api/admin/keys' && req.method === 'POST') {
      const b = await req.json<{ days?: number; count?: number; note?: string }>();
      const days = Math.round(Number(b.days) || 0);
      const count = Math.min(100, Math.max(1, Math.round(Number(b.count) || 1)));
      if (days < 1 || days > 3660) return json({ error: 'Dias inválidos' }, 400);
      const codes = Array.from({ length: count }, newKey);
      const stmt = env.DB.prepare('INSERT INTO licenses (code, days, note, created_at) VALUES (?, ?, ?, ?)');
      await env.DB.batch(codes.map((c) => stmt.bind(c, days, (b.note || '').slice(0, 120) || null, Date.now())));
      return json({ codes, days });
    }
    if (p === '/api/admin/extend' && req.method === 'POST') {
      const b = await req.json<{ slug?: string; days?: number }>();
      const s = await getStore(env, (b.slug || '').toLowerCase());
      if (!s) return json({ error: 'Loja não encontrada' }, 404);
      return json(licenseOf(env, await extendStore(env, s, Math.round(Number(b.days) || 0))));
    }
    if (p === '/api/admin/block' && req.method === 'POST') {
      const b = await req.json<{ slug?: string; blocked?: boolean }>();
      await env.DB.prepare('UPDATE stores SET blocked = ? WHERE id = ?').bind(b.blocked ? 1 : 0, (b.slug || '').toLowerCase()).run();
      return json({ ok: true });
    }
    const cat = await catalogApi(req, env, url, null, true);
    if (cat) return cat;
    return json({ error: 'Não encontrado' }, 404);
  }

  // Daqui para baixo: precisa do acesso da loja.
  const storeId = await readToken(env, req);
  if (!storeId) return json({ error: 'Acesso expirado. Entre de novo.' }, 401);
  if (p === '/health') return json({ ok: true, store: storeId });

  for (const handler of [catalogApi(req, env, url, storeId, false), secretsApi(req, env, url, storeId), paymentsApi(req, env, url, storeId), whatsappApi(req, env, url, storeId)]) {
    const res = await handler;
    if (res) return res;
  }

  // Situação da licença da loja.
  if (p === '/api/license' && req.method === 'GET') {
    const s = await getStore(env, storeId);
    return s ? json(licenseOf(env, s)) : json({ error: 'Loja não encontrada' }, 404);
  }

  // Ativar com chave: soma os dias da chave à loja.
  if (p === '/api/activate' && req.method === 'POST') {
    const code = ((await req.json<{ code?: string }>()).code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pretty = code.length === 16 && code.startsWith('VPDV') ? `VPDV-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12, 16)}` : '';
    const lic = pretty ? await env.DB.prepare('SELECT * FROM licenses WHERE code = ?').bind(pretty).first<{ code: string; days: number; used_by: string | null }>() : null;
    if (!lic) return json({ error: 'Chave de ativação inválida' }, 400);
    if (lic.used_by) return json({ error: lic.used_by === storeId ? 'Esta chave já foi usada nesta loja' : 'Esta chave já foi usada' }, 409);
    const upd = await env.DB.prepare('UPDATE licenses SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL').bind(storeId, Date.now(), pretty).run();
    if (!upd.meta.changes) return json({ error: 'Esta chave já foi usada' }, 409);
    const s = await getStore(env, storeId);
    if (!s) return json({ error: 'Loja não encontrada' }, 404);
    return json({ ...licenseOf(env, await extendStore(env, s, lic.days)), added: lic.days });
  }
  if (p === '/sync/push' && req.method === 'POST') return push(env, storeId, await req.json());
  if (p === '/sync/pull' && req.method === 'GET') return pull(env, storeId, url);
  return json({ error: 'Não encontrado' }, 404);
}

export default {
  // De hora em hora: resumo do dia no WhatsApp das lojas.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sendDailySummaries(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const isApi = p === '/health' || p.startsWith('/sync/') || p.startsWith('/api/');
    if (isApi) {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (!env.API_KEY) return json({ error: 'Servidor sem chave mestra configurada' }, 500);
      try {
        return await api(req, env, url);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : 'Erro' }, 500);
      }
    }
    // Site: arquivos que existem já saem direto. Qualquer outra tela (/pdv, /produtos…) abre o app.
    return env.ASSETS.fetch(new Request(`${url.origin}/`, { headers: req.headers }));
  },
};
