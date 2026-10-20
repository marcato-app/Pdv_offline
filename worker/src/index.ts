// Servidor do Vision PDV (Cloudflare Worker + D1).
// - Entrega o site. Cada loja tem seu link: /codigo-da-loja/
// - API: criar loja, login na nuvem e sincronização dos aparelhos.

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  API_KEY: string; // chave mestra: só quem tem cria lojas novas
}

const TABLES = new Set(['products', 'customers', 'creditEntries', 'sales', 'cashSessions', 'cashMoves', 'stockMoves', 'users', 'settings']);
const MAX_PUSH = 500;
const MAX_PULL = 1000;
const TOKEN_DAYS = 365;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['api', 'sync', 'health', 'assets', 'admin', 'www', 'app', 'static']);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization, x-master-key',
  'access-control-max-age': '86400',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });

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

async function getStore(env: Env, slug: string) {
  return env.DB.prepare('SELECT id, name FROM stores WHERE id = ?').bind(slug).first<{ id: string; name: string }>();
}

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

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const p = url.pathname;

  // Dados públicos da loja para a tela de login (nome).
  if (p === '/api/store' && req.method === 'GET') {
    const slug = (url.searchParams.get('slug') || '').toLowerCase();
    const s = SLUG_RE.test(slug) ? await getStore(env, slug) : null;
    return s ? json({ slug: s.id, name: s.name }) : json({ error: 'Loja não encontrada' }, 404);
  }

  // Criar loja nova: precisa da chave mestra.
  if (p === '/api/stores' && req.method === 'POST') {
    if (!safeEqual(req.headers.get('x-master-key') || '', env.API_KEY)) return json({ error: 'Chave mestra inválida' }, 401);
    const body = await req.json<{ slug?: string; name?: string; records?: PushRecord[] }>();
    const slug = (body.slug || '').toLowerCase();
    if (!SLUG_RE.test(slug) || RESERVED.has(slug)) return json({ error: 'Código da loja inválido. Use letras minúsculas, números e hífen (3 a 40).' }, 400);
    if (!body.name?.trim()) return json({ error: 'Informe o nome da loja' }, 400);
    if (await getStore(env, slug)) return json({ error: 'Este código já está em uso' }, 409);
    const stmt = upsertStmt(env);
    const recs = (Array.isArray(body.records) ? body.records : []).filter(validRecord).slice(0, 20);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO stores (id, name, created_at) VALUES (?, ?, ?)').bind(slug, body.name.trim(), Date.now()),
      ...recs.map((r) => stmt.bind(slug, r.tbl, r.id, JSON.stringify(r.data), Math.floor(r.updatedAt), r.deleted ? 1 : 0)),
    ]);
    return json({ ok: true, slug, token: await makeToken(env, slug) });
  }

  // Login, passo 1: o "sal" da senha. Para usuário que não existe, devolve um sal falso e estável.
  if (p === '/api/salt' && req.method === 'GET') {
    const slug = (url.searchParams.get('slug') || '').toLowerCase();
    const login = (url.searchParams.get('login') || '').trim().toLowerCase();
    const u = SLUG_RE.test(slug) ? await findUser(env, slug, login) : null;
    return json({ salt: u ? u.salt : (await hmac(env, `fake-salt:${slug}:${login}`)).slice(0, 36) });
  }

  // Login, passo 2: o aparelho manda a senha já embaralhada (PBKDF2) e recebe o acesso da loja.
  if (p === '/api/login' && req.method === 'POST') {
    const body = await req.json<{ slug?: string; login?: string; passHash?: string }>();
    const slug = (body.slug || '').toLowerCase();
    const login = (body.login || '').trim().toLowerCase();
    const u = SLUG_RE.test(slug) ? await findUser(env, slug, login) : null;
    if (!u || !safeEqual(body.passHash || '', u.passHash)) return json({ error: 'Usuário ou senha incorretos' }, 401);
    return json({ token: await makeToken(env, slug), user: { id: u.id, name: u.name, role: u.role } });
  }

  // Daqui para baixo: precisa do acesso da loja.
  const storeId = await readToken(env, req);
  if (!storeId) return json({ error: 'Acesso expirado. Entre de novo.' }, 401);
  if (p === '/health') return json({ ok: true, store: storeId });
  if (p === '/sync/push' && req.method === 'POST') return push(env, storeId, await req.json());
  if (p === '/sync/pull' && req.method === 'GET') return pull(env, storeId, url);
  return json({ error: 'Não encontrado' }, 404);
}

export default {
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
