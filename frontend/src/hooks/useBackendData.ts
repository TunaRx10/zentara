/**
 * Hooks React Query (`@tanstack/react-query`) vers le backend Zentara.
 *
 * Chaque hook wrappe un endpoint et expose la même forme standard :
 *   `{data, isLoading, isError, error, refetch}`
 *
 * La clé `queryKey` est typée pour invalidation ciblée (`queryClient.invalidateQueries({queryKey: ...})`).
 *
 * Conventions :
 *   - `staleTime: 30_000` (30s) par défaut — évite les refetch inutiles.
 *   - `gcTime: 5 * 60_000` (5 min) — cache des données pendant la navigation entre pages.
 *   - Retry x1 (settings globaux QueryClient = retry: 1).
 *
 * Utilisation typique (DashboardPage) :
 *   const {data: prospects = []} = useProspectsQuery();
 *   const sorted = [...prospects].sort((a,b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 5);
 */
import React from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import type {
  Prospect,
  Company,
  Contact,
  Campaign,
  MonitoringSignal,
  OutreachSummaryForCompany,
  AggregateScore,
  TaskRecord,
  TaskCounts,
  HeartbeatStatus,
  HotProspectsResponse,
  HotCompaniesResponse,
} from '@/types';

export type { TaskRecord, TaskCounts, HeartbeatStatus };

// =====================================================================
// Helpers
// =====================================================================

/** Petit wrapper qui unwrap la réponse standard `{success, data}` et jette si erreur. */
async function fetchList<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const api = getApiClient();
  const data = await api.get<T[]>(path, { signal });
  return Array.isArray(data) ? data : [];
}

/** Fetch un objet simple (analytics overview, etc.). */
async function fetchObject<T>(path: string, signal?: AbortSignal): Promise<T> {
  const api = getApiClient();
  return api.get<T>(path, { signal });
}

// =====================================================================
// Prospects
// =====================================================================

export function useProspectsQuery(): UseQueryResult<Prospect[], Error> {
  return useQuery<Prospect[], Error>({
    queryKey: ['prospects', 'list'],
    queryFn: ({ signal }) => fetchList<Prospect>(ENDPOINTS.prospectsList, signal),
    staleTime: 30_000,
  });
}

// =====================================================================
// Companies
// =====================================================================

export function useCompaniesQuery(): UseQueryResult<Company[], Error> {
  return useQuery<Company[], Error>({
    queryKey: ['companies', 'list'],
    queryFn: ({ signal }) => fetchList<Company>(ENDPOINTS.companiesList, signal),
    staleTime: 30_000,
  });
}

export function useCompanyQuery(id: string | null | undefined): UseQueryResult<Company, Error> {
  return useQuery<Company, Error>({
    queryKey: ['companies', 'detail', id],
    queryFn: async ({ signal }) => {
      if (!id) throw new Error('ID required');
      const api = getApiClient();
      const raw = await api.get<Company | { data: Company }>(ENDPOINTS.companyById(id), { signal });
      return ('data' in raw ? raw.data : raw) as Company;
    },
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// =====================================================================
// Round 35 — Company prospects + aggregate score
// =====================================================================

/**
 * Liste des prospects rattachés à une company via `company_id`.
 * Réutilise le cache React Query (1 query par company).
 */
export function useCompanyProspectsQuery(
  companyId: string | null | undefined,
): UseQueryResult<Prospect[], Error> {
  return useQuery<Prospect[], Error>({
    queryKey: ['companies', companyId, 'prospects'],
    queryFn: async ({ signal }) => {
      if (!companyId) return [];
      const api = getApiClient();
      const raw = await api.get<Prospect[] | { data: Prospect[] }>(
        ENDPOINTS.companyProspects(companyId),
        { signal },
      );
      const list = (raw && 'data' in raw && Array.isArray((raw as { data: Prospect[] }).data))
        ? (raw as { data: Prospect[] }).data
        : (Array.isArray(raw) ? raw : []);
      return list;
    },
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });
}

/**
 * Aggregate score (Round 35) — score 0-100 dérivé de :
 *  0.4 × companyScore + 0.3 × prospectsAvg + 0.25 × intelligenceScore
 *  + bonus (signaux critiques, replies).
 */
export function useCompanyAggregateScoreQuery(
  companyId: string | null | undefined,
): UseQueryResult<AggregateScore, Error> {
  return useQuery<AggregateScore, Error>({
    queryKey: ['companies', companyId, 'aggregate-score'],
    queryFn: async ({ signal }) => {
      if (!companyId) throw new Error('companyId required');
      const api = getApiClient();
      const raw = await api.get<{ data: AggregateScore } | AggregateScore>(
        ENDPOINTS.companyAggregateScore(companyId),
        { signal },
      );
      return ('data' in raw ? raw.data : raw) as AggregateScore;
    },
    enabled: Boolean(companyId),
    staleTime: 30_000,
  });
}

/**
 * Round 35 — résumé outreach pour une company : tous les emails + séquences
 * des prospects rattachés.
 */
export function useCompanyOutreachSummaryQuery(
  companyId: string | null | undefined,
): UseQueryResult<OutreachSummaryForCompany, Error> {
  return useQuery<OutreachSummaryForCompany, Error>({
    queryKey: ['outreach', 'company', companyId],
    queryFn: async ({ signal }) => {
      if (!companyId) throw new Error('companyId required');
      const api = getApiClient();
      const raw = await api.get<{ data: OutreachSummaryForCompany } | OutreachSummaryForCompany>(
        ENDPOINTS.outreachForCompany(companyId),
        { signal },
      );
      return ('data' in raw ? raw.data : raw) as OutreachSummaryForCompany;
    },
    enabled: Boolean(companyId),
    staleTime: 15_000,
  });
}

// =====================================================================
// Contacts
// =====================================================================

export function useContactsQuery(): UseQueryResult<Contact[], Error> {
  return useQuery<Contact[], Error>({
    queryKey: ['contacts', 'list'],
    queryFn: ({ signal }) => fetchList<Contact>(ENDPOINTS.contactsList, signal),
    staleTime: 30_000,
  });
}

// =====================================================================
// Campaigns
// =====================================================================

export function useCampaignsQuery(): UseQueryResult<Campaign[], Error> {
  return useQuery<Campaign[], Error>({
    queryKey: ['campaigns', 'list'],
    queryFn: ({ signal }) => fetchList<Campaign>(ENDPOINTS.campaignsList, signal),
    staleTime: 30_000,
  });
}

/** Liste des prospects rattachés à une campagne (via la table campaign_prospects). */
export function useCampaignProspectsQuery(
  campaignId: string | null | undefined,
): UseQueryResult<Prospect[], Error> {
  return useQuery<Prospect[], Error>({
    queryKey: ['campaigns', campaignId, 'prospects'],
    queryFn: ({ signal }) => {
      if (!campaignId) return Promise.resolve([] as Prospect[]);
      return fetchList<Prospect>(`${ENDPOINTS.campaignById(campaignId)}/prospects`, signal);
    },
    enabled: Boolean(campaignId),
    staleTime: 30_000,
  });
}

// =====================================================================
// Monitoring signals
// =====================================================================

export function useMonitoringQuery(): UseQueryResult<MonitoringSignal[], Error> {
  return useQuery<MonitoringSignal[], Error>({
    queryKey: ['monitoring', 'list'],
    queryFn: ({ signal }) => fetchList<MonitoringSignal>(ENDPOINTS.monitoringList, signal),
    staleTime: 30_000,
  });
}

// =====================================================================
// Intelligence (per entity) — Round 34
// =====================================================================

/**
 * Forme canonique d'une ligne `intelligence` du backend.
 * Le backend stocke : summary, insights, risks, recommendations,
 * opportunity_score, relevance_score, intent_score, activity_score,
 * confidence_score. Tout peut être null si l'analyse n'a pas encore été
 * déclenchée.
 */
export interface IntelligenceRecord {
  id: string;
  entity_type: 'prospect' | 'company' | 'contact' | 'campaign';
  entity_id: string;
  score: number | null;
  opportunity_score: number | null;
  relevance_score: number | null;
  intent_score: number | null;
  activity_score: number | null;
  confidence_score: number | null;
  summary: string | null;
  insights: string | null;
  risks: string | null;
  recommendations: string | null;
  email_subject?: string | null;
  email_html?: string | null;
  email_body?: string | null;
  email_cta_url?: string | null;
  profile?: Record<string, string> | null;
  product_estimate?: {
    product?: string | null;
    price_monthly_eur?: number | null;
    impact_pct?: number | null;
    roi_12m_eur?: number | null;
    justification?: string | null;
    note?: string | null;
  } | null;
  created_at?: string;
  updated_at?: string;
}

/**
 * Charge le bloc `intelligence` agrégé pour une entité
 * (summary + scores + insights + risks + recos).
 * `enabled:false` par défaut quand l'id manque.
 */
export function useIntelligenceForEntity(
  entityType: 'prospect' | 'company' | 'contact' | 'campaign' | null | undefined,
  entityId: string | null | undefined,
): UseQueryResult<IntelligenceRecord | null, Error> {
  return useQuery<IntelligenceRecord | null, Error>({
    queryKey: ['intelligence', entityType, entityId],
    queryFn: async ({ signal }) => {
      if (!entityType || !entityId) {
        throw new Error('entityType/entityId required');
      }
      const api = getApiClient();
      try {
        const data = await api.get<IntelligenceRecord | { data: IntelligenceRecord }>(
          ENDPOINTS.intelligenceForEntity(entityType, entityId),
          { signal },
        );
        if (data && typeof data === 'object' && 'data' in data) {
          return ((data as { data: IntelligenceRecord }).data) ?? null;
        }
        return (data as IntelligenceRecord) ?? null;
      } catch (err) {
        // 404 = pas encore d'analyse stockée → pas une erreur métier.
        if (err instanceof Error && /NOT_FOUND|404/i.test(err.message)) return null;
        throw err;
      }
    },
    enabled: Boolean(entityType && entityId),
    retry: false,
    staleTime: 30_000,
  });
}

/**
 * Charge les signaux monitoring rattachés à une entité.
 * Round 34 — utilisé par le panneau de détail Company pour visualiser
 * les weak signals connus.
 */
export function useSignalsForEntity(
  entityType: 'prospect' | 'company' | 'contact' | 'campaign' | null | undefined,
  entityId: string | null | undefined,
): UseQueryResult<MonitoringSignal[], Error> {
  return useQuery<MonitoringSignal[], Error>({
    queryKey: ['intelligence', entityType, entityId, 'signals'],
    queryFn: async ({ signal }) => {
      if (!entityType || !entityId) return [] as MonitoringSignal[];
      const api = getApiClient();
      try {
        const data = await api.get<MonitoringSignal[] | { data: MonitoringSignal[] }>(
          `${ENDPOINTS.intelligenceForEntity(entityType, entityId)}/signals`,
          { signal },
        );
        if (data && typeof data === 'object' && 'data' in data) {
          return ((data as { data: MonitoringSignal[] }).data) ?? [];
        }
        return (data as MonitoringSignal[]) ?? [];
      } catch {
        return [];
      }
    },
    enabled: Boolean(entityType && entityId),
    staleTime: 30_000,
  });
}

// =====================================================================
// Analytics overview
// =====================================================================

export interface AnalyticsOverview {
  users: number;
  companies: number;
  prospects: number;
  contacts: number;
  campaigns: number;
  intelligence: number;
  signals: number;
  ai_analyses: number;
  monitoring: number;
}

export function useAnalyticsOverviewQuery(): UseQueryResult<AnalyticsOverview, Error> {
  return useQuery<AnalyticsOverview, Error>({
    queryKey: ['analytics', 'overview'],
    queryFn: ({ signal }) => fetchObject<AnalyticsOverview>(ENDPOINTS.analyticsOverview, signal),
    staleTime: 30_000,
  });
}

// =====================================================================
// Analytics timeseries (Round 22 — Dashboard sparklines)
// =====================================================================

/** Métriques supportées par le backend pour le timeseries. */
export type TimeseriesMetric = 'hot_prospects' | 'hot_companies' | 'signals' | 'won';

export interface TimeseriesPoint {
  /** Date ISO court 'YYYY-MM-DD'. */
  date: string;
  /** Valeur cumulée à la fin du jour. */
  value: number;
}

export interface TimeseriesResponse {
  metric: TimeseriesMetric;
  days: number;
  points: TimeseriesPoint[];
}

/**
 * Renvoie la série 12-jours (par défaut) du `metric` demandé, prêt à
 * passer en prop `series` du composant `<Sparkline />`.
 *
 * L'endpoint retourne Always `points` avec N entrées (range strict côté
 * backend : 7 / 12 / 30 / 60 / 90). Si le backend échoue → series vide.
 */
export function useAnalyticsTimeseriesQuery(
  metric: TimeseriesMetric,
  days: 7 | 12 | 30 | 60 | 90 = 12,
): UseQueryResult<number[], Error> {
  return useQuery<number[], Error>({
    queryKey: ['analytics', 'timeseries', metric, days],
    queryFn: async ({ signal }) => {
      const raw = await fetchObject<TimeseriesResponse>(
        ENDPOINTS.analyticsTimeseries(metric, days),
        signal,
      );
      // On extrait juste les valeurs (Sparkline prend un number[]).
      return (raw.points ?? []).map((p) => Number(p.value ?? 0));
    },
    staleTime: 30_000,
  });
}

// =====================================================================
// Round 54 — Hot Prospects (détail + reasons, pas juste un count)
// =====================================================================

/**
 * Renvoie la liste détaillée des prospects « hot » (score ≥ minScore),
 * triés par score DESC puis updated_at DESC.
 *
 * Utilisé par :
 *   - AICenterPage SingleProspectTab → popover sur clic tuile HOT.
 *   - DashboardPage → futur enrichissement lead-scores mini dashboard.
 *
 * Chaque prospect remonté contient aussi `company_name` (LEFT JOIN)
 * et `reasons[]` (Score exceptionnel, Status engagé, Société identifiée,
 * Signal monitoring 7j, Analyse IA récente 7j) — calculé côté back pour
 * expliquer au user pourquoi ce prospect est classé "hot".
 */
export function useHotProspectsQuery(
  options: { minScore?: number; limit?: number; offset?: number; sector?: string; enabled?: boolean } = {},
): UseQueryResult<HotProspectsResponse, Error> {
  const minScore = options.minScore ?? 70;
  const limit = options.limit ?? 25;
  return useQuery<HotProspectsResponse, Error>({
    queryKey: ['analytics', 'hot-prospects', { minScore, limit, offset: options.offset ?? 0, sector: options.sector ?? null }],
    queryFn: ({ signal }) => fetchObject<HotProspectsResponse>(
      ENDPOINTS.analyticsHotProspects({ minScore, limit, offset: options.offset, sector: options.sector }),
      signal,
    ),
    enabled: options.enabled !== false,
    staleTime: 30_000,
  });
}

/**
 * Round 58 — `useHotCompaniesQuery` :
 *  - GET /api/companies/hot-companies
 *  - `HotCompaniesResponse` avec data[] (companies enrichies) + meta (total, limit, offset, threshold, sector)
 *  - triés par aggregate_score desc (moyenne pondérée back) puis score desc
 *
 * Utilisé par :
 *  - AICenterPage SingleProspectTab → popover sur clic tuile HOT companies (R58)
 *  - CompaniesPage → futur enrichissement navigation drill-down.
 *
 * Chaque company remontée contient aussi `aggregate_score`, `prospect_count`,
 * `prospect_avg_score`, `hot_prospect_count`, `recent_signals`,
 * `recent_analysis` et `reasons[]` (Score exceptionnel, N prospects hot,
 * N contacts en base, Analyse IA récente 7j, Signal critique détecté 7j)
 * — calculés côté back pour expliquer au user « pourquoi cette société est hot ».
 */
export function useHotCompaniesQuery(
  options: { minScore?: number; limit?: number; offset?: number; sector?: string; enabled?: boolean } = {},
): UseQueryResult<HotCompaniesResponse, Error> {
  const minScore = options.minScore ?? 70;
  const limit = options.limit ?? 25;
  return useQuery<HotCompaniesResponse, Error>({
    queryKey: ['companies', 'hot-companies', { minScore, limit, offset: options.offset ?? 0, sector: options.sector ?? null }],
    queryFn: ({ signal }) => fetchObject<HotCompaniesResponse>(
      ENDPOINTS.companiesHotCompanies({ minScore, limit, offset: options.offset, sector: options.sector }),
      signal,
    ),
    enabled: options.enabled !== false,
    staleTime: 30_000,
  });
}

// =====================================================================
// Round 36 — Tasks / Notifications polling
// =====================================================================

/**
 * Wrapper partagé pour la poll des tâches/notifications.
 *
 * Round 36 — interval adaptatif :
 *   - page visible + connecté → poll toutes les `visibleMs` (default 25 s).
 *   - background / tab caché     → poll toutes les `backgroundMs` (3 min)
 *     (le service worker (Round 36) prend le relais en off-screen).
 *
 * Réactif via `refetchInterval` de React Query : le hook s'auto-re-rend
 * quand le document hidden/visible change.
 */
function buildTaskRefetchInterval(visibleMs: number, backgroundMs: number): number {
  if (typeof document === 'undefined') return visibleMs;
  return document.hidden ? backgroundMs : visibleMs;
}

/** Tasks list query. `limit` par défaut 25 (couverture Bell dropdown). */
export function useTasksQuery(
  options: { limit?: number; since?: string | null; enabled?: boolean } = {},
): UseQueryResult<TaskRecord[], Error> {
  const limit = options.limit ?? 25;
  const qc = useQueryClient();

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onRefetch = () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
    };
    window.addEventListener('zentara:tasks-refetch-now', onRefetch);
    return () => window.removeEventListener('zentara:tasks-refetch-now', onRefetch);
  }, [qc]);

  return useQuery<TaskRecord[], Error>({
    queryKey: ['tasks', 'list', { limit, since: options.since ?? null }],
    queryFn: async ({ signal }) => {
      const api = getApiClient();
      const params = new URLSearchParams();
      params.set('limit', String(limit));
      if (options.since) params.set('since', options.since);
      const raw = await api.get<TaskRecord[] | { data: TaskRecord[] }>(
        `${ENDPOINTS.tasksList}?${params.toString()}`,
        { signal },
      );
      const list = Array.isArray(raw)
        ? raw
        : (raw && 'data' in raw && Array.isArray((raw as { data: TaskRecord[] }).data))
          ? (raw as { data: TaskRecord[] }).data
          : [];
      // Normaliser `seen` (backend le dérive de `seen_at IS NOT NULL`).
      return list.map((t) => ({
        ...t,
        seen: Boolean((t as TaskRecord & { seen_at?: string | null }).seen_at),
      }));
    },
    refetchInterval: () => buildTaskRefetchInterval(25_000, 180_000),
    refetchOnWindowFocus: true,
    enabled: options.enabled !== false,
    staleTime: 0,
  });
}

/**
 * Compteurs de tâches (pour la Bell badge).
 * Poll moins fréquemment : on s'en fiche si la valeur est ±1 vue.
 */
export function useTaskCountsQuery(
  enabled: boolean = true,
): UseQueryResult<TaskCounts, Error> {
  return useQuery<TaskCounts, Error>({
    queryKey: ['tasks', 'counts'],
    queryFn: async ({ signal }) => {
      const api = getApiClient();
      const raw = await api.get<TaskCounts | { data: TaskCounts }>(
        ENDPOINTS.tasksCounts,
        { signal },
      );
      return ('data' in raw ? raw.data : raw) as TaskCounts;
    },
    refetchInterval: () => buildTaskRefetchInterval(15_000, 300_000),
    enabled,
    staleTime: 10_000,
  });
}

/**
 * Round 42 — ids des companies dont l'auto-analyse 7-engines a échoué
 * récemment (tasks `failed`). Les rows de CompaniesPage affichent un
 * bouton "Relancer l'analyse" pour ces sociétés.
 */
export function useAutoAnalysisFailuresQuery(): UseQueryResult<string[], Error> {
  return useQuery<string[], Error>({
    queryKey: ['auto-analysis', 'failures'],
    queryFn: async ({ signal }) => {
      const api = getApiClient();
      const raw = await api.get<{ company_ids?: string[] } | { data: { company_ids?: string[] } }>(
        ENDPOINTS.autoAnalysisFailures,
        { signal },
      );
      const body = 'data' in raw ? (raw as { data: { company_ids?: string[] } }).data : (raw as { company_ids?: string[] });
      return body?.company_ids ?? [];
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });
}

/** Heartbeat keep-alive (utilisé par le service worker + monitoring). */
export function useHeartbeatQuery(
  enabled: boolean = true,
): UseQueryResult<HeartbeatStatus, Error> {
  return useQuery<HeartbeatStatus, Error>({
    queryKey: ['heartbeat'],
    queryFn: async ({ signal }) => {
      const api = getApiClient();
      const raw = await api.get<HeartbeatStatus | { data: HeartbeatStatus }>(
        ENDPOINTS.tasksHeartbeat,
        { signal },
      );
      return ('data' in raw ? raw.data : raw) as HeartbeatStatus;
    },
    refetchInterval: () => buildTaskRefetchInterval(45_000, 240_000),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}
