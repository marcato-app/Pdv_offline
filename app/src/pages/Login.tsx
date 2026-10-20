import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Dexie from 'dexie';
import { useApp } from '../lib/app-context';
import { checkLogin, onlineLogin, canManage } from '../lib/auth';
import { db, DB_NAME, uid } from '../lib/db';
import { hashPassword } from '../lib/auth';
import { DEFAULT_THEME } from '../lib/theme';
import { Logo, SyncBadge } from '../components/ui';
import { STORE_SLUG, api, openStore, leaveStore, slugify, storeLink, IS_APP, goHome } from '../lib/store';

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
            <p className="muted" style={{ margin: '6px 0 0' }}>Use seu usuário e senha.</p>
          </div>
          <TextField id="lu" label="Usuário" value={login} onChange={setLogin} autoFocus autoComplete="username" />
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

/** Primeiro acesso deste aparelho à loja: confere usuário e senha na nuvem e baixa os dados. */
export function FirstAccess({ onDone }: { onDone: (path: string) => void }) {
  const { setUser } = useApp();
  const [info, setInfo] = useState<{ name: string } | null | 'missing' | 'offline'>(null);
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!navigator.onLine) return setInfo('offline');
    api<{ name: string }>(`/api/store?slug=${STORE_SLUG}`).then(setInfo).catch((e) => setInfo(/não encontrada/i.test(e.message) ? 'missing' : 'offline'));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const u = await onlineLogin(STORE_SLUG!, login, pass);
      if (!u) throw new Error('Não consegui baixar os dados da loja. Tente de novo.');
      setUser(u);
      onDone(canManage(u) ? '/painel' : '/pdv');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  if (info === null) return null;
  if (info === 'missing' || info === 'offline') {
    return (
      <div className="login">
        <Brand title="Vision PDV" logo={false} />
        <div className="login-form">
          <div style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: 24 }}>{info === 'missing' ? 'Loja não encontrada' : 'Sem internet'}</h2>
            <p className="muted" style={{ margin: 0 }}>
              {info === 'missing'
                ? `Não existe loja com o código "${STORE_SLUG}". Confira o link.`
                : 'Na primeira vez que este aparelho entra na loja, precisa de internet para baixar os dados. Depois funciona offline.'}
            </p>
            <button className="btn primary" onClick={() => (info === 'missing' ? leaveStore() : location.reload())}>{info === 'missing' ? 'Voltar ao início' : 'Tentar de novo'}</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="login">
      <Brand title={info.name} subtitle="Primeiro acesso neste aparelho" logo={false} />
      <div className="login-form">
        <form onSubmit={submit}>
          <h2 style={{ fontSize: 26, fontWeight: 700 }}>Entrar na loja</h2>
          <TextField id="fa1" label="Usuário" value={login} onChange={setLogin} autoFocus autoComplete="username" />
          <PasswordField id="fa2" label="Senha" value={pass} onChange={setPass} autoComplete="current-password" />
          {err && <div className="error">{err}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Baixando dados da loja…' : 'Entrar'}</button>
          <button type="button" className="btn sm ghost" onClick={() => leaveStore()}>Trocar de loja</button>
        </form>
      </div>
    </div>
  );
}

/** Página inicial (sem loja escolhida): entrar numa loja ou criar uma nova. */
export function StartPage() {
  const [mode, setMode] = useState<'enter' | 'create'>('enter');
  const [code, setCode] = useState('');
  const [storeName, setStoreName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [name, setName] = useState('');
  const [login, setLogin] = useState('admin');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const enter = async (e: FormEvent) => {
    e.preventDefault();
    const s = slugify(code.replace(/^.*marcatoapp\.com\.br\//, '').replace(/\/.*$/, ''));
    if (!s) return setErr('Digite o código da loja');
    setBusy(true);
    setErr('');
    try {
      await api(`/api/store?slug=${s}`);
      openStore(s);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
      setBusy(false);
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    const s = slugify(slug || storeName);
    if (!storeName.trim() || !name.trim() || !login.trim()) return setErr('Preencha todos os campos');
    if (s.length < 3) return setErr('O código do link precisa de pelo menos 3 letras');
    if (pass.length < 4) return setErr('A senha precisa de pelo menos 4 caracteres');
    if (pass !== pass2) return setErr('As duas senhas não são iguais');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setErr('Informe um e-mail válido');
    if (phone.replace(/\D/g, '').length < 10) return setErr('Informe o WhatsApp com DDD');
    setBusy(true);
    try {
      const now = Date.now();
      const salt = uid();
      const admin = { id: uid(), name: name.trim(), login: login.trim().toLowerCase(), salt, passHash: await hashPassword(pass, salt), role: 'admin', active: 1, updatedAt: now, deleted: 0 };
      const rec = (tbl: string, data: { id: string }) => ({ tbl, id: data.id, data, updatedAt: now, deleted: 0 });
      await api('/api/stores', {
        method: 'POST',
        body: JSON.stringify({
          slug: s,
          name: storeName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          records: [
            rec('users', admin),
            rec('settings', { id: 'store', value: { name: storeName.trim() }, updatedAt: now, deleted: 0 } as { id: string }),
            rec('settings', { id: 'theme', value: DEFAULT_THEME, updatedAt: now, deleted: 0 } as { id: string }),
          ],
        }),
      });
      setCreated(s);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="login">
        <Brand title="Vision PDV" logo={false} />
        <div className="login-form">
          <div style={{ maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 style={{ fontSize: 26 }}>Loja criada!</h2>
            <span className="chip ok" style={{ alignSelf: 'flex-start' }}>Seu teste grátis de 7 dias começou</span>
            <p className="muted" style={{ margin: 0 }}>Este é o link da loja. Use em todos os caixas, celulares e tablets:</p>
            <div className="chip ok" style={{ fontSize: 15, padding: 14, wordBreak: 'break-all' }}>{storeLink(created)}</div>
            <p className="muted small" style={{ margin: 0 }}>No app de Windows ou do celular, use o código: <b>{created}</b></p>
            <button className="btn primary big" onClick={() => openStore(created)}>Abrir minha loja</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <Brand title="Vision PDV" subtitle="Sistema de caixa" logo={false} />
      <div className="login-form">
        {mode === 'enter' ? (
          <form onSubmit={enter}>
            <h2 style={{ fontSize: 26, fontWeight: 700 }}>Entrar na minha loja</h2>
            <TextField id="sc" label={IS_APP ? 'Código da loja' : 'Código ou link da loja'} value={code} onChange={setCode} autoFocus placeholder="ex.: mercado-exemplo" />
            {err && <div className="error">{err}</div>}
            <button className="btn primary big" disabled={busy}>Continuar</button>
            <button type="button" className="btn secondary big" onClick={() => { setMode('create'); setErr(''); }}>Criar minha loja · 7 dias grátis</button>
          </form>
        ) : (
          <form onSubmit={create}>
            <h2 style={{ fontSize: 26, fontWeight: 700 }}>Teste grátis por 7 dias</h2>
            <p className="muted" style={{ margin: 0 }}>Crie sua loja agora. Não precisa de cartão.</p>
            <TextField id="c1" label="Nome da loja" value={storeName} autoFocus onChange={(v) => { setStoreName(v); if (!slugTouched) setSlug(slugify(v)); }} />
            <TextField id="c2" label="Código do link" value={slug} onChange={(v) => { setSlug(slugify(v)); setSlugTouched(true); }}
              hint={<>O link vai ser: visionpdv.marcatoapp.com.br/<b>{slug || 'codigo'}</b>/</>} />
            <TextField id="c3" label="Seu nome" value={name} onChange={setName} autoComplete="name" />
            <TextField id="c4" label="Usuário do administrador" value={login} onChange={setLogin} autoComplete="username" />
            <PasswordField id="c5" label="Senha" value={pass} onChange={setPass} autoComplete="new-password" />
            <PasswordField id="c6" label="Repita a senha" value={pass2} onChange={setPass2} autoComplete="new-password" />
            <TextField id="c8" label="E-mail" value={email} onChange={setEmail} autoComplete="email" />
            <TextField id="c9" label="WhatsApp (com DDD)" value={phone} onChange={setPhone} autoComplete="tel" />
            {err && <div className="error">{err}</div>}
            <button className="btn primary big" disabled={busy}>{busy ? 'Criando…' : 'Criar loja'}</button>
            <button type="button" className="btn ghost" onClick={() => { setMode('enter'); setErr(''); }}>Voltar</button>
          </form>
        )}
      </div>
    </div>
  );
}
