/**
 * NotificationsPanel — Round 36.
 *
 * Dropdown (en bas à droite de l'icône Bell du topbar) qui liste les
 * `tasks` du backend, groupées par jour et cliquables.
 *
 * Sources de données (React Query, poll adaptatif) :
 *   - useTasksQuery({limit: 25})       — la liste d'items.
 *   - useTaskCountsQuery()              — pour le badge rouge unseen.
 *
 * Mutations (invalident automatiquement ces deux queries) :
 *   - useMarkTaskSeenMutation           — retire l'item du unseen count.
 *   - useMarkTasksSeenBulkMutation      — "Tout marquer comme lu".
 *   - useDeleteTaskMutation             — "Dismiss".
 *
 * Comportement :
 *   - Auto-refresh toutes les 25 s en foreground (cf useBackendData → refetchInterval
 *     qui detecte document.hidden).
 *   - Auto-décrément du badge unseen quand on clique sur un item.
 *   - Click sur un item : navigate(item.link) si renseigné, puis il est
 *     marqué seen en arrière-plan (optimistic).
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Check,
  CheckCheck,
  Mail,
  Brain,
  Radar,
  BarChart3,
  Megaphone,
  ScanSearch,
  Sparkles,
  Trash2,
  Activity,
  Clock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useTasksQuery,
  useTaskCountsQuery,
} from '@/hooks/useBackendData';
import {
  useMarkTaskSeenMutation,
  useMarkTasksSeenBulkMutation,
  useDeleteTaskMutation,
} from '@/hooks/useEntityActions';
import type { TaskRecord, TaskSeverity } from '@/types';

// =====================================================================
// Helpers locaux (iconographie + groupement par jour)
// =====================================================================

/**
 * Mapping type → lien interne. Quand l'utilisateur click sur un item
 * sans lien custom, on compute ce mapping.
 *
 *   - monitoring_tick   → /monitoring
 *   - auto_sweep        → /intelligence?tab=prospecting
 *   - prospecting       → /intelligence?tab=prospecting
 *   - force_analyze     → /intelligence?tab=single
 *   - draft_generation  → /intelligence?tab=outreach
 *   - manual            → /
 */
function defaultLinkFor(t: TaskType, entity_id?: string | null): string {
  switch (t) {
    case 'monitoring_tick':
      return '/monitoring';
    case 'auto_sweep':
    case 'prospecting':
      return '/intelligence?tab=prospecting';
    case 'force_analyze':
      return '/intelligence?tab=single';
    case 'draft_generation':
      return '/intelligence?tab=outreach';
    case 'manual':
    default:
      return entity_id ? `/companies/${encodeURIComponent(entity_id)}` : '/';
  }
}

/** Icône + couleur selon le `type`. */
function taskIcon(t: TaskType, _severity?: TaskSeverity): {
  icon: React.ReactNode;
  bg: string;
  text: string;
} {
  const common = 'w-9 h-9 rounded-xl flex items-center justify-center shrink-0';
  switch (t) {
    case 'force_analyze':
      return { icon: <Brain size={16} />, bg: 'bg-emerald-500/15', text: common };
    case 'monitoring_tick':
      return { icon: <Radar size={16} />, bg: 'bg-blue-500/15', text: common };
    case 'draft_generation':
      return { icon: <Mail size={16} />, bg: 'bg-violet-500/15', text: common };
    case 'prospecting':
      return { icon: <Megaphone size={16} />, bg: 'bg-amber-500/15', text: common };
    case 'auto_sweep':
      return { icon: <Sparkles size={16} />, bg: 'bg-pink-500/15', text: common };
    case 'manual':
      return { icon: <Activity size={16} />, bg: 'bg-slate-500/10', text: common };
    default:
      return { icon: <Bell size={16} />, bg: 'bg-slate-500/10', text: common };
  }
}

type TaskType = TaskRecord['type'];

/** Couleur du dot de sévérité (en haut-droite de l'icône). */
function severityDot(severity?: TaskSeverity): string {
  switch (severity) {
    case 'error': return 'bg-red-500';
    case 'warning': return 'bg-amber-500';
    case 'success': return 'bg-emerald-500';
    case 'info':
    default: return 'bg-blue-500';
  }
}

/** Format court d'une date ISO `YYYY-MM-DD` → label de la veille. */
function dayBucketLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Inconnu';
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.floor((startOf(today).getTime() - startOf(d).getTime()) / 86_400_000);
  if (diff <= 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  if (diff < 7) return `Il y a ${diff} jours`;
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Heure locale HH:mm. */
function hhmm(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/** Regroupement `[bucket: string] → items[]` en respectant l'ordre récent → ancien. */
function groupByDay(items: TaskRecord[]): Array<[string, TaskRecord[]]> {
  const map = new Map<string, TaskRecord[]>();
  for (const t of items) {
    const k = dayBucketLabel(t.started_at);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  return Array.from(map.entries());
}

// =====================================================================
// Composant principal
// =====================================================================

export interface NotificationsPanelProps {
  open: boolean;
  onClose: () => void;
}

export const NotificationsPanel: React.FC<NotificationsPanelProps> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const { data: tasks = [], isLoading } = useTasksQuery({ limit: 50 });
  const { data: counts } = useTaskCountsQuery();
  const markSeen = useMarkTaskSeenMutation();
  const markAll = useMarkTasksSeenBulkMutation();
  const dismiss = useDeleteTaskMutation();

  // Click sur un item → marquer seen + naviguer (lien auto-derivé si absent) + fermer
  const handleItemClick = React.useCallback(
    (task: TaskRecord) => {
      if (!task.seen) {
        markSeen.mutate(task.id);
      }
      const link = task.link ?? defaultLinkFor(task.type, task.entity_id);
      navigate(link);
      onClose();
    },
    [markSeen, navigate, onClose],
  );

  const handleMarkAll = React.useCallback(() => {
    const unseenIds = (tasks ?? []).filter((t) => !t.seen).map((t) => t.id);
    if (unseenIds.length === 0) return;
    markAll.mutate(unseenIds);
  }, [markAll, tasks]);

  const handleDismiss = React.useCallback(
    (e: React.MouseEvent, task: TaskRecord) => {
      e.stopPropagation();
      dismiss.mutate(task.id);
    },
    [dismiss],
  );

  // Fermer sur ESC
  React.useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const grouped = groupByDay(tasks);
  // Le backend expose `unseen_done` + `unseen_failed` (cf TaskCounts).
  const unseenCount =
    counts != null
      ? (counts.unseen_done ?? 0) + (counts.unseen_failed ?? 0)
      : tasks.filter((t) => !t.seen).length;
  const hasUnseen = unseenCount > 0;
  const last24h =
    counts != null
      ? (counts.last_24h_done ?? 0) + (counts.last_24h_failed ?? 0)
      : tasks.length;

  return (
    <div
      className={cn(
        'absolute right-4 top-[calc(100%+8px)] z-50 w-[420px] max-w-[calc(100vw-32px)]',
        'rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl shadow-primary/10',
        'overflow-hidden flex flex-col',
        // Animation d'entrée
        'animate-in fade-in slide-in-from-top-2 duration-200',
      )}
      role="dialog"
      aria-label="Notifications Zentara"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-gradient-to-r from-primary/5 via-card/70 to-card">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Bell size={16} className="text-primary" />
            {hasUnseen && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            )}
          </div>
          <span className="font-bold text-sm tracking-tight">Notifications</span>
          <span className="text-xs text-muted-foreground font-mono">
            ({tasks.length} affichées · {unseenCount} non lues)
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!hasUnseen || markAll.isPending}
            onClick={handleMarkAll}
            title="Tout marquer comme lu"
            className={cn(
              'h-8 px-2 rounded-lg text-[10px] font-bold uppercase tracking-wider',
              'inline-flex items-center gap-1.5 border border-border/40',
              hasUnseen
                ? 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                : 'bg-muted/30 text-muted-foreground cursor-not-allowed',
            )}
          >
            <CheckCheck size={12} />
            Tout lire
          </button>
        </div>
      </div>

      {/* Body (liste groupée par jour) */}
      <div className="max-h-[60vh] overflow-y-auto px-2 py-3">
        {isLoading && tasks.length === 0 ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            <Clock size={24} className="opacity-30 mx-auto mb-2" />
            Chargement des notifications…
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-12 text-center">
            <Bell size={32} className="opacity-20 mx-auto mb-3" />
            <div className="text-sm font-medium mb-1">Centre de notifications calme</div>
            <div className="text-xs text-muted-foreground leading-snug">
              Les analyses IA, signals de monitoring et drafts d'email
              apparaîtront ici dès qu'ils se terminent en arrière-plan.
            </div>
          </div>
        ) : (
          grouped.map(([bucket, items]) => (
            <div key={bucket} className="mb-3 last:mb-0">
              {/* Day header */}
              <div className="px-2 mb-1.5 flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {bucket}
                </span>
                <div className="flex-1 h-px bg-gradient-to-r from-border/60 to-transparent" />
                <span className="text-[10px] text-muted-foreground font-mono">
                  {items.length}
                </span>
              </div>
              {/* Items */}
              {items.map((t) => {
                const ic = taskIcon(t.type, t.severity);
                return (
                  <button
                    type="button"
                    key={t.id}
                    onClick={() => handleItemClick(t)}
                    className={cn(
                      'group w-full text-left flex items-start gap-3 px-2.5 py-2.5',
                      'rounded-xl transition-all hover:bg-muted/40 active:scale-[0.99]',
                      !t.seen && 'bg-primary/5',
                      !t.seen && 'border-l-2 border-primary',
                    )}
                    title={t.link ? `Ouvrir → ${t.link}` : 'Notification sans action'}
                  >
                    {/* Icône + dot sévérité */}
                    <div className="relative">
                      <div className={cn(ic.bg, ic.text, 'ring-1 ring-border/40')}>
                        {ic.icon}
                      </div>
                      <span className={cn(
                        'absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border-2 border-card',
                        severityDot(t.severity),
                      )} />
                    </div>

                    {/* Texte */}
                    <div className="flex-1 min-w-0">
                      <div className={cn(
                        'text-xs font-bold truncate',
                        !t.seen && 'text-foreground',
                        t.seen && 'text-muted-foreground',
                      )}>
                        {t.title}
                      </div>
                      <div className="text-[11px] text-muted-foreground leading-snug line-clamp-2 mt-0.5">
                        {t.message}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground/80">
                        <Clock size={9} />
                        <span className="font-mono">{hhmm(t.started_at)}</span>
                        {t.status === 'running' && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-500 font-bold animate-pulse">
                            running
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 rounded bg-muted/60 font-mono">
                          {t.type.split('_').pop()}
                        </span>
                      </div>
                    </div>

                    {/* Actions droite */}
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {t.seen ? (
                        <span title="Lu" className="text-muted-foreground/50">
                          <Check size={11} />
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            markSeen.mutate(t.id);
                          }}
                          title="Marquer comme lu"
                          className={cn(
                            'h-6 w-6 rounded-md inline-flex items-center justify-center',
                            'text-primary hover:bg-primary/15 transition-colors',
                          )}
                        >
                          <Check size={11} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDismiss(e, t)}
                        title="Retirer la notification"
                        className={cn(
                          'h-6 w-6 rounded-md inline-flex items-center justify-center',
                          'text-muted-foreground hover:bg-red-500/10 hover:text-red-500 transition-colors',
                          'opacity-0 group-hover:opacity-100',
                        )}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border/40 bg-muted/30 flex items-center justify-between text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <BarChart3 size={10} />
          {last24h} tâches sur 24h
        </span>
        <span className="font-mono">livré via /api/tasks</span>
      </div>
    </div>
  );
};

export default NotificationsPanel;
