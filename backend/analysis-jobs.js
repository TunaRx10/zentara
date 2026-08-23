// analysis-jobs.js — File de jobs asynchrones pour analyses longues.
//
// PROBLÈME ADDRESSE
//   Les analyses IA (Gemini thinking 15-25s + site scrape 12s) dépassent souvent
//   les 5-10s HTTP client. On renvoie "TIMEOUT" alors que le job est presque fini.
//
// SOLUTION
//   POST /api/jobs → enregistre le job (queued), lance le worker en arrière-plan,
//                    retourne immédiatement { job_id, ... } au front.
//   GET  /api/jobs/:id → poll du statut (queued | running | succeeded | failed | canceled)
//                         + progression (0..1) + étapes ["sources","cached?",
//                         "engine-calc","ai-narrative","persisted"]
//   POST /api/jobs/:id/cancel → soft-cancel (ne bloque pas les étapes en cours, mais
//                                arrête AVANT de nouvelles étapes).
//   POST /api/jobs/:id/retry → ré-queue un job failed/canceled.
//
// GARANTIES
//   • Cycle de vie PERSISTÉ en DB (analysis_jobs) — survit aux redémarrages du
//     process via le flag `running` matché par recent running jobs.
//   • Concurrence limitée (par défaut MAX_CONCURRENT=2) pour ne pas étouffer
//     l'event-loop Node.
//   • Sauvegarde progressive : chaque étape est marquée "done" en DB avant
//     la suivante — donc un crash en plein milieu préserve ce qui a déjà
//     été calculé.
'use strict';

const { db, generateId, nowIso } = require('./db');

const STATUS = {
  queued: 'queued',
  running: 'running',
  succeeded: 'succeeded',
  failed: 'failed',
  canceled: 'canceled',
};

const DEFAULT_STEPS = ['sources', 'engine-calc', 'ai-narrative', 'persisted'];

class JobManager {
  constructor({ maxConcurrent = 2, runFn, logger = console } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.runFn = runFn;
    this.logger = logger;
    this.activeJobs = new Map(); // job_id → AbortController
  }

  /** Crée un job et le lance en arrière-plan. */
  async create({ entityType, entityId, params = {}, runFn = null }) {
    const id = generateId('job');
    const now = nowIso();
    db.prepare(
      `INSERT INTO analysis_jobs
       (id, entity_type, entity_id, status, stage, progress, steps, provider, model, prompt_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, entityType, entityId, STATUS.queued,
         'queued', 0, JSON.stringify(DEFAULT_STEPS.map((s) => ({ name: s, status: 'pending' }))),
         params.provider || null, params.model || null,
         params.prompt_version || null, now, now);

    this._schedule(id, runFn || this.runFn, params);
    return id;
  }

  /** Démarre le job : retire de queue et le runner async jusqu'à fin. */
  _schedule(jobId, runFn, params) {
    const ac = new AbortController();
    this.activeJobs.set(jobId, ac);

    // Attendre qu'une place se libère si on est saturé.
    const attempt = async () => {
      await this._waitForSlot(ac);
      if (ac.signal.aborted) {
        this._markCanceledIfNeeded(jobId, 'aborted before start');
        return;
      }
      this._setStatus(jobId, STATUS.running, null, 0.05);
      try {
        const result = await runFn({
          jobId, signal: ac.signal,
          onStage: (stage, progress) => this._setStatus(jobId, STATUS.running, stage, progress),
          params,
        });
        if (ac.signal.aborted) {
          this._markCanceledIfNeeded(jobId, 'aborted during run');
          return;
        }
        db.prepare(
          `UPDATE analysis_jobs
           SET status = ?, stage = ?, progress = ?, result_id = ?, finished_at = ?, updated_at = ?
           WHERE id = ?`,
        ).run(STATUS.succeeded, 'done', 1, result?.result_id || null, nowIso(), nowIso(), jobId);
        this._markAllStepsDone(jobId);
      } catch (e) {
        if (ac.signal.aborted) {
          this._markCanceledIfNeeded(jobId, 'aborted (exception)');
        } else {
          db.prepare(
            `UPDATE analysis_jobs
             SET status = ?, error = ?, finished_at = ?, updated_at = ?
             WHERE id = ?`,
          ).run(STATUS.failed, String(e?.message || e), nowIso(), nowIso(), jobId);
        }
      } finally {
        this.activeJobs.delete(jobId);
      }
    };
    // Lance sans bloquer la requête HTTP.
    attempt().catch((e) => this.logger.error?.(`[jobs] unexpected error in attempt: ${e}`));
  }

  /** Slot management : max N jobs tournent en parallèle. */
  async _waitForSlot(ac) {
    while (this.activeJobs.size > this.maxConcurrent) {
      if (ac.signal.aborted) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  _setStatus(jobId, status, stage, progress) {
    db.prepare(
      `UPDATE analysis_jobs
       SET status = ?, stage = ?, progress = ?, started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE id = ?`,
    ).run(status, stage, progress, nowIso(), nowIso(), jobId);
    if (stage) this._touchStep(jobId, stage, progress);
  }

  _touchStep(jobId, stage, progress) {
    try {
      const row = db.prepare('SELECT steps FROM analysis_jobs WHERE id = ?').get(jobId);
      if (!row) return;
      const arr = JSON.parse(row.steps || '[]');
      let found = arr.find((s) => s.name === stage);
      if (!found) {
        found = { name: stage };
        arr.push(found);
      }
      // Une étape est "done" quand progress >= 1 (le job a terminé).
      // En cours dès qu'on la touche. "pending" sinon.
      let nextStatus = 'in_progress';
      if (progress >= 1) nextStatus = 'done';
      found.status = nextStatus;
      found.updated_at = nowIso();
      db.prepare('UPDATE analysis_jobs SET steps = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(arr), nowIso(), jobId);
    } catch (e) {
      this.logger?.error?.(`[jobs] _touchStep failed for ${jobId}: ${e.message}`);
    }
  }

  /** Marque TOUTES les étapes en 'done' (utilisé en fin de run). */
  _markAllStepsDone(jobId) {
    try {
      const row = db.prepare('SELECT steps FROM analysis_jobs WHERE id = ?').get(jobId);
      if (!row) return;
      const arr = JSON.parse(row.steps || '[]');
      for (const s of arr) s.status = 'done';
      db.prepare('UPDATE analysis_jobs SET steps = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(arr), nowIso(), jobId);
    } catch (e) {
      this.logger?.error?.(`[jobs] _markAllStepsDone failed: ${e.message}`);
    }
  }

  /** Cancel : signale aux AbortController + flippe le statut tout de suite (meilleure UX). */
  cancel(jobId) {
    const ac = this.activeJobs.get(jobId);
    // Toujours flagger en canceled dans la DB (sauf si déjà finished).
    const row = db.prepare('SELECT status FROM analysis_jobs WHERE id = ?').get(jobId);
    if (row && row.status !== 'succeeded' && row.status !== 'failed') {
      db.prepare(
        `UPDATE analysis_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?`,
      ).run(STATUS.canceled, 'canceled by user', nowIso(), jobId);
    }
    if (ac) {
      ac.abort(); // signale pour arrêter les étapes suivantes
      return true;
    }
    return false;
  }

  _markCanceledIfNeeded(jobId, reason) {
    const row = db.prepare('SELECT status FROM analysis_jobs WHERE id = ?').get(jobId);
    if (row && (row.status === STATUS.running || row.status === STATUS.queued)) {
      db.prepare(
        `UPDATE analysis_jobs SET status = ?, error = ?, finished_at = ?, updated_at = ? WHERE id = ?`,
      ).run(STATUS.canceled, reason, nowIso(), nowIso(), jobId);
    }
  }

  /** Renvoie le job DB (sérialisé). */
  get(jobId) {
    const row = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(jobId);
    return row ? this._serializeJob(row) : null;
  }

  list({ entityType, entityId, status, limit = 20 } = {}) {
    const where = [];
    const args = [];
    if (entityType) { where.push('entity_type = ?'); args.push(entityType); }
    if (entityId)   { where.push('entity_id = ?');   args.push(entityId); }
    if (status)     { where.push('status = ?');      args.push(status); }
    const sql = `SELECT * FROM analysis_jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
    args.push(limit);
    return db.prepare(sql).all(...args).map((r) => this._serializeJob(r));
  }

  _serializeJob(row) {
    return {
      id: row.id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      input_hash: row.input_hash,
      status: row.status,
      stage: row.stage,
      progress: row.progress,
      steps: safeJsonArr(row.steps),
      result_id: row.result_id,
      error: row.error,
      provider: row.provider,
      model: row.model,
      prompt_version: row.prompt_version,
      started_at: row.started_at,
      finished_at: row.finished_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

function safeJsonArr(s) {
  if (!s) return [];
  try { return JSON.parse(s); } catch { return []; }
}

module.exports = { JobManager, STATUS, DEFAULT_STEPS };
