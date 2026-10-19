import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../lib/app-context';
import { checkLogin, createUser, canManage } from '../lib/auth';
import { setSetting } from '../lib/db';
import { DEFAULT_THEME } from '../lib/theme';
import { Logo, SyncBadge } from '../components/ui';
import { setSyncConfig, DEFAULT_SYNC_URL } from '../lib/sync';

function Brand({ subtitle }: { subtitle?: string }) {
  const { store } = useApp();
  return (
    <div className="login-brand">
      <div className="row" style={{ gap: 16 }}>
        <Logo size={72} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 24, fontWeight: 800 }}>{store.name}</span>
          {subtitle && <span style={{ fontSize: 14, color: '#e4dcfa' }}>{subtitle}</span>}
        </div>
      </div>
      <div className="hero" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 440 }}>
        <h1 style={{ fontSize: 42, lineHeight: 1.1, fontWeight: 800 }}>Vende com ou sem internet.</h1>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: '#e4dcfa' }}>
          Tudo fica salvo neste aparelho e vai para a nuvem assim que a conexão voltar.
        </p>
      </div>
      <div className="row"><SyncBadge /></div>
    </div>
  );
}

export function Login() {
  const { setUser } = useApp();
  const nav = useNavigate();
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const u = await checkLogin(login, pass);
    setBusy(false);
    if (!u) return setErr('Usuário ou senha incorretos');
    setUser(u);
    nav(canManage(u) ? '/admin' : '/caixa');
  };

  return (
    <div className="login">
      <Brand />
      <div className="login-form">
        <form onSubmit={submit}>
          <div>
            <h2 style={{ fontSize: 28, fontWeight: 700 }}>Entrar</h2>
            <p className="muted" style={{ margin: '6px 0 0' }}>Use seu usuário e senha.</p>
          </div>
          <div className="field">
            <label htmlFor="lu">Usuário</label>
            <input id="lu" autoFocus autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="lp">Senha</label>
            <input id="lp" type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </div>
          {err && <div className="error">{err}</div>}
          <button className="btn primary big" disabled={busy}>Entrar</button>
          <span className="muted small" style={{ textAlign: 'center' }}>Vision PDV</span>
        </form>
      </div>
    </div>
  );
}

/** Primeira vez que o sistema abre: cria a loja e o administrador, ou conecta numa loja que já existe na nuvem. */
export function Setup({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'new' | 'join'>('new');
  const [storeName, setStoreName] = useState('');
  const [name, setName] = useState('');
  const [login, setLogin] = useState('admin');
  const [pass, setPass] = useState('');
  const [url, setUrl] = useState(DEFAULT_SYNC_URL);
  const [key, setKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (mode === 'new') {
      if (!storeName.trim() || !name.trim() || !login.trim()) return setErr('Preencha todos os campos');
      if (pass.length < 4) return setErr('A senha precisa de pelo menos 4 caracteres');
      setBusy(true);
      await setSetting('store', { name: storeName.trim() });
      await setSetting('theme', DEFAULT_THEME);
      await createUser({ name, login, password: pass, role: 'admin' });
      setBusy(false);
      onDone();
    } else {
      if (!url.trim() || !key.trim()) return setErr('Informe o endereço e a chave');
      setBusy(true);
      try {
        await setSyncConfig({ url: url.trim(), apiKey: key.trim() });
        const { syncNow } = await import('../lib/sync');
        await syncNow();
        const { hasAnyUser } = await import('../lib/auth');
        if (!(await hasAnyUser())) throw new Error('Nenhum usuário encontrado na nuvem. Confira o endereço e a chave.');
        onDone();
      } catch (e2) {
        setErr(e2 instanceof Error ? e2.message : String(e2));
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <div className="login">
      <Brand subtitle="Primeira configuração" />
      <div className="login-form">
        <form onSubmit={submit}>
          <h2 style={{ fontSize: 26, fontWeight: 700 }}>Bem-vindo ao Vision PDV</h2>
          <div className="row">
            <button type="button" className={'btn sm ' + (mode === 'new' ? 'secondary' : '')} onClick={() => setMode('new')}>Loja nova</button>
            <button type="button" className={'btn sm ' + (mode === 'join' ? 'secondary' : '')} onClick={() => setMode('join')}>Conectar a uma loja existente</button>
          </div>
          {mode === 'new' ? (
            <>
              <div className="field"><label htmlFor="s1">Nome da loja</label><input id="s1" autoFocus value={storeName} onChange={(e) => setStoreName(e.target.value)} /></div>
              <div className="field"><label htmlFor="s2">Seu nome</label><input id="s2" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="field"><label htmlFor="s3">Usuário do administrador</label><input id="s3" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} /></div>
              <div className="field"><label htmlFor="s4">Senha</label><input id="s4" type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
            </>
          ) : (
            <>
              <p className="muted small" style={{ margin: 0 }}>Use isto em um segundo caixa, celular ou tablet. Os dados da loja serão baixados da nuvem.</p>
              <div className="field"><label htmlFor="j1">Endereço do servidor</label><input id="j1" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
              <div className="field"><label htmlFor="j2">Chave de acesso</label><input id="j2" type="password" value={key} onChange={(e) => setKey(e.target.value)} /></div>
            </>
          )}
          {err && <div className="error">{err}</div>}
          <button className="btn primary big" disabled={busy}>{busy ? 'Aguarde…' : 'Continuar'}</button>
        </form>
      </div>
    </div>
  );
}
