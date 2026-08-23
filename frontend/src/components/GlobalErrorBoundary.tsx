/**
 * GlobalErrorBoundary — intercepte toute exception lancée par un composant
 * enfant au render ou lors d'un effect/update, et l'affiche dans l'overlay
 * #boot-error plutôt que de planter silencieusement en écran noir.
 *
 * Pourquoi ce composant existe : la version précédente du projet se contentait
 * d'un `createRoot(...).render(<App />)` sans garde-fou React — si une
 * dépendance d'import throw, ou si un effect crash en StrictMode double-mount,
 * React 18 unmount l'arbre entier et #root reste vide → écran noir sans
 * aucun moyen de debug.
 */
import React from 'react';

interface GlobalErrorBoundaryProps {
  children: React.ReactNode;
}

interface GlobalErrorBoundaryState {
  error: Error | null;
}

export class GlobalErrorBoundary extends React.Component<
  GlobalErrorBoundaryProps,
  GlobalErrorBoundaryState
> {
  state: GlobalErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): GlobalErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 1) Console — pratique en dev.
    // eslint-disable-next-line no-console
    console.error('[GlobalErrorBoundary] caught:', error, info);
    // 2) Overlay — visible en prod si le pré-chargement échoue.
    try {
      const errCard = document.getElementById('boot-error');
      const errDetail = document.getElementById('boot-error-detail');
      if (errCard && errDetail) {
        errDetail.textContent =
          (error?.stack || error?.message || String(error)) +
          '\n\nComponent stack:\n' +
          (info?.componentStack || '(none)');
        errCard.classList.add('show');
      }
    } catch {
      /* DOM éventuellement détruit pendant le crash */
    }
  }

  // Quand une erreur est attrapée, on rend un fallback RACTUELLEMENT visible
  // (pas l'overlay DOM passif). Cela évite que l'utilisateur voie un écran
  // noir même si l'overlay DOM n'a pas pu être touché.
  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background text-foreground">
          <div className="max-w-xl w-full p-6 rounded-2xl border border-red-500/40 bg-card shadow-2xl">
            <h1 className="text-lg font-black uppercase tracking-widest text-red-500 mb-3">
              ⚠ Zentara runtime error
            </h1>
            <p className="text-sm text-muted-foreground mb-3">
              Une erreur est survenue pendant l'initialisation. L'équipe a déjà
              la trace via la console.
            </p>
            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-secondary/40 p-3 rounded-xl max-h-64 overflow-auto text-red-300">
              {this.state.error.stack || this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 w-full h-11 rounded-xl bg-primary text-primary-foreground font-black uppercase tracking-widest text-xs hover:scale-[1.02] transition-all"
            >
              Recharger Zentara
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
