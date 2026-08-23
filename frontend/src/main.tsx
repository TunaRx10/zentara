import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { registerZentaraServiceWorker } from './bootstrap/sw-register';
import { bootstrapEmbeddedEngine } from './embedded/embedded';

// Round 142 — backend EMBARQUÉ : prépare la base locale (seed) dès le boot.
// L'application ne dépend plus d'aucun serveur externe pour fonctionner.
bootstrapEmbeddedEngine();

// Capture "uncaught" tôt aussi côté main : si un import top-level throw
// (ex: dépendance manquante, erreur de chargement dynamique), on l'affiche
// dans l'overlay plutôt que de tout perdre sur un écran noir.
window.addEventListener('error', (e) => {
  console.error('[main] window error:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[main] unhandled rejection:', e.reason);
});

// Round 36 — service worker (cache shell + heartbeat + sync API).
registerZentaraServiceWorker();

const rootEl = document.getElementById('root');
if (!rootEl) {
  // Échec total : même le div root n'existe pas. On l'affiche littéralement.
  document.body.innerHTML =
    '<div style="color:#ef4444;font-family:monospace;padding:24px;">' +
    'CRITICAL: #root element absent from index.html</div>';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <GlobalErrorBoundary>
        <App />
      </GlobalErrorBoundary>
    </StrictMode>,
  );
}
