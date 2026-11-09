// Relatórios para baixar em Excel: boletos, vendas (venda por venda e item por item) e custos fixos.
import * as XLSX from 'xlsx';
import { db, type Bill, type BillCategory, type Sale } from './db';
import { PAYMENT_LABELS } from './format';

export type ReportKind = 'boletos' | 'vendas' | 'custos' | 'tudo';

const CAT: Record<BillCategory, string> = { boleto: 'Boleto', fornecedor: 'Fornecedor', custo_fixo: 'Custo fixo', salario: 'Salário', imposto: 'Imposto', outro: 'Outro' };
const BOLETOS: BillCategory[] = ['boleto', 'fornecedor'];
const CUSTOS: BillCategory[] = ['custo_fixo', 'salario', 'imposto'];

const r2 = (n: number) => Math.round((n || 0) * 100) / 100;
const d = (ms?: number) => (ms ? new Date(ms) : '');
const hora = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('pt-BR');

function situacao(b: Bill, hoje: number) {
  if (b.paidAt) return 'Pago';
  if (b.dueDate < hoje) return 'Vencido';
  if (b.dueDate === hoje) return 'Vence hoje';
  return 'A pagar';
}

/** Planilha com cabeçalho, linhas e uma linha de total; formata datas e dinheiro. */
function sheet(rows: Record<string, unknown>[], money: string[], dates: string[], totals?: Record<string, unknown>) {
  const all = totals ? [...rows, {}, totals] : rows;
  const ws = XLSX.utils.json_to_sheet(all, { cellDates: true });
  const head = Object.keys(rows[0] || totals || {});
  const ref = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  head.forEach((h, c) => {
    for (let r = 1; r <= ref.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (!cell) continue;
      if (money.includes(h) && typeof cell.v === 'number') cell.z = '#,##0.00';
      if (dates.includes(h) && cell.v instanceof Date) cell.z = 'dd/mm/yyyy';
    }
  });
  ws['!cols'] = head.map((h) => ({ wch: Math.min(48, Math.max(h.length + 2, ...all.slice(0, 200).map((x) => String((x as Record<string, unknown>)[h] ?? '').length + 1))) }));
  return ws;
}

function billRows(bills: Bill[], hoje: number, emp: Map<string, string>) {
  return bills.map((b) => ({
    Vencimento: d(b.dueDate),
    Descrição: b.description,
    Tipo: CAT[b.category],
    'Fornecedor / funcionário': b.supplier || (b.employeeId ? emp.get(b.employeeId) || '' : ''),
    Valor: r2(b.amount),
    Situação: situacao(b, hoje),
    'Pago em': d(b.paidAt),
    'Valor pago': b.paidAt ? r2(b.paidAmount ?? b.amount) : '',
    'Todo mês': b.recurring ? 'Sim' : '',
    'Linha digitável': b.barcode || '',
    Observação: b.notes || '',
  }));
}

function billTotals(bills: Bill[]) {
  const total = bills.reduce((s, b) => s + b.amount, 0);
  const pago = bills.filter((b) => b.paidAt).reduce((s, b) => s + (b.paidAmount ?? b.amount), 0);
  const aberto = bills.filter((b) => !b.paidAt).reduce((s, b) => s + b.amount, 0);
  return { Vencimento: 'TOTAL', Descrição: `${bills.length} contas · pago ${r2(pago).toFixed(2).replace('.', ',')} · em aberto ${r2(aberto).toFixed(2).replace('.', ',')}`, Valor: r2(total) };
}

/** Resumo por tipo e por mês (custos fixos). */
function custoResumo(bills: Bill[]) {
  const by = new Map<string, number>();
  for (const b of bills) {
    const k = `${CAT[b.category]}|${b.description.trim().toUpperCase()}`;
    by.set(k, (by.get(k) || 0) + (b.paidAt ? b.paidAmount ?? b.amount : b.amount));
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ Tipo: k.split('|')[0], 'Custo fixo': k.split('|')[1], Total: r2(v) }));
}

function salesRows(sales: Sale[], cust: Map<string, string>) {
  return sales.map((s) => {
    const items = s.items.filter((i) => !i.canceled);
    const custo = items.reduce((t, i) => t + (i.cost || 0) * i.qty, 0);
    return {
      Data: d(s.createdAt),
      Hora: hora(s.createdAt),
      Venda: s.number,
      Situação: s.status === 'completed' ? 'Concluída' : 'Cancelada',
      Operador: s.operatorName,
      Cliente: s.customerId ? cust.get(s.customerId) || '' : '',
      CPF: s.cpf || '',
      Itens: items.length,
      Subtotal: r2(s.subtotal),
      Desconto: r2(s.discount),
      Total: r2(s.total),
      Custo: r2(custo),
      Lucro: s.status === 'completed' ? r2(s.total - custo) : 0,
      Pagamento: s.payments.map((p) => `${PAYMENT_LABELS[p.method] || p.method} ${r2(p.amount).toFixed(2).replace('.', ',')}${p.installments ? ` (${p.installments}x)` : ''}`).join(' + '),
      Troco: r2(s.change),
    };
  });
}

function itemRows(sales: Sale[]) {
  const out: Record<string, unknown>[] = [];
  for (const s of sales) for (const i of s.items) out.push({
    Data: d(s.createdAt), Hora: hora(s.createdAt), Venda: s.number, Situação: s.status === 'completed' && !i.canceled ? 'Vendido' : 'Cancelado',
    Código: i.barcode, Produto: i.description, Qtde: i.qty, Unid: i.unit, 'Preço unit.': r2(i.unitPrice), Total: r2(i.total), 'Custo unit.': r2(i.cost || 0), Lucro: r2(i.total - (i.cost || 0) * i.qty),
  });
  return out;
}

function dayRows(sales: Sale[]) {
  const by = new Map<string, { n: number; v: number; c: number; din: number; pix: number; card: number; outro: number }>();
  for (const s of sales.filter((x) => x.status === 'completed')) {
    const k = fmtDate(s.createdAt);
    const x = by.get(k) || { n: 0, v: 0, c: 0, din: 0, pix: 0, card: 0, outro: 0 };
    x.n++; x.v += s.total; x.c += s.items.filter((i) => !i.canceled).reduce((t, i) => t + (i.cost || 0) * i.qty, 0);
    let paid = 0;
    for (const p of s.payments) {
      const a = p.method === 'dinheiro' ? Math.min(p.amount, s.total - paid) : p.amount; paid += a;
      if (p.method === 'dinheiro') x.din += a; else if (p.method === 'pix') x.pix += a; else if (p.method.startsWith('credito') || p.method === 'debito') x.card += a; else x.outro += a;
    }
    by.set(k, x);
  }
  return [...by.entries()].map(([k, x]) => ({ Dia: k, Vendas: x.n, Faturamento: r2(x.v), 'Ticket médio': r2(x.v / x.n), Dinheiro: r2(x.din), PIX: r2(x.pix), Cartão: r2(x.card), 'Fiado/outros': r2(x.outro), Custo: r2(x.c), Lucro: r2(x.v - x.c) }));
}

/** Monta e baixa o relatório escolhido, no período [de, até] (datas à meia-noite, inclusive). */
export async function exportReport(kind: ReportKind, de: number, ate: number, storeName: string) {
  const fim = ate + 86_400_000;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const wb = XLSX.utils.book_new();
  const users = await db.users.toArray();
  const emp = new Map(users.map((u) => [u.id, u.name]));
  const add = (name: string, ws: XLSX.WorkSheet) => XLSX.utils.book_append_sheet(wb, ws, name);
  let count = 0;

  if (kind === 'boletos' || kind === 'custos' || kind === 'tudo') {
    const bills = (await db.bills.where('dueDate').between(de, fim, true, false).filter((b) => !b.deleted).toArray()).sort((a, b) => a.dueDate - b.dueDate);
    if (kind === 'boletos' || kind === 'tudo') {
      const bs = bills.filter((b) => BOLETOS.includes(b.category)); count += bs.length;
      add('Boletos', sheet(billRows(bs, hoje.getTime(), emp), ['Valor', 'Valor pago'], ['Vencimento', 'Pago em'], bs.length ? billTotals(bs) : { Vencimento: 'Nenhum boleto no período' }));
    }
    if (kind === 'custos' || kind === 'tudo') {
      const cs = bills.filter((b) => CUSTOS.includes(b.category)); count += cs.length;
      add('Custos fixos', sheet(billRows(cs, hoje.getTime(), emp), ['Valor', 'Valor pago'], ['Vencimento', 'Pago em'], cs.length ? billTotals(cs) : { Vencimento: 'Nenhum custo fixo no período' }));
      if (cs.length) add('Custos fixos (resumo)', sheet(custoResumo(cs), ['Total'], [], { Tipo: 'TOTAL', Total: r2(cs.reduce((s, b) => s + (b.paidAt ? b.paidAmount ?? b.amount : b.amount), 0)) }));
    }
    if (kind === 'tudo') {
      const outras = bills.filter((b) => !BOLETOS.includes(b.category) && !CUSTOS.includes(b.category));
      if (outras.length) add('Outras contas', sheet(billRows(outras, hoje.getTime(), emp), ['Valor', 'Valor pago'], ['Vencimento', 'Pago em'], billTotals(outras)));
    }
  }
  if (kind === 'vendas' || kind === 'tudo') {
    const sales = (await db.sales.where('createdAt').between(de, fim, true, false).filter((s) => !s.deleted).toArray()).sort((a, b) => a.createdAt - b.createdAt);
    const custs = await db.customers.toArray();
    const cust = new Map(custs.map((c) => [c.id, c.name]));
    count += sales.length;
    const ok = sales.filter((s) => s.status === 'completed');
    const total = ok.reduce((t, s) => t + s.total, 0);
    const okCost = ok.reduce((t, s) => t + s.items.filter((i) => !i.canceled).reduce((c, i) => c + (i.cost || 0) * i.qty, 0), 0);
    add('Vendas', sheet(salesRows(sales, cust), ['Subtotal', 'Desconto', 'Total', 'Custo', 'Lucro', 'Troco'], ['Data'], sales.length ? { Data: 'TOTAL', Venda: `${ok.length} vendas`, Desconto: r2(ok.reduce((t, s) => t + s.discount, 0)), Total: r2(total), Custo: r2(okCost), Lucro: r2(total - okCost) } : { Data: 'Nenhuma venda no período' }));
    if (sales.length) {
      add('Itens vendidos', sheet(itemRows(sales), ['Preço unit.', 'Total', 'Custo unit.', 'Lucro'], ['Data']));
      add('Vendas por dia', sheet(dayRows(sales), ['Faturamento', 'Ticket médio', 'Dinheiro', 'PIX', 'Cartão', 'Fiado/outros', 'Custo', 'Lucro'], []));
    }
  }

  const nome = { boletos: 'boletos', vendas: 'vendas', custos: 'custos-fixos', tudo: 'relatorio-completo' }[kind];
  const slug = (storeName || 'loja').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').toLowerCase();
  const file = `${nome}_${slug}_${fmtDate(de).replace(/\//g, '-')}_a_${fmtDate(ate).replace(/\//g, '-')}.xlsx`;
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const url = URL.createObjectURL(new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = file; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { file, count };
}
