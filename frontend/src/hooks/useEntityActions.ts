/**
 * useEntityActions — Round 24 — shared React Query mutations pour
 * rendre l'app totalement opérationnelle depuis chaque ligne de table.
 *
 * Chaque bouton "Analyze", "Edit", "Delete" des pages `Prospects`,
 * `Companies`, `Contacts`, `Monitoring` consomme ces helpers. Toutes
 * les requêtes invalident les queryKeys concernées pour rafraîchir
 * automatiquement la liste affichée.
 *
 * Architecture :
 *   - Pas de dépendance aux screens → utilisable partout.
 *   - Pattern optimistic update pour Delete (UI réagit en <50 ms),
 *     rollback si la requête échoue (`onError`).
 *   - Return `{ mutate, isPending, error }` style React Query standard.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import type {
  EmailDraftOutput,
  OutreachEmail,
  OutreachSequence,
  TaskRecord,
  HeartbeatStatus,
  TaskCounts,
} from '@/types';

// =====================================================================
// Helpers
// =====================================================================

const api = () => getApiClient();

/** Round 24 — types de retour de POST /api/intelligence/analyze (souple). */
interface IntelligenceAnalyzeResponse {
  prospect?: { prospect_id?: string; summary?: string };
  company?: { company_id?: string; summary?: string };
  synthesis?: { executive_summary?: string; priority?: string };
  meta?: { engine?: string; duration_ms?: number };
}

// =====================================================================
// Analyze mutation (intelligence)
// =====================================================================

/**
 * Round 24 — schéma aligné avec `intelligenceController.analyze` backend :
 *   { entity_type, entity_id, query?, prospect?, company? }
 * où `entity_id` doit matcher le pattern `pros_xxxxxxxx` ou `comp_xxxxxxxx`.
 * Si l'entity_id n'a pas le bon préfixe, le backend répond 422 (à traiter
 * côté UI) ; on joint donc un snapshot `prospect`/`company` minimal pour
 * permettre au pipeline de fonctionner même sans vraie ligne en DB.
 */
export function useAnalyzeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      entityType: 'prospect' | 'company';
      entityId: string;
      query?: string;
      first_name?: string;
      last_name?: string;
      name?: string;
      company_name?: string;
    }) => {
      const query = payload.query ?? `Analyse ${payload.entityType} ${payload.entityId}`;
      const base: Record<string, unknown> = {
        entity_type: payload.entityType,
        entity_id: payload.entityId,
        query,
      };
      if (payload.entityType === 'prospect') {
        base.prospect = {
          id: payload.entityId,
          first_name: payload.first_name ?? '',
          last_name: payload.last_name ?? '',
          company_name: payload.company_name,
        };
      } else {
        base.company = {
          id: payload.entityId,
          name: payload.name ?? '',
        };
      }
      return api().post<IntelligenceAnalyzeResponse>(ENDPOINTS.analyze, base);
    },
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ['analytics', 'overview'] });
      void qc.invalidateQueries({
        queryKey: ['intelligence', variables.entityType, variables.entityId],
      });
    },
  });
}

// =====================================================================
// Delete mutations
// =====================================================================

function useGenericDelete(
  endpointBuilder: (id: string) => string,
  queryKeyPrefix: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api().delete(endpointBuilder(id));
      return id;
    },
    // Optimistic update : on retire la ligne du cache local tout de suite,
    // rollback si l'API échoue.
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: [queryKeyPrefix, 'list'] });
      const previous = qc.getQueryData<unknown[]>([queryKeyPrefix, 'list']);
      qc.setQueryData<unknown[]>([queryKeyPrefix, 'list'], (old) =>
        Array.isArray(old) ? old.filter((row) => (row as { id?: string }).id !== id) : old,
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData([queryKeyPrefix, 'list'], ctx.previous);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [queryKeyPrefix, 'list'] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'overview'] });
    },
  });
}

export function useDeleteProspectMutation() {
  return useGenericDelete((id) => ENDPOINTS.prospectById(id), 'prospects');
}

// =====================================================================
// Round 92e — Clean legacy "channel" prospects (preview + commit)
// =====================================================================

/**
 * Round 92e — suppression en masse des prospects `first_name==last_name`
 * ou dont les notes mentionnent "scraping"/"auto-scrape" (issus des
 * anciennes versions du scrape avant Round 92c/92d).
 *
 * Deux passes :
 *   1. `mutate({ confirm: false })` → preview (matched count + sample).
 *   2. `mutate({ confirm: true })`  → suppression effective.
 *
 * Après succès, on invalide `['prospects','list']` + `['analytics',...]`
 * pour rafraîchir toutes les pages concernées.
 */
export interface CleanLegacyRequest {
  confirm: boolean;
  company_id?: string;
}
export interface CleanLegacyResponse {
  preview: boolean;
  matched: number;
  deleted?: number;
  company_id: string | null;
  sample: Array<{
    id: string;
    email: string | null;
    first_name: string;
    last_name: string;
    company_id: string | null;
  }>;
}

export function useCleanLegacyProspectsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CleanLegacyRequest) => {
      const res = await api().post<CleanLegacyResponse>(
        ENDPOINTS.prospectsCleanLegacyChannels,
        body,
      );
      return res;
    },
    onSuccess: (data) => {
      if (!data.preview && (data.deleted ?? 0) > 0) {
        void qc.invalidateQueries({ queryKey: ['prospects', 'list'] });
        void qc.invalidateQueries({ queryKey: ['analytics'] });
      }
    },
  });
}

export function useDeleteCompanyMutation() {
  return useGenericDelete((id) => ENDPOINTS.companyById(id), 'companies');
}

export function useDeleteContactMutation() {
  return useGenericDelete((id) => ENDPOINTS.contactById(id), 'contacts');
}

// =====================================================================
// Round 43 — Enrichissement "Réponse Zentara" (POST /api/auto-analysis/enrich)
// =====================================================================

/**
 * Exécute les modules recommandés par la réponse Zentara d'une fiche
 * company : analyse 7-engines, prospects décideurs, pré-drafts outreach,
 * activation monitoring.
 *
 * Round 66 — ajoute `design?: boolean` : audit design du site + auto-draft
 * outreach email si score < 70 + email connu (delegated to backend).
 */
export function useEnrichCompanyMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      company_id: string;
      analyze?: boolean;
      prospect?: boolean;
      outreach?: boolean;
      monitoring?: boolean;
      /** Round 44 — scraping du site (tél/email) avant création prospect. */
      scrape?: boolean;
      /** Round 66 — audit design + auto-draft outreach si score < 70. */
      design?: boolean;
    }) => {
      const api = getApiClient();
      return api.post<{ success: boolean; data?: unknown; meta?: unknown }>(
        ENDPOINTS.autoAnalysisEnrich,
        input,
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['companies', 'list'] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'overview'] });
      void qc.invalidateQueries({ queryKey: ['intelligence', 'company'] });
      void qc.invalidateQueries({ queryKey: ['intelligence', 'prospect'] });
      void qc.invalidateQueries({ queryKey: ['prospects', 'company'] });
      void qc.invalidateQueries({ queryKey: ['outreach', 'company'] });
      void qc.invalidateQueries({ queryKey: ['signals', 'company'] });
      // Round 44 — le scraping peut créer/mettre à jour un contact.
      void qc.invalidateQueries({ queryKey: ['contacts', 'list'] });
      // Round 66 — l'audit design et l'outreach peut être modifié.
      void qc.invalidateQueries({ queryKey: ['design-audit'] });
      void qc.invalidateQueries({ queryKey: ['outreach', 'emails'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'unseen-count'] });
      void qc.invalidateQueries({ queryKey: ['contacts', 'company'] });
    },
  });
}

// Round 34 — Force auto-analysis (POST /api/auto-analysis/analyze-now)
// =====================================================================

/**
 * Force l'analyse 7-engines d'une company ou d'un prospect dès maintenant
 * (utilisé par le panneau de détail CompaniesPage → bouton
 * "Force auto-analysis").
 */
export function useForceAutoAnalyzeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { company_id?: string; prospect_id?: string }) => {
      const api = getApiClient();
      return api.post<{ success: boolean; data?: unknown; meta?: unknown }>(
        ENDPOINTS.autoAnalysisAnalyzeNow,
        input,
      );
    },
    onSuccess: () => {
      // On force un refetch de la liste + des détails intelligence + analytics.
      void qc.invalidateQueries({ queryKey: ['companies', 'list'] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'overview'] });
      void qc.invalidateQueries({ queryKey: ['intelligence', 'company'] });
      void qc.invalidateQueries({ queryKey: ['intelligence', 'prospect'] });
      // Round 42 — si la relance a réussi, la company sort immédiatement
      // de la liste des échecs (le bouton rouge "Relancer" disparaît).
      void qc.invalidateQueries({ queryKey: ['auto-analysis', 'failures'] });
    },
  });
}

// =====================================================================
// Update mutations
// =====================================================================

/** Round 24 — update partiel (status, notes, tags…). */
function useGenericUpdate<T extends Record<string, unknown>>(
  endpointBuilder: (id: string) => string,
  queryKeyPrefix: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<T> }) => {
      return api().put<T>(endpointBuilder(id), patch);
    },
    onSuccess: (_data, _vars) => {
      void qc.invalidateQueries({ queryKey: [queryKeyPrefix, 'list'] });
    },
  });
}

export function useUpdateProspectMutation() {
  return useGenericUpdate<Record<string, unknown>>(
    (id) => ENDPOINTS.prospectById(id),
    'prospects',
  );
}

export function useUpdateCompanyMutation() {
  return useGenericUpdate<Record<string, unknown>>(
    (id) => ENDPOINTS.companyById(id),
    'companies',
  );
}

// =====================================================================
// Round 92 — auto-scrape toggle (PATCH /api/companies/:id/auto-scrape)
// =====================================================================

import type { AutoScrapePolicy, AutoScrapeStatus } from '@/types';

/**
 * PATCH the auto-scrape policy for a company. Body: `{ auto_scrape }`.
 * Invalide ['companies', 'detail', id] + ['companies', 'autoscrape', id].
 */
export function useUpdateAutoScrapeMutation() {
  const qc = useQueryClient();
  return useMutation<AutoScrapeStatus, Error, { id: string; auto_scrape: AutoScrapePolicy }>({
    mutationFn: async ({ id, auto_scrape }) => {
      const res = await api().patch<{ success: boolean; data: AutoScrapeStatus }>(
        ENDPOINTS.companyAutoScrape(id),
        { auto_scrape },
      );
      return res.data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['companies', 'autoscrape', vars.id] });
      qc.invalidateQueries({ queryKey: ['company', 'detail', vars.id] });
      qc.invalidateQueries({ queryKey: ['companies', 'list'] });
    },
  });
}

/**
 * GET the current auto-scrape status for a company (poll-able).
 * RefreshInterval 5s when the company has `can_fire_now=true` so the
 * UI catches the auto-fire in near-real-time without a page reload.
 */
export function useAutoScrapeStatusQuery(companyId: string | null | undefined) {
  return useQuery<AutoScrapeStatus>({
    queryKey: ['companies', 'autoscrape', companyId],
    queryFn: async () => {
      const res = await api().get<{ success: boolean; data: AutoScrapeStatus }>(
        ENDPOINTS.companyAutoScrapeStatus(companyId as string),
      );
      return res.data;
    },
    enabled: !!companyId,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });
}

export function useUpdateContactMutation() {
  return useGenericUpdate<Record<string, unknown>>(
    (id) => ENDPOINTS.contactById(id),
    'contacts',
  );
}

// =====================================================================
// Create mutations
// =====================================================================

function useGenericCreate<TIn, TOut>(
  listEndpoint: string,
  queryKeyPrefix: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TIn) => api().post<TOut>(listEndpoint, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [queryKeyPrefix, 'list'] });
      void qc.invalidateQueries({ queryKey: ['analytics', 'overview'] });
    },
  });
}

export function useCreateProspectMutation() {
  return useGenericCreate<Record<string, unknown>, Record<string, unknown>>(
    ENDPOINTS.prospectsList,
    'prospects',
  );
}

export function useCreateCompanyMutation() {
  return useGenericCreate<Record<string, unknown>, Record<string, unknown>>(
    ENDPOINTS.companiesList,
    'companies',
  );
}

export function useCreateContactMutation() {
  return useGenericCreate<Record<string, unknown>, Record<string, unknown>>(
    ENDPOINTS.contactsList,
    'contacts',
  );
}

// =====================================================================
// Round 35 — Outreach mutations (draft / send / respond)
// =====================================================================

export interface OutreachDraftResponse {
  drafts: EmailDraftOutput[];
  persisted: OutreachEmail[];
}

export type OutreachDraftTone = 'cold' | 'follow_up' | 'breakup' | 'reply' | 'all';

/**
 * Mutation : génère des drafts d'email via l'IA.
 * Invalide automatiquement le cache outreach + prospect + company.
 */
export function useGenerateOutreachDraftsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      prospect_id: string;
      tone?: OutreachDraftTone;
      context?: string;
      simulate?: boolean;
      persist?: boolean;
    }) => {
      const api = getApiClient();
      return api.post<{ success: boolean; data: OutreachDraftResponse; meta?: Record<string, unknown> }>(
        ENDPOINTS.outreachDraft,
        input,
      );
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['outreach'] });
      void qc.invalidateQueries({ queryKey: ['companies', 'list'] });
      if (vars.prospect_id) {
        void qc.invalidateQueries({
          queryKey: ['outreach', 'timeline', vars.prospect_id],
        });
      }
    },
  });
}

/** POST /api/outreach/send — marque un draft comme envoyé. */
export function useOutreachSendMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email_id: string; sent_at?: string }) => {
      const api = getApiClient();
      return api.post<{ success: boolean; data: { email: OutreachEmail; sequence: OutreachSequence | null } }>(
        ENDPOINTS.outreachSend,
        input,
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['outreach'] });
      void qc.invalidateQueries({ queryKey: ['companies', 'list'] });
    },
  });
}

/** POST /api/outreach/respond — branche la séquence en fonction de la
 *  réponse prospect (replied/bounced/opened/failed) + propose un reply draft. */
export function useOutreachRespondMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      email_id: string;
      response: 'replied' | 'bounced' | 'opened' | 'failed';
      response_text?: string;
      end_sequence?: boolean;
    }) => {
      const api = getApiClient();
      return api.post<{
        success: boolean;
        data: {
          email: OutreachEmail;
          sequence: OutreachSequence | null;
          suggested_reply: EmailDraftOutput | null;
        };
      }>(
        ENDPOINTS.outreachRespond,
        input,
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['outreach'] });
      void qc.invalidateQueries({ queryKey: ['companies', 'list'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}

// =====================================================================
// Round 36 — Tasks / Notifications mutations
// =====================================================================

/**
 * POST /api/tasks/:id/seen — marque 1 tâche comme lue.
 *
 * Optimistic update : on retire la tâche de `seen:false` indirectement
 * (la mise à jour du cache `['tasks', 'counts']` recalcule unseen immédiat).
 */
export function useMarkTaskSeenMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      const r = await api.post<{ success: boolean }>(ENDPOINTS.taskSeen(id), {});
      return { id, ...r };
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['tasks', 'list'] });
      const previousList = qc.getQueryData<TaskRecord[]>(['tasks', 'list']);
      const nowIso = new Date().toISOString();
      qc.setQueryData<TaskRecord[]>(['tasks', 'list'], (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((t) => {
          if (t.id !== id) return t;
          const wasDone = t.status === 'done' || t.status === 'failed';
          return {
            ...t,
            seen: true,
            seen_at: nowIso,
          } as TaskRecord;
        });
      });
      // Counts update optimiste : on retire 1 unseen_done (cas majoritaire).
      const previousCounts = qc.getQueryData<TaskCounts>(['tasks', 'counts']);
      qc.setQueryData<TaskCounts>(['tasks', 'counts'], (old) => {
        if (!old) return old;
        const c = { ...old };
        if (c.unseen_done > 0) c.unseen_done = Math.max(0, c.unseen_done - 1);
        else if (c.unseen_failed > 0) c.unseen_failed = Math.max(0, c.unseen_failed - 1);
        return c;
      });
      return { previousList, previousCounts };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previousList) qc.setQueryData(['tasks', 'list'], ctx.previousList);
      if (ctx?.previousCounts) qc.setQueryData(['tasks', 'counts'], ctx.previousCounts);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks', 'counts'] });
      void qc.invalidateQueries({ queryKey: ['tasks', 'list'] });
    },
  });
}

/** POST /api/tasks/seen-bulk — body: { ids: string[] }. */
export function useMarkTasksSeenBulkMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const api = getApiClient();
      const r = await api.post<{ success: boolean; data: { marked: number } }>(
        ENDPOINTS.tasksSeenBulk,
        { ids },
      );
      return { ids, ...r };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/** DELETE /api/tasks/:id — supprime (rare : bouton "Dismiss" dans le panel). */
export function useDeleteTaskMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      await api.delete(ENDPOINTS.taskDelete(id));
      return id;
    },
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['tasks', 'list'] });
      const previousList = qc.getQueryData<TaskRecord[]>(['tasks', 'list']);
      qc.setQueryData<TaskRecord[]>(['tasks', 'list'], (old) =>
        Array.isArray(old) ? old.filter((t) => t.id !== id) : old,
      );
      return { previousList };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previousList) qc.setQueryData(['tasks', 'list'], ctx.previousList);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/**
 * Lightweight heartbeat ping — appelé par le service worker + le
 * hook backend useHeartbeatQuery. Renvoie { ok, server_time, ... }.
 * Note : le `baseUrl` runtime override doit être passé via
 * `window.__ZENTARA_API_BASE__` (le client ne supporte plus un
 * paramètre `baseUrl` ad-hoc). On reste best-effort ici.
 */
export async function pingHeartbeat(): Promise<HeartbeatStatus | null> {
  try {
    const api = getApiClient();
    const r = await api.get<HeartbeatStatus | { data: HeartbeatStatus }>(
      ENDPOINTS.tasksHeartbeat,
    );
    return ('data' in r ? r.data : r) as HeartbeatStatus;
  } catch {
    return null;
  }
}
