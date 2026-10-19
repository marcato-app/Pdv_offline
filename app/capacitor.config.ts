import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.visionpdv.app',
  appName: 'Vision PDV',
  webDir: 'dist',
  backgroundColor: '#F6F5FA',
  android: { allowMixedContent: false },
};

export default config;
