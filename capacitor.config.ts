import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.jordanthompson.railsim',
  appName: 'Rail Sim',
  webDir: 'dist/client',
  backgroundColor: '#15252d',
  // No server.url: shipped assets and the cab/worker chunks are entirely local.
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  ios: { scrollEnabled: false, preferredContentMode: 'mobile' },
};
export default config;
