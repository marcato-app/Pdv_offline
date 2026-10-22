// Qual loja este aparelho está usando.
// No site, a loja vem do link: visionpdv.marcatoapp.com.br/<codigo>/
// No app de Windows e no celular, o código fica salvo no aparelho.

export const CLOUD_URL = 'https://visionpdv.marcatoapp.com.br';

const isAppShell =
  location.protocol === 'file:' ||
  location.protocol === 'capacitor:' ||
  (location.hostname === 'localhost' && !location.port);

export const IS_APP = isAppShell;

/** App da App Store / Play Store: sem cadastro, preços, pagamento ou atualização pelo site (regras das lojas). */
export const IS_STORE_APP = isAppShell && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

function detectSlug(): string | null {
  try {
    // Link de convite: visionpdv.marcatoapp.com.br/?loja=codigo
    const q = new URLSearchParams(location.search).get('loja');
    if (q && SLUG_RE.test(q)) {
      localStorage.setItem('vision-store', q);
      history.replaceState(null, '', location.pathname + location.hash);
      return q;
    }
    const saved = localStorage.getItem('vision-store');
    return saved && SLUG_RE.test(saved) ? saved : null;
  } catch {
    return null;
  }
}

/** A loja fica salva no aparelho. Os links são por tela: /pdv, /produtos, /estoque… */
export const STORE_SLUG: string | null = detectSlug();

/** Endereço da API. No site é o próprio endereço; no app, a nuvem oficial. */
export const API_BASE = isAppShell ? CLOUD_URL : location.origin;

/** Link para abrir a loja num aparelho novo. */
export const storeLink = (slug: string) => `${CLOUD_URL}/?loja=${slug}`;

export function goHome() {
  if (isAppShell) {
    location.hash = '';
    location.reload();
  } else {
    location.href = `${location.origin}/`;
  }
}

export function openStore(slug: string) {
  localStorage.setItem('vision-store', slug);
  goHome();
}

export function leaveStore() {
  localStorage.removeItem(`vision-uid-${localStorage.getItem('vision-store')}`);
  localStorage.removeItem('vision-store');
  goHome();
}

export function slugify(s: string) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export async function api<T = unknown>(path: string, init?: RequestInit & { token?: string; master?: string }): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init?.token) headers.authorization = `Bearer ${init.token}`;
  if (init?.master) headers['x-master-key'] = init.master;
  const res = await fetch(API_BASE + path, { signal: AbortSignal.timeout(20_000), ...init, headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
  return data as T;
}
