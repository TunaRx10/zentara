/**
 * Global Toast system — Round 27.
 *
 * Avant : chaque page (Prospects, Contacts, Companies, Monitoring) dupliquait
 * un `ToastBar` local + un `useState<Toast>()`. Refacto :
 *   1. `ToastProvider` (Context) gère une QUEUE de toasts (max 5, FIFO).
 *   2. `<ToastViewport />` (monté 1 fois dans App.tsx) les rend en bas de page
 *      sur toutes les routes (y compris LockScreen + Landing).
 *   3. `useToast()` expose success / error / info / warn → ergonomique depuis
 *      n'importe quel composant React.
 *   4. Bridge DOM : un listener CustomEvent 'zentara:toast' permet à du code
 *      hors-React (client.ts après un fetch raté, services utilitaires, etc.)
 *      de pousser un toast sans importer le hook.
 *
 * Robustesse (Round 27 v2) :
 *   - Le setTimeout d'auto-dismiss est TRAÇÉ par id (Map) → on nettoie
 *     l'handle quand le toast part (manuel ou FIFO evict) — pas de leak.
 *   - La pause-on-hover utilise des refs (pas de re-render), donc le timer
 *     n'est PAS ré-initialisé à chaque render du parent (bug Reviewer v1).
 *   - Click = dismiss manuel. Hover = pause.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/** ================================================================
 *  Types
 *  ================================================================ */

export type ToastKind = 'ok' | 'err' | 'info' | 'warn';

export interface ToastInput {
  kind: ToastKind;
  /** Mode simple (texte brut sur 1 ligne) — rétrocompatible. */
  text?: string;
  /**
   * Mode structuré (Round 60) : titre affiché en gras + ligne de description
   * en dessous (optionnelle). Si `title` est fourni, il prend le pas sur `text`.
   */
  title?: string;
  description?: string;
  /** Default 4000ms. Mets 0 pour sticky (jamais auto-dismiss). */
  ttl?: number;
}

interface ToastItem {
  id: string;
  kind: ToastKind;
  text: string;
  title?: string;
  description?: string;
  /** Lifetime en ms. 0 = sticky. */
  ttl: number;
}

/** ================================================================
 *  Context + Provider
 *  ================================================================ */

interface ToastApi {
  /** Fire-and-forget. Retourne l'id pour dismiss manuel si besoin. */
  push(input: ToastInput): string;
  /** Helpers ergonomiques court-circuit ttl par kind. */
  success(text: string, ttl?: number): string;
  error(text: string, ttl?: number): string;
  info(text: string, ttl?: number): string;
  warn(text: string, ttl?: number): string;
  /**
   * Variantes structurées (titre + description) — Round 60.
   * Si la 2e ligne est omise, équivalentes aux versions `.success(text)`.
   */
  successDetailed(title: string, description?: string, ttl?: number): string;
  errorDetailed(title: string, description?: string, ttl?: number): string;
  infoDetailed(title: string, description?: string, ttl?: number): string;
  warnDetailed(title: string, description?: string, ttl?: number): string;
  /** Dismiss par id — no-op si déjà sorti de la queue. */
  dismiss(id: string): void;
  /** Toutes les toasts visibles (debug UI éventuelle). */
  items: ToastItem[];
}

const ToastContext = React.createContext<ToastApi | null>(null);

const MAX_QUEUE = 5;
const DEFAULT_TTL = 4000;

export function ToastProvider(props: {
  children: React.ReactNode;
}): React.ReactElement {
  const [items, setItems] = React.useState<ToastItem[]>([]);

  // Map<id, Timeout> — pour pouvoir clear quand un toast part manuellement
  // ou est FIFO-evicted. Évite les setTimeouts zombies qui firent après 4s
  // et appellent dismiss(id) en no-op.
  const timersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const genId = React.useCallback((): string => {
    return `t_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  }, []);

  const cancelTimer = React.useCallback((id: string): void => {
    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const dismiss = React.useCallback(
    (id: string): void => {
      cancelTimer(id);
      setItems((prev) => prev.filter((t) => t.id !== id));
    },
    [cancelTimer],
  );

  const push = React.useCallback(
    (input: ToastInput): string => {
      const id = genId();
      const ttl = input.ttl ?? DEFAULT_TTL;
      // Résolution du texte affiché : si title fourni, on privilégie le mode
      // structuré (title+description). Sinon on retombe sur `text` brut.
      const item: ToastItem = {
        id,
        kind: input.kind,
        text: input.title
          ? input.description
            ? `${input.title}\n${input.description}`
            : input.title
          : (input.text ?? ''),
        title: input.title,
        description: input.description,
        ttl,
      };
      setItems((prev) => {
        // FIFO : si on dépasse MAX_QUEUE, on vire le plus vieux ET on
        // annule son timer (évite zombie setTimeout).
        const next = [...prev, item];
        if (next.length > MAX_QUEUE) {
          const evicted = next.shift();
          if (evicted) cancelTimer(evicted.id);
        }
        return next;
      });
      if (ttl > 0 && typeof window !== 'undefined') {
        const handle = setTimeout(() => dismiss(id), ttl);
        timersRef.current.set(id, handle);
      }
      return id;
    },
    [genId, cancelTimer, dismiss],
  );

  // Cleanup de TOUS les timers au démontage (HMR, logout, etc.).
  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((h) => clearTimeout(h));
      timers.clear();
    };
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      push,
      success: (text, ttl) => push({ kind: 'ok', text, ttl }),
      error: (text, ttl) =>
        push({ kind: 'err', text, ttl: ttl ?? 5500 /* errors stay longer */ }),
      info: (text, ttl) => push({ kind: 'info', text, ttl }),
      warn: (text, ttl) => push({ kind: 'warn', text, ttl }),
      successDetailed: (title, description, ttl) =>
        push({ kind: 'ok', title, description, ttl }),
      errorDetailed: (title, description, ttl) =>
        push({ kind: 'err', title, description, ttl: ttl ?? 5500 }),
      infoDetailed: (title, description, ttl) =>
        push({ kind: 'info', title, description, ttl }),
      warnDetailed: (title, description, ttl) =>
        push({ kind: 'warn', title, description, ttl }),
      dismiss,
      items,
    }),
    [push, dismiss, items],
  );

  // DOM event bridge : permet à du code hors-React (api client.ts,
  // services utilitaires, futur SDK tiers) de pousser un toast.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = (ev: Event): void => {
      const detail = (ev as CustomEvent<Partial<ToastInput>>).detail;
      // Round 60 — accepte `text` OU `title`+`description`.
      const hasText = typeof detail.text === 'string' && detail.text.length > 0;
      const hasStructured =
        typeof detail.title === 'string' && detail.title.length > 0;
      if (!hasText && !hasStructured) return;
      push({
        kind: (detail.kind ?? 'info') as ToastKind,
        text: detail.text,
        title: detail.title,
        description: detail.description,
        ttl: detail.ttl,
      });
    };
    window.addEventListener('zentara:toast', handler);
    return () => window.removeEventListener('zentara:toast', handler);
  }, [push]);

  return (
    <ToastContext.Provider value={api}>
      {props.children}
      <ToastViewport />
    </ToastContext.Provider>
  );
}

/** Hook principal. Throw si utilisé hors d'un ToastProvider — fail fast. */
export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error(
      'useToast() doit être appelé sous <ToastProvider>. Vérifie App.tsx.',
    );
  }
  return ctx;
}

/** ================================================================
 *  Viewport (monté 1 fois dans le provider)
 *  ================================================================ */

const STYLE_BY_KIND: Record<ToastKind, string> = {
  ok: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 dark:text-emerald-200',
  err: 'bg-red-500/15 border-red-500/40 text-red-300 dark:text-red-200',
  warn: 'bg-amber-500/15 border-amber-500/40 text-amber-300 dark:text-amber-200',
  info: 'bg-zinc-800/90 border-zinc-700 text-zinc-100',
};

const ICON_BY_KIND: Record<ToastKind, string> = {
  ok: '✓',
  err: '✕',
  warn: '!',
  info: 'i',
};

function ToastViewport(): React.ReactElement | null {
  const ctx = React.useContext(ToastContext);
  if (!ctx) return null;
  const { items, dismiss } = ctx;

  // IMPORTANT (bug insertBefore) : on monte le viewport dans un PORTAL sur
  // document.body, PAS dans l'arbre React courant. La pile d'erreur « insertBefore
  // … pas un enfant de ce nœud » montrait un <button> du ToastViewport en cours
  // de commit pendant l'init — parce que l'arbre autour (AppLayout + Suspense du
  // lazy Dashboard + toasts d'erreur backend au boot) montait/démontait des
  // nœuds en concurrence, React insérait alors le bouton avant une référence qui
  // venait d'être détachée.
  //
  // Avec un portail sur <body>, le parent du viewport est STABLE et hors de tout
  // subtree suspendu/re-monté : React n'insère plus jamais devant une référence
  // orpheline. On garde aussi un nœud conteneur toujours monté.
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="toast-viewport"
      className={cn(
        'fixed left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 pointer-events-none',
        'bottom-20 max-[calc(100vw-2rem)]',
      )}
      style={{
        bottom: 'max(5rem, calc(env(safe-area-inset-bottom, 0px) + 4.5rem))',
        maxWidth: 'calc(100vw - 2rem)',
      }}
    >
      {items.map((t) => (
        <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>,
    document.body,
  );
}

/** ================================================================
 *  ToastCard : pause-on-hover stable (refs only, pas de re-render)
 *  ================================================================ */

function ToastCard({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: () => void;
}): React.ReactElement {
  // On stocke l'`onDismiss` dans une ref → le useEffect du timer n'a
  // PAS besoin de `onDismiss` dans ses deps → le timer NE SE RÉINITIALISE
  // PAS à chaque render du parent (bug critique évité).
  const onDismissRef = React.useRef(onDismiss);
  React.useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  // Paused accounting — disjoint de React state pour éviter tout re-render.
  const mountedAt = React.useRef(Date.now());
  const pausedSince = React.useRef<number | null>(null);
  const totalPausedMs = React.useRef(0);
  const [paused, setPaused] = React.useState(false);

  React.useEffect(() => {
    if (item.ttl <= 0) return; // sticky, jamais auto-dismiss
    const fire = (): void => onDismissRef.current();
    let id: ReturnType<typeof setTimeout> | null = null;

    const computeRemaining = (): number => {
      const now = Date.now();
      const el =
        now -
        mountedAt.current -
        totalPausedMs.current -
        (pausedSince.current !== null ? now - pausedSince.current : 0);
      return Math.max(0, item.ttl - el);
    };

    const schedule = (): void => {
      const remaining = computeRemaining();
      if (id) clearTimeout(id);
      if (remaining <= 0) {
        fire();
        return;
      }
      id = setTimeout(fire, remaining);
    };

    schedule();
    return () => {
      if (id) clearTimeout(id);
    };
  }, [item.ttl, paused]); // onDismiss volontairement omis → pas de reset

  const handleMouseEnter = (): void => {
    if (item.ttl <= 0) return;
    if (pausedSince.current === null) pausedSince.current = Date.now();
    setPaused(true);
  };
  const handleMouseLeave = (): void => {
    if (item.ttl <= 0) return;
    if (pausedSince.current !== null) {
      totalPausedMs.current += Date.now() - pausedSince.current;
      pausedSince.current = null;
    }
    setPaused(false);
  };

  // Round 60 — mode détaillé (title + description) : layout 2 lignes.
  const detailed = !!item.title;

  return (
    <button
      type="button"
      onClick={onDismiss}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-testid={`toast-${item.kind}`}
      className={cn(
        'pointer-events-auto inline-flex items-start gap-2 px-4 py-3 rounded-xl border text-xs font-medium',
        'backdrop-blur-md shadow-lg shadow-black/20 animate-in fade-in slide-in-from-bottom-2',
        'transition-all hover:scale-[1.02] active:scale-[0.98]',
        detailed ? 'min-w-[280px] max-w-[440px]' : 'min-w-[260px] max-w-[420px]',
        'text-left',
        STYLE_BY_KIND[item.kind],
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 mt-0.5',
          item.kind === 'ok' && 'bg-emerald-500/30',
          item.kind === 'err' && 'bg-red-500/30',
          item.kind === 'warn' && 'bg-amber-500/30',
          item.kind === 'info' && 'bg-zinc-700',
        )}
      >
        {ICON_BY_KIND[item.kind]}
      </span>
      <span className="flex-1 min-w-0 break-words whitespace-pre-line leading-snug">
        {detailed ? (
          <>
            <span className="block font-semibold text-[12px]">{item.title}</span>
            {item.description && (
              <span className="block opacity-90 mt-0.5 text-[11px]">
                {item.description}
              </span>
            )}
          </>
        ) : (
          item.text
        )}
      </span>
    </button>
  );
}

/** ================================================================
 *  Helper non-React : dispatch DOM event.
 *
 *  Usage (depuis du code hors-React, ex. services/api/client.ts) :
 *    import { fireToast } from '@/contexts/ToastProvider'
 *    fireToast('error', 'Backend injoignable')
 *
 *  Le listener sur `window` côté Provider transforme l'event en `push()`
 *  → passe par le même code-path que `useToast().error()`.
 *  ================================================================ */
export function fireToast(
  kind: ToastKind,
  text: string,
  ttl?: number,
): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('zentara:toast', {
      detail: { kind, text, ttl },
    }),
  );
}

/**
 * Round 60 — fireToast signature étendue (title + description).
 *
 * Usage : `fireToast({ kind: 'ok', title: 'Supprimé', description: 'Qonto' })`
 *        passe par le même DOM bridge que `fireToast('ok', 'Supprimé')` mais
 *        affiche un toast structuré 2 lignes (déjà géré par ToastCard).
 */
export function fireToastStructured(input: {
  kind: ToastKind;
  title: string;
  description?: string;
  ttl?: number;
}): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('zentara:toast', {
      detail: {
        kind: input.kind,
        title: input.title,
        description: input.description,
        ttl: input.ttl,
      },
    }),
  );
}
