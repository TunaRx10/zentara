/**
 * Constantes des endpoints backend Zentara.
 *
 * Centraliser les paths permet de :
 *  - les réécrire facilement en cas de versioning API,
 *  - partager entre les services (ai, knowledge, sync, etc.)
 *    sans dépendre les uns des autres,
 *  - générer la documentation des routes frontend ↔ backend.
 *
 * Les paths sont RELATIFS à `VITE_API_BASE_URL`. Ce dernier doit
 * **toujours** inclure le préfixe `/api` (cf. `vite-env.d.ts`).
 *
 * Round 8 — sync hybride.
 */
export const ENDPOINTS = {
  // ===== Health / metadata =====
  health: '/health',
  api: '', // GET /api (le router agrégateur)

  // ===== Auth (Round 9 + Round 11 status) =====
  authSetup: '/auth/setup',
  authLogin: '/auth/login',
  authBiometric: '/auth/biometric',
  authRefresh: '/auth/refresh',
  authLogout: '/auth/logout',
  authMe: '/auth/me',
  /** Round 11 — status public (no auth) : `{hasUser, email, name, setupAllowed}`. */
  authStatus: '/auth/status',

  // ===== Prospects =====
  prospectsList: '/prospects',
  prospectById: (id: string) => `/prospects/${encodeURIComponent(id)}`,
  /** Round 92e — suppression des prospects "legacy channels" (avant Round 92c/92d).
   *  Body : `{ company_id?: string, confirm?: boolean }`.
   *  Sans `confirm=true` → preview (count + sample).
   *  Avec `confirm=true`  → commit (delete all matching).
   */
  prospectsCleanLegacyChannels: '/prospects/clean-legacy-channels',

  // ===== Companies =====
  companiesList: '/companies',
  companyById: (id: string) => `/companies/${encodeURIComponent(id)}`,
  /** Round 35 — tous les prospects rattachés à cette company. */
  companyProspects: (id: string) => `/companies/${encodeURIComponent(id)}/prospects`,
  /** Round 35 — score pondéré : companyScore + prospectsAvg + intelligence + signaux. */
  companyAggregateScore: (id: string) => `/companies/${encodeURIComponent(id)}/aggregate-score`,
  /** Round 89 — scrape le site de la company + extrait les personnes (création
   * automatique de prospects). Body : `{ create_prospects?, persist? }`. */
  companyScrapeContacts: (id: string) => `/companies/${encodeURIComponent(id)}/scrape-contacts`,
  /** Round 92 — GET /api/companies/:id/auto-scrape (status) */
  companyAutoScrapeStatus: (id: string) => `/companies/${encodeURIComponent(id)}/auto-scrape`,
  /** Round 92 — PATCH /api/companies/:id/auto-scrape (toggle policy) */
  companyAutoScrape: (id: string) => `/companies/${encodeURIComponent(id)}/auto-scrape`,

  // ===== Contacts =====
  contactsList: '/contacts',
  contactById: (id: string) => `/contacts/${encodeURIComponent(id)}`,

  // ===== Campaigns =====
  campaignsList: '/campaigns',
  campaignById: (id: string) => `/campaigns/${encodeURIComponent(id)}`,
  campaignAddProspect: (id: string) => `/campaigns/${encodeURIComponent(id)}/prospects`,
  campaignRemoveProspect: (id: string, pid: string) =>
    `/campaigns/${encodeURIComponent(id)}/prospects/${encodeURIComponent(pid)}`,

  // ===== Intelligence =====
  /** Compat front : analyse rapide d'une entité (pipeline complet par défaut). */
  analyze: '/intelligence/analyze',
  /** Round 32 : moteur stratégique de prospection (sector → N companies + ICP). */
  prospecting: '/intelligence/prospect',
  /** Round 41 : suivi de l'auto-analyse 7-engines en arrière-plan d'une session. */
  prospectingStatus: (sessionId: string) => `/intelligence/prospect/${encodeURIComponent(sessionId)}/status`,
  /** Pipeline détaillé : 7 engines IA + RAG, prospect(s) + company. */
  pipelineProspect: '/intelligence/pipeline/prospect',
  pipelineCompany: '/intelligence/pipeline/company',
  pipelineQuery: '/intelligence/pipeline/query',
  /** Modes offline (sans provider AI). */
  localProspect: '/intelligence/pipeline/local-prospect',
  localCompany: '/intelligence/pipeline/local-company',
  /** Engines registry. */
  intelligenceEngines: '/intelligence/engines',
  /** CRUD intelligence par entité. */
  intelligenceForEntity: (type: string, id: string) =>
    `/intelligence/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,

  // ===== Knowledge (RAG) =====
  knowledgeIngest: '/knowledge/ingest',
  knowledgeSearch: '/knowledge/search',
  knowledgeStats: '/knowledge/stats',
  knowledgeById: (id: string) => `/knowledge/${encodeURIComponent(id)}`,

  // ===== Search =====
  search: '/search',
  /** Round 134 — annuaires publics d'entreprises. Query: q, sources (CSV), limit. */
  searchExternal: '/search/external',
  searchExternalStatus: '/search/external/status',
  /** Round 134 — import en masse de résultats d'annuaire en companies. */
  searchExternalImport: '/search/external/import',
  /** Round 1 — Zentara One : moteur unifié (companies + people + local). */
  engineStatus: '/engine/status',
  engineSearch: '/engine/search',
  engineJobEmail: '/engine/job-email',
  engineJobEmailSequence: '/engine/job-email-sequence',
  engineJobSave: '/engine/job-save',
  engineJobSaveDraft: '/engine/job-save-draft',

  // ===== Analytics =====
  analyticsOverview: '/analytics/overview',
  analyticsProspects: '/analytics/prospects',
  analyticsCompanies: '/analytics/companies',
  analyticsCampaigns: '/analytics/campaigns',
  analyticsIntelligence: '/analytics/intelligence',
  /**
   * Timeseries journalier cumulatif. Query params : `metric` ∈
   * {hot_prospects, hot_companies, signals, won}, `days` ∈ {7,12,30,60,90}.
   * Réponse : `{metric, days, points: [{date, value}]}`.
   */
  analyticsTimeseries: (metric: string, days = 12) =>
    `/analytics/timeseries?metric=${encodeURIComponent(metric)}&days=${days}`,
  /**
   * Round 54 — liste détaillée des prospects « hot » (score ≥ minScore).
   * Le clic sur la tuile HOT du dashboard ouvre un popover basé sur
   * cette liste. Chaque ligne expose id + name + score + secteur +
   * société (LEFT JOIN companies) + raisons (calculées par le back).
   */
  analyticsHotProspects: (params: { minScore?: number; limit?: number; offset?: number; sector?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.minScore != null) q.set('min_score', String(params.minScore));
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    if (params.sector) q.set('sector', params.sector);
    const qs = q.toString();
    return `/analytics/hot-prospects${qs ? `?${qs}` : ''}`;
  },
  /**
   * Round 58 — liste détaillée des sociétés « hot » (score ≥ minScore)
   * avec LEFT JOIN prospects (count/avg_score/hot_count) + aggregate_score.
   * Complément naturel de analyticsHotProspects : la tuile HOT companies
   * de AICenterPage ouvre un popover basé sur cette liste. Chaque ligne
   * navigue vers `/companies/<id>` (fiche détaillée).
   */
  companiesHotCompanies: (params: { minScore?: number; limit?: number; offset?: number; sector?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.minScore != null) q.set('min_score', String(params.minScore));
    if (params.limit != null) q.set('limit', String(params.limit));
    if (params.offset != null) q.set('offset', String(params.offset));
    if (params.sector) q.set('sector', params.sector);
    const qs = q.toString();
    return `/companies/hot-companies${qs ? `?${qs}` : ''}`;
  },

  // ===== Monitoring =====
  monitoringList: '/monitoring',
  /** Round 60 — DELETE d'un signal monitoring. */
  monitoringById: (id: string) => `/monitoring/${encodeURIComponent(id)}`,

  // ===== Auto-Analysis (Round 33) — sweep 7-engines sur entités scorées =====
  autoAnalysisSweep: '/auto-analysis/sweep',
  autoAnalysisStatus: '/auto-analysis/status',
  /** Round 42 — ids des companies dont l'auto-analyse a échoué récemment. */
  autoAnalysisFailures: '/auto-analysis/failures',
  autoAnalysisLast: '/auto-analysis/last',
  autoAnalysisAnalyzeNow: '/auto-analysis/analyze-now',
  /** Round 43 — enrichissement "Réponse Zentara" d'une company (analyse + prospects + drafts + monitoring). */
  autoAnalysisEnrich: '/auto-analysis/enrich',

  // ===== Outreach (Round 35) — drafts d'emails AI + state machine sequence =====
  /** POST /api/outreach/draft — génère 1 ou 3 drafts (tone=all). Body:
   *   { prospect_id, tone, context?, simulate?, persist? } */
  outreachDraft: '/outreach/draft',
  /** POST /api/outreach/send — body: { email_id, sent_at? } */
  outreachSend: '/outreach/send',
  /** POST /api/outreach/respond — body: { email_id, response, response_text?, end_sequence? } */
  outreachRespond: '/outreach/respond',
  /** GET /api/outreach/company/:id — état agrégé pour CompaniesPage. */
  outreachForCompany: (id: string) => `/outreach/company/${encodeURIComponent(id)}`,
  /** GET /api/outreach/timeline/:prospectId — historique pour un prospect. */
  outreachTimeline: (prospectId: string) =>
    `/outreach/timeline/${encodeURIComponent(prospectId)}`,
  /** GET /api/outreach/inbox — debug. */
  outreachInbox: '/outreach/inbox',

  // ===== Tasks / Notifications (Round 36) — long-running ops log =====
  /** GET /api/tasks?limit=20&since=ISO — tâches accomplies (notifications). */
  tasksList: '/tasks',
  /** GET /api/tasks/counts — compteurs globaux (pour la Bell badge). */
  tasksCounts: '/tasks/counts',
  /** GET /api/tasks/heartbeat — keep-alive session. */
  tasksHeartbeat: '/tasks/heartbeat',
  /** POST /api/tasks/:id/seen — marquer comme lu → ⛔ badge invisible. */
  taskSeen: (id: string) => `/tasks/${encodeURIComponent(id)}/seen`,
  /** POST /api/tasks/seen-bulk — body: {ids: string[]} — tout marquer en masse. */
  tasksSeenBulk: '/tasks/seen-bulk',
  /** DELETE /api/tasks/:id — enlever (rare, debug). */
  taskDelete: (id: string) => `/tasks/${encodeURIComponent(id)}`,

  // ===== Chat (Round 38) — agent conversationnel principal =====
  /** POST /api/chat/send — envoie un message et ré返回e user + assistant. */
  chatSend: '/chat/send',
  /** GET /api/chat/messages?session_id=...&limit=...&since=ISO. */
  chatMessages: '/chat/messages',
  /** GET /api/chat/status — provider courant (gemini / openai / stub). */
  chatStatus: '/chat/status',

  // ===== Contracts (Round 49) — NDA / Quote / ToS AI-draft =====
  /** GET /api/contracts?type=&status=&party_b_id= — liste filtrée. */
  contractsList: '/contracts',
  /** POST /api/contracts/generate — génère un contrat (NDA/QUOTE/TOS) avec AI ou template. */
  contractsGenerate: '/contracts/generate',
  /** POST /api/contracts/auto-draft — interne, déclenché par auto-analysis/watcher. Body: {prospect_id, trigger}. */
  contractsAutoDraft: '/contracts/auto-draft',
  /** GET /api/contracts/catalog — catalogue produits Zentara (pour picker UI). */
  contractsCatalog: '/contracts/catalog',
  /** POST /api/contracts/:id/status — change le statut. Body: {status, notes?}. */
  contractsUpdateStatus: (id: string) => `/contracts/${encodeURIComponent(id)}/status`,
  /** GET /api/contracts/by-party/:partyBId. */
  contractsByParty: (partyBId: string) =>
    `/contracts/by-party/${encodeURIComponent(partyBId)}`,
  /** GET /api/contracts/:id — détail d'un contrat. */
  contractById: (id: string) => `/contracts/${encodeURIComponent(id)}`,

  // ===== Site Design Audit (Round 49) — scraping structurel léger =====
  /** POST /api/design-audit — body: {url} — scrape + audit + AI issues. */
  designAuditCreate: '/design-audit',
  /** Round 68 — POST /api/design-audit/hunt — discovery + audits en série. */
  designAuditHunt: '/design-audit/hunt',
  /** GET /api/design-audit — liste tous les audits triés desc. */
  designAuditList: '/design-audit',
  /** GET /api/design-audit/:id — détail d'un audit. */
  designAuditById: (id: string) => `/design-audit/${encodeURIComponent(id)}`,
  /** GET /api/design-audit/for-company?company_id=… — audits pour une company (par website). */
  designAuditForCompany: (companyId: string) =>
    `/design-audit/for-company/${encodeURIComponent(companyId)}`,
  /** DELETE /api/design-audit/:id. */
  designAuditDelete: (id: string) => `/design-audit/${encodeURIComponent(id)}`,
} as const;

export type EndpointKey = keyof typeof ENDPOINTS;
