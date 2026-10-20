import Dexie, { type Table } from 'dexie';
import { STORE_SLUG } from './store';

// Campos comuns a todo registro que sincroniza com a nuvem.
export interface Synced {
  id: string;
  updatedAt: number;
  deleted: 0 | 1;
}

export interface Product extends Synced {
  barcode: string;
  internalCode?: string;
  description: string;
  brand?: string;
  manufacturer?: string;
  basket?: string; // cesta
  category?: string;
  subcategory?: string;
  content?: string; // conteúdo (ex.: 1 kg)
  unit: 'UN' | 'KG';
  cost: number;
  price: number;
  wholesalePrice?: number;
  wholesaleMinQty?: number;
  minStock: number;
  ncm?: string;
  cest?: string;
  cfop?: string;
  photo?: string; // data URL (jpeg pequeno)
  active: 0 | 1;
}

export interface Customer extends Synced {
  name: string;
  cpf?: string;
  phone?: string;
  address?: string;
  creditLimit: number;
  payDay?: number;
  notes?: string;
}

// Lançamentos do crediário: compra (debit) aumenta a dívida, pagamento diminui.
export interface CreditEntry extends Synced {
  customerId: string;
  type: 'debit' | 'payment';
  amount: number;
  saleId?: string;
  createdAt: number;
}

export type PaymentMethod =
  | 'dinheiro'
  | 'pix'
  | 'debito'
  | 'credito'
  | 'credito_parcelado'
  | 'vale'
  | 'crediario';

export interface SaleItem {
  productId: string;
  barcode: string;
  description: string;
  unit: 'UN' | 'KG';
  qty: number;
  unitPrice: number;
  total: number;
  canceled?: boolean;
}

export interface Payment {
  method: PaymentMethod;
  amount: number;
  installments?: number;
}

export interface Sale extends Synced {
  number: string;
  sessionId: string;
  operatorId: string;
  operatorName: string;
  customerId?: string;
  cpf?: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  payments: Payment[];
  change: number;
  status: 'completed' | 'canceled';
  createdAt: number;
}

export interface CashSession extends Synced {
  register: string;
  operatorId: string;
  operatorName: string;
  openedAt: number;
  openingAmount: number;
  closedAt?: number;
  countedAmount?: number;
  expectedCash?: number;
  notes?: string;
}

export interface CashMove extends Synced {
  sessionId: string;
  type: 'sangria' | 'suprimento';
  amount: number;
  reason?: string;
  createdAt: number;
}

// Estoque é a soma dos movimentos. Assim dois caixas vendendo ao mesmo tempo nunca se sobrescrevem.
export interface StockMove extends Synced {
  productId: string;
  qty: number;
  reason: 'inicial' | 'venda' | 'cancelamento' | 'ajuste' | 'entrada' | 'inventario';
  refId?: string;
  createdAt: number;
}

export interface User extends Synced {
  name: string;
  login: string;
  passHash: string;
  salt: string;
  role: 'admin' | 'gerente' | 'operador';
  active: 0 | 1;
}

// Configurações da loja (sincronizam entre aparelhos).
export interface Setting extends Synced {
  value: unknown;
}

// Configurações só deste aparelho (não sincronizam).
export interface DeviceConfig {
  key: string;
  value: unknown;
}

export interface OutboxEntry {
  seq?: number;
  table: SyncedTable;
  recordId: string;
  ts: number;
}

export interface StockCache {
  productId: string;
  qty: number;
}

export const SYNCED_TABLES = [
  'products',
  'customers',
  'creditEntries',
  'sales',
  'cashSessions',
  'cashMoves',
  'stockMoves',
  'users',
  'settings',
] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];

class VisionDB extends Dexie {
  products!: Table<Product, string>;
  customers!: Table<Customer, string>;
  creditEntries!: Table<CreditEntry, string>;
  sales!: Table<Sale, string>;
  cashSessions!: Table<CashSession, string>;
  cashMoves!: Table<CashMove, string>;
  stockMoves!: Table<StockMove, string>;
  users!: Table<User, string>;
  settings!: Table<Setting, string>;
  device!: Table<DeviceConfig, string>;
  outbox!: Table<OutboxEntry, number>;
  stockCache!: Table<StockCache, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      products: 'id, barcode, internalCode, description, category, updatedAt',
      customers: 'id, name, cpf, phone, updatedAt',
      creditEntries: 'id, customerId, createdAt, updatedAt',
      sales: 'id, number, sessionId, createdAt, customerId, status, updatedAt',
      cashSessions: 'id, register, openedAt, closedAt, updatedAt',
      cashMoves: 'id, sessionId, createdAt, updatedAt',
      stockMoves: 'id, productId, createdAt, updatedAt',
      users: 'id, login, updatedAt',
      settings: 'id, updatedAt',
      device: 'key',
      outbox: '++seq, [table+recordId]',
      stockCache: 'productId',
    });
  }
}

// Cada loja tem seu próprio banco no aparelho.
export const DB_NAME = 'vision-pdv-' + (STORE_SLUG || '_');
export const db = new VisionDB(DB_NAME);

export function uid(): string {
  return crypto.randomUUID();
}

/** Grava um registro local e o coloca na fila para enviar à nuvem. */
export async function save<T extends Synced>(table: SyncedTable, record: Omit<T, 'updatedAt' | 'deleted'> & Partial<Synced>): Promise<T> {
  const full = { deleted: 0, ...record, updatedAt: Date.now() } as T;
  await db.transaction('rw', db.table(table), db.outbox, db.stockCache, async () => {
    await db.table(table).put(full);
    await db.outbox.add({ table, recordId: full.id, ts: full.updatedAt });
    if (table === 'stockMoves') {
      await applyStockDelta((full as unknown as StockMove).productId, (full as unknown as StockMove).qty);
    }
  });
  return full;
}

/** Exclusão lógica: o registro some da tela, mas a exclusão também sincroniza. */
export async function remove(table: SyncedTable, id: string): Promise<void> {
  const current = await db.table(table).get(id);
  if (!current) return;
  await save(table, { ...current, deleted: 1 });
}

export async function applyStockDelta(productId: string, delta: number) {
  const row = await db.stockCache.get(productId);
  await db.stockCache.put({ productId, qty: round3((row?.qty ?? 0) + delta) });
}

export async function stockOf(productId: string): Promise<number> {
  return (await db.stockCache.get(productId))?.qty ?? 0;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row && !row.deleted ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown) {
  await save<Setting>('settings', { id: key, value });
}

export async function getDevice<T>(key: string, fallback: T): Promise<T> {
  const row = await db.device.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setDevice(key: string, value: unknown) {
  await db.device.put({ key, value });
}

export function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function round3(n: number) {
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
}
