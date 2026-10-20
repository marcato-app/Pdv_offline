import { db, save, uid, type User } from './db';

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(bits);
}

export async function createUser(data: { name: string; login: string; password: string; role: User['role']; email?: string }) {
  const salt = uid();
  return save<User>('users', {
    id: uid(),
    name: data.name.trim(),
    login: data.login.trim().toLowerCase(),
    email: data.email?.trim().toLowerCase() || undefined,
    salt,
    passHash: await hashPassword(data.password, salt),
    role: data.role,
    active: 1,
  });
}

export async function setPassword(user: User, password: string) {
  const salt = uid();
  return save<User>('users', { ...user, salt, passHash: await hashPassword(password, salt) });
}

export async function checkLogin(login: string, password: string): Promise<User | null> {
  const l = login.trim().toLowerCase();
  const users = await db.users.filter((u) => u.login === l || (!!u.email && u.email === l)).toArray();
  for (const u of users) {
    if (u.deleted || !u.active) continue;
    if ((await hashPassword(password, u.salt)) === u.passHash) return u;
  }
  return null;
}

export async function hasAnyUser() {
  return (await db.users.filter((u) => !u.deleted).count()) > 0;
}

export const canManage = (u: User | null) => !!u && (u.role === 'admin' || u.role === 'gerente');

/** Login conferido na nuvem: recebe o acesso da loja e baixa os dados para este aparelho. */
export async function onlineLogin(slug: string, login: string, password: string): Promise<User | null> {
  const { api } = await import('./store');
  const { setToken, syncNow } = await import('./sync');
  const l = login.trim().toLowerCase();
  const { salt } = await api<{ salt: string }>(`/api/salt?slug=${encodeURIComponent(slug)}&login=${encodeURIComponent(l)}`);
  const passHash = await hashPassword(password, salt);
  const res = await api<{ token: string; user: { id: string }; license: import('./license').License | null }>('/api/login', { method: 'POST', body: JSON.stringify({ slug, login: l, passHash }) });
  await setToken(res.token);
  const { saveLicense } = await import('./license');
  await saveLicense(res.license);
  await syncNow();
  const u = await db.users.get(res.user.id);
  return u && !u.deleted && u.active ? u : null;
}

export interface EmailLoginResult {
  slug: string;
  storeName?: string;
  token: string;
  user: { id: string; name: string; role: string };
  license: import('./license').License | null;
}

/** Login só com e-mail e senha: a nuvem diz qual é a loja. */
export async function emailLogin(email: string, password: string): Promise<EmailLoginResult> {
  const { api } = await import('./store');
  const e = email.trim().toLowerCase();
  const { salt } = await api<{ salt: string }>(`/api/salt?email=${encodeURIComponent(e)}`);
  const passHash = await hashPassword(password, salt);
  return api<EmailLoginResult>('/api/login', { method: 'POST', body: JSON.stringify({ email: e, passHash }) });
}

const PENDING = 'vision-pending-login';

/** Guarda o login feito na página inicial para terminar depois de abrir a loja. */
export function setPendingLogin(r: { slug: string; token: string; userId: string; license: unknown }) {
  localStorage.setItem(PENDING, JSON.stringify(r));
}

/** Termina o login: salva o acesso, baixa os dados e deixa o usuário conectado neste aparelho. */
export async function finishPendingLogin(slug: string) {
  const raw = localStorage.getItem(PENDING);
  if (!raw) return;
  localStorage.removeItem(PENDING);
  const r = JSON.parse(raw) as { slug: string; token: string; userId: string; license: import('./license').License | null };
  if (r.slug !== slug) return;
  const { setToken, syncNow } = await import('./sync');
  const { saveLicense } = await import('./license');
  await setToken(r.token);
  await saveLicense(r.license);
  localStorage.setItem(`vision-uid-${slug}`, r.userId);
  // Baixa os dados da loja, mas nunca trava a abertura: no máximo 25 segundos.
  await Promise.race([syncNow(), new Promise((res) => setTimeout(res, 25_000))]);
}
