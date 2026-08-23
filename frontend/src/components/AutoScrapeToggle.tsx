/**
 * AutoScrapeToggle — Round 92.
 *
 * Panneau toggle "auto-scrape à la création" pour CompanyDetailPage.
 * 3 options :
 *   - Off      : aucune logique automatique
 *   - Always   : fire-and-forget dès la création (et à chaque changement policy)
 *   - When hot ≥70 : attend que `companies.score` atteigne 70+ pour fire
 *
 * Affiche aussi le statut live (last_auto_scrape_at, can_fire_now, reason)
 * polled toutes les 5s via `useAutoScrapeStatusQuery`, ainsi qu'un bouton
 * "Trigger maintenant" qui appelle POST /scrape-contacts direct.
 *
 * Source de vérité :
 *   - GET /api/companies/:id/auto-scrape (status)
 *   - PATCH /api/companies/:id/auto-scrape (policy change)
 *   - POST /api/companies/:id/scrape-contacts (manual trigger)
 */
import React from 'react';
import { ScanSearch, Sparkles, Clock4, Zap, Loader2, Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, safeString } from '@/lib/utils';
import {
  useAutoScrapeStatusQuery,
  useUpdateAutoScrapeMutation,
} from '@/hooks/useEntityActions';
import { getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import type { AutoScrapePolicy, AutoScrapeStatus } from '@/types';

interface Props {
  companyId: string;
  /** Si défini, utilisé comme valeur initiale affichée avant le 1er GET. */
  initialPolicy?: AutoScrapePolicy;
  className?: string;
}

const OPTIONS: Array<{
  value: AutoScrapePolicy;
  label: string;
  shortLabel: string;
  description: string;
  icon: React.ReactElement;
  pillClass: string;
}> = [
  {
    value: 'off',
    label: 'Désactivé',
    shortLabel: 'Off',
    description: 'Aucun déclenchement automatique — tout est manuel.',
    icon: <Clock4 size={12} />,
    pillClass: 'border-slate-500/40 bg-slate-500/15 text-slate-500',
  },
  {
    value: 'always',
    label: 'À la création',
    shortLabel: 'Always',
    description: 'Scrape le site dès que cette fiche est créée (si website présent).',
    icon: <Sparkles size={12} />,
    pillClass: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400',
  },
  {
    value: 'when_hot',
    label: 'Quand score ≥ 70',
    shortLabel: 'When hot',
    description: 'Attend que le score atteigne 70+ pour déclencher (jamais à la création).',
    icon: <Flame size={12} />,
    pillClass: 'border-amber-500/40 bg-amber-500/15 text-amber-400',
  },
];

function fmtRemaining(last: string | null): string {
  if (!last) return 'jamais';
  const ms = Date.now() - new Date(last).getTime();
  if (Number.isNaN(ms)) return '?';
  const hours = ms / 36e5;
  if (hours < 1) return `il y a ${Math.round(ms / 6e4)} min`;
  if (hours < 24) return `il y a ${Math.round(hours)} h`;
  return new Date(last).toLocaleString();
}

export function AutoScrapeToggle({
  companyId,
  initialPolicy,
  className,
}: Props): React.ReactElement {
  const statusQuery = useAutoScrapeStatusQuery(companyId);
  const updateMut = useUpdateAutoScrapeMutation();
  const [firePending, setFirePending] = React.useState(false);

  const status: AutoScrapeStatus | undefined = statusQuery.data;
  const policy: AutoScrapePolicy = status?.policy ?? initialPolicy ?? 'off';

  const onChange = async (next: AutoScrapePolicy) => {
    try {
      await updateMut.mutateAsync({ id: companyId, auto_scrape: next });
    } catch (e) {
      // silent — React Query error surface si on le branche plus tard
      void e;
    }
  };

  const onFireNow = async () => {
    setFirePending(true);
    try {
      await getApiClient().post(ENDPOINTS.companyScrapeContacts(companyId), {
        create_prospects: true,
        persist: true,
      });
      // Refresh après le fire (déclenche aussi le polling 5s).
      await statusQuery.refetch();
    } finally {
      setFirePending(false);
    }
  };

  const hasWebsite = true; // on n'expose pas ce champ ici ; le backend a déjà validé.

  return (
    <div
      className={cn(
        'rounded-2xl border border-border/60 bg-card/40 p-4 space-y-3',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0 shadow-lg shadow-lime-500/20">
          <ScanSearch size={16} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-black tracking-tight">Auto-scrape</h3>
            <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-lime-500/15 text-lime-400">
              Round 92
            </span>
            {status?.pending && (
              <span
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded border border-amber-500/40 bg-amber-500/15 text-amber-400"
                title="En attente du passage du score à ≥70"
              >
                <Loader2 size={9} className="animate-spin" />
                Pending
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Déclenche automatiquement le scraping du site web + la création de
            prospects. Trois modes : <strong>off</strong>, <strong>à la
            création</strong>, ou <strong>quand le score atteint 70+</strong>.
          </p>
        </div>
      </div>

      {/* Segmented control */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {OPTIONS.map((opt) => {
          const active = opt.value === policy;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              disabled={updateMut.isPending}
              className={cn(
                'text-left rounded-xl border-2 p-2.5 transition-all',
                active
                  ? `${opt.pillClass} shadow-lg`
                  : 'border-border/40 bg-card/40 hover:bg-secondary/30',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                {opt.icon}
                <span className="text-[11px] font-black uppercase tracking-widest">
                  {opt.shortLabel}
                </span>
                {active && (
                  <span className="ml-auto text-[9px] font-black px-1 rounded bg-background/40">
                    ✓
                  </span>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground leading-snug">
                {opt.description}
              </div>
            </button>
          );
        })}
      </div>

      {/* Status row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
        <div className="rounded-lg border border-border/40 bg-card/40 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            Dernier auto-scrape
          </div>
          <div className="text-xs font-bold mt-0.5">
            {fmtRemaining(status?.last_auto_scrape_at ?? null)}
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-card/40 px-2 py-1.5">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            État
          </div>
          <div
            className={cn(
              'text-xs font-bold mt-0.5',
              status?.can_fire_now
                ? 'text-emerald-400'
                : status?.reason
                  ? 'text-amber-400'
                  : 'text-muted-foreground',
            )}
            title={status?.reason}
          >
            {status?.can_fire_now
              ? 'Prêt à fire'
              : safeString(status?.reason ?? '—')}
          </div>
        </div>
        <div className="rounded-lg border border-border/40 bg-card/40 px-2 py-1.5 col-span-2 sm:col-span-1">
          <div className="text-[9px] uppercase tracking-widest text-muted-foreground">
            Action manuelle
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onFireNow}
            disabled={firePending || !hasWebsite || statusQuery.isFetched === false}
            className="mt-1 h-7 px-2 text-[10px] font-bold"
            title="Force un scrape maintenant (ignore le throttle 24h pour cette action manuelle)"
          >
            {firePending ? (
              <Loader2 size={11} className="mr-1 animate-spin" />
            ) : (
              <Zap size={11} className="mr-1" />
            )}
            {firePending ? 'Scraping…' : 'Trigger maintenant'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default AutoScrapeToggle;
