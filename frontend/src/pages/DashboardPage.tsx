/**
 * DashboardPage — Intelligence Overview, real-data.
 *
 * Toutes les sections sont alimentées via React Query :
 *   - useProspectsQuery        → top hot prospects table + pipeline distribution
 *   - useCompaniesQuery        → hot companies count
 *   - useContactsQuery         → today actions count
 *   - useCampaignsQuery        → campaign indicators
 *   - useAnalyticsOverviewQuery→ KPI counts
 *   - useMonitoringQuery       → activity feed (signals) + signals 24h
 *
 * Plus de mocks hardcodés — chaque chiffre reflète la base SQLite
 * (via monolith Express sur :4000). États gérés : loading / error / empty.
 */
import React from 'react';
import {
  Users,
  Building2,
  Target,
  Activity,
  ArrowUpRight,
  Zap,
  ChevronRight,
  Phone,
  Mail,
  Sparkles,
  AlertTriangle,
  CircleSlash,
  RefreshCw,
  Palette,
  Compass,
  Clock,
  Rocket,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { cn, toDateMs, getTags, hasTag } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TierPill,
  ScoreCell,
  getTier,
  type Tier,
} from '@/components/LeadTier';
import { Sparkline } from '@/components/Sparkline';
import {
  useProspectsQuery,
  useCompaniesQuery,
  useMonitoringQuery,
  useCampaignsQuery,
  useAnalyticsOverviewQuery,
  useAnalyticsTimeseriesQuery,
} from '@/hooks/useBackendData';
import type { Prospect, Company, MonitoringSignal } from '@/types';

// =====================================================================
// Pipeline stage mapping (uses prospect.status field)
// =====================================================================

type StageId = 'discovery' | 'contacted' | 'qualified' | 'won' | 'lost';

interface StageMeta {
  id: StageId;
  label: string;
  accent: string;
  ring: string;
  dot: string;
  icon: React.ReactNode;
}

/** Mapping approximation prospect.status → pipeline stage (real data). */
function stageForStatus(status: string | undefined): StageId {
  switch ((status ?? 'new').toLowerCase()) {
    case 'qualified':
    case 'interested':
      return 'qualified';
    case 'contacted':
      return 'contacted';
    case 'converted':
      return 'won';
    case 'lost':
      return 'lost';
    case 'new':
    default:
      return 'discovery';
  }
}

const STAGE_META: Record<StageId, StageMeta> = {
  discovery: {
    id: 'discovery',
    label: 'Discovery',
    accent: 'text-primary/50',
    ring: 'border-primary/25',
    dot: 'bg-primary/40',
    icon: <CircleSlash size={14} />,
  },
  contacted: {
    id: 'contacted',
    label: 'Contacted',
    accent: 'text-primary',
    ring: 'border-primary/40',
    dot: 'bg-primary/60',
    icon: <Mail size={14} />,
  },
  qualified: {
    id: 'qualified',
    label: 'Qualified',
    accent: 'text-primary',
    ring: 'border-primary/50',
    dot: 'bg-primary',
    icon: <Target size={14} />,
  },
  won: {
    id: 'won',
    label: 'Won',
    accent: 'text-emerald-500',
    ring: 'border-emerald-500/50',
    dot: 'bg-emerald-500',
    icon: <TrophyIcon size={14} />,
  },
  lost: {
    id: 'lost',
    label: 'Lost',
    accent: 'text-red-400',
    ring: 'border-red-500/40',
    dot: 'bg-red-500',
    icon: <AlertTriangle size={14} />,
  },
};

function TrophyIcon(props: { size?: number; className?: string }) {
  return (
    <svg
      width={props.size ?? 16}
      height={props.size ?? 16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

// =====================================================================
// Sub-components
// =====================================================================

function Delta({
  value,
  trend,
}: {
  value: string;
  trend: 'up' | 'down' | 'flat';
}): React.ReactElement {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-bold tracking-wider',
        'px-2 py-0.5 rounded-full border',
        trend === 'up'
          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.08)]'
          : trend === 'down'
            ? 'bg-red-500/10 text-red-500 border-red-500/30'
            : 'bg-secondary text-muted-foreground border-border/40',
      )}
    >
      {value}
      <ArrowUpRight size={11} className={cn(trend === 'down' && 'rotate-90')} />
    </span>
  );
}

function KpiCard({
  title,
  value,
  delta,
  trend,
  icon: Icon,
  accent,
  hint,
  isLoading,
  series,
  sparkId,
  onClick,
}: {
  title: string;
  value: string;
  delta: string;
  trend: 'up' | 'down' | 'flat';
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent: string;
  hint?: string;
  isLoading?: boolean;
  /** 12-day sparkline series. Si vide → le graphique n'est pas rendu. */
  series?: number[];
  /** Id unique pour le gradient SVG (sinon collision entre cartes). */
  sparkId?: string;
  /** Round 117 — navigation au clic (tuile → page métier). */
  onClick?: () => void;
}): React.ReactElement {
  return (
    <Card
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        'bg-card/50 border-border hover:border-primary/40 transition-colors group relative overflow-hidden rounded-2xl',
        onClick && 'cursor-pointer',
      )}
    >
      <CardContent className="p-3.5 pb-2 sm:p-5 sm:pb-2">
        <div className="flex items-start justify-between mb-2.5 sm:mb-3">
          <div
            className={cn(
              'p-2 rounded-xl bg-primary/10 text-primary',
              'group-hover:scale-110 transition-transform duration-300',
            )}
          >
            <Icon size={18} />
          </div>
          <Delta value={delta} trend={trend} />
        </div>
        <div className="space-y-0.5">
          <p className="text-[10px] sm:text-[11px] uppercase tracking-widest font-bold text-muted-foreground">
            {title}
          </p>
          <p className={cn('text-2xl sm:text-3xl font-black tabular-nums tracking-tight', accent, isLoading && 'opacity-50')}>
            {isLoading ? '…' : value}
          </p>
          {hint && <p className="text-[10px] sm:text-[11px] text-muted-foreground mt-1 truncate">{hint}</p>}
        </div>
      </CardContent>
      {series && series.length > 1 && (
        <div className="hidden sm:block px-3 pb-2 -mt-1">
          <Sparkline series={series} accent={accent} fillId={sparkId} className="h-10" />
        </div>
      )}
    </Card>
  );
}

function EmptyState({
  emoji = '∅',
  title,
  body,
  cta,
}: {
  emoji?: React.ReactNode;
  title: string;
  body: string;
  cta?: React.ReactElement;
}): React.ReactElement {
  return (
    <div className="px-5 py-10 text-center">
      <div className="inline-flex items-center justify-center h-10 w-10 rounded-full bg-secondary text-muted-foreground mb-3">
        {emoji}
      </div>
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">{body}</p>
      {cta && <div className="mt-3">{cta}</div>}
    </div>
  );
}

/**
 * Round 23 — ErrorPanel context-aware.
 * Distingue "Backend injoignable" (réseau/serveur KO) des erreurs « récupérables »
 * (rate-limit, 5xx transitoire) afin de ne pas faire paniquer l'utilisateur
 * quand le backend est simplement ralenti ou sur un hoquet réseau CloudShell.
 */
function ErrorPanel({ message, code }: { message: string; code?: string }): React.ReactElement {
  const isRate = code === 'RATE_LIMITED' || /429|trop de requ/i.test(message);
  const isServer = !isRate && (/5\d\d|server error|internal/i.test(message));
  const isTimeout = /timeout|délai/i.test(message);

  const title = isRate
    ? 'Trop de requêtes — slow down'
    : isServer
      ? 'Backend error (5xx)'
      : isTimeout
        ? 'Backend timeout'
        : 'Backend injoignable / unreachable';

  const hint = isRate
    ? 'Le backend a reçu trop de requêtes (rate limit 5000/15min côté dev). Patiente ~1 min puis rafraîchis.'
    : isServer
      ? 'Le serveur a planté sur cette route — les autres pages fonctionnent probablement.'
      : isTimeout
        ? 'La requête a dépassé le délai (idle proxy CloudShell ?). Refresh dans quelques secondes.'
        : 'Le backend (port 4000) ne répond pas. Vérifie que le service tourne (bash /tmp/zh_restart_svc.sh) puis Ctrl+Shift+R.';

  const tint = isRate || isTimeout ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
    : isServer ? 'border-orange-500/30 bg-orange-500/10 text-orange-400'
      : 'border-red-500/30 bg-red-500/10 text-red-500';

  return (
    <div className="px-5 py-6 text-sm">
      <div className={cn('rounded-xl border p-4', tint)}>
        <div className="flex items-center gap-2 mb-1.5">
          <AlertTriangle size={14} />
          <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
        </div>
        <p className="text-[12px] opacity-90 mb-1.5">{hint}</p>
        <p className="font-mono text-[11px] opacity-70 break-all">
          {code && <span className="opacity-80">[{code}] </span>}{message}
        </p>
      </div>
    </div>
  );
}

// =====================================================================
// Page
// =====================================================================

/**
 * Hook 5-second tick — refresh la carte « Dernière prospection » pendant
 * que la session est ouverte (lit localStorage sans refetch réseau).
 * Défini au TOP LEVEL (pas dans le composant) pour respecter les règles
 * des hooks : un hook ne doit jamais être appelé dans un useMemo/deps.
 */
function useTickEvery5s(): number {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 5_000);
    return () => window.clearInterval(id);
  }, []);
  return tick;
}

// =====================================================================
// Round 67 — Preset Global Prospecting (partagé Dashboard ↔ AI Center)
// =====================================================================

interface GlobalProspectingPreset {
  sector: string;
  region: string;
  target_count: number;
  context?: string;
  auto_analyze?: boolean;
  auto_analyze_threshold?: number;
  /** Round 67 — champs dérivés (remplis à l'éxécution pour le dashboard). */
  duration_ms?: number;
  persist?: boolean;
  triggered_from?: string;
  created_at?: number;
  /** Compteurs populés après exécution (par ProspectingTab). */
  result_companies?: number;
  result_persisted?: number;
  result_auto_analyzed?: number;
  status?: 'idle' | 'running' | 'done' | 'failed';
}

export function DashboardPage(): React.ReactElement {
  const navigate = useNavigate();
  // ----- Queries React Query -----
  const prospectsQ = useProspectsQuery();
  const companiesQ = useCompaniesQuery();
  const monitoringQ = useMonitoringQuery();
  const campaignsQ = useCampaignsQuery();
  const overviewQ = useAnalyticsOverviewQuery();

  // Round 22 — timeseries réels (12 derniers jours) pour les sparklines.
  const tsHotProspects = useAnalyticsTimeseriesQuery('hot_prospects');
  const tsHotCompanies = useAnalyticsTimeseriesQuery('hot_companies');
  const tsSignals = useAnalyticsTimeseriesQuery('signals');
  const tsWon = useAnalyticsTimeseriesQuery('won');

  // ----- Derived data -----
  const prospects: Prospect[] = Array.isArray(prospectsQ.data) ? prospectsQ.data : [];
  const companies: Company[] = Array.isArray(companiesQ.data) ? companiesQ.data : [];
  const signals: MonitoringSignal[] = Array.isArray(monitoringQ.data) ? monitoringQ.data : [];
  const campaignsList: any[] = Array.isArray(campaignsQ.data) ? campaignsQ.data : [];
  const overview = overviewQ.data;

  // Round 50 — split companies by 'design' tag for the 2 dashboard pipelines.
  // Une Company reçoit le tag 'design' automatiquement quand son website
  // est audité (via /api/design-audit/run). Voir design-audit.service.tagMatchingCompany.
  // useMemo : évite de re-filtrer/re-trier à chaque render (règle lint perf).
  const designCompanies = React.useMemo(
    () => companies.filter((c) => hasTag(c.tags, 'design')),
    [companies],
  );
  const otherCompanies = React.useMemo(
    () => companies.filter((c) => !hasTag(c.tags, 'design')),
    [companies],
  );
  const TOP_DESIGN = React.useMemo(
    () => [...designCompanies].filter(c => c && typeof c === 'object').sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8),
    [designCompanies],
  );
  const TOP_OTHER = React.useMemo(
    () => [...otherCompanies].filter(c => c && typeof c === 'object').sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8),
    [otherCompanies],
  );

  const isFirstLoad =
    prospectsQ.isLoading &&
    companiesQ.isLoading &&
    monitoringQ.isLoading &&
    overviewQ.isLoading;

  // Round 29 — ne pas bloquer tout le dashboard sur UN seul fetch échoué.
  // On distingue « vraiment cassé » (0 data, N errors) de « partiellement
  // stale » (data OK, 1 refetch échoué). Le ErrorPanel ne s'affiche QUE
  // dans le 1er cas. Sinon, une petite bannière inline + bouton Refresh.
  const firstErrObj = prospectsQ.error ?? companiesQ.error ?? monitoringQ.error ?? overviewQ.error;
  const anyDataLoaded = !!(prospectsQ.data ?? []).length ||
    !!(companiesQ.data ?? []).length ||
    !!(monitoringQ.data ?? []).length ||
    overviewQ.data !== undefined;
  const isFullyDown = !anyDataLoaded && firstErrObj !== null && firstErrObj !== undefined;
  const isPartiallyStale = anyDataLoaded && firstErrObj !== null && firstErrObj !== undefined;
  const firstError = isFullyDown || isPartiallyStale ? firstErrObj?.message : undefined;
  const firstErrorCode = isFullyDown || isPartiallyStale
    ? (firstErrObj as { code?: string } | undefined)?.code
    : undefined;

  const handleRefresh = (): void => {
    void prospectsQ.refetch();
    void companiesQ.refetch();
    void monitoringQ.refetch();
    void overviewQ.refetch();
  };

  // Round 67 — bouton « Run Global Analysis » : persiste un preset
  // prospection dans localStorage et navigue vers AI Center → Strategic
  // Prospecting avec ?autoRun=1. Le ProspectingTab détecte le flag et
  // déclenche Run automatiquement.
  const handleRunGlobalAnalysis = (): void => {
    const preset: GlobalProspectingPreset = {
      sector: 'SaaS B2B',
      region: 'France',
      target_count: 30,
      context:
        "Entreprises françaises 30-200 salariés B2B SaaS qui recrutent un Head of Sales — cibles du Strategic Prospecting Engine Zentara.",
      auto_analyze: true,
      auto_analyze_threshold: 70,
      duration_ms: 0,
      persist: true,
      triggered_from: 'dashboard-run-global-analysis',
      created_at: Date.now(),
    };
    try {
      window.localStorage.setItem('zentara.prospection.preset', JSON.stringify(preset));
    } catch {
      // ignore quota errors
    }
    navigate('/intelligence?tab=prospecting&autoRun=1');
  };

  // Round 67 — lit la dernière prospection persistée par ProspectingTab
  // pour afficher ses paramètres + résultats dans une KPI card dédiée.
  // `tick` (5s) force la relecture du localStorage sans refetch réseau.
  const tick = useTickEvery5s();
  const lastProspection = React.useMemo<GlobalProspectingPreset | null>(() => {
    try {
      const raw = window.localStorage.getItem('zentara.prospection.last_result');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as GlobalProspectingPreset;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }, [tick]);

  // ----- Hot prospects (top 5 by score desc, then by created_at desc tiebreak) -----
  const TOP_HOT = (Array.isArray(prospects) ? [...prospects] : [])
    .filter((p) => p && typeof p === 'object')
    .sort((a, b) => {
      const ds = (b.score ?? 0) - (a.score ?? 0);
      if (ds !== 0) return ds;
      return toDateMs(b.created_at) - toDateMs(a.created_at);
    })
    .slice(0, 5);

  // ----- KPI counts -----
  const hotProspects = prospects.filter((p) => getTier(p.score) === 'hot').length;
  const hotCompanies = companies.filter((c) => getTier(c.score) === 'hot').length;
  const won = prospects.filter((p) => (p.status ?? '').toLowerCase() === 'converted').length;
  const todayActions = signals.length; // proxy: tout signal détecté = action require follow-up

  // ----- Pipeline distribution grouped by stage -----
  const pipelineCounts: Record<StageId, Array<Prospect>> = {
    discovery: [],
    contacted: [],
    qualified: [],
    won: [],
    lost: [],
  };
  for (const p of prospects) {
    pipelineCounts[stageForStatus(p.status)].push(p);
  }

  // ----- Activity feed (combine monitoring signals + recent prospects) -----
  interface ActivityItem {
    id: string;
    kind: 'signal' | 'prospect';
    title: string;
    meta: string;
    ago?: string;
    createdAt: string;
  }
  const activityItems: ActivityItem[] = [
    ...(Array.isArray(signals) ? signals.map<ActivityItem>((s) => ({
      id: `sig-${s.id}`,
      kind: 'signal',
      title: `${s.entity_name} · ${s.type}`,
      meta: s.content,
      createdAt: s.detected_at ?? '',
    })) : []),
    ...(Array.isArray(prospects) ? prospects.map<ActivityItem>((p) => ({
      id: `pros-${p.id}`,
      kind: 'prospect',
      title: `${p.first_name} ${p.last_name} added`,
      meta:
        [p.sector, p.city].filter(Boolean).join(' · ') ||
        p.email ||
        'New prospect.',
      createdAt: p.created_at ?? '',
    })) : []),
  ]
    .sort((a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt))
    .slice(0, 8);

  function fmtAgo(iso: string | number): string {
    if (iso === null || iso === undefined || iso === '') return '';
    const t = toDateMs(iso);
    if (Number.isNaN(t)) return String(iso);
    const dSec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (dSec < 60) return `${dSec}s ago`;
    const dMin = Math.round(dSec / 60);
    if (dMin < 60) return `${dMin}m ago`;
    const dH = Math.round(dMin / 60);
    if (dH < 24) return `${dH}h ago`;
    return `${Math.round(dH / 24)}d ago`;
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Z-AI Center
            </span>
            <span className="text-[10px] text-muted-foreground/60">·</span>
            <span className="text-[10px] font-bold text-muted-foreground inline-flex items-center gap-1.5">
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full animate-pulse',
                  isFullyDown
                    ? 'bg-red-500'
                    : isPartiallyStale
                      ? 'bg-amber-500'
                      : 'bg-emerald-500',
                )}
              />
              {isFullyDown
                ? 'Backend degraded'
                : isPartiallyStale
                  ? 'Some data stale · refresh'
                  : isFirstLoad
                    ? 'Loading…'
                    : 'Live data · React Query'}
            </span>
          </div>
          <h2 className="text-3xl font-black tracking-tight">Intelligence Overview</h2>
          <p className="text-muted-foreground">
            Strategic dashboard powered by backend SQLite + AI synthesis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-border/60"
            onClick={handleRefresh}
            disabled={isFirstLoad}
            aria-label="Refresh dashboard"
            title="Refresh"
          >
            <RefreshCw size={14} className={cn('mr-2', isFirstLoad && 'animate-spin')} /> Refresh
          </Button>
          <Button
            size="sm"
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={handleRunGlobalAnalysis}
            aria-label="Run Global Analysis"
            title="Lance une recherche d'entreprises stratégiques via le Strategic Prospecting Engine (7-engines + Outreach)."
          >
            <Zap className="mr-2 h-4 w-4" /> Run Global Analysis
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-primary/40"
            onClick={() => navigate('/leadflow')}
            aria-label="Leadflow"
            title="Flux Leadify : Maps → enrichissement → campagne → envoi → suivi"
          >
            <Rocket className="mr-2 h-4 w-4" /> Leadflow
          </Button>
        </div>
      </div>

      {isFullyDown && (
        <ErrorPanel message={firstError ?? 'Backend injoignable'} code={firstErrorCode} />
      )}
      {isPartiallyStale && (
        <div className="px-1 -mt-2">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 px-3 py-2 text-xs flex items-center gap-2">
            <AlertTriangle size={12} />
            <span>
              Une métrique n'a pas pu être rafraîchie ({firstErrorCode ?? 'RÉSEAU'}) — dashboard
              continue avec les données en cache.
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              className="ml-auto text-[10px] uppercase tracking-widest font-bold hover:underline"
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* ===== 1. KPI Cards ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <KpiCard
          title="Hot prospects"
          value={String(hotProspects)}
          delta={hotProspects > 0 ? `+${hotProspects}` : '—'}
          trend={hotProspects > 0 ? 'up' : 'flat'}
          icon={Users}
          accent="text-primary"
          hint={`Score ≥ 75 · ${prospects.length} total`}
          isLoading={prospectsQ.isLoading}
          series={tsHotProspects.data ?? []}
          sparkId="spark-hot-prospects"
          onClick={() => navigate('/prospects')}
        />
        <KpiCard
          title="Hot companies"
          value={String(hotCompanies)}
          delta={hotCompanies > 0 ? `+${hotCompanies}` : '—'}
          trend={hotCompanies > 0 ? 'up' : 'flat'}
          icon={Building2}
          accent="text-primary"
          hint={`Score ≥ 75 · ${companies.length} total`}
          isLoading={companiesQ.isLoading}
          series={tsHotCompanies.data ?? []}
          sparkId="spark-hot-companies"
          onClick={() => navigate('/companies')}
        />
        <KpiCard
          title="Campaigns"
          value={String(campaignsList.length || overview?.campaigns || 0)}
          delta={(campaignsList.length > 0 || (overview?.campaigns ?? 0) > 0) ? `+${campaignsList.length || overview?.campaigns || 0}` : '—'}
          trend={(campaignsList.length > 0 || (overview?.campaigns ?? 0) > 0) ? 'up' : 'flat'}
          icon={Target}
          accent="text-primary"
          hint={`${campaignsList.filter((c: any) => c.status === 'active').length} actives`}
          isLoading={campaignsQ.isLoading && overviewQ.isLoading}
          onClick={() => navigate('/campaigns')}
        />
        <KpiCard
          title="Today's signals"
          value={String(signals.length)}
          delta={signals.length > 0 ? `+${signals.length}` : '—'}
          trend={signals.length > 0 ? 'up' : 'flat'}
          icon={Activity}
          accent="text-primary"
          hint="Live monitoring"
          isLoading={monitoringQ.isLoading}
          series={tsSignals.data ?? []}
          sparkId="spark-signals"
          onClick={() => navigate('/monitoring')}
        />
        <KpiCard
          title="Pipeline won"
          value={String(won)}
          delta={won > 0 ? `+${won}` : '—'}
          trend="flat"
          icon={TrophyIcon}
          accent="text-primary"
          hint={`status='converted' · ${overview?.prospects ?? prospects.length} prospects`}
          isLoading={overviewQ.isLoading && prospectsQ.isLoading}
          series={tsWon.data ?? []}
          sparkId="spark-won"
        />
      </div>

      {/* ===== Round 67 — Last Global Prospecting run =====
          Affiche les paramètres de la dernière recherche lancée depuis
          le bouton « Run Global Analysis » + les KPIs du résultat.
          Permet de voir en un coup d'œil ce qui a été cherché. */}
      <LastProspectionCard preset={lastProspection} />

      {/* ===== 2. Top hot prospects table + Pipeline distribution ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Hot prospects table */}
        <Card className="lg:col-span-3 bg-card/40 border-border/60 overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded-lg bg-emerald-500/15 text-emerald-500 inline-flex items-center justify-center">
                  <Users size={14} />
                </span>
                <div>
                  <CardTitle className="text-sm font-black tracking-tight">
                    Top hot prospects
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Top 5 by intelligence score · live from backend
                  </p>
                </div>
              </div>
              <Link
                to="/prospects"
                className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:underline"
              >
                View all <ChevronRight size={12} />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {prospectsQ.isLoading && !prospectsQ.data ? (
              <EmptyState title="Loading prospects…" body="Fetching from /api/prospects." />
            ) : prospectsQ.error ? (
              <EmptyState
                emoji={<AlertTriangle size={16} />}
                title="Failed to load prospects"
                body={prospectsQ.error.message}
              />
            ) : TOP_HOT.length === 0 ? (
              <EmptyState
                title="No prospects yet"
                body="Add your first prospect from the Prospects page to see them ranked here."
                cta={
                  <Button asChild size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
                    <Link to="/prospects">Add a prospect</Link>
                  </Button>
                }
              />
            ) : (
              <>
                <ul className="md:hidden divide-y divide-border/40">
                  {TOP_HOT.map((p) => {
                    const t: Tier = getTier(p.score);
                    const initials = `${typeof p.first_name === 'string' ? p.first_name[0] : '?'}${typeof p.last_name === 'string' ? p.last_name[0] : ''}`;
                    return (
                      <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                        <div
                          className={cn(
                            'w-10 h-10 rounded-full flex items-center justify-center text-xs font-black shrink-0',
                            t === 'hot'
                              ? 'bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30'
                              : t === 'warm'
                                ? 'bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30'
                                : 'bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/30',
                          )}
                        >
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-bold truncate text-sm">
                            {p.first_name} {p.last_name}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {[p.sector, p.email].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <TierPill tier={t} />
                          <ScoreCell score={p.score ?? 0} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <table className="w-full text-sm text-left hidden md:table">
                <thead className="bg-secondary/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-bold">Prospect</th>
                    <th className="px-4 py-3 font-bold hidden md:table-cell">Sector · Email</th>
                    <th className="px-4 py-3 font-bold">Score</th>
                    <th className="px-4 py-3 font-bold">Tier</th>
                    <th className="px-4 py-3 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {TOP_HOT.map((p) => {
                    const t: Tier = getTier(p.score);
                    const initials = `${typeof p.first_name === 'string' ? p.first_name[0] : '?'}${typeof p.last_name === 'string' ? p.last_name[0] : ''}`;
                    return (
                      <tr
                        key={p.id}
                        className="border-t border-border/40 hover:bg-secondary/20 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={cn(
                                'w-9 h-9 rounded-full flex items-center justify-center text-xs font-black',
                                t === 'hot'
                                  ? 'bg-emerald-500/15 text-emerald-500 ring-1 ring-emerald-500/30'
                                  : t === 'warm'
                                    ? 'bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/30'
                                    : 'bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/30',
                              )}
                            >
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <div className="font-bold truncate">
                                {p.first_name} {p.last_name}
                              </div>
                              <div className="text-[11px] text-muted-foreground capitalize">{p.status ?? 'new'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="text-xs font-medium truncate">{p.sector ?? '—'}</div>
                          <div className="text-[11px] text-muted-foreground truncate">{p.email ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3">
                          <ScoreCell score={p.score ?? 0} />
                        </td>
                        <td className="px-4 py-3">
                          <TierPill tier={t} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {p.email && (
                              <a
                                href={`mailto:${p.email}`}
                                aria-label={`Email ${p.first_name}`}
                                title={`Email ${p.first_name}`}
                                className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors"
                              >
                                <Mail size={13} />
                              </a>
                            )}
                            {p.phone && (
                              <a
                                href={`tel:${p.phone}`}
                                aria-label={`Call ${p.first_name}`}
                                title={`Call ${p.first_name}`}
                                className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors"
                              >
                                <Phone size={13} />
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </>
            )}
          </CardContent>
        </Card>

        {/* Pipeline distribution (2/5 width) */}
        <Card className="lg:col-span-2 bg-card/40 border-border/60 overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded-lg bg-primary/15 text-primary inline-flex items-center justify-center">
                  <Target size={14} />
                </span>
                <div>
                  <CardTitle className="text-sm font-black tracking-tight">
                    Pipeline distribution
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Live · grouped by prospect status
                  </p>
                </div>
              </div>
              <Link
                to="/campaigns"
                className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:underline"
              >
                Open <ChevronRight size={12} />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border/40">
              {(Object.keys(STAGE_META) as StageId[]).map((id) => {
                const meta = STAGE_META[id];
                const items = pipelineCounts[id];
                const total = Math.max(1, prospects.length);
                return (
                  <div
                    key={id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/10 transition-colors"
                  >
                    <span
                      className={cn(
                        'h-7 w-7 rounded-lg border bg-card/60 flex items-center justify-center shrink-0',
                        meta.ring,
                      )}
                    >
                      <span className={meta.accent}>{meta.icon}</span>
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold">{meta.label}</span>
                        <span className="text-xs font-bold tabular-nums">{items.length}</span>
                      </div>
                      <div className="mt-1 h-1 rounded-full bg-secondary/40 overflow-hidden">
                        <div
                          className={cn('h-full rounded-full', meta.dot)}
                          style={{ width: `${Math.max(6, (items.length / total) * 100)}%` }}
                        />
                      </div>
                      {items.length > 0 && (
                        <div className="mt-1.5 text-[11px] text-muted-foreground truncate">
                          {items
                            .slice(0, 2)
                            .map((p) => `${p.first_name} ${p.last_name}`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ===== 3. Activity feed ===== */}
      <Card className="bg-card/40 border-border/60 overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-7 w-7 rounded-lg bg-primary/15 text-primary inline-flex items-center justify-center">
                <Sparkles size={14} />
              </span>
              <div>
                <CardTitle className="text-sm font-black tracking-tight">Activity feed</CardTitle>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Monitoring signals + recent prospects · sorted by time
                </p>
              </div>
            </div>
            <Link
              to="/monitoring"
              className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:underline"
            >
              View monitoring <ChevronRight size={12} />
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {monitoringQ.isLoading && prospectsQ.isLoading ? (
            <EmptyState title="Loading activity…" body="Fetching signals + recent prospects." />
          ) : activityItems.length === 0 ? (
            <EmptyState
              emoji={<Activity size={16} />}
              title="Quiet for now"
              body="No recent signals or prospect additions. Add a prospect or trigger a monitoring scan to populate this feed."
            />
          ) : (
            <ul className="divide-y divide-border/40">
              {activityItems.map((entry) => {
                const isSignal = entry.kind === 'signal';
                const Icon = isSignal ? Activity : Users;
                const tint = 'bg-primary/15 text-primary ring-primary/30';
                return (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 px-5 py-4 hover:bg-secondary/10 transition-colors group"
                  >
                    <span
                      className={cn(
                        'inline-flex items-center justify-center h-8 w-8 rounded-xl ring-1',
                        tint,
                      )}
                    >
                      <Icon size={14} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold leading-snug">{entry.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                        {entry.meta}
                      </p>
                    </div>
                    <span className="text-[11px] uppercase tracking-widest font-bold text-muted-foreground/70 whitespace-nowrap">
                      {fmtAgo(entry.createdAt)}
                    </span>
                    <ChevronRight
                      size={14}
                      className="text-muted-foreground/40 group-hover:text-primary transition-colors mt-1"
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ===== 4. Round 50 — Design Pipeline vs Sales Pipeline =====
          Deux sections côte-à-côte :
          - Design Pipeline  → companies tagged 'design' (clients potentiels
            ou actifs du Site Design Audit). Score agrégé, secteur, email.
          - Sales Pipeline   → tous les autres companies / prospects (outreach
            classique Zentara).
          Si l'utilisateur a tagué une company "design" via un audit, elle
          bascule automatiquement de Sales → Design au prochain refresh.
      */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Design Pipeline */}
        <Card className="bg-card/40 border-pink-500/30 overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded-lg bg-pink-500/15 text-pink-400 inline-flex items-center justify-center">
                  <Palette size={14} />
                </span>
                <div>
                  <CardTitle className="text-sm font-black tracking-tight flex items-center gap-2">
                    Design Pipeline
                    <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full bg-pink-500/15 text-pink-400 border border-pink-500/30">
                      {designCompanies.length} tagged
                    </span>
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Companies tagged <code className="text-pink-300">design</code> · Site Design Audit
                    clients · auto-tagged via <code>/api/design-audit/run</code>
                  </p>
                </div>
              </div>
              <Link
                to="/design-audit"
                className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-pink-400 hover:underline"
              >
                View audits <ChevronRight size={12} />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {designCompanies.length === 0 ? (
              <EmptyState
                emoji={<Palette size={16} />}
                title="No design pipeline yet"
                body="Lance un Site Design Audit depuis /design-audit → toute company dont le website matche recevra automatiquement le tag 'design'."
                cta={
                  <Button asChild size="sm" className="bg-pink-500 hover:bg-pink-600 text-white">
                    <Link to="/design-audit">Lancer un audit</Link>
                  </Button>
                }
              />
            ) : (
              <>
                <ul className="md:hidden divide-y divide-border/40">
                  {TOP_DESIGN.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-black shrink-0 bg-pink-500/15 text-pink-300 ring-1 ring-pink-500/30">
                        <Palette size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/companies/${encodeURIComponent(c.id)}`}
                          className="font-bold truncate text-sm hover:underline hover:text-pink-300"
                        >
                          {c.name}
                        </Link>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {c.sector ?? c.industry ?? '—'}
                        </div>
                      </div>
                      <ScoreCell score={c.score ?? 0} />
                    </li>
                  ))}
                </ul>
                <table className="w-full text-sm text-left hidden md:table">
                <thead className="bg-secondary/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-bold">Company</th>
                    <th className="px-4 py-3 font-bold hidden md:table-cell">Sector · Site</th>
                    <th className="px-4 py-3 font-bold">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {TOP_DESIGN.map((c) => (
                    <tr
                      key={c.id}
                      className="border-t border-border/40 hover:bg-pink-500/5 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black bg-pink-500/15 text-pink-300 ring-1 ring-pink-500/30">
                            <Palette size={14} />
                          </div>
                          <div className="min-w-0">
                            <Link
                              to={`/companies/${encodeURIComponent(c.id)}`}
                              className="font-bold truncate hover:underline hover:text-pink-300"
                            >
                              {c.name}
                            </Link>
                            <div className="text-[11px] text-pink-400/80 uppercase tracking-widest font-bold">
                              Design audit client
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-xs font-medium truncate">{c.sector ?? c.industry ?? '—'}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {c.website ? (
                            <a
                              href={c.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {c.website.replace(/^https?:\/\//, '')}
                            </a>
                          ) : (
                            '—'
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ScoreCell score={c.score ?? 0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sales Pipeline */}
        <Card className="bg-card/40 border-border/60 overflow-hidden">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-7 w-7 rounded-lg bg-primary/15 text-primary inline-flex items-center justify-center">
                  <Target size={14} />
                </span>
                <div>
                  <CardTitle className="text-sm font-black tracking-tight flex items-center gap-2">
                    Sales Pipeline
                    <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80 border border-primary/30">
                      {otherCompanies.length} others
                    </span>
                  </CardTitle>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Companies <em>sans</em> le tag design · outreach Zentara traditionnel · hot leads à
                    convertir
                  </p>
                </div>
              </div>
              <Link
                to="/companies"
                className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-primary hover:underline"
              >
                View companies <ChevronRight size={12} />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {otherCompanies.length === 0 ? (
              <EmptyState
                emoji={<Users size={16} />}
                title="Zentara · pure design mode"
                body="Toutes tes companies sont taguées 'design'. La Sales Pipeline est vide — bascule en haut avec un nouveau tag pour les activités commerciales classiques."
              />
            ) : (
              <>
                <ul className="md:hidden divide-y divide-border/40">
                  {TOP_OTHER.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-black shrink-0 bg-primary/10 text-primary ring-1 ring-primary/30">
                        <Building2 size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link
                          to={`/companies/${encodeURIComponent(c.id)}`}
                          className="font-bold truncate text-sm hover:underline hover:text-primary"
                        >
                          {c.name}
                        </Link>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {c.sector ?? c.industry ?? '—'}
                        </div>
                      </div>
                      <ScoreCell score={c.score ?? 0} />
                    </li>
                  ))}
                </ul>
                <table className="w-full text-sm text-left hidden md:table">
                <thead className="bg-secondary/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-bold">Company</th>
                    <th className="px-4 py-3 font-bold hidden md:table-cell">Sector · Status</th>
                    <th className="px-4 py-3 font-bold">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {TOP_OTHER.map((c) => (
                    <tr
                      key={c.id}
                      className="border-t border-border/40 hover:bg-primary/5 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black bg-primary/10 text-primary ring-1 ring-primary/30">
                            <Building2 size={14} />
                          </div>
                          <div className="min-w-0">
                            <Link
                              to={`/companies/${encodeURIComponent(c.id)}`}
                              className="font-bold truncate hover:underline hover:text-primary"
                            >
                              {c.name}
                            </Link>
                            <div className="text-[11px] text-muted-foreground uppercase tracking-widest">
                              {c.status ?? 'new'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-xs font-medium truncate">{c.sector ?? c.industry ?? '—'}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{c.city ?? c.country ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3">
                        <ScoreCell score={c.score ?? 0} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// =====================================================================
// Round 67 — Carte « Last Global Prospecting »
//
// Affiche en un coup d'œil les paramètres de la dernière recherche
// stratégique + les KPIs du résultat. Sources : localStorage
// (zentara.prospection.last_result écrit par ProspectingTab).
// =====================================================================

function LastProspectionCard({ preset }: { preset: GlobalProspectingPreset | null }): React.ReactElement {
  const navigate = useNavigate();
  if (!preset) {
    return (
      <Card className="bg-gradient-to-br from-primary/5 via-card/40 to-card border-primary/30 hover:border-primary/50 transition-colors">
        <CardContent className="p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
            <Compass size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-black tracking-tight">Aucune recherche lancée pour l'instant</div>
            <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
              Clique « Run Global Analysis » pour lancer une prospection stratégique via Zentara — les paramètres
              et les résultats apparaîtront ici.
            </div>
          </div>
          <Compass size={18} className="text-muted-foreground opacity-40 shrink-0" />
        </CardContent>
      </Card>
    );
  }
  const status = preset.status ?? 'done';
  const isRunning = status === 'running';
  const durationSec = preset.duration_ms ? (preset.duration_ms / 1000).toFixed(1) : '—';
  const createdAt = preset.created_at ? new Date(preset.created_at).toLocaleString('fr-FR') : '—';
  return (
    <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card/60 to-card p-5">
      <div className="flex items-start gap-4">
        <div className={cn(
          'w-12 h-12 rounded-xl flex items-center justify-center shrink-0',
          isRunning ? 'bg-amber-500/15 text-amber-500 animate-pulse' : 'bg-primary/15 text-primary',
        )}>
          <Compass size={22} />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="text-sm font-black tracking-tight">
              {isRunning ? 'Recherche en cours…' : 'Dernière prospection stratégique'}
            </div>
            <span className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border',
              isRunning
                ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
                : status === 'failed'
                  ? 'bg-red-500/15 text-red-500 border-red-500/30'
                  : 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
            )}>
              {status === 'running' ? 'running' : status === 'failed' ? 'failed' : 'done'}
            </span>
            <span className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
              <Clock size={11} /> {createdAt}
            </span>
          </div>
          {/* Search params grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <LastProspectionPill label="Niche" value={preset.sector} icon={<Target size={11} />} highlight />
            <LastProspectionPill label="Région" value={preset.region} icon={<Compass size={11} />} />
            <LastProspectionPill label="Quantité" value={String(preset.target_count)} icon={<Users size={11} />} />
            <LastProspectionPill
              label="Seuil auto-analyse"
              value={preset.auto_analyze ? `≥ ${preset.auto_analyze_threshold ?? '—'}` : 'off'}
              icon={<Zap size={11} />}
              accent={preset.auto_analyze ? 'text-emerald-400' : 'text-muted-foreground'}
            />
          </div>
          {preset.context && (
            <div className="text-[11px] text-muted-foreground italic leading-snug line-clamp-2">
              « {preset.context} »
            </div>
          )}
          {/* KPIs result */}
          {(preset.result_companies != null || durationSec !== '—') && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
              <ResultStat label="Companies" value={preset.result_companies ?? '—'} accent="text-primary" />
              <ResultStat label="Persistées" value={preset.result_persisted ?? '—'} accent="text-emerald-400" />
              <ResultStat label="Auto-analysées" value={preset.result_auto_analyzed ?? '—'} accent="text-amber-400" />
              <ResultStat label="Durée" value={`${durationSec}s`} accent="text-cyan-400" />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              window.localStorage.setItem('zentara.prospection.preset', JSON.stringify({
                ...preset,
                triggered_from: 'dashboard-last-card',
              }));
            } catch { /* noop */ }
            navigate('/intelligence?tab=prospecting&autoRun=1');
          }}
          className="shrink-0 h-9 px-3 rounded-xl border border-primary/40 bg-primary/10 hover:bg-primary/20 text-primary text-xs font-black uppercase tracking-widest inline-flex items-center gap-1.5 transition-colors active:scale-95"
        >
          <Zap size={13} />
          Relancer
        </button>
      </div>
    </div>
  );
}

function LastProspectionPill({ label, value, icon, highlight, accent }: {
  label: string;
  value: string;
  icon: React.ReactNode;
  highlight?: boolean;
  accent?: string;
}): React.ReactElement {
  return (
    <div className={cn(
      'flex items-center gap-2 px-3 py-2 rounded-xl border',
      highlight
        ? 'bg-primary/10 border-primary/40'
        : 'bg-secondary/30 border-border/40',
    )}>
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <div className="flex flex-col min-w-0">
        <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className={cn('text-xs font-bold truncate', accent ?? 'text-foreground')}>{value}</span>
      </div>
    </div>
  );
}

function ResultStat({ label, value, accent }: {
  label: string;
  value: number | string;
  accent: string;
}): React.ReactElement {
  return (
    <div className="rounded-lg bg-secondary/20 px-2.5 py-1.5 border border-border/30">
      <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn('text-base font-black font-mono leading-tight', accent)}>{value}</div>
    </div>
  );
}
