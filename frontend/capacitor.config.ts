import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config — Round 142 APK build (backend EMBARQUÉ).
 *
 * L'APK bundle le frontend (Vite build → dist/) ET le moteur embarqué
 * (src/embedded) : données locales + scoring déterministe + templates
 * email + jobs async. Aucun serveur distant requis — l'application reste
 * opérationnelle hors-ligne, même des années plus tard.
 *
 * Le client API utilise le chemin relatif `/api`, servi par le routeur
 * embarqué (mode offline-first). Une URL serveur peut être configurée
 * dans Settings → Backend pour l'enrichissement web/IA (scraping, AI),
 * avec repli automatique sur les données locales si le serveur meurt.
 */
const config: CapacitorConfig = {
  appId: 'com.zentara.app',
  appName: 'Zentara',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: [
      // Round 142 — mode embarqué : plus aucun tunnel par défaut.
      // On garde uniquement les accès locaux (dev / emulator).
      'http://localhost:4000',
      'http://127.0.0.1:4000',
      'http://10.0.2.2:4000', // android emulator → host machine
    ],
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: true, // dev: chrome://inspect sur device
    captureInput: true,
    backgroundColor: '#06060a',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#06060a',
      androidSplashResourceName: 'splash',
    },
  },
};

export default config;
