import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Site: base "/" (links por tela, ex.: /pdv). App de Windows e celular: "./" (arquivos locais).
export default defineConfig(({ mode }) => ({
  base: mode === 'app' ? './' : '/',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
}));
