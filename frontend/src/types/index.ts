/**
 * Status d'un prospect — aligné sur l'enum backend `ProspectStatus`
 * (backend/src/modules/prospects/prospect.schema.ts). Les anciennes
 * valeurs `lead`/`negotiation`/`closed` ont été remplacées par
 * `new`/`interested`/`converted`.
 */
export type Status =
  | 'new'
  | 'qualified'
  | 'contacted'
  | 'interested'
  | 'converted'
  | 'lost';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  avatar_url?: string;
}

export interface Prospect {
  id: string;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  company_id?: string;
  /** Round 60 — nom de l'entreprise rattachée (dénormalisé pour l'UI). */
  company_name?: string | null;
  role?: string;
  sector?: string;
  address?: string;
  city?: string;
  country?: string;
  website?: string;
  social_profiles?: any;
  google_maps_url?: string;
  score?: number;
  status: Status;
  tags?: string[];
  notes?: string;
  /** Round 91 — JSON sérialisé `{overall, email_validity, phone_reachability, decision_maker}` */
  quality?: string | null;
  /** Round 90 — marker pour distinguer scraping DOM vs LLM (coté ContactQuality response). */
  extractor?: 'dom' | 'llm' | null;
  created_at: string;
  updated_at: string;
}

/**
 * Round 91 — qualité détaillée d'un prospect extrait (ou ajouté manuellement
 * avec score 0). Parsé côté front depuis `prospect.quality` (JSON string).
 */
export interface ContactQuality {
  email_validity: number;
  phone_reachability: number;
  decision_maker: number;
  overall: number;
}

/** Vide / défaut pour les prospects legacy (avant la migration 011). */
export const EMPTY_QUALITY: ContactQuality = {
  email_validity: 0,
  phone_reachability: 0,
  decision_maker: 0,
  overall: 0,
};

/**
 * Round 92 — politique d'auto-scrape configurable par fiche company.
 *   - 'off'      : rien
 *   - 'always'   : fire-and-forget scrape dès la création
 *   - 'when_hot' : fire dès que score >= 70 (jamais à la création)
 */
export type AutoScrapePolicy = 'off' | 'always' | 'when_hot';

/** Round 92 — statut retourné par GET /api/companies/:id/auto-scrape. */
export interface AutoScrapeStatus {
  company_id: string;
  policy: AutoScrapePolicy;
  pending: boolean;
  last_auto_scrape_at: string | null;
  can_fire_now: boolean;
  reason: string;
}

/**
 * Round 54 — prospect enriched retourné par GET /api/analytics/hot-prospects.
 * Étend Prospect avec `company_name` (LEFT JOIN companies) + `reasons`
 * (calculé back : score, status engagé, signal monitoring récent, analyse
 * IA récente).
 */
export interface HotProspectRow extends Prospect {
  company_name?: string | null;
  reasons?: string[];
}
export interface HotProspectsResponse {
  data: HotProspectRow[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    threshold: number;
    sector: string | null;
  };
}

/**
 * Round 58 — company enriched retourné par GET /api/companies/hot-companies.
 * Étend Company (sans `tags` car inutiles pour le popover) avec :
 *   - aggregate_score          (moyenne pondérée 40/30/30 calculée back)
 *   - prospect_count, prospect_avg_score, hot_prospect_count (LEFT JOIN prospects)
 *   - recent_signals, recent_analysis (monitoring + ai_analysis 7j)
 *   - reasons[]                (libellés calculés back, voir Round 54)
 */
export interface HotCompanyRow extends Omit<Company, 'tags'> {
  aggregate_score: number;
  prospect_count: number;
  prospect_avg_score: number;
  hot_prospect_count: number;
  recent_signals: boolean;
  recent_analysis: boolean;
  reasons: string[];
}
export interface HotCompaniesResponse {
  data: HotCompanyRow[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    threshold: number;
    sector: string | null;
  };
}

export interface Company {
  id: string;
  name: string;
  industry?: string;
  sector?: string;
  location?: string;
  website?: string;
  phone?: string;
  email?: string;
  score?: number;
  status: 'active' | 'inactive' | 'target' | 'new' | 'blacklisted';
  /** Round 34 — adresse postale détaillée (rue + ville + pays combinés). */
  address?: string | null;
  /** Round 34 — ville distincte (pour filtrage géographique). */
  city?: string | null;
  /** Round 34 — pays. */
  country?: string | null;
  /** Round 34 — profils sociaux (JSON string ou objet parsé par la couche transport). */
  social_profiles?: string | null;
  /** Round 34 — lien direct vers Maps. */
  google_maps_url?: string | null;
  /** Round 50 — tags JSON (string[]). Ex: ["design"] si la company
   *  a fait l'objet d'un Site Design Audit. Coercé en string[] côté UI. */
  tags?: string[] | string | null;
  /** Round 92 — politique auto-scrape ('off' par défaut). */
  auto_scrape?: AutoScrapePolicy;
  /** Round 92 — true si on attend encore qu'un scrape se déclenche (when_hot). */
  auto_scrape_pending?: boolean;
  /** Round 92 — ISO timestamp du dernier scrape automatique. */
  last_auto_scrape_at?: string | null;
  /** Round 34 — notes enrichies (incluant potentiellement le bloc
   *  "Zentara prospecting session …" généré par le Round 32). */
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  company_id?: string;
  role?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  notes?: string;
  /** Round 50 — mêmes tags que Company (string[]). */
  tags?: string[] | string | null;
  created_at: string;
  updated_at: string;
}

export interface IntelligenceScore {
  relevance: number;
  opportunity: number;
  intent: number;
  activity: number;
  confidence: number;
}

export interface IntelligenceSignal {
  id: string;
  entity_type: 'prospect' | 'company';
  entity_id: string;
  source: string;
  type: string;
  content: string;
  confidence: number;
  detected_at: string;
}

export interface AIAnalysis {
  id: string;
  entity_type: 'prospect' | 'company';
  entity_id: string;
  summary: string;
  insights: string[];
  recommendations: string[];
  risks: string[];
  scores: IntelligenceScore;
  raw_response: any;
  created_at: string;
}

export interface Activity {
  id: string;
  entity_type: 'prospect' | 'company' | 'contact' | 'campaign';
  entity_id: string;
  type: 'note' | 'call' | 'email' | 'meeting' | 'analysis' | 'status_change';
  description: string;
  metadata?: any;
  created_at: string;
}

export interface Campaign {
  id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'archived';
  /** Backend : `target` (colonne SQLite). Alias frontend legacy : `target_sector`. */
  target?: string | null;
  target_sector?: string;
  description?: string | null;
  /** Timestamp SQLite (ms epoch) OU ISO string selon l'endpoint. */
  created_at: string | number;
  updated_at: string | number;
}

export interface MonitoringSignal {
  id: string;
  /** Round 38 — surfaced by backend for navigation. */
  entity_type?: 'company' | 'prospect' | null;
  entity_id?: string | null;
  source: string;
  entity_name: string;
  type: string;
  content: string;
  confidence: number;
  /** Round 34 — severity calculé côté backend :
   *  confidence ≥ 90 → critical
   *  ≥ 80 → warning
   *  ≥ 70 → info
   *  < 70 → ok (low / noise)
   */
  severity?: 'critical' | 'warning' | 'info' | 'ok';
  detected_at: string;
}

// =====================================================================
// Round 38 — Chat (conversational agent)
// =====================================================================

export type ChatMessageKind = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  session_id: string;
  kind: ChatMessageKind;
  /** Texte brut, affiché tel quel (ou décompressé en structured view si JSON). */
  content: string;
  /** JSON string : { provider, model, latencyMs } ou { error }. */
  metadata: string | null;
  created_at: string;
}

export interface NetworkStatus {
  isOnline: boolean;
  isSyncing: boolean;
  lastSyncedAt?: string;
}

// =====================================================================
// Round 35 — Outreach (emails AI + state machine)
// =====================================================================

export type EmailTone = 'cold' | 'follow_up' | 'breakup' | 'reply' | 'manual';
export type EmailStatus =
  | 'draft'
  | 'scheduled'
  | 'sent'
  | 'opened'
  | 'replied'
  | 'bounced'
  | 'failed';
export type SequenceStep =
  | 'cold'
  | 'follow_up_1'
  | 'follow_up_2'
  | 'breakup'
  | 'replied'
  | 'bounced';
export type SequenceStatus = 'active' | 'paused' | 'completed' | 'abandoned';

export interface OutreachEmail {
  id: string;
  prospect_id: string;
  company_id: string | null;
  tone: EmailTone;
  subject: string;
  body: string;
  status: EmailStatus;
  sent_at: string | null;
  replied_at: string | null;
  next_action_at: string | null;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachSequence {
  id: string;
  prospect_id: string;
  company_id: string | null;
  campaign_id: string | null;
  current_step: SequenceStep;
  status: SequenceStatus;
  last_email_id: string | null;
  attempts: number;
  last_response_at: string | null;
  next_action_at: string | null;
  context: string | null;
  created_at: string;
  updated_at: string;
}

export interface OutreachSummaryForCompany {
  company_id: string;
  emails: OutreachEmail[];
  sequences: OutreachSequence[];
  total_emails: number;
  total_sent: number;
  total_replied: number;
  total_bounced: number;
  total_active_sequences: number;
}

export interface OutreachTimelineForProspect {
  prospect_id: string;
  emails: OutreachEmail[];
  current_sequence: OutreachSequence | null;
}

export interface EmailDraftOutput {
  subject: string;
  body: string;
  personalization_score: number;
  rationale: string;
  call_to_action: string;
  warnings: string[];
  recommended_next_step: 'cold' | 'follow_up_1' | 'follow_up_2' | 'breakup';
}

// =====================================================================
// Round 35 — Aggregate score (par company)
// =====================================================================

export interface AggregateScoreBreakdown {
  company_score: number;
  prospects_avg: number;
  prospects_count: number;
  intelligence_score: number | null;
  critical_signals: number;
  warning_signals: number;
  replied_emails: number;
  active_outreach_sequences: number;
}

export interface AggregateScore {
  company_id: string;
  score: number;
  breakdown: AggregateScoreBreakdown;
  tier: 'HOT' | 'WARM' | 'COLD';
}

// =====================================================================
// Round 36 — Tasks (notifications + background ops)
// =====================================================================

/**
 * Type discriminant d'une tâche — déclenche le choix d'icône / couleur
 * dans le panneau de notifications. Aligné avec le backend `TaskType`
 * (cf backend/src/modules/tasks/types.ts).
 *
 *   - monitoring_tick   — le watcher a collecté X nouveaux signals.
 *   - auto_sweep        — sweep auto-analysis terminé.
 *   - prospecting       — session de veille sectorielle (ICP) terminée.
 *   - force_analyze     — analyse forcée depuis une fiche Company.
 *   - draft_generation  — X drafts d'email AI ont été générés / persistés.
 *   - manual            — tâche manuelle (debug ou note humaine).
 */
export type TaskType =
  | 'monitoring_tick'
  | 'auto_sweep'
  | 'prospecting'
  | 'force_analyze'
  | 'draft_generation'
  | 'manual';

/** Status du cycle de vie d'une tâche. */
export type TaskStatus = 'running' | 'done' | 'failed';

/** Sévérité de la notification (classe l'item dans la Bell dropdown). */
export type TaskSeverity = 'info' | 'success' | 'warning' | 'error';

/** Forme canonique d'une ligne `tasks` du backend. */
export interface TaskRecord {
  id: string;
  type: TaskType;
  /** Champ est `null` pour les tâches qui ne ciblent pas une entité précise
   *  (ex: sweep global, monitoring watcher). */
  entity_type?: string | null;
  entity_id?: string | null;
  status: TaskStatus;
  severity: TaskSeverity;
  title: string;
  message: string;
  /** Payload brut JSON string (debug); on évite d'inférer la forme. */
  payload?: string | null;
  /** Date ISO du début de la tâche. */
  started_at: string;
  /** Date ISO de fin (`null` tant que `status !== done/failed`). */
  finished_at: string | null;
  /** Date à laquelle l'utilisateur a marqué la notification comme lue. */
  seen_at: string | null;
  /** Dérivé côté front : `Boolean(seen_at)`. */
  seen: boolean;
  /** Lien facultatif vers une page interne (route app) — non stocké
   *  en DB, ajouté par le front lors de la navigation. */
  link?: string | null;
}

/** Compteurs (cf `GET /api/tasks/counts`). */
export interface TaskCounts {
  unseen_done: number;
  unseen_failed: number;
  running: number;
  last_24h_done: number;
  last_24h_failed: number;
  /** Computed total unseen pour badge Bell. */
  unseen?: number;
  /** Computed total 24h pour footer panel. */
  last_24h?: number;
}

/** Réponse du backend pour `GET /api/tasks/heartbeat`. */
export interface HeartbeatStatus {
  /** ISO server time. */
  ts: string;
  /** Uptime du process, en secondes. */
  uptime_s: number;
  /** TZ du serveur (ENV `TZ` ou UTC par défaut). */
  zone: string;
}
