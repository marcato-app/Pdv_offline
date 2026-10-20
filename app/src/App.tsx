import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppProvider, useApp } from './lib/app-context';
import { hasAnyUser, canManage } from './lib/auth';
import { IS_APP } from './lib/store';
import { Login, FirstAccess } from './pages/Login';
import { Caixa } from './pages/Caixa';
import { AdminLayout } from './pages/admin/Layout';
import { Painel } from './pages/admin/Painel';
import { Produtos, ProdutoForm } from './pages/admin/Produtos';
import { Importar } from './pages/admin/Importar';
import { Estoque } from './pages/admin/Estoque';
import { Clientes } from './pages/admin/Clientes';
import { Vendas, Caixas } from './pages/admin/Vendas';
import { Usuarios } from './pages/admin/Usuarios';
import { Config } from './pages/admin/Config';

// No site, cada tela tem seu link (/pdv, /produtos…). No app de Windows e no celular, usa "#/pdv".
const Router = IS_APP ? HashRouter : BrowserRouter;

function Guard({ children, manager }: { children: ReactNode; manager?: boolean }) {
  const { user } = useApp();
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 150); return () => clearTimeout(t); }, []);
  if (!user) return ready ? <Navigate to="/login" replace state={{ from: location.pathname }} /> : null;
  if (manager && !canManage(user)) return <Navigate to="/pdv" replace />;
  return <>{children}</>;
}

function Home() {
  const { user } = useApp();
  return <Navigate to={!user ? '/login' : canManage(user) ? '/painel' : '/pdv'} replace />;
}

function FirstAccessRoute({ onDone }: { onDone: () => void }) {
  const nav = useNavigate();
  return <FirstAccess onDone={(path) => { onDone(); nav(path, { replace: true }); }} />;
}

function Root() {
  const [needsFirstAccess, setNeedsFirstAccess] = useState<boolean | null>(null);
  useEffect(() => { hasAnyUser().then((has) => setNeedsFirstAccess(!has)); }, []);
  if (needsFirstAccess === null) return null;
  return (
    <Router>
      {needsFirstAccess ? (
        <Routes><Route path="*" element={<FirstAccessRoute onDone={() => setNeedsFirstAccess(false)} />} /></Routes>
      ) : (
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/pdv" element={<Guard><Caixa /></Guard>} />
          <Route element={<Guard manager><AdminLayout /></Guard>}>
            <Route path="/painel" element={<Painel />} />
            <Route path="/produtos" element={<Produtos />} />
            <Route path="/produtos/:id" element={<ProdutoForm />} />
            <Route path="/importar" element={<Importar />} />
            <Route path="/estoque" element={<Estoque />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/vendas" element={<Vendas />} />
            <Route path="/caixas" element={<Caixas />} />
            <Route path="/usuarios" element={<Usuarios />} />
            <Route path="/config" element={<Config />} />
          </Route>
          <Route path="*" element={<Home />} />
        </Routes>
      )}
    </Router>
  );
}

export default function App() {
  return <AppProvider><Root /></AppProvider>;
}
