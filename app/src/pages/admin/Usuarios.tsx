import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, save, type User } from '../../lib/db';
import { createUser, setPassword } from '../../lib/auth';
import { Modal } from '../../components/ui';
import { useApp } from '../../lib/app-context';

const ROLES = { admin: 'Administrador', gerente: 'Gerente', operador: 'Operador de caixa' };

export function Usuarios() {
  const { user: me } = useApp();
  const users = useLiveQuery(() => db.users.filter((u) => !u.deleted).toArray(), []);
  const [edit, setEdit] = useState<User | 'novo' | null>(null);
  return (
    <>
      <div className="page-head"><h1>Usuários</h1>{me?.role === 'admin' && <button className="btn primary" onClick={() => setEdit('novo')}>+ Novo usuário</button>}</div>
      <div className="card">
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Nome</th><th>Usuário</th><th>Função</th><th>Situação</th></tr></thead>
            <tbody>{users?.map((u) => (
              <tr key={u.id} className="click" onClick={() => me?.role === 'admin' && setEdit(u)}>
                <td>{u.name}</td><td>{u.login}</td><td>{ROLES[u.role]}</td><td>{u.active ? <span className="chip ok">Ativo</span> : <span className="chip warn">Inativo</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="muted small">Operadores só acessam a frente de caixa. Gerentes também acessam a gestão. Só o administrador cria usuários.</p>
      </div>
      {edit && <UserModal user={edit === 'novo' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function UserModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [name, setName] = useState(user?.name || '');
  const [login, setLogin] = useState(user?.login || '');
  const [role, setRole] = useState<User['role']>(user?.role || 'operador');
  const [active, setActive] = useState(user ? user.active : 1);
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    if (!name.trim() || !login.trim()) return setErr('Preencha nome e usuário');
    const dup = await db.users.where('login').equals(login.trim().toLowerCase()).filter((u) => !u.deleted && u.id !== user?.id).first();
    if (dup) return setErr('Este usuário já existe');
    if (!user) {
      if (pass.length < 4) return setErr('Senha com pelo menos 4 caracteres');
      await createUser({ name, login, password: pass, role });
    } else {
      let u = await save<User>('users', { ...user, name: name.trim(), login: login.trim().toLowerCase(), role, active });
      if (pass) u = await setPassword(u, pass);
    }
    onClose();
  };
  return (
    <Modal title={user ? 'Editar usuário' : 'Novo usuário'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn primary" onClick={submit}>Salvar</button></>}>
      <div className="field"><label htmlFor="un">Nome</label><input id="un" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label htmlFor="ul">Usuário (para entrar)</label><input id="ul" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} /></div>
      <div className="field"><label htmlFor="ur">Função</label><select id="ur" value={role} onChange={(e) => setRole(e.target.value as User['role'])}>{Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      {user && <div className="field"><label htmlFor="ua">Situação</label><select id="ua" value={active} onChange={(e) => setActive(Number(e.target.value) as 0 | 1)}><option value={1}>Ativo</option><option value={0}>Inativo</option></select></div>}
      <div className="field"><label htmlFor="up">{user ? 'Nova senha (deixe vazio para manter)' : 'Senha'}</label><input id="up" type="password" value={pass} onChange={(e) => setPass(e.target.value)} /></div>
      {err && <div className="error">{err}</div>}
    </Modal>
  );
}
