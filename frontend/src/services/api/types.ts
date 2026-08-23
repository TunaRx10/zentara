/**
 * Types miroirs des schémas backend Zentara.
 *
 * Plutôt que de parser dynamiquement Zod côté front à chaque appel,
 * on déclare ici des interfaces qui doivent rester alignées avec les
 * schémas Zod côté backend (cf. `backend/src/services/ai/engines/types.ts`
 * et `backend/src/services/knowledge/*.ts`).
 *
 * Round 8 — sync hybride : ces types sont la source de vérité front
 * pour les payloads IA/RAG/knowledge.
 */

export interface IntelligenceScore {
  relevance: number;
  opportunity: number;
  intent: number;
  activity: number;
  confidence: number;
}

export type KnowledgeSource = 'note' | 'pdf' | 'url' | 'doc' | 'manual';

export interface KnowledgeChunkMeta {
  tags?: string[];
  language?: string;
  kind?: string;
}

export interface KnowledgeChunk {
  id: string;
  source: KnowledgeSource;
  source_ref?: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  chunk_index?: number;
  created_at: string;
}

/** Réponse de `POST /api/knowledge/search`. */
export interface KnowledgeSearchSnippet {
  title: string;
  snippet: string;
  score: number; // 0..1 (cosine similarity)
  source: KnowledgeSource;
  source_ref?: string | null;
  chunk_id?: string;
}

export interface KnowledgeSearchResponse {
  query: string;
  snippets: KnowledgeSearchSnippet[];
  query_embedding_dim: number; // 256. exposé par backend.
  backend: 'hash-v1';
  duration_ms: number;
}

/** Réponse de `POST /api/knowledge/ingest`. */
export interface KnowledgeIngestResponse {
  chunk_ids: string[];
  chunk_count: number;
  dim: number;
  embedding_backend: 'hash-v1';
}

/** Réponse de `GET /api/knowledge/stats`. */
export interface KnowledgeStats {
  total: number;
  by_source: Record<KnowledgeSource, number>;
  by_kind: Record<string, number>;
  dim: number;
  embedding_backend: 'hash-v1';
  total_chars: number;
}

/**
 * Forme canonique des analyses IA renvoyées par la façade
 * `POST /api/intelligence/analyze` (Round 8) côté backend.
 *
 * C'est la forme consommée par `AICenterPage`, `useAnalysis`,
 * et persiste localement dans SQLite (`ai_analysis` + `intelligence`).
 */
export interface IntelligenceAnalysisResponse {
  id: string;
  entity_type: 'prospect' | 'company';
  entity_id: string;
  summary: string;
  insights: string[];
  recommendations: string[];
  risks: string[];
  scores: IntelligenceScore;
  /** 'pipeline-v1' (8 engines) | 'heuristic-local-v1' | 'legacy'. */
  source: string;
  cached: boolean;
  /** Si true : analyse tronquée par cascade conditionnelle. */
  truncated_by_cascade: boolean;
  engines_run: string[];
  /** Payload brut retourné par le backend (debug/audit). */
  raw_response?: unknown;
}

export interface IntelligenceAnalysisMeta {
  provider: string;
  ai_analysis_id?: string;
  cached: boolean;
  truncated_by_cascade: boolean;
  engines_run: string[];
}
