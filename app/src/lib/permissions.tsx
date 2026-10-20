import { useCallback, useRef, useState } from 'react';
import { getSetting, type User } from './db';
import { checkLogin, canManage } from './auth';
import { Modal } from '../components/ui';

export type Action =
  | 'abrirCaixa' | 'fecharCaixa' | 'sangria' | 'suprimento'
  | 'cancelarItem' | 'cancelarVenda' | 'desconto' | 'valorManual' | 'reimprimir';

export const ACTION_LABELS: Record<Action, string> = {
  abrirCaixa: 'Abrir caixa',
  fecharCaixa: 'Fechar caixa',
  sangria: 'Sangria',
  suprimento: 'Suprimento',
  cancelarItem: 'Cancelar item',
  cancelarVenda: 'Cancelar venda',
  desconto: 'Dar desconto',
  valorManual: 'Lançar valor manual / produto não cadastrado',
  reimprimir: 'Reimprimir cupom',
};

export type Permissions = Record<Action, boolean>;

/** Quais ações do operador de caixa pedem a senha de um gerente. */
export const DEFAULT_PERMISSIONS: Permissions = {
  abrirCaixa: true,
  fecharCaixa: false,
  sangria: true,
  suprimento: false,
  cancelarItem: true,
  cancelarVenda: true,
  desconto: true,
  valorManual: false,
  reimprimir: false,
};

export async function needsSupervisor(user: User, action: Action) {
  if (canManage(user)) return false; // dono e gerente têm acesso livre
  const p = { ...DEFAULT_PERMISSIONS, ...(await getSetting<Partial<Permissions>>('permissions', {})) };
  return !!p[action];
}

/**
 * Pede a senha do gerente quando a ação exige.
 * Uso: const [authorize, prompt] = useAuthorize(user); ... if (await authorize('sangria')) {...}; e renderizar {prompt}.
 */
export function useAuthorize(user: User | null) {
  const [pending, setPending] = useState<Action | null>(null);
  const resolver = useRef<(u: User | null) => void>(() => undefined);

  const authorize = useCallback(async (action: Action): Promise<User | null> => {
    if (!user) return null;
    if (!(await needsSupervisor(user, action))) return user;
    return new Promise<User | null>((resolve) => {
      resolver.current = resolve;
      setPending(action);
    });
  }, [user]);

  const done = (u: User | null) => {
    setPending(null);
    resolver.current(u);
  };

  const prompt = pending ? <SupervisorModal action={pending} onDone={done} /> : null;
  return [authorize, prompt] as const;
}

function SupervisorModal({ action, onDone }: { action: Action; onDone: (u: User | null) => void }) {
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const ok = async () => {
    const u = await checkLogin(login, pass);
    if (!u) return setErr('Usuário ou senha incorretos');
    if (!canManage(u)) return setErr('Este usuário não é gerente');
    onDone(u);
  };
  return (
    <Modal title="Senha do gerente" onClose={() => onDone(null)} footer={<>
      <button className="btn" onClick={() => onDone(null)}>Cancelar (Esc)</button>
      <button className="btn primary" onClick={ok}>Autorizar (Enter)</button>
    </>}>
      <p style={{ margin: 0 }}>Para <b>{ACTION_LABELS[action].toLowerCase()}</b>, um gerente precisa autorizar.</p>
      <div className="field"><label htmlFor="svl">Usuário do gerente</label>
        <input id="svl" autoFocus autoCapitalize="none" autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && document.getElementById('svp')?.focus()} />
      </div>
      <div className="field"><label htmlFor="svp">Senha</label>
        <input id="svp" type="password" autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ok()} />
      </div>
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}
