import { useEffect, useState, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './lib/app-context';
import { hasAnyUser, canManage } from './lib/auth';
import { Login, Setup } from './pages/Login';
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

function Guard({ children, manager }: { children: ReactNode; manager?: boolean }) {
  const { user } = useApp();
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 150); return () => clearTimeout(t); }, []);
  if (!user) return ready ? <Navigate to="/login" replace /> : null;
  if (manager && !canManage(user)) return <Navigate to="/caixa" replace />;
  return <>{children}</>;
}

function Root() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  useEffect(() => { hasAnyUser().then((has) => setNeedsSetup(!has)); }, []);
  if (needsSetup === null) return null;
  if (needsSetup) return <Setup onDone={() => setNeedsSetup(false)} />;
  return (
    <HashRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/caixa" element={<Guard><Caixa /></Guard>} />
        <Route path="/admin" element={<Guard manager><AdminLayout /></Guard>}>
          <Route index element={<Painel />} />
          <Route path="produtos" element={<Produtos />} />
          <Route path="produtos/:id" element={<ProdutoForm />} />
          <Route path="importar" element={<Importar />} />
          <Route path="estoque" element={<Estoque />} />
          <Route path="clientes" element={<Clientes />} />
          <Route path="vendas" element={<Vendas />} />
          <Route path="caixas" element={<Caixas />} />
          <Route path="usuarios" element={<Usuarios />} />
          <Route path="config" element={<Config />} />
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  );
}

export default function App() {
  return <AppProvider><Root /></AppProvider>;
}
