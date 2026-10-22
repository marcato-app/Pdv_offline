import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './appearance.css';
import { startAppearance } from './lib/appearance';
import { db } from './lib/db';
import { loadTheme } from './lib/theme';
import { startSyncLoop } from './lib/sync';
import { startAutoBackup } from './lib/backup';
import { STORE_SLUG, IS_STORE_APP, IS_APP } from './lib/store';
import { StartPage } from './pages/Login';
import { Dono } from './pages/Dono';
import { Landing } from './pages/Landing';
import { Termos, Privacidade } from './pages/Legal';
import { IS_NATIVE } from './lib/platform';
import { Forgot, ResetPassword } from './pages/Password';
import { finishPendingLogin } from './lib/auth';
import { startTableLabels } from './lib/table-labels';
import { startUpdateChecks } from './lib/update';

startTableLabels();
startUpdateChecks();

// Pede ao navegador para não apagar os dados locais quando faltar espaço.
navigator.storage?.persist?.().catch(() => undefined);

const path = location.pathname.replace(/\/+$/, '') || '/';
const render = (el: JSX.Element) => createRoot(document.getElementById('root')!).render(<StrictMode>{el}</StrictMode>);

// Aparência (degradê / escuro) vale para o sistema; a página de vendas e os textos legais têm visual próprio.
if (!['/termos', '/privacidade'].includes(path) && !(path === '/' && !STORE_SLUG && !IS_NATIVE && location.protocol.startsWith('http'))) startAppearance();

if (path === '/termos') render(<Termos />);
else if (path === '/privacidade') render(<Privacidade />);
else if (path === '/esqueci') render(<Forgot />);
else if (path === '/redefinir') render(<ResetPassword />);
else if (location.pathname.startsWith('/dono')) {
  // Painel do dono do Vision PDV (lojas e chaves de ativação).
  createRoot(document.getElementById('root')!).render(<StrictMode><Dono /></StrictMode>);
} else if (!STORE_SLUG) {
  // Nenhuma loja escolhida neste aparelho: página inicial (entrar ou criar loja).
  // No site, quem chega pelo anúncio vê a página de vendas; no app vai direto para o login.
  if (path === '/cadastro' && !IS_STORE_APP) render(<StartPage initialMode="create" />);
  else if (path === '/' && !IS_NATIVE && location.protocol.startsWith('http')) render(<Landing />);
  else render(<StartPage />);
} else db.open().then(async () => {
  // Login feito na página inicial: termina aqui (salva o acesso e baixa os dados).
  await finishPendingLogin(STORE_SLUG!).catch(() => undefined);
  await loadTheme();
  startSyncLoop();
  startAutoBackup();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.PROD && !IS_APP) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
