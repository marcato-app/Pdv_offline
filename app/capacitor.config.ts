import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.visionpdv.app',
  appName: 'Vision PDV',
  webDir: 'dist',
  backgroundColor: '#F6F5FA',
  // O app abre o sistema da nuvem (sempre atualizado). Sem internet na primeira abertura, mostra offline.html.
  server: {
    url: 'https://visionpdv.marcatoapp.com.br',
    errorPath: 'offline.html',
    allowNavigation: ['visionpdv.marcatoapp.com.br'],
  },
  appendUserAgent: 'VisionPDVApp',
  android: { allowMixedContent: false },
};

export default config;
