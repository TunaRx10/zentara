/**
 * LeadTier — shared tier logic + visual components.
 *
 * Centralises the Hot/Warm/Cold mapping used across Lead Finder pages.
 * Thresholds default to:
 *   - score >= 75 → Hot  (green)
 *   - score 50–74 → Warm (amber)
 *   - score < 50  → Cold (slate)
 *
 * Custom thresholds can be passed via a `TierConfig` prop.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export type Tier = 'hot' | 'warm' | 'cold';

export interface TierConfig {
  hot: number;
  warm: number;
}

const DEFAULTS: TierConfig = { hot: 75, warm: 50 };

export function getTier(score: number | null | undefined, cfg: TierConfig = DEFAULTS): Tier {
  if (typeof score !== 'number') return 'cold';
  if (score >= cfg.hot) return 'hot';
  if (score >= cfg.warm) return 'warm';
  return 'cold';
}

/**
 * Inline tag-like pill: coloured border + dot + uppercase label.
 */
export function TierPill({ tier }: { tier: Tier }): React.ReactElement {
  const map = {
    hot: { label: 'Hot', cls: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30' },
    warm: { label: 'Warm', cls: 'bg-amber-500/15 text-amber-500 border-amber-500/30' },
    cold: { label: 'Cold', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  } as const;
  const cfg = map[tier];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest',
        cfg.cls,
      )}
      data-tier={tier}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          tier === 'hot' ? 'bg-emerald-500 animate-pulse' : tier === 'warm' ? 'bg-amber-500' : 'bg-slate-400',
        )}
      />
      {cfg.label}
    </span>
  );
}

/**
 * Score dot + number — used inside a table cell.
 */
export function ScoreCell({ score }: { score: number | null | undefined }): React.ReactElement {
  const t = getTier(score);
  return (
    <div className="flex items-center gap-2" data-tier={t}>
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          t === 'hot' ? 'bg-emerald-500' : t === 'warm' ? 'bg-amber-500' : 'bg-slate-400',
        )}
      />
      <span className="font-bold tabular-nums">{typeof score === 'number' ? score : '—'}</span>
    </div>
  );
}

/**
 * Tier-count chip filter for the Lead Finder toolbar.
 * Renders as a button so users can click to toggle the tier filter.
 */
export function TierFilterChip({
  id,
  label,
  count,
  tier,
  active,
  onSelect,
}: {
  id: Tier | 'all';
  label: string;
  count: number;
  /** Visual accent of the chip: 'all' uses primary, others use their tier color. */
  tier: 'all' | Tier;
  active: boolean;
  onSelect: (id: Tier | 'all') => void;
}): React.ReactElement {
  const dotCls =
    tier === 'all'
      ? 'bg-primary'
      : tier === 'hot'
        ? 'bg-emerald-500'
        : tier === 'warm'
          ? 'bg-amber-500'
          : 'bg-slate-400';
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold',
        'transition-all',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border/60 bg-card/40 text-muted-foreground hover:text-foreground hover:border-border',
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', dotCls)} />
      {label}
      <span
        className={cn(
          'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px]',
          active ? 'bg-white/15 text-primary-foreground' : 'bg-secondary text-muted-foreground',
        )}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Compute counts grouped by tier.
 */
export function countByTier(scores: Array<number | null | undefined>): Record<Tier, number> {
  const out: Record<Tier, number> = { hot: 0, warm: 0, cold: 0 };
  scores.forEach((s) => {
    out[getTier(s)]++;
  });
  return out;
}
