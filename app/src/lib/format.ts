const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num3 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });

export const money = (n: number) => brl.format(n || 0);
export const dec2 = (n: number) => num2.format(n || 0);
export const qtyFmt = (n: number) => num3.format(n || 0);

/** Converte "1.234,56", "R$ 10,5" ou "10.5" em número. */
export function parseNum(s: string | number | undefined | null): number {
  if (typeof s === 'number') return s;
  if (!s) return 0;
  let t = String(s).replace(/[^\d,.-]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
}

export const dateTime = (ms: number) =>
  new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const dateOnly = (ms: number) => new Date(ms).toLocaleDateString('pt-BR');
export const timeOnly = (ms: number) => new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function startOfDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export function onlyDigits(s: string) {
  return (s || '').replace(/\D/g, '');
}

export function formatCpf(s: string) {
  const d = onlyDigits(s).slice(0, 11);
  return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function isValidCpf(s: string) {
  const d = onlyDigits(s);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
  credito_parcelado: 'Crédito parcelado',
  vale: 'Vale-alimentação',
  crediario: 'Crediário / fiado',
};
