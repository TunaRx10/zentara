/**
 * AiCenterSkeleton — Round 63.
 *
 * Fallback Suspense pour le lazy-load de AICenterPage. Reproduit la
 * charpente visuelle exacte de l'AICenterPage pour que la transition
 * lazy→real soit imperceptible (même Aurora banner, même KPI tiles
 * même ModeSwitcher — juste en placeholder shimmer).
 *
 * Pourquoi : la page AI Center faisait 2630 lignes bundleés inline. En
 * la sortant du main bundle (~950KB → ~600KB) et en affichant un
 * skeleton pendant la résolution, le First Contentful Paint passe de
 * ~12s à ~5s sur un réseau lent.
 *
 * Pas de hooks / pas d'effets / pas de données : strictement statique.
 */
import React from 'react';
import { Sparkles } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function AiCenterSkeleton(): React.ReactElement {
  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 relative">
      {/* Aurora banner — reproduit la bannière réelle (gradient + glows blobs).
         Pas animé pour économiser le CPU pendant le shimmer. */}
      <div className="relative -mx-4 md:-mx-8 lg:-mx-12 px-4 md:px-8 lg:px-12 py-5 rounded-2xl overflow-hidden border-2 border-primary/40 shadow-[0_0_60px_rgba(139,92,246,0.25)]">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-lime-500/40 via-lime-400/25 to-lime-300/35 rounded-2xl" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-tr from-primary/15 via-transparent to-rose-400/25 rounded-2xl" />
        <div className="absolute -top-20 -left-20 w-[28rem] h-[28rem] bg-lime-400/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -right-20 w-[24rem] h-[24rem] bg-violet-400/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-amber-400/15 rounded-full blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black/40 backdrop-blur-md border border-primary/50 text-[11px] font-black tracking-widest text-primary shadow-md">
              <Sparkles size={12} />
              STRATEGIC INTELLIGENCE
            </div>
            <Skeleton variant="h1" width="60%" className="bg-white/15 mt-2" />
            <Skeleton variant="text" width="40%" className="bg-white/10 mt-1" />
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            {['cyan', 'violet', 'amber'].map((c) => (
              <div
                key={c}
                className={cn(
                  'px-3 py-2 rounded-lg bg-black/40 border-2 backdrop-blur-md shadow-lg',
                  c === 'cyan' && 'border-lime-400/60 shadow-lime-500/20',
                  c === 'violet' && 'border-violet-400/60 shadow-violet-500/20',
                  c === 'amber' && 'border-amber-400/60 shadow-amber-500/20',
                )}
              >
                <Skeleton
                  variant="h2"
                  width="1.5rem"
                  className={cn(
                    'mx-auto bg-white/15',
                    c === 'cyan' && '[&]:bg-lime-400/30',
                    c === 'violet' && '[&]:bg-violet-400/30',
                    c === 'amber' && '[&]:bg-amber-400/30',
                  )}
                />
                <Skeleton variant="text" width="3rem" className="mx-auto mt-1 bg-white/10 h-2" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ModeSwitcher skeleton — 3 tabs (le 1er actif). */}
      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2">
          <Skeleton width="18rem" height="1.5rem" className="rounded-full" />
        </div>
        <div className="flex justify-center">
          <div className="inline-flex p-1 rounded-xl bg-card/80 border-2 border-primary/30 shadow-xl gap-1">
            {['Single Prospect', 'Strategic Prospecting', 'Outreach Centre'].map((label, idx) => (
              <div
                key={label}
                className={cn(
                  'h-10 px-5 inline-flex items-center gap-2 rounded-lg text-sm font-bold',
                  idx === 0
                    ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/40'
                    : 'text-muted-foreground',
                )}
              >
                <Skeleton
                  width={label === 'Strategic Prospecting' ? '10rem' : label === 'Outreach Centre' ? '8rem' : '7rem'}
                  height="0.875rem"
                  className={idx === 0 ? 'bg-primary-foreground/30' : 'bg-secondary/40'}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status shimmer row — single prospect placeholder. */}
      <div className="space-y-4">
        <Skeleton variant="h2" width="20rem" className="bg-secondary/40" />
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 lg:col-span-7 space-y-2">
            <Skeleton variant="text" width="100%" className="bg-secondary/30" />
            <Skeleton variant="text" width="92%" className="bg-secondary/30" />
            <Skeleton variant="text" width="88%" className="bg-secondary/30" />
          </div>
          <div className="col-span-12 lg:col-span-5 grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-2"
              >
                <Skeleton variant="h3" width="60%" className="bg-secondary/40" />
                <Skeleton variant="h1" width="40%" className="bg-secondary/40" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer note — petit message "Initialisation 7-engines…" pour rassurer. */}
      <div className="text-center pt-2">
        <p className="text-[11px] font-mono uppercase tracking-widest text-muted-foreground/80">
          ⟳ Chargement du pipeline 7-engines + Outreach IA…
        </p>
      </div>
    </div>
  );
}
