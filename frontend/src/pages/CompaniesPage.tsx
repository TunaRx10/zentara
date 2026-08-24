/**
 * CompaniesPage — Round 34.
 *
 * Source = React Query (`useCompaniesQuery`).
 *
 * Round 24 — boutons câblés (Add, Run AI, Delete, Filters, Sort).
 * Round 25 — pagination progressive (5 par page → "Load more").
 * Round 27 — Toast global (`useToast`).
 * Round 34 — panneau de détail **inline** quand on clique une ligne :
 *   - Profil complet (secteur / industrie / HQ / adresse / téléphone /
 *     email / liens / social_profiles / status / score).
 *   - **AI Strategic Analysis** (lazy via `/api/intelligence/company/:id`)
 *     → summary + insights + recommendations + risks + scores détaillés.
 *   - **Real-time signals** (lazy via
 *     `/api/intelligence/:entityType/:entityId/signals`) : 5 derniers
 *     signaux monitoring + bouton "Voir tout".
 *   - **Prospecting notes** (parse le bloc "Zentara prospecting session
 *     …" injecté par `runProspecting` Round 32) : buying trigger,
 *     decision maker, intelligence problem, sources.
 *   - **Multi-agent stack** : badges des agents recommandés.
 *   - Boutons d'action : Re-run AI analysis (rapide),
 *     Force auto-analysis (deep), Delete.
 *
 * Round 34 — nouvelles colonnes du tableau :
 *   - **HQ** : city + country (prospecting)
 *   - **Signals** : compteur monitoring (lazy résolu quand on déplie la ligne)
 *   - **AI** : badge d'état analyse (vert/ambre/gris selon score + notes)
 */
import React from 'react';
import {
  Search,
  Plus,
  Globe,
  ExternalLink,
  Zap,
  Trash2,
  Users,
  Loader2,
  X,
  MapPin,
  Phone,
  Mail,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Bot,
  ShieldAlert,
  Lightbulb,
  Target,
  Activity,
  AlertTriangle,
  Brain,
  Crown,
  Layers,
  Briefcase,
  Tag,
  Building2,
  RefreshCw,
  Eye,
  Calendar,
  Workflow,
  BarChart3,
  Send,
  CheckCircle2,
  Palette,
  MailPlus,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Link, useNavigate } from 'react-router-dom';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { getApiClient } from '@/services/api/client';
import { isEmbeddedMode } from '@/embedded/embedded';
import {
  useCompaniesQuery,
  useIntelligenceForEntity,
  useSignalsForEntity,
  useCompanyProspectsQuery,
  useCompanyAggregateScoreQuery,
  useCompanyOutreachSummaryQuery,
  useAutoAnalysisFailuresQuery,
} from '@/hooks/useBackendData';
import {
  useAnalyzeMutation,
  useCreateCompanyMutation,
  useDeleteCompanyMutation,
  useForceAutoAnalyzeMutation,
  useGenerateOutreachDraftsMutation,
  useOutreachSendMutation,
  useOutreachRespondMutation,
} from '@/hooks/useEntityActions';
import { useShowMore } from '@/hooks/useShowMore';
import { useToast } from '@/contexts/ToastProvider';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { EmailComposerModal } from '@/components/EmailComposerModal';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { ImportDirectoryModal } from '@/components/ImportDirectoryModal';
import { cn, toDateMs, safeIncludes, safeString } from '@/lib/utils';
import {
  TierPill,
  ScoreCell,
  TierFilterChip,
  countByTier,
  getTier,
  type Tier,
} from '@/components/LeadTier';
import type {
  Company,
  Prospect,
  EmailDraftOutput,
  OutreachEmail,
  OutreachSequence,
  AggregateScore,
  EmailTone,
  EmailStatus,
  SequenceStatus,
  SequenceStep,
  AutoScrapePolicy,
} from '@/types';

// =====================================================================
// Helpers parsing
// =====================================================================

/** Heuristique : la company a-t-elle des notes de prospecting Round 32 ? */
function parseProspectingNotes(notes: unknown) {
  const notesStr = safeString(notes);
  if (!notesStr) return null;
  if (!notesStr.includes('Zentara prospecting session')) return null;
  const lines = notesStr.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: Record<string, string> = {};
  for (const line of lines) {
    if (line.startsWith('Tier:')) out.tier = line.slice(5).trim();
    else if (line.startsWith('Score:')) out.score = line.slice(6).trim();
    else if (line.startsWith('Buying trigger:')) out.buying_trigger = line.slice('Buying trigger:'.length + 1).trim();
    else if (line.startsWith('Decision maker:')) out.decision_maker = line.slice('Decision maker:'.length + 1).trim();
    else if (line.startsWith('Problem:')) out.intelligence_problem = line.slice('Problem:'.length + 1).trim();
    else if (line.startsWith('Zentara prospecting session')) out.session_id = line.split(' ').pop() ?? '';
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** JSON safe parser — accepte objet OU string OU null. */
function parseMaybeJsonArray<T = unknown>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v as T[];
  } catch { /* noop */ }
  return [];
}

/** Round 34 — format ISO timestamp en texte relatif court ("5m ago", "2h ago", "3d ago").
 *  Approximation volontairement tolérante aux fuseaux / drift. */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const deltaSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const m = Math.floor(deltaSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

// =====================================================================
// AddCompanyModal
// =====================================================================
function AddCompanyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (text: string) => void;
}): React.ReactElement | null {
  const createMut = useCreateCompanyMutation();
  const [name, setName] = React.useState('');
  const [sector, setSector] = React.useState('');
  const [industry, setIndustry] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [website, setWebsite] = React.useState('');
  // Round 92 — auto-scrape policy à la création.
  const [autoScrape, setAutoScrape] = React.useState<AutoScrapePolicy>('off');
  React.useEffect(() => {
    if (!open) {
      setName(''); setSector(''); setIndustry(''); setLocation(''); setWebsite('');
      setAutoScrape('off');
    }
  }, [open]);
  if (!open) return null;
  const valid = name.trim().length > 0;
  const submit = async () => {
    if (!valid) return;
    try {
      const locParts = location.split(',').map(s => s.trim());
      const city = locParts[0] || undefined;
      const country = locParts[1] || undefined;

      await createMut.mutateAsync({
        name: name.trim(),
        sector: sector.trim() || undefined,
        industry: industry.trim() || undefined,
        city,
        country,
        website: website.trim() || undefined,
        status: 'active',
        auto_scrape: autoScrape,
      } as Record<string, unknown>);
      // Si 'always' et website présent → un toast custom pour signaler
      // le déclenchement automatique.
      const lines = [`${name} créée.`];
      if (autoScrape === 'always' && website.trim()) {
        lines.push('Auto-scrape lancé en arrière-plan (création).');
      } else if (autoScrape === 'when_hot' && website.trim()) {
        lines.push('Auto-scrape en attente — se déclenchera quand score ≥ 70.');
      }
      onCreated(lines.join(' '));
      onClose();
    } catch (e) {
      void e;
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !createMut.isPending) onClose();
      }}
    >
      <div className="relative max-w-md w-[calc(100vw-32px)] rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10 p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black tracking-tight">Nouvelle société</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={createMut.isPending}
            aria-label="Fermer"
            className="h-8 w-8 rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground flex items-center justify-center disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Nom *</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Acme Corp" />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Secteur</span>
            <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="SaaS B2B" />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Industrie</span>
            <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Software" />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Localisation</span>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Paris, France" />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Website</span>
            <Input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://acme.com" />
          </label>
          {/* Round 92 — choix de la politique auto-scrape dès la création. */}
          <div className="space-y-1.5">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Auto-scrape à la création
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                { v: 'off', label: 'Off', color: 'border-slate-500/40 bg-slate-500/15 text-slate-500' },
                { v: 'always', label: 'À la création', color: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-400' },
                { v: 'when_hot', label: 'Score ≥ 70', color: 'border-amber-500/40 bg-amber-500/15 text-amber-400' },
              ] as Array<{ v: AutoScrapePolicy; label: string; color: string }>).map((opt) => {
                const active = opt.v === autoScrape;
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setAutoScrape(opt.v)}
                    className={
                      'text-[10px] uppercase tracking-widest font-bold rounded-lg border-2 px-2 py-1.5 transition-all ' +
                      (active
                        ? opt.color + ' shadow-lg'
                        : 'border-border/40 bg-card/40 hover:bg-secondary/30 text-muted-foreground')
                    }
                    title={
                      opt.v === 'off'
                        ? 'Aucune action automatique à la création.'
                        : opt.v === 'always'
                          ? 'Scrape immédiat si website présent.'
                          : 'Attend que le score atteigne 70+ (jamais à la création).'
                    }
                  >
                    {opt.label}
                    {active && <span className="ml-1">✓</span>}
                  </button>
                );
              })}
            </div>
            {autoScrape !== 'off' && !website.trim() && (
              <p className="text-[10px] text-amber-500 mt-1">
                ⚠ Sans URL de site web, le scrape automatique ne pourra pas se déclencher.
              </p>
            )}
          </div>
          {createMut.error && (
            <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded-md p-2">
              {(createMut.error as Error).message}
            </div>
          )}
          <div className="flex items-center gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={createMut.isPending} className="flex-1">Annuler</Button>
            <Button onClick={submit} disabled={!valid || createMut.isPending} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground">
              {createMut.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Plus size={14} className="mr-2" />}
              Ajouter
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// DetailPanel — Round 34 — expansé inline sous une row
// =====================================================================

function DetailPanel({
  company,
  onClose,
  onDelete,
  analysisFailed = false,
}: {
  company: Company;
  onClose: () => void;
  onDelete: (c: Company) => void;
  /** Round 42 — l'auto-analyse 7-engines de cette company a échoué récemment. */
  analysisFailed?: boolean;
}): React.ReactElement {
  const toast = useToast();
  const intelligenceQ = useIntelligenceForEntity('company', company.id);
  const signalsQ = useSignalsForEntity('company', company.id);
  const aggregateQ = useCompanyAggregateScoreQuery(company.id);
  const prospectsQ = useCompanyProspectsQuery(company.id);
  const outreachQ = useCompanyOutreachSummaryQuery(company.id);
  const analyzeMut = useAnalyzeMutation();
  const forceAutoMut = useForceAutoAnalyzeMutation();
  const draftMut = useGenerateOutreachDraftsMutation();
  const sendMut = useOutreachSendMutation();
  const respondMut = useOutreachRespondMutation();

  const prospectingNotes = React.useMemo(() => parseProspectingNotes(company.notes), [company.notes]);
  const intel = intelligenceQ.data ?? null;
  const signals = signalsQ.data ?? [];
  const prospects = prospectsQ.data ?? [];
  const aggregate = aggregateQ.data ?? null;
  const outreach = outreachQ.data ?? null;
  const insights = parseMaybeJsonArray<string>(intel?.insights);
  const recos = parseMaybeJsonArray<string>(intel?.recommendations);
  const risks = parseMaybeJsonArray<string>(intel?.risks);

  const onReAnalyze = async () => {
    try {
      toast.info(`Re-run AI pour ${company.name}…`);
      await analyzeMut.mutateAsync({ entityType: 'company', entityId: company.id, name: company.name });
      toast.success(`Analyse IA re-lancée.`);
      void intelligenceQ.refetch();
    } catch (e) {
      toast.error(`Re-analyse impossible : ${(e as Error).message}`);
    }
  };

  const onForceAuto = async () => {
    try {
      toast.info(`Force auto-analysis pour ${company.name}…`);
      await forceAutoMut.mutateAsync({ company_id: company.id });
      toast.success(`Auto-analysis déclenchée.`);
      void intelligenceQ.refetch();
    } catch (e) {
      toast.error(`Force auto échouée : ${(e as Error).message}`);
    }
  };

  return (
    <tr>
      <td colSpan={9} className="p-0">
        <div className="border-t border-primary/30 bg-gradient-to-br from-primary/5 via-card/40 to-card/30 backdrop-blur-sm">
          <div className="p-6 space-y-6">
            {/* Header strip */}
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-xl font-black tracking-tight">{company.name}</h3>
                  <TierPill tier={getTier(company.score ?? 0)} />
                  {prospectingNotes?.tier && (
                    <Badge className="bg-secondary text-muted-foreground border-border text-[10px]">
                      Zentara tier: {prospectingNotes.tier}
                    </Badge>
                  )}
                  {(company.score ?? 0) >= 70 && (
                    <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/30 text-[10px] flex items-center gap-1">
                      <Crown size={10} /> Hot ≥70
                    </Badge>
                  )}
                  {intel?.updated_at && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground font-mono bg-card border border-border/60 rounded-md px-1.5 py-0.5"
                      title={intel.updated_at}
                    >
                      <Calendar size={9} /> AI: {formatRelativeTime(intel.updated_at)}
                    </span>
                  )}
                  {signals.length > 0 && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-md px-1.5 py-0.5"
                      title={`${signals.length} monitoring signals (last ${signals[0]?.detected_at ? new Date(signals[0].detected_at).toLocaleDateString() : 'n/a'})`}
                    >
                      <Activity size={9} /> {signals.length} signals
                    </span>
                  )}
                  {analysisFailed && (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider bg-red-500/15 text-red-500 border border-red-500/30 rounded-md px-1.5 py-0.5"
                      title="L'auto-analyse 7-engines a échoué (timeout ou erreur provider). Relancez pour réessayer."
                    >
                      <AlertTriangle size={9} /> Auto-analyse échouée
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                  {company.industry && <span className="flex items-center gap-1"><Briefcase size={11} /> {company.industry}</span>}
                  {company.sector && company.sector !== company.industry && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-accent/10 text-accent border border-accent/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide" title="Secteur inféré par l'IA">
                      <Tag size={10} /> {company.sector}
                    </span>
                  )}
                  {(company.city || company.country) && (
                    <span className="flex items-center gap-1">
                      <MapPin size={11} /> {[company.city, company.country].filter(Boolean).join(', ')}
                    </span>
                  )}
                  {company.website && (
                    <a href={company.website} target="_blank" rel="noopener noreferrer"
                       className="flex items-center gap-1 hover:text-primary transition-colors">
                      <Globe size={11} /> {company.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {analysisFailed && (
                  <Button
                    onClick={onForceAuto}
                    disabled={forceAutoMut.isPending}
                    className="h-9 bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30"
                    title="L'auto-analyse a échoué — relancer l'analyse 7-engines maintenant"
                  >
                    {forceAutoMut.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <RefreshCw size={14} className="mr-2" />}
                    Relancer l'analyse
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={onReAnalyze}
                  disabled={analyzeMut.isPending}
                  className="h-9 border-border/60"
                  title="Re-run AI analysis (rapide, full pipeline)"
                >
                  {analyzeMut.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Zap size={14} className="mr-2" />}
                  Re-run AI
                </Button>
                <Button
                  onClick={onForceAuto}
                  disabled={forceAutoMut.isPending}
                  className="h-9 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border border-blue-500/30"
                  title="Force auto-analysis (deep 7-engines via /api/auto-analysis/analyze-now)"
                >
                  {forceAutoMut.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Bot size={14} className="mr-2" />}
                  Force auto-analysis
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onDelete(company)}
                  className="h-9 border-red-500/30 text-red-500 hover:bg-red-500/10"
                  title="Supprimer cette company"
                >
                  <Trash2 size={14} className="mr-2" /> Delete
                </Button>
                <Button
                  variant="outline"
                  onClick={onClose}
                  className="h-9 border-border/60"
                  title="Fermer le panneau de détail"
                >
                  <X size={14} />
                </Button>
              </div>
            </div>

            {/* Grid 2 colonnes : Profil + AI Strategic Analysis */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Colonne gauche — Profil */}
              <Card title="Company profile" icon={<Building2 size={14} />}>
                <DetailItem label="Secteur" value={company.sector ?? '—'} icon={<Briefcase size={11} />} />
                <DetailItem label="Industrie" value={company.industry ?? '—'} icon={<Layers size={11} />} />
                <DetailItem label="HQ" value={[company.city, company.country].filter(Boolean).join(', ') || company.location || '—'} icon={<MapPin size={11} />} />
                <DetailItem label="Adresse" value={company.address ?? '—'} icon={<Building2 size={11} />} />
                <DetailItem label="Website" value={company.website ?? '—'} icon={<Globe size={11} />} link />
                <DetailItem label="Téléphone" value={company.phone ?? '—'} icon={<Phone size={11} />} link />
                <DetailItem label="Email" value={company.email ?? '—'} icon={<Mail size={11} />} link />
                <DetailItem label="Status" value={company.status ?? 'active'} icon={<Activity size={11} />} />
                <DetailItem label="Google Maps" value={company.google_maps_url ?? '—'} icon={<MapPin size={11} />} link />
                {company.social_profiles && (
                  <div className="pt-2 border-t border-border/40">
                    <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">Social profiles</div>
                    <div className="text-xs break-words font-mono text-muted-foreground/80">
                      {company.social_profiles}
                    </div>
                  </div>
                )}
                {parseMaybeJsonArray<{ source: string; url: string; title?: string }>(company.social_profiles as unknown as string).length > 0 && (
                  <div className="pt-2">
                    {parseMaybeJsonArray<{ source: string; url: string; title?: string }>(company.social_profiles as unknown as string).map((p, i) => (
                      <a key={i} href={p.url} target="_blank" rel="noopener noreferrer"
                         className="text-xs text-primary hover:underline flex items-center gap-1 truncate">
                        <ExternalLink size={10} /> {p.title ?? p.source}
                      </a>
                    ))}
                  </div>
                )}
              </Card>

              {/* Colonne milieu — AI Strategic Analysis */}
              <Card title="AI Strategic Analysis" icon={<Brain size={14} />} accent="primary" className="lg:col-span-2">
                {intelligenceQ.isLoading ? (
                  <div className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Chargement de l'analyse…
                  </div>
                ) : !intel || (!intel.summary && !insights.length && !recos.length && !risks.length) ? (
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p>📭 Pas encore d'analyse IA pour cette company.</p>
                    <p className="text-xs">
                      Clique <em>Re-run AI</em> pour déclencher le pipeline complet (cache + cascade) ou
                      <em> Force auto-analysis</em> pour relancer le sweep 7-engines.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {intel.summary && (
                      <p className="text-sm italic leading-relaxed text-foreground/90 border-l-2 border-primary/40 pl-3">
                        « {intel.summary} »
                      </p>
                    )}
                    {(intel.relevance_score != null ||
                      intel.opportunity_score != null ||
                      intel.confidence_score != null) && (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                        {intel.relevance_score != null && (
                          <ScoreMicro label="Relevance" value={intel.relevance_score} color="blue" />
                        )}
                        {intel.opportunity_score != null && (
                          <ScoreMicro label="Opportunity" value={intel.opportunity_score} color="purple" />
                        )}
                        {intel.intent_score != null && (
                          <ScoreMicro label="Intent" value={intel.intent_score} color="green" />
                        )}
                        {intel.activity_score != null && (
                          <ScoreMicro label="Activity" value={intel.activity_score} color="amber" />
                        )}
                        {intel.confidence_score != null && (
                          <ScoreMicro label="Confidence" value={intel.confidence_score} color="cyan" />
                        )}
                        {intel.score != null && (
                          <ScoreMicro label="Composite" value={intel.score} color="primary" />
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <ChipsCard title="Insights" icon={<Lightbulb size={12} />} accent="green" items={insights.slice(0, 6)} />
                      <ChipsCard title="Recommendations" icon={<Target size={12} />} accent="blue" items={recos.slice(0, 6)} />
                      <ChipsCard title="Risks" icon={<ShieldAlert size={12} />} accent="red" items={risks.slice(0, 6)} />
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {/* Real-time signals */}
            <Card
              title={`Real-time signals (${signals.length})`}
              icon={<Activity size={14} />}
              accent="amber"
              action={
                <SeverityCounter signals={signals} />
              }
            >
              {signalsQ.isLoading ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Chargement des signaux…
                </p>
              ) : signals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun signal monitoring encore rattaché à cette entité. Le watcher Round 26 génère des signaux toutes les 10 min à partir des entités scorées.</p>
              ) : (
                <div className="space-y-3">
                  {/* Segments row — agrégation des signal_type */}
                  <SignalSegments signals={signals} />
                  {/* Liste rankée par confidence */}
                  <ul className="space-y-2">
                    {signals.slice(0, 6).map((s) => (
                      <SignalRow key={s.id} sig={s} />
                    ))}
                    {signals.length > 6 && (
                      <li className="text-[10px] text-muted-foreground/70 italic pt-1">
                        +{signals.length - 6} autres signaux (voir Monitoring page)
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </Card>

            {/* Prospecting notes (Round 32) */}
            {prospectingNotes && (
              <Card
                title={`Zentara prospecting session ${prospectingNotes.session_id?.slice(-6) ?? ''}`}
                icon={<Sparkles size={14} />}
                accent="purple"
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                  {prospectingNotes.tier && <DetailItem label="Tier prospect" value={prospectingNotes.tier} icon={<Crown size={11} />} />}
                  {prospectingNotes.score && <DetailItem label="Score prospect" value={prospectingNotes.score} icon={<Zap size={11} />} />}
                  {prospectingNotes.buying_trigger && (
                    <div className="md:col-span-3 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400">
                      <div className="text-[10px] uppercase tracking-widest font-bold opacity-80 mb-1 flex items-center gap-1">
                        <Zap size={10} /> Buying trigger
                      </div>
                      <div>{prospectingNotes.buying_trigger}</div>
                    </div>
                  )}
                  {prospectingNotes.decision_maker && (
                    <DetailItem label="Decision maker" value={prospectingNotes.decision_maker} icon={<Crown size={11} />} />
                  )}
                  {prospectingNotes.intelligence_problem && (
                    <div className="md:col-span-3 p-2 rounded-md bg-blue-500/10 border border-blue-500/20 text-blue-400">
                      <div className="text-[10px] uppercase tracking-widest font-bold opacity-80 mb-1 flex items-center gap-1">
                        <ShieldAlert size={10} /> Intelligence problem
                      </div>
                      <div>{prospectingNotes.intelligence_problem}</div>
                    </div>
                  )}
                </div>
                <div className="mt-3 text-[10px] text-muted-foreground italic">
                  Ces informations proviennent de la session <code className="font-mono">{prospectingNotes.session_id}</code> du moteur stratégique Zentara (Round 32).
                </div>
              </Card>
            )}

            {/* === Round 35 — Section: Aggregate score, Prospects, Email drafts, Outreach timeline === */}
            <Card title="Aggregate score (multi-source)" icon={<BarChart3 size={14} />} accent="primary">
              {aggregateQ.isLoading ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Calcul…
                </p>
              ) : !aggregate ? (
                <p className="text-sm text-muted-foreground">Score agrégé indisponible.</p>
              ) : (
                <AggregateScoreBlock
                  agg={aggregate}
                  liveSent={outreach?.total_sent ?? 0}
                  liveReplied={outreach?.total_replied ?? 0}
                />
              )}
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card title={`Prospects (${prospects.length})`} icon={<Users size={14} />} accent="primary">
                {prospectsQ.isLoading ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Chargement…
                  </p>
                ) : prospects.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Aucun prospect rattaché à <code className="font-mono">{company.name}</code>.
                    <br />
                    <span className="text-xs">Pour lier un prospect existant, édite sa fiche et select cette company dans le champ <em>Company</em>.</span>
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {prospects.slice(0, 6).map((p) => (
                      <CompanyProspectRow key={p.id} prospect={p} />
                    ))}
                    {prospects.length > 6 && (
                      <li className="text-[10px] italic text-muted-foreground pt-1">
                        +{prospects.length - 6} autres (voir Prospects page)
                      </li>
                    )}
                  </ul>
                )}
              </Card>

              <EmailDraftsCard
                prospects={prospects}
                draftsCache={[]}
                draftsLoading={draftMut.isPending}
                onGenerate={(prospectId, tone, simulate) =>
                  draftMut.mutateAsync({ prospect_id: prospectId, tone, simulate, persist: true })
                }
                onSend={async (emailId) => sendMut.mutateAsync({ email_id: emailId })}
                onMarkResponse={async (emailId, response) =>
                  respondMut.mutateAsync({ email_id: emailId, response })
                }
                toast={toast}
              />
            </div>

            <OutreachTimelineCard
              outreach={outreach}
              loading={outreachQ.isLoading}
              onSend={async (emailId) => sendMut.mutateAsync({ email_id: emailId })}
              onMarkResponse={async (emailId, response) =>
                respondMut.mutateAsync({ email_id: emailId, response })
              }
            />
          </div>
        </div>
      </td>
    </tr>
  );
}

// =====================================================================
// Sub-components UI (Card / DetailItem / ChipsCard / ScoreMicro)
// =====================================================================

function Card({
  title,
  icon,
  accent,
  action,
  children,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  accent?: 'primary' | 'amber' | 'purple';
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section className={cn(
      'rounded-xl border border-border/60 bg-card/50 p-4 space-y-2',
      accent === 'primary' && 'border-primary/30 bg-gradient-to-br from-primary/5 to-card/40',
      accent === 'amber' && 'border-amber-500/30',
      accent === 'purple' && 'border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-card/40',
      className,
    )}>
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-bold flex items-center gap-1.5 text-foreground/90">{icon}{title}</h4>
        {action}
      </header>
      {children}
    </section>
  );
}

function DetailItem({
  label, value, icon, link,
}: { label: string; value: string; icon?: React.ReactNode; link?: boolean }) {
  const isLink = link && typeof value === 'string' && /^https?:\/\//.test(value);
  const isMail = !isLink && typeof value === 'string' && /@/.test(value) && value !== '—';
  return (
    <div className="flex items-start gap-2 text-xs py-0.5">
      {icon && <span className="text-muted-foreground shrink-0 mt-0.5">{icon}</span>}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/80">{label}</div>
        {isLink ? (
          <a href={value} target="_blank" rel="noopener noreferrer"
             className="text-primary hover:underline truncate flex items-center gap-1">
            {value.replace(/^https?:\/\//, '')}
            <ExternalLink size={10} />
          </a>
        ) : isMail ? (
          <a href={`mailto:${value}`} className="text-primary hover:underline truncate flex items-center gap-1">
            {value}
          </a>
        ) : (
          <div className="truncate">{value}</div>
        )}
      </div>
    </div>
  );
}

function ChipsCard({
  title, items, icon, accent,
}: { title: string; items: string[]; icon: React.ReactNode; accent: 'green' | 'blue' | 'red' }) {
  const cls: Record<typeof accent, string> = {
    green: 'bg-green-500/10 text-green-400 border-green-500/20',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    red: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  return (
    <div className={cn('rounded-lg border p-3', cls[accent])}>
      <div className="text-[10px] uppercase tracking-widest font-bold mb-1.5 flex items-center gap-1">{icon}{title}</div>
      {items.length === 0 ? (
        <p className="text-xs italic opacity-70">— vide —</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {items.map((it, i) => (
            <li key={i} className="leading-snug flex items-start gap-1.5">
              <span className="w-1 h-1 rounded-full bg-current shrink-0 mt-1.5" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =====================================================================
// Round 35 — AggregateScoreBlock + CompanyProspectRow + EmailDraftsCard + OutreachTimelineCard
// =====================================================================

function AggregateScoreBlock({
  agg,
  liveSent,
  liveReplied,
}: {
  agg: AggregateScore;
  liveSent: number;
  liveReplied: number;
}): React.ReactElement {
  const score = agg.score;
  const tierCls =
    agg.tier === 'HOT' ? 'text-red-500 bg-red-500/10 border-red-500/30'
    : agg.tier === 'WARM' ? 'text-amber-500 bg-amber-500/10 border-amber-500/30'
    : 'text-blue-500 bg-blue-500/10 border-blue-500/30';
  const dotCls =
    agg.tier === 'HOT' ? 'bg-red-500'
    : agg.tier === 'WARM' ? 'bg-amber-500'
    : 'bg-blue-500';
  return (
    <div className="space-y-3">
      <div className="flex items-end gap-4">
        <div>
          <div className="text-5xl font-black tabular-nums leading-none bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-transparent">
            {score}
          </div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mt-1">
            Aggregate score · /100
          </div>
        </div>
        <span className={cn('inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-black uppercase tracking-widest', tierCls)}>
          <span className={cn('w-1.5 h-1.5 rounded-full', dotCls)} />
          {agg.tier}
        </span>
        <div className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground/80 font-bold">
          live <span className="text-foreground">{liveSent}</span> sent · <span className="text-foreground">{liveReplied}</span> replied
        </div>
      </div>
      <div className="h-2 w-full bg-secondary/40 rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all duration-700',
            agg.tier === 'HOT' ? 'bg-gradient-to-r from-amber-500 to-red-500'
            : agg.tier === 'WARM' ? 'bg-gradient-to-r from-amber-500 to-yellow-400'
            : 'bg-gradient-to-r from-lime-900 to-lime-600')}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <BreakdownPill label="Company" value={agg.breakdown.company_score} />
        <BreakdownPill label="Prospects" detail={`${agg.breakdown.prospects_count} · avg ${agg.breakdown.prospects_avg}`} value={agg.breakdown.prospects_avg} />
        <BreakdownPill label="Intelligence" value={agg.breakdown.intelligence_score ?? 0} muted={agg.breakdown.intelligence_score == null} />
        <BreakdownPill label="Signals C·W" detail={`${agg.breakdown.critical_signals} / ${agg.breakdown.warning_signals}`} value={Math.min(100, (agg.breakdown.critical_signals * 8) + (agg.breakdown.warning_signals * 3))} />
      </div>
    </div>
  );
}

function BreakdownPill({ label, detail, value, muted }: {
  label: string;
  detail?: string;
  value: number;
  muted?: boolean;
}): React.ReactElement {
  return (
    <div className={cn(
      'rounded-md border p-2 bg-card/40',
      muted ? 'border-border/40 opacity-60' : 'border-border/60',
    )}>
      <div className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground/80">{label}</div>
      <div className="flex items-end justify-between gap-1 mt-0.5">
        <div className="text-base font-black tabular-nums">{value}<span className="text-[10px] text-muted-foreground/60 font-bold ml-0.5">/100</span></div>
        {detail && <div className="text-[9px] text-muted-foreground/70 font-mono">{detail}</div>}
      </div>
      <div className="mt-1 h-1 bg-secondary/40 rounded-full overflow-hidden">
        <div className={cn('h-full', muted ? 'bg-slate-500/40' : 'bg-primary/70')} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function CompanyProspectRow({ prospect }: { prospect: Prospect }): React.ReactElement {
  const score = prospect.score ?? 0;
  return (
    <li className="flex items-center gap-2 text-xs py-1 px-2 rounded-md hover:bg-secondary/30 transition-colors">
      <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-black text-[10px] uppercase">
        {`${prospect.first_name?.[0] ?? '?'}${prospect.last_name?.[0] ?? '?'}`}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold truncate flex items-center gap-2">
          {prospect.first_name} {prospect.last_name}
          {prospect.role && (
            <span className="text-[10px] text-muted-foreground font-normal">· {prospect.role}</span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
          {prospect.email ? <><Mail size={9} /> {prospect.email}</> : <span>—</span>}
        </div>
      </div>
      <Badge className={cn(
        'text-[9px] font-black uppercase tracking-wider border',
        score >= 70 ? 'bg-red-500/15 text-red-500 border-red-500/30'
        : score >= 40 ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
        : 'bg-slate-500/15 text-slate-400 border-slate-500/30',
      )}>
        {score}
      </Badge>
    </li>
  );
}

type OutreachToastLike = {
  info: (m: string) => void;
  success: (m: string) => void;
  error: (m: string) => void;
};

function EmailDraftsCard(props: {
  prospects: Prospect[];
  draftsCache: EmailDraftOutput[]; // unused — kept for symmetry / parent override
  draftsLoading: boolean;
  onGenerate: (
    prospect_id: string,
    tone: 'cold' | 'follow_up' | 'breakup' | 'reply' | 'all',
    simulate: boolean,
  ) => Promise<{ data?: { drafts?: EmailDraftOutput[]; persisted?: OutreachEmail[] } }>;
  onSend: (email_id: string) => Promise<{ data?: { email?: OutreachEmail } }>;
  onMarkResponse: (email_id: string, response: 'replied' | 'bounced' | 'opened' | 'failed') => Promise<unknown>;
  toast: OutreachToastLike;
}): React.ReactElement {
  const [selectedProspectId, setSelectedProspectId] = React.useState<string | null>(null);
  const [generateTone, setGenerateTone] = React.useState<'cold' | 'follow_up' | 'breakup' | 'all'>('all');
  const [simulate, setSimulate] = React.useState(false);
  const [drafts, setDrafts] = React.useState<EmailDraftOutput[]>([]);
  const [persistedIds, setPersistedIds] = React.useState<string[]>([]);

  // Auto-pick first prospect when list arrives.
  React.useEffect(() => {
    if (!selectedProspectId && props.prospects.length > 0) {
      setSelectedProspectId(props.prospects[0].id);
    }
    if (selectedProspectId && !props.prospects.find((p) => p.id === selectedProspectId)) {
      setSelectedProspectId(props.prospects[0]?.id ?? null);
    }
  }, [props.prospects, selectedProspectId]);

  const onGenerate = async () => {
    if (!selectedProspectId) return;
    try {
      props.toast.info('Génération IA…');
      const r = await props.onGenerate(selectedProspectId, generateTone, simulate);
      const newDrafts = r.data?.drafts ?? [];
      const persisted = r.data?.persisted ?? [];
      setDrafts(newDrafts);
      setPersistedIds(persisted.map((p) => p.id));
      props.toast.success(`${newDrafts.length} draft${newDrafts.length > 1 ? 's' : ''} généré${newDrafts.length > 1 ? 's' : ''}${simulate ? ' (stub)' : ''}.`);
    } catch (e) {
      props.toast.error(`Draft impossible : ${(e as Error).message}`);
    }
  };

  const onSend = async (emailId: string) => {
    try {
      props.toast.info(`Marquage envoyé…`);
      await props.onSend(emailId);
      props.toast.success(`Email marqué comme envoyé.`);
    } catch (e) {
      props.toast.error(`Send impossible : ${(e as Error).message}`);
    }
  };

  return (
    <Card title="Email drafts (IA outreach)" icon={<Send size={14} />} accent="purple">
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <select
            value={selectedProspectId ?? ''}
            onChange={(e) => setSelectedProspectId(e.target.value || null)}
            className="h-8 px-2 rounded-md border border-border bg-card/60 text-xs"
          >
            {props.prospects.length === 0 ? (
              <option value="">Aucun prospect rattaché</option>
            ) : (
              props.prospects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name} {p.role ? `· ${p.role}` : ''}
                </option>
              ))
            )}
          </select>
          <select
            value={generateTone}
            onChange={(e) => setGenerateTone(e.target.value as typeof generateTone)}
            className="h-8 px-2 rounded-md border border-border bg-card/60 text-xs"
          >
            <option value="all">Cold + Follow + Breakup</option>
            <option value="cold">Cold intro</option>
            <option value="follow_up">Follow-up</option>
            <option value="breakup">Breakup</option>
          </select>
          <label className="flex items-center gap-1 text-[10px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={simulate}
              onChange={(e) => setSimulate(e.target.checked)}
              className="h-3 w-3"
            />
            simulate (stub)
          </label>
          <Button
            size="sm"
            onClick={onGenerate}
            disabled={!selectedProspectId || props.draftsLoading}
            className="h-8 bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30"
          >
            {props.draftsLoading ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Sparkles size={12} className="mr-1" />}
            Generate
          </Button>
        </div>

        {drafts.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Choisis un prospect + tonalité puis clique Generate.
          </p>
        ) : (
          <div className="space-y-2">
            {drafts.map((d, i) => (
              <div key={i} className="border border-border/60 bg-card/40 rounded-md p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={cn(
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border',
                    d.recommended_next_step === 'cold' ? 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30'
                    : d.recommended_next_step === 'follow_up_1' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                    : d.recommended_next_step === 'follow_up_2' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                    : 'bg-red-500/15 text-red-400 border-red-500/30',
                  )}>
                    {d.recommended_next_step}
                  </span>
                  <span className="text-[10px] font-bold text-muted-foreground/80">
                    pers {d.personalization_score}% · cta "{d.call_to_action.slice(0, 30)}…"
                  </span>
                  {persistedIds[i] && (
                    <button
                      type="button"
                      onClick={() => onSend(persistedIds[i])}
                      className="ml-auto h-6 px-2 rounded text-[10px] uppercase font-black tracking-widest bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 transition-colors flex items-center gap-1"
                    >
                      <Send size={9} /> Mark sent
                    </button>
                  )}
                </div>
                <div className="text-xs font-bold text-foreground mb-1">📧 {d.subject}</div>
                <pre className="text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground/85">{d.body}</pre>
                <div className="text-[10px] italic text-muted-foreground/80 mt-1.5">
                  💡 {d.rationale}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground italic pt-1">
              Les drafts sont persistés (status: <code className="font-mono">draft</code>) et la séquence outbound est créée pour ce prospect.
              Clique "Mark sent" pour simuler l'envoi (passe en <code className="font-mono">sent</code>, avance au step suivant).
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

const STEP_BADGE: Record<SequenceStep, { cls: string; label: string }> = {
  cold: { cls: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30', label: 'Cold intro' },
  follow_up_1: { cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30', label: 'Follow-up #1' },
  follow_up_2: { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'Follow-up #2' },
  breakup: { cls: 'bg-red-500/15 text-red-400 border-red-500/30', label: 'Breakup (J+14)' },
  replied: { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'Réponse reçue' },
  bounced: { cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30', label: 'Bounced' },
};

const TONE_PILL: Record<EmailTone, string> = {
  cold: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  follow_up: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  breakup: 'bg-red-500/10 text-red-400 border-red-500/30',
  reply: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  manual: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
};

function OutreachTimelineCard(props: {
  outreach: { emails: OutreachEmail[]; sequences: OutreachSequence[]; total_emails: number; total_replied: number; total_bounced: number; total_active_sequences: number } | null;
  loading: boolean;
  onSend: (email_id: string) => Promise<unknown>;
  onMarkResponse: (email_id: string, response: 'replied' | 'bounced' | 'opened' | 'failed') => Promise<unknown>;
}): React.ReactElement {
  const data = props.outreach;
  return (
    <Card title="Outreach sequence timeline" icon={<Workflow size={14} />} accent="purple">
      {props.loading ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Chargement…
        </p>
      ) : !data || data.total_emails === 0 ? (
        <p className="text-sm text-muted-foreground">
          Aucune communication outbound pour cette company (génère des drafts dans <em>Email drafts</em> pour démarrer une séquence).
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <MetricPill label="Total emails" value={data.total_emails} accent="primary" />
            <MetricPill label="Sent" value={data.emails.filter((e) => e.status === 'sent' || e.status === 'opened' || e.status === 'replied').length} accent="blue" />
            <MetricPill label="Replied" value={data.total_replied} accent="green" />
            <MetricPill label="Bounced" value={data.total_bounced} accent="red" />
          </div>

          <div className="space-y-1.5">
            {data.emails.slice(0, 8).map((e) => (
              <OutreachEmailRow
                key={e.id}
                email={e}
                sequence={data.sequences.find((s) => s.last_email_id === e.id) ?? null}
                onSend={props.onSend}
                onMarkResponse={props.onMarkResponse}
              />
            ))}
            {data.emails.length > 8 && (
              <p className="text-[10px] italic text-muted-foreground pt-1">
                +{data.emails.length - 8} autres emails (voir <Link to="/campaigns" className="text-primary hover:underline">Campaigns</Link>).
              </p>
            )}
          </div>

          {data.sequences.length > 0 && (
            <div className="pt-2 border-t border-border/40">
              <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                Séquences actives
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {data.sequences.slice(0, 6).map((s) => (
                  <SequencePill key={s.id} seq={s} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function MetricPill({ label, value, accent }: {
  label: string; value: number; accent: 'primary' | 'blue' | 'green' | 'red';
}): React.ReactElement {
  const cls: Record<typeof accent, string> = {
    primary: 'text-primary border-primary/30',
    blue: 'text-blue-400 border-blue-500/30',
    green: 'text-emerald-400 border-emerald-500/30',
    red: 'text-red-400 border-red-500/30',
  };
  return (
    <div className={cn('flex flex-col gap-0.5 px-2 py-1.5 rounded-md border bg-card/40', cls[accent])}>
      <span className="opacity-70">{label}</span>
      <span className="text-sm font-black tabular-nums">{value}</span>
    </div>
  );
}

function OutreachEmailRow(props: {
  email: OutreachEmail;
  sequence: OutreachSequence | null;
  onSend: (id: string) => Promise<unknown>;
  onMarkResponse: (id: string, response: 'replied' | 'bounced' | 'opened' | 'failed') => Promise<unknown>;
}): React.ReactElement {
  const e = props.email;
  const statusCls =
    e.status === 'replied' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : e.status === 'sent' || e.status === 'opened' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
    : e.status === 'bounced' || e.status === 'failed' ? 'bg-red-500/15 text-red-400 border-red-500/30'
    : 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  const stepCls = props.sequence ? STEP_BADGE[props.sequence.current_step] : null;

  return (
    <div className="border border-border/40 bg-card/30 rounded-md p-2.5 text-xs">
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border', TONE_PILL[e.tone])}>
          {e.tone}
        </span>
        <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border', statusCls)}>
          {e.status}
        </span>
        {stepCls && (
          <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border', stepCls.cls)}>
            {stepCls.label}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/80 font-mono ml-auto">
          {new Date(e.created_at).toLocaleString()}
        </span>
      </div>
      <div className="font-bold text-foreground leading-tight">📧 {e.subject}</div>
      <details className="mt-1.5 group">
        <summary className="cursor-pointer text-[10px] uppercase tracking-widest font-bold text-muted-foreground hover:text-primary transition-colors list-none inline-flex items-center gap-1">
          <ChevronDown size={11} className="transition-transform group-open:rotate-180" />
          Voir le corps
        </summary>
        <pre className="mt-1 text-xs whitespace-pre-wrap font-mono leading-relaxed text-foreground/85 p-2 rounded-md bg-secondary/20 border border-border/30">
          {e.body}
        </pre>
      </details>
      {e.status === 'draft' && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => props.onSend(e.id)}
            className="h-6 px-2 rounded text-[10px] uppercase font-black tracking-widest bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 transition-colors flex items-center gap-1"
          >
            <Send size={9} /> Mark sent
          </button>
        </div>
      )}
      {(e.status === 'sent' || e.status === 'opened') && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => props.onMarkResponse(e.id, 'replied')}
            className="h-6 px-2 rounded text-[10px] uppercase font-black tracking-widest bg-emerald-500/15 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/25 transition-colors flex items-center gap-1"
          >
            <CheckCircle2 size={9} /> Mark replied
          </button>
          <button
            type="button"
            onClick={() => props.onMarkResponse(e.id, 'bounced')}
            className="h-6 px-2 rounded text-[10px] uppercase font-black tracking-widest bg-slate-500/15 text-slate-400 border border-slate-500/40 hover:bg-slate-500/25 transition-colors flex items-center gap-1"
          >
            <X size={9} /> Bounced
          </button>
        </div>
      )}
    </div>
  );
}

function SequencePill({ seq }: { seq: OutreachSequence }): React.ReactElement {
  const step = STEP_BADGE[seq.current_step];
  const statusCls =
    seq.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : seq.status === 'completed' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
    : seq.status === 'paused' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
    : 'bg-slate-500/10 text-slate-400 border-slate-500/30';
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border', step.cls)}>
      {step.label}
      <span className="opacity-50">·</span>
      <span className={cn('text-[9px] uppercase tracking-widest px-1 rounded', statusCls)}>
        {seq.status}
      </span>
      <span className="text-[9px] text-muted-foreground/60 ml-0.5">×{seq.attempts}</span>
    </span>
  );
}

const SEVERITY_COLOR: Record<'critical' | 'warning' | 'info' | 'ok', { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/15', text: 'text-red-400 border-red-500/40', label: 'CRITICAL' },
  warning:  { bg: 'bg-amber-500/15', text: 'text-amber-400 border-amber-500/40', label: 'WARNING' },
  info:     { bg: 'bg-blue-500/15', text: 'text-blue-400 border-blue-500/40', label: 'INFO' },
  ok:       { bg: 'bg-slate-500/10', text: 'text-slate-400 border-slate-500/30', label: 'LOW' },
};

/** Compute severity from confidence (mirror backend monitoringRowToDto). */
function severityOf(confidence: number): 'critical' | 'warning' | 'info' | 'ok' {
  if (confidence >= 90) return 'critical';
  if (confidence >= 80) return 'warning';
  if (confidence >= 70) return 'info';
  return 'ok';
}

function SeverityCounter({ signals }: { signals: Array<{ severity?: string; confidence: number }> }): React.ReactElement | null {
  const counts = React.useMemo(() => {
    const out: Record<'critical' | 'warning' | 'info' | 'ok', number> = { critical: 0, warning: 0, info: 0, ok: 0 };
    for (const s of signals) {
      const sev = (s.severity as 'critical' | 'warning' | 'info' | 'ok') ?? severityOf(s.confidence ?? 0);
      out[sev] += 1;
    }
    return out;
  }, [signals]);
  if (signals.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-bold">
      {(['critical', 'warning', 'info', 'ok'] as const).map((k) => {
        const n = counts[k];
        if (n === 0) return null;
        return (
          <span key={k} className={cn('px-1.5 py-0.5 rounded border', SEVERITY_COLOR[k].bg, SEVERITY_COLOR[k].text)}>
            {SEVERITY_COLOR[k].label} {n}
          </span>
        );
      })}
    </div>
  );
}

function SignalRow({ sig }: { sig: { id: string; source: string; type: string; signal?: string; content: string; confidence: number; severity?: string; detected_at: string } }): React.ReactElement {
  const sev = (sig.severity as 'critical' | 'warning' | 'info' | 'ok') ?? severityOf(sig.confidence ?? 0);
  const txt = sig.signal ?? sig.content;
  return (
    <li className="flex items-start gap-2 text-xs py-1 px-2 rounded-md hover:bg-secondary/20 transition-colors">
      <span className={cn(
        'px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border shrink-0',
        SEVERITY_COLOR[sev].bg, SEVERITY_COLOR[sev].text,
      )}>
        {sev === 'critical' && '⚠ '}{SEVERITY_COLOR[sev].label}
      </span>
      <Badge className="bg-secondary text-muted-foreground border-border text-[10px] shrink-0">
        {sig.source}
      </Badge>
      <Badge variant="outline" className="text-[10px] text-foreground/80 border-border/60 shrink-0">
        {sig.type}
      </Badge>
      <span className="flex-1 text-foreground/90 leading-snug">{txt}</span>
      <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
        {sig.confidence}% · {new Date(sig.detected_at).toLocaleDateString()}
      </span>
    </li>
  );
}

/**
 * Round 34 — Compact signal count + severity breakdown affiché dans la
 * colonne "Signals" du tableau principal (visible à partir de `xl:`).
 * Lazy load via `useSignalsForEntity` → réutilise le cache React Query.
 */
function SignalMiniCount({ companyId }: { companyId: string }): React.ReactElement {
  const q = useSignalsForEntity('company', companyId);
  if (q.isLoading) {
    return <Loader2 size={12} className="animate-spin text-muted-foreground" />;
  }
  const list = q.data ?? [];
  if (list.length === 0) {
    return <span className="text-[10px] text-muted-foreground/60 font-mono">—</span>;
  }
  const counts = { critical: 0, warning: 0, info: 0, ok: 0 };
  for (const s of list) {
    const sev = (s.severity as 'critical' | 'warning' | 'info' | 'ok') ?? severityOf(s.confidence ?? 0);
    counts[sev] += 1;
  }
  return (
    <div className="flex items-center gap-1 text-[10px] font-bold">
      <span className="tabular-nums text-foreground mr-0.5">{list.length}</span>
      {(['critical', 'warning', 'info'] as const).map((k) => {
        if (counts[k] === 0) return null;
        return (
          <span key={k} className={cn(
            'w-1.5 h-1.5 rounded-full',
            k === 'critical' ? 'bg-red-500'
              : k === 'warning' ? 'bg-amber-500'
                : 'bg-blue-500',
          )} title={`${SEVERITY_COLOR[k].label}: ${counts[k]}`} />
        );
      })}
    </div>
  );
}

/**
 * Round 34 — segment pills (signed types uniques avec décompte).
 * Donne une lecture rapide des *catégories* de signaux qui touchent
 * l'entité (Hiring, Expansion, Tech adoption, …).
 */
function SignalSegments({ signals }: { signals: Array<{ type: string; severity?: string; confidence: number }> }): React.ReactElement | null {
  const segs = React.useMemo(() => {
    const m = new Map<string, { count: number; maxConf: number }>();
    for (const s of signals) {
      const key = s.type || 'Signal';
      const cur = m.get(key) ?? { count: 0, maxConf: 0 };
      cur.count += 1;
      cur.maxConf = Math.max(cur.maxConf, s.confidence ?? 0);
      m.set(key, cur);
    }
    return Array.from(m.entries()).sort((a, b) => b[1].count - a[1].count);
  }, [signals]);
  if (segs.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap" aria-label="Signal segments">
      <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Segments:</span>
      {segs.map(([label, info]) => (
        <span
          key={label}
          className={cn(
            'inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border',
            SEVERITY_COLOR[severityOf(info.maxConf)].bg,
            SEVERITY_COLOR[severityOf(info.maxConf)].text,
          )}
        >
          {label} <span className="opacity-70">×{info.count}</span>
        </span>
      ))}
    </div>
  );
}

function ScoreMicro({
  label, value, color,
}: { label: string; value: number; color: 'blue' | 'purple' | 'green' | 'amber' | 'cyan' | 'primary' }) {
  const cls: Record<typeof color, string> = {
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    green: 'bg-green-500',
    amber: 'bg-amber-500',
    cyan: 'bg-cyan-500',
    primary: 'bg-primary',
  };
  return (
    <div className="rounded-md border border-border bg-card/40 p-2">
      <div className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground/80">{label}</div>
      <div className="text-xl font-black tabular-nums mb-1">{value}%</div>
      <div className="h-1 w-full bg-secondary/30 rounded-full overflow-hidden">
        <div className={cn('h-full', cls[color])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

// =====================================================================
// Page principale
// =====================================================================

type SortKey = 'score-desc' | 'score-asc' | 'name-asc' | 'name-desc' | 'date-desc';

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'score-desc', label: 'Score ↓' },
  { id: 'score-asc', label: 'Score ↑' },
  { id: 'name-asc', label: 'A → Z' },
  { id: 'name-desc', label: 'Z → A' },
  { id: 'date-desc', label: 'Plus récents' },
];

export function CompaniesPage(): React.ReactElement {
  const queries = useCompaniesQuery();
  const { isOnline } = useNetworkStatus();
  const analyzeMut = useAnalyzeMutation();
  const deleteCompany = useDeleteCompanyMutation();
  const forceAutoMut = useForceAutoAnalyzeMutation();
  // Round 42 — ids des companies dont l'auto-analyse a échoué récemment.
  const failuresQ = useAutoAnalysisFailuresQuery();
  const failedIds = React.useMemo(() => new Set(failuresQ.data ?? []), [failuresQ.data]);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [tierFilter, setTierFilter] = React.useState<Tier | 'all'>('all');
  const [designFilter, setDesignFilter] = React.useState(false);
  const [sortKey, setSortKey] = React.useState<SortKey>('score-desc');
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [sortMenuOpen, setSortMenuOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [emailFor, setEmailFor] = React.useState<Company | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  const scoreFor = (c: Company): number => {
    if (typeof c.score === 'number') return c.score;
    return 50;
  };

  const filtered = React.useMemo(() => {
    const q = searchQuery.toLowerCase();
    const data = Array.isArray(queries.data) ? queries.data : [];
    return data
      .map((c) => ({ ...c, _score: scoreFor(c) }))
      .filter((c) => {
        const matchesQ =
          !q ||
          safeIncludes(c.name, q) ||
          safeIncludes(c.sector, q) ||
          safeIncludes(c.industry, q) ||
          safeIncludes(c.city, q) ||
          safeIncludes(c.country, q);
        const matchesTier = tierFilter === 'all' || getTier(c._score) === tierFilter;
        const matchesDesign =
          !designFilter || (Array.isArray(c.tags) && c.tags.includes('design'));
        return matchesQ && matchesTier && matchesDesign;
      })
      .sort((a, b) => {
        switch (sortKey) {
          case 'score-desc': return b._score - a._score;
          case 'score-asc': return a._score - b._score;
          case 'name-asc': return a.name.localeCompare(b.name);
          case 'name-desc': return b.name.localeCompare(a.name);
          case 'date-desc': return toDateMs(b.created_at) - toDateMs(a.created_at);
          default: return 0;
        }
      });
  }, [queries.data, searchQuery, tierFilter, designFilter, sortKey]);

  const counts = React.useMemo(
    () => countByTier((Array.isArray(queries.data) ? queries.data : []).map(scoreFor)),
    [queries.data],
  );

  // Round 61 — design-filter chip count: companies taguées 'design' (issues audit < 70).
  const designCount = React.useMemo(
    () => (Array.isArray(queries.data) ? queries.data : []).filter((c) => Array.isArray(c.tags) && c.tags.includes('design')).length,
    [queries.data],
  );

  const PAGER_STEP = 8;
  const { visible: paged, hasMore, showMore, shown, total: filteredTotal } = useShowMore(filtered, PAGER_STEP);

  if (queries.isError) {
    return (
      <div className="p-10 text-center space-y-4 bg-card/40 rounded-3xl border border-red-500/20">
        <AlertCircle size={40} className="mx-auto text-red-500 opacity-60" />
        <div className="space-y-2">
          <h2 className="text-xl font-black">Erreur de synchronisation</h2>
          <p className="text-sm text-muted-foreground">
            Le backend Zentara ne répond pas ou a renvoyé une erreur.
            Vérifie ta connexion ou l'URL du backend dans les réglages.
          </p>
        </div>
        <Button onClick={() => queries.refetch()} variant="outline" className="gap-2">
          <RefreshCw size={14} /> Réessayer
        </Button>
      </div>
    );
  }

  const expandedCompany = React.useMemo(
    () => (Array.isArray(queries.data) ? queries.data : []).find((c) => c.id === expandedId) ?? null,
    [queries.data, expandedId],
  );

  const handleQuickAnalyze = async (c: Company, e?: React.MouseEvent) => {
    e?.stopPropagation();
    // Round 142 — mode embarqué : l'analyse est 100 % locale (aucun serveur
    // requis) → elle fonctionne aussi sans connexion internet.
    if (!isOnline && !isEmbeddedMode()) {
      toast.info('Mode offline — pas d’IA distante.');
      return;
    }
    toast.info(`Analyse lancée pour ${c.name}…`);
    try {
      const result: any = await analyzeMut.mutateAsync({ entityType: 'company', entityId: c.id, name: c.name });
      // Round 142 — analyse asynchrone (job) : on attend la fin du job local
      // puis on récupère la synthèse calculée (déterministe).
      let summary: string | null = null;
      if (result?.job_id) {
        const api = getApiClient();
        for (let i = 0; i < 12; i++) {
          await new Promise((r) => setTimeout(r, 700));
          try {
            const row = await api.get<{ summary?: string | null }>(`intelligence/company/${c.id}`);
            if (row?.summary) { summary = row.summary.slice(0, 80); break; }
          } catch { /* transitoire */ }
        }
      } else {
        summary = result?.summary?.slice(0, 80) ?? result?.company?.summary?.slice(0, 80) ?? null;
      }
      toast.success(`Analyse terminée${summary ? ` — ${summary}…` : ''}`);
    } catch (err) {
      toast.error(`Analyse impossible : ${(err as Error).message}`);
    }
  };

  const handleForceAuto = async (c: Company, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      toast.info(`Force auto-analysis pour ${c.name}…`);
      const r: any = await forceAutoMut.mutateAsync({ company_id: c.id });
      const analyzed = r?.data?.records?.[0]?.status === 'analyzed';
      toast.success(analyzed ? `Auto-analysis OK pour ${c.name}.` : `Auto-analysis programmée.`);
    } catch (err) {
      toast.error(`Auto-analysis impossible : ${(err as Error).message}`);
    }
  };

  const handleDelete = async (c: Company) => {
    try {
      await deleteCompany.mutateAsync(c.id);
      toast.success(`${c.name} supprimée.`);
      if (expandedId === c.id) setExpandedId(null);
    } catch (e) {
      toast.error(`Suppression impossible : ${(e as Error).message}`);
    }
  };

  // Round 60 — panier de confirmation (remplace `window.confirm`).
  const [pendingDelete, setPendingDelete] = React.useState<Company | null>(null);
  const requestDelete = React.useCallback(
    (c: Company) => setPendingDelete(c),
    [],
  );
  const cancelDelete = React.useCallback(() => setPendingDelete(null), []);
  const confirmDelete = React.useCallback(async () => {
    if (!pendingDelete) return;
    const c = pendingDelete;
    setPendingDelete(null);
    if (expandedId === c.id) setExpandedId(null);
    await deleteCompany.mutateAsync(c.id).catch((e: unknown) => { throw e; });
  }, [pendingDelete, deleteCompany, expandedId, toast]);

  return (
    <div className="space-y-5 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Lead Finder
            </span>
            <span className="text-[10px] text-muted-foreground/60">·</span>
            <span className="text-[10px] font-bold text-muted-foreground">
              {(Array.isArray(queries.data) ? queries.data : []).length} companies · {counts.hot} hot · {counts.warm} warm · {counts.cold} cold
            </span>
          </div>
          <h2 className="text-3xl font-black tracking-tight">Companies</h2>
          <p className="text-muted-foreground">
            Strategic organization monitoring and intelligence. Round 34 — click a row for full dossier.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="border-border/60"
            title="Chercher et importer depuis SEC EDGAR / OpenCorporates"
          >
            <Globe className="mr-2 h-4 w-4" /> Import annuaires
          </Button>
          <Button onClick={() => setAddOpen(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground">
            <Plus className="mr-2 h-4 w-4" /> Add Company
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap relative">
        <div className="relative flex-1 min-w-0 sm:min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            placeholder="Search by name, sector, city, country..."
            className="pl-10 bg-card/60 border-border/60"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          className={cn('border-border/60', (tierFilter !== 'all' || filtersOpen) && 'border-primary/40 text-primary')}
          onClick={() => { setFiltersOpen((v) => !v); setSortMenuOpen(false); }}
          aria-expanded={filtersOpen}
        >
          Filters {tierFilter !== 'all' && (
            <span className="ml-1 text-[9px] h-4 px-1 rounded border border-primary/40 text-primary font-bold">{tierFilter}</span>
          )}
        </Button>
        <Button
          variant="outline"
          className={cn('border-border/60', sortMenuOpen && 'border-primary/40 text-primary')}
          onClick={() => { setSortMenuOpen((v) => !v); setFiltersOpen(false); }}
          aria-expanded={sortMenuOpen}
        >
          {SORT_OPTIONS.find((s) => s.id === sortKey)?.label ?? 'Sort'}
        </Button>
        {filtersOpen && (
          <div className="absolute right-2 top-12 z-40 min-w-[180px] max-w-[calc(100vw-32px)] sm:right-12 rounded-xl border border-border bg-card shadow-2xl shadow-primary/10 p-3 animate-in fade-in slide-in-from-top-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">Filtre tier</p>
            <div className="flex flex-col gap-1">
              {(['all', 'hot', 'warm', 'cold'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => { setTierFilter(id); setFiltersOpen(false); }}
                  className={cn(
                    'text-left text-xs px-2 py-1.5 rounded-md transition-colors capitalize',
                    tierFilter === id ? 'bg-primary/15 text-primary font-bold' : 'hover:bg-secondary/40',
                  )}
                >
                  {id === 'all' ? 'Tous' : id}
                </button>
              ))}
            </div>
          </div>
        )}
        {sortMenuOpen && (
          <div className="absolute right-2 top-12 z-40 min-w-[180px] max-w-[calc(100vw-32px)] sm:right-0 rounded-xl border border-border bg-card shadow-2xl shadow-primary/10 p-3 animate-in fade-in slide-in-from-top-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">Trier par</p>
            <div className="flex flex-col gap-1">
              {SORT_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => { setSortKey(s.id); setSortMenuOpen(false); }}
                  className={cn(
                    'text-left text-xs px-2 py-1.5 rounded-md transition-colors',
                    sortKey === s.id ? 'bg-primary/15 text-primary font-bold' : 'hover:bg-secondary/40',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tier + Design filter chips (Round 61 — design chip is parallel to tier, additive) */}
      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter by tier or design">
        {[
          { id: 'all' as const, label: 'All', count: (Array.isArray(queries.data) ? queries.data : []).length, tier: 'all' as const },
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
        <span aria-hidden className="mx-1 h-5 w-px bg-border/60" />
        <button
          type="button"
          onClick={() => setDesignFilter((v) => !v)}
          aria-pressed={designFilter}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition-all',
            designFilter
              ? 'border-pink-500 bg-pink-500/15 text-pink-400'
              : 'border-border/60 bg-card/40 text-muted-foreground hover:text-foreground hover:border-pink-500/40',
          )}
          title="Companies taguées 'design' après un audit design < 70/100"
        >
          <Palette size={11} className={designFilter ? 'text-pink-400' : ''} />
          Design
          <span
            className={cn(
              'inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px]',
              designFilter ? 'bg-pink-500/30 text-pink-300' : 'bg-secondary text-muted-foreground',
            )}
          >
            {designCount}
          </span>
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
        {queries.isLoading ? (
          <div className="text-center py-20 text-muted-foreground">
            <Loader2 className="inline animate-spin mr-2" size={16} /> Loading companies...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground space-y-3">
            <p>No companies match these filters. Try widening your search.</p>
            <Button onClick={() => setAddOpen(true)} variant="outline" className="border-primary/40">
              <Plus className="mr-2 h-4 w-4" /> Add the first company
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">          <table className="w-full text-left text-sm">
            <thead className="bg-secondary/30 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-bold w-8" />
                <th className="px-4 py-3 font-bold">Company</th>
                <th className="px-4 py-3 font-bold hidden md:table-cell">Industry · Sector</th>
                <th className="px-4 py-3 font-bold hidden lg:table-cell">HQ</th>
                <th className="px-4 py-3 font-bold hidden xl:table-cell">Signals</th>
                <th className="px-4 py-3 font-bold">Score</th>
                <th className="px-4 py-3 font-bold hidden md:table-cell">Tier</th>
                <th className="px-4 py-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => {
                const t = getTier(c._score);
                const isExpanded = expandedId === c.id;
                const isAnalyzing =
                  analyzeMut.isPending && analyzeMut.variables?.entityId === c.id;
                const isForceAuto =
                  forceAutoMut.isPending && forceAutoMut.variables?.company_id === c.id;
                const hotBadge = (c._score ?? 0) >= 70;
                return (
                  <React.Fragment key={c.id}>
                    <tr
                      className={cn(
                        'border-t border-border/40 hover:bg-secondary/30 cursor-pointer transition-colors',
                        isExpanded && 'bg-primary/10',
                      )}
                      onClick={() => navigate(`/companies/${encodeURIComponent(c.id)}`)}
                      title={`Ouvrir la fiche ${c.name}`}
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="text-muted-foreground">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            'w-9 h-9 rounded-xl flex items-center justify-center',
                            t === 'hot' ? 'bg-emerald-500/15 text-emerald-500'
                              : t === 'warm' ? 'bg-amber-500/15 text-amber-500'
                                : 'bg-slate-500/15 text-slate-400',
                          )}>
                            <Globe size={16} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold truncate flex items-center gap-2">
                              {c.name}
                              {hotBadge && (
                                <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/30 text-[9px] py-0 px-1">
                                  AUTO
                                </Badge>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1">
                              {c.website ? (
                                <>
                                  {c.website.replace(/^https?:\/\//, '')}
                                  <ExternalLink size={9} />
                                </>
                              ) : (
                                <span>—</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="text-foreground font-medium truncate max-w-[180px]">{c.industry ?? '—'}</div>
                        <div className="text-[11px] text-muted-foreground truncate max-w-[180px]">{c.sector ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <div className="flex items-center gap-1 text-sm text-foreground">
                          <MapPin size={11} className="text-muted-foreground" />
                          <span className="truncate max-w-[200px]">
                            {[c.city, c.country].filter(Boolean).join(', ') || c.location || '—'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden xl:table-cell">
                        <SignalMiniCount companyId={c.id} />
                      </td>
                      <td className="px-4 py-3">
                        <ScoreCell score={c._score} />
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <div className="flex flex-col gap-1 items-start">
                          <TierPill tier={t} />
                          {Array.isArray(c.tags) && c.tags.includes('design') && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-pink-500/30 text-pink-400 bg-pink-500/10 flex items-center gap-1"
                              title="Company taguée 'design' car audit design &lt; 70"
                            >
                              <Palette size={9} />
                              Refonte
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {failedIds.has(c.id) && (
                            <button
                              type="button"
                              title="L'auto-analyse a échoué — relancer l'analyse 7-engines"
                              disabled={isForceAuto}
                              onClick={(e) => handleForceAuto(c, e)}
                              className={cn(
                                'h-7 px-2 rounded-md flex items-center gap-1 text-[10px] font-black uppercase tracking-wider transition-colors',
                                isForceAuto
                                  ? 'text-red-400 bg-red-500/10 animate-pulse'
                                  : 'text-red-500 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30',
                              )}
                            >
                              {isForceAuto ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                              Relancer
                            </button>
                          )}
                          <button
                            type="button"
                            title="Générer un email personnalisé pour cette entreprise"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEmailFor(c);
                            }}
                            className="h-7 w-7 rounded-md flex items-center justify-center transition-colors text-muted-foreground hover:text-primary hover:bg-primary/10"
                          >
                            <MailPlus size={14} />
                          </button>
                          <button
                            type="button"
                            title="Run AI analysis (rapide)"
                            disabled={isAnalyzing}
                            onClick={(e) => handleQuickAnalyze(c, e)}
                            className={cn(
                              'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
                              isAnalyzing ? 'text-amber-500 bg-amber-500/10 animate-pulse'
                                : 'text-muted-foreground hover:text-accent hover:bg-accent/10',
                            )}
                          >
                            {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                          </button>
                          <button
                            type="button"
                            title="Force auto-analysis (deep 7-engines via /api/auto-analysis)"
                            disabled={isForceAuto}
                            onClick={(e) => handleForceAuto(c, e)}
                            className={cn(
                              'h-7 w-7 rounded-md flex items-center justify-center transition-colors',
                              isForceAuto ? 'text-blue-400 bg-blue-500/10 animate-pulse'
                                : 'text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10',
                            )}
                          >
                            {isForceAuto ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
                          </button>
                          {c.website && (
                            <a
                              href={c.website} target="_blank" rel="noopener noreferrer"
                              title="Open website"
                              aria-label={`Open ${c.name} website`}
                              className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors"
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}
                          <button
                            type="button"
                            title="Delete"
                            onClick={(e) => { e.stopPropagation(); requestDelete(c); }}
                            className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <DetailPanel
                        company={c}
                        onClose={() => setExpandedId(null)}
                        onDelete={handleDelete}
                        analysisFailed={failedIds.has(c.id)}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="text-[11px] text-muted-foreground text-center pt-1">
          Showing {shown} of {filteredTotal} companies · tri: {SORT_OPTIONS.find((s) => s.id === sortKey)?.label}
        </div>
      )}

      <div className="flex justify-center">
        <LoadMoreButton shown={shown} total={filteredTotal} step={PAGER_STEP} hasMore={hasMore} onClick={showMore} labelSingular="company" labelPlural="companies" />
      </div>

      <AddCompanyModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={(text) => toast.success(text)} />

      {/* Round 134 — import en masse depuis les annuaires publics. */}
      <ImportDirectoryModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => { void queries.refetch(); }}
      />

      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) cancelDelete(); }}
        itemLabel={pendingDelete?.name ?? ''}
        entityLabel="entreprise"
        meta={
          pendingDelete
            ? `${pendingDelete.industry ?? pendingDelete.sector ?? '—'}${
                pendingDelete.city
                  ? ' · ' + pendingDelete.city + (pendingDelete.country ? ', ' + pendingDelete.country : '')
                  : ''
              }${
                pendingDelete.score !== undefined
                  ? ' · Score ' + Math.round(Number(pendingDelete.score) || 0) + '/100'
                  : ''
              }`
            : undefined
        }
        cascades={[
          'Les prospects rattachés ne sont pas supprimés en cascade',
          'Toutes les notes internes et historiques',
          'Inscriptions aux campagnes seront orphelines (FK non cascadée)',
          'Analyses IA et signaux restent en DB (suppression manuelle Settings → Wipe)',
        ]}
        onConfirm={confirmDelete}
      />

      {emailFor && (
        <EmailComposerModal
          entityName={emailFor.name}
          entityCategory={emailFor.sector ?? emailFor.industry}
          initialEmail={emailFor.email}
          searchQuery={emailFor.name}
          onClose={() => setEmailFor(null)}
        />
      )}
    </div>
  );
}
