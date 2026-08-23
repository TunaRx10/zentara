/**
 * EnginePage — « Moteur Zentara » : TOUT en une seule page.
 *
 * Fusionne en un seul écran :
 *   • Recherche unifiée (Companies / People / Local / base locale)
 *   • Lancer une analyse (jobs async + progression + annulation + retry)
 *   • Résultats d'analyses (scores déterministes + breakdown traçable)
 *   • Emails générés (templates premium)
 *   • Jobs & historique
 *   • Assistant (recommandations déterministes — l'IA ne décide plus les
 *     chiffres, elle les explique)
 *
 * L'ancien AI Center (/intelligence), Leadflow (/leadflow), Zentara One
 * (/one), Search (/search) et Maps (/maps) sont fusionnés ici.
 */
import React from 'react';
import {
  Rocket, Search as SearchIcon, Loader2, Building2, Users, MapPin, Mail, Globe, MailPlus,
  AlertTriangle, CheckCircle2, Layers, Target, Brain, History, TrendingUp, TrendingDown,
  ExternalLink, Sparkles, RefreshCw, XCircle, FileText, Eye, Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AnalysisProgress } from '@/components/AnalysisProgress';
import { EmailComposerModal } from '@/components/EmailComposerModal';
import { getApiClient } from '@/services/api/client';
import { useToast } from '@/contexts/ToastProvider';
import { cn } from '@/lib/utils';
import { createAnalysisJob, pollJob, cancelJob, retryJob, type AnalysisJob } from '@/services/ai/analysis-jobs.service';

type Section = 'recherche' | 'analyser' | 'resultats' | 'emails' | 'jobs' | 'assistant';

const SECTIONS: Array<{ id: Section; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { id: 'recherche', label: 'Recherche', icon: SearchIcon },
  { id: 'analyser', label: 'Analyser', icon: Target },
  { id: 'resultats', label: 'Résultats', icon: TrendingUp },
  { id: 'emails', label: 'Emails', icon: Mail },
  { id: 'jobs', label: 'Jobs', icon: History },
  { id: 'assistant', label: 'Assistant', icon: Brain },
];

interface EngineHit {
  id: string;
  type: 'company' | 'person';
  name: string;
  title: string | null;
  category: string | null;
  city: string | null;
  country: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  sourceGroup: string;
  score: number;
  company_id?: string | null;
}

interface EngineResult {
  results: EngineHit[];
  total: number;
  sources: string[];
  errors: Array<{ source?: string; message: string }>;
}

interface ExplainResponse {
  input_hash: string;
  computed_at: string;
  criteria: Array<{ id: string; label: string; category: string; value: number; weight: number; direction: string }>;
  aggregate: {
    need_score: number;
    opportunity_score: number;
    confidence: number;
    urgency: string;
    contact_risk: string;
    category_scores: Record<string, number>;
    strengths: Array<{ id: string; label: string; value: number }>;
    weaknesses: Array<{ id: string; label: string; value: number }>;
    missing_data: string[];
  };
  missing_critical: Array<{ id: string; label: string; weight: number }>;
}

interface IntelRow {
  id: string;
  entity_type: 'company' | 'prospect';
  entity_id: string;
  score: number | null;
  opportunity_score: number | null;
  need_score: number | null;
  confidence_score: number | null;
  summary: string | null;
  insights: string | null;
  risks: string | null;
  recommendations: string | null;
  email_subject?: string | null;
  email_html?: string | null;
  email_body?: string | null;
  created_at: string;
}

interface EmailRow {
  id: string;
  prospect_id: string | null;
  company_id: string | null;
  subject: string;
  body: string;
  html?: string | null;
  status: string;
  created_at: string;
}

interface CompanyRow {
  id: string;
  name: string;
  sector?: string | null;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  website?: string | null;
  email?: string | null;
  score?: number | null;
}

interface ProspectRow {
  id: string;
  first_name: string;
  last_name: string;
  role?: string | null;
  email?: string | null;
  company_id?: string | null;
  sector?: string | null;
  score?: number | null;
}

function resolveName(row: { entity_type: string; entity_id: string }, companies: CompanyRow[], prospects: ProspectRow[]): string {
  if (row.entity_type === 'company') return companies.find((c) => c.id === row.entity_id)?.name ?? row.entity_id.slice(0, 12);
  const p = prospects.find((x) => x.id === row.entity_id);
  return p ? `${p.first_name} ${p.last_name}`.trim() || row.entity_id.slice(0, 12) : row.entity_id.slice(0, 12);
}

export function EnginePage(): React.ReactElement {
  const api = getApiClient();
  const toast = useToast();

  const [section, setSection] = React.useState<Section>('recherche');

  // ----- Recherche -----
  const [mode, setMode] = React.useState<'all' | 'companies' | 'people'>('all');
  const [query, setQuery] = React.useState('');
  const [needs, setNeeds] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [limit, setLimit] = React.useState(20);
  const [searching, setSearching] = React.useState(false);
  const [searchResult, setSearchResult] = React.useState<EngineResult | null>(null);

  // ----- Analyse -----
  const [entityType, setEntityType] = React.useState<'company' | 'prospect'>('company');
  const [entityId, setEntityId] = React.useState('');
  const [jobOpen, setJobOpen] = React.useState(false);
  const [activeResult, setActiveResult] = React.useState<{ intel: IntelRow | null; explain: ExplainResponse | null } | null>(null);

  // ----- Données -----
  const [companies, setCompanies] = React.useState<CompanyRow[]>([]);
  const [prospects, setProspects] = React.useState<ProspectRow[]>([]);
  const [intelList, setIntelList] = React.useState<IntelRow[]>([]);
  const [emails, setEmails] = React.useState<EmailRow[]>([]);
  const [jobs, setJobs] = React.useState<AnalysisJob[]>([]);
  const [previewEmail, setPreviewEmail] = React.useState<EmailRow | null>(null);
  const [composerHit, setComposerHit] = React.useState<EngineHit | null>(null);
  const [loadingData, setLoadingData] = React.useState(false);

  const refreshLists = React.useCallback(async () => {
    setLoadingData(true);
    try {
      const [comps, pros, intels, eml, jbs] = await Promise.all([
        api.get<CompanyRow[]>('companies').catch(() => []),
        api.get<ProspectRow[]>('prospects').catch(() => []),
        api.get<IntelRow[]>('intelligence').catch(() => []),
        api.get<EmailRow[]>('emails').catch(() => []),
        api.get<AnalysisJob[]>('jobs').catch(() => []),
      ]);
      setCompanies(Array.isArray(comps) ? comps : []);
      setProspects(Array.isArray(pros) ? pros : []);
      setIntelList(Array.isArray(intels) ? intels : []);
      setEmails(Array.isArray(eml) ? eml : []);
      setJobs(Array.isArray(jbs) ? jbs : []);
    } finally {
      setLoadingData(false);
    }
  }, [api]);

  React.useEffect(() => {
    void refreshLists();
  }, [refreshLists]);

  // ----- Actions -----
  const runSearch = React.useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchResult(null);
    try {
      const data = await api.post<EngineResult>('engine/search', {
        mode,
        query: query.trim(),
        needs: needs.trim() || undefined,
        roles: needs.trim() || undefined,
        location: location.trim() || undefined,
        limit,
        save: true,
      }, { timeoutMs: 60_000 });
      setSearchResult(data);
    } catch (e) {
      toast.error(`Recherche impossible : ${(e as Error).message}`);
    } finally {
      setSearching(false);
    }
  }, [api, mode, query, needs, location, limit, toast]);

  const launchAnalysis = React.useCallback(async (type: 'company' | 'prospect', id: string) => {
    if (!id) return;
    setEntityType(type);
    setEntityId(id);
    setActiveResult(null);
    setJobOpen(true);
    try {
      const { job_id } = await createAnalysisJob(type, id, {});
      // Poll manuel léger pour rafraîchir les listes à la fin.
      const started = Date.now();
      const timer = setInterval(async () => {
        try {
          const j = await pollJob(job_id);
          if (j.status === 'succeeded' || j.status === 'failed' || j.status === 'canceled') {
            clearInterval(timer);
            await refreshLists();
            if (j.status === 'succeeded') {
              const [intel, explain] = await Promise.all([
                api.get<IntelRow | null>(`intelligence/${type}/${id}`).catch(() => null),
                api.get<ExplainResponse>(`intelligence/explain/${type}/${id}`).catch(() => null),
              ]);
              setActiveResult({ intel, explain });
            }
          }
        } catch { /* transitoire */ }
        if (Date.now() - started > 300_000) clearInterval(timer);
      }, 1500);
    } catch (e) {
      toast.error(`Impossible de lancer l'analyse : ${(e as Error).message}`);
    }
  }, [api, refreshLists, toast]);

  const analyzeHit = React.useCallback((hit: EngineHit) => {
    const id = hit.company_id ?? hit.id;
    setSection('analyser');
    if (hit.type === 'person' && hit.company_id) {
      setEntityType('prospect');
      setEntityId(hit.id);
    } else {
      setEntityType('company');
      setEntityId(hit.company_id ?? hit.id);
    }
    void launchAnalysis('company', id);
  }, [launchAnalysis]);

  const onJobCancel = async (jobId: string): Promise<void> => {
    try { await cancelJob(jobId); await refreshLists(); } catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };
  const onJobRetry = async (jobId: string): Promise<void> => {
    try { await retryJob(jobId); await refreshLists(); } catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };
  const markSent = async (emailId: string): Promise<void> => {
    try {
      await api.post('outreach/send', { email_id: emailId });
      await refreshLists();
    } catch (e) { toast.error(String((e as Error)?.message ?? e)); }
  };

  const entityOptions = entityType === 'company' ? companies : prospects;
  const activeEntities = entityType === 'company' ? companies : prospects;
  const activeExplain = activeResult?.explain;
  const agg = activeExplain?.aggregate;

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24 pt-4 px-2 sm:px-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-primary to-violet-600 text-white shrink-0">
            <Rocket size={24} />
          </div>
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Moteur Zentara
            </h2>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Recherche · Analyse · Emails · Assistant — le tout embarqué, sans serveur.
            </p>
          </div>
        </div>
        <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 gap-1.5 shrink-0">
          <CheckCircle2 size={11} /> Embarqué · 100 % local
        </Badge>
      </div>

      {/* Section tabs */}
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const active = section === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors',
                active
                  ? 'border-primary/60 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon size={13} />
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ===================== RECHERCHE ===================== */}
      {section === 'recherche' && (
        <div className="space-y-6">
          <Card className="border-border/60 bg-card/60">
            <CardContent className="p-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                {([
                  { id: 'all', label: 'Tous', icon: Layers },
                  { id: 'companies', label: 'Companies', icon: Building2 },
                  { id: 'people', label: 'People', icon: Users },
                ] as Array<{ id: typeof mode; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }>).map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
                        mode === m.id ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <Icon size={12} /> {m.label}
                    </button>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Niche / entreprise / activité</label>
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SaaS B2B, Lucca, dentistes à Paris…" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Besoins ciblés / rôles</label>
                  <Input value={needs} onChange={(e) => setNeeds(e.target.value)} placeholder="Head of Sales, recrute, refonte site…" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Localisation</label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Paris, Europe…" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Quantité</label>
                  <Input type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 20)))} />
                </div>
                <Button onClick={() => void runSearch()} disabled={searching || !query.trim()} className="gap-2">
                  {searching ? <Loader2 size={16} className="animate-spin" /> : <SearchIcon size={16} />}
                  {searching ? 'Recherche…' : 'Lancer la recherche'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {searchResult && searchResult.errors.length > 0 && (
            <div className="space-y-1.5">
              {searchResult.errors.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-[12px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-1.5">
                  <AlertTriangle size={12} />
                  <span className="font-bold">{e.source ?? 'source'}</span>
                  <span className="text-amber-300/80">{e.message}</span>
                </div>
              ))}
            </div>
          )}

          {searchResult && searchResult.results.length === 0 && (
            <p className="text-sm text-muted-foreground">Aucun résultat local pour « {query} ».</p>
          )}

          {searchResult && searchResult.results.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {searchResult.results.map((hit, i) => (
                <Card key={`${hit.id}-${i}`} className="border-border/60 bg-card/60 hover:border-primary/40 transition-colors h-full">
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold truncate text-sm flex items-center gap-2">
                          {hit.name}
                          <Badge variant="outline" className="text-[9px] h-4 px-1 border-primary/30 text-primary shrink-0">
                            {hit.type === 'person' ? 'People' : 'Company'}
                          </Badge>
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{hit.title ?? hit.category ?? '—'}</p>
                      </div>
                      <span className={cn(
                        'px-2 py-0.5 rounded-lg border text-xs font-black tabular-nums shrink-0',
                        hit.score >= 70 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                          : hit.score >= 40 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                            : 'text-muted-foreground bg-secondary/40 border-border',
                      )}>
                        {hit.score}%
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      {hit.city && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/40 border border-border/50 text-muted-foreground"><MapPin size={11} /> {hit.city}{hit.country ? `, ${hit.country}` : ''}</span>}
                      {hit.email && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 truncate max-w-[200px]" title={hit.email}><Mail size={11} /> {hit.email}</span>}
                      {hit.website && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/40 border border-border/50 text-primary truncate max-w-[180px]"><Globe size={11} /> {hit.website.replace(/^https?:\/\//, '')}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" onClick={() => analyzeHit(hit)} className="flex-1 border-primary/40 text-primary hover:bg-primary/10 gap-2">
                        <Zap size={13} /> Analyser
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setComposerHit(hit)} className="flex-1 gap-2">
                        <MailPlus size={13} /> Email
                      </Button>
                      {hit.website && (
                        <Button size="sm" variant="ghost" onClick={() => window.open(hit.website!, '_blank', 'noopener')} className="text-muted-foreground hover:text-foreground shrink-0">
                          <ExternalLink size={13} />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {!searchResult && !searching && (
            <div className="text-center py-14 text-muted-foreground space-y-2">
              <SearchIcon size={28} className="mx-auto opacity-40" />
              <p className="text-sm">Choisis une niche + besoins, puis lance la recherche dans la base locale.</p>
              <p className="text-xs opacity-70">Les annuaires web / LinkedIn / Maps sont optionnels — le moteur embarqué répond sans serveur.</p>
            </div>
          )}
        </div>
      )}

      {/* ===================== ANALYSER ===================== */}
      {section === 'analyser' && (
        <div className="space-y-5">
          <Card className="border-border/60 bg-card/60">
            <CardContent className="p-5 space-y-4">
              <div className="flex flex-wrap gap-2">
                {(['company', 'prospect'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setEntityType(t); setEntityId(''); setActiveResult(null); }}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors',
                      entityType === t ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t === 'company' ? <Building2 size={13} /> : <Users size={13} />}
                    {t === 'company' ? 'Entreprise' : 'Prospect'}
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {entityType === 'company' ? 'Entreprise' : 'Prospect'} ({entityOptions.length})
                </label>
                <select
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                  className="w-full h-11 rounded-xl border border-border bg-background px-3 text-sm"
                >
                  <option value="">— Choisir —</option>
                  {entityType === 'company'
                    ? companies.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ''}</option>)
                    : prospects.map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}{p.role ? ` · ${p.role}` : ''}</option>)}
                </select>
              </div>
              <Button onClick={() => void launchAnalysis(entityType, entityId)} disabled={!entityId || jobOpen} className="gap-2">
                <Target size={16} />
                {jobOpen ? 'Analyse en cours…' : 'Lancer l’analyse (50 critères déterministes)'}
              </Button>
            </CardContent>
          </Card>

          {jobOpen && (
            <AnalysisProgress
              isOpen={jobOpen}
              entityType={entityType}
              entityId={entityId}
              onComplete={() => { /* résultat chargé via le poll */ }}
              onClose={() => { setJobOpen(false); void refreshLists(); }}
            />
          )}

          {activeResult && agg && (
            <ResultPanel intel={activeResult.intel} explain={activeResult.explain} entityName={resolveName(
              { entity_type: entityType, entity_id: entityId }, companies, prospects)} />
          )}
        </div>
      )}

      {/* ===================== RÉSULTATS ===================== */}
      {section === 'resultats' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
              Analyses récentes ({intelList.length})
            </h3>
            <Button size="sm" variant="ghost" onClick={() => void refreshLists()} className="gap-1.5 text-xs">
              <RefreshCw size={13} /> {loadingData ? '…' : 'Actualiser'}
            </Button>
          </div>
          {intelList.length === 0 && (
            <div className="text-center py-14 text-muted-foreground space-y-2">
              <TrendingUp size={26} className="mx-auto opacity-40" />
              <p className="text-sm">Aucune analyse pour l’instant — lance-en une dans l’onglet « Analyser ».</p>
            </div>
          )}
          <div className="space-y-2.5">
            {intelList.map((row) => {
              const name = resolveName(row, companies, prospects);
              const opp = row.opportunity_score ?? 0;
              const need = row.need_score ?? 0;
              const conf = row.confidence_score ?? 0;
              return (
                <Card key={row.id} className="border-border/60 bg-card/60">
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{name}</p>
                        <p className="text-[11px] text-muted-foreground line-clamp-2">{row.summary}</p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <span className="px-2 py-0.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-black tabular-nums">Opp {opp}</span>
                        <span className="px-2 py-0.5 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-400 text-xs font-black tabular-nums">Besoin {need}</span>
                        <span className="px-2 py-0.5 rounded-lg border border-sky-500/20 bg-sky-500/10 text-sky-400 text-xs font-black tabular-nums">Conf {conf}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs border-primary/40 text-primary" onClick={() => void launchAnalysis(row.entity_type, row.entity_id)}>
                        <RefreshCw size={12} /> Ré-analyser
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs gap-1.5" onClick={() => { setEntityType(row.entity_type); setEntityId(row.entity_id); setSection('assistant'); }}>
                        <Brain size={12} /> Détail & explication
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================== EMAILS ===================== */}
      {section === 'emails' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Emails générés ({emails.length})</h3>
            <Button size="sm" variant="ghost" onClick={() => void refreshLists()} className="gap-1.5 text-xs">
              <RefreshCw size={13} /> Actualiser
            </Button>
          </div>
          {emails.length === 0 && (
            <div className="text-center py-14 text-muted-foreground space-y-2">
              <Mail size={26} className="mx-auto opacity-40" />
              <p className="text-sm">Aucun email pour l’instant — chaque analyse génère automatiquement un brouillon premium.</p>
            </div>
          )}
          <div className="space-y-2.5">
            {emails.map((e) => {
              const name = e.company_id
                ? companies.find((c) => c.id === e.company_id)?.name
                : e.prospect_id ? (() => { const p = prospects.find((x) => x.id === e.prospect_id); return p ? `${p.first_name} ${p.last_name}` : null; })() : null;
              return (
                <Card key={e.id} className="border-border/60 bg-card/60">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{e.subject || '(sans objet)'}</p>
                        <p className="text-[11px] text-muted-foreground truncate">→ {name ?? '—'}</p>
                      </div>
                      <Badge variant="outline" className={cn('shrink-0 text-[10px]', e.status === 'sent' ? 'border-emerald-500/40 text-emerald-400' : 'border-amber-500/40 text-amber-400')}>
                        {e.status === 'sent' ? 'Envoyé' : e.status === 'replied' ? 'Répondu' : 'Brouillon'}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setPreviewEmail(e)}>
                        <Eye size={12} /> Prévisualiser
                      </Button>
                      {e.status === 'draft' && (
                        <Button size="sm" variant="ghost" className="text-xs gap-1.5 text-emerald-400" onClick={() => void markSent(e.id)}>
                          <CheckCircle2 size={12} /> Marquer envoyé
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================== JOBS ===================== */}
      {section === 'jobs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Jobs d’analyse ({jobs.length})</h3>
            <Button size="sm" variant="ghost" onClick={() => void refreshLists()} className="gap-1.5 text-xs">
              <RefreshCw size={13} /> Actualiser
            </Button>
          </div>
          <div className="space-y-2.5">
            {jobs.map((j) => {
              const name = resolveName({ entity_type: j.entity_type, entity_id: j.entity_id }, companies, prospects);
              return (
                <Card key={j.id} className="border-border/60 bg-card/60">
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{name}</p>
                        <p className="text-[11px] text-muted-foreground">étape : {j.stage} · {j.id.slice(0, 10)}…</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={cn(
                          'px-2 py-0.5 rounded-lg border text-[11px] font-bold',
                          j.status === 'succeeded' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            : j.status === 'failed' ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                              : j.status === 'canceled' ? 'border-slate-500/30 bg-slate-500/10 text-slate-400'
                                : j.status === 'running' ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-400'
                                  : 'border-amber-500/30 bg-amber-500/10 text-amber-400',
                        )}>
                          {j.status}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">{Math.round((j.progress ?? 0) * 100)}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 w-full bg-secondary/60 rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${Math.round((j.progress ?? 0) * 100)}%` }} />
                    </div>
                    {j.error && <p className="text-[11px] text-rose-400">{j.error}</p>}
                    <div className="flex flex-wrap gap-2">
                      {(j.status === 'running' || j.status === 'queued') && (
                        <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => void onJobCancel(j.id)}>
                          <XCircle size={12} /> Annuler
                        </Button>
                      )}
                      {(j.status === 'failed' || j.status === 'canceled') && (
                        <Button size="sm" variant="outline" className="text-xs gap-1.5 text-primary" onClick={() => void onJobRetry(j.id)}>
                          <RefreshCw size={12} /> Relancer
                        </Button>
                      )}
                      {j.status === 'succeeded' && (
                        <Button size="sm" variant="ghost" className="text-xs gap-1.5" onClick={() => { setEntityType(j.entity_type); setEntityId(j.entity_id); setSection('assistant'); }}>
                          <Brain size={12} /> Voir le résultat
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ===================== ASSISTANT ===================== */}
      {section === 'assistant' && (
        <AssistantPanel
          entityType={entityType}
          entityId={entityId}
          companies={companies}
          prospects={prospects}
          onPick={(type, id) => { setEntityType(type); setEntityId(id); }}
        />
      )}

      {/* Modals */}
      {previewEmail && (
        <EmailPreviewModal email={previewEmail} onClose={() => setPreviewEmail(null)} />
      )}
      {composerHit && (
        <EmailComposerModal
          entityName={composerHit.name}
          entityCategory={composerHit.category}
          initialEmail={composerHit.email}
          searchQuery={composerHit.name}
          onClose={() => setComposerHit(null)}
        />
      )}
      {activeEntities.length === 0 && null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResultPanel — scores + breakdown + email généré
// ---------------------------------------------------------------------------

function ResultPanel({ intel, explain, entityName }: { intel: IntelRow | null; explain: ExplainResponse | null; entityName: string }): React.ReactElement {
  const agg = explain?.aggregate;
  const api = getApiClient();
  const toast = useToast();
  const [emailPreview, setEmailPreview] = React.useState<{ subject: string; html: string } | null>(null);

  const generateEmail = async (): Promise<void> => {
    if (!intel) return;
    try {
      const data = await api.post<{ subject: string; html: string }>(
        `email-templates/from-analysis/${intel.entity_type}/${intel.entity_id}`,
        {},
      );
      setEmailPreview(data);
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    }
  };

  const catOrder = ['identity', 'site_profile', 'site_automation', 'reputation', 'social', 'marketing', 'accessibility', 'derived'];
  const catLabels: Record<string, string> = {
    identity: 'Identité', site_profile: 'Site web', site_automation: 'Automatisation',
    reputation: 'Réputation', social: 'Réseaux', marketing: 'Marketing',
    accessibility: 'Accessibilité', derived: 'Signaux dérivés',
  };

  return (
    <div className="space-y-4">
      {/* Scores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ScoreTile label="Opportunité" value={agg?.opportunity_score ?? 0} tone="emerald" />
        <ScoreTile label="Besoin" value={agg?.need_score ?? 0} tone="amber" />
        <ScoreTile label="Urgence" value={agg ? (agg.urgency === 'critique' ? 95 : agg.urgency === 'élevée' ? 75 : agg.urgency === 'modérée' ? 50 : 20) : 0} raw={agg?.urgency ?? '—'} tone="rose" />
        <ScoreTile label="Confiance" value={agg?.confidence ?? 0} tone="sky" />
      </div>

      {/* Catégories */}
      {explain && agg && (
        <Card className="border-border/60 bg-card/60">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-primary" />
              <h4 className="text-sm font-bold">Breakdown par catégorie (50 critères — traçable)</h4>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
              {catOrder.filter((c) => agg.category_scores?.[c] != null).map((c) => (
                <div key={c} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{catLabels[c] ?? c}</span>
                    <span className="tabular-nums font-bold">{agg.category_scores?.[c] ?? 0}/100</span>
                  </div>
                  <div className="h-1.5 bg-secondary/60 rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${agg.category_scores?.[c] ?? 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
            {explain.input_hash && (
              <p className="text-[10px] text-muted-foreground font-mono truncate" title={explain.input_hash}>
                input_hash : {explain.input_hash} · calculé le {new Date(explain.computed_at).toLocaleString('fr-FR')}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Forces / faiblesses / recos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <InsightCard icon={<TrendingUp size={14} />} title="Points forts" items={agg?.strengths?.map((s) => s.label) ?? []} tone="text-emerald-400" />
        <InsightCard icon={<TrendingDown size={14} />} title="Points faibles" items={agg?.weaknesses?.map((w) => w.label) ?? []} tone="text-rose-400" />
        <InsightCard icon={<Sparkles size={14} />} title="Recommandations" items={parseRecos(intel?.recommendations)} tone="text-primary" />
      </div>

      {/* Email */}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void generateEmail()} className="gap-2">
          <MailPlus size={15} /> Générer l’email premium
        </Button>
        {intel?.email_subject && (
          <span className="text-xs text-muted-foreground self-center truncate max-w-[400px]">
            Brouillon auto : « {intel.email_subject} »
          </span>
        )}
      </div>

      {emailPreview && (
        <Card className="border-border/60 bg-card/60">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-bold">{emailPreview.subject}</p>
              <Button size="sm" variant="ghost" onClick={() => setEmailPreview(null)}>Fermer</Button>
            </div>
            <iframe title="Aperçu email" sandbox="" className="w-full h-72 rounded-lg border border-border/60 bg-white" srcDoc={emailPreview.html} />
          </CardContent>
        </Card>
      )}

      {!explain && <p className="text-xs text-muted-foreground">{entityName} — aucune trace de calcul disponible (relancez une analyse).</p>}
    </div>
  );
}

function ScoreTile({ label, value, raw, tone }: { label: string; value: number; raw?: string; tone: 'emerald' | 'amber' | 'rose' | 'sky' }): React.ReactElement {
  const toneCls = {
    emerald: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10',
    amber: 'text-amber-400 border-amber-500/20 bg-amber-500/10',
    rose: 'text-rose-400 border-rose-500/20 bg-rose-500/10',
    sky: 'text-sky-400 border-sky-500/20 bg-sky-500/10',
  }[tone];
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg ${toneCls} flex items-center justify-center text-xs font-black tabular-nums shrink-0`}>
        {value}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-black tabular-nums leading-none">{raw ?? `${value}/100`}</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold mt-1">{label}</div>
      </div>
    </div>
  );
}

function InsightCard({ icon, title, items, tone }: { icon: React.ReactNode; title: string; items: string[]; tone: string }): React.ReactElement {
  return (
    <Card className="border-border/60 bg-card/60">
      <CardContent className="p-4 space-y-2">
        <div className={`flex items-center gap-2 text-xs font-bold ${tone}`}>
          {icon} {title}
        </div>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">—</p>
        ) : (
          <ul className="space-y-1">
            {items.slice(0, 6).map((it, i) => (
              <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                <span className="text-primary shrink-0">•</span>
                <span>{it}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function parseRecos(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [raw];
  }
}

// ---------------------------------------------------------------------------
// AssistantPanel — recommandations déterministes (explicables)
// ---------------------------------------------------------------------------

function AssistantPanel({
  entityType, entityId, companies, prospects, onPick,
}: {
  entityType: 'company' | 'prospect';
  entityId: string;
  companies: CompanyRow[];
  prospects: ProspectRow[];
  onPick: (type: 'company' | 'prospect', id: string) => void;
}): React.ReactElement {
  const api = getApiClient();
  const [explain, setExplain] = React.useState<ExplainResponse | null>(null);
  const [intel, setIntel] = React.useState<IntelRow | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async (type: 'company' | 'prospect', id: string) => {
    if (!id) { setExplain(null); setIntel(null); return; }
    setLoading(true);
    try {
      const [exp, row] = await Promise.all([
        api.get<ExplainResponse>(`intelligence/explain/${type}/${id}`).catch(() => null),
        api.get<IntelRow | null>(`intelligence/${type}/${id}`).catch(() => null),
      ]);
      setExplain(exp);
      setIntel(row);
    } finally {
      setLoading(false);
    }
  }, [api]);

  React.useEffect(() => {
    void load(entityType, entityId);
  }, [entityType, entityId, load]);

  const name = entityId
    ? resolveName({ entity_type: entityType, entity_id: entityId }, companies, prospects)
    : null;

  return (
    <div className="space-y-4">
      <Card className="border-border/60 bg-card/60">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Brain size={15} className="text-primary" />
            <h4 className="text-sm font-bold">Assistant — explication des scores</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Entreprise</label>
              <select value={entityType === 'company' ? entityId : ''} onChange={(e) => onPick('company', e.target.value)} className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm">
                <option value="">— Choisir —</option>
                {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Prospect</label>
              <select value={entityType === 'prospect' ? entityId : ''} onChange={(e) => onPick('prospect', e.target.value)} className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm">
                <option value="">— Choisir —</option>
                {prospects.map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && <p className="text-xs text-muted-foreground">Chargement…</p>}
      {!entityId && (
        <div className="text-center py-12 text-muted-foreground space-y-2">
          <Sparkles size={26} className="mx-auto opacity-40" />
          <p className="text-sm">Choisis une entreprise ou un prospect pour voir l’explication déterministe de son analyse.</p>
        </div>
      )}

      {entityId && explain && intel && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-lg font-bold">{name}</h3>
            <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">
              {explain.aggregate.urgency} · risque {explain.aggregate.contact_risk}
            </Badge>
          </div>
          <ResultPanel intel={intel} explain={explain} entityName={name ?? entityId} />
          <div className="rounded-xl border border-border/60 bg-card/60 p-4 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-primary">
              <Sparkles size={13} /> Comment ce score est-il calculé ?
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Les chiffres viennent du moteur de scoring déterministe embarqué : 50 critères (identité, site web,
              automatisation, réputation, réseaux, marketing, accessibilité, signaux dérivés) chacun évalué à partir
              des données stockées localement, puis agrégés par poids. L’IA n’invente aucun chiffre — elle ne fait
              que narrer les résultats calculés. Mêmes données ⇒ mêmes scores, toujours.
            </p>
            {explain.missing_critical?.length > 0 && (
              <p className="text-[11px] text-amber-400">
                Données manquantes critiques : {explain.missing_critical.map((m) => m.label).join(', ')}
              </p>
            )}
          </div>
        </div>
      )}
      {entityId && !explain && !loading && (
        <p className="text-xs text-muted-foreground">Pas encore d’analyse pour cette entité — lance-la dans l’onglet « Analyser ».</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmailPreviewModal
// ---------------------------------------------------------------------------

function EmailPreviewModal({ email, onClose }: { email: EmailRow; onClose: () => void }): React.ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 p-4 border-b border-border/60">
          <p className="text-sm font-bold truncate">{email.subject}</p>
          <Button size="sm" variant="ghost" onClick={onClose}>Fermer</Button>
        </div>
        <iframe title="Aperçu email" sandbox="" className="w-full h-[70vh] bg-white" srcDoc={email.html ?? ''} />
      </div>
    </div>
  );
}

export default EnginePage;
