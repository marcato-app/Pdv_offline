// Servidor de sincronização do Vision PDV (Cloudflare Worker + D1).
// Os aparelhos enviam o que mudou (/sync/push) e baixam o que os outros mudaram (/sync/pull).

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  API_KEY: string;
  STORE_ID: string;
}

const TABLES = new Set(['products', 'customers', 'creditEntries', 'sales', 'cashSessions', 'cashMoves', 'stockMoves', 'users', 'settings']);
const MAX_PUSH = 500;
const MAX_PULL = 1000;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, x-api-key',
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

interface PushRecord {
  tbl: string;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: 0 | 1;
}

async function push(env: Env, body: { records?: PushRecord[] }) {
  const records = Array.isArray(body.records) ? body.records : [];
  if (records.length > MAX_PUSH) return json({ error: `Máximo de ${MAX_PUSH} registros por envio` }, 413);
  const store = env.STORE_ID;
  const stmt = env.DB.prepare(
    `INSERT INTO records (store_id, tbl, id, data, updated_at, deleted, seq)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, (SELECT COALESCE(MAX(seq), 0) + 1 FROM records WHERE store_id = ?1))
     ON CONFLICT (store_id, tbl, id) DO UPDATE SET
       data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq
     WHERE excluded.updated_at > records.updated_at`,
  );
  const batch: D1PreparedStatement[] = [];
  for (const r of records) {
    if (!TABLES.has(r.tbl) || typeof r.id !== 'string' || !r.id || typeof r.updatedAt !== 'number') continue;
    batch.push(stmt.bind(store, r.tbl, r.id, JSON.stringify(r.data), Math.floor(r.updatedAt), r.deleted ? 1 : 0));
  }
  if (batch.length) await env.DB.batch(batch);
  return json({ ok: true, accepted: batch.length });
}

async function pull(env: Env, url: URL) {
  const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
  const limit = Math.min(MAX_PULL, Math.max(1, Number(url.searchParams.get('limit')) || 500));
  const { results } = await env.DB.prepare(
    `SELECT tbl, id, data, updated_at, deleted, seq FROM records WHERE store_id = ? AND seq > ? ORDER BY seq LIMIT ?`,
  ).bind(env.STORE_ID, since, limit + 1).all<{ tbl: string; id: string; data: string; updated_at: number; deleted: number; seq: number }>();
  const more = results.length > limit;
  const rows = more ? results.slice(0, limit) : results;
  return json({
    records: rows.map((r) => ({ tbl: r.tbl, id: r.id, data: JSON.parse(r.data), updatedAt: r.updated_at, deleted: r.deleted })),
    cursor: rows.length ? rows[rows.length - 1].seq : since,
    more,
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const isApi = url.pathname === '/health' || url.pathname.startsWith('/sync/');
    // Tudo que não é da API é o site (arquivos da pasta app/dist).
    if (!isApi) return env.ASSETS.fetch(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (!env.API_KEY) return json({ error: 'API_KEY não configurada no servidor' }, 500);
    if (!safeEqual(req.headers.get('x-api-key') || '', env.API_KEY)) return json({ error: 'Chave de acesso inválida' }, 401);
    try {
      if (url.pathname === '/health') return json({ ok: true, store: env.STORE_ID });
      if (url.pathname === '/sync/push' && req.method === 'POST') return await push(env, await req.json());
      if (url.pathname === '/sync/pull' && req.method === 'GET') return await pull(env, url);
      return json({ error: 'Não encontrado' }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : 'Erro' }, 500);
    }
  },
};
