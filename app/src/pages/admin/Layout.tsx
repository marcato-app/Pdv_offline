import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../lib/app-context';
import { Logo, SyncBadge } from '../../components/ui';
import { LicenseBanner } from '../../components/license';
import { UpdateBanner } from '../../components/UpdateBanner';
import { SupportFab, useSupportLink } from '../../components/Support';
import { useAppearance, resolvedAppearance } from '../../lib/appearance';

const LINKS: [string, string][] = [
  ['/pdv', 'Frente de caixa'],
  ['/painel', 'Painel'],
  ['/produtos', 'Produtos'],
  ['/importar', 'Importar planilha'],
  ['/estoque', 'Estoque'],
  ['/compras', 'Lista de compras'],
  ['/validade', 'Validade e perdas'],
  ['/clientes', 'Clientes'],
  ['/relatorios', 'Relatórios'],
  ['/vendas', 'Vendas'],
  ['/caixas', 'Caixas'],
  ['/financeiro', 'Financeiro'],
  ['/usuarios', 'Funcionários'],
  ['/config', 'Configurações'],
];

// Ícones simples (traço) para o menu do celular.
const I = {
  caixa: <path d="M3 4h2l2.4 11h11L21 7H6.2M9 20h.01M17 20h.01" />,
  painel: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  produtos: <path d="M4 7l8-4 8 4-8 4-8-4zM4 7v10l8 4 8-4V7M12 11v10" />,
  estoque: <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />,
  mais: <path d="M4 6h16M4 12h16M4 18h16" />,
};
const Icon = ({ d }: { d: JSX.Element }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);

export function AdminLayout() {
  const { store, user, setUser } = useApp();
  const nav = useNavigate();
  const loc = useLocation();
  const [sheet, setSheet] = useState(false);
  const support = useSupportLink();
  const [appearance, setAppearance] = useAppearance();
  const dark = resolvedAppearance(appearance) === 'escuro';
  useEffect(() => { setSheet(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const logout = () => { setUser(null); nav('/login'); };

  return (
    <div className="admin">
      <nav className="side" aria-label="Menu">
        <div className="brand"><Logo /><span style={{ fontSize: 16, fontWeight: 800 }}>{store.name}</span></div>
        {LINKS.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
        <div className="foot" style={{ marginTop: 'auto', padding: '14px 12px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SyncBadge />
          <span className="muted small">{user?.name}</span>
          <button className="btn sm ghost" onClick={logout}>Sair</button>
        </div>
      </nav>

      {/* Celular: barra de cima */}
      <header className="mtop">
        <Logo size={36} />
        <span className="name">{store.name}</span>
        <SyncBadge />
      </header>

      <main className="main"><UpdateBanner /><LicenseBanner /><Outlet /></main>

      {/* Celular: menu fixo embaixo */}
      <nav className="mnav" aria-label="Menu principal">
        <NavLink to="/pdv"><Icon d={I.caixa} />Caixa</NavLink>
        <NavLink to="/painel"><Icon d={I.painel} />Painel</NavLink>
        <NavLink to="/produtos"><Icon d={I.produtos} />Produtos</NavLink>
        <NavLink to="/estoque"><Icon d={I.estoque} />Estoque</NavLink>
        <button type="button" onClick={() => setSheet(true)}><Icon d={I.mais} />Mais</button>
      </nav>
      {sheet && (
        <div className="msheet" onClick={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div className="panel" role="dialog" aria-label="Todas as telas">
            <span className="grab" />
            {LINKS.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
            <button type="button" onClick={() => setAppearance(dark ? 'claro' : 'escuro')}>{dark ? '☀️ Modo claro' : '🌙 Modo escuro'}</button>
            {support && <a href={support} target="_blank" rel="noreferrer" style={{ color: '#128c4a' }}>Falar com o suporte (WhatsApp)</a>}
            <button type="button" onClick={logout} style={{ color: 'var(--danger)' }}>Sair ({user?.name})</button>
          </div>
        </div>
      )}
      <SupportFab />
    </div>
  );
}
