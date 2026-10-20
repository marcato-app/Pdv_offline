import { useLiveQuery } from 'dexie-react-hooks';
import { db, getDevice, setDevice } from './db';
import { api } from './store';

export interface License {
  status: 'trial' | 'active' | 'expired' | 'blocked';
  trialEnds: number;
  paidUntil: number;
  validUntil: number;
  daysLeft: number;
  checkoutUrl: string | null;
  checkedAt?: number;
}

export async function saveLicense(l: License | null) {
  if (l) await setDevice('license', { ...l, checkedAt: Date.now() });
}

/** Busca a licença na nuvem. Sem internet, vale a última conhecida. */
export async function refreshLicense() {
  const token = await getDevice<string | null>('token', null);
  if (!token || !navigator.onLine) return;
  try {
    await saveLicense(await api<License>('/api/license', { token }));
  } catch {
    /* sem conexão: mantém a última */
  }
}

/** Recalcula a situação pela data deste aparelho (para funcionar offline). */
export function effective(l: License | null | undefined): License | null {
  if (!l) return null;
  if (l.status === 'blocked') return l;
  const now = Date.now();
  const daysLeft = Math.max(0, Math.ceil((l.validUntil - now) / 86_400_000));
  const status = now > l.validUntil ? 'expired' : l.paidUntil > now ? 'active' : 'trial';
  return { ...l, status, daysLeft };
}

export function useLicense(): License | null | undefined {
  const row = useLiveQuery(() => db.device.get('license'), []);
  if (row === undefined) return undefined;
  return effective((row?.value as License) || null);
}

export async function activateKey(code: string) {
  const token = await getDevice<string | null>('token', null);
  if (!token) throw new Error('Entre na loja com internet antes de ativar');
  const l = await api<License & { added: number }>('/api/activate', { method: 'POST', token, body: JSON.stringify({ code }) });
  await saveLicense(l);
  return l;
}

export const STATUS_LABEL: Record<License['status'], string> = {
  trial: 'Teste grátis',
  active: 'Ativa',
  expired: 'Vencida',
  blocked: 'Bloqueada',
};

/** Abre o pagamento do plano no Mercado Pago. A ativação é automática quando o pagamento é aprovado. */
export async function startCheckout(plan: string) {
  const token = await getDevice<string | null>('token', null);
  if (!token) throw new Error('Entre na loja com internet antes de assinar');
  const back = `${location.origin}/config?aba=assinatura`;
  const r = await api<{ url: string }>('/api/billing/checkout', { method: 'POST', token, body: JSON.stringify({ plan, back }) });
  return r.url;
}

/** Na volta do Mercado Pago (ou no botão "Já paguei"): confere o pagamento e atualiza a licença. */
export async function confirmPayment(paymentId?: string) {
  const token = await getDevice<string | null>('token', null);
  if (!token) return null;
  const r = await api<License & { ok?: boolean; status?: string }>('/api/billing/confirm', { method: 'POST', token, body: JSON.stringify({ paymentId }) });
  if (r.ok === false) return r;
  await saveLicense(r);
  return r;
}
