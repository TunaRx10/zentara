/**
 * AnalyticsPage — tableau de bord analytique (Round 23 → nettoyé Round 35).
 *
 * Round 35 :
 *  - Hiérarchie visuelle plus claire (header → KPIs → volume/timeseries → segments).
 *  - Moins de blocs redondants (combine les breakdowns redondants en un seul panel).
 *  - Responsive grid optimisée pour le mobile (max 2 colonnes).
 *  - Score "global" gros en haut qui combine analytics overview + prospect score.
 *
 * Branché sur les endpoints backend `/api/analytics/*` via
 * `useAnalyticsOverviewQuery` et `useAnalyticsTimeseriesQuery`.
 * Pas de recharts — uniquement SVG pur inline.
 */
import React from 'react';
import {
  TrendingUp,
  Users,
  Building2,
  Contact,
  Target,
  Sparkles,
  Activity,
  RefreshCw,
  Eye,
  BarChart3,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAnalyticsOverviewQuery, useAnalyticsTimeseriesQuery } from '@/hooks/useBackendData';
import { Sparkline } from '@/components/Sparkline';
import { cn } from '@/lib/utils';

// =====================================================================
// Helpers
// =====================================================================

function pct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

function shortNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

const CAT_COLORS = ['#06b6d4', '#22d3ee', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#3b82f6'];

// =====================================================================
// KPI Card (réutilisée par tous les compteurs)
// =====================================================================

interface KpiCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  series?: number[];
  fillId?: string;
  accent?: string;
  href?: string;
  trendChip?: string | null;
  hint?: string;
}

function KpiCard({
  label,
  value,
  icon,
  series,
  fillId,
  accent = 'text-emerald-500',
  href,
  trendChip,
  hint,
}: KpiCardProps): React.ReactElement {
  const content = (
    <div className="group relative overflow-hidden rounded-2xl border border-border/40 bg-card/60 backdrop-blur-sm p-4 hover:border-primary/40 transition-all duration-200 h-full">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-secondary/40 border border-border/40 flex items-center justify-center text-primary">
            {icon}
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
        </div>
        {trendChip && (
          <span className="text-[9px] font-black uppercase tracking-widest text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-1.5 py-0.5 animate-pulse">
            {trendChip}
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-black tracking-tight text-foreground">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
      {series && series.length > 1 && (
        <div className="px-3 pb-2 -mt-1">
          <Sparkline series={series} fillId={fillId} accent={accent} />
        </div>
      )}
      {href && (
        <Eye
          size={14}
          className="absolute top-3 right-3 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-1 transition-all"
        />
      )}
    </div>
  );
  return href ? (
    <Link to={href} className="block h-full">
      {content}
    </Link>
  ) : (
    content
  );
}

// =====================================================================
// Page
// =====================================================================

export function AnalyticsPage(): React.ReactElement {
  const {
    data: overview,
    isLoading: ovLoading,
    error: ovError,
    isError: ovIsError,
    refetch: refOv,
  } = useAnalyticsOverviewQuery();
  const tsProspects = useAnalyticsTimeseriesQuery('hot_prospects', 12);
  const tsCompanies = useAnalyticsTimeseriesQuery('hot_companies', 12);
  const tsSignals = useAnalyticsTimeseriesQuery('signals', 12);
  const tsWon = useAnalyticsTimeseriesQuery('won', 12);

  // Loading state : skeleton cards cohérents.
  if (ovLoading || !overview) {
    return (
      <div className="space-y-6 pb-20">
        <header className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.4em] text-primary">
              Analytics
            </div>
            <h1 className="text-3xl font-black tracking-tight">Strategic Metrics</h1>
          </div>
        </header>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-2xl border border-border/40 bg-card/40 animate-pulse"
            />
          ))}
        </div>
        <div className="h-px bg-border/30 my-2" />
        <div className="text-center text-sm text-muted-foreground py-12">
          Chargement des métriques analytiques…
        </div>
      </div>
    );
  }

  if (ovIsError) {
    return (
      <div className="space-y-6 pb-20">
        <header>
          <div className="text-[10px] font-black uppercase tracking-[0.4em] text-primary">
            Analytics
          </div>
          <h1 className="text-3xl font-black tracking-tight">Strategic Metrics</h1>
        </header>
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-red-500">
          <div className="font-bold mb-2">Analytics indisponible</div>
          <div className="text-sm opacity-80 mb-3">
            {(ovError as unknown as Error | null)?.message ?? 'Erreur réseau ou backend injoignable.'}
          </div>
          <button
            type="button"
            onClick={() => refOv()}
            className="h-9 px-4 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-xs font-black uppercase tracking-widest transition-colors"
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  // Calculs dérivés.
  const totalEntities = overview.prospects + overview.companies + overview.contacts;
  const coveragePct = pct(overview.intelligence, Math.max(totalEntities, 1));
  const hotProspects = (tsProspects.data?.length ?? 0)
    ? tsProspects.data![Math.max(0, tsProspects.data!.length - 1)]
    : 0;
  const hotCompanies = (tsCompanies.data?.length ?? 0)
    ? tsCompanies.data![Math.max(0, tsCompanies.data!.length - 1)]
    : 0;

  // Sparkline safe-guard.
  const safeSeries = (s: number[] | undefined, fallback = 0): number[] => {
    if (!s || s.length < 2) return Array.from({ length: 12 }, () => fallback);
    return s;
  };

  // Combined "global" score (moyenne simple sur 0-100).
  const seriesProspects = tsProspects.data ?? [];
  const seriesCompanies = tsCompanies.data ?? [];
  const seriesSignals = tsSignals.data ?? [];
  const seriesWon = tsWon.data ?? [];

  // Trend delta.
  const trend12d = (arr: number[]): string => {
    if (arr.length < 2) return '+0';
    const last = arr[arr.length - 1];
    const prev = arr[0];
    const d = last - prev;
    return `${d >= 0 ? '+' : ''}${d}`;
  };

  return (
    <div className="space-y-6 pb-20">
      {/* ============ Header ============ */}
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 size={16} className="text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary">
              Analytics
            </span>
          </div>
          <h1 className="text-3xl font-black tracking-tight mt-1">Strategic Metrics</h1>
          <p className="text-sm text-muted-foreground">
            Vue d'ensemble CRM + scoring intelligence, sur les 12 derniers jours.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refOv()}
            className="h-9 px-3 rounded-xl border border-border/60 bg-card/60 hover:border-primary/40 hover:text-primary text-xs font-bold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5 transition-all active:scale-95"
            title="Rafraichir les analytics"
          >
            <RefreshCw size={13} />
            Refresh
          </button>
          <Link
            to="/monitoring"
            className="h-9 px-3 rounded-xl border border-border/60 bg-card/60 hover:border-primary/40 hover:text-primary text-xs font-bold uppercase tracking-widest text-muted-foreground inline-flex items-center gap-1.5 transition-all active:scale-95"
          >
            <Activity size={13} />
            Monitoring
          </Link>
        </div>
      </header>

      {/* ============ Global score + summary tiles ============ */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Big global score */}
        <article className="rounded-2xl border border-border/40 bg-gradient-to-br from-primary/15 to-card/60 p-5 backdrop-blur-sm lg:col-span-1">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles size={14} className="text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">
              Global score
            </span>
          </div>
          <div className="text-5xl font-black tabular-nums leading-none bg-gradient-to-br from-foreground via-primary to-accent bg-clip-text text-transparent">
            {coveragePct.replace('%', '')}<span className="text-muted-foreground text-2xl">%</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-2">
            <span className="font-bold text-foreground">{overview.intelligence}</span> entités scoréées sur{' '}
            <span className="font-bold text-foreground">{totalEntities}</span> totales
            ·{' '}
            <span className="font-bold text-foreground">{overview.ai_analyses}</span> AI runs.
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[10px]">
            <CoverageTile label="Prospects" value={hotProspects} accent="cyan" />
            <CoverageTile label="Companies" value={hotCompanies} accent="primary" />
            <CoverageTile label="Signals" value={overview.signals} accent="amber" />
          </div>
        </article>

        {/* Timeline signals */}
        <article className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-sm p-5 lg:col-span-2">
          <header className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">
                Signal Activity · 12 jours
              </div>
              <h2 className="text-base font-bold mt-0.5">Volume de signaux quotidiens</h2>
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400 bg-cyan-400/10 border border-cyan-400/30 rounded-full px-2 py-1">
              Δ {trend12d(seriesSignals)}
            </span>
          </header>
          <SignalsTimeline12d series={seriesSignals} />
        </article>
      </section>

      {/* ============ KPI cards — 4 facts (réduit vs 6) ============ */}
      <section
        aria-label="Key metrics"
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        <KpiCard
          label="Prospects"
          value={shortNumber(overview.prospects)}
          icon={<Users size={16} />}
          series={safeSeries(seriesProspects, overview.prospects)}
          fillId="spark-a-prospects"
          accent="text-emerald-500"
          trendChip={`${trend12d(seriesProspects)}`}
          href="/prospects"
        />
        <KpiCard
          label="Companies"
          value={shortNumber(overview.companies)}
          icon={<Building2 size={16} />}
          series={safeSeries(seriesCompanies, overview.companies)}
          fillId="spark-a-companies"
          accent="text-primary"
          trendChip={`${trend12d(seriesCompanies)}`}
          href="/companies"
        />
        <KpiCard
          label="Contacts"
          value={shortNumber(overview.contacts)}
          icon={<Contact size={16} />}
          hint="Liens humains rattachés"
          href="/contacts"
        />
        <KpiCard
          label="Campaigns"
          value={shortNumber(overview.campaigns)}
          icon={<Target size={16} />}
          hint="Séquences outbound actives"
          href="/campaigns"
        />
      </section>

      {/* ============ AI / Monitoring breakdown — single panel ============ */}
      <section>
        <EntityBreakdown
          title="Couverture CRM (entités + AI)"
          items={[
            { key: 'prospects', label: 'Prospects', value: overview.prospects, accent: '#06b6d4' },
            { key: 'companies', label: 'Companies', value: overview.companies, accent: '#22d3ee' },
            { key: 'contacts', label: 'Contacts', value: overview.contacts, accent: '#10b981' },
            { key: 'campaigns', label: 'Campaigns', value: overview.campaigns, accent: '#f59e0b' },
            { key: 'intelligence', label: 'Intelligence', value: overview.intelligence, accent: '#8b5cf6' },
            { key: 'ai_analyses', label: 'AI Analyses', value: overview.ai_analyses, accent: '#3b82f6' },
            { key: 'monitoring', label: 'Monitoring', value: overview.monitoring, accent: '#ef4444' },
            { key: 'signals', label: 'Signals', value: overview.signals, accent: '#06b6d4' },
          ]}
        />
      </section>

      {/* Footer informatif */}
      <footer className="text-center text-[10px] uppercase tracking-[0.3em] font-bold text-muted-foreground/60 pt-4">
        Données synchronisées depuis /api/analytics/overview · Refresh toutes les 30s
      </footer>
    </div>
  );
}

// =====================================================================
// CoverageTile — mini-pill component pour le Global score card
// =====================================================================

function CoverageTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: 'cyan' | 'primary' | 'amber';
}): React.ReactElement {
  const cls: Record<typeof accent, string> = {
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
    primary: 'bg-primary/10 text-primary border-primary/30',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  };
  return (
    <div className={cn('rounded-md border px-2 py-1.5', cls[accent])}>
      <div className="text-[9px] uppercase opacity-70 tracking-wider">{label}</div>
      <div className="text-base font-black tabular-nums">{value}</div>
    </div>
  );
}

// =====================================================================
// SignalsTimeline12d — bar chart SVG inline 12 bars
// =====================================================================

function SignalsTimeline12d({ series }: { series: number[] }): React.ReactElement {
  const padded = Array.from({ length: 12 }, (_, i) => series[i] ?? 0);
  const max = Math.max(1, ...padded);
  const peakIdx = padded.indexOf(max);

  return (
    <div>
      <div className="flex items-end gap-0.5 h-32">
        {padded.map((v, i) => {
          const h = (v / max) * 100;
          const isPeak = i === peakIdx && v > 0;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
              <div
                className={cn(
                  'w-full rounded-t-sm transition-all duration-700',
                  isPeak
                    ? 'bg-gradient-to-t from-lime-500 to-lime-400 shadow-[0_0_8px_rgba(148,255,1,0.4)]'
                    : 'bg-gradient-to-t from-lime-600/60 to-lime-500/80 hover:from-lime-500 hover:to-lime-400',
                )}
                style={{ height: `${h}%`, minHeight: v > 0 ? '4px' : '0' }}
                title={`J-${12 - 1 - i}: ${v} signal${v > 1 ? 's' : ''}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-2 text-[9px] uppercase font-black tracking-widest text-muted-foreground">
        <span>J-11</span>
        <span className="text-cyan-400">Peak {peakIdx >= 0 ? `J-${12 - 1 - peakIdx}` : '-'}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

// =====================================================================
// EntityBreakdown — barres horizontales
// =====================================================================

function EntityBreakdown({
  title,
  items,
}: {
  title: string;
  items: Array<{ key: string; label: string; value: number; accent: string }>;
}): React.ReactElement {
  const COLUMN_THRESHOLD = 4;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <article className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur-sm p-5">
      <header className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">
            {title}
          </div>
          <h2 className="text-base font-bold mt-0.5">
            <span className="tabular-nums">{items.reduce((s, i) => s + i.value, 0)}</span> entrées
          </h2>
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground bg-secondary/40 border border-border/40 rounded-full px-2 py-1">
          8 categories
        </span>
      </header>
      <ul
        className={cn(
          'grid gap-x-4 gap-y-2',
          items.length > COLUMN_THRESHOLD ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-1',
        )}
      >
        {items.map((it) => {
          const pctv = (it.value / max) * 100;
          return (
            <li key={it.key} className="text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-muted-foreground inline-flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: it.accent }}
                  />
                  {it.label}
                </span>
                <span className="font-black tabular-nums">{it.value}</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${pctv}%`,
                    backgroundColor: it.accent,
                    boxShadow: `0 0 6px ${it.accent}55`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
