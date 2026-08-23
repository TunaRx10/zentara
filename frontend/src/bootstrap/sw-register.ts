/**
 * Round 36 — service worker registration + Page Visibility bridge.
 *
 * Cette fonction est appelée UNE FOIS au boot (`main.tsx`) :
 *
 *   1. Enregistre `/sw.js` comme service worker du scope de la page.
 *      → Network-first API, cache-first assets, fallback offline.
 *
 *   2. Demande au moteur du navigateur la permission notifications
 *      (best-effort, sans hard-fail).
 *
 *   3. Si le navigateur supporte `PeriodicBackgroundSync` : on
 *      enregistre le tag `zentara-heartbeat` (Chrome ≥ 80) qui tape
 *      `/api/tasks/heartbeat` toutes les ~4 min en arrière-plan — même
 *      onglet caché. Safari iOS ne supporte pas : fallback sur le
 *      heartbeat in-foreground via `document.visibilitychange`.
 *
 *   4. Met en place un bridge `document.visibilitychange`→postMessage au
 *      SW pour relancer un heartbeat quand l'utilisateur revient.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

declare global {
  interface Window {
    __ZENTARA_SW_READY__?: boolean;
  }
}

let isRegistered = false;

export function registerZentaraServiceWorker(): void {
  if (typeof window === 'undefined') return;
  // Service workers ne fonctionnent qu'en HTTPS ou localhost (sauf iframe).
  const isSecure = window.isSecureContext || /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  if (!isSecure) {
    console.info('[zentara/sw] contexte non-sécurisé → SW désactivé.');
    return;
  }

  if (!('serviceWorker' in navigator)) {
    console.info('[zentara/sw] API ServiceWorker indisponible → fallback polling seul.');
    setupForegroundHeartbeat();
    return;
  }

  if (isRegistered) return;
  isRegistered = true;

  // Évite d'enregistrer sur les chemins preview type /preview/<hash>.../ car
  // chaque reload mute le scope du SW. On tolère, le SW est re-installable.
  //
  // Round 71 — cache-busting query string `?v=<buildId>`.
  //
  // Sans cette query, un proxy intermédiaire (Cloudflare edge, certains
  // CDN) peut continuer à servir un `sw.js` mis en cache avec une version
  // obsolète du `CACHE_VERSION` interne (`zentara-r68-v8` ou autre).
  // Tant que le navigateur reçoit le même `sw.js` byte-pour-byte, il ne
  // déclenche pas l'activate handler → les nouveaux caches ne sont jamais
  // créés et le user reste bloqué sur l'ancien bundle.
  //
  // En ajoutant `?v=<buildId>` à chaque déploiement, l'URL change → le
  // proxy doit fetcher la nouvelle version → le SW s'installe et active,
  // chasseur de caches obsolètes.
  const BUILD_ID =
    (typeof window !== 'undefined' && (window as unknown as { __BUILD_ID__?: string }).__BUILD_ID__) ||
    (import.meta.env?.VITE_BUILD_ID as string | undefined) ||
    // Fallback: timestamp tronqué - chaque déploiement change l'ID au boot.
    String(Date.now()).slice(-10);

  const swURL = `${window.location.origin}/sw.js?v=${encodeURIComponent(BUILD_ID)}`;

  navigator.serviceWorker
    .register(swURL, {
      scope: '/',
      type: 'classic',
      updateViaCache: 'none',
    })
    .then((registration) => {
      window.__ZENTARA_SW_READY__ = true;
      console.info('[zentara/sw] SW enregistré (scope:', registration.scope, ')');

      // Periodic Background Sync (best-effort).
      if ('periodicSync' in registration) {
        (registration as ServiceWorkerRegistration & { periodicSync?: { register: (tag: string, opts: { minInterval: number }) => Promise<void> } })
          .periodicSync?.register('zentara-heartbeat', { minInterval: 4 * 60_000 })
          .catch((err) => console.info('[zentara/sw] periodicSync refusé:', err));
      }

      // Background Sync one-shot (utilisable après une mutation offline).
      if ('sync' in registration) {
        (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } })
          .sync?.register('zentara-tasks-sync')
          .catch(() => undefined);
      }

      // Update check explicite si un nouveau SW a pris la place.
      registration.addEventListener('updatefound', () => {
        const sw = registration.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            console.info('[zentara/sw] nouvelle version installée → SKIP_WAITING.');
            sw.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    })
    .catch((err) => {
      console.warn('[zentara/sw] échec d\'enregistrement (continu sans SW):', err);
      setupForegroundHeartbeat();
    });

  // Bridge foreground pour Safari iOS / navigateurs sans BackgroundSync :
  //    - Ping heartbeat toutes les 4 min quand le doc est visible.
  //    - Relance immédiate au retour de foreground (visibilitychange).
  //    - À chaque minute 0, on repoll pour les notifications (transition douce
  //      depuis les polling React Query déjà en place).
  setupForegroundHeartbeat();

  // Bridge SW → page : met à jour la dernière heartbeat reçue (cosmétique).
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data?.type === 'heartbeat') {
      try {
        window.dispatchEvent(new CustomEvent('zentara:sw-heartbeat', { detail: ev.data }));
      } catch (_e) { /* dead */ }
    }
  });

  // Best-effort demande de permission notifications.
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => undefined);
    void promptForPwaInstallIfPossible();
  }
}

/**
 * Bridge in-foreground (pour navigateurs sans BackgroundSync).
 * Effectue un `GET /api/tasks/heartbeat` toutes les 4 min pour prouver
 * que la session est active, et refait un poll immédiat au retour de
 * foreground (l'app reste "vivante" en arrière-plan).
 */
function setupForegroundHeartbeat(): void {
  if (typeof window === 'undefined') return;
  const HEARTBEAT_MS = 4 * 60_000;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const ping = () => {
    if (document.visibilityState !== 'visible') return;
    // On ne bloque pas l'UI ; fetch silencieux ; on tolère CORS / offline.
    try {
      const apiBase = (import.meta.env?.VITE_API_BASE_URL as string | undefined) || '/api';
      void fetch(`${apiBase}/tasks/heartbeat`, {
        method: 'GET',
        credentials: 'include',
        mode: 'same-origin',
      }).catch(() => undefined);
    } catch (_e) {
      /* ignore */
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      ping();
      schedule();
    }, HEARTBEAT_MS);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Relance un heartbeat immédiat + planifie le suivant.
      ping();
      // Relance aussi un refetch des counts via event custom (le hook
      // useTaskCountsQuery ré-fetch si on lui demande). On émet un signal.
      try {
        window.dispatchEvent(new CustomEvent('zentara:tasks-refetch-now'));
      } catch (_e) { /* dead */ }
    }
    schedule();
  });

  if (document.visibilityState === 'visible') {
    ping();
    schedule();
  } else {
    schedule();
  }
}

/**
 * Optionnel : invite l'utilisateur à installer la PWA si le navigateur
 * le propose (Chrome Android / Edge). On ne bloque jamais le flux user.
 */
async function promptForPwaInstallIfPossible(): Promise<void> {
  try {
    const ev = (window as Window & { deferredPWA?: BeforeInstallPromptEvent }).deferredPWA;
    if (ev && typeof ev.prompt === 'function') {
      await ev.prompt();
      ev.prompt();
    }
  } catch (_e) { /* dismiss */ }
}
