/**
 * LoadMoreButton — Round 25.
 *
 * Bouton de pagination progressive générique. À brancher sur le hook
 * `useShowMore` :
 *
 * ```tsx
 * const { visible, hasMore, showMore, shown, total, remaining } =
 *   useShowMore(filtered, 5);
 * ...
 * {filtered.length === 0 ? null : (
 *   <LoadMoreButton
 *     shown={shown}
 *     total={total}
 *     step={5}
 *     hasMore={hasMore}
 *     onClick={showMore}
 *     labelSingular="prospect"
 *     labelPlural="prospects"
 *   />
 * )}
 * ```
 */
import React from 'react';
import { Loader2, ChevronDown, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LoadMoreButtonProps {
  shown: number;
  total: number;
  step: number;
  hasMore: boolean;
  onClick: () => void;
  /** Mot qui décrit les items (utile pour le label dynamique). */
  labelSingular: string;
  labelPlural: string;
  /** Affiche un état loading (utile si onLoadMore est async). */
  loading?: boolean;
  /** Aplatit le bouton contre une touche contrast — défaut outlined primary. */
  variant?: 'primary' | 'ghost';
}

function pluralize(n: number, singular: string, plural: string): string {
  return `${n} ${n > 1 ? plural : singular}`;
}

export function LoadMoreButton({
  shown,
  total,
  step,
  hasMore,
  onClick,
  labelSingular,
  labelPlural,
  loading,
  variant = 'primary',
}: LoadMoreButtonProps): React.ReactElement | null {
  if (total === 0) return null;

  if (!hasMore) {
    return (
      <div className="flex flex-col items-center gap-1 pt-2 animate-in fade-in duration-300">
        <div className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground/60 font-bold uppercase tracking-widest">
          <CheckCircle2 size={11} className="text-emerald-500/70" />
          All {pluralize(total, labelSingular, labelPlural)} loaded
        </div>
      </div>
    );
  }

  const nextBatch = Math.min(step, total - shown);

  return (
    <div className="flex flex-col items-center gap-1.5 pt-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        aria-label={`Load ${nextBatch} more ${labelPlural}`}
        className={cn(
          'group inline-flex items-center gap-2 px-5 h-10 rounded-full text-xs font-black uppercase tracking-widest transition-all',
          'border active:scale-[0.97]',
          variant === 'primary'
            ? 'bg-primary/15 border-primary/30 text-primary hover:bg-primary/25 hover:border-primary/50 shadow-sm shadow-primary/10 hover:shadow-md hover:shadow-primary/20'
            : 'bg-card/50 border-border/40 text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-card',
          loading && 'opacity-60 cursor-progress',
        )}
      >
        {loading ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <ChevronDown size={13} className="group-hover:translate-y-0.5 transition-transform" />
        )}
        Load more
      </button>
      <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/60">
        Showing {shown} of {total} · next +{nextBatch}
      </p>
    </div>
  );
}
