import { useEffect, useState, type FormEvent } from 'react';
import { Brand, PasswordField, TextField } from './Login';
import { api, STORE_SLUG } from '../lib/store';

const ENTER = STORE_SLUG ? '/login' : '/entrar';
import { hashPassword } from '../lib/auth';
import { uid } from '../lib/db';
import { getPlatform, whatsLink } from '../lib/platform';

// Esqueci minha senha (/esqueci) e Criar senha nova pelo link recebido (/redefinir?t=...).

export function Forgot() {
  const [email, setEmail] = useState(() => new URLSearchParams(location.search).get('email') || '');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState<string | null>(null);
  useEffect(() => { getPlatform().then((p) => setSupport(p.supportWhatsApp)); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await api('/api/password/forgot', { method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase() }) });
      setSent(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <Brand title="Vision PDV" subtitle="Recuperar acesso" logo={false} />
      <div className="login-form">
        {sent ? (
          <form onSubmit={(e) => e.preventDefault()}>
            <h2 style={{ fontSize: 26, fontWeight: 700 }}>Confira seu e-mail</h2>
            <p style={{ margin: 0, lineHeight: 1.5 }}>Se <b>{email}</b> tiver uma conta, enviamos um link para criar uma senha nova. Ele vale por 1 hora.</p>
            <p className="muted small" style={{ margin: 0 }}>Não chegou? Olhe a caixa de spam ou promoções. O administrador da loja também recebe o link no WhatsApp cadastrado.</p>
            <a className="btn primary big" href={ENTER}>Voltar para entrar</a>
            {support && <a className="btn ghost" href={whatsLink(support, `Olá! Não consigo entrar no Vision PDV. Meu e-mail: ${email}`)} target="_blank" rel="noreferrer">Falar com o suporte</a>}
          </form>
        ) : (
          <form onSubmit={submit}>
            <h2 style={{ fontSize: 26, fontWeight: 700 }}>Esqueci minha senha</h2>
            <p className="muted" style={{ margin: 0 }}>Digite o e-mail que você usa para entrar. Vamos mandar um link para criar uma senha nova.</p>
            <TextField id="fg1" label="E-mail" value={email} onChange={setEmail} autoFocus autoComplete="email" placeholder="seu@email.com" />
            {err && <div className="error">{err}</div>}
            <button className="btn primary big" disabled={busy || !email.includes('@')}>{busy ? 'Enviando…' : 'Enviar link'}</button>
            <a className="btn ghost" href={ENTER}>Voltar</a>
            {support && <a className="small" href={whatsLink(support, 'Olá! Esqueci minha senha do Vision PDV.')} target="_blank" rel="noreferrer">Precisa de ajuda? Fale com o suporte</a>}
          </form>
        )}
      </div>
    </div>
  );
}

export function ResetPassword() {
  const token = new URLSearchParams(location.search).get('t') || '';
  const [email, setEmail] = useState<string | null>(null);
  const [bad, setBad] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api<{ email: string }>(`/api/password/check?t=${encodeURIComponent(token)}`).then((r) => setEmail(r.email)).catch((e) => setBad(e instanceof Error ? e.message : String(e)));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (pass.length < 6) return setErr('A senha precisa de pelo menos 6 caracteres');
    if (pass !== pass2) return setErr('As duas senhas não são iguais');
    setBusy(true);
    try {
      const salt = uid();
      await api('/api/password/reset', { method: 'POST', body: JSON.stringify({ t: token, salt, passHash: await hashPassword(pass, salt) }) });
      setDone(true);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <Brand title="Vision PDV" subtitle="Criar senha nova" logo={false} />
      <div className="login-form">
        <form onSubmit={submit}>
          <h2 style={{ fontSize: 26, fontWeight: 700 }}>{done ? 'Senha trocada!' : 'Criar senha nova'}</h2>
          {bad && <><div className="error">{bad}</div><a className="btn primary big" href="/esqueci">Pedir outro link</a></>}
          {!bad && !email && <span className="muted">Conferindo o link…</span>}
          {done && <>
            <p style={{ margin: 0 }}>Pronto. Agora entre com <b>{email}</b> e a senha nova. Nos outros aparelhos da loja, a senha nova passa a valer quando eles sincronizarem com a internet.</p>
            <a className="btn primary big" href={ENTER}>Entrar</a>
          </>}
          {!bad && email && !done && <>
            <p className="muted" style={{ margin: 0 }}>Conta: <b>{email}</b></p>
            <PasswordField id="np1" label="Senha nova" value={pass} onChange={setPass} autoComplete="new-password" />
            <PasswordField id="np2" label="Repita a senha nova" value={pass2} onChange={setPass2} autoComplete="new-password" />
            {err && <div className="error">{err}</div>}
            <button className="btn primary big" disabled={busy}>{busy ? 'Salvando…' : 'Salvar senha nova'}</button>
          </>}
        </form>
      </div>
    </div>
  );
}
