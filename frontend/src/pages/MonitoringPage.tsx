/**
 * MonitoringPage — Round 38.
 *
 * Page surveillance des signaux.
 *
 * Round 38 — Suppression de TOUTES les fausses données hardcodées
 * (ALERTS, TIMELINE_24H, SOURCES) → on lit uniquement la base SQLite
 * via `/api/monitoring`. Si la base est vide, on affiche un état vide
 * honnête : "Aucun signal capté — aucune source réelle branchée".
 *
 * Les signaux proviennent désormais de :
 *   1. Création manuelle via `POST /api/monitoring` (bouton Add).
 *   2. Source réelle externe (à brancher : RSS, Crunchbase, LinkedIn…).
 *
 * L'utilisateur peut toujours :
 *   - Lancer un scan manuel (POST /api/monitoring/scan) → no-op côté backend.
 *   - Watcher status (GET /api/monitoring/status) → indique le mode.
 *   - Consulter sa liste de signaux (vide par défaut).
 */
import React from 'react';
import {
  RefreshCw,
  Loader2,
  Eye,
  Plus,
  Trash2,
  Filter,
  Search,
  Radar,
  Globe,
  Newspaper,
  Users as UsersIcon,
  AlertCircle,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn, safeIncludes } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/contexts/ToastProvider';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useMonitoringQuery } from '@/hooks/useBackendData';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import type { MonitoringSignal } from '@/types';

// =====================================================================
// Helpers
// =====================================================================

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-500 border-red-500/30',
  warning: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  info: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  ok: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
};

const SOURCE_ICON: Record<string, React.ReactNode> = {
  Web: <Globe size={12} />,
  News: <Newspaper size={12} />,
  LinkedIn: <Globe size={12} />,
  Social: <UsersIcon size={12} />,
  Manual: <Plus size={12} />,
};

function fmtTimeAgo(iso: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const dSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (dSec < 60) return `il y a ${dSec}s`;
  if (dSec < 3600) return `il y a ${Math.round(dSec / 60)}m`;
  if (dSec < 86400) return `il y a ${Math.round(dSec / 3600)}h`;
  return `il y a ${Math.round(dSec / 86400)}j`;
}

function fmtHourBucket(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// =====================================================================
// Sub-components
// =====================================================================

const EmptyState: React.FC<{ onAdd?: () => void }> = ({ onAdd }) => (
  <div className="rounded-3xl border-2 border-dashed border-border/40 bg-card/20 p-12 flex flex-col items-center justify-center text-center">
    <Radar size={48} className="text-primary opacity-30 mb-4" />
    <h2 className="text-xl font-black tracking-tight mb-2">Aucune source de signaux branchée</h2>
    <p className="text-sm text-muted-foreground leading-snug max-w-md mb-1">
      Le watcher Zentara tourne mais — aucune intégration RSS / LinkedIn / News n'est configurée.
      Pour l'instant la liste de signaux est vide.
    </p>
    <p className="text-xs text-muted-foreground/70 leading-snug max-w-md mb-5">
      Round 38 — toutes les données de monitoring synthétique ont été supprimées.
      Ajoutez manuellement un signal pour démarrer, ou branchez une source plus tard.
    </p>
    {onAdd && (
      <Button onClick={onAdd} className="bg-primary hover:bg-primary/90 text-primary-foreground">
        <Plus size={14} className="mr-2" /> Ajouter un signal manuellement
      </Button>
    )}
  </div>
);

// =====================================================================
// Main page
// =====================================================================

export const MonitoringPage: React.FC = () => {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: signals = [], isLoading, refetch } = useMonitoringQuery();

  const [sourceFilter, setSourceFilter] = React.useState<'all' | string>('all');
  const [severityFilter, setSeverityFilter] = React.useState<'all' | string>('all');
  const [search, setSearch] = React.useState('');
  const [showAddForm, setShowAddForm] = React.useState(false);

  const scanMut = useMutation({
    mutationFn: async () => {
      const api = getApiClient();
      return api.post<{ success: boolean; data?: { inserted: number; entitiesSeen: number }; meta?: { watcher?: { mode?: string } } }>(
        `${ENDPOINTS.monitoringList}/scan`,
        undefined,
      );
    },
    onSuccess: (r) => {
      toast.info(
        r.meta?.watcher?.mode === 'noop'
          ? 'Watcher tick passé — aucune source réelle branchée (0 signal capté).'
          : `Watcher tick terminé : ${r.data?.inserted ?? 0} signal(aux) inséré(s).`,
        3500,
      );
      void qc.invalidateQueries({ queryKey: ['monitoring'] });
    },
    onError: (e) => toast.error(`Échec scan : ${(e as Error).message}`, 4000),
  });

  const createMut = useMutation({
    mutationFn: async (input: {
      entity_type: 'company' | 'prospect';
      entity_id: string;
      source: string;
      signal_type: string;
      signal: string;
      confidence: number;
    }) => {
      const api = getApiClient();
      return api.post(ENDPOINTS.monitoringList, input);
    },
    onSuccess: () => {
      toast.success('Signal ajouté', 2500);
      setShowAddForm(false);
      void qc.invalidateQueries({ queryKey: ['monitoring'] });
    },
    onError: (e) => toast.error(`Échec : ${(e as Error).message}`, 4000),
  });

  // Round 60 — suppression d'un signal.
  const deleteSignalMut = useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      // Backend : `router.delete('/:id', ...)` sur /api/monitoring.
      return api.delete(ENDPOINTS.monitoringById(id));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['monitoring'] });
    },
  });

  const [pendingDelete, setPendingDelete] = React.useState<MonitoringSignal | null>(null);
  const requestSignalDelete = React.useCallback(
    (s: MonitoringSignal) => setPendingDelete(s),
    [],
  );
  const cancelSignalDelete = React.useCallback(() => setPendingDelete(null), []);
  const confirmSignalDelete = React.useCallback(async () => {
    if (!pendingDelete) return;
    const s = pendingDelete;
    setPendingDelete(null);
    // Le toast d'erreur est émis par DeleteConfirmDialog (round 60 — éviter
    // le double toast si on en émet un ici).
    await deleteSignalMut.mutateAsync(s.id).catch((e: unknown) => {
      throw e;
    });
  }, [pendingDelete, deleteSignalMut]);

  // Liste filtrée.
  const filtered = React.useMemo(() => {
    let out = signals;
    if (sourceFilter !== 'all') out = out.filter((s) => s.source === sourceFilter);
    if (severityFilter !== 'all') out = out.filter((s) => (s.severity ?? 'info') === severityFilter);
    const q = search.toLowerCase().trim();
    if (q) {
      out = out.filter((s) =>
        safeIncludes(s.content, q) ||
        safeIncludes(s.entity_name, q) ||
        safeIncludes(s.type, q),
      );
    }
    return [...out].sort((a, b) => {
      const ta = new Date(a.detected_at ?? '').getTime();
      const tb = new Date(b.detected_at ?? '').getTime();
      return tb - ta;
    });
  }, [signals, sourceFilter, severityFilter, search]);

  // Distribution 24h par bucket (regroupe par tranche de 1h depuis ce matin).
  const todayBuckets = React.useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const buckets = new Array<{ hour: number; count: number; hot: number }>(24);
    for (let h = 0; h < 24; h++) buckets[h] = { hour: h, count: 0, hot: 0 };
    for (const s of (signals ?? [])) {
      const d = new Date(s.detected_at ?? '');
      if (Number.isNaN(d.getTime())) continue;
      if (d < start) continue;
      const h = d.getHours();
      buckets[h].count += 1;
      if ((s.severity ?? 'info') === 'critical') buckets[h].hot += 1;
    }
    return buckets;
  }, [signals]);

  // Sources uniques (calculées depuis les données réelles).
  const uniqueSources = React.useMemo(() => {
    const set = new Set<string>();
    (signals ?? []).forEach((s) => s.source && set.add(s.source));
    return Array.from(set).sort();
  }, [signals]);

  // KPI counts.
  const total = (signals ?? []).length;
  const critical = (signals ?? []).filter((s) => s.severity === 'critical').length;
  const warning = (signals ?? []).filter((s) => s.severity === 'warning').length;
  const info = (signals ?? []).filter((s) => s.severity === 'info').length;

  const hasAnySignal = total > 0;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 pb-20">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Radar size={20} className="text-primary" /> Monitoring
          </h1>
          <p className="text-xs text-muted-foreground">
            Weak signals externes — aucune donnée synthétique. Branchez une source pour alimenter.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => refetch()} variant="outline" size="sm">
            <RefreshCw size={12} className="mr-1" /> Refresh
          </Button>
          <Button onClick={() => scanMut.mutate()} disabled={scanMut.isPending} variant="outline" size="sm">
            {scanMut.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Radar size={12} className="mr-1" />}
            Run watcher tick
          </Button>
          <Button onClick={() => setShowAddForm(true)} size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Plus size={12} className="mr-1" /> Add manual signal
          </Button>
        </div>
      </div>

      {/* KPIs (gate par source vide) */}
      {hasAnySignal && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPI label="Total" value={total} icon={<Radar size={14} />} color="bg-blue-500/15 text-blue-500" />
          <KPI label="Critical" value={critical} icon={<AlertCircle size={14} />} color="bg-red-500/15 text-red-500" />
          <KPI label="Warning" value={warning} icon={<AlertCircle size={14} />} color="bg-amber-500/15 text-amber-500" />
          <KPI label="Info / OK" value={info} icon={<Eye size={14} />} color="bg-emerald-500/15 text-emerald-500" />
        </div>
      )}

      {/* Empty state global quand la liste est vide */}
      {!hasAnySignal && !isLoading && (
        <EmptyState onAdd={() => setShowAddForm(true)} />
      )}

      {/* Filtres + liste */}
      {hasAnySignal && (
        <>
          <div className="rounded-2xl border border-border/60 bg-card/40 p-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              <Filter size={12} className="text-muted-foreground" />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Source</span>
            </div>
            <FilterChip label="all" active={sourceFilter === 'all'} onClick={() => setSourceFilter('all')} />
            {uniqueSources.map((src) => (
              <FilterChip
                key={src}
                label={src}
                icon={SOURCE_ICON[src]}
                active={sourceFilter === src}
                onClick={() => setSourceFilter(src)}
              />
            ))}

            <span className="ml-3 flex items-center gap-1">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Severity</span>
            </span>
            {(['all', 'critical', 'warning', 'info', 'ok'] as const).map((s) => (
              <FilterChip key={s} label={s} active={severityFilter === s} onClick={() => setSeverityFilter(s)} />
            ))}

            <div className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md border border-border/40 bg-background/40 min-w-[180px]">
              <Search size={12} className="text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrer…"
                className="bg-transparent outline-none text-xs flex-1"
              />
            </div>
          </div>

          {/* 24h timeline (calculée depuis données réelles) */}
          {todayBuckets.some((b) => b.count > 0) && (
            <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  Distribution aujourd'hui (calculée en temps réel depuis les signals)
                </div>
              </div>
              <div className="flex items-end gap-1.5 h-32">
                {todayBuckets.map((b) => {
                  const max = Math.max(1, ...todayBuckets.map((x) => x.count));
                  const pct = Math.round((b.count / max) * 100);
                  return (
                    <div key={b.hour} className="flex-1 flex flex-col items-center justify-end gap-1 group">
                      <div className="text-[9px] font-mono opacity-0 group-hover:opacity-100 transition-opacity">{b.count}</div>
                      <div
                        className={cn(
                          'w-full rounded-t transition-all',
                          b.count === 0 ? 'bg-muted/30' : 'bg-gradient-to-t from-primary/60 to-primary',
                        )}
                        style={{ height: `${pct}%` }}
                        title={`${b.hour}h: ${b.count}`}
                      />
                      <div className="text-[9px] font-mono text-muted-foreground">{b.hour}h</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Liste */}
          <div className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden">
            <div className="px-4 py-2.5 bg-muted/30 text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-border/40 grid grid-cols-[2fr_2fr_5fr_2fr_1fr_auto] gap-1">
              <div>Severity</div>
              <div>Source</div>
              <div>Contenu</div>
              <div>Entit\u00e9</div>
              <div className="text-right">Age</div>
              <div></div>
            </div>
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">Aucun signal ne correspond aux filtres.</div>
            ) : (
              <ul className="divide-y divide-border/40">
                {filtered.map((s) => (
                  <li key={s.id} className="px-4 py-3 grid grid-cols-[2fr_2fr_5fr_2fr_1fr_auto] gap-1 items-center text-sm hover:bg-primary/5">
                    <div className="col-span-2">
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border',
                        SEVERITY_COLOR[s.severity ?? 'info'] ?? SEVERITY_COLOR.info,
                      )}>
                        {s.severity ?? 'info'}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center gap-1 text-xs text-muted-foreground">
                      {SOURCE_ICON[s.source ?? 'Web'] ?? SOURCE_ICON.Web}
                      <span className="font-bold">{s.source ?? 'Web'}</span>
                    </div>
                    <div className="col-span-5 min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground truncate">
                        {s.type ?? 'Signal'} · conf. {s.confidence ?? 0}%
                      </div>
                      <div className="text-sm truncate">{s.content ?? '—'}</div>
                    </div>
                    <div className="col-span-2 min-w-0">
                      {s.entity_id ? (
                        <Link
                          to={s.entity_type === 'company' ? `/companies/${encodeURIComponent(s.entity_id)}` : '#'}
                          className="text-xs font-bold text-foreground hover:text-primary truncate block"
                        >
                          {s.entity_name ?? s.entity_id}
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground truncate block">{s.entity_name ?? '—'}</span>
                      )}
                    </div>
                    <div className="col-span-1 text-right text-[10px] font-mono text-muted-foreground">
                      {fmtTimeAgo(s.detected_at ?? '')}
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-500 disabled:opacity-40"
                        disabled={deleteSignalMut.isPending}
                        onClick={() => requestSignalDelete(s)}
                        aria-label={`Supprimer le signal ${s.id}`}
                        title="Supprimer ce signal"
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Add manual signal modal */}
      {showAddForm && (
        <AddSignalForm
          onSubmit={(payload) => createMut.mutate(payload)}
          onClose={() => setShowAddForm(false)}
          isPending={createMut.isPending}
        />
      )}

      {/* Round 60 — confirmation modale de suppression d'un signal */}
      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) cancelSignalDelete(); }}
        itemLabel={
          pendingDelete
            ? (pendingDelete.content ?? pendingDelete.type ?? pendingDelete.id ?? 'signal')
                .toString()
                .slice(0, 80)
            : ''
        }
        entityLabel="signal"
        meta={
          pendingDelete
            ? `${pendingDelete.severity ?? 'info'} · ${pendingDelete.source ?? 'Web'} · conf. ${pendingDelete.confidence ?? 0}%`
            : undefined
        }
        cascades={[
          'Retiré immédiatement du timeline et des KPI',
          'Plus de déclencheurs automatiques liés à ce signal',
        ]}
        onConfirm={confirmSignalDelete}
      />
    </div>
  );
};

// =====================================================================
// Helpers & sub-components  
// =====================================================================

const KPI: React.FC<{ label: string; value: number; icon: React.ReactNode; color: string }> = ({ label, value, icon, color }) => (
  <div className="rounded-2xl border border-border/40 bg-card/40 p-3">
    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center mb-1', color)}>{icon}</div>
    <div className="text-2xl font-black font-mono leading-none">{value}</div>
    <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">{label}</div>
  </div>
);

const FilterChip: React.FC<{
  label: string;
  active: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
}> = ({ label, active, icon, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest transition-colors border',
      active
        ? 'bg-primary text-primary-foreground border-primary'
        : 'border-border/40 text-muted-foreground hover:bg-muted/40',
    )}
  >
    {icon}
    {label}
  </button>
);

const AddSignalForm: React.FC<{
  onSubmit: (input: {
    entity_type: 'company' | 'prospect';
    entity_id: string;
    source: string;
    signal_type: string;
    signal: string;
    confidence: number;
  }) => void;
  onClose: () => void;
  isPending: boolean;
}> = ({ onSubmit, onClose, isPending }) => {
  const [entityType, setEntityType] = React.useState<'company' | 'prospect'>('company');
  const [entityId, setEntityId] = React.useState('');
  const [source, setSource] = React.useState('Manual');
  const [type, setType] = React.useState('Hiring');
  const [content, setContent] = React.useState('');
  const [confidence, setConfidence] = React.useState(85);

  const valid = entityId.trim().length > 0 && content.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="rounded-2xl border border-border/60 bg-card p-6 max-w-2xl w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-black tracking-tight flex items-center gap-2">
            <Plus size={16} className="text-primary" />
            Ajouter un signal manuellement
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fermer">
            <Trash2 size={14} />
          </Button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              entity_type: entityType,
              entity_id: entityId.trim(),
              source: source.trim() || 'Manual',
              signal_type: type.trim() || 'Signal',
              signal: content.trim(),
              confidence,
            });
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type d'entité">
              <select className="w-full bg-background/40 border border-border/40 rounded-md px-2 py-1.5 text-xs"
                value={entityType} onChange={(e) => setEntityType(e.target.value as 'company' | 'prospect')}>
                <option value="company">Company</option>
                <option value="prospect">Prospect</option>
              </select>
            </Field>
            <Field label="Entity ID (id interne)">
              <input
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder={entityType === 'company' ? 'comp_xxxxxxxx' : 'pros_xxxxxxxx'}
                className="w-full bg-background/40 border border-border/40 rounded-md px-2 py-1.5 text-xs font-mono"
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Source">
              <select className="w-full bg-background/40 border border-border/40 rounded-md px-2 py-1.5 text-xs"
                value={source} onChange={(e) => setSource(e.target.value)}>
                {['Manual', 'Web', 'News', 'LinkedIn', 'Social'].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select className="w-full bg-background/40 border border-border/40 rounded-md px-2 py-1.5 text-xs"
                value={type} onChange={(e) => setType(e.target.value)}>
                {['Hiring', 'Expansion', 'Funding', 'Tech adoption', 'Brand mention', 'Executive move',
                  'New product', 'Partnership', 'Activity drop', 'Customer praise', 'Other'].map((s) =>
                  <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label={`Confidence : ${confidence}`}>
              <input
                type="range" min={0} max={100} value={confidence}
                onChange={(e) => setConfidence(Number(e.target.value))}
                className="w-full h-2 mt-3 rounded-full appearance-none bg-muted accent-primary"
              />
            </Field>
          </div>
          <Field label="Contenu du signal (1-3 phrases)">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
              placeholder="Décrivez précisément ce qui s'est passé…"
              className="w-full bg-background/40 border border-border/40 rounded-md px-2 py-1.5 text-xs"
            />
          </Field>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Annuler</Button>
            <Button type="submit" disabled={!valid || isPending} className="bg-primary text-primary-foreground">
              {isPending ? <Loader2 size={12} className="mr-2 animate-spin" /> : <Plus size={12} className="mr-2" />}
              Ajouter
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block">
    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">{label}</div>
    {children}
  </label>
);

// keep monitoringSignal type referenced (avoids "unused import" lint drift)
void ({} as MonitoringSignal);

export default MonitoringPage;
