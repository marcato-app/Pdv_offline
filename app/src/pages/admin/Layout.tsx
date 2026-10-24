import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useApp } from '../../lib/app-context';
import { Logo, SyncBadge } from '../../components/ui';
import { LicenseBanner } from '../../components/license';
import { UpdateBanner } from '../../components/UpdateBanner';
import { SupportFab, useSupportLink } from '../../components/Support';
import { useAppearance, resolvedAppearance } from '../../lib/appearance';
import { IS_STORE_APP } from '../../lib/store';

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
// Menu "Mais" do celular: telas agrupadas, com ícone.
const G = {
  caixa: <path d="M3 4h2l2.4 11h11L21 7H6.2M9 20h.01M17 20h.01" />,
  painel: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  vendas: <><path d="M3 8a2 2 0 0 0 0 4v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4a2 2 0 0 1 0-4V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z" /></>,
  caixas: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h3" /></>,
  produtos: <path d="M4 7l8-4 8 4-8 4-8-4zM4 7v10l8 4 8-4V7M12 11v10" />,
  importar: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M12 18v-6M9 15l3 3 3-3" /></>,
  estoque: <path d="M3 21h18M5 21V9l7-5 7 5v12M9 21v-6h6v6" />,
  compras: <><path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>,
  validade: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  clientes: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7" /></>,
  relatorios: <><path d="M3 3v18h18" /><path d="m7 15 4-4 3 3 5-6" /></>,
  financeiro: <><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></>,
  usuarios: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  config: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 21h14" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 17.5h.01" /></>,
  out: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5M21 12H9" /></>,
  chev: <path d="m9 6 6 6-6 6" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
};
type GIcon = keyof typeof G;
const GROUPS: [string, [string, string, GIcon][]][] = [
  ['Vendas', [['/pdv', 'Frente de caixa', 'caixa'], ['/vendas', 'Vendas', 'vendas'], ['/caixas', 'Caixas', 'caixas'], ['/clientes', 'Clientes', 'clientes']]],
  ['Estoque', [['/produtos', 'Produtos', 'produtos'], ['/importar', 'Importar planilha', 'importar'], ['/estoque', 'Estoque', 'estoque'], ['/compras', 'Lista de compras', 'compras'], ['/validade', 'Validade e perdas', 'validade']]],
  ['Gestão', [['/painel', 'Painel', 'painel'], ['/relatorios', 'Relatórios', 'relatorios'], ['/financeiro', 'Financeiro', 'financeiro'], ['/usuarios', 'Funcionários', 'usuarios'], ['/config', 'Configurações', 'config']]],
];

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
          <div className="panel ms2" role="dialog" aria-label="Todas as telas">
            <span className="grab" />
            <div className="ms-user">
              <span className="ms-av">{(user?.name || '?').trim().slice(0, 1).toUpperCase()}</span>
              <div><b>{user?.name}</b><small>{store.name}</small></div>
              <button type="button" className="ms-x" aria-label="Fechar" onClick={() => setSheet(false)}><Icon d={G.x} /></button>
            </div>
            {GROUPS.map(([title, items]) => (
              <section key={title}>
                <h3>{title}</h3>
                <div className="ms-list">
                  {items.map(([to, label, ic]) => (
                    <NavLink key={to} to={to}><span className="ms-ic"><Icon d={G[ic]} /></span>{label}<span className="ms-chev"><Icon d={G.chev} /></span></NavLink>
                  ))}
                </div>
              </section>
            ))}
            <section>
              <h3>Preferências</h3>
              <div className="ms-list">
                <button type="button" role="switch" aria-checked={dark} onClick={() => setAppearance(dark ? 'claro' : 'escuro')}><span className="ms-ic"><Icon d={G.moon} /></span>Modo escuro<span className={'ms-sw' + (dark ? ' on' : '')}><i /></span></button>
                {!IS_STORE_APP && <NavLink to="/config?aba=app"><span className="ms-ic"><Icon d={G.download} /></span>Baixar o app<span className="ms-chev"><Icon d={G.chev} /></span></NavLink>}
                {support && <a href={support} target="_blank" rel="noreferrer"><span className="ms-ic"><Icon d={G.help} /></span>Falar com o suporte<span className="ms-chev"><Icon d={G.chev} /></span></a>}
              </div>
            </section>
            <div className="ms-list ms-out"><button type="button" onClick={logout}><span className="ms-ic"><Icon d={G.out} /></span>Sair da conta</button></div>
          </div>
        </div>
      )}
      <SupportFab />
    </div>
  );
}
