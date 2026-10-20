import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useApp } from '../../lib/app-context';
import { Logo, SyncBadge } from '../../components/ui';

const LINKS: [string, string][] = [
  ['/pdv', 'Frente de caixa'],
  ['/painel', 'Painel'],
  ['/produtos', 'Produtos'],
  ['/importar', 'Importar planilha'],
  ['/estoque', 'Estoque'],
  ['/clientes', 'Clientes'],
  ['/vendas', 'Vendas'],
  ['/caixas', 'Caixas'],
  ['/usuarios', 'Usuários'],
  ['/config', 'Configurações'],
];

export function AdminLayout() {
  const { store, user, setUser } = useApp();
  const nav = useNavigate();
  return (
    <div className="admin">
      <nav className="side" aria-label="Menu">
        <div className="brand"><Logo /><span style={{ fontSize: 16, fontWeight: 800 }}>{store.name}</span></div>
        {LINKS.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        <div className="foot" style={{ marginTop: 'auto', padding: '14px 12px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SyncBadge />
          <span className="muted small">{user?.name}</span>
          <button className="btn sm ghost" onClick={() => { setUser(null); nav('/login'); }}>Sair</button>
        </div>
      </nav>
      <main className="main"><Outlet /></main>
    </div>
  );
}
