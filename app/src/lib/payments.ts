// Pagamentos integrados (PIX com baixa automática e maquininha Mercado Pago Point).
import { getDevice, setDevice } from './db';
import { api } from './store';

export interface PayConfig {
  mercadoPago: boolean;
  mpAccessToken: string | null;
  mpPointDeviceId: string | null;
  pixPayerEmail: string | null;
  whatsapp: { provider: string | null; to: string[]; hour: number; configured: boolean; metaPhoneId: string | null; metaTemplate: string | null; zapiInstance: string | null; evolutionUrl: string | null; evolutionInstance: string | null };
}

const token = () => getDevice<string | null>('token', null);

export async function loadPayConfig(): Promise<PayConfig | null> {
  const t = await token();
  if (t && navigator.onLine) {
    try {
      // Internet lenta não pode travar o caixa: espera no máximo 4 segundos.
      const c = await Promise.race([api<PayConfig>('/api/secrets', { token: t }), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('lento')), 4000))]);
      await setDevice('payCfg', c);
      return c;
    } catch { /* usa o último */ }
  }
  return getDevice<PayConfig | null>('payCfg', null);
}

export async function saveSecrets(patch: Record<string, unknown>) {
  const t = await token();
  if (!t) throw new Error('Entre na loja com internet');
  const c = await api<PayConfig>('/api/secrets', { method: 'PUT', token: t, body: JSON.stringify(patch) });
  await setDevice('payCfg', c);
  return c;
}

export async function payApi<T>(path: string, body?: unknown): Promise<T> {
  const t = await token();
  if (!t) throw new Error('Sem acesso à nuvem');
  return api<T>(path, body === undefined ? { token: t } : { method: 'POST', token: t, body: JSON.stringify(body) });
}
