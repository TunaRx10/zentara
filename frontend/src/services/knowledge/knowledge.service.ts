/**
 * Knowledge (RAG) Service frontend — wrapper sur `/api/knowledge/*`.
 *
 * Cette couche gère la base de connaissances personnelle de l'utilisateur
 * utilisée par le pipeline IA pour personnaliser les analyses.
 *
 * Round 8 — sync hybride frontend ↔ backend.
 *
 * Modes :
 *   - ingestNote(text) / ingestDocument(text) → POST /api/knowledge/ingest
 *   - search(query) → POST /api/knowledge/search (cosine similarity)
 *   - getStats() → GET /api/knowledge/stats
 *   - deleteChunk(id) → DELETE /api/knowledge/:id
 *
 * Fallback :
 *   - Si le backend est down → no-op + log silencieux (la base locale
 *     SQLite peut servir pour des usages futurs, mais n'est pas wired ici).
 */
import { getApiClient, ENDPOINTS, ZentaraApiError } from '../api/client';
import type {
  KnowledgeIngestResponse,
  KnowledgeSearchResponse,
  KnowledgeStats,
  KnowledgeSource,
} from '../api/types';

interface IngestOptions {
  source?: KnowledgeSource;
  sourceRef?: string;
  title?: string;
  language?: string;
  tags?: string[];
  kind?: string;
}

export const knowledgeService = {
  /**
   * Ingère un texte libre (note, transcript, article copié-collé, etc.).
   * Le backend applique chunking automatique (TextChunker overlap-aware).
   */
  async ingestNote(content: string, options: IngestOptions = {}): Promise<KnowledgeIngestResponse | null> {
    if (!content?.trim()) return null;
    try {
      const api = getApiClient();
      return await api.post<KnowledgeIngestResponse>(ENDPOINTS.knowledgeIngest, {
        source: options.source ?? 'note',
        source_ref: options.sourceRef,
        title: options.title,
        content,
        metadata: {
          tags: options.tags,
          language: options.language,
          kind: options.kind ?? 'note',
        },
      });
    } catch (err) {
      if (err instanceof ZentaraApiError && (err.code === 'NETWORK_UNAVAILABLE' || err.code === 'TIMEOUT')) {
        return null; // offline : ignore silencieusement
      }
      throw err;
    }
  },

  /**
   * Ingeste un document plus structuré (PDF, URL, doc). Le `content` doit
   * déjà être extrait côté front (futur round : pdf-parse côté RN).
   */
  async ingestDocument(content: string, options: IngestOptions = {}): Promise<KnowledgeIngestResponse | null> {
    return this.ingestNote(content, options);
  },

  /**
   * Recherche par similarité cosinus sur la base de connaissances.
   */
  async search(query: string, options: { limit?: number; minScore?: number } = {}): Promise<KnowledgeSearchResponse | null> {
    if (!query?.trim()) return { query, snippets: [], query_embedding_dim: 256, backend: 'hash-v1', duration_ms: 0 };
    try {
      const api = getApiClient();
      return await api.post<KnowledgeSearchResponse>(ENDPOINTS.knowledgeSearch, {
        query,
        limit: options.limit ?? 5,
        min_score: options.minScore ?? 0,
      });
    } catch (err) {
      if (err instanceof ZentaraApiError && (err.code === 'NETWORK_UNAVAILABLE' || err.code === 'TIMEOUT')) {
        return null;
      }
      throw err;
    }
  },

  /**
   * Stats globales : total chunks, par source, par backend d'embedding.
   */
  async getStats(): Promise<KnowledgeStats | null> {
    try {
      const api = getApiClient();
      return await api.get<KnowledgeStats>(ENDPOINTS.knowledgeStats);
    } catch (err) {
      if (err instanceof ZentaraApiError && (err.code === 'NETWORK_UNAVAILABLE' || err.code === 'TIMEOUT')) {
        return null;
      }
      throw err;
    }
  },

  /** Supprime un chunk par ID. */
  async deleteChunk(id: string): Promise<boolean> {
    try {
      const api = getApiClient();
      await api.delete<null>(ENDPOINTS.knowledgeById(id));
      return true;
    } catch (err) {
      if (err instanceof ZentaraApiError && (err.code === 'NETWORK_UNAVAILABLE' || err.code === 'TIMEOUT')) {
        return false;
      }
      throw err;
    }
  },
};
