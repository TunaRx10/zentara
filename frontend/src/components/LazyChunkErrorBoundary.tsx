/**
 * LazyChunkErrorBoundary — Round 69.
 *
 * Pourquoi : à chaque rebuild Vite re-hashe les chunks (AICenterPage-XXXX.js,
 * DashboardPage-YYYY.js). Si l'utilisateur a une session ouverte depuis
 * longtemps et que le SW sert un index.html obsolète, React.lazy() tente
 * d'importer un chunk qui n'existe plus sur disque → erreur runtime
 * "Failed to fetch dynamically imported module".
 *
 * Ce composant attrape l'erreur, demande au SW de purger son cache puis
 * recharge la page une fois. Un second échec consécutif affiche un écran
 * "Reload manuel" pour éviter une boucle infinie.
 */
import React from 'react';

interface State {
  hasError: boolean;
  message: string;
  recovered: boolean;
}

/**
 * Compteur de recovery par session : on limite le nombre d'auto-reload
 * consécutifs pour éviter une boucle infinie si le serveur ne sert
 * vraiment pas le chunk (ex: rebuild raté). Quand on a déjà tenté 3
 * fois dans cette session, on affiche l'écran de recovery manuel.
 */
const RECOVERY_COUNTER_KEY = 'zentara.lazyChunkRecoveryCount';
const RECOVERY_COUNTER_MAX = 3;

interface Props {
  children: React.ReactNode;
  /** skeleton fallback pendant que React.lazy charge. */
  fallback?: React.ReactNode;
}

export class LazyChunkErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '', recovered: false };
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Lit le compteur de tentatives de recovery depuis sessionStorage.
   * Si on dépasse RECOVERY_COUNTER_MAX pour la session, on n'auto-recharge
   * plus : on montre l'écran de recovery manuel (bouton 'Recharger').
   */
  private static readRecoveryCount(): number {
    if (typeof window === 'undefined') return 0;
    try {
      const raw = window.sessionStorage.getItem(RECOVERY_COUNTER_KEY);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (_e) {
      return 0;
    }
  }

  private static bumpRecoveryCount(): number {
    if (typeof window === 'undefined') return 0;
    try {
      const n = LazyChunkErrorBoundary.readRecoveryCount() + 1;
      window.sessionStorage.setItem(RECOVERY_COUNTER_KEY, String(n));
      return n;
    } catch (_e) {
      return 0;
    }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Round 69 — on ne récupère QUE les chunk-load errors. Les autres
    // erreurs React remontent normalement (ErrorBoundary parent).
    const isChunkError =
      /dynamically imported module/i.test(error?.message ?? '') ||
      /Failed to fetch/i.test(error?.message ?? '') ||
      /Loading chunk/i.test(error?.message ?? '') ||
      /Loading CSS chunk/i.test(error?.message ?? '');
    return { hasError: true, message: isChunkError ? error.message : error.message };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const isChunkError =
      /dynamically imported module/i.test(error?.message ?? '') ||
      /Failed to fetch/i.test(error?.message ?? '') ||
      /Loading chunk/i.test(error?.message ?? '') ||
      /Loading CSS chunk/i.test(error?.message ?? '');
    // eslint-disable-next-line no-console
    console.warn('[LazyChunkErrorBoundary]', {
      isChunkError,
      message: error?.message,
      info: info?.componentStack?.slice(0, 320),
    });
    if (!isChunkError) return;

    // Round 69 — limiter le nombre d'auto-reload par session pour
    // éviter une boucle infinie si le chunk demandé n'existe vraiment
    // pas sur le serveur (rebuild raté, fichier manquant sur le
    // déploiement, etc.).
    const recoveryCount = LazyChunkErrorBoundary.bumpRecoveryCount();
    if (recoveryCount > RECOVERY_COUNTER_MAX) {
      // eslint-disable-next-line no-console
      console.error(
        `[LazyChunkErrorBoundary] ${RECOVERY_COUNTER_MAX} tentatives épuisées, on bascule en recovery manuel.`,
        { recoveryCount },
      );
      return; // l'UI (render()) affiche déjà le bouton Recharger manuellement.
    }

    // 1. Demander au SW de purger ses caches (supprime les chunks
    //    obsolètes que l'utilisateur traînait depuis le rebuild
    //    précédent).
    if ('serviceWorker' in navigator) {
      try {
        navigator.serviceWorker.controller?.postMessage({ type: 'CACHE_CLEAR' });
      } catch (_e) {
        /* noop */
      }
    }

    // 2. Forcer un reload (avec léger délai pour laisser le SW traiter
    //    le message CACHE_CLEAR). Après le reload, le compteur est
    //    conservé dans sessionStorage : si le chunk est encore down,
    //    on finit sur l'écran manuel.
    this.reloadTimer = setTimeout(() => {
      try {
        const url = window.location.pathname + window.location.search + window.location.hash;
        window.location.replace(url);
      } catch (_e) {
        window.location.reload();
      }
    }, 120);
  }

  componentWillUnmount(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
  }

  handleManualReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    // Pendant la recovery auto, on n'affiche rien (le reload remplace
    // l'iframe dans 120 ms). Si on arrive ici après reload, c'est qu'on
    // a fait un 2e crash → écran de recovery manuel.
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6">
        <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/80 p-6 text-center shadow-xl backdrop-blur">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-fuchsia-500/15 text-fuchsia-300">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 9v3.75M12 17.25h.008v.008H12v-.008ZM9.348 4.348a18.84 18.84 0 0 1 5.304 0c.396.05.66.418.586.812a18.78 18.78 0 0 1-.726 2.91m-9.928 12.546a18.79 18.79 0 0 1-.726-2.91c-.073-.394.19-.762.586-.812a18.84 18.84 0 0 1 5.304 0m6.456 0a18.84 18.84 0 0 0 5.304 0c.396-.05.66-.418.586-.812a18.78 18.78 0 0 0-.726-2.91M9.348 4.348 7.43 2.43m11.14 11.918 1.918 1.918M7.43 2.43l1.918 1.918m0 0L4.348 9.348m11.14 11.918-1.918 1.918M12 21.5v-3"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-foreground">Module indisponible</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Une nouvelle version du module a été déployée. Rechargement
            automatique en cours…
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground/70">
            {this.state.message || 'chunk load failed'}
          </p>
          <button
            onClick={this.handleManualReload}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/15 px-4 py-2 text-sm font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/25"
          >
            Recharger manuellement
          </button>
        </div>
      </div>
    );
  }
}
