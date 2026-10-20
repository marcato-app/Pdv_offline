import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { db } from './lib/db';
import { loadTheme } from './lib/theme';
import { startSyncLoop } from './lib/sync';
import { startAutoBackup } from './lib/backup';
import { STORE_SLUG } from './lib/store';
import { StartPage } from './pages/Login';
import { Dono } from './pages/Dono';
import { finishPendingLogin } from './lib/auth';
import { startTableLabels } from './lib/table-labels';
import { startUpdateChecks } from './lib/update';

startTableLabels();
startUpdateChecks();

// Pede ao navegador para não apagar os dados locais quando faltar espaço.
navigator.storage?.persist?.().catch(() => undefined);

if (location.pathname.startsWith('/dono')) {
  // Painel do dono do Vision PDV (lojas e chaves de ativação).
  createRoot(document.getElementById('root')!).render(<StrictMode><Dono /></StrictMode>);
} else if (!STORE_SLUG) {
  // Nenhuma loja escolhida neste aparelho: página inicial (entrar ou criar loja).
  createRoot(document.getElementById('root')!).render(<StrictMode><StartPage /></StrictMode>);
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

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
