// components/AnalysisProgress.tsx — Affichage en temps réel d'un job d'analyse.
//
// Affiche :
//   • Barre de progression (0-100%)
//   • Liste des étapes (sources → engine-calc → ai-narrative → persisted → done)
//   • Status badge (queued/running/succeeded/failed/canceled)
//   • Boutons Cancel (en cours) et Retry (failed/canceled)
//   • ETA optionnelle (basée sur remaining steps)
//   • Lien vers l'analyse complète à la fin
//
// Responsive :
//   - mobile : bouton "Voir le détail" plein-largeur, étape compactée.
//   - desktop : layout horizontal avec timeline détaillée.
//
import * as React from 'react';
import { runAnalysisWithProgress, retryJob, cancelJob } from '@/services/ai/analysis-jobs.service';

const DEFAULT_STEPS = ['sources', 'engine-calc', 'ai-narrative', 'persisted', 'done'];

interface AnalysisJobStep {
  name: string;
  status: string;
  updated_at?: string;
}

interface AnalysisJobView {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';
  stage?: string;
  progress?: number;
  steps?: AnalysisJobStep[];
  error?: string | null;
  result_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
}

interface AnalysisProgressProps {
  isOpen: boolean;
  entityType?: string | null;
  entityId?: string | null;
  autoStart?: boolean;
  onComplete?: (r: Record<string, unknown>) => void;
  onClose?: () => void;
}

type JobResult = {
  job_id: string;
  status: 'succeeded' | 'failed' | 'canceled';
  result_id: string | null;
  error: string | null;
  entity_type?: string;
  entity_id?: string;
  poll_url?: string;
};

function bucketEtaSec(j: AnalysisJobView | null): number {
  // Très grossier : on suppose chaque étape restante ≈ durée moyenne observée.
  const totalEst = 30; // secondes — heuristique
  const stepNames = Array.isArray(j?.steps) && j.steps.length ? j.steps.map((s) => s.name) : DEFAULT_STEPS;
  const done = stepNames.filter((n) => {
    const st = j?.steps?.find((x) => x.name === n)?.status;
    return st === 'done';
  }).length;
  return Math.max(0, Math.round(totalEst * (1 - done / stepNames.length)));
}

function statusLabel(s?: string): string {
  if (s === 'queued') return 'En attente';
  if (s === 'running') return 'En cours';
  if (s === 'succeeded') return 'Terminé';
  if (s === 'failed') return 'Échec';
  if (s === 'canceled') return 'Annulé';
  return s || '—';
}

function statusColor(s?: string): string {
  if (s === 'succeeded') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (s === 'failed') return 'bg-rose-100 text-rose-700 border-rose-200';
  if (s === 'canceled') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (s === 'running') return 'bg-indigo-100 text-indigo-700 border-indigo-200';
  return 'bg-amber-100 text-amber-700 border-amber-200';
}

function stepDot(s?: string): { bg: string; ring: string } {
  if (s === 'done') return { bg: 'bg-emerald-500', ring: 'ring-emerald-200' };
  if (s === 'running' || s === 'in_progress') return { bg: 'bg-indigo-500 animate-pulse', ring: 'ring-indigo-200' };
  return { bg: 'bg-slate-300', ring: 'ring-slate-200' };
}

export function AnalysisProgress({
  isOpen,
  entityType,
  entityId,
  autoStart = true,
  onComplete,
  onClose,
}: AnalysisProgressProps): React.ReactElement | null {
  const [job, setJob] = React.useState<AnalysisJobView | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const startedRunRef = React.useRef(false);

  // Lance l'analyse quand le modal s'ouvre (autoStart).
  React.useEffect(() => {
    if (!isOpen || !entityId || !entityType) return;
    if (startedRunRef.current) return;
    startedRunRef.current = true;
    void runAnalysis(String(entityType), String(entityId));
    return () => { abortRef.current?.abort?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, entityType, entityId, autoStart]);

  async function runAnalysis(type: string, id: string): Promise<void> {
    setError(null);
    setJob(null);
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    try {
      const r = await runAnalysisWithProgress(type, id, {
        signal: abortRef.current.signal,
        onProgress: (j: AnalysisJobView) => setJob(j),
      });
      setJob((prev) => prev || (r as unknown as AnalysisJobView));
      if (r.status === 'succeeded') {
        onComplete?.(r as unknown as Record<string, unknown>);
      } else if (r.status === 'failed') {
        setError(r.error || 'Analyse échouée');
      }
    } catch (e) {
      setError((e as Error)?.message || String(e));
    }
  }

  async function onCancel(): Promise<void> {
    if (!job) return;
    try {
      await cancelJob(job.id);
      abortRef.current?.abort?.();
      setJob((prev) => (prev ? { ...prev, status: 'canceled' } : prev));
    } catch (e) {
      setError(`Cancel failed: ${(e as Error)?.message || e}`);
    }
  }

  async function onRetry(): Promise<void> {
    if (!job) return;
    try {
      const r = await retryJob(job.id);
      setJob({ id: r.job_id, status: 'queued', stage: 'queued', progress: 0, steps: [] });
      // Lance le polling sur le nouveau job
      setError(null);
      const { waitForJob } = await import('@/services/ai/analysis-jobs.service');
      const finalJob = await waitForJob(r.job_id, {
        signal: abortRef.current?.signal,
        onProgress: (j: AnalysisJobView) => setJob(j),
      });
      setJob(finalJob as unknown as AnalysisJobView);
      if (finalJob.status === 'succeeded') onComplete?.({ ...finalJob, job_id: r.job_id } as unknown as Record<string, unknown>);
    } catch (e) {
      setError(`Retry failed: ${(e as Error)?.message || e}`);
    }
  }

  if (!isOpen) return null;

  const stepList: AnalysisJobStep[] = Array.isArray(job?.steps) && job.steps.length
    ? job.steps
    : DEFAULT_STEPS.map((n) => ({ name: n, status: 'pending' as const }));
  const pct = Math.round((job?.progress || 0) * 100);
  const eta = bucketEtaSec(job);
  const stage = job?.stage || 'queued';
  const detailHref = entityType === 'prospect' && entityId
    ? `/prospects/${entityId}`
    : entityId ? `/companies/${entityId}` : '/one';

  return (
    <div
      className="rounded-xl border border-border bg-card shadow-sm p-4 sm:p-6"
      role="dialog"
      aria-label="Progression de l'analyse"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm sm:text-base font-semibold truncate">
            Analyse en cours…
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {entityType === 'prospect' ? 'Prospect' : 'Entreprise'} · {entityId?.slice(0, 12)}…
          </p>
        </div>
        <span className={`px-2.5 py-1 text-xs rounded-full border ${statusColor(job?.status)} whitespace-nowrap`}>
          {statusLabel(job?.status)}
        </span>
      </div>

      {/* BARRE DE PROGRESSION */}
      <div className="mt-4">
        <div className="h-2 w-full bg-secondary/60 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-[width] duration-300"
            style={{ width: `${pct}%` }}
            aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
            role="progressbar"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mt-2">
          <div className="text-xs tabular-nums">{pct}%</div>
          {job?.status === 'running' && eta > 0 && (
            <div className="text-xs text-muted-foreground">~{eta}s restantes (estimation)</div>
          )}
          {job?.status === 'succeeded' && job?.finished_at && (
            <div className="text-xs text-emerald-500">
              Terminé en {Math.round((new Date(job.finished_at).getTime() - (new Date(job.started_at || job.created_at || job.finished_at).getTime())) / 1000)}s
            </div>
          )}
          {job?.status === 'running' && (
            <div className="text-xs text-muted-foreground capitalize">{stage.replace(/_/g, ' ')}</div>
          )}
        </div>
      </div>

      {/* ÉTAPES */}
      <ol className="mt-5 space-y-2">
        {stepList.map((s) => {
          const dot = stepDot(s.status);
          return (
            <li key={s.name} className="flex items-center gap-3">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ring-4 ${dot.bg} ${dot.ring}`} aria-hidden />
              <span className="text-xs sm:text-sm capitalize">{s.name.replace(/_/g, ' ')}</span>
            </li>
          );
        })}
      </ol>

      {/* ERREUR */}
      {error && (
        <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-400">
          {error}
        </div>
      )}

      {/* ACTIONS */}
      <div className="mt-5 flex flex-wrap gap-2">
        {job?.status === 'running' && (
          <button
            type="button"
            onClick={() => void onCancel()}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-border text-muted-foreground hover:bg-secondary/60 w-full sm:w-auto"
          >
            Annuler
          </button>
        )}
        {['failed', 'canceled'].includes(job?.status ?? '') && (
          <button
            type="button"
            onClick={() => void onRetry()}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 w-full sm:w-auto"
          >
            Réessayer
          </button>
        )}
        {job?.status === 'succeeded' && onComplete && (
          <a
            href={detailHref}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 w-full sm:w-auto text-center"
          >
            Voir l'analyse complète
          </a>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-xs sm:text-sm rounded-lg border border-border text-muted-foreground hover:bg-secondary/60 ml-auto w-full sm:w-auto"
          >
            Fermer
          </button>
        )}
      </div>
    </div>
  );
}

export default AnalysisProgress;
