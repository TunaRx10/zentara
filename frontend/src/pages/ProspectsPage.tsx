/**
 * ProspectsPage — Lead Finder (Olivine pattern).
 *
 * Round 24 — rend chaque bouton opérationnel :
 *  - Add Prospect → modal de création → POST /api/prospects
 *  - Run AI analysis (Zap) → POST /api/intelligence/analyze
 *  - Delete → DELETE /api/prospects/:id (optimistic)
 *  - Filters/Sort → toggles réellement branchés sur la liste
 * Round 27 — suppression du Toast bar local au profit de useToast() global.
 */
import React from 'react';
import {
  Search,
  Plus,
  Mail,
  Phone,
  MapPin,
  Building2,
  Trash2,
  Zap,
  ArrowUpDown,
  CheckCircle2,
  Circle,
  X,
  Loader2,
  ArrowDownAZ,
  ArrowUpAZ,
  ArrowDown01,
  Sparkles,
  LayoutGrid,
  List,
} from 'lucide-react';
import { useProspects } from '@/hooks/useProspects';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import {
  useDeleteProspectMutation,
  useCreateProspectMutation,
  useUpdateProspectMutation,
  useAnalyzeMutation,
  useCleanLegacyProspectsMutation,
} from '@/hooks/useEntityActions';
import { AddProspectModal } from '@/components/AddProspectModal';
import { useShowMore } from '@/hooks/useShowMore';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useProspectsQuery } from '@/hooks/useBackendData';
import type { ProspectWithSync } from '@/hooks/useProspects';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useToast } from '@/contexts/ToastProvider';
import { cn, toDateMs, safeIncludes, parseQuality } from '@/lib/utils';
import {
  TierPill,
  ScoreCell,
  TierFilterChip,
  countByTier,
  getTier,
  type Tier,
} from '@/components/LeadTier';
import type { Prospect } from '@/types';

function initialsOf(p: { first_name?: string; last_name?: string }): string {
  return `${p.first_name?.[0] ?? '?'}${p.last_name?.[0] ?? ''}`.toUpperCase();
}

// =====================================================================
// Round 57 — FocusHighlightBanner
// ---------------------------------------------------------------------
//  Bandeau affiché en haut du tableau lorsqu'on arrive via
//  `/prospects?focus=pros_xxx` (drill-down depuis AI Center).
//  Bouton "Clear" pour effacer le focus du query string sans reload.
// =====================================================================
function FocusHighlightBanner({
  prospect,
  onClear,
}: {
  prospect: Prospect | null;
  onClear: () => void;
}): React.ReactElement | null {
  if (!prospect) return null;
  return (
    <div className="rounded-xl border-2 border-amber-500/50 bg-amber-500/10 backdrop-blur-md px-4 py-3 shadow-lg shadow-amber-500/20 flex items-center gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="inline-flex w-10 h-10 rounded-lg bg-amber-500/30 border border-amber-500/60 items-center justify-center">
        <Search size={18} className="text-amber-300" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-base font-bold text-amber-200">
          Focus depuis l'AI Center : {prospect.first_name} {prospect.last_name}
        </div>
        <div className="text-[12px] text-amber-300/80">
          {prospect.email && <span className="font-mono mr-2">{prospect.email}</span>}
          {prospect.sector && <span className="mr-2">· {prospect.sector}</span>}
          {typeof prospect.score === 'number' && (
            <span className="font-black">· score {prospect.score}/100</span>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="text-amber-300 hover:text-amber-200 hover:bg-amber-500/20 border border-amber-500/40"
      >
        <X size={14} className="mr-1" /> Clear focus
      </Button>
    </div>
  );
}

// =====================================================================
// Page principale
// AddProspectModal est importé depuis @/components/AddProspectModal (auto-fill contacts)
// =====================================================================

type SortKey = 'score-desc' | 'score-asc' | 'name-asc' | 'name-desc' | 'date-desc';
type StatusFilter = 'all' | Prospect['status'];

const SORT_OPTIONS: Array<{ id: SortKey; label: string; icon: React.ReactNode }> = [
  { id: 'score-desc', label: 'Score ↓', icon: <ArrowDown01 size={12} /> },
  { id: 'score-asc', label: 'Score ↑', icon: <ArrowDown01 size={12} className="rotate-180" /> },
  { id: 'name-asc', label: 'A → Z', icon: <ArrowDownAZ size={12} /> },
  { id: 'name-desc', label: 'Z → A', icon: <ArrowUpAZ size={12} /> },
  { id: 'date-desc', label: 'Plus récents', icon: <ArrowDown01 size={12} /> },
];

const STATUS_OPTIONS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'Tous' },
  { id: 'new', label: 'Nouveau' },
  { id: 'qualified', label: 'Qualifié' },
  { id: 'contacted', label: 'Contacté' },
  { id: 'interested', label: 'Intéressé' },
  { id: 'converted', label: 'Converti' },
  { id: 'lost', label: 'Perdu' },
];

// =====================================================================
// Round 133 — Pipeline Kanban (drag & drop, inspiré Twenty)
// ---------------------------------------------------------------------
//  Vue "board" du Lead Finder : 6 colonnes alignées sur l'enum backend
//  `ProspectStatus`. Glisser-déposer natif HTML5 (aucune dépendance).
//  Chaque drop déclenche `onMove(id, status)` → PUT /api/prospects/:id.
// =====================================================================

type KanbanColumnId = 'new' | 'qualified' | 'contacted' | 'interested' | 'converted' | 'lost';

const KANBAN_COLUMNS: Array<{
  id: KanbanColumnId;
  label: string;
  dot: string;
  header: string;
}> = [
  { id: 'new', label: 'Nouveau', dot: 'bg-slate-400', header: 'text-slate-300' },
  { id: 'qualified', label: 'Qualifié', dot: 'bg-emerald-500', header: 'text-emerald-400' },
  { id: 'contacted', label: 'Contacté', dot: 'bg-primary', header: 'text-primary' },
  { id: 'interested', label: 'Intéressé', dot: 'bg-amber-500', header: 'text-amber-400' },
  { id: 'converted', label: 'Converti', dot: 'bg-emerald-400', header: 'text-emerald-400' },
  { id: 'lost', label: 'Perdu', dot: 'bg-red-500', header: 'text-red-400' },
];

function ProspectKanban({
  prospects,
  onMove,
}: {
  prospects: Prospect[];
  onMove: (id: string, status: KanbanColumnId) => void;
}): React.ReactElement {
  const navigate = useNavigate();
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = React.useState<KanbanColumnId | null>(null);

  const byStatus = React.useMemo(() => {
    const map: Record<KanbanColumnId, Prospect[]> = {
      new: [],
      qualified: [],
      contacted: [],
      interested: [],
      converted: [],
      lost: [],
    };
    for (const p of prospects) {
      const s = (p.status ?? 'new') as KanbanColumnId;
      if (s in map) map[s].push(p);
      else map.new.push(p);
    }
    for (const k of Object.keys(map) as KanbanColumnId[]) {
      map[k].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    }
    return map;
  }, [prospects]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 pb-2">
      {KANBAN_COLUMNS.map((col) => {
        const items = byStatus[col.id];
        const isOver = dragOverCol === col.id;
        return (
          <div
            key={col.id}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOverCol !== col.id) setDragOverCol(col.id);
            }}
            onDragLeave={(e) => {
              if (e.currentTarget === e.target) setDragOverCol(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              setDragOverCol(null);
              setDraggingId(null);
              if (id) onMove(id, col.id);
            }}
            className={cn(
              'rounded-xl border bg-card/40 min-h-[200px] flex flex-col transition-colors',
              isOver
                ? 'border-primary/70 bg-primary/5 ring-2 ring-primary/30'
                : 'border-border/60',
            )}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/40">
              <span className={cn('w-2 h-2 rounded-full', col.dot)} />
              <span
                className={cn(
                  'text-[11px] font-black uppercase tracking-wider',
                  col.header,
                )}
              >
                {col.label}
              </span>
              <span className="ml-auto text-[11px] font-bold text-muted-foreground tabular-nums">
                {items.length}
              </span>
            </div>
            <div className="flex-1 p-2 space-y-2">
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/50 h-20 flex items-center justify-center text-[11px] text-muted-foreground/60">
                  Vide
                </div>
              ) : (
                items.map((p) => {
                  const t = getTier(p.score);
                  const q = parseQuality(p.quality);
                  const isLowConfidence = q.overall < 0.5;
                  const isDragging = draggingId === p.id;
                  return (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/plain', p.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDraggingId(p.id);
                      }}
                      onDragEnd={() => setDraggingId(null)}
                      onClick={() => navigate(`/prospects/${p.id}`)}
                      className={cn(
                        'rounded-lg border border-border/50 bg-card/80 p-2.5 cursor-grab active:cursor-grabbing hover:border-primary/40 hover:bg-card transition-all',
                        isDragging && 'opacity-40 ring-2 ring-primary/40',
                        isLowConfidence && 'grayscale opacity-55 hover:opacity-80',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className={cn(
                            'w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black shrink-0',
                            t === 'hot'
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : t === 'warm'
                                ? 'bg-amber-500/15 text-amber-500'
                                : 'bg-slate-500/15 text-slate-400',
                          )}
                        >
                          {initialsOf(p)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold truncate">
                            {p.first_name} {p.last_name}
                          </div>
                          {p.email && (
                            <div className="text-[10px] text-muted-foreground truncate">
                              {p.email}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <TierPill tier={t} />
                        <ScoreCell score={p.score ?? 0} />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProspectsPage(): React.ReactElement {
  const { prospects: localProspects, isLoading: isLocalLoading, removeProspect, refetch: localRefetch } = useProspects();
  // Round 57 — backend React Query (autoritaire pour la DB web ; ne casse pas offline-first).
  const { data: backendProspects = [], isFetching: isBackendFetching, refetch: backendRefetch } = useProspectsQuery();
  // Round 57 — drill-down support : ?focus=pros_xxx depuis l'URL.
  // - `focusId`        : id du prospect ciblé par l'AI Center (depuis query string)
  // - `focusedProspect`: prospect résolu (objet complet) ou null
  // - `focusClearedAt` : Date.now() au moment où on a volontairement cleared le focus
  //                      (pour éviter que useEffect rescroll après clear)
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const focusId = searchParams.get('focus');
  const [focusClearedAt, setFocusClearedAt] = React.useState<number | null>(null);

  // Round 57 — fusion local + backend. Backend gagne si présent (source de vérité
  // pour le contexte web), local-only items conservés quand backend absent. Cette
  // fusion rend la page réellement fonctionnelle même quand jeep-sqlite échoue.
  const prospects = React.useMemo<ProspectWithSync[]>(() => {
    const byId = new Map<string, ProspectWithSync>();
    for (const p of backendProspects as Prospect[]) {
      byId.set(p.id, { ...p, _sync: 'synced' });
    }
    for (const p of localProspects) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
    return Array.from(byId.values());
  }, [localProspects, backendProspects]);
  const isLoading = isLocalLoading && isBackendFetching && prospects.length === 0;
  const { isOnline } = useNetworkStatus();
  const deleteProspect = useDeleteProspectMutation();
  const updateProspect = useUpdateProspectMutation();
  const analyzeMut = useAnalyzeMutation();
  const cleanLegacy = useCleanLegacyProspectsMutation();
  const toast = useToast();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [tierFilter, setTierFilter] = React.useState<Tier | 'all'>('all');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const [sortKey, setSortKey] = React.useState<SortKey>('score-desc');
  const [addOpen, setAddOpen] = React.useState(false);
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [sortMenuOpen, setSortMenuOpen] = React.useState(false);
  // Round 133 — vue Table / Board (pipeline Kanban).
  const [view, setView] = React.useState<'table' | 'board'>('table');
  // Round 92e — clean dialog state (3 phases: idle → preview → commit).
  const [cleanPreview, setCleanPreview] = React.useState<{
    matched: number;
    sample: Array<{
      id: string;
      email: string | null;
      first_name: string;
      last_name: string;
      company_id: string | null;
    }>;
  } | null>(null);
  const [cleanOpen, setCleanOpen] = React.useState(false);

  // 1) Click "Clean" → call API in preview mode, store result, open dialog.
  const handleCleanPreview = async () => {
    try {
      const data = await cleanLegacy.mutateAsync({ confirm: false });
      setCleanPreview({ matched: data.matched, sample: data.sample });
      setCleanOpen(true);
      if (data.matched === 0) {
        toast.info('Aucun prospect legacy détecté. Base déjà propre ✅');
      }
    } catch (e) {
      toast.error(`Prévisualisation impossible : ${(e as Error).message}`);
    }
  };

  // 2) User typed SUPPRIMER → call API in commit mode, close dialog, toast.
  const handleCleanCommit = async () => {
    try {
      const data = await cleanLegacy.mutateAsync({ confirm: true });
      setCleanOpen(false);
      setCleanPreview(null);
      const n = data.deleted ?? 0;
      toast.success(
        n > 0
          ? `🧹 ${n} prospect${n > 1 ? 's' : ''} legacy supprimé${n > 1 ? 's' : ''}.`
          : 'Aucun prospect supprimé.',
      );
    } catch (e) {
      toast.error(`Suppression impossible : ${(e as Error).message}`);
    }
  };

  const filtered = React.useMemo(() => {
    const q = searchQuery.toLowerCase();
    return prospects
      .filter((p) => {
        const matchesQ =
          !q ||
          safeIncludes(`${p.first_name ?? ''} ${p.last_name ?? ''}`, q) ||
          safeIncludes(p.email, q) ||
          safeIncludes(p.sector, q);
        const matchesTier = tierFilter === 'all' || getTier(p.score) === tierFilter;
        const matchesStatus = statusFilter === 'all' || (p.status ?? 'new') === statusFilter;
        return matchesQ && matchesTier && matchesStatus;
      })
      .sort((a, b) => {
        switch (sortKey) {
          case 'score-desc':
            return (b.score ?? 0) - (a.score ?? 0);
          case 'score-asc':
            return (a.score ?? 0) - (b.score ?? 0);
          case 'name-asc':
            return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
          case 'name-desc':
            return `${b.first_name} ${b.last_name}`.localeCompare(`${a.first_name} ${a.last_name}`);
          case 'date-desc':
            return toDateMs(b.created_at) - toDateMs(a.created_at);
          default:
            return 0;
        }
      });
  }, [prospects, searchQuery, tierFilter, statusFilter, sortKey]);

  const counts = React.useMemo(() => countByTier(prospects.map((p) => p.score)), [prospects]);

  // Round 25 — pagination 5 par « page » via bouton Load more.
  // Se reset automatiquement quand le filtre/tri/search changent.
  //
  // Round 57 — drill-down override : `setVisibleCount` permet de sauter
  // directement à N items visibles (jump-to-index) quand un ?focus= cible
  // une ligne au-delà de la page courante (par ex. prospect #22).
  const { visible: paged, hasMore, showMore, setVisibleCount, shown, total: filteredTotal } = useShowMore(
    filtered,
    5,
  );

  // Round 57 — résolve focused prospect et index dans la liste filtrée.
  // Si le focus pointe vers un prospect qui n'existe pas en base, `focusedProspect`
  // reste `null` et le banner n'est pas affiché (l'utilisateur voit juste la liste).
  const focusedProspect = React.useMemo(() => {
    if (!focusId) return null;
    return prospects.find((p) => p.id === focusId) ?? null;
  }, [prospects, focusId]);
  const focusedIndexInFiltered = React.useMemo(() => {
    if (!focusId) return -1;
    return filtered.findIndex((p) => p.id === focusId);
  }, [filtered, focusId]);
  const focusedVisibleInPaged = focusedIndexInFiltered >= 0 && focusedIndexInFiltered < paged.length;

  // Round 57 — référence DOM par id pour scrollIntoView sans rerender.
  const focusRowRef = React.useRef<HTMLTableRowElement | null>(null);
  // Round 57 — `focusActive` reste true tant que le highlight est visible (~3.5s).
  const [focusActive, setFocusActive] = React.useState(false);

  // Round 57 — auto-expand pagination until focused row visible,
  // then scroll + highlight. Se redéclenche si le focus change OU
  // si l'utilisateur tape reload (l'URL conserve le focus).
  React.useEffect(() => {
    if (!focusId) return;
    if (focusClearedAt && Date.now() - focusClearedAt < 200) return;
    if (focusedIndexInFiltered < 0) return;
    const targetIndex = focusedIndexInFiltered;
    // Étape 1 : si la ligne est hors page (par ex. prospect #22 → 22 > 5),
    // sauter directement à `targetIndex + 1` items visibles via le setter
    // direct de useShowMore (R57 — évite N cascades de showMore()).
    if (targetIndex + 1 > paged.length) {
      setVisibleCount(targetIndex + 1);
      return; // Le re-render suivant re-déclenche cet effect avec paged étendu.
    }
    // Étape 2 : la ligne est visible, scroller + highlight.
    setFocusActive(true);
    const t = setTimeout(() => {
      focusRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 60);
    // Étape 3 : retirer le focus du query string après 3.5s pour éviter
    // un re-trigger si l'utilisateur fait F5 / revient sur la page.
    const clearT = setTimeout(() => {
      setSearchParams((prev) => {
        if (prev.get('focus') !== focusId) return prev;
        const next = new URLSearchParams(prev);
        next.delete('focus');
        return next;
      }, { replace: true });
    }, 3500);
    return () => {
      clearTimeout(t);
      clearTimeout(clearT);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, focusedIndexInFiltered, paged.length]);

  // Permet à l'utilisateur d'effacer le focus manuellement (bouton Clear).
  const clearFocus = React.useCallback(() => {
    setFocusClearedAt(Date.now());
    setFocusActive(false);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('focus');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const handleAnalyze = async (p: Prospect) => {
    if (!isOnline) {
      toast.info('Mode offline — pas d’IA distante.');
      return;
    }
    toast.info(`Analyse IA lancée pour ${p.first_name} ${p.last_name}…`);
    try {
      const result = await analyzeMut.mutateAsync({
        entityType: 'prospect',
        entityId: p.id,
        first_name: p.first_name,
        last_name: p.last_name,
        company_name: undefined,
      });
      const summary = result.prospect?.summary?.slice(0, 80) ?? 'Synthèse reçue.';
      toast.success(`IA terminée (${summary}…)`);
    } catch (e) {
      toast.error(`IA impossible : ${(e as Error).message}`);
    }
  };

  const handleDelete = async (p: Prospect) => {
    try {
      await deleteProspect.mutateAsync(p.id);
      // Le optimistic update a déjà retiré la ligne ; sync local aussi.
      await removeProspect(p.id).catch(() => undefined);
      toast.success(`${p.first_name} ${p.last_name} supprimé.`);
    } catch (e) {
      toast.error(`Suppression impossible : ${(e as Error).message}`);
    }
  };

  // Round 133 — déplacement d'un prospect dans le pipeline Kanban
  // (glisser-déposer). Persist via PUT /api/prospects/:id { status }.
  const handleMove = async (id: string, status: KanbanColumnId) => {
    const label = KANBAN_COLUMNS.find((c) => c.id === status)?.label ?? status;
    try {
      await updateProspect.mutateAsync({ id, patch: { status } });
      toast.success(`Déplacé vers « ${label} »`);
    } catch (e) {
      toast.error(`Déplacement impossible : ${(e as Error).message}`);
    }
  };

  // Round 60 — panier de confirmation : on stocke la cible à supprimer et
  // une modale DeleteConfirmDialog s'ouvre (au lieu du vieux `window.confirm`).
  const [pendingDelete, setPendingDelete] = React.useState<Prospect | null>(null);
  const requestDelete = React.useCallback((p: Prospect) => setPendingDelete(p), []);
  const cancelDelete = React.useCallback(() => setPendingDelete(null), []);
  // Round 95 — meilleure diagnostic + retry manuel pour le suppress :
  //   Quand le backend est injoignable (tunnel Cloudflare tombé, JWT mort,
  //   backend qui timeout), on BLOQUE le delete conformément au choix UX
  //   (pas de fake-delete local). On affiche un message **actionable** qui
  //   dit exactement ce qui ne va pas + comment réagir.
  //   → L'utilisateur n'est plus perdu face à 'Suppression backend impossible'.
  const confirmDelete = React.useCallback(async () => {
    if (!pendingDelete) return;
    const p = pendingDelete;
    setPendingDelete(null); // ferme la modale tout de suite

    // 1) Backend delete (HTTP 204) — c'est lui qui autorise tout le reste.
    try {
      await deleteProspect.mutateAsync(p.id);
    } catch (e) {
      // Round 95 — diagnostic par type d'erreur (au lieu d'un message générique).
      const err = e as { code?: string; status?: number; message?: string; name?: string };
      const code = String(err.code ?? '');
      const status = Number(err.status ?? 0);
      let title = 'Suppression impossible';
      let body = String(err.message ?? 'Erreur inconnue — réessaie dans quelques secondes.');
      if (code === 'NETWORK_UNAVAILABLE' || err.name === 'TypeError') {
        title = '🌐 Backend injoignable';
        body =
          'Le tunnel Cloudflare répond plus. Attends 10s puis réessaie. ' +
          'Si ça persiste : `bash /tmp/zh_restart_svc.sh` puis Ctrl+Shift+R.';
      } else if (code === 'TIMEOUT') {
        title = '⏱️ Backend trop lent';
        body = 'La requête a expiré (>30s). Réessaie — le tunnel est peut-être surchargé.';
      } else if (status === 401 || /authent|token|jwt/i.test(body)) {
        title = '🔑 Session expirée';
        body = 'Reconnecte-toi avec ton PIN pour pouvoir supprimer.';
      } else if (status === 404 || /introuvable|not[_ ]found/i.test(body)) {
        // Le prospect a déjà été supprimé (autre onglet, sync, scrape, etc.).
        // On force un refetch pour aligner l'UI puis on considère l'opération
        // comme réussie (round-trip backend → déjà propre).
        title = '✅ Déjà supprimé côté backend';
        body = 'Le prospect nexistait plus — refresh automatique en cours.';
        try { await backendRefetch(); } catch { /* noop */ }
        try { await localRefetch(); } catch { /* noop */ }
        toast.successDetailed(title, body);
        return;
      } else if (status >= 500) {
        title = '⚠️ Backend en erreur';
        body = `HTTP ${status} côté serveur. Réessaie dans quelques secondes.`;
      } else if (status >= 400) {
        // 422 validation, 400 bad request, 403 forbidden etc.
        title = `⚠️ Requête rejetée par le backend`;
        body = `HTTP ${status} — ${body}`;
      }
      // Toast détaillé (title + body) plutôt que concaténé.
      toast.errorDetailed(title, body);
      throw e;
    }

    // 2) Force-refresh du cache backend (bypass 30s staleTime).
    try {
      await backendRefetch();
    } catch { /* si le réseau est parti, l'utilisateur verra un warning sur le badge réseau */ }

    // 3) Local SQLite delete — useProspects supprime maintenant optimistically
    //    puis DELETE en async ; si l'async throw, refetch local + rethrow.
    try {
      await removeProspect(p.id);
    } catch (e) {
      toast.error(
        `Suppression locale impossible : ${(e as Error).message}. Rafraîchissez la page.`,
      );
    }

    // 4) Force-refresh du local depuis le disque pour aligner l'UI.
    try {
      await localRefetch();
    } catch { /* on a déjà géré l'erreur juste au-dessus */ }

    toast.success(`🗑️ ${p.first_name} ${p.last_name} supprimé.`);
  }, [pendingDelete, deleteProspect, removeProspect, backendRefetch, localRefetch, toast]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Lead Finder
            </span>
            <span className="text-[10px] text-muted-foreground/60">·</span>
            <span className="text-[10px] font-bold text-muted-foreground">
              {prospects.length} total · {counts.hot} hot · {counts.warm} warm · {counts.cold} cold
            </span>
          </div>
          <h2 className="text-3xl font-black tracking-tight">Prospects</h2>
          <p className="text-muted-foreground">Strategic targets ranked by intelligence score.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Round 133 — toggle vue Table / Board (pipeline Kanban) */}
          <div className="flex items-center rounded-lg border border-border/60 bg-card/40 p-0.5">
            <button
              type="button"
              onClick={() => setView('table')}
              aria-pressed={view === 'table'}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors',
                view === 'table'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <List size={13} /> Table
            </button>
            <button
              type="button"
              onClick={() => setView('board')}
              aria-pressed={view === 'board'}
              className={cn(
                'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-bold transition-colors',
                view === 'board'
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <LayoutGrid size={13} /> Board
            </button>
          </div>
          <Button
            variant="outline"
            onClick={handleCleanPreview}
            disabled={cleanLegacy.isPending}
            className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
            aria-label="Nettoyer les prospects legacy des anciens scraps"
            data-testid="btn-clean-legacy"
          >
            {cleanLegacy.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Clean legacy
          </Button>
          <Button
            onClick={() => setAddOpen(true)}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            <Plus className="mr-2 h-4 w-4" /> Add Prospect
          </Button>
        </div>
      </div>

      {/* Toolbar: search + filters chips */}
      <div className="flex items-center gap-3 flex-wrap relative">
        <div className="relative flex-1 min-w-0 sm:min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            placeholder="Search by name, email, or sector..."
            className="pl-10 bg-card/60 border-border/60"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        {/* Filters : toggle un popover qui révèle le status filter */}
        <div className="relative">
          <Button
            variant="outline"
            className={cn(
              'border-border/60',
              (statusFilter !== 'all' || filtersOpen) && 'border-primary/40 text-primary',
            )}
            onClick={() => {
              setFiltersOpen((v) => !v);
              setSortMenuOpen(false);
            }}
            aria-expanded={filtersOpen}
          >
            Filters
            {statusFilter !== 'all' && (
              <Badge variant="outline" className="ml-2 text-[9px] h-4 px-1 border-primary/40 text-primary">
                {STATUS_OPTIONS.find((s) => s.id === statusFilter)?.label}
              </Badge>
            )}
          </Button>
          {filtersOpen && (
            <div
              role="dialog"
              aria-label="Status filter"
              className="absolute right-0 mt-2 z-40 min-w-[180px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-card shadow-2xl shadow-primary/10 p-3 animate-in fade-in slide-in-from-top-2"
            >
              <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                Filtre statut
              </p>
              <div className="flex flex-col gap-1">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setStatusFilter(s.id);
                      setFiltersOpen(false);
                    }}
                    className={cn(
                      'text-left text-xs px-2 py-1.5 rounded-md transition-colors',
                      statusFilter === s.id
                        ? 'bg-primary/15 text-primary font-bold'
                        : 'hover:bg-secondary/40',
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* Sort */}
        <div className="relative">
          <Button
            variant="outline"
            className={cn(
              'border-border/60',
              sortMenuOpen && 'border-primary/40 text-primary',
            )}
            onClick={() => {
              setSortMenuOpen((v) => !v);
              setFiltersOpen(false);
            }}
            aria-expanded={sortMenuOpen}
          >
            <ArrowUpDown className="mr-2 h-4 w-4" />
            {SORT_OPTIONS.find((s) => s.id === sortKey)?.label ?? 'Sort'}
          </Button>
          {sortMenuOpen && (
            <div
              role="dialog"
              aria-label="Sort options"
              className="absolute right-0 mt-2 z-40 min-w-[180px] max-w-[calc(100vw-32px)] rounded-xl border border-border bg-card shadow-2xl shadow-primary/10 p-3 animate-in fade-in slide-in-from-top-2"
            >
              <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                Trier par
              </p>
              <div className="flex flex-col gap-1">
                {SORT_OPTIONS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSortKey(s.id);
                      setSortMenuOpen(false);
                    }}
                    className={cn(
                      'text-left text-xs px-2 py-1.5 rounded-md transition-colors flex items-center gap-2',
                      sortKey === s.id
                        ? 'bg-primary/15 text-primary font-bold'
                        : 'hover:bg-secondary/40',
                    )}
                  >
                    {s.icon}
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tier filter chips */}
      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by tier">
        {[
          { id: 'all' as const, label: 'All', count: prospects.length, tier: 'all' as const },
          { id: 'hot' as const, label: 'Hot', count: counts.hot, tier: 'hot' as const },
          { id: 'warm' as const, label: 'Warm', count: counts.warm, tier: 'warm' as const },
          { id: 'cold' as const, label: 'Cold', count: counts.cold, tier: 'cold' as const },
        ].map((chip) => (
          <TierFilterChip
            key={chip.id}
            id={chip.id}
            label={chip.label}
            count={chip.count}
            tier={chip.tier}
            active={tierFilter === chip.id}
            onSelect={setTierFilter}
          />
        ))}
      </div>

      {/* Round 133 — vue Board (pipeline Kanban drag & drop) */}
      {view === 'board' && <ProspectKanban prospects={filtered} onMove={handleMove} />}

      {/* Lead Finder table */}
      {view === 'table' && (
      <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
        {isLoading ? (
          <div className="text-center py-20 text-muted-foreground">
            <Loader2 className="inline animate-spin mr-2" size={16} />
            Loading prospects...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground space-y-3">
            <p>No prospects match these filters. Try adjusting the search or tier.</p>
            <Button onClick={() => setAddOpen(true)} variant="outline" className="border-primary/40">
              <Plus className="mr-2 h-4 w-4" /> Add the first prospect
            </Button>
          </div>
        ) : (
          <>
          {/* Round 57 — drill-down banner if ?focus=pros_xxx */}
          {focusedProspect && (
            <FocusHighlightBanner prospect={focusedProspect} onClear={clearFocus} />
          )}
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary/30 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-bold">Prospect</th>
                <th className="px-4 py-3 font-bold hidden md:table-cell">Sector · Location</th>
                <th className="px-4 py-3 font-bold">Score</th>
                <th className="px-4 py-3 font-bold">Tier</th>
                <th className="px-4 py-3 font-bold hidden lg:table-cell">Status</th>
                <th className="px-4 py-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((p) => {
                const t = getTier(p.score);
                const status = p.status ?? 'new';
                const isAnalyzing =
                  analyzeMut.isPending && analyzeMut.variables?.entityId === p.id;
                // Round 57 — la ligne ciblée par ?focus=pros_xxx :
                //  - reçoit `ref` pour scrollIntoView
                //  - reçoit 2 classes CSS : ring + glow + bounce Tantale emphasis
                const isFocused = focusId === p.id;
                // Round 91 — parse la qualité détaillée + grise si overall < 0.5.
                const q = parseQuality(p.quality);
                const isLowConfidence = q.overall < 0.5;
                return (
                  <tr
                    key={p.id}
                    ref={isFocused ? focusRowRef : undefined}
                    data-focus={isFocused ? 'true' : undefined}
                    data-prospect-id={p.id}
                    title={
                      isLowConfidence
                        ? `Confiance ${Math.round(q.overall * 100)}% (email ${Math.round(q.email_validity * 100)}% · tél ${Math.round(q.phone_reachability * 100)}% · rôle ${Math.round(q.decision_maker * 100)}%) — vérifiez avant outreach.`
                        : q.overall > 0
                          ? `Confiance ${Math.round(q.overall * 100)}% (email ${Math.round(q.email_validity * 100)}% · tél ${Math.round(q.phone_reachability * 100)}% · rôle ${Math.round(q.decision_maker * 100)}%)`
                          : undefined
                    }
                    onClick={() => navigate(`/prospects/${p.id}`)}
                    className={cn(
                      'border-t border-border/40 transition-colors group hover:bg-secondary/20 cursor-pointer',
                      // Round 91 — grayscale opacity-60 sur les fiches low-confidence.
                      isLowConfidence && 'grayscale opacity-55 hover:opacity-80',
                      isFocused && focusActive && [
                        'ring-2 ring-amber-500/70 ring-inset',
                        'bg-amber-500/10',
                        'shadow-[0_0_40px_rgba(245,158,11,0.35)]',
                        'animate-pulse',
                      ],
                      isFocused && !focusActive && 'ring-2 ring-amber-500/40 ring-inset bg-amber-500/5',
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            'w-9 h-9 rounded-full flex items-center justify-center text-xs font-black',
                            t === 'hot'
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : t === 'warm'
                                ? 'bg-amber-500/15 text-amber-500'
                                : 'bg-slate-500/15 text-slate-400',
                          )}
                        >
                          {initialsOf(p)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold truncate flex items-center gap-1.5">
                            {p.first_name} {p.last_name}
                            {isLowConfidence && (
                              <span
                                className="inline-flex items-center gap-0.5 rounded border border-slate-500/40 bg-slate-500/15 px-1 py-0 text-[8.5px] font-black uppercase tracking-wider text-slate-500"
                                title={`Confiance ${Math.round(q.overall * 100)}% — vérifiez avant outreach`}
                              >
                                Low confidence
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {p.email ?? '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-1 text-xs">
                        <Building2 size={12} className="text-muted-foreground" />
                        <span className="text-foreground font-medium">{p.sector ?? '—'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <MapPin size={11} />
                        {p.city ?? '—'}
                        {p.country ? `, ${p.country}` : ''}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ScoreCell score={p.score ?? 0} />
                    </td>
                    <td className="px-4 py-3">
                      <TierPill tier={t} />
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        {status === 'qualified' ? (
                          <CheckCircle2 size={12} className="text-emerald-500" />
                        ) : (
                          <Circle size={12} className="text-muted-foreground/40" />
                        )}
                        <span className="capitalize">{status}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {p.email && (
                          <a
                            href={`mailto:${p.email}`}
                            title="Email"
                            aria-label={`Email ${p.first_name}`}
                            onClick={(e) => e.stopPropagation()}
                            className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors"
                          >
                            <Mail size={14} />
                          </a>
                        )}
                        {p.phone && (
                          <a
                            href={`tel:${p.phone}`}
                            title="Call"
                            aria-label={`Call ${p.first_name}`}
                            onClick={(e) => e.stopPropagation()}
                            className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors"
                          >
                            <Phone size={14} />
                          </a>
                        )}
                        <button
                          type="button"
                          title="Run AI analysis"
                          aria-label={`Run AI analysis for ${p.first_name}`}
                          disabled={isAnalyzing}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAnalyze(p);
                          }}
                          className={cn(
                            'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
                            isAnalyzing
                              ? 'text-amber-500 bg-amber-500/10 animate-pulse'
                              : 'text-muted-foreground hover:text-accent hover:bg-accent/10',
                          )}
                        >
                          {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          aria-label={`Delete ${p.first_name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            requestDelete(p);
                          }}
                          className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          </>
        )}
      </div>
      )}

      {/* Footer summary */}
      {view === 'table' && !isLoading && filtered.length > 0 && (
        <div className="text-[11px] text-muted-foreground text-center pt-1">
          Showing {shown} of {filteredTotal} prospects · tri:{' '}
          {SORT_OPTIONS.find((s) => s.id === sortKey)?.label}
        </div>
      )}

      {/* Load more (Round 25) */}
      {view === 'table' && !isLoading && (
        <div className="flex justify-center">
          <LoadMoreButton
            shown={shown}
            total={filteredTotal}
            step={5}
            hasMore={hasMore}
            onClick={showMore}
            labelSingular="prospect"
            labelPlural="prospects"
          />
        </div>
      )}

      {/* Delete confirmation dialog (Round 60) */}
      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) cancelDelete(); }}
        itemLabel={
          pendingDelete
            ? `${pendingDelete.first_name} ${pendingDelete.last_name}`.trim()
            : ''
        }
        entityLabel="prospect"
        meta={
          pendingDelete
            ? `${pendingDelete.role ?? '—'} · ${pendingDelete.company_name ?? '—'}${
                pendingDelete.email ? ' · ' + pendingDelete.email : ''
              }`
            : undefined
        }
        cascades={[
          'Les notes internes ne sont pas supprimées en cascade',
          'L’historique de conversations rattaché ne sera pas supprimé en cascade',
          'L’inscription aux campagnes sera marquée comme orpheline (FK non cascadée)',
          'Les analyses IA restent en base (suppression manuelle Settings → Wipe)',
        ]}
        onConfirm={confirmDelete}
      />

      {/* Modal (Round 27 — toast global monté dans ToastProvider) */}
      <AddProspectModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          toast.success('Prospect créé.');
        }}
      />

      {/* Round 92e — Clean legacy channels preview/commit dialog.
           Étape 1 : preview (call API confirm:false). On affiche matched count
           et les 12 premiers prospects concernés. Étape 2 : si l'utilisateur
           tape NETTOYER, on re-call avec confirm:true. */}
      {cleanOpen && (
        <CleanLegacyDialog
          preview={cleanPreview}
          loading={cleanLegacy.isPending}
          onClose={() => {
            setCleanOpen(false);
            setCleanPreview(null);
          }}
          onConfirm={handleCleanCommit}
        />
      )}
    </div>
  );
}

/**
 * Round 92e — Dialog `Clean` des prospects legacy.
 *
 * Affiche :
 *  - le nombre de prospects qui vont être supprimés,
 *  - un aperçu (jusqu'à 12) avec first_name / last_name / email,
 *  - demande une confirmation tapée (« NETTOYER »).
 *
 * Si `preview.matched === 0`, on affiche un état vide « Base propre ✅ ».
 */
function CleanLegacyDialog({
  preview,
  loading,
  onClose,
  onConfirm,
}: {
  preview: { matched: number; sample: Array<{ id: string; email: string | null; first_name: string; last_name: string; company_id: string | null }> } | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}): React.ReactElement {
  const [typed, setTyped] = React.useState('');
  React.useEffect(() => {
    if (!preview) setTyped('');
  }, [preview]);
  const matched = preview?.matched ?? 0;
  const canConfirm = matched > 0 && typed.trim().toUpperCase() === 'NETTOYER' && !loading;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-amber-500/30 bg-card shadow-2xl shadow-amber-500/10">
        <div className="flex items-center gap-3 border-b border-amber-500/20 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/30">
            <Sparkles className="h-5 w-5 text-amber-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-foreground">
              Nettoyer les prospects « legacy »
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Issu des scraps avant R92c/R92d (first_name==last_name, channel, scraping)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary/50 disabled:opacity-50"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3 px-5 py-4 max-h-[60vh] overflow-y-auto">
          <div
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold',
              matched > 0
                ? 'bg-amber-500/10 text-amber-200 border border-amber-500/30'
                : 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/30',
            )}
          >
            {matched > 0 ? (
              <>
                <span>🧹</span>
                <span>
                  {matched} prospect{matched > 1 ? 's' : ''} legacy détecté
                  {matched > 1 ? 's' : ''} — suppression irréversible.
                </span>
              </>
            ) : (
              <>
                <span>✅</span>
                <span>Aucun prospect legacy détecté. Base déjà propre.</span>
              </>
            )}
          </div>
          {matched > 0 && preview?.sample && preview.sample.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                Aperçu ({Math.min(12, preview.sample.length)} sur {matched})
              </p>
              <div className="rounded-md border border-border/60 bg-background/40 divide-y divide-border/30">
                {preview.sample.slice(0, 12).map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs"
                  >
                    <span className="font-mono text-muted-foreground w-12 truncate">
                      {s.first_name.slice(0, 10)}
                    </span>
                    <span className="text-muted-foreground">/</span>
                    <span className="font-mono text-foreground flex-1 truncate">
                      {s.email || <span className="italic text-muted-foreground">no-email</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {matched > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">
                Pour confirmer, tapez{' '}
                <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-amber-300">
                  NETTOYER
                </span>{' '}
                ci-dessous :
              </label>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
                spellCheck={false}
                disabled={loading}
                className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 disabled:opacity-50"
              />
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-amber-500/20 bg-amber-500/5 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-semibold hover:bg-secondary/60 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm}
            data-testid="clean-legacy-confirm"
            className={cn(
              'rounded-md px-4 py-1.5 text-xs font-bold transition-colors',
              canConfirm
                ? 'bg-amber-500 text-amber-950 hover:bg-amber-400'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            {loading ? (
              <>
                <Loader2 className="inline h-3 w-3 animate-spin mr-1" />
                Nettoyage…
              </>
            ) : (
              <>🧹 Nettoyer</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
