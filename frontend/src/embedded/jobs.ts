/**
 * jobs.ts — Worker de jobs d'analyse LOCAL (moteur embarqué).
 *
 * Miroir du `analysis-jobs.js` backend, mais 100 % in-app :
 *   POST /api/jobs           → queued, réponse immédiate
 *   GET  /api/jobs/:id       → poll (status, stage, progress, steps)
 *   POST /api/jobs/:id/cancel→ cancel immédiat
 *   POST /api/jobs/:id/retry → ré-queue un nouveau job
 *
 * Étapes : sources → engine-calc → ai-narrative → persisted.
 * Chaque étape est persistée avant la suivante (crash-safe).
 */
import { embStore, genId, nowIso } from './store';
import { buildAnalysisRecord, buildEmailDraft } from './scoring';

export const JOB_STEPS = ['sources', 'engine-calc', 'ai-narrative', 'persisted'];

export interface LocalJobStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  updated_at?: string;
}

export interface LocalJob {
  id: string;
  entity_type: 'company' | 'prospect';
  entity_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  stage: string;
  progress: number; // 0..1
  steps: LocalJobStep[];
  result_id: string | null;
  error: string | null;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

function persist(job: LocalJob): void {
  embStore.upsert('jobs', job);
}

export function getJob(id: string): LocalJob | undefined {
  return embStore.get<LocalJob>('jobs', id);
}

export function listJobs(limit = 30): LocalJob[] {
  return embStore
    .list<LocalJob>('jobs')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}

export function createLocalJob(
  entityType: 'company' | 'prospect',
  entityId: string,
  params: { provider?: string; model?: string } = {},
): string {
  const now = nowIso();
  const job: LocalJob = {
    id: genId('job'),
    entity_type: entityType,
    entity_id: entityId,
    status: 'queued',
    stage: 'queued',
    progress: 0,
    steps: JOB_STEPS.map((s) => ({ name: s, status: 'pending' })),
    result_id: null,
    error: null,
    provider: params.provider ?? 'local-deterministic',
    model: params.model ?? 'scoring-v1',
    prompt_version: 'embedded-v1',
    started_at: null,
    finished_at: null,
    created_at: now,
    updated_at: now,
  };
  persist(job);
  setTimeout(() => void runJob(job.id), 40);
  return job.id;
}

export function cancelLocalJob(id: string): boolean {
  const j = getJob(id);
  if (!j) return false;
  if (j.status === 'succeeded' || j.status === 'failed') return false;
  j.status = 'canceled';
  j.error = 'canceled by user';
  j.finished_at = nowIso();
  j.updated_at = nowIso();
  j.steps = j.steps.map((s) => ({ ...s, status: s.status === 'running' ? 'failed' : s.status }));
  persist(j);
  return true;
}

export function retryLocalJob(id: string): string | null {
  const j = getJob(id);
  if (!j) return null;
  return createLocalJob(j.entity_type, j.entity_id, { provider: j.provider ?? undefined, model: j.model ?? undefined });
}

function setStage(jobId: string, status: LocalJob['status'], stage: string, progress: number): void {
  const j = getJob(jobId);
  if (!j || j.status === 'canceled') return;
  j.status = status;
  j.stage = stage;
  j.progress = progress;
  const stageIdx = JOB_STEPS.indexOf(stage);
  j.steps = JOB_STEPS.map((s, i) => ({
    name: s,
    status: i < stageIdx ? 'done' : i === stageIdx ? (status === 'failed' ? 'failed' : 'running') : 'pending',
    updated_at: nowIso(),
  }));
  j.updated_at = nowIso();
  if (status === 'running' && !j.started_at) j.started_at = j.updated_at;
  if (status === 'failed' || status === 'succeeded' || status === 'canceled') j.finished_at = j.updated_at;
  persist(j);
}

function failJob(jobId: string, error: string): void {
  const j = getJob(jobId);
  if (!j) return;
  j.status = 'failed';
  j.error = error;
  j.finished_at = nowIso();
  j.updated_at = nowIso();
  j.steps = j.steps.map((s) => ({ ...s, status: s.status === 'running' ? 'failed' : s.status }));
  persist(j);
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function runJob(jobId: string): Promise<void> {
  const j0 = getJob(jobId);
  if (!j0 || j0.status === 'canceled') return;

  setStage(jobId, 'running', 'sources', 0.2);
  const entity = j0.entity_type === 'company'
    ? embStore.get('companies', j0.entity_id)
    : embStore.get('prospects', j0.entity_id);
  if (!entity) {
    failJob(jobId, `Entité ${j0.entity_type}/${j0.entity_id} introuvable dans la base locale`);
    return;
  }
  await delay(60);
  if (getJob(jobId)?.status === 'canceled') return;

  setStage(jobId, 'running', 'engine-calc', 0.45);
  let analysis: ReturnType<typeof buildAnalysisRecord>;
  try {
    analysis = buildAnalysisRecord(j0.entity_type, j0.entity_id, entity as any, {});
  } catch (e) {
    failJob(jobId, `engine-calc: ${String((e as Error)?.message ?? e)}`);
    return;
  }
  await delay(60);
  if (getJob(jobId)?.status === 'canceled') return;

  setStage(jobId, 'running', 'ai-narrative', 0.7);
  const { record, aggregate } = analysis;
  let email;
  try {
    email = buildEmailDraft(entity as any, aggregate);
  } catch (e) {
    email = { subject: '', html: '', body: '', cta_url: '', template_id: '' };
  }
  await delay(60);
  if (getJob(jobId)?.status === 'canceled') return;

  setStage(jobId, 'running', 'persisted', 0.9);
  try {
    embStore.upsert('intelligence', {
      ...record,
      email_subject: email.subject,
      email_html: email.html,
      email_body: email.body,
      email_cta_url: email.cta_url,
    });
    embStore.upsert('emails', {
      id: genId('eml'),
      prospect_id: j0.entity_type === 'prospect' ? j0.entity_id : null,
      company_id: j0.entity_type === 'company' ? j0.entity_id : null,
      subject: email.subject,
      body: email.body,
      html: email.html,
      status: 'draft',
      tone: 'outreach',
      template_id: email.template_id,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    embStore.upsert('breakdowns', {
      id: genId('brk'),
      input_hash: record.input_hash,
      entity_type: j0.entity_type,
      entity_id: j0.entity_id,
      breakdown: analysis.breakdown,
      aggregate,
      computed_at: nowIso(),
    });
  } catch (e) {
    failJob(jobId, `persisted: ${String((e as Error)?.message ?? e)}`);
    return;
  }

  const j = getJob(jobId);
  if (!j || j.status === 'canceled') return;
  j.status = 'succeeded';
  j.stage = 'done';
  j.progress = 1;
  j.result_id = record.id;
  j.finished_at = nowIso();
  j.updated_at = nowIso();
  j.steps = JOB_STEPS.map((s) => ({ name: s, status: 'done', updated_at: nowIso() }));
  persist(j);
}
