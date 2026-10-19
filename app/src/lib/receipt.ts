import { getDevice, getSetting, type Sale, type CashSession } from './db';
import { DEFAULT_STORE, type StoreInfo } from './theme';
import { money, dec2, qtyFmt, dateTime, PAYMENT_LABELS, formatCpf } from './format';
import type { SessionSummary } from './pdv';

declare global {
  interface Window {
    visionPrint?: (html: string, opts: { silent: boolean; deviceName?: string; widthMm: number }) => Promise<void>;
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

async function wrap(body: string) {
  const width = await getDevice<number>('paperWidth', 80);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:${width}mm auto;margin:0}
body{margin:0;padding:3mm;width:${width - 6}mm;font:12px/1.35 'Courier New',monospace;color:#000}
h1{font-size:14px;margin:0;text-align:center}
.c{text-align:center}.r{text-align:right}.b{font-weight:bold}
hr{border:0;border-top:1px dashed #000;margin:4px 0}
table{width:100%;border-collapse:collapse}td{vertical-align:top;padding:0}
img{max-width:40mm;max-height:20mm;display:block;margin:0 auto 2mm}
</style></head><body>${body}</body></html>`;
}

async function header() {
  const store = await getSetting<StoreInfo>('store', DEFAULT_STORE);
  return `${store.logo ? `<img src="${store.logo}">` : ''}<h1>${esc(store.name)}</h1>
<div class="c">${[store.cnpj && 'CNPJ ' + store.cnpj, store.address, store.phone].filter(Boolean).map((x) => esc(String(x))).join('<br>')}</div><hr>`;
}

export async function receiptHtml(sale: Sale) {
  const store = await getSetting<StoreInfo>('store', DEFAULT_STORE);
  const items = sale.items.filter((i) => !i.canceled).map((i, n) => `<tr><td colspan="2">${n + 1} ${esc(i.description)}</td></tr>
<tr><td>${qtyFmt(i.qty)} ${i.unit} x ${dec2(i.unitPrice)}</td><td class="r">${dec2(i.total)}</td></tr>`).join('');
  const pays = sale.payments.map((p) => `<tr><td>${PAYMENT_LABELS[p.method]}${p.installments ? ` ${p.installments}x` : ''}</td><td class="r">${dec2(p.amount)}</td></tr>`).join('');
  return wrap(`${await header()}
<div class="c b">CUPOM NÃO FISCAL</div>
<div>Venda ${sale.number} · ${dateTime(sale.createdAt)}<br>Operador: ${esc(sale.operatorName)}${sale.cpf ? `<br>CPF: ${formatCpf(sale.cpf)}` : ''}</div><hr>
<table>${items}</table><hr>
<table>
<tr><td>Subtotal</td><td class="r">${dec2(sale.subtotal)}</td></tr>
${sale.discount ? `<tr><td>Desconto</td><td class="r">-${dec2(sale.discount)}</td></tr>` : ''}
<tr class="b"><td>TOTAL</td><td class="r">${money(sale.total)}</td></tr>
${pays}
${sale.change ? `<tr><td>Troco</td><td class="r">${dec2(sale.change)}</td></tr>` : ''}
</table><hr>
<div class="c">${esc(store.receiptFooter || 'Obrigado pela preferência!')}</div>
${sale.status === 'canceled' ? '<div class="c b">*** VENDA CANCELADA ***</div>' : ''}`);
}

export async function closingHtml(session: CashSession, sum: SessionSummary) {
  const rows = Object.entries(sum.byMethod).map(([k, v]) => `<tr><td>${PAYMENT_LABELS[k] || k}</td><td class="r">${dec2(v)}</td></tr>`).join('');
  return wrap(`${await header()}
<div class="c b">FECHAMENTO DE CAIXA ${esc(session.register)}</div>
<div>Operador: ${esc(session.operatorName)}<br>Abertura: ${dateTime(session.openedAt)}<br>Fechamento: ${dateTime(session.closedAt || Date.now())}</div><hr>
<table>
<tr><td>Vendas</td><td class="r">${sum.salesCount}</td></tr>
<tr><td>Canceladas</td><td class="r">${sum.canceledCount}</td></tr>
${rows}
<tr><td>Fundo de troco</td><td class="r">${dec2(session.openingAmount)}</td></tr>
<tr><td>Suprimentos</td><td class="r">${dec2(sum.suprimentos)}</td></tr>
<tr><td>Sangrias</td><td class="r">-${dec2(sum.sangrias)}</td></tr>
<tr class="b"><td>Total vendido</td><td class="r">${money(sum.total)}</td></tr>
<tr><td>Dinheiro esperado</td><td class="r">${dec2(sum.expectedCash)}</td></tr>
<tr><td>Dinheiro contado</td><td class="r">${dec2(session.countedAmount || 0)}</td></tr>
<tr class="b"><td>Diferença</td><td class="r">${dec2((session.countedAmount || 0) - sum.expectedCash)}</td></tr>
</table><hr><br><div class="c">_______________________<br>Assinatura</div>`);
}

export async function cashMoveHtml(type: string, amount: number, reason: string | undefined, operator: string) {
  return wrap(`${await header()}<div class="c b">${type.toUpperCase()}</div>
<div>${dateTime(Date.now())}<br>Operador: ${esc(operator)}</div><hr>
<div class="b">Valor: ${money(amount)}</div>${reason ? `<div>Motivo: ${esc(reason)}</div>` : ''}<br><br><div class="c">_______________________<br>Assinatura</div>`);
}

export async function printHtml(html: string) {
  const silent = await getDevice<boolean>('silentPrint', false);
  const deviceName = await getDevice<string>('printerName', '');
  const widthMm = await getDevice<number>('paperWidth', 80);
  if (window.visionPrint) return window.visionPrint(html, { silent, deviceName: deviceName || undefined, widthMm });
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(frame);
  frame.srcdoc = html;
  await new Promise((r) => (frame.onload = r));
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
  setTimeout(() => frame.remove(), 2000);
}
