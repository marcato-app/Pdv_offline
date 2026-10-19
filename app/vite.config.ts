import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' para funcionar dentro do app de Windows e do celular (arquivos locais).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
});
