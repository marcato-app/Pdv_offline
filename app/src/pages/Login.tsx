import { useContext, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Dexie from 'dexie';
import { useApp, AppCtxRef } from '../lib/app-context';
import { checkLogin, onlineLogin, canManage, emailLogin, setPendingLogin, finishPendingLogin } from '../lib/auth';
import { db, DB_NAME, uid } from '../lib/db';
import { hashPassword } from '../lib/auth';
import { DEFAULT_THEME } from '../lib/theme';
import { Logo, SyncBadge } from '../components/ui';
import { STORE_SLUG, api, openStore, leaveStore, slugify, storeLink, goHome } from '../lib/store';

function Brand({ title, subtitle, logo = true }: { title: string; subtitle?: string; logo?: boolean }) {
  return (
    <div className="login-brand">
      <div className="row" style={{ gap: 16 }}>
        {logo ? <Logo size={72} /> : <div className="logo-box" style={{ width: 72, height: 72 }}><img src={import.meta.env.BASE_URL + 'icon.svg'} alt="" /></div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 24, fontWeight: 800 }}>{title}</span>
          {subtitle && <span style={{ fontSize: 14, color: '#e4dcfa' }}>{subtitle}</span>}
        </div>
      </div>
      <div className="hero">
        <h1 style={{ fontSize: 42, lineHeight: 1.1, fontWeight: 800 }}>Vende com ou sem internet.</h1>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: '#e4dcfa' }}>
          Tudo fica salvo neste aparelho e vai para a nuvem assim que a conexão voltar.
        </p>
      </div>
      <span style={{ fontSize: 13, color: '#e4dcfa' }}>Vision PDV</span>
    </div>
  );
}

function PasswordField({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: 'relative' }}>
        <input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          value={value} onChange={(e) => onChange(e.target.value)} style={{ paddingRight: 90 }} />
        <button type="button" className="btn sm ghost" style={{ position: 'absolute', right: 5, top: 5, height: 36 }} onClick={() => setShow(!show)}>
          {show ? 'Esconder' : 'Mostrar'}
        </button>
      </div>
    </div>
  );
}

function TextField({ id, label, value, onChange, autoFocus, autoComplete, placeholder, hint }: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; autoComplete?: string; placeholder?: string; hint?: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} autoFocus={autoFocus} autoComplete={autoComplete || 'off'} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="muted small">{hint}</span>}
    </div>
  );
}

/** Apaga os dados desta loja só neste aparelho (a nuvem continua com tudo). */
async function resetDevice() {
  const pending = await db.outbox.count().catch(() => 0);
  const msg = pending
    ? `ATENÇÃO: ${pending} alterações deste aparelho ainda não foram para a nuvem e serão perdidas. Recomeçar mesmo assim?`
    : 'Apagar os dados desta loja neste aparelho? O que já está na nuvem continua salvo.';
  if (!confirm(msg)) return;
  db.close();
  await Dexie.delete(DB_NAME);
  sessionStorage.clear();
  goHome();
}

/** Tela de login da loja (depois do primeiro acesso, funciona sem internet). */
export function Login() {
  const { setUser, store } = useApp();
  const nav = useNavigate();
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      let u = await checkLogin(login, pass);
      // A senha pode ter sido trocada em outro aparelho: confere na nuvem.
      if (!u && navigator.onLine && STORE_SLUG) u = await onlineLogin(STORE_SLUG, login, pass).catch(() => null);
      if (!u) return setErr('Usuário ou senha incorretos');
      setUser(u);
      nav(canManage(u) ? '/painel' : '/pdv');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <Brand title={store.name} subtitle={STORE_SLUG ? storeLink(STORE_SLUG).replace('https://', '') : undefined} />
      <div className="login-form">
        <form onSubmit={submit}>
          <div>
            <h2 style={{ fontSize: 28, fontWeight: 700 }}>Entrar</h2>
            <p className="muted" style={{ margin: '6px 0 0' }}>Você fica conectado neste aparelho até tocar em Sair.</p>
          </div>
          <TextField id="lu" label="E-mail ou usuário" value={login} onChange={setLogin} autoFocus autoComplete="username" />
          <PasswordField id="lp" label="Senha" value={pass} onChange={setPass} autoComplete="current-password" />
          {err && <div className="error">{err}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          <div className="row" style={{ justifyContent: 'space-between' }}><SyncBadge /></div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="btn sm ghost" onClick={() => leaveStore()}>Trocar de loja</button>
            <button type="button" className="btn sm ghost" onClick={resetDevice}>Recomeçar neste aparelho</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Aparelho aberto num link de loja, mas ainda sem dados: entra com e-mail e senha. */
export function FirstAccess({ onDone }: { onDone: (path: string) => void }) {
  return <EmailLoginScreen subtitle="Entre com seu e-mail e senha" onDone={onDone} />;
}

function EmailLoginScreen({ subtitle, onDone, onCreate }: { subtitle?: string; onDone?: (path: string) => void; onCreate?: () => void }) {
  const { setUser } = useAppSafe();
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!navigator.onLine) return setErr('Na primeira vez neste aparelho precisa de internet. Depois funciona offline.');
    setBusy(true);
    try {
      const r = await emailLogin(email, pass);
      if (STORE_SLUG === r.slug && onDone) {
        // Já está na loja certa: termina aqui mesmo.
        setPendingLogin({ slug: r.slug, token: r.token, userId: r.user.id, license: r.license });
        await finishPendingLogin(r.slug);
        const u = await db.users.get(r.user.id);
        if (!u) throw new Error('Não consegui baixar os dados da loja. Tente de novo.');
        setUser?.(u);
        onDone(canManage(u) ? '/painel' : '/pdv');
      } else {
        setPendingLogin({ slug: r.slug, token: r.token, userId: r.user.id, license: r.license });
        openStore(r.slug);
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <Brand title="Vision PDV" subtitle={subtitle || 'Sistema de caixa'} logo={false} />
      <div className="login-form">
        <form onSubmit={submit}>
          <h2 style={{ fontSize: 26, fontWeight: 700 }}>Entrar</h2>
          <TextField id="em1" label="E-mail" value={email} onChange={setEmail} autoFocus autoComplete="email" placeholder="seu@email.com" />
          <PasswordField id="em2" label="Senha" value={pass} onChange={setPass} autoComplete="current-password" />
          {err && <div className="error">{err}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
          {onCreate && <button type="button" className="btn secondary big" onClick={onCreate}>Criar minha loja · 7 dias grátis</button>}
          {!onCreate && <button type="button" className="btn sm ghost" onClick={() => leaveStore()}>Voltar ao início</button>}
        </form>
      </div>
    </div>
  );
}

// O contexto do app só existe dentro da loja; na página inicial não há.
function useAppSafe(): { setUser?: (u: import('../lib/db').User) => void } {
  const ctx = useContext(AppCtxRef);
  return ctx ? { setUser: ctx.setUser } : {};
}

/** Página inicial: entrar com e-mail e senha, ou criar uma loja nova. */
export function StartPage({ initialMode = 'enter' }: { initialMode?: 'enter' | 'create' }) {
  const [mode, setMode] = useState<'enter' | 'create'>(initialMode);
  const [terms, setTerms] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (mode === 'enter') return <EmailLoginScreen onCreate={() => setMode('create')} />;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const mail = email.trim().toLowerCase();
    if (!storeName.trim() || !name.trim()) return setErr('Preencha o nome da loja e o seu nome');
    if (!/^\S+@\S+\.\S+$/.test(mail)) return setErr('Informe um e-mail válido');
    if (phone.replace(/\D/g, '').length < 10) return setErr('Informe o WhatsApp com DDD');
    if (pass.length < 6) return setErr('A senha precisa de pelo menos 6 caracteres');
    if (pass !== pass2) return setErr('As duas senhas não são iguais');
    if (!terms) return setErr('Para continuar, aceite os Termos de uso e a Política de privacidade');
    setBusy(true);
    try {
      const now = Date.now();
      const salt = uid();
      const admin = { id: uid(), name: name.trim(), login: mail, email: mail, salt, passHash: await hashPassword(pass, salt), role: 'admin', active: 1, updatedAt: now, deleted: 0 };
      const rec = (tbl: string, data: { id: string }) => ({ tbl, id: data.id, data, updatedAt: now, deleted: 0 });
      const r = await api<{ slug: string; token: string; license: unknown }>('/api/stores', {
        method: 'POST',
        body: JSON.stringify({
          slug: slugify(storeName) || 'loja',
          name: storeName.trim(),
          email: mail,
          phone: phone.trim(),
          acceptedTerms: true,
          records: [
            rec('users', admin),
            rec('settings', { id: 'store', value: { name: storeName.trim(), phone: phone.trim() }, updatedAt: now, deleted: 0 } as { id: string }),
            rec('settings', { id: 'theme', value: DEFAULT_THEME, updatedAt: now, deleted: 0 } as { id: string }),
          ],
        }),
      });
      // Já entra direto na loja nova.
      setPendingLogin({ slug: r.slug, token: r.token, userId: admin.id, license: r.license });
      openStore(r.slug);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <Brand title="Vision PDV" subtitle="Sistema de caixa" logo={false} />
      <div className="login-form">
        <form onSubmit={create}>
          <h2 style={{ fontSize: 26, fontWeight: 700 }}>Teste grátis por 7 dias</h2>
          <p className="muted" style={{ margin: 0 }}>Crie sua loja agora. Não precisa de cartão.</p>
          <TextField id="c1" label="Nome da loja" value={storeName} autoFocus onChange={setStoreName} />
          <TextField id="c3" label="Seu nome" value={name} onChange={setName} autoComplete="name" />
          <TextField id="c8" label="E-mail (usado para entrar)" value={email} onChange={setEmail} autoComplete="email" />
          <TextField id="c9" label="WhatsApp (com DDD)" value={phone} onChange={setPhone} autoComplete="tel" />
          <PasswordField id="c5" label="Crie uma senha" value={pass} onChange={setPass} autoComplete="new-password" />
          <PasswordField id="c6" label="Repita a senha" value={pass2} onChange={setPass2} autoComplete="new-password" />
          <label htmlFor="terms" className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start', gap: 10, fontSize: 14, cursor: 'pointer' }}>
            <input id="terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ width: 20, height: 20, marginTop: 1, flex: '0 0 auto' }} />
            <span>Li e aceito os <a href="/termos" target="_blank" rel="noreferrer">Termos de uso</a> e a <a href="/privacidade" target="_blank" rel="noreferrer">Política de privacidade</a>.</span>
          </label>
          {err && <div className="error">{err}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Criando sua loja…' : 'Criar loja e começar'}</button>
          <button type="button" className="btn ghost" onClick={() => { setMode('enter'); setErr(''); }}>Já tenho conta: entrar</button>
        </form>
      </div>
    </div>
  );
}
