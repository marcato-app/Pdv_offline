import {
  db, save, uid, round2, round3, getDevice, setDevice, getSetting, SYNCED_TABLES,
  type Product, type Sale, type SaleItem, type Payment, type CashSession, type CashMove, type StockMove, type CreditEntry, type User, type PendingProduct,
} from './db';

const ALL = () => [...SYNCED_TABLES.map((t) => db.table(t)), db.outbox, db.stockCache];

export interface ScaleConfig {
  enabled: boolean;
  codeLength: number; // dígitos do código do produto depois do "2"
  mode: 'price' | 'weight';
}
export const DEFAULT_SCALE: ScaleConfig = { enabled: true, codeLength: 4, mode: 'price' };

export interface Found {
  product: Product;
  qty?: number; // vindo da etiqueta da balança
  total?: number;
}

const stripZeros = (s: string) => s.replace(/^0+/, '');

/** Procura por código de barras, código interno ou etiqueta de balança (EAN-13 começando com 2). */
export async function findProduct(code: string): Promise<Found | null> {
  const c = code.trim();
  if (!c) return null;
  const alive = (p?: Product) => p && !p.deleted && p.active ? p : undefined;
  const byBarcode = alive(await db.products.where('barcode').equals(c).first());
  if (byBarcode) return { product: byBarcode };
  const byInternal = alive(await db.products.where('internalCode').equals(c).first());
  if (byInternal) return { product: byInternal };

  const scale = await getSetting<ScaleConfig>('scale', DEFAULT_SCALE);
  if (scale.enabled && /^2\d{12}$/.test(c)) {
    const pcode = c.slice(1, 1 + scale.codeLength);
    const value = Number(c.slice(1 + scale.codeLength, 12));
    const candidates = await db.products.filter((p) => !p.deleted && !!p.active && !!p.internalCode && stripZeros(p.internalCode) === stripZeros(pcode)).toArray();
    const product = candidates[0];
    if (product) {
      if (scale.mode === 'price') {
        const total = round2(value / 100);
        return { product, total, qty: product.price > 0 ? round3(total / product.price) : 1 };
      }
      const qty = round3(value / 1000);
      return { product, qty, total: round2(qty * product.price) };
    }
  }
  return null;
}

export function priceFor(p: Product, qty: number) {
  if (p.wholesalePrice && p.wholesaleMinQty && qty >= p.wholesaleMinQty) return p.wholesalePrice;
  return p.price;
}

export function makeItem(p: Product, qty: number, forcedTotal?: number): SaleItem {
  const unitPrice = priceFor(p, qty);
  return {
    productId: p.id,
    barcode: p.barcode,
    description: p.description,
    unit: p.unit,
    qty,
    unitPrice,
    total: forcedTotal ?? round2(unitPrice * qty),
    cost: p.cost || 0,
  };
}

// ---------- Itens lançados à mão ----------

export interface QuickItem {
  id: string;
  label: string;
  price?: number; // valor sugerido
}

export const DEFAULT_QUICK_ITEMS: QuickItem[] = [
  { id: 'avulso', label: 'Valor avulso' },
  { id: 'entrega', label: 'Taxa de entrega', price: 5 },
  { id: 'sacola', label: 'Sacola', price: 0.2 },
];

export function makeManualItem(kind: 'avulso' | 'naocadastrado', description: string, unitPrice: number, qty = 1, barcode = ''): SaleItem {
  return {
    productId: kind === 'avulso' ? `av:${description}` : `nc:${barcode}`,
    barcode,
    description: description.toUpperCase(),
    unit: 'UN',
    qty,
    unitPrice: round2(unitPrice),
    total: round2(unitPrice * qty),
    kind,
    cost: 0,
  };
}

/** Quando um produto que era "não cadastrado" ganha cadastro: as vendas antigas passam a contar para ele nos relatórios. */
export async function resolvePending(pending: PendingProduct, product: Product) {
  const sales = await db.sales.filter((s) => !s.deleted && s.status === 'completed' && s.items.some((i) => i.kind === 'naocadastrado' && i.barcode === pending.barcode)).toArray();
  await db.transaction('rw', ALL(), async () => {
    for (const sale of sales) {
      const items = sale.items.map((i) => {
        if (i.kind !== 'naocadastrado' || i.barcode !== pending.barcode) return i;
        return { ...i, productId: product.id, description: product.description, kind: undefined, cost: product.cost || 0 };
      });
      // O estoque não muda aqui: no cadastro, a pessoa informa a quantidade que tem hoje (as vendas já saíram).
      await save<Sale>('sales', { ...sale, items });
    }
    await save<PendingProduct>('pendingProducts', { ...pending, resolvedProductId: product.id, deleted: 1 });
  });
  return sales.length;
}

export async function searchProducts(term: string, limit = 30) {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  return db.products
    .filter((p) => !p.deleted && (p.description.toLowerCase().includes(t) || p.barcode.includes(t) || (p.brand || '').toLowerCase().includes(t) || p.internalCode === t))
    .limit(limit)
    .toArray();
}

export async function nextSaleNumber() {
  const reg = await getDevice<string>('register', '01');
  const seq = (await getDevice<number>('saleSeq', 0)) + 1;
  await setDevice('saleSeq', seq);
  return `${reg}-${String(seq).padStart(6, '0')}`;
}

export async function finalizeSale(args: {
  session: CashSession;
  operator: User;
  items: SaleItem[];
  discount: number;
  payments: Payment[];
  customerId?: string;
  cpf?: string;
}): Promise<Sale> {
  const items = args.items.filter((i) => !i.canceled);
  const subtotal = round2(items.reduce((s, i) => s + i.total, 0));
  const total = round2(subtotal - args.discount);
  const paid = round2(args.payments.reduce((s, p) => s + p.amount, 0));
  const cashPaid = args.payments.filter((p) => p.method === 'dinheiro').reduce((s, p) => s + p.amount, 0);
  const change = round2(Math.max(0, Math.min(cashPaid, paid - total)));
  if (paid + 0.001 < total) throw new Error('Pagamento menor que o total');
  const number = await nextSaleNumber();
  const now = Date.now();
  const sale: Sale = {
    id: uid(), updatedAt: now, deleted: 0, number,
    sessionId: args.session.id, operatorId: args.operator.id, operatorName: args.operator.name,
    customerId: args.customerId, cpf: args.cpf, items: args.items, subtotal, discount: round2(args.discount), total,
    payments: args.payments, change, status: 'completed', createdAt: now,
  };
  await db.transaction('rw', ALL(), async () => {
    await save<Sale>('sales', sale);
    for (const it of items) {
      if (it.kind === 'avulso') continue;
      if (it.kind === 'naocadastrado') {
        // Guarda o produto bipado sem cadastro para avisar na tela de produtos.
        const prev = await db.pendingProducts.where('barcode').equals(it.barcode).filter((x) => !x.deleted).first();
        await save<PendingProduct>('pendingProducts', {
          id: prev?.id || uid(), barcode: it.barcode, description: it.description, lastPrice: it.unitPrice,
          qty: round3((prev?.qty || 0) + it.qty), timesSold: (prev?.timesSold || 0) + 1, firstSeen: prev?.firstSeen || now, lastSeen: now,
        });
        continue;
      }
      await save<StockMove>('stockMoves', { id: uid(), productId: it.productId, qty: -it.qty, reason: 'venda', refId: sale.id, createdAt: now });
    }
    const fiado = args.payments.filter((p) => p.method === 'crediario').reduce((s, p) => s + p.amount, 0);
    if (fiado > 0 && args.customerId) {
      await save<CreditEntry>('creditEntries', { id: uid(), customerId: args.customerId, type: 'debit', amount: round2(fiado), saleId: sale.id, createdAt: now });
    }
  });
  return sale;
}

export async function cancelSale(sale: Sale) {
  if (sale.status === 'canceled') return;
  const now = Date.now();
  await db.transaction('rw', ALL(), async () => {
    await save<Sale>('sales', { ...sale, status: 'canceled' });
    for (const it of sale.items.filter((i) => !i.canceled && !i.kind)) {
      await save<StockMove>('stockMoves', { id: uid(), productId: it.productId, qty: it.qty, reason: 'cancelamento', refId: sale.id, createdAt: now });
    }
    const entries = await db.creditEntries.where('customerId').equals(sale.customerId || '-').toArray();
    for (const e of entries.filter((x) => x.saleId === sale.id && !x.deleted)) {
      await save<CreditEntry>('creditEntries', { ...e, deleted: 1 });
    }
  });
}

// ---------- Caixa ----------

export async function currentSession(): Promise<CashSession | null> {
  const id = await getDevice<string | null>('sessionId', null);
  if (!id) return null;
  const s = await db.cashSessions.get(id);
  return s && !s.closedAt && !s.deleted ? s : null;
}

export async function openSession(operator: User, openingAmount: number) {
  const register = await getDevice<string>('register', '01');
  const s = await save<CashSession>('cashSessions', {
    id: uid(), register, operatorId: operator.id, operatorName: operator.name, openedAt: Date.now(), openingAmount: round2(openingAmount),
  });
  await setDevice('sessionId', s.id);
  return s;
}

export async function addCashMove(session: CashSession, type: CashMove['type'], amount: number, reason?: string) {
  return save<CashMove>('cashMoves', { id: uid(), sessionId: session.id, type, amount: round2(amount), reason, createdAt: Date.now() });
}

export interface SessionSummary {
  byMethod: Record<string, number>;
  salesCount: number;
  canceledCount: number;
  total: number;
  sangrias: number;
  suprimentos: number;
  expectedCash: number;
}

export async function sessionSummary(session: CashSession): Promise<SessionSummary> {
  const sales = await db.sales.where('sessionId').equals(session.id).filter((s) => !s.deleted).toArray();
  const moves = await db.cashMoves.where('sessionId').equals(session.id).filter((m) => !m.deleted).toArray();
  const byMethod: Record<string, number> = {};
  let total = 0, count = 0, canceled = 0;
  for (const s of sales) {
    if (s.status === 'canceled') { canceled++; continue; }
    count++;
    total += s.total;
    for (const p of s.payments) byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
    if (s.change) byMethod.dinheiro = (byMethod.dinheiro || 0) - s.change;
  }
  const sangrias = moves.filter((m) => m.type === 'sangria').reduce((a, m) => a + m.amount, 0);
  const suprimentos = moves.filter((m) => m.type === 'suprimento').reduce((a, m) => a + m.amount, 0);
  Object.keys(byMethod).forEach((k) => (byMethod[k] = round2(byMethod[k])));
  return {
    byMethod, salesCount: count, canceledCount: canceled, total: round2(total),
    sangrias: round2(sangrias), suprimentos: round2(suprimentos),
    expectedCash: round2(session.openingAmount + (byMethod.dinheiro || 0) + suprimentos - sangrias),
  };
}

export async function closeSession(session: CashSession, countedAmount: number, notes?: string) {
  const sum = await sessionSummary(session);
  const closed = await save<CashSession>('cashSessions', {
    ...session, closedAt: Date.now(), countedAmount: round2(countedAmount), expectedCash: sum.expectedCash, notes,
  });
  await setDevice('sessionId', null);
  return { closed, sum };
}

// ---------- Estoque ----------

export async function setStock(productId: string, newQty: number, current: number, reason: StockMove['reason'] = 'ajuste') {
  const delta = round3(newQty - current);
  if (!delta) return;
  await save<StockMove>('stockMoves', { id: uid(), productId, qty: delta, reason, createdAt: Date.now() });
}

export async function addStock(productId: string, qty: number, reason: StockMove['reason'] = 'entrada', refId?: string) {
  if (!qty) return;
  await save<StockMove>('stockMoves', { id: uid(), productId, qty: round3(qty), reason, refId, createdAt: Date.now() });
}

export async function customerBalance(customerId: string) {
  const entries = await db.creditEntries.where('customerId').equals(customerId).filter((e) => !e.deleted).toArray();
  return round2(entries.reduce((s, e) => s + (e.type === 'debit' ? e.amount : -e.amount), 0));
}
