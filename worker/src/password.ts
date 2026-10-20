// Esqueci minha senha: manda um link por e-mail (e WhatsApp do administrador, se houver) para criar uma senha nova.
// A senha nova chega já embaralhada (PBKDF2 no aparelho), igual ao cadastro.

import type { Env } from './index';
import { findUserByEmail, getStore, upsertStmt } from './index';
import { getPlatform, publicPlatform } from './billing';
import { canMail, canWa, sendMail, sendPlatformWa, SITE } from './notify';
import { json } from './util';

const HOUR = 3600_000;

async function sha(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function validReset(env: Env, token: string) {
  if (!token || token.length < 20) return null;
  const r = await env.DB.prepare('SELECT * FROM password_resets WHERE token_hash = ?').bind(await sha(token)).first<{ token_hash: string; store_id: string; user_id: string; email: string; expires: number; used: number }>();
  return r && !r.used && r.expires > Date.now() ? r : null;
}

export async function passwordApi(req: Request, env: Env, url: URL): Promise<Response | null> {
  const p = url.pathname;

  if (p === '/api/password/forgot' && req.method === 'POST') {
    const email = String((await req.json<{ email?: string }>()).email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) return json({ error: 'Informe um e-mail válido' }, 400);
    const plat = await getPlatform(env);
    if (!canMail(plat) && !canWa(plat)) {
      const pub = publicPlatform(plat);
      return json({ error: pub.supportWhatsApp ? 'A recuperação automática ainda não está ligada. Fale com o suporte pelo WhatsApp.' : 'A recuperação automática ainda não está ligada. Fale com o suporte.' }, 503);
    }
    const recent = await env.DB.prepare('SELECT COUNT(*) n FROM password_resets WHERE email = ? AND created_at > ?').bind(email, Date.now() - HOUR).first<{ n: number }>();
    if ((recent?.n || 0) >= 3) return json({ error: 'Muitos pedidos para este e-mail. Espere 1 hora e tente de novo.' }, 429);
    const u = await findUserByEmail(env, email);
    // Resposta igual exista ou não o e-mail (não revela quem tem conta).
    if (u) {
      const token = newToken();
      await env.DB.prepare('INSERT INTO password_resets (token_hash, store_id, user_id, email, expires, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(await sha(token), u.storeId, u.id, email, Date.now() + HOUR, Date.now()).run();
      const link = `${SITE}/redefinir?t=${token}`;
      const store = await getStore(env, u.storeId);
      let sent = false;
      if (canMail(plat)) {
        try {
          await sendMail(plat, email, 'Criar uma senha nova · Vision PDV', 'Criar uma senha nova', [
            `Olá, ${u.name}! Recebemos um pedido para trocar a senha de ${email}${store ? ` na loja ${store.name}` : ''}.`,
            'O link vale por 1 hora. Se não foi você, ignore este e-mail: sua senha continua a mesma.',
          ], { label: 'Criar senha nova', url: link });
          sent = true;
        } catch (e) { console.error('reset e-mail', e); }
      }
      // Administrador da loja: também manda no WhatsApp cadastrado na loja.
      if (canWa(plat) && u.role === 'admin' && store?.phone) {
        try { await sendPlatformWa(plat, store.phone, `*Vision PDV*\n\nPara criar uma senha nova para ${email}, abra o link (vale 1 hora):\n${link}\n\nSe não foi você, ignore.`); sent = true; } catch (e) { console.error('reset WhatsApp', e); }
      }
      if (!sent) return json({ error: 'Não conseguimos enviar agora. Tente de novo em alguns minutos.' }, 502);
    }
    return json({ ok: true });
  }

  if (p === '/api/password/check' && req.method === 'GET') {
    const r = await validReset(env, url.searchParams.get('t') || '');
    return r ? json({ ok: true, email: r.email }) : json({ error: 'Este link venceu ou já foi usado. Peça um novo.' }, 400);
  }

  if (p === '/api/password/reset' && req.method === 'POST') {
    const b = await req.json<{ t?: string; salt?: string; passHash?: string }>();
    const r = await validReset(env, b.t || '');
    if (!r) return json({ error: 'Este link venceu ou já foi usado. Peça um novo.' }, 400);
    if (!b.salt || b.salt.length < 8 || !/^[0-9a-f]{64}$/.test(b.passHash || '')) return json({ error: 'Senha inválida' }, 400);
    const row = await env.DB.prepare(`SELECT data FROM records WHERE store_id = ? AND tbl = 'users' AND id = ?`).bind(r.store_id, r.user_id).first<{ data: string }>();
    if (!row) return json({ error: 'Usuário não encontrado' }, 404);
    const now = Date.now();
    const user = { ...JSON.parse(row.data), salt: b.salt, passHash: b.passHash, updatedAt: now };
    await env.DB.batch([
      upsertStmt(env).bind(r.store_id, 'users', r.user_id, JSON.stringify(user), now, 0),
      env.DB.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').bind(r.token_hash),
    ]);
    return json({ ok: true, email: r.email });
  }
  return null;
}
