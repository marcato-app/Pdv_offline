import Dexie, { type Table } from 'dexie';
import { db, SYNCED_TABLES, getDevice, setDevice } from './db';
import { STORE_SLUG } from './store';

// Ponte com o app de Windows (Electron). No site e no celular ela não existe.
interface DesktopBridge {
  saveBackup(name: string, content: string): Promise<string>;
  listBackups(): Promise<{ name: string; size: number; mtime: number }[]>;
  readBackup(name: string): Promise<string>;
  openBackupFolder(): Promise<void>;
  backupFolder(): Promise<string>;
}

declare global {
  interface Window {
    visionDesktop?: DesktopBridge;
  }
}

export const desktop = () => window.visionDesktop;

// No site e no celular, os backups ficam num banco separado do principal.
class BackupDB extends Dexie {
  files!: Table<{ name: string; createdAt: number; content: string }, string>;
  constructor() {
    super('vision-pdv-backups-' + (STORE_SLUG || '_'));
    this.version(1).stores({ files: 'name, createdAt' });
  }
}
const backupDb = new BackupDB();
const KEEP = 30;

export async function exportData(): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const t of SYNCED_TABLES) data[t] = await db.table(t).toArray();
  data.stockCache = await db.stockCache.toArray();
  return JSON.stringify({ app: 'vision-pdv', version: 1, createdAt: Date.now(), data });
}

export async function importData(json: string) {
  const parsed = JSON.parse(json);
  if (parsed?.app !== 'vision-pdv' || !parsed.data) throw new Error('Arquivo de backup inválido');
  await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.stockCache, db.outbox], async () => {
    for (const t of SYNCED_TABLES) {
      await db.table(t).clear();
      const rows = parsed.data[t] || [];
      if (rows.length) await db.table(t).bulkPut(rows);
      // Reenvia tudo para a nuvem, para a nuvem ficar igual ao backup restaurado.
      await db.outbox.bulkAdd(rows.map((r: { id: string }) => ({ table: t, recordId: r.id, ts: Date.now() })));
    }
    await db.stockCache.clear();
    if (parsed.data.stockCache?.length) await db.stockCache.bulkPut(parsed.data.stockCache);
  });
}

function backupName(reason: string) {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `vision-pdv_${STORE_SLUG}_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}_${reason}.json`;
}

export async function makeBackup(reason: 'auto' | 'manual' | 'fechamento' = 'manual') {
  const content = await exportData();
  const name = backupName(reason);
  const bridge = desktop();
  if (bridge) {
    await bridge.saveBackup(name, content);
  } else {
    await backupDb.files.put({ name, createdAt: Date.now(), content });
    const all = await backupDb.files.orderBy('createdAt').reverse().toArray();
    for (const old of all.slice(KEEP)) await backupDb.files.delete(old.name);
  }
  await setDevice('lastBackup', Date.now());
  return name;
}

export async function listBackups(): Promise<{ name: string; createdAt: number; size: number }[]> {
  const bridge = desktop();
  if (bridge) return (await bridge.listBackups()).map((b) => ({ name: b.name, createdAt: b.mtime, size: b.size }));
  const all = await backupDb.files.orderBy('createdAt').reverse().toArray();
  return all.map((b) => ({ name: b.name, createdAt: b.createdAt, size: b.content.length }));
}

export async function readBackup(name: string) {
  const bridge = desktop();
  if (bridge) return bridge.readBackup(name);
  const f = await backupDb.files.get(name);
  if (!f) throw new Error('Backup não encontrado');
  return f.content;
}

export function downloadText(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Faz um backup automático por dia, no horário configurado (padrão 08:00) ou na primeira abertura depois dele. */
export function startAutoBackup() {
  const check = async () => {
    const last = await getDevice<number>('lastBackup', 0);
    const hour = await getDevice<number>('backupHour', 8);
    const now = new Date();
    const todayAt = new Date(now);
    todayAt.setHours(hour, 0, 0, 0);
    const due = now >= todayAt ? todayAt.getTime() : todayAt.getTime() - 86_400_000;
    if (last < due) {
      try {
        await makeBackup('auto');
      } catch (e) {
        console.error('Backup automático falhou', e);
      }
    }
  };
  check();
  setInterval(check, 10 * 60_000);
}
