import type { CapacitorConfig } from '@capacitor/cli';

// Apps da App Store e Play Store: o sistema vai EMBUTIDO no app (abre na hora e funciona sem internet).
// Os dados sincronizam com a nuvem (visionpdv.marcatoapp.com.br) quando há conexão.
const config: CapacitorConfig = {
  appId: 'com.visionpdv.app',
  appName: 'Vision PDV',
  webDir: 'dist',
  backgroundColor: '#F6F5FA',
  appendUserAgent: 'VisionPDVApp',
  android: { allowMixedContent: false },
  ios: { contentInset: 'never', scrollEnabled: true },
  plugins: {
    SplashScreen: { launchShowDuration: 800, launchAutoHide: true, backgroundColor: '#F6F5FA', showSpinner: false },
    StatusBar: { style: 'DARK', backgroundColor: '#5B3FA8', overlaysWebView: false },
  },
};

export default config;
