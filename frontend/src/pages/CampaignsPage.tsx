/**
 * CampaignsPage — Round 38.
 *
 * Page gestion des campagnes.
 *
 * Round 38 — suppression de toutes les fausses données hardcodées :
 *   - `mockCampaigns[]`  (3 campagnes inventées : "Q3 Enterprise Outreach"…)
 *   - `PIPELINE[]`        (8 cartes prospects fictifs : "M. Lalande", "J. Renaud"…)
 *
 * → on lit désormais uniquement la base SQLite via `/api/campaigns`.
 * → si elle est vide, on affiche un empty state + un bouton pour créer
 *   la première campagne (POST /api/campaigns).
 * → la Pipeline Kanban (Round 22 Olivine pattern) reste affichée SI l'
 *   utilisateur a déjà créé une campagne ET y a rattaché des prospects,
 *   mais elle se base 100% sur les données de la DB.
 */
import React from 'react';
import {
  Target,
  Plus,
  Play,
  Pause,
  Users,
  TrendingUp,
  Calendar,
  MoreVertical,
  CheckCircle2,
  Clock,
  Layout,
  PauseCircle,
  Rocket,
  Handshake,
  Trophy,
  XCircle,
  Loader2,
  Megaphone,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useToast } from '@/contexts/ToastProvider';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useCampaignsQuery } from '@/hooks/useBackendData';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import type { Campaign } from '@/types';

// =====================================================================
// Utils
// =====================================================================

/** Formate un timestamp SQLite (ms epoch) ou une string ISO en date lisible. */
function formatCampaignDate(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(new Date(value));
  if (!Number.isFinite(n)) return '—';
  const d = new Date(n);
  return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Map le statut prospect DB → colonne du pipeline. */
function stageForProspectStatus(status?: string | null): string {
  switch ((status ?? '').toLowerCase()) {
    case 'new':
    case 'interested':
      return 'discovery';
    case 'contacted':
      return 'contacted';
    case 'qualified':
      return 'qualified';
    case 'converted':
      return 'won';
    case 'lost':
      return 'lost';
    default:
      return 'discovery';
  }
}

// =====================================================================
// Constants (UI metadata — pas de données fake)
// =====================================================================

const STAGES = [
  { id: 'discovery', label: 'Discovery', icon: <PauseCircle size={14} />, accent: 'text-slate-400',
    ring: 'border-slate-500/40', dot: 'bg-slate-400' },
  { id: 'contacted', label: 'Contacted', icon: <Rocket size={14} />, accent: 'text-cyan-400',
    ring: 'border-cyan-500/40', dot: 'bg-cyan-500' },
  { id: 'qualified', label: 'Qualified', icon: <Handshake size={14} />, accent: 'text-primary',
    ring: 'border-primary/50', dot: 'bg-primary' },
  { id: 'won', label: 'Won', icon: <Trophy size={14} />, accent: 'text-emerald-500',
    ring: 'border-emerald-500/50', dot: 'bg-emerald-500' },
  { id: 'lost', label: 'Lost', icon: <XCircle size={14} />, accent: 'text-red-400',
    ring: 'border-red-500/40', dot: 'bg-red-500' },
] as const;

// =====================================================================
// Empty-state
// =====================================================================

const EmptyCampaigns: React.FC<{ onCreate: () => void; isPending: boolean }> = ({ onCreate, isPending }) => (
  <div className="rounded-3xl border-2 border-dashed border-border/40 bg-card/20 p-12 flex flex-col items-center justify-center text-center">
    <Megaphone size={48} className="text-primary opacity-30 mb-4" />
    <h2 className="text-xl font-black tracking-tight mb-2">Aucune campagne enregistrée</h2>
    <p className="text-sm text-muted-foreground leading-snug max-w-md mb-1">
      Round 38 — toutes les campagnes de démo ont été supprimées.
      ZENTARA attend maintenant que vous créiez votre vraie première campagne
      de prospection / nurturing.
    </p>
    <Button
      onClick={onCreate}
      disabled={isPending}
      className="mt-5 bg-primary hover:bg-primary/90 text-primary-foreground"
    >
      {isPending
        ? <Loader2 size={14} className="mr-2 animate-spin" />
        : <Plus size={14} className="mr-2" />}
      Créer ma première campagne
    </Button>
  </div>
);

// =====================================================================
// Pipeline board (réel : agrège les prospects de DB par stage ; fallback 0)
// =====================================================================

interface PipelineCardData {
  id: string;
  prospect: string;
  company?: string;
  amount?: string;
  status?: string;
}

interface PipelineBoardProps {
  campaign: Campaign;
}

const PipelineBoard: React.FC<PipelineBoardProps> = ({ campaign }) => {
  // Round 38 — on lit `/api/campaigns/:id/prospects` et on agrège par `stage`.
  // Fallback honnête : si pas de prospects → 'No prospects here yet'.
  const [prospects, setProspects] = React.useState<PipelineCardData[]>([]);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const api = getApiClient();
        const raw = await api.get<unknown>(`${ENDPOINTS.campaignById(campaign.id)}/prospects`);
        const list = Array.isArray(raw) ? raw as Array<{ id: string; first_name?: string; last_name?: string; company_id?: string; status?: string }>
          : (raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as { data: unknown }).data))
            ? (raw as { data: Array<{ id: string; first_name?: string; last_name?: string; company_id?: string; status?: string }> }).data
            : [];
        const mapped = list.map((p) => ({
          id: p.id,
          prospect: [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Prospect',
          company: p.company_id ?? undefined,
          status: p.status,
        }));
        if (alive) { setProspects(mapped); setLoaded(true); }
      } catch {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [campaign.id]);

  // Bucket réel : les prospects chargés sont répartis par statut dans les colonnes.
  const bucketByStage: Record<string, PipelineCardData[]> = {
    discovery: [], contacted: [], qualified: [], won: [], lost: [],
  };
  for (const p of prospects) {
    bucketByStage[stageForProspectStatus(p.status)]?.push(p);
  }

  return (
    <Card className="bg-card/40 border-border/60 overflow-hidden">
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pipeline</div>
            <CardTitle className="mt-1 text-lg">{campaign.name}</CardTitle>
            <CardDescription className="text-xs">
              {loaded ? `${prospects.length} prospect(s) rattaché(s)` : 'Chargement des prospects…'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge className={cn(
              'border text-[10px]',
              campaign.status === 'active'
                ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                : 'bg-secondary text-muted-foreground border-border',
            )}>
              <span className={cn(
                'w-1.5 h-1.5 rounded-full mr-1.5',
                campaign.status === 'active' ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground',
              )} />
              {campaign.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {prospects.length === 0 && loaded ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            Aucun prospect rattaché à cette campagne. Depuis la fiche Prospect, assignez <code className="font-mono">campaign_id</code>.
          </div>
        ) : (
          <div className="flex overflow-x-auto divide-x divide-border/40">
            {STAGES.map((stage) => {
              const cards = bucketByStage[stage.id];
              return (
                <div key={stage.id} className="flex-1 min-w-[180px] p-3 sm:p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={cn('h-6 w-6 rounded-md border bg-card/60 flex items-center justify-center', stage.ring)}>
                        <span className={stage.accent}>{stage.icon}</span>
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wider">{stage.label}</span>
                    </div>
                    <span className={cn(
                      'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold',
                      'bg-secondary text-muted-foreground',
                    )}>
                      {cards.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {cards.length === 0 && (
                      <div className="text-[11px] text-muted-foreground/60 italic px-2 py-3">—</div>
                    )}
                    {cards.map((c) => (
                      <div key={c.id} className={cn(
                        'rounded-xl border border-border/40 bg-card/60',
                        'p-2.5 hover:border-primary/40 transition-colors cursor-grab active:cursor-grabbing',
                      )}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{c.prospect}</div>
                            {c.company && (
                              <div className="text-[10px] text-muted-foreground truncate">{c.company}</div>
                            )}
                          </div>
                          <span className={cn('shrink-0 w-1.5 h-1.5 rounded-full mt-1', stage.dot)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// =====================================================================
// Cartes campagnes (réelles)
// =====================================================================

const CampaignCard: React.FC<{
  c: Campaign;
  onResumePause: (id: string, target: 'active' | 'paused') => void;
  onRequestDelete: (c: Campaign) => void;
}> = ({ c, onResumePause, onRequestDelete }) => (
  <Card className="bg-card/50 border-border group overflow-hidden">
    <div className={cn(
      'h-1 w-full',
      c.status === 'active' ? 'bg-emerald-500' : c.status === 'paused' ? 'bg-amber-500' : 'bg-muted',
    )} />
    <CardHeader className="pb-4">
      <div className="flex items-center justify-between">
        <Badge variant={c.status === 'active' ? 'default' : 'secondary'} className="text-[10px] uppercase">
          {c.status}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-red-500"
          onClick={() => onRequestDelete(c)}
          aria-label={`Supprimer la campagne ${c.name}`}
          title="Supprimer cette campagne"
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <CardTitle className="text-xl mt-2">{c.name}</CardTitle>
      <CardDescription className="flex items-center gap-1">
        <Target size={12} /> {c.target ?? c.target_sector ?? '—'}
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-6">
      <div className="grid grid-cols-3 gap-4 border-y border-border/50 py-4 text-center">
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground uppercase">Status</span>
          <div className="font-bold capitalize">{c.status}</div>
        </div>
        <div className="space-y-1 border-x border-border/50">
          <span className="text-[10px] text-muted-foreground uppercase">Description</span>
          <div className="text-xs text-muted-foreground truncate">
            {c.description ?? '—'}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-[10px] text-muted-foreground uppercase">Créée</span>
          <div className="font-bold flex items-center justify-center gap-1">
            <Calendar size={12} className="text-primary" />
            <span className="text-xs">{formatCampaignDate(c.created_at)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Clock size={12} /> {formatCampaignDate(c.updated_at)}
        </span>
        <span className="flex items-center gap-1">
          <Users size={12} /> {(c as any).prospect_count ?? 0} prospects liés
        </span>
      </div>

      <div className="flex items-center gap-2 pt-2">
        {c.status === 'active' ? (
          <Button variant="outline" className="flex-1 text-xs h-8 border-border" onClick={() => onResumePause(c.id, 'paused')}>
            <Pause size={14} className="mr-2" /> Pause
          </Button>
        ) : (
          <Button
            variant="default"
            className="flex-1 text-xs h-8 bg-emerald-500 hover:bg-emerald-600 border-none"
            onClick={() => onResumePause(c.id, 'active')}
          >
            <Play size={14} className="mr-2" /> Resume
          </Button>
        )}
        <Button variant="secondary" className="flex-1 text-xs h-8">
          <Layout size={14} className="mr-2" /> Insights
        </Button>
      </div>
    </CardContent>
  </Card>
);

// =====================================================================
// Main page
// =====================================================================

export function CampaignsPage(): React.ReactElement {
  const toast = useToast();
  const qc = useQueryClient();
  const { data: campaigns = [], isLoading } = useCampaignsQuery();
  const [createFormOpen, setCreateFormOpen] = React.useState(false);

  const createMut = useMutation({
    mutationFn: async (input: { name: string; description?: string; target_sector?: string }) => {
      const api = getApiClient();
      // Le backend stocke `target` (colonne SQLite). Le formulaire expose un
      // champ `target_sector` côté UI ; on le mappe explicitement ici.
      return api.post(ENDPOINTS.campaignsList, {
        name: input.name,
        description: input.description,
        target: input.target_sector,
      });
    },
    onSuccess: () => {
      toast.success('Campagne créée', 2500);
      setCreateFormOpen(false);
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (e) => toast.error(`Échec : ${(e as Error).message}`, 4000),
  });

  const toggleStatusMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'paused' | 'draft' | 'completed' | 'archived' }) => {
      const api = getApiClient();
      return api.put(ENDPOINTS.campaignById(id), { status });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      toast.success('Statut mis à jour', 2500);
    },
    onError: (e) => toast.error(`Échec : ${(e as Error).message}`, 4000),
  });

  // Round 60 — suppression de campagne.
  const deleteCampaignMut = useMutation({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      return api.delete(ENDPOINTS.campaignById(id));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });

  const [pendingDelete, setPendingDelete] = React.useState<Campaign | null>(null);
  const requestCampaignDelete = React.useCallback(
    (c: Campaign) => setPendingDelete(c),
    [],
  );
  const cancelCampaignDelete = React.useCallback(() => setPendingDelete(null), []);
  const confirmCampaignDelete = React.useCallback(async () => {
    if (!pendingDelete) return;
    const c = pendingDelete;
    setPendingDelete(null);
    await deleteCampaignMut.mutateAsync(c.id).catch((e: unknown) => { throw e; });
  }, [pendingDelete, deleteCampaignMut, toast]);

  const handleCreateFirst = async () => {
    try {
      await createMut.mutateAsync({
        name: 'Ma première campagne',
        description: 'À configurer depuis une fiche Prospect.',
        target_sector: 'SaaS B2B',
      });
    } catch {
      /* error toast auto via onError */
    }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Campaigns
            </span>
            <span className="text-[10px] text-muted-foreground/60">·</span>
            <span className="text-[10px] font-bold text-muted-foreground">
              {isLoading ? '…' : `${campaigns.length} campagne(s)`}
            </span>
          </div>
          <h2 className="text-3xl font-black tracking-tight">Campaigns</h2>
          <p className="text-muted-foreground">Strategic outreach and engagement management.</p>
        </div>
        <Button
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
          onClick={() => setCreateFormOpen(true)}
          disabled={campaigns.length === 0 && createMut.isPending}
        >
          <Plus className="mr-2 h-4 w-4" /> New Campaign
        </Button>
      </div>

      {/* Empty state when DB is empty */}
      {!isLoading && campaigns.length === 0 && (
        <EmptyCampaigns onCreate={handleCreateFirst} isPending={createMut.isPending} />
      )}

      {/* Pipeline de la première campagne (si on en a une) */}
      {campaigns.length > 0 && (
        <PipelineBoard campaign={campaigns[0] as Campaign} />
      )}

      {/* Cartes campagnes (réelles) */}
      {campaigns.length > 0 && (
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">
            Campaign overview
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {campaigns.map((c) => (
              <CampaignCard
                key={c.id}
                c={c as Campaign}
                onResumePause={(id, target) =>
                  toggleStatusMut.mutate({ id, status: target })}
                onRequestDelete={requestCampaignDelete}
              />
            ))}

            <Card
              className="bg-card/20 border-border border-dashed flex flex-col items-center justify-center py-10 cursor-pointer hover:bg-card/30 transition-colors group"
              onClick={() => setCreateFormOpen(true)}
            >
              <div className="p-4 rounded-full bg-secondary text-muted-foreground group-hover:text-primary transition-colors">
                <Plus size={32} />
              </div>
              <span className="mt-4 font-medium text-muted-foreground">Create New Campaign</span>
            </Card>
          </div>
        </div>
      )}

      {/* Round 60 — confirmation modale de suppression */}
      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) cancelCampaignDelete(); }}
        itemLabel={pendingDelete?.name ?? ''}
        entityLabel="campagne"
        meta={
          pendingDelete
            ? `${pendingDelete.status ?? 'draft'}${
                pendingDelete.target_sector ? ' · ' + pendingDelete.target_sector : ''
              }`
            : undefined
        }
        cascades={[
          'Les liaisons prospects ↔ campagne ne sont pas supprimées en cascade',
          'Séquences d\u2019outreach en cours sur cette campagne',
          'Statistiques et historiques restent en base (archivage manuel)',
        ]}
        onConfirm={confirmCampaignDelete}
      />

      {/* Add campaign form (inline modal) */}
      {createFormOpen && (
        <CreateCampaignForm
          onSubmit={(input) => createMut.mutate(input)}
          onClose={() => setCreateFormOpen(false)}
          isPending={createMut.isPending}
        />
      )}
    </div>
  );
}

// =====================================================================
// Inline create form
// =====================================================================

const CreateCampaignForm: React.FC<{
  onSubmit: (input: { name: string; description?: string; target_sector?: string }) => void;
  onClose: () => void;
  isPending: boolean;
}> = ({ onSubmit, onClose, isPending }) => {
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [target, setTarget] = React.useState('');
  const valid = name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="rounded-2xl border border-border/60 bg-card p-6 max-w-xl w-full shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-black tracking-tight flex items-center gap-2 mb-4">
          <Plus size={16} className="text-primary" /> Nouvelle campagne
        </h3>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            onSubmit({
              name: name.trim(),
              description: desc.trim() || undefined,
              target_sector: target.trim() || undefined,
            });
          }}
        >
          <Field label="Nom">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Q3 SaaS B2B France"
              className="w-full bg-background/40 border border-border/40 rounded-md px-2 py-1.5 text-xs"
            />
          </Field>
          <Field label="Secteur cible (optionnel)">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="SaaS B2B / FinTech / IA…"
              className="w-full bg-background/40 border border-border/40 rounded-md px-2 py-1.5 text-xs"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              placeholder="À qui s'adresse cette campagne, message clef…"
              className="w-full bg-background/40 border border-border/40 rounded-md px-2 py-1.5 text-xs"
            />
          </Field>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Annuler</Button>
            <Button type="submit" disabled={!valid || isPending} className="bg-primary text-primary-foreground">
              {isPending ? <Loader2 size={12} className="mr-2 animate-spin" /> : <Plus size={12} className="mr-2" />}
              Créer
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

export default CampaignsPage;
