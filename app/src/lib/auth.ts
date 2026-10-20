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

export async function createUser(data: { name: string; login: string; password: string; role: User['role'] }) {
  const salt = uid();
  return save<User>('users', {
    id: uid(),
    name: data.name.trim(),
    login: data.login.trim().toLowerCase(),
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
  const users = await db.users.where('login').equals(login.trim().toLowerCase()).toArray();
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
  const res = await api<{ token: string; user: { id: string } }>('/api/login', { method: 'POST', body: JSON.stringify({ slug, login: l, passHash }) });
  await setToken(res.token);
  await syncNow();
  const u = await db.users.get(res.user.id);
  return u && !u.deleted && u.active ? u : null;
}
