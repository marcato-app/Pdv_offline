import { db, applyStockDelta, getDevice, setDevice, SYNCED_TABLES, type SyncedTable, type Synced } from './db';
import { API_BASE } from './store';

export interface SyncStatus {
  configured: boolean;
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSync: number | null;
  error: string | null;
}

let status: SyncStatus = { configured: false, online: navigator.onLine, syncing: false, pending: 0, lastSync: null, error: null };
const listeners = new Set<(s: SyncStatus) => void>();

function emit(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
}

export function getSyncStatus() {
  return status;
}

export function onSyncStatus(fn: (s: SyncStatus) => void) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export interface SyncConfig {
  url: string;
  token: string;
}

/** O acesso da loja (recebido no login pela nuvem) fica salvo neste aparelho. */
export async function getSyncConfig(): Promise<SyncConfig | null> {
  const token = await getDevice<string | null>('token', null);
  return token ? { url: API_BASE, token } : null;
}

export async function setToken(token: string | null) {
  await setDevice('token', token);
  if (!token) await setDevice('syncCursor', 0);
}

interface RemoteRecord {
  tbl: SyncedTable;
  id: string;
  data: Synced;
  updatedAt: number;
  deleted: 0 | 1;
}

async function request(cfg: SyncConfig, path: string, init?: RequestInit) {
  const res = await fetch(cfg.url + path, {
    signal: AbortSignal.timeout(20_000), // internet ruim não pode travar o sistema
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.token}`, ...(init?.headers || {}) },
  });
  if (res.status === 401) throw new Error('Acesso expirado. Saia e entre de novo.');
  if (!res.ok) throw new Error(`Servidor respondeu ${res.status}`);
  return res.json();
}

async function push(cfg: SyncConfig) {
  for (;;) {
    const batch = await db.outbox.orderBy('seq').limit(200).toArray();
    if (!batch.length) return;
    const seen = new Set<string>();
    const records: RemoteRecord[] = [];
    for (const e of batch) {
      const k = e.table + ':' + e.recordId;
      if (seen.has(k)) continue;
      seen.add(k);
      const data = (await db.table(e.table).get(e.recordId)) as Synced | undefined;
      if (data) records.push({ tbl: e.table, id: data.id, data, updatedAt: data.updatedAt, deleted: data.deleted });
    }
    if (records.length) await request(cfg, '/sync/push', { method: 'POST', body: JSON.stringify({ records }) });
    const maxSeq = batch[batch.length - 1].seq!;
    await db.outbox.where('seq').belowOrEqual(maxSeq).delete();
  }
}

async function pull(cfg: SyncConfig) {
  let cursor = await getDevice<number>('syncCursor', 0);
  for (;;) {
    const res: { records: RemoteRecord[]; cursor: number; more: boolean } = await request(cfg, `/sync/pull?since=${cursor}&limit=500`);
    await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.stockCache], async () => {
      for (const r of res.records) {
        if (!SYNCED_TABLES.includes(r.tbl)) continue;
        const table = db.table(r.tbl);
        const local = (await table.get(r.id)) as Synced | undefined;
        if (local && local.updatedAt >= r.updatedAt) continue;
        await table.put({ ...r.data, updatedAt: r.updatedAt, deleted: r.deleted });
        if (r.tbl === 'stockMoves' && !local && !r.deleted) {
          const m = r.data as unknown as { productId: string; qty: number };
          await applyStockDelta(m.productId, m.qty);
        }
      }
    });
    cursor = res.cursor;
    await setDevice('syncCursor', cursor);
    if (!res.more) return;
  }
}

let running: Promise<void> | null = null;

export function syncNow(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const cfg = await getSyncConfig();
    const pending = await db.outbox.count();
    emit({ configured: !!cfg, pending, online: navigator.onLine });
    if (!cfg || !navigator.onLine) return;
    emit({ syncing: true });
    try {
      await push(cfg);
      await pull(cfg);
      const { refreshLicense } = await import('./license');
      await refreshLicense();
      emit({ lastSync: Date.now(), error: null, online: true });
    } catch (e) {
      emit({ error: e instanceof Error ? e.message : String(e), online: navigator.onLine });
    } finally {
      emit({ syncing: false, pending: await db.outbox.count() });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function testConnection() {
  const cfg = await getSyncConfig();
  if (!cfg) throw new Error('Este aparelho ainda não entrou na nuvem');
  return request(cfg, '/health');
}

export function startSyncLoop() {
  syncNow();
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => emit({ online: false }));
  setInterval(() => syncNow(), 20_000);
  db.outbox.hook('creating', () => {
    setTimeout(() => emit({ pending: status.pending + 1 }), 0);
  });
}
