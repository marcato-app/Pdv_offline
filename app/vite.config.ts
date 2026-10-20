import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Número da versão: data e hora do build (ex.: 2026.10.20-0315).
const now = new Date();
const p = (n: number) => String(n).padStart(2, '0');
const VERSION = `${now.getUTCFullYear()}.${p(now.getUTCMonth() + 1)}.${p(now.getUTCDate())}-${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;

// Gera /version.json: o app compara com a própria versão para saber se há atualização.
const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: VERSION }) });
  },
});

// Site: base "/" (links por tela, ex.: /pdv). App de Windows e celular: "./" (arquivos locais).
export default defineConfig(({ mode }) => ({
  base: mode === 'app' ? './' : '/',
  plugins: [react(), versionFile()],
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  build: { chunkSizeWarningLimit: 1500 },
}));
