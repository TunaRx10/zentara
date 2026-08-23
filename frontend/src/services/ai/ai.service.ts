/**
 * AI Service frontend — appelle le backend Zentara.
 *
 * Round 8 : réécrit pour utiliser la façade `/api/intelligence/analyze`
 * (pipeline 7 engines + cache + cascade + scoring) avec fallback
 * heuristique local (offline-first).
 *
 * Architecture :
 *   - `analyzeProspect(prospectId, prospectData, companyData?, options)` :
 *     appelle la façade. Retourne la forme `IntelligenceAnalysisResponse`
 *     alignée avec l'UI AICenterPage.
 *   - `analyzeProspectLocal(prospectId, prospectData)` : heuristique offline
 *     (route `/api/intelligence/pipeline/local-prospect`).
 *   - `analyzeProspectFull(...)` : route pipeline complète (avec company jointe).
 *
 * Comportement :
 *   - Si online : tente d'abord le pipeline complet (cache 1h).
 *   - Si offline / erreur réseau : tombe en fallback heuristique local.
 *   - Persiste le résultat dans la SQLite locale (Capacitor).
 */
import { getApiClient, ENDPOINTS, ZentaraApiError } from '../api/client';
import type { IntelligenceAnalysisResponse } from '../api/types';
import { getDatabase } from '@/data/database/local-db';
import { AIAnalysis, Prospect } from '@/types';
import { generateId } from '@/lib/utils';

/**
 * Round 32 — réponse type du moteur stratégique de prospection.
 * Le backend applique le master prompt `PROSPECTING V1` → renvoie
 * un dataset d'entreprises avec ICP, scoring, top-lists, etc.
 */
export interface ProspectingScoreBreakdown {
  intelligence_need: number;
  data_complexity: number;
  competitive_pressure: number;
  monitoring_frequency: number;
  manual_work: number;
  strategic_impact: number;
  ai_automation_potential: number;
  buying_potential: number;
}

export interface ProspectingAgentRecommended {
  name: string;
  mission: string;
  functions: string[];
  sources: string[];
  frequency: 'DAILY' | 'HOURLY' | 'WEEKLY' | 'MONTHLY';
  alerts: string[];
  recommended_actions: string[];
}

export interface ProspectingRoiQualitative {
  time_saved: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  manual_work_reduction: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  decision_velocity_improvement: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  risk_reduction: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  opportunity_detection: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
  commercial_impact: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';
}

export interface ProspectingCompany {
  rank: number;
  name: string;
  sector: string;
  hq_city: string;
  hq_country: string;
  company_size: string;
  website: string | null;
  primary_intelligence_need: string;
  zentara_opportunity_score: number;
  score_breakdown: ProspectingScoreBreakdown;
  priority_tier: 'ABSOLUTE' | 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW';
  needs_evidence: string[];
  weak_signals_to_monitor: string[];
  intelligence_problem: string;
  what_to_monitor: string[];
  public_sources_used: string[];
  zentara_agent_recommended: ProspectingAgentRecommended;
  multi_agent_stack: string[];
  decision_maker: {
    role: string;
    rationale: string;
    search_hint: string;
    publicly_visible_evidence: string | null;
  };
  buying_trigger_now: string;
  roi_potential_qualitative: ProspectingRoiQualitative;
  integration_difficulty: string;
  confidence_score: number;
  rank_evidence_tags: ('hiring' | 'expansion' | 'funding' | 'launch' | 'regulatory' | 'competitive' | 'leadership' | 'other')[];
  kpi_snapshot: {
    signals_found: number;
    verified_proofs: number;
    last_signal_date_estimate: string;
  };
}

export interface ProspectingICP {
  industry_verticals: string[];
  company_size_range: string;
  expected_team_size_intelligence: string;
  competitive_pressure_level: 'HIGH' | 'MEDIUM' | 'LOW';
  monitoring_cadence_required: 'DAILY' | 'HOURLY' | 'WEEKLY' | 'MONTHLY';
  common_intent_signals: string[];
  common_buying_triggers: string[];
  ideal_buyer_role: string;
  budget_size: 'SMALL' | 'MEDIUM' | 'LARGE';
  rationale: string;
  exclusions: string[];
}

export interface ProspectingTopLists {
  top_10_must_contact_now: string[];
  top_10_most_urgent_need: string[];
  top_10_strongest_automation_potential: string[];
  top_10_best_commercial_fit: string[];
}

export interface ProspectingResponse {
  prospecting_session_id: string;
  executed_at: string;
  sector_input: string;
  region_input: string;
  target_count_meta: number;
  summary: string;
  icp: ProspectingICP;
  companies: ProspectingCompany[];
  top_lists: ProspectingTopLists;
  global_risk_notes: string[];
  next_steps: string[];
  ai_analysis_id: string;
  persisted_companies: number;
  duration_ms: number;
  lite: boolean;
  /** Round 33 — auto_analyzed est rempli si des companies persistées
   *  avec score >= threshold ont déclenché leur analyse 7-engines. */
  auto_analyzed?: AutoAnalyzedRecordFE[];
  auto_analyze_enabled?: boolean;
  auto_analyze_threshold?: number;
}

/** Enveloppe renvoyée par la route backend — le champ `data` est
 *  exactement `ProspectingResponse` enrichi côté serveur. */
interface ProspectingApiEnvelope {
  data: ProspectingResponse;
  meta?: {
    ai_analysis_id: string;
    persisted_companies: number;
    duration_ms: number;
    lite: boolean;
    auto_analyze_enabled?: boolean;
    auto_analyze_threshold?: number;
    auto_analyzed_count?: number;
    auto_analyzed_failed?: number;
  };
}

/** Record auto-généré par l'auto-analysis service. */
export interface AutoAnalyzedRecordFE {
  entity_type: 'company' | 'prospect';
  entity_id: string;
  entity_name: string;
  score: number;
  status: 'analyzed' | 'fresh' | 'failed';
  ai_analysis_id?: string;
  duration_ms?: number;
  error?: string;
}

/** Round 33 — réponse de POST /api/auto-analysis/sweep */
export interface AutoAnalysisSweepResult {
  threshold: number;
  force: boolean;
  candidates: number;
  analyzed: number;
  fresh_skipped: number;
  failed: number;
  durée_ms: number;
  started_at: string;
  finished_at: string;
  records: AutoAnalyzedRecordFE[];
  last_error?: string;
}

/** Round 33 — réponse de GET /api/auto-analysis/status */
export interface AutoAnalysisStatus {
  running: boolean;
  sweep_in_flight: boolean;
  last_sweep_at: string | null;
  last_sweep_summary: {
    candidates: number;
    analyzed: number;
    fresh_skipped: number;
    failed: number;
    threshold: number;
  } | null;
}

/** Convertit un payload backend brut en `IntelligenceAnalysisResponse` aplati. */
function normalizeAnalysisPayload(raw: any): IntelligenceAnalysisResponse | null {
  if (!raw) return null;
  return {
    id: String(raw.id ?? `${raw.entity_type}_${raw.entity_id}`),
    entity_type: (raw.entity_type ?? 'prospect') as 'prospect' | 'company',
    entity_id: String(raw.entity_id ?? ''),
    summary: String(raw.summary ?? ''),
    insights: Array.isArray(raw.insights) ? raw.insights.map(String) : [],
    recommendations: Array.isArray(raw.recommendations) ? raw.recommendations.map(String) : [],
    risks: Array.isArray(raw.risks) ? raw.risks.map(String) : [],
    scores: {
      relevance: Number(raw.scores?.relevance ?? 0),
      opportunity: Number(raw.scores?.opportunity ?? 0),
      intent: Number(raw.scores?.intent ?? 0),
      activity: Number(raw.scores?.activity ?? 0),
      confidence: Number(raw.scores?.confidence ?? 0),
    },
    source: String(raw.source ?? 'pipeline-v1'),
    cached: Boolean(raw.cached ?? false),
    truncated_by_cascade: Boolean(raw.truncated_by_cascade ?? false),
    engines_run: Array.isArray(raw.engines_run) ? raw.engines_run.map(String) : [],
    raw_response: raw.raw_response,
  };
}

/** Persiste une analyse dans la SQLite locale (ai_analysis + intelligence upsert). */
async function persistAnalysisLocally(analysis: IntelligenceAnalysisResponse): Promise<void> {
  try {
    const db = await getDatabase();
    const analysisId = analysis.id.startsWith('ai_') ? analysis.id : generateId('ana');
    const now = new Date().toISOString();

    await db.run(
      `INSERT OR REPLACE INTO ai_analysis (
        id, entity_type, entity_id, provider, model, prompt_version,
        summary, insights, recommendations, confidence, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        analysisId,
        analysis.entity_type,
        analysis.entity_id,
        analysis.source,
        'pipeline-v1',
        'pipeline-v1',
        analysis.summary,
        JSON.stringify(analysis.insights),
        JSON.stringify(analysis.recommendations),
        analysis.scores.confidence,
        now,
      ]
    );

    await db.run(
      `INSERT OR REPLACE INTO intelligence (
        id, entity_type, entity_id, score, opportunity_score, relevance_score,
        intent_score, activity_score, confidence_score, summary, insights,
        risks, recommendations, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateId('int'),
        analysis.entity_type,
        analysis.entity_id,
        Math.round(analysis.scores.relevance + analysis.scores.opportunity),
        analysis.scores.opportunity,
        analysis.scores.relevance,
        analysis.scores.intent,
        analysis.scores.activity,
        analysis.scores.confidence,
        analysis.summary,
        JSON.stringify(analysis.insights),
        JSON.stringify(analysis.risks),
        JSON.stringify(analysis.recommendations),
        now,
      ]
    );
  } catch (e) {
    // Persistence locale ne doit pas casser le flow principal : log silencieux.
    // eslint-disable-next-line no-console
    console.warn('ai.service: failed to persist analysis locally', e);
  }
}

export const aiService = {
  /**
   * Analyse un prospect. Pipeline complet par défaut, fallback heuristique offline.
   *
   * @param prospectId ID du prospect (en SQLite locale, miroir du backend).
   * @param prospectData Données du prospect (obligatoire pour fallback heuristique).
   * @param companyData Optionnel : enrichit le prompt pipeline si fourni.
   * @param options.offlineOnly Force le chemin heuristique (skip provider).
   * @param options.forceRefresh Bypass cache backend.
   */
  async analyzeProspect(
    prospectId: string,
    prospectData?: Partial<Prospect>,
    companyData?: { id?: string; name: string; sector?: string; website?: string } | null,
    options: { offlineOnly?: boolean; forceRefresh?: boolean; preferLocalPipeline?: boolean } = {},
  ): Promise<AIAnalysis> {
    let response;

    if (options.offlineOnly) {
      response = await aiService._callLocalProspect(prospectId, prospectData);
    } else if (options.preferLocalPipeline) {
      // Round 38 — chemin rapide pour les prospects nouvellement créés
      // (l'endpoint /analyze valide l'ID en DB et renvoie 422 si absente).
      // On utilise directement /pipeline/local-prospect qui marche avec
      // n'importe quel payload (même sans row en DB).
      response = await aiService._callLocalProspect(prospectId, prospectData);
    } else {
      try {
        response = await aiService._callAnalyzeFacade(prospectId, 'prospect', {
          force_refresh: options.forceRefresh,
          use_full_pipeline: true,
        });
      } catch (err) {
        // Fallback heuristique sur tout type d'erreur non-retryable ou persistante.
        if (err instanceof ZentaraApiError && (err.code === 'NETWORK_UNAVAILABLE' || err.code === 'TIMEOUT')) {
          response = await aiService._callLocalProspect(prospectId, prospectData);
        } else if (
          err instanceof ZentaraApiError &&
          (err.code === 'VALIDATION_ERROR' || err.code === 'NOT_FOUND' || err.status === 422 || err.status === 404)
        ) {
          // Round 38 — si le backend refuse l'ID (entité absente), on bascule
          // aussi vers l'heuristique locale qui marche sans DB row.
          try {
            response = await aiService._callLocalProspect(prospectId, prospectData);
          } catch {
            throw err;
          }
        } else if (err instanceof ZentaraApiError && err.isRetryable()) {
          // Round 46 — provider IA rate-limité / 5xx (ex: Gemini 429 sur le
          // quota gratuit) : au lieu d'échouer l'analyse, on bascule sur
          // l'heuristique locale (offline-first) et on le signale dans la
          // source du résultat. L'analyse profonde sera retentée par le
          // sweep périodique quand le quota reviendra.
          response = await aiService._callLocalProspect(prospectId, prospectData);
        } else {
          throw err;
        }
      }
    }

    await persistAnalysisLocally(response);
    // Map back to the local AIAnalysis shape that AICenterPage expects.
    return {
      id: response.id,
      entity_type: response.entity_type,
      entity_id: response.entity_id,
      summary: response.summary,
      insights: response.insights,
      recommendations: response.recommendations,
      risks: response.risks,
      scores: response.scores,
      raw_response: response.raw_response,
      created_at: new Date().toISOString(),
    };
  },

  /**
   * Appelle la façade `/api/intelligence/analyze` (compat front).
   */
  async _callAnalyzeFacade(
    entityId: string,
    entityType: 'prospect' | 'company',
    body: { force_refresh?: boolean; use_full_pipeline?: boolean } = {},
  ): Promise<IntelligenceAnalysisResponse> {
    const api = getApiClient();
    const url = entityType === 'prospect' ? ENDPOINTS.analyze : ENDPOINTS.analyze;
    // Round 46 — le pipeline 7-engines complet prend 30-180s (Gemini) : on
    // ne peut pas laisser le timeout client par défaut (30s) tuer la requête
    // (AI Center « Start Strategic Analysis » restait bloqué/échouait).
    const data = await api.post<any>(
      url,
      { entity_type: entityType, entity_id: entityId, ...body },
      { timeoutMs: 300_000, retries: 0 },
    );
    const normalized = normalizeAnalysisPayload(data);
    if (!normalized) {
      throw new Error('Backend : payload analyse invalide');
    }
    return normalized;
  },

  /** Appelle l'endpoint heuristique offline du backend (1 appel, pas de provider). */
  async _callLocalProspect(
    prospectId: string,
    prospectData?: Partial<Prospect>,
  ): Promise<IntelligenceAnalysisResponse> {
    const api = getApiClient();
    const p = prospectData ?? ({} as Partial<Prospect>);
    const data = await api.post<any>(
      ENDPOINTS.localProspect,
      {
        prospect: {
          id: prospectId,
          first_name: p.first_name ?? '?',
          last_name: p.last_name ?? '?',
          email: p.email,
          role: (p as Partial<Prospect>).role,
          company: undefined,
          sector: p.sector,
          location: [p.city, p.country].filter(Boolean).join(', ') || undefined,
        },
      },
      { timeoutMs: 120_000, retries: 0 },
    );
    const normalized = normalizeAnalysisPayload(data);
    if (!normalized) {
      throw new Error('Backend (heuristique) : payload invalide');
    }
    return normalized;
  },

  /**
   * Pipeline complet prospect + company jointe.
   * Pour UI qui veut explicitement le détail des 7 engines (debug/audit).
   */
  async analyzeProspectFull(payload: {
    prospect: { id?: string; first_name: string; last_name: string; role?: string; email?: string; sector?: string };
    company?: { id?: string; name: string; sector?: string; website?: string };
  }): Promise<any> {
    const api = getApiClient();
    return api.post(ENDPOINTS.pipelineProspect, payload);
  },

  /**
   * Round 32 — Moteur stratégique de prospection.
   *
   * Renvoie N entreprises cibles avec scoring / ICP / top_lists / multi-agent
   * stack recommandé. Implémente le master prompt `PROMPT_PROSPECTING_V1`.
   *
   * @param sector ex: "SaaS B2B", "FinTech", "Pharma", "Defense"...
   * @param region ex: "France", "EMEA", "Global"
   * @param targetCount nombre d'entreprises (1-25, défaut 10)
   * @param lite si true, utilise le prompt LITE (modèles open-source / free)
   * @param autoAnalyze Round 33 : déclenche l'analyse 7-engines sur les
   *                       companies persistées avec score >= threshold.
   *                       Défaut true.
   * @param autoAnalyzeThreshold override du seuil (env AUTO_ANALYZE_THRESHOLD).
   */
  async runProspecting(params: {
    sector: string;
    region?: string;
    target_count?: number;
    context?: string;
    lite?: boolean;
    persist?: boolean;
    auto_analyze?: boolean;
    auto_analyze_threshold?: number;
    model?: string;
  }): Promise<ProspectingResponse> {
    const api = getApiClient();
    // `api.post` déballe DÉJÀ l'enveloppe `{ success, data, meta }` et
    // retourne directement le `data` (le résultat du moteur de
    // prospection : `{ companies, persisted_companies, ... }`).
    // Round 46 — la génération IA de N entreprises prend 30-180s : le timeout
    // client par défaut (30s) avortait la requête (AI Center restait bloqué
    // sur « Running prospecting engine… » puis échouait). On passe 5 min +
    // 0 retry (inutile de relancer un appel LLM coûteux).
    //
    // Round 88 — bugfix : on accède directement à `companies` (et autres
    // champs du résultat) sans repasser par `.data` (renvoyé par api.post
    // SANS l'enveloppe). L'ancien check `if (!resp?.data)` était ALWAYS
    // truthy (resp.data = undefined), donc toutes les prospections finissaient
    // par « payload invalide » même quand le backend répondait 200 OK valide.
    try {
      const result = (await api.post<ProspectingResponse>(
        ENDPOINTS.prospecting,
        {
          sector: params.sector,
          region: params.region ?? 'Global',
          target_count: params.target_count ?? 10,
          context: params.context,
          lite: params.lite ?? false,
          persist: params.persist ?? true,
          auto_analyze: params.auto_analyze !== false,
          auto_analyze_threshold: params.auto_analyze_threshold,
          model: params.model?.trim() || undefined,
        },
        { timeoutMs: 300_000, retries: 0 },
      )) as ProspectingResponse & { meta?: Record<string, unknown> };
      if (
        !result ||
        typeof result !== 'object' ||
        !Array.isArray((result as { companies?: unknown }).companies)
      ) {
        // On garde l'ancien libellé (pour les UI qui le recherchent) mais
        // on joint un échantillon de ce qu'on a vraiment reçu.
        const sample = JSON.stringify(result ?? {}).slice(0, 240);
        throw new Error(
          `Backend prospecting : payload invalide — réponse inattendue (${sample || 'vide'})`,
        );
      }
      return result as ProspectingResponse;
    } catch (e) {
      // Surface les vraies erreurs serveur (422 zod, 401 auth, network, etc.)
      // au lieu d'un message générique trompeur.
      if (e instanceof ZentaraApiError) {
        const detail =
          (e.details && typeof e.details === 'object' && 'issues' in e.details
            ? ` (${(e.details as { issues?: unknown }).issues || 'validation'})`
            : '');
        throw new Error(`Backend prospecting : ${e.code} — ${e.message}${detail}`);
      }
      throw e;
    }
  },

  /**
   * Round 33 — déclenche un sweep manuel du service d'auto-analyse.
   * Renvoie le résultat détaillé (candidates / analyzed / fresh_skipped / failed).
   */
  async sweepAutoAnalysis(params?: {
    threshold?: number;
    force?: boolean;
    limit?: number;
    concurrency?: number;
  }): Promise<AutoAnalysisSweepResult> {
    const api = getApiClient();
    // Round 46 — un sweep analyse des entités en pipeline 7-engines (long) :
    // timeout client généreux pour ne pas avorter en plein milieu.
    return api.post<AutoAnalysisSweepResult>(
      ENDPOINTS.autoAnalysisSweep,
      {
        threshold: params?.threshold ?? 70,
        force: params?.force ?? false,
        limit: params?.limit ?? 50,
        concurrency: params?.concurrency ?? 2,
      },
      { timeoutMs: 600_000, retries: 0 },
    );
  },

  async getAutoAnalysisStatus(): Promise<AutoAnalysisStatus> {
    const api = getApiClient();
    return api.get<AutoAnalysisStatus>(ENDPOINTS.autoAnalysisStatus);
  },

  /** Lecture d'une analyse locale (SQLite). */
  async getLocalAnalysis(entityId: string): Promise<AIAnalysis | undefined> {
    const db = await getDatabase();
    const result = await db.query(
      'SELECT * FROM ai_analysis WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1',
      [entityId],
    );
    if (result.values && result.values.length > 0) {
      const row = result.values[0];
      return {
        ...row,
        insights: safeParse(row.insights, []),
        recommendations: safeParse(row.recommendations, []),
        // risks n'est pas persisté en ai_analysis : mettre [] par défaut.
        risks: [],
      } as AIAnalysis;
    }
    return undefined;
  },
};

function safeParse(raw: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : fallback;
  } catch (_e) {
    return fallback;
  }
}
