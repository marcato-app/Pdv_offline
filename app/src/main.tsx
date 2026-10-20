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

// Pede ao navegador para não apagar os dados locais quando faltar espaço.
navigator.storage?.persist?.().catch(() => undefined);

if (!STORE_SLUG) {
  // Nenhuma loja escolhida neste aparelho: página inicial (entrar ou criar loja).
  createRoot(document.getElementById('root')!).render(<StrictMode><StartPage /></StrictMode>);
} else db.open().then(async () => {
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
