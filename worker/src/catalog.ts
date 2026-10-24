// Banco de produtos compartilhado: ao digitar ou bipar um código de barras novo, o sistema já sabe
// nome, marca, categoria, NCM e foto. Fontes: planilha do dono, cadastros das lojas e bases públicas.

import type { Env } from './index';
import { json } from './util';

export interface CatalogItem {
  barcode: string;
  description?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  segment?: string | null;
  department?: string | null;
  category?: string | null;
  subcategory?: string | null;
  family?: string | null;
  basket?: string | null;
  content?: string | null;
  ncm?: string | null;
  photo?: string | null;
  source?: string | null;
}

const FIELDS = ['description', 'brand', 'manufacturer', 'segment', 'department', 'category', 'subcategory', 'family', 'basket', 'content', 'ncm', 'photo'] as const;
const CODE_RE = /^\d{8,14}$/;
const clean = (v: unknown, max = 160) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function normalize(x: CatalogItem): CatalogItem | null {
  const barcode = String(x.barcode || '').replace(/\D/g, '');
  if (!CODE_RE.test(barcode)) return null;
  const out: CatalogItem = { barcode };
  for (const f of FIELDS) out[f] = clean(x[f], f === 'photo' ? 400 : 160);
  if (out.photo && !/^https:\/\//.test(out.photo)) out.photo = null; // só links de imagem, nunca arquivos
  return out;
}

/** Grava no banco. `overwrite`: a planilha do dono manda; senão só preenche o que estiver vazio. */
async function upsert(env: Env, items: CatalogItem[], source: string, overwrite: boolean) {
  const set = FIELDS.map((f) => (overwrite ? `${f} = COALESCE(excluded.${f}, catalog.${f})` : `${f} = COALESCE(catalog.${f}, excluded.${f})`)).join(', ');
  const stmt = env.DB.prepare(
    `INSERT INTO catalog (barcode, ${FIELDS.join(', ')}, source, uses, updated_at)
     VALUES (?1, ${FIELDS.map((_, i) => `?${i + 2}`).join(', ')}, ?${FIELDS.length + 2}, 1, ?${FIELDS.length + 3})
     ON CONFLICT (barcode) DO UPDATE SET ${set}, uses = catalog.uses + 1, updated_at = excluded.updated_at`,
  );
  const now = Date.now();
  const batch = items.map((i) => stmt.bind(i.barcode, ...FIELDS.map((f) => i[f] ?? null), source, now));
  for (let k = 0; k < batch.length; k += 100) await env.DB.batch(batch.slice(k, k + 100));
}

async function fromOpenFoodFacts(code: string): Promise<CatalogItem | null> {
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_pt,brands,quantity,image_front_url,image_url`, {
      headers: { 'user-agent': 'VisionPDV/1.0 (visionpdv.marcatoapp.com.br)' },
      cf: { cacheTtl: 86400 },
    });
    if (!r.ok) return null;
    const d = await r.json<{ status: number; product?: Record<string, string> }>();
    if (d.status !== 1 || !d.product) return null;
    const p = d.product;
    const name = p.product_name_pt || p.product_name;
    if (!name) return null;
    return normalize({ barcode: code, description: name, brand: (p.brands || '').split(',')[0], content: p.quantity, photo: p.image_front_url || p.image_url, source: 'openfoodfacts' });
  } catch {
    return null;
  }
}

async function fromCosmos(env: Env, code: string): Promise<CatalogItem | null> {
  if (!env.COSMOS_TOKEN) return null;
  try {
    const r = await fetch(`https://api.cosmos.bluesoft.com.br/gtins/${code}.json`, {
      headers: { 'X-Cosmos-Token': env.COSMOS_TOKEN, 'user-agent': 'Cosmos-API-Request' },
    });
    if (!r.ok) return null;
    const d = await r.json<{ description?: string; brand?: { name?: string }; ncm?: { code?: string }; thumbnail?: string; gpc?: { description?: string } }>();
    if (!d.description) return null;
    return normalize({ barcode: code, description: d.description, brand: d.brand?.name, ncm: d.ncm?.code, photo: d.thumbnail, category: d.gpc?.description, source: 'cosmos' });
  } catch {
    return null;
  }
}

/** Uma loja cadastrou um produto: alimenta o banco compartilhado (só completa o que falta). */
export async function contributeToCatalog(env: Env, items: CatalogItem[]) {
  const ok = items.map(normalize).filter(Boolean) as CatalogItem[];
  if (ok.length) await upsert(env, ok.slice(0, 200), 'loja', false);
  return ok.length;
}

export async function catalogApi(req: Request, env: Env, url: URL, storeId: string | null, isMaster: boolean): Promise<Response | null> {
  const p = url.pathname;

  // Procurar um código de barras.
  const m = p.match(/^\/api\/catalog\/(\d{8,14})$/);
  if (m && req.method === 'GET') {
    if (!storeId) return json({ error: 'Acesso expirado' }, 401);
    const code = m[1];
    const row = await env.DB.prepare('SELECT * FROM catalog WHERE barcode = ?').bind(code).first<CatalogItem>();
    if (row) return json({ found: true, item: row });
    const ext = (await fromCosmos(env, code)) || (await fromOpenFoodFacts(code));
    if (ext) {
      await upsert(env, [ext], ext.source || 'externo', false);
      return json({ found: true, item: ext });
    }
    return json({ found: false });
  }

  // Lojas enviam seus cadastros para completar o banco.
  if (p === '/api/catalog/contribute' && req.method === 'POST') {
    if (!storeId) return json({ error: 'Acesso expirado' }, 401);
    const b = await req.json<{ items?: CatalogItem[] }>();
    return json({ ok: true, accepted: await contributeToCatalog(env, Array.isArray(b.items) ? b.items : []) });
  }

  // Dono: subir a planilha de produtos para o banco compartilhado.
  if (p === '/api/admin/catalog' && req.method === 'POST') {
    if (!isMaster) return json({ error: 'Chave mestra inválida' }, 401);
    const b = await req.json<{ items?: CatalogItem[] }>();
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 2000).map(normalize).filter(Boolean) as CatalogItem[];
    await upsert(env, items, 'planilha', true);
    return json({ ok: true, accepted: items.length });
  }
  if (p === '/api/admin/catalog' && req.method === 'GET') {
    if (!isMaster) return json({ error: 'Chave mestra inválida' }, 401);
    const c = await env.DB.prepare('SELECT COUNT(*) n, SUM(photo IS NOT NULL) fotos FROM catalog').first<{ n: number; fotos: number }>();
    return json({ total: c?.n || 0, withPhoto: c?.fotos || 0 });
  }
  return null;
}
