/**
 * SiteDesignAuditPage — Round 49.
 *
 * Audit design de sites externes par scraping structurel léger
 * (fast, sans browser/headless). L'IA passe ensuite sur les
 * métriques pour produire un diagnostic design + recommandations
 * de redesign actionnables.
 *
 * Fonctionnalités :
 *   - Entrer une URL → POST /api/design-audit → scraping + analyse + retour.
 *   - Liste persistée de tous les audits passés.
 *   - Score global + breakdown par catégorie (UX, visuel, perf, SEO, mobile).
 *   - Liste des issues prioritaires + recommandations de redesign.
 *
 * Aucune fausse donnée : si la liste est vide après refresh, on
 * affiche un état vide honnête.
 */
import React from 'react';
import {
  Palette,
  Plus,
  Loader2,
  Eye,
  Globe,
  Smartphone,
  Zap,
  Search as SearchIcon,
  Layers,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  MousePointerClick,
  Layout,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/contexts/ToastProvider';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { ZentaraApiError, getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, FileSignature, ExternalLink, Search as SearchSparkle, Compass, Rocket, Crosshair, Network, MailPlus } from 'lucide-react';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { cn, safeIncludes, safeString, toDateMs } from '@/lib/utils';

// =====================================================================
// Types — alignés sur backend/src/modules/design-audit/types.ts (Round 49)
// =====================================================================

type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

interface AuditIssue {
  id: string;
  severity: AuditSeverity;
  category: 'structure' | 'a11y' | 'seo' | 'perf' | 'ux';
  title: string;
  /** Description longue (le frontend l'utilise comme "detail"). */
  message: string;
  /** Fix concret suggéré. */
  fix: string;
  roi_estimate: number;
  effort_estimate: number;
}

interface CategoryScores {
  structure: number;
  a11y: number;
  seo: number;
  perf: number;
  ux: number;
}

interface DesignAuditRecord {
  id: string;
  url: string;
  domain: string | null;
  score: number;
  category_scores: CategoryScores;
  issues: AuditIssue[];
  recommended_actions: string[];
  ai_summary: string;
  meta: {
    html_bytes: number;
    scanned_url: string;
    blocked: boolean;
    unreachable: boolean;
    note: string;
  };
  created_at: string;
}

// Round 68 — types pour la discovery (Design Hunt)
interface HuntCompanyRow {
  company_name: string;
  company_id: string | null;
  url: string;
  score: number | null;
  issues_count: number;
  blocked: boolean;
  unreachable: boolean;
  outreach_drafted: boolean;
  error: string | null;
  audit_id: string | null;
}

interface HuntResult {
  niche: string;
  region: string;
  target_count: number;
  discovered: number;
  succeeded: number;
  failed: number;
  audits: HuntCompanyRow[];
  options_applied: {
    save_companies: boolean;
    outreach_below: number | null;
    auto_tag: boolean;
  };
  duration_ms: number;
}

const CATEGORY_META: Record<keyof CategoryScores, { label: string; color: string }> = {
  structure: { label: 'Structure', color: 'text-blue-400' },
  a11y: { label: 'Accessibilité', color: 'text-purple-400' },
  seo: { label: 'SEO', color: 'text-emerald-400' },
  perf: { label: 'Performance', color: 'text-amber-400' },
  ux: { label: 'UX', color: 'text-pink-400' },
};

// =====================================================================
// Helpers
// =====================================================================

function friendlyError(e: unknown): string {
  if (e instanceof ZentaraApiError) {
    if (e.code === 'NETWORK_UNAVAILABLE' || e.code === 'TIMEOUT') {
      return 'Backend injoignable — vérifie le service (port 4000).';
    }
    if (e.code === 'RATE_LIMITED') return 'Trop de requêtes — réessaie dans 30s.';
    return `[${e.code}] ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return 'Erreur inconnue.';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = toDateMs(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-emerald-500/15 border-emerald-500/30';
  if (score >= 60) return 'bg-amber-500/15 border-amber-500/30';
  if (score >= 40) return 'bg-orange-500/15 border-orange-500/30';
  return 'bg-red-500/15 border-red-500/30';
}

const SEVERITY_META: Record<AuditSeverity, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-red-500/10 text-red-300 border-red-500/30',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  low: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  info: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30',
};

const SEVERITY_LABEL: Record<AuditSeverity, string> = {
  critical: 'Critique',
  high: 'Haute',
  medium: 'Moyenne',
  low: 'Basse',
  info: 'Info',
};

// =====================================================================
// Hooks
// =====================================================================

function useDesignAuditsQuery() {
  return useQuery<DesignAuditRecord[], Error>({
    queryKey: ['design-audit', 'list'],
    queryFn: async ({ signal }) => {
      const api = getApiClient();
      const raw = await api.get<DesignAuditRecord[] | { data: DesignAuditRecord[] }>(
        ENDPOINTS.designAuditList,
        { signal },
      );
      const data = 'data' in raw ? (raw as { data: DesignAuditRecord[] }).data : (raw as DesignAuditRecord[]);
      return Array.isArray(data) ? data : [];
    },
    staleTime: 30_000,
  });
}

function useNewAuditMutation() {
  const qc = useQueryClient();
  return useMutation<DesignAuditRecord, Error, { url: string }>({
    mutationFn: async ({ url }) => {
      const api = getApiClient();
      const r = await api.post<DesignAuditRecord | { data: DesignAuditRecord }>(
        `${ENDPOINTS.designAuditCreate}/run`,
        { url },
        { timeoutMs: 90_000 },
      );
      return ('data' in r ? r.data : r) as DesignAuditRecord;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['design-audit', 'list'] });
    },
  });
}

// Round 61 — DELETE audit + invalidate list.
function useDeleteAuditMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string; url: string }>({
    mutationFn: async ({ id }) => {
      const api = getApiClient();
      await api.delete(ENDPOINTS.designAuditById(id));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['design-audit', 'list'] });
      void qc.invalidateQueries({ queryKey: ['design-audit', 'for-company'] });
    },
  });
}

// Round 68 — POST /api/design-audit/hunt — Design Hunt discovery + audits en série.
function useHuntMutation(qc: ReturnType<typeof useQueryClient>) {
  return useMutation<HuntResult, Error, {
    niche: string;
    region: string;
    target_count: number;
    lite: boolean;
    options: {
      save_companies: boolean;
      outreach_below: number | null;
    };
  }>({
    mutationFn: async (input) => {
      const api = getApiClient();
      const r = await api.post<HuntResult | { data: HuntResult }>(
        ENDPOINTS.designAuditHunt,
        input,
        { timeoutMs: 240_000 },
      );
      return ('data' in r ? r.data : r) as HuntResult;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['design-audit', 'list'] });
      void qc.invalidateQueries({ queryKey: ['design-audit', 'for-company'] });
      void qc.invalidateQueries({ queryKey: ['companies'] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

// Round 61 — Génère un NDA design pour le site audité.
// Body: { type:'NDA', party_b_kind:'company', party_b_id, party_b_name, context }
function useGenerateDesignNDAMutation() {
  const qc = useQueryClient();
  return useMutation<{ id: string; status?: string }, Error, { audit: DesignAuditRecord }>({
    mutationFn: async ({ audit }) => {
      const api = getApiClient();
      const url = safeString(audit.url);
      const domain = safeString(audit.domain) || url;
      const r = await api.post<{ data?: { id: string; status?: string }; id?: string; status?: string }>(
        ENDPOINTS.contractsGenerate,
        {
          type: 'NDA',
          party_b_kind: 'company',
          party_b_id: null,
          party_b_name: domain,
          context: [
            `Audit design Zentara (Round 61).`,
            `Site audité : ${url}`,
            `Score global : ${audit.score}/100.`,
            `Issues prioritaires : ${audit.issues.slice(0, 3).map((i) => `[${i.severity}] ${i.title}`).join(' | ') || 'aucune'}.`,
            `Contexte : NDA bilatéral en vue d'un projet de redesign du site par Zentara.`,
          ].join(' '),
        },
      );
      const data = ('data' in r ? r.data : r) as { id: string; status?: string };
      return data;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

// =====================================================================
// Page
// =====================================================================

export function SiteDesignAuditPage() {
  const { isOnline } = useNetworkStatus();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: audits = [], isLoading, refetch, error } = useDesignAuditsQuery();
  const newAudit = useNewAuditMutation();
  const deleteAudit = useDeleteAuditMutation();
  const genNda = useGenerateDesignNDAMutation();
  const hunt = useHuntMutation(qc);
  const [url, setUrl] = React.useState('');
  const [viewing, setViewing] = React.useState<DesignAuditRecord | null>(null);
  const [search, setSearch] = React.useState('');
  const [pendingDelete, setPendingDelete] = React.useState<DesignAuditRecord | null>(null);

  // Round 68 — Design Hunt state
  const [huntNiche, setHuntNiche] = React.useState('');
  const [huntRegion, setHuntRegion] = React.useState('France');
  const [huntCount, setHuntCount] = React.useState(5);
  const [huntLite, setHuntLite] = React.useState(true);
  const [huntSaveCompanies, setHuntSaveCompanies] = React.useState(true);
  const [huntOutreach, setHuntOutreach] = React.useState(true);
  const [lastHunt, setLastHunt] = React.useState<HuntResult | null>(null);

  const filtered = React.useMemo(() => {
    const q = safeString(search).trim();
    if (!q) return audits;      return audits.filter((a) =>
      safeIncludes([a.url, a.meta?.scanned_url ?? ''].join(' '), q),
    );
  }, [audits, search]);

  const submit = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.error("L'URL doit commencer par http:// ou https://");
      return;
    }
    try {
      const r = await newAudit.mutateAsync({ url: trimmed });
      toast.success(`Audit terminé — score ${r.score}/100`);
      setUrl('');
      setViewing(r);
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const confirmDelete = React.useCallback(async () => {
    if (!pendingDelete) return;
    await deleteAudit.mutateAsync({ id: pendingDelete.id, url: pendingDelete.url });
  }, [deleteAudit, pendingDelete]);

  const handleGenerateNDA = React.useCallback(
    async (audit: DesignAuditRecord) => {
      try {
        const r = await genNda.mutateAsync({ audit });
        const cid = safeString(r?.id).trim();
        toast.successDetailed(
          'NDA design généré',
          cid ? `${r?.status === 'draft' ? 'Brouillon' : 'Statut ' + (r?.status ?? 'inconnu')} enregistré pour ${audit.url}. ID : ${cid.slice(0, 12)}…` : undefined,
        );
      } catch (e) {
        toast.error(`Échec génération NDA — ${friendlyError(e)}`);
      }
    },
    [genNda, toast],
  );

  // Round 68 — handler Design Hunt
  const handleHunt = React.useCallback(async () => {
    const niche = safeString(huntNiche).trim();
    if (niche.length < 2) {
      toast.error('Niche trop courte (min 2 caractères).');
      return;
    }
    try {
      const r = await hunt.mutateAsync({
        niche,
        region: safeString(huntRegion).trim() || 'Global',
        target_count: huntCount,
        lite: huntLite,
        options: {
          save_companies: huntSaveCompanies,
          outreach_below: huntOutreach ? 70 : null,
        },
      });
      setLastHunt(r);
      const drafted = r.audits.filter((a) => a.outreach_drafted).length;
      toast.successDetailed(
        `${r.succeeded}/${r.discovered} sites audités`,
        drafted > 0
          ? `${drafted} brouillon${drafted > 1 ? 's' : ''} d'outreach auto-draftés (audit < 70).`
          : `Durée : ${(r.duration_ms / 1000).toFixed(1)}s.`,
      );
    } catch (e) {
      toast.error(`Design Hunt échoué — ${friendlyError(e)}`);
    }
  }, [huntNiche, huntRegion, huntCount, huntLite, huntSaveCompanies, huntOutreach, hunt, toast]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Palette className="text-pink-400" size={22} />
            Site Design Audit
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Scraper structurel rapide + diagnostic IA : UX, visuel, perf perçue, SEO, mobile.
            <br />
            <span className="text-zinc-600">
              Aucune donnée inventée. Si la liste est vide, c'est qu'aucun audit n'a encore été lancé.
            </span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw size={14} className={isLoading ? 'animate-spin mr-2' : 'mr-2'} />
            Refresh
          </Button>
        </div>
      </div>

      {/* New audit form */}
      <Card className="border-pink-500/20">
        <CardContent className="pt-4">
          <div className="flex gap-2 items-center">
            <Globe size={16} className="text-pink-400 shrink-0" />
            <Input
              placeholder="https://exemple.com (site à auditer)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              disabled={newAudit.isPending || !isOnline}
              className="h-9"
            />
            <Button
              onClick={() => void submit()}
              disabled={newAudit.isPending || !url.trim() || !isOnline}
              className="bg-pink-500 hover:bg-pink-600 text-white"
            >
              {newAudit.isPending ? (
                <Loader2 size={14} className="animate-spin mr-2" />
              ) : (
                <Sparkles size={14} className="mr-2" />
              )}
              Auditer
            </Button>
          </div>
          <p className="text-[10px] text-zinc-400 mt-2 flex gap-1.5 items-start">
            <AlertCircle size={10} className="mt-0.5 shrink-0" />
            Scraper léger (fetch natif, pas de navigateur) — certains sites bloquent les bots
            (403) : l'audit le détectera et indiquera quelles catégories restent inaccessibles.
          </p>
        </CardContent>
      </Card>

      {/* Round 68 — Recherche automatique (Design Hunt) */}
      <Card className="border-fuchsia-500/20 bg-gradient-to-br from-fuchsia-500/[0.04] to-transparent">
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Compass className="text-fuchsia-400" size={16} />
            Recherche automatique
            <Badge variant="outline" className="text-[9px] border-fuchsia-500/30 text-fuchsia-300 ml-1">
              DISCOVERY + AUDITS EN SÉRIE
            </Badge>
          </CardTitle>
          <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
            Donne une niche + une région. Zentara détecte des sociétés, scrape leur site web,
            lance l'audit design pour chacune et — optionnel — te pré-draft un email d'outreach
            si le score est trop bas.
          </p>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] uppercase text-zinc-500 flex items-center gap-1 mb-1">
                <Crosshair size={10} /> Niche / Secteur
              </label>
              <Input
                value={huntNiche}
                onChange={(e) => setHuntNiche(e.target.value)}
                placeholder={'ex: "SaaS B2B", "E-commerce mode"'}
                disabled={hunt.isPending || !isOnline}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-zinc-500 flex items-center gap-1 mb-1">
                <Network size={10} /> Région / Marché
              </label>
              <Input
                value={huntRegion}
                onChange={(e) => setHuntRegion(e.target.value)}
                placeholder={'ex: "France", "Europe", "Paris"'}
                disabled={hunt.isPending || !isOnline}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase text-zinc-500 flex items-center gap-1 mb-1">
                <Rocket size={10} /> Nombre de cibles : <span className="text-fuchsia-300 font-semibold">{huntCount}</span>
              </label>
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={huntCount}
                onChange={(e) => setHuntCount(Number(e.target.value))}
                disabled={hunt.isPending || !isOnline}
                className="w-full accent-fuchsia-500"
              />
              <div className="flex justify-between text-[9px] text-zinc-400 mt-0.5">
                <span>1</span><span>5</span><span>10</span><span>15</span><span>20</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1">
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={huntSaveCompanies}
                onChange={(e) => setHuntSaveCompanies(e.target.checked)}
                disabled={hunt.isPending || !isOnline}
                className="accent-fuchsia-500"
              />
              Sauvegarder les sociétés en base
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={huntOutreach}
                onChange={(e) => setHuntOutreach(e.target.checked)}
                disabled={hunt.isPending || !isOnline}
                className="accent-fuchsia-500"
              />
              Auto-outreach si score &lt; <span className="text-fuchsia-300 font-semibold">70</span>
              <MailPlus size={11} className="text-fuchsia-400 ml-0.5" />
            </label>
            <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={huntLite}
                onChange={(e) => setHuntLite(e.target.checked)}
                disabled={hunt.isPending || !isOnline}
                className="accent-fuchsia-500"
              />
              Mode <span className="text-zinc-400">Lite</span> (Flash-Lite — rapide & économique)
            </label>
            <div className="ml-auto">
              <Button
                onClick={() => void handleHunt()}
                disabled={hunt.isPending || !huntNiche.trim() || !isOnline}
                className="bg-fuchsia-500 hover:bg-fuchsia-600 text-white"
                size="sm"
              >
                {hunt.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin mr-1.5" />
                    Hunt in progress…
                  </>
                ) : (
                  <>
                    <SearchSparkle size={14} className="mr-1.5" />
                    Lancer la recherche
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Outcomes / last hunt summary */}
          {hunt.isPending && (
            <div className="rounded border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-[11px] text-fuchsia-300 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" />
              Discovery + audits en cours… (jusqu'à {huntCount} sites — peut durer ~{Math.max(15, huntCount * 6)} s)
            </div>
          )}
          {lastHunt && !hunt.isPending && (
            <div className="rounded border border-fuchsia-500/20 bg-zinc-900/40 px-3 py-2 text-[10px] text-zinc-300 space-y-1">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-zinc-400">Dernier hunt :</span>
                <span className="text-zinc-500">
                  {lastHunt.niche} · {lastHunt.region} · {lastHunt.target_count} cibles
                </span>
                <span className="text-zinc-500">
                  {(lastHunt.duration_ms / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-emerald-300">
                  {lastHunt.succeeded}/{lastHunt.discovered} OK
                </span>
                {lastHunt.failed > 0 ? (
                  <span className="text-red-300">{lastHunt.failed} échec(s)</span>
                ) : null}
                {lastHunt.audits.filter((a) => a.outreach_drafted).length > 0 ? (
                  <span className="text-fuchsia-300 flex items-center gap-1">
                    <MailPlus size={10} />
                    {lastHunt.audits.filter((a) => a.outreach_drafted).length} draft(s) outreach auto
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 flex items-center gap-3">
          <Input
            placeholder="Filtrer par URL…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 text-xs max-w-sm"
          />
          <div className="text-xs text-zinc-500 ml-auto">
            {filtered.length} / {audits.length} audit{audits.length !== 1 ? 's' : ''}
          </div>
        </CardContent>
      </Card>

      {/* State messages */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          {friendlyError(error)}
        </div>
      )}

      {/* List */}
      {isLoading && audits.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">
          <Loader2 className="animate-spin inline mr-2" size={14} />
          Chargement des audits…
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-zinc-500">
            <Palette className="mx-auto mb-2 text-zinc-500" size={28} />
            Aucun audit pour le moment. Entre une URL ci-dessus pour lancer le diagnostic.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((a) => (
            <AuditRow
              key={a.id}
              audit={a}
              onView={() => setViewing(a)}
              onDelete={() => setPendingDelete(a)}
              deleting={deleteAudit.isPending && deleteAudit.variables?.id === a.id}
            />
          ))}
        </div>
      )}

      {/* Detail viewer */}
      {viewing && (
        <AuditViewer
          audit={viewing}
          onClose={() => setViewing(null)}
          onGenerateNDA={() => void handleGenerateNDA(viewing)}
          generating={genNda.isPending && genNda.variables?.audit.id === viewing.id}
        />
      )}

      {/* Delete confirmation */}
      {pendingDelete && (
        <DeleteConfirmDialog
          open={!!pendingDelete}
          onOpenChange={(o) => {
            if (!o) setPendingDelete(null);
          }}
          itemLabel={pendingDelete.url}
          entityLabel="audit design"
          meta={`Score ${pendingDelete.score}/100 · ${pendingDelete.issues.length} issue(s) · ${fmtDate(pendingDelete.created_at)}`}
          cascades={[
            "L'audit disparaît de la liste et du fichier d'historique.",
            'Les scores agrégés par site seront recalculés au prochain passage.',
            "Les analyses IA passées garderont leur contexte (pas de rollback).",
          ]}
          onConfirm={() => void confirmDelete()}
          successToast={(label) => ({
            title: 'Audit supprimé',
            description: `${label} a été retiré de l'historique.`,
          })}
        />
      )}
    </div>
  );
}

// =====================================================================
// Row
// =====================================================================

function AuditRow({
  audit,
  onView,
  onDelete,
  deleting,
}: {
  audit: DesignAuditRecord;
  onView: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const blocked = audit.meta?.blocked;
  return (
    <Card className="hover:border-pink-500/30 transition">
      <CardContent className="pt-4 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <div className={cn('text-3xl font-black tabular-nums', scoreColor(audit.score))}>
              {audit.score}
            </div>
            <div className="text-[10px] text-zinc-500">/100</div>
            <Badge variant="outline" className={cn('text-[10px] border', scoreBg(audit.score))}>
              {audit.score >= 80
                ? 'Excellent'
                : audit.score >= 60
                  ? 'Correct'
                  : audit.score >= 40
                    ? 'À améliorer'
                    : 'Critique'}
            </Badge>
            {blocked && (
              <Badge variant="outline" className="text-[10px] bg-red-500/15 text-red-400 border-red-500/30">
                Bloqué (anti-bot)
              </Badge>
            )}
            {audit.score < 70 && (
              <Badge
                variant="outline"
                className="text-[10px] bg-pink-500/15 text-pink-400 border-pink-500/30"
                title="Score &lt; 70 : la company liée sera taguée 'design' automatiquement"
              >
                <Palette size={9} className="inline mr-1" />
                Refonte nécessaire
              </Badge>
            )}
            <h3 className="font-semibold text-sm truncate max-w-md">{safeString(audit.url)}</h3>
          </div>
          <div className="text-xs text-zinc-500 flex gap-3 flex-wrap">
            {audit.issues.length > 0 && (
              <span>
                <AlertCircle size={10} className="inline mr-1 text-orange-400" />
                <b className="text-zinc-600">
                  {audit.issues.filter((i) => i.severity === 'critical').length}
                </b>{' '}
                critique(s), {audit.issues.length} au total
              </span>
            )}
            <span>{audit.recommended_actions.length} recommandation(s)</span>
            <span>Audité : {fmtDate(audit.created_at)}</span>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Button size="sm" variant="outline" onClick={onView}>
            <Eye size={14} className="mr-1" /> Voir
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={onDelete}
            disabled={deleting}
            className="h-8 w-8 text-muted-foreground hover:text-red-500 disabled:opacity-40"
            aria-label={`Supprimer l'audit ${audit.url}`}
            title="Supprimer cet audit"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// =====================================================================
// Viewer
// =====================================================================

function AuditViewer({
  audit,
  onClose,
  onGenerateNDA,
  generating,
}: {
  audit: DesignAuditRecord;
  onClose: () => void;
  onGenerateNDA: () => void;
  generating: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between gap-3 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="font-bold flex items-center gap-2 flex-wrap">
              <Palette className="text-pink-400" size={18} />
              <span className={cn('text-2xl tabular-nums', scoreColor(audit.score))}>
                {audit.score}
              </span>
              <span className="text-zinc-500 text-base">/100</span>
              <span className="text-zinc-300 truncate">— {safeString(audit.url)}</span>
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Audité le {fmtDate(audit.created_at)}
              {audit.meta?.scanned_url && audit.meta.scanned_url !== audit.url && (
                <> · redirige vers <code>{audit.meta.scanned_url}</code></>
              )}
              {audit.meta?.unreachable && <span className="text-amber-400"> · site injoignable</span>}
              {audit.meta?.blocked && <span className="text-red-400"> · site bloqué (anti-bot)</span>}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onGenerateNDA}
            disabled={generating}
            className="border-pink-500/40 text-pink-300 hover:bg-pink-500/10 shrink-0 disabled:opacity-40"
            title="Génère un NDA design Zentara × {domaine} en brouillon avec le contexte de cet audit"
          >
            {generating ? (
              <Loader2 size={14} className="animate-spin mr-1.5" />
            ) : (
              <FileSignature size={14} className="mr-1.5" />
            )}
            Générer NDA design
          </Button>
          <button onClick={onClose} className="text-zinc-500 hover:text-white px-2 shrink-0">
            ✕
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* AI summary */}
          {safeString(audit.ai_summary).trim() && (
            <div className="rounded-lg bg-purple-500/10 border border-purple-500/30 p-3 text-xs text-purple-200 flex items-start gap-2">
              <Sparkles size={14} className="shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-1">Résumé IA</div>
                <p className="leading-relaxed">{audit.ai_summary}</p>
              </div>
            </div>
          )}

          {/* Category scores */}
          {audit.category_scores && (
            <div>
              <h3 className="text-sm font-bold mb-2 text-zinc-300">Scores par catégorie</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
                {(Object.keys(CATEGORY_META) as Array<keyof CategoryScores>).map((k) => (
                  <CategoryScoreCard key={k} name={k} value={audit.category_scores[k]} />
                ))}
              </div>
            </div>
          )}

          {/* Issues */}
          {audit.issues.length > 0 && (
            <div>
              <h3 className="text-sm font-bold mb-2 text-zinc-300 flex items-center gap-2">
                <AlertCircle size={14} className="text-red-400" />
                Issues détectées ({audit.issues.length})
              </h3>
              <div className="space-y-2">
                {audit.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className={cn(
                      'rounded-lg border p-3 text-xs',
                      SEVERITY_META[issue.severity] ?? SEVERITY_META.info,
                    )}
                  >
                    <div className="font-semibold flex items-center gap-2 mb-1 flex-wrap">
                      <Badge
                        variant="outline"
                        className={cn('text-[9px]', SEVERITY_META[issue.severity] ?? SEVERITY_META.info)}
                      >
                        {SEVERITY_LABEL[issue.severity] ?? issue.severity}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] bg-zinc-900 border-zinc-700 text-zinc-400">
                        {CATEGORY_META[issue.category]?.label ?? issue.category}
                      </Badge>
                      <span>{issue.title}</span>
                    </div>
                    <p className="text-zinc-300 mb-1">{issue.message}</p>
                    <p className="text-zinc-500 italic flex items-center gap-1">
                      <CheckCircle2 size={10} className="text-emerald-500" />
                      <b>Fix :</b> {issue.fix}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended actions */}
          {audit.recommended_actions.length > 0 && (
            <div>
              <h3 className="text-sm font-bold mb-2 text-zinc-300 flex items-center gap-2">
                <Sparkles size={14} className="text-pink-400" />
                Quick wins recommandés ({audit.recommended_actions.length})
              </h3>
              <ul className="space-y-1.5">
                {audit.recommended_actions.map((rec, i) => (
                  <li
                    key={i}
                    className="rounded-lg border border-pink-500/20 bg-pink-500/5 p-2.5 text-xs text-zinc-200 flex items-start gap-2"
                  >
                    <Sparkles size={11} className="text-pink-400 shrink-0 mt-0.5" />
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Empty state */}
          {audit.issues.length === 0 && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-4 text-sm text-emerald-300 flex items-start gap-2">
              <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
              <div>
                Aucun problème majeur détecté sur la structure du site. Audit complet.
                <br />
                <span className="text-xs text-emerald-400/70">
                  Note : un audit <i>structurel</i> ne remplace pas un audit UX manuel avec utilisateurs.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryScoreCard({
  name,
  value,
}: {
  name: keyof CategoryScores;
  value: number;
}) {
  const Icon = pickCategoryIcon(name);
  const meta = CATEGORY_META[name];
  return (
    <div className={cn('rounded-lg border p-3 flex flex-col gap-1', scoreBg(value))}>
      <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-600">
        <Icon size={12} />
        {meta.label}
      </div>
      <div className={cn('text-2xl font-bold tabular-nums', scoreColor(value))}>{value}</div>
    </div>
  );
}

function pickCategoryIcon(name: string): React.ComponentType<{ size?: number }> {
  const n = safeString(name).toLowerCase();
  if (safeIncludes(n, 'ux')) return MousePointerClick;
  if (safeIncludes(n, 'perf')) return Zap;
  if (safeIncludes(n, 'seo')) return SearchIcon;
  if (safeIncludes(n, 'a11y') || safeIncludes(n, 'access')) return Smartphone;
  if (safeIncludes(n, 'structure')) return Layout;
  return Layers;
}
