// PIX "copia e cola" (BR Code) da chave da loja, gerado no próprio aparelho: funciona sem internet.
// O operador confirma o recebimento. Para baixa automática, use o PIX do Mercado Pago.

export interface PixKey {
  type: PixKeyType;
  key: string; // CPF, CNPJ, e-mail, telefone ou chave aleatória
  name: string; // nome do recebedor
  city: string;
}

const field = (id: string, value: string) => id + String(value.length).padStart(2, '0') + value;

const plain = (s: string, max: number) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().trim().slice(0, max) || 'LOJA';

function crc16(s: string) {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria';

export function normalizeKey(k: string, type: PixKeyType = 'aleatoria') {
  const t = k.trim();
  const d = t.replace(/\D/g, '');
  if (type === 'email') return t.toLowerCase();
  if (type === 'telefone') return '+' + (d.length <= 11 ? '55' + d : d);
  if (type === 'cpf' || type === 'cnpj') return d;
  return t.toLowerCase();
}

export function pixCode(cfg: PixKey, amount: number, txid = '***') {
  const mai = field('00', 'br.gov.bcb.pix') + field('01', normalizeKey(cfg.key, cfg.type));
  const payload =
    field('00', '01') +
    field('26', mai) +
    field('52', '0000') +
    field('53', '986') +
    (amount > 0 ? field('54', amount.toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', plain(cfg.name, 25)) +
    field('60', plain(cfg.city, 15)) +
    field('62', field('05', txid.replace(/[^A-Za-z0-9*]/g, '').slice(0, 25) || '***')) +
    '6304';
  return payload + crc16(payload);
}
