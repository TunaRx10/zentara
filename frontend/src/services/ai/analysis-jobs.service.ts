// services/ai/analysis-jobs.service.ts — Orchestration des jobs async d'analyse.
//
// Pourquoi ce module existe
//   Avant : POST /api/intelligence/analyze prenait 30-180s et bloquait
//           l'UI (TIMEOUT côté APK). Round 141+ bascule sur POST /api/jobs
//           → réponse immédiate (job_id), puis polling pour la progression.
//           L'utilisateur voit un loader + étapes + bouton cancel.
//
// API publique
//   • createAnalysisJob(entityType, entityId) → job_id
//   • pollJob(jobId, onProgress) → retourne `{status, ...}` à chaque poll
//   • waitForJob(jobId, {onProgress, signal}) → Promise<AnalysisResult>
//   • cancelJob(jobId)
//   • retryJob(jobId) → nouveau job_id
//
// Le watcher poll toutes les `POLL_INTERVAL_MS` (défaut 1.5s).
'use strict';

import { getApiClient } from '../api/client';

export type AnalysisJobStage =
  | 'queued'
  | 'sources'
  | 'engine-calc'
  | 'ai-narrative'
  | 'persisted'
  | 'done';

export interface AnalysisJob {
  id: string;
  entity_type: 'prospect' | 'company';
  entity_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  stage: AnalysisJobStage;
  progress: number; // 0..1
  steps: Array<{ name: string; status: string; updated_at?: string }>;
  result_id: string | null;
  error: string | null;
  provider?: string | null;
  model?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
}

export interface AnalysisResult {
  job_id: string;
  status: 'succeeded' | 'failed' | 'canceled';
  result_id: string | null;
  error: string | null;
  entity_type?: string;
  entity_id?: string;
  poll_url?: string;
}

export interface WaitJobOptions {
  onProgress?: (job: AnalysisJob) => void;
  signal?: AbortSignal | null;
}

export interface CreateJobOptions {
  provider?: string;
  model?: string;
  signal?: AbortSignal | null;
  onProgress?: (job: AnalysisJob) => void;
}

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_DURATION_MS = 240_000; // 4 min hard cap

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((res) => setTimeout(res, ms));
}

interface JobCreated {
  job_id: string;
  poll_url: string;
  status?: string;
  retry_of?: string;
}

/** Crée un job asynchrone et retourne immédiatement `{ job_id, poll_url }`. */
export async function createAnalysisJob(
  entityType: string,
  entityId: string,
  opts: CreateJobOptions = {},
): Promise<JobCreated> {
  const api = getApiClient();
  const data = await api.post<JobCreated>('jobs', {
    entity_type: entityType,
    entity_id: entityId,
    provider: opts.provider || undefined,
    model: opts.model || undefined,
  });
  return { job_id: data.job_id, poll_url: data.poll_url };
}

/** Une itération de poll — pas d'attente interne. */
export async function pollJob(jobId: string): Promise<AnalysisJob> {
  const api = getApiClient();
  return api.get<AnalysisJob>(`jobs/${jobId}`);
}

/** Annule un job (garde le statut courant, arrête le run côté backend). */
export async function cancelJob(jobId: string): Promise<{ ok: boolean; status?: string }> {
  const api = getApiClient();
  return api.post<{ ok: boolean; status?: string }>(`jobs/${jobId}/cancel`, {});
}

/** Relance un job failed/canceled (retourne un nouveau job_id). */
export async function retryJob(jobId: string): Promise<JobCreated> {
  const api = getApiClient();
  const data = await api.post<JobCreated>(`jobs/${jobId}/retry`, {});
  return { job_id: data.job_id, poll_url: data.poll_url };
}

/**
 * Attend la fin d'un job avec callbacks de progression.
 *
 * @param jobId  ID du job
 * @param opts   `{ onProgress, signal }`
 * @returns Promise<AnalysisResult>
 */
export async function waitForJob(jobId: string, opts: WaitJobOptions = {}): Promise<AnalysisResult> {
  const { onProgress, signal } = opts;
  const startedAt = Date.now();
  let lastJob: AnalysisJob | null = null;

  while (true) {
    if (signal?.aborted) {
      return {
        job_id: jobId,
        status: 'canceled',
        result_id: lastJob?.result_id || null,
        error: 'canceled by client',
      };
    }
    if (Date.now() - startedAt > MAX_POLL_DURATION_MS) {
      return {
        job_id: jobId,
        status: 'failed',
        result_id: lastJob?.result_id || null,
        error: 'timeout client (cap 4 min)',
      };
    }

    let job: AnalysisJob;
    try {
      job = await pollJob(jobId);
    } catch {
      // Erreur transitoire (réseau) → on retente après un délai.
      await sleep(800);
      continue;
    }
    lastJob = job;
    if (typeof onProgress === 'function') onProgress(job);

    if (job.status === 'succeeded') {
      return { job_id: jobId, status: 'succeeded', result_id: job.result_id, error: null };
    }
    if (job.status === 'failed') {
      return { job_id: jobId, status: 'failed', result_id: job.result_id, error: job.error };
    }
    if (job.status === 'canceled') {
      return { job_id: jobId, status: 'canceled', result_id: job.result_id, error: job.error };
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/** Helper UI : exécute une analyse avec progression temps-réel.
 *  Combine createAnalysisJob + waitForJob en un seul appel pratique. */
export async function runAnalysisWithProgress(
  entityType: string,
  entityId: string,
  opts: CreateJobOptions = {},
): Promise<AnalysisResult & { entity_type: string; entity_id: string; poll_url: string }> {
  const { job_id, poll_url } = await createAnalysisJob(entityType, entityId, opts);
  const result = await waitForJob(job_id, { signal: opts.signal, onProgress: opts.onProgress });
  return { ...result, entity_type: entityType, entity_id: entityId, poll_url };
}

export default {
  createAnalysisJob,
  pollJob,
  cancelJob,
  retryJob,
  waitForJob,
  runAnalysisWithProgress,
};
