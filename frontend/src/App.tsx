import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AuthedRoutes } from '@/app/router';
import { AuthProvider } from '@/services/auth/auth.context';
import { secureStorage, STORAGE_KEYS } from '@/services/auth/secure-storage';
import { getApiClient, ENDPOINTS } from '@/services/api/client';
import { useAuth } from '@/services/auth/auth.context';
import { ToastProvider } from '@/contexts/ToastProvider';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

/**
 * Garde l'application — Round 120 : le PIN est totalement supprimé.
 *   - preload        → écran noir de transition (montage React)
 *   - tout le reste → AuthedRoutes (dashboard directement)
 *
 * Plus de LockScreen : l'auto-login se fait au boot dans AuthProvider,
 * et l'app s'ouvre directement sur le dashboard.
 */
function AuthGate(): React.ReactElement {
  const { state } = useAuth();

  if (state.kind === 'preload') return <div className="fixed inset-0 bg-background" aria-hidden />;
  return <AuthedRoutes />;
}

function App() {
  // On injecte le token getter +401 handler dans le client API au plus tôt.
  React.useEffect(() => {
    const api = getApiClient();
    api.setTokenGetter(async () => {
      const t = await secureStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      return t;
    });
    // 401 generic handler → lock screen (best-effort via context indirection).
    api.setOnUnauthorized(() => {
      try {
        window.dispatchEvent(new CustomEvent('zentara:auth-locked'));
      } catch (_e) {
        /* SSR */
      }
    });
    // Round 29 — évite le bug « DISCONNECTED collé ».
    // Si la session précédente a vu online:false (badge bloqué en store),
    // on force online:true au mount. Le hook useNetworkStatus se synchronise
    // puis bascule offline à nouveau si la prochaine requête échoue.
    try {
      window.dispatchEvent(
        new CustomEvent('zentara:network-status', { detail: { online: true } }),
      );
    } catch (_e) {
      /* SSR */
    }
  }, []);

  // Round 29 — heartbeat léger : toutes les 30 s, on ping /api/health.
  // Si la réponse arrive, on confirme online:true (le hook est déjà bon).
  // Si elle échoue, le client.ts dispatch online:false (déjà câblé).
  // L'intérêt : couvre les cas où 0 composant ne fait de fetch mais le
  // backend est revenu (ex. user inactif pendant plusieurs minutes).
  React.useEffect(() => {
    const id = setInterval(() => {
      // ENDPOINTS.health = '/health' (sans le préfixe /api, déjà fourni par baseUrl)
      // → résout en `/api/health` côté Express (donc ``ENDPOINTS.health`` est le bon).
      getApiClient()
        .get<{ success: boolean }>(ENDPOINTS.health)
        .then(() => {
          try {
            window.dispatchEvent(
              new CustomEvent('zentara:network-status', { detail: { online: true } }),
            );
          } catch (_e) {
            /* SSR */
          }
        })
        .catch(() => {
          /* Le client error path émet déjà online:false, on ne duplique pas. */
        });
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Le BrowserRouter enveloppe AuthGate pour que useLocation() (utilisé
  // dans AuthGate) ait accès au contexte Router. Sans ça, la première
  // frame throw "useLocation() may be used only in the context of a
  // <Router> component." et React 18 unmount l'arbre entier (#root vide).
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider
        onAuthChange={() => undefined /* Changed by client.setTokenGetter via mémoire */}
      >
        {/* Round 27 — ToastProvider enveloppe TOUT (AuthGate + LockScreen +
            Landing) pour que les toasts s'affichent partout, y compris
            quand le LockScreen bloque l'accès au reste. Le <ToastViewport />
            est monté une fois dans le provider. */}
        <ToastProvider>
          <BrowserRouter>
            <AuthGate />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
