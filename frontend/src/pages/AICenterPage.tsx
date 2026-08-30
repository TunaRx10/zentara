import React from 'react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import {
  Zap, Search, Loader2, CheckCircle2, AlertCircle, BarChart, Target, ShieldAlert, Lightbulb,
  Wifi, WifiOff, Users, Sparkles, ChevronDown, ChevronRight, Crown, Globe, Briefcase,
  Clock, ExternalLink, TrendingUp, ArrowDown, Layers, Database, Star, Eye, Flag,
  RefreshCw, Bot, Send, UserPlus, ArrowRight, Activity, Building2, Compass,
  Gauge, Network, Brain, Radar, Compass as CompassIcon,
  MapPin,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  useProspectsQuery,
  useCompaniesQuery,
  useMonitoringQuery,
  useAnalyticsOverviewQuery,
  useHotProspectsQuery,
  useHotCompaniesQuery,
} from '@/hooks/useBackendData';
import { aiService } from '@/services/ai/ai.service';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { AIAnalysis } from '@/types';
import type {
  ProspectingResponse,
  ProspectingCompany,
  AutoAnalyzedRecordFE,
  AutoAnalysisSweepResult,
  AutoAnalysisStatus,
} from '@/services/ai/ai.service';
import { useToast } from '@/contexts/ToastProvider';
import { ENDPOINTS } from '@/services/api/endpoints';
import { getApiClient } from '@/services/api/client';

/* ============================================================
 * Round 32 — Page AICenterPage
 * ===============
 *  Deux onglets :
 *    1. **Single prospect** : analyse 7-engines d'un prospect existant
 *       (Round 8 — sync hybride, cache, cascade).
 *    2. **Prospecting engine** : nouveau moteur stratégique qui
 *       renvoit N entreprises cibles + ICP + top_lists + multi-agent
 *       stack (master prompt 22 sections).
 * ============================================================ */

type Mode = 'single' | 'prospecting' | 'outreach';

export function AICenterPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as Mode | null;
  const mode: Mode = tabFromUrl === 'prospecting' || tabFromUrl === 'outreach' ? tabFromUrl : 'single';
  const setMode = (m: Mode) => {
    setSearchParams(m === 'single' ? {} : { tab: m }, { replace: true });
  };
  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 relative">
      {/* Round 55 — Aurora banner + grid overlay behind the mode switcher.
          Immediate visual presence so the page is NEVER perceived as 'black'. */}
      <AuroraBanner />
      <ModeSwitcher mode={mode} onChange={setMode} />
      {mode === 'single' ? <SingleProspectTab setMode={setMode} /> : mode === 'prospecting' ? <ProspectingTab /> : <OutreachTab />}
    </div>
  );
}

/* ============================================================
 * Round 55 — AuroraBanner
 * ------------------------------------------------------------
 *   Grand bandeau aurora gradient + grille subtile qui s'affiche
 *   au-dessus du ModeSwitcher. But: que la page AI Center ne soit
 *   JAMAIS perçue comme « noire » même à 1er render.
 * ============================================================ */
function AuroraBanner() {
  return (
    <div className="relative -mx-2 md:-mx-8 lg:-mx-12 px-3 md:px-8 py-5 rounded-2xl overflow-hidden border border-amber-400/30 shadow-[0_0_60px_rgba(231,200,120,0.15)]">
      {/* Dark premium gradient layer (noir + or) */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#1c1c26] via-[#0a0a0f] to-[#040406] rounded-2xl" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-tr from-amber-400/10 via-transparent to-amber-200/5 rounded-2xl" />
      {/* Gold glow blobs */}
      <div className="absolute -top-20 -left-20 w-[28rem] h-[28rem] bg-amber-400/10 rounded-full blur-3xl" />
      <div className="absolute -bottom-20 -right-20 w-[24rem] h-[24rem] bg-amber-500/10 rounded-full blur-3xl" />
      {/* Grid overlay for tech-feel (dark) */}
      <div className="absolute inset-0 -z-10 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      {/* Round 63 — root flex column sur mobile (title above, KPIs below dans leur
          propre row), row sur desktop. Précédemment flex-wrap forçait un reflow
          bizarre à 375px. */}
      <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
        <div className="space-y-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 md:gap-2 px-2.5 md:px-3 py-0.5 md:py-1 rounded-full bg-amber-400/10 backdrop-blur-md border border-amber-400/40 text-[10px] md:text-[11px] font-black tracking-widest text-amber-300 shadow-md">
            <Sparkles size={11} className="md:size-3" />
            STRATEGIC INTELLIGENCE
          </div>
          <h1 className="text-2xl md:text-4xl font-black tracking-tight">
            <span className="bg-gradient-to-r from-amber-100 via-amber-200 to-amber-400 bg-clip-text text-transparent">
              7-engine Pipeline
            </span>{' '}
            <span className="text-foreground drop-shadow-md">+ Outreach IA</span>
          </h1>
          <p className="text-xs md:text-sm text-foreground/90 max-w-xl font-medium leading-snug">
            Analyse stratégique, prospection ciblée, génération d'emails et suivi des réponses — le tout orchestré par 7 moteurs IA spécialisés.
          </p>
          {/* Round 117 — raccourci vers le moteur Google Maps Leads. */}
          <Link
            to="/maps"
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-400/10 backdrop-blur-md border border-amber-400/40 text-[11px] font-bold text-amber-300 hover:bg-amber-400/20 hover:border-amber-400 transition-colors"
          >
            <MapPin size={13} /> Google Maps Leads
          </Link>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-2 text-center shrink-0">
          <div className="px-2 py-1 sm:px-3 sm:py-2 rounded-lg bg-black/40 border border-amber-400/40 backdrop-blur-md shadow-lg shadow-amber-500/10">
            <div className="text-xl sm:text-2xl font-black text-amber-200 tabular-nums leading-none">7</div>
            <div className="text-[9px] sm:text-[10px] uppercase tracking-widest text-foreground/70 font-bold mt-0.5">engines</div>
          </div>
          <div className="px-2 py-1 sm:px-3 sm:py-2 rounded-lg bg-black/40 border border-amber-400/40 backdrop-blur-md shadow-lg shadow-amber-500/10">
            <div className="text-xl sm:text-2xl font-black text-amber-200 tabular-nums leading-none">1</div>
            <div className="text-[9px] sm:text-[10px] uppercase tracking-widest text-foreground/70 font-bold mt-0.5">clic</div>
          </div>
          <div className="col-span-2 sm:col-span-1 px-2 py-1 sm:px-3 sm:py-2 rounded-lg bg-black/40 border border-amber-400/40 backdrop-blur-md shadow-lg shadow-amber-500/10">
            <div className="text-xl sm:text-2xl font-black text-amber-200 tabular-nums leading-none">AI</div>
            <div className="text-[9px] sm:text-[10px] uppercase tracking-widest text-foreground/70 font-bold mt-0.5">orchestration</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * Mode switcher + connection banner
 * ============================================================ */
function ModeSwitcher({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const { isOnline: onlineFromNet } = useNetworkStatus();
  return (
    <div className="space-y-3">
      {/* Round 63 — status badge tronqué sur mobile (texte plus court),
          complet sur desktop. */}
      <div className="flex items-center justify-center gap-2 flex-wrap">
        <div className={cn(
          'inline-flex items-center gap-1.5 px-2.5 md:px-3 py-1 rounded-full text-[9px] md:text-[10px] font-black tracking-widest border shadow-md whitespace-nowrap',
          onlineFromNet
            ? 'bg-green-500/20 text-green-400 border-green-500/40 shadow-green-500/20'
            : 'bg-amber-500/20 text-amber-400 border-amber-500/40 shadow-amber-500/20',
        )}>
          {onlineFromNet ? <Wifi size={11} className="md:size-3" /> : <WifiOff size={11} className="md:size-3" />}
          <span className="sm:hidden">{onlineFromNet ? 'LIVE' : 'OFFLINE'}</span>
          <span className="hidden sm:inline">{onlineFromNet ? 'BACKEND LIVE — 7-engine pipeline + prospecting' : 'OFFLINE — heuristics only'}</span>
        </div>
      </div>
      {/* Round 63 — boutons serrés (h-9 / px-3 / text-xs) sur mobile,
          taille normale (h-10 / px-5 / text-sm) sur desktop. */}
      <div className="flex justify-center">
        <div className="inline-flex p-1 rounded-xl bg-card/80 border-2 border-primary/30 shadow-xl shadow-primary/20">
          <button
            className={cn(
              'h-9 sm:h-10 px-2.5 sm:px-5 inline-flex items-center gap-1.5 sm:gap-2 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap',
              mode === 'single'
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/40'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange('single')}
          >
            <Search size={14} className="sm:size-4" /> Single
          </button>
          <button
            className={cn(
              'h-9 sm:h-10 px-2.5 sm:px-5 inline-flex items-center gap-1.5 sm:gap-2 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap',
              mode === 'prospecting'
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/40'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange('prospecting')}
          >
            <Sparkles size={14} className="sm:size-4" /> Prospecting
          </button>
          <button
            className={cn(
              'h-9 sm:h-10 px-2.5 sm:px-5 inline-flex items-center gap-1.5 sm:gap-2 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap',
              mode === 'outreach'
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/40'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => onChange('outreach')}
          >
            <Bot size={14} className="sm:size-4" /> Outreach
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * SINGLE PROSPECT TAB (Round 8 — sync hybride, fallback heuristique)
 * ============================================================ */
function SingleProspectTab({ setMode }: { setMode?: (m: Mode) => void } = {}) {
  // Round 38 fix : on lit la liste des prospects directement depuis le backend
  // (et plus depuis le repo Capacitor local qui ne fonctionne qu'en APK Android).
  const { data: prospects = [], isLoading: loadingProspects, refetch } = useProspectsQuery();
  const { data: companies = [] } = useCompaniesQuery();
  const { data: monitoring = [] } = useMonitoringQuery();
  const { data: analytics } = useAnalyticsOverviewQuery();
  // Round 54 — liste hot prospects réelle (route /api/analytics/hot-prospects).
  // Top 8 max pour le popover de la tuile HOT.
  const { data: hotResp, isFetching: hotFetching } = useHotProspectsQuery({ limit: 8, minScore: 70 });
  const hotList = hotResp?.data ?? [];
  const [hotOpen, setHotOpen] = React.useState(false);
  const toggleHot = React.useCallback(() => setHotOpen((v) => !v), []);
  // Round 58 — liste hot companies réelle (route /api/companies/hot-companies).
  // Top 8 max pour le popover de la tuile HOT companies (rose).
  const { data: hotCompResp, isFetching: hotCompFetching } = useHotCompaniesQuery({ limit: 8, minScore: 70 });
  const hotCompList = (hotCompResp as any)?.data ?? [];
  const [hotCompOpen, setHotCompOpen] = React.useState(false);
  // Round 56 — DB/CRM/24H tiles also drilldown : 1 panel state par tuile.
  const [dbOpen, setDbOpen] = React.useState(false);
  const [crmOpen, setCrmOpen] = React.useState(false);
  const [signalsOpen, setSignalsOpen] = React.useState(false);
  const toggleDb = React.useCallback(() => { setDbOpen(v => !v); setCrmOpen(false); setSignalsOpen(false); setHotOpen(false); setHotCompOpen(false); }, []);
  const toggleCrm = React.useCallback(() => { setCrmOpen(v => !v); setDbOpen(false); setSignalsOpen(false); setHotOpen(false); setHotCompOpen(false); }, []);
  const toggleSignals = React.useCallback(() => { setSignalsOpen(v => !v); setDbOpen(false); setCrmOpen(false); setHotOpen(false); setHotCompOpen(false); }, []);
  const toggleHotMutual = React.useCallback(() => { setHotOpen(v => !v); setDbOpen(false); setCrmOpen(false); setSignalsOpen(false); setHotCompOpen(false); }, []);
  const toggleHotComp = React.useCallback(() => { setHotCompOpen(v => !v); setDbOpen(false); setCrmOpen(false); setSignalsOpen(false); setHotOpen(false); }, []);
  const [selectedProspectId, setSelectedProspectId] = React.useState<string>('');
  const [analysis, setAnalysis] = React.useState<AIAnalysis | null>(null);
  const [isAnalyzing, setIsAnalyzing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [useOfflineOnly, setUseOfflineOnly] = React.useState(false);
  const [creating, setCreating] = React.useState(false);
  const toast = useToast();

  const handleAnalyze = async () => {
    if (!selectedProspectId) return;
    const prospect = prospects.find(p => p.id === selectedProspectId);
    if (!prospect) {
      setError('Prospect introuvable dans la base.');
      return;
    }

    try {
      setIsAnalyzing(true);
      setError(null);
      const result = await aiService.analyzeProspect(
        selectedProspectId,
        prospect,
        null,
        { offlineOnly: useOfflineOnly, preferLocalPipeline: !useOfflineOnly },
      );
      setAnalysis(result);
      // Round 46 — si le provider IA est limité (429/5xx), le service bascule
      // en heuristique locale : on le signale au lieu d'un faux "analyse complète".
      const src = String(result.raw_response?.source ?? result.raw_response?.provider ?? '');
      if (src.includes('heuristic') || src.includes('local')) {
        toast.info(`Analyse heuristique locale (provider IA limité ou offline) — l'analyse 7-engines sera retentée au prochain sweep.`, 5000);
      } else {
        toast.success(`Analyse complète pour ${prospect.first_name} ${prospect.last_name}.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed.';
      setError(msg);
      toast.error(msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * Round 38 — quick demo path : crée un prospect dans la DB backend et lance
   * immédiatement l'analyse IA. Résout le cas "DB vide après reset R38" qui
   * laissait l'utilisateur sans aucun moyen de tester AI Center.
   */
  const createDemoProspectAndAnalyze = async () => {
    setCreating(true);
    setError(null);
    try {
      const samples = [
        { first_name: 'Camille', last_name: 'Rivière', role: 'CTO', sector: 'FinTech', city: 'Paris', country: 'France', email: 'camille@lumensai.io' },
        { first_name: 'Aïcha',  last_name: 'Benyahia', role: 'VP Strategy', sector: 'SaaS B2B', city: 'Lyon', country: 'France', email: 'aicha@northwave.io' },
        { first_name: 'Thomas', last_name: 'Marchand', role: 'Chief Data Officer', sector: 'HealthTech', city: 'Bordeaux', country: 'France', email: 'thomas@helixbio.fr' },
      ];
      const pick = samples[Math.floor(Math.random() * samples.length)];
      const api = getApiClient();
      const created = await api.post<{ id: string; first_name: string; last_name: string }>(
        ENDPOINTS.prospectsList,
        {
          ...pick,
          score: 55,
          status: 'new',
          notes: 'Auto-created from AI Center demo path',
        },
      );
      toast.success(`Prospect ${pick.first_name} ${pick.last_name} créé.`);
      // Refresh the dropdown so the user can see + analyse the new row.
      await refetch();
      setSelectedProspectId(created.id);
      // Auto-trigger analyse right away.
      setIsAnalyzing(true);
      try {
        const result = await aiService.analyzeProspect(
          created.id,
          { ...pick, id: created.id },
          null,
          { preferLocalPipeline: true },
        );
        setAnalysis(result);
        const src2 = String(result.raw_response?.source ?? result.raw_response?.provider ?? '');
        if (src2.includes('heuristic') || src2.includes('local')) {
          toast.info(`Analyse heuristique locale (provider limité) — l'analyse 7-engines sera retentée au prochain sweep.`, 5000);
        } else {
          toast.success(`Analyse IA démarrée pour ${pick.first_name}.`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Analyse IA échouée.';
        setError(msg);
        toast.error(msg);
      } finally {
        setIsAnalyzing(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Création prospect impossible.';
      setError(msg);
      toast.error(msg);
    } finally {
      setCreating(false);
    }
  };

  const ScoreGauge = ({ label, value, color }: any) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground uppercase font-semibold tracking-wider">{label}</span>
        <span className="font-bold">{value}%</span>
      </div>
      <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
        <div
          className={cn('h-full transition-all duration-1000', color)}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );

  return (
    <>
      {/* Round 52 — StatsHero + EnginesPipeline : remplissent le viewport pour
          éviter l'effet « page noire » quand aucun résultat d'analyse n'est
          encore affiché. Les chiffres viennent du backend (queries déjà câblées
          dans useBackendData), et la pipeline représente les 7 engines
          IA spécialisés enchainés par IntelligencePipeline. */}
      <AiCenterHero tiles={buildProspectHeroTiles(
        prospects,
        companies,
        monitoring,
        analytics,
        {
          // HOT (existing R54)
          hotList, hotOnClick: toggleHotMutual, hotExpanded: hotOpen,
          // R58 — HOT COMPANIES (rose) : aggregate_score LEFT JOIN prospects
          hotCompList, hotCompOnClick: toggleHotComp, hotCompExpanded: hotCompOpen,
          // R56 — DB / CRM / 24H all clickable now
          dbList: prospects, dbOnClick: toggleDb, dbExpanded: dbOpen,
          crmList: companies, crmOnClick: toggleCrm, crmExpanded: crmOpen,
          sigList: monitoring, sigOnClick: toggleSignals, sigExpanded: signalsOpen,
        },
      )} />
      <ProspectsPanel
        open={dbOpen}
        list={prospects}
        loading={false}
        onClose={() => setDbOpen(false)}
      />
      <CompaniesPanel
        open={crmOpen}
        list={companies}
        loading={false}
        onClose={() => setCrmOpen(false)}
      />
      <MonitoringPanel
        open={signalsOpen}
        list={monitoring}
        loading={false}
        onClose={() => setSignalsOpen(false)}
      />
      <HotProspectsPanel
        open={hotOpen}
        list={hotList}
        loading={hotFetching && hotList.length === 0}
        onClose={() => setHotOpen(false)}
      />
      <HotCompaniesPanel
        open={hotCompOpen}
        list={hotCompList as any[]}
        loading={hotCompFetching && hotCompList.length === 0}
        onClose={() => setHotCompOpen(false)}
      />
      <SingleProspectEnginesPipeline />
      <Card className="bg-card/50 border-border shadow-2xl overflow-hidden">
        <CardContent className="p-8">
          <div className="flex flex-col md:flex-row items-end gap-6">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium text-muted-foreground inline-flex items-center gap-2">
                Select a Prospect to Analyze
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-secondary text-[10px] uppercase font-bold text-muted-foreground">
                  <Database size={10} /> {prospects.length} in DB
                </span>
              </label>
              <select
                className="w-full bg-secondary/50 border border-border rounded-lg h-11 px-4 text-foreground focus:ring-2 focus:ring-primary outline-none transition-all"
                value={selectedProspectId}
                onChange={(e) => setSelectedProspectId(e.target.value)}
              >
                <option value="">Choose a prospect…</option>
                {prospects.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name}
                    {p.email ? ` · ${p.email}` : ''}
                    {p.sector ? ` · ${p.sector}` : ''}
                  </option>
                ))}
              </select>
              {prospects.length === 0 && !loadingProspects && (
                <p className="text-xs text-amber-400 mt-2">
                  ⚠ Aucun prospect en base — clique sur
                  <em className="mx-1">« + Demo prospect &amp; analyse »</em>
                  ou va dans l'onglet <strong>Strategic Prospecting</strong>.
                </p>
              )}
            </div>
            <label className="h-11 px-4 inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border bg-secondary/50"
                checked={useOfflineOnly}
                onChange={(e) => setUseOfflineOnly(e.target.checked)}
              />
              Mode offline (heuristique locale)
            </label>
            <Button
              className="h-11 px-8 bg-primary hover:bg-primary/90 disabled:opacity-50"
              disabled={!selectedProspectId || isAnalyzing}
              onClick={handleAnalyze}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analyzing...
                </>
              ) : (
                <>
                  <Zap className="mr-2 h-4 w-4" /> Start Strategic Analysis
                </>
              )}
            </Button>
          </div>

          {/* Round 38 — empty-DB escape hatches so AI Center is never a dead-end. */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="border-border text-foreground hover:bg-secondary/60 inline-flex items-center gap-2"
              disabled={creating || isAnalyzing}
              onClick={createDemoProspectAndAnalyze}
            >
              {creating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <UserPlus className="h-3.5 w-3.5" />
              )}
              + Demo prospect &amp; analyse
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-primary inline-flex items-center gap-2"
              onClick={() => setMode && setMode('prospecting')}
              type="button"
            >
              <Sparkles className="h-3.5 w-3.5" /> Aller à Strategic Prospecting
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground/70 hover:text-foreground inline-flex items-center gap-2"
              onClick={() => refetch()}
              type="button"
              title="Rafraîchir la liste depuis le backend"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Rafraîchir la liste
            </Button>
          </div>

          {error && (
            <div className="mt-6 p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-3">
              <AlertCircle size={20} />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {isAnalyzing && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 bg-card/50 rounded-xl border border-border" />
          ))}
        </div>
      )}

      {analysis && !isAnalyzing && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="md:col-span-2 bg-card/50 border-border">
              <CardHeader>
                <CardTitle className="text-xl">Executive Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg leading-relaxed text-muted-foreground italic">
                  &ldquo;{analysis.summary}&rdquo;
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border">
              <CardHeader>
                <CardTitle className="text-xl">Intelligence Scores</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <ScoreGauge label="Relevance" value={analysis.scores.relevance} color="bg-blue-500" />
                <ScoreGauge label="Opportunity" value={analysis.scores.opportunity} color="bg-purple-500" />
                <ScoreGauge label="Intent" value={analysis.scores.intent} color="bg-green-500" />
                <ScoreGauge label="Confidence" value={analysis.scores.confidence} color="bg-amber-500" />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-green-500/5 border-green-500/20">
              <CardHeader>
                <CardTitle className="text-green-500 flex items-center gap-2 text-base">
                  <Lightbulb size={18} /> Strategic Insights
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {analysis.insights.map((insight, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                      {insight}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="bg-red-500/5 border-red-500/20">
              <CardHeader>
                <CardTitle className="text-red-500 flex items-center gap-2 text-base">
                  <ShieldAlert size={18} /> Potential Risks
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {analysis.risks.map((risk, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-red-500 mt-1.5 shrink-0" />
                      {risk}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="bg-blue-500/5 border-blue-500/20">
              <CardHeader>
                <CardTitle className="text-blue-500 flex items-center gap-2 text-base">
                  <Target size={18} /> Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {analysis.recommendations.map((rec, i) => (
                    <li key={i} className="text-sm flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                      {rec}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

/* ============================================================
 * Round 53 — AiCenterHero + tile builders
 * ------------------------------------------------------------
 *  Bandeau de 4 KPI tiles générique réutilisé par les 3 onglets
 *  de l'AICenter :
 *    - Single Prospect  → buildProspectHeroTiles
 *    - Prospecting      → buildProspectingHeroTiles
 *    - Outreach         → buildOutreachHeroTiles
 *
 *  But : remplir le viewport dès le 1er render pour éviter l'effet
 *  « page noire » que le user a signalé sur SingleProspect (Round
 *  52) et qu'il demande maintenant pour les 2 autres onglets.
 * ============================================================ */
export type AiCenterHeroTile = {
  /** Petite icône lucide. */
  icon: React.ReactNode;
  /** Couleur d'accent (text + bg + border tint). */
  accent: 'cyan' | 'violet' | 'emerald' | 'amber' | 'rose' | 'blue' | 'pink' | 'orange';
  /** Pastille coin haut droit (ex: 'DB', 'HOT'). */
  chip: string;
  /** Valeur principale — peut être un number ou un string formaté. */
  value: React.ReactNode;
  /** Légende sous la valeur. */
  label: string;
  /** Round 54 — optionnel : si défini, la tile devient cliquable. */
  onClick?: () => void;
  /** Indicateur d'expansion (affiché en overlay si onClick fourni). */
  expanded?: boolean;
  /** aria-label custom (sinon dérivé de chip + value + label). */
  ariaLabel?: string;
};

/* Round 53b — redesign premium noir + or : toutes les tiles partagent la
 * même palette champagne/or au lieu d'un arc-en-ciel. Le type `accent` est
 * conservé (8 valeurs) pour ne pas casser les call-sites, mais elles sont
 * toutes mappées vers le même dégradé or. */
const ACCENT_BG: Record<AiCenterHeroTile['accent'], string> = {
  cyan:    'from-amber-500/40',
  violet:  'from-amber-500/40',
  emerald: 'from-amber-500/40',
  amber:   'from-amber-500/40',
  rose:    'from-amber-500/40',
  blue:    'from-amber-500/40',
  pink:    'from-amber-500/40',
  orange:  'from-amber-500/40',
};
const ACCENT_TINT: Record<AiCenterHeroTile['accent'], { text: string; bg: string; border: string; glow: string }> = {
  cyan:    { text: 'text-amber-300',   bg: 'bg-amber-500/30',   border: 'border-amber-400/50',   glow: 'bg-amber-400/30' },
  violet:  { text: 'text-amber-300',   bg: 'bg-amber-500/30',   border: 'border-amber-400/50',   glow: 'bg-amber-400/30' },
  emerald: { text: 'text-amber-300',   bg: 'bg-amber-500/30',   border: 'border-amber-400/50',   glow: 'bg-amber-400/30' },
  amber:   { text: 'text-amber-300',   bg: 'bg-amber-500/30',   border: 'border-amber-400/50',   glow: 'bg-amber-400/30' },
  rose:    { text: 'text-amber-300',   bg: 'bg-amber-500/30',   border: 'border-amber-400/50',   glow: 'bg-amber-400/30' },
  blue:    { text: 'text-amber-300',   bg: 'bg-amber-500/30',   border: 'border-amber-400/50',   glow: 'bg-amber-400/30' },
  pink:    { text: 'text-amber-300',   bg: 'bg-amber-500/30',   border: 'border-amber-400/50',   glow: 'bg-amber-400/30' },
  orange:  { text: 'text-amber-300',   bg: 'bg-amber-500/30',   border: 'border-amber-400/50',   glow: 'bg-amber-400/30' },
};

function AiCenterHero({ tiles }: { tiles: AiCenterHeroTile[] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {tiles.map((t, idx) => {
        const accent = ACCENT_TINT[t.accent];
        const from = ACCENT_BG[t.accent];
        const content = (
          <>
            {/* Round 55 — much brighter aurora glow + a secondary glow at bottom-left
                so each tile POP against the dark page bg. */}
            <div className={cn('absolute -top-16 -right-16 w-48 h-48 rounded-full blur-2xl transition-opacity duration-500', accent.glow, t.onClick ? 'opacity-90 group-hover:opacity-100' : 'opacity-80')} />
            <div className={cn('absolute -bottom-12 -left-12 w-32 h-32 rounded-full blur-2xl transition-opacity duration-500', accent.glow, 'opacity-60')} />
            {/* Top accent stripe — makes the tile immediately recognizable as 'colored' */}
            <div className={cn('absolute top-0 left-0 right-0 h-1 rounded-t-xl', accent.text.replace('text-', 'bg-'))} />
            <div className="flex items-center justify-between mb-3 relative">
              <div className={cn('inline-flex items-center justify-center w-10 h-10 rounded-lg border-2 shadow-lg', accent.bg, accent.border)}>
                <span className={accent.text}>{t.icon}</span>
              </div>
              <span className={cn('text-[10px] uppercase tracking-widest font-black px-2 py-0.5 rounded-md', accent.bg, accent.text, 'border', accent.border)}>
                {t.chip}
              </span>
            </div>
            <div className="text-4xl font-black tabular-nums text-foreground relative drop-shadow-lg">{t.value}</div>
            <div className="text-sm text-foreground/80 mt-1.5 relative font-medium">{t.label}</div>
            {t.onClick && (
              <div className={cn(
                'absolute bottom-3 right-3 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider transition-all',
                accent.text,
                t.expanded ? 'opacity-100 translate-y-0' : 'opacity-100 translate-y-0 group-hover:scale-110',
              )}>
                {t.expanded ? '▼ Replier' : '▾ Voir la liste'}
              </div>
            )}
          </>
        );
        const className = cn(
          'rounded-xl border-2 backdrop-blur-xl shadow-2xl relative overflow-hidden text-left transition-all p-5 min-h-[150px]',
          'bg-gradient-to-br',
          from,
          'via-card/80 to-card/70',
          t.onClick && 'group cursor-pointer hover:scale-[1.02] hover:shadow-2xl active:scale-[0.99]',
          t.onClick ? accent.border : 'border-border/60',
        );
        if (t.onClick) {
          return (
            <button
              key={idx}
              type="button"
              onClick={t.onClick}
              aria-expanded={t.expanded ?? false}
              aria-label={t.ariaLabel ?? `${t.chip} ${t.value} ${t.label}`}
              className={className}
            >
              {content}
            </button>
          );
        }
        return (
          <div key={idx} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

/** 5 tiles du tab Single Prospect : focus "où sont mes données brutes".
 *  Round 54 — la tile HOT devient cliquable :
 *   - `hotList` = réponse de /api/analytics/hot-prospects (détail)
 *   - `onHotClick` / `hotExpanded` câblent l'ouverture du pop-over
 *     qui affiche la liste détaillée.
 *  Round 56 — toutes les tuiles devienent cliquables :
 *   - DB  → ProspectsPanel (top 8 prospects par score)
 *   - CRM → CompaniesPanel (top 8 companies par score)
 *   - 24H → MonitoringPanel (signaux des dernières 24h triés par confiance)
 *   - HOT → HotProspectsPanel (déjà câblé R54)
 *  Round 58 — ajout d'une 5ème tile HOT COMPANIES (rose) :
 *   - `hotCompList` = réponse de /api/companies/hot-companies (LEFT JOIN prospects + aggregate_score)
 *   - `hotCompOnClick` / `hotCompExpanded` câblent l'ouverture du pop-over
 *     qui affiche la liste détaillée. Chaque ligne navigue vers `/companies/<id>`.
 *  L'ouverture d'une tuile ferme les autres (cliquable mutu exclusif).
 */
function buildProspectHeroTiles(
  prospects: any[],
  companies: any[],
  monitoring: any[],
  analytics?: any,
  opts?: {
    // Existing R54 — HOT prospects
    hotList?: any[];
    hotOnClick?: () => void;
    hotExpanded?: boolean;
    // R58 — HOT companies (rose)
    hotCompList?: any[];
    hotCompOnClick?: () => void;
    hotCompExpanded?: boolean;
    // R56 — DB
    dbList?: any[];
    dbOnClick?: () => void;
    dbExpanded?: boolean;
    // R56 — CRM
    crmList?: any[];
    crmOnClick?: () => void;
    crmExpanded?: boolean;
    // R56 — 24H
    sigList?: any[];
    sigOnClick?: () => void;
    sigExpanded?: boolean;
  },
): AiCenterHeroTile[] {
  const hotCount =
    analytics?.hot_prospects ??
    analytics?.hotProspects ??
    opts?.hotList?.length ??
    prospects.filter((p) => Number(p.score ?? 0) >= 70).length;
  const signals24h = (monitoring ?? []).filter((s) => {
    const t = s.detected_at ?? s.created_at ?? s.published_at ?? null;
    if (!t) return true;
    const ms = Date.now() - new Date(t).getTime();
    return ms >= 0 && ms < 24 * 60 * 60 * 1000;
  }).length;
  // Si la tuile CRM est ouverte et qu'on a des données, on label "Voir les N companies".
  const crmLabel = opts?.crmExpanded && opts?.crmList && opts.crmList.length
    ? `Voir les ${opts.crmList.length} companies trackées`
    : 'Companies dans la base';
  const dbLabel = opts?.dbExpanded && opts?.dbList && opts.dbList.length
    ? `Voir les ${opts.dbList.length} prospects en base`
    : 'Prospects en base';
  const sigLabel = opts?.sigExpanded
    ? `Voir les ${signals24h} signaux des dernières 24h`
    : 'Signaux captés en 24h';
  return [
    {
      icon: <Users size={18} />,
      accent: 'cyan',
      chip: 'DB',
      value: prospects.length,
      label: dbLabel,
      onClick: opts?.dbOnClick,
      expanded: opts?.dbExpanded,
      ariaLabel: `Voir la liste des ${prospects.length} prospects en base`,
    },
    {
      icon: <Building2 size={18} />,
      accent: 'violet',
      chip: 'CRM',
      value: companies.length,
      label: crmLabel,
      onClick: opts?.crmOnClick,
      expanded: opts?.crmExpanded,
      ariaLabel: `Voir la liste des ${companies.length} companies trackées`,
    },
    {
      icon: <Activity size={18} />,
      accent: 'emerald',
      chip: '24H',
      value: signals24h,
      label: sigLabel,
      onClick: opts?.sigOnClick,
      expanded: opts?.sigExpanded,
      ariaLabel: `Voir le feed des ${signals24h} signaux des dernières 24h`,
    },
    {
      icon: <Target size={18} />,
      accent: 'amber',
      chip: 'HOT',
      value: hotCount,
      label: opts?.hotList && opts.hotList.length > 0
        ? `Hot prospects — ${opts.hotList.length} profils > ${(opts.hotList[0]?.score ?? 70)}/100`
        : 'Hot prospects (score ≥ 70)',
      onClick: opts?.hotOnClick,
      expanded: opts?.hotExpanded,
      ariaLabel: `Voir la liste des ${hotCount} prospects hot (score >= 70)`,
    },
    // Round 58 — 5ème tile HOT COMPANIES (rose).
    {
      icon: <Crown size={18} />,
      accent: 'rose',
      chip: 'HOT C',
      value: opts?.hotCompList?.length ?? companies.filter((c) => Number(c.score ?? 0) >= 70).length,
      label: opts?.hotCompList && opts.hotCompList.length > 0
        ? `Hot companies — ${opts.hotCompList.length} profils agg ≥ ${Math.round(opts.hotCompList[0]?.aggregate_score ?? 70)}/100`
        : 'Hot companies (score ≥ 70)',
      onClick: opts?.hotCompOnClick,
      expanded: opts?.hotCompExpanded,
      ariaLabel: `Voir la liste des ${opts?.hotCompList?.length ?? 0} sociétés hot (aggregate_score)`,
    },
  ];
}

/** 4 tiles du tab Prospecting : focus "ce que la sweep va produire". */
function buildProspectingHeroTiles(
  sector: string,
  region: string,
  targetCount: number,
  lastResult: any | null,
): AiCenterHeroTile[] {
  // lastResult peut avoir company_count, icp_match_avg, ou être null au 1er render.
  const foundCompanies = lastResult?.company_count ?? lastResult?.companies?.length ?? '—';
  const icpPct = lastResult?.icp_match_avg ?? lastResult?.icp?.match_avg ?? null;
  const priority = lastResult?.top_priority ?? lastResult?.priority_tier ?? null;
  return [
    { icon: <Briefcase size={18} />,    accent: 'cyan',    chip: 'SECTOR', value: sector || '—',                 label: 'Niche de prospection' },
    { icon: <Globe size={18} />,       accent: 'violet',  chip: 'REGION', value: region || 'Global',            label: 'Marché ciblé' },
    { icon: <Users size={18} />,       accent: 'emerald', chip: 'TARGET', value: targetCount,                   label: 'Entreprises à détecter' },
    {
      icon: <Sparkles size={18} />,
      accent: 'amber',
      chip: lastResult ? 'LAST SWEEP' : 'READY',
      value: lastResult
        ? (
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-3xl">{foundCompanies}</span>
            {icpPct !== null && (
              <span className="text-xs text-amber-400 font-bold">
                ICP {Math.round(Number(icpPct))}%
              </span>
            )}
          </span>
        )
        : <span className="text-base font-bold">Prêt à lancer</span>,
      label: lastResult
        ? (priority ? `Top: ${priority}` : 'Dernier résultat')
        : 'Lance la sweep pour remplir',
    },
  ];
}

/** 4 tiles du tab Outreach : focus "état de mes séquences email". */
function buildOutreachHeroTiles(kpis: {
  total: number; sent: number; replied: number; draft: number; bounced: number; responseRate: number;
}): AiCenterHeroTile[] {
  return [
    { icon: <Database size={18} />,    accent: 'cyan',     chip: 'INBOX',  value: kpis.total,                       label: 'Emails générés' },
    { icon: <Sparkles size={18} />,    accent: 'violet',   chip: 'DRAFTS', value: kpis.draft,                       label: 'Brouillons à envoyer' },
    { icon: <Send size={18} />,        accent: 'emerald',  chip: 'SENT',   value: kpis.sent,                        label: 'Séquences envoyées' },
    {
      icon: <TrendingUp size={18} />,
      accent: 'amber',
      chip: 'REPLY',
      value: (
        <span className="inline-flex items-baseline gap-1.5">
          <span className="text-3xl">{kpis.replied}</span>
          <span className="text-xs text-amber-400 font-bold">{kpis.responseRate}%</span>
        </span>
      ),
      label: 'Réponses & taux de réponse',
    },
  ];
}

/* ============================================================
 * Round 54 — HotProspectsPanel
 * ------------------------------------------------------------
 *  Petit panneau qui s'affiche sous le hero quand l'utilisateur
 *  clique sur la tuile HOT. Affiche la liste détaillée (top 8) des
 *  prospects hot avec : nom, score (Pastille colorée), secteur,
 *  société (LEFT JOIN calculé back), raisons calculées (Score
 *  exceptionnel, Status engagé, etc.), et un bouton "Voir la
 *  fiche" qui navigue vers `/prospects?focus=<id>`.
 *
 *  L'animation d'apparition utilise `animate-in fade-in
 *  slide-in-from-top-2` (Tailwind plugin) pour rester cohérent
 *  avec le reste du design system Zentara.
 * ============================================================ */
function HotProspectsPanel({
  open,
  list,
  loading,
  onClose,
}: {
  open: boolean;
  list: any[];
  loading: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Card className="bg-card/50 border-amber-500/30 backdrop-blur-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
      <CardHeader className="pb-3 border-b border-amber-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 text-amber-400">
              <div className="inline-flex w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/40 items-center justify-center">
                <Target size={14} />
              </div>
              Top {list.length} prospects hot
            </CardTitle>
            <CardDescription className="text-xs">
              Prospects avec score stratégique ≥ 70, triés par score décroissant.
              Chaque ligne expose la société rattachée et la raison pour laquelle le prospect est classé « hot ».
              Cliquer une ligne navigue vers sa fiche.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-amber-400"
          >
            <ChevronDown size={14} />
            Replier
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3">
        {loading ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            <Loader2 size={14} className="inline animate-spin mr-2" />
            Chargement des prospects hot…
          </div>
        ) : list.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6 space-y-1">
            <p>Aucun prospect avec score ≥ 70 pour le moment.</p>
            <p>Lance une analyse 7-engines sur des prospects pour faire monter leurs scores.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/30">
            {list.map((p) => {
              const score = Number(p.score ?? 0);
              const scoreColor = score >= 90
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                : score >= 80
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40';
              return (
                <li key={p.id}>
                  <Link
                    to={`/prospects?focus=${encodeURIComponent(p.id)}`}
                    className="group flex items-center gap-4 p-3 hover:bg-amber-500/5 rounded-lg transition-colors"
                  >
                    <div className={cn(
                      'shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-xl border tabular-nums font-black text-base',
                      scoreColor,
                    )}>
                      {score}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold truncate">
                          {p.first_name} {p.last_name}
                        </span>
                        <Badge variant="outline" className={cn('text-[10px] uppercase tracking-widest shrink-0', scoreColor)}>
                          {p.status}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                        {p.role && <span>{p.role}</span>}
                        {p.role && <span>·</span>}
                        {p.company_name && (
                          <>
                            <Building2 size={10} />
                            <span className="font-semibold">{p.company_name}</span>
                            <span>·</span>
                          </>
                        )}
                        {p.sector && <span>{p.sector}</span>}
                        {p.email && (
                          <>
                            <span>·</span>
                            <span className="font-mono text-[10px]">{p.email}</span>
                          </>
                        )}
                      </div>
                      {p.reasons && p.reasons.length > 0 && (
                        <div className="text-[10px] text-amber-400 mt-1 line-clamp-1">
                          {p.reasons.slice(0, 2).join(' · ')}
                        </div>
                      )}
                    </div>
                    <ExternalLink size={14} className="text-muted-foreground/40 group-hover:text-amber-400 transition-colors shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * Round 56 — ProspectsPanel / CompaniesPanel / MonitoringPanel
 * ------------------------------------------------------------
 *  Panneaux frères de HotProspectsPanel, déclenchés par les autres
 *  tiles du AiCenterHero (DB → ProspectsPanel, CRM → CompaniesPanel,
 *  24H → MonitoringPanel, HOT C → HotCompaniesPanel). Mêmes effets
 *  Tailwind, même UX, mais urls / format / couleur d'accent ajustés
 *  par tile.
 *
 *  But : transformer le hero AiCenter en navigation drill-down
 *  (click tile → liste → click ligne → fiche).
 * ============================================================ */

/**
 * Round 58 — HotCompaniesPanel
 * ------------------------------------------------------------
 *  Pop-over affiché sous le hero quand l'utilisateur clique la 5ème tile
 *  « HOT C » (rose). Affiche les sociétés « hot » retournées par
 *  `GET /api/companies/hot-companies` avec :
 *    - aggregate_score (pastille colorée : rose ≥ 90, amber ≥ 80, cyan ≥ 50)
 *    - prospect_count + hot_prospect_count (badge prospects rattachés)
 *    - reasons[] (Score exceptionnel, N prospects hot, contacts en base,
 *      Analyse IA récente 7j, Signal critique détecté 7j)
 *  Chaque ligne navigue vers `/companies/<id>` (fiche détaillée).
 *
 *  Mêmes animations que HotProspectsPanel (`animate-in fade-in
 *  slide-in-from-top-2 duration-300`).
 * ============================================================ */
function HotCompaniesPanel({
  open,
  list,
  loading,
  onClose,
}: {
  open: boolean;
  list: any[];
  loading: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Card className="bg-card/50 border-rose-500/30 backdrop-blur-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
      <CardHeader className="pb-3 border-b border-rose-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 text-rose-400">
              <div className="inline-flex w-7 h-7 rounded-lg bg-rose-500/20 border border-rose-500/40 items-center justify-center">
                <Crown size={14} />
              </div>
              Top {list.length} sociétés hot · aggregate_score
            </CardTitle>
            <CardDescription className="text-xs">
              Sociétés avec company.score ≥ 70, enrichies LEFT JOIN prospects
              (count + avg_score) + signaux monitoring 7j + analyses IA 7j.
              Score agrégé = moyenne pondérée 40%×company + 30%×prospects_avg + 30%×intelligence.
              Cliquer une ligne navigue vers sa fiche détaillée.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-rose-400"
          >
            <ChevronDown size={14} />
            Replier
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3">
        {loading ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            <Loader2 size={14} className="inline animate-spin mr-2" />
            Chargement des sociétés hot…
          </div>
        ) : list.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6 space-y-1">
            <p>Aucune société avec score ≥ 70 pour le moment.</p>
            <p>Lance un strategic prospecting pour générer 50 cibles, puis auto-sweep.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/30">
            {list.map((c) => {
              const aggregate = Number(c.aggregate_score ?? c.score ?? 0);
              const aggregateColor = aggregate >= 90
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                : aggregate >= 80
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40';
              const hotProspectCount = Number(c.hot_prospect_count ?? 0);
              const prospectCount = Number(c.prospect_count ?? 0);
              return (
                <li key={c.id}>
                  <Link
                    to={`/companies/${encodeURIComponent(c.id)}`}
                    className="group flex items-center gap-4 p-3 hover:bg-rose-500/5 rounded-lg transition-colors"
                  >
                    <div className={cn(
                      'shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-xl border tabular-nums font-black text-base',
                      aggregateColor,
                    )}>
                      {aggregate}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold truncate">{c.name || c.id}</span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-widest shrink-0 border-border text-muted-foreground">
                          {c.status ?? 'active'}
                        </Badge>
                        {hotProspectCount > 0 && (
                          <Badge variant="outline" className="text-[10px] uppercase tracking-widest shrink-0 bg-rose-500/15 text-rose-300 border-rose-500/40 font-bold">
                            🔥 {hotProspectCount} hot
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                        {c.sector && <span>{c.sector}</span>}
                        {(c.city || c.country) && <><span>·</span><span>{[c.city, c.country].filter(Boolean).join(', ')}</span></>}
                        {c.website && <><span>·</span><span className="font-mono text-[10px]">{c.website.replace(/^https?:\/\//,'').slice(0,28)}</span></>}
                        {prospectCount > 0 && (
                          <>
                            <span>·</span>
                            <span className="font-bold text-foreground/80">
                              {prospectCount} contact{prospectCount > 1 ? 's' : ''} (avg {c.prospect_avg_score ?? 0})
                            </span>
                          </>
                        )}
                      </div>
                      {c.reasons && c.reasons.length > 0 && (
                        <div className="text-[10px] text-rose-300/80 mt-1 line-clamp-1">
                          {c.reasons.slice(0, 2).join(' · ')}
                        </div>
                      )}
                    </div>
                    <ExternalLink size={14} className="text-muted-foreground/40 group-hover:text-rose-300 transition-colors shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ProspectsPanel({
  open,
  list,
  loading,
  onClose,
}: {
  open: boolean;
  list: any[];
  loading: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  // Sort by score desc, take top 8 displayed.
  const sorted = [...list].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  const top = sorted.slice(0, 8);
  return (
    <Card className="bg-card/50 border-cyan-500/30 backdrop-blur-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
      <CardHeader className="pb-3 border-b border-cyan-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 text-cyan-300">
              <div className="inline-flex w-7 h-7 rounded-lg bg-cyan-500/20 border border-cyan-500/40 items-center justify-center">
                <Users size={14} />
              </div>
              {list.length} prospects en base · top {top.length} par score
            </CardTitle>
            <CardDescription className="text-xs">
              Tous les prospects indexés dans la DB Zentara (SQLite via API backend).
              Cliquer une ligne navigue vers la page Prospects et focus la fiche.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-cyan-300"
          >
            <ChevronDown size={14} />
            Replier
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3">
        {loading ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            <Loader2 size={14} className="inline animate-spin mr-2" />
            Chargement de la base prospects…
          </div>
        ) : top.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6 space-y-1">
            <p>Aucun prospect en base. Crée ton premier contact pour démarrer une campagne.</p>
            <p>Tu peux en créer un depuis l'onglet <strong>Prospects → Add</strong>.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/30">
            {top.map((p) => {
              const score = Number(p.score ?? 0);
              const scoreColor = score >= 90
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                : score >= 80
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : score >= 50
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    : 'bg-secondary text-muted-foreground border-border';
              return (
                <li key={p.id}>
                  <Link
                    to={`/prospects?focus=${encodeURIComponent(p.id)}`}
                    className="group flex items-center gap-4 p-3 hover:bg-cyan-500/5 rounded-lg transition-colors"
                  >
                    <div className={cn(
                      'shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-lg border tabular-nums font-black text-sm',
                      scoreColor,
                    )}>
                      {score || '–'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold truncate">
                          {p.first_name} {p.last_name}
                        </span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-widest shrink-0 border-border text-muted-foreground">
                          {p.status}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                        {p.role && <span>{p.role}</span>}
                        {p.sector && <><span>·</span><span>{p.sector}</span></>}
                        {p.email && <><span>·</span><span className="font-mono text-[10px]">{p.email}</span></>}
                      </div>
                    </div>
                    <ExternalLink size={14} className="text-muted-foreground/40 group-hover:text-cyan-300 transition-colors shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CompaniesPanel({
  open,
  list,
  loading,
  onClose,
}: {
  open: boolean;
  list: any[];
  loading: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  const sorted = [...list].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  const top = sorted.slice(0, 8);
  return (
    <Card className="bg-card/50 border-violet-500/30 backdrop-blur-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
      <CardHeader className="pb-3 border-b border-violet-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 text-violet-300">
              <div className="inline-flex w-7 h-7 rounded-lg bg-violet-500/20 border border-violet-500/40 items-center justify-center">
                <Building2 size={14} />
              </div>
              {list.length} companies trackées · top {top.length} par score
            </CardTitle>
            <CardDescription className="text-xs">
              CRM : sociétés indexées dans la base (auto-sweep, prospecting sessions, ajouts manuels).
              Cliquer une ligne ouvre directement sa fiche d'analyse.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-violet-300"
          >
            <ChevronDown size={14} />
            Replier
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3">
        {loading ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            <Loader2 size={14} className="inline animate-spin mr-2" />
            Chargement du CRM…
          </div>
        ) : top.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6 space-y-1">
            <p>Aucune société en base.</p>
            <p>Lance un strategic prospecting (onglet <strong>Prospecting</strong>) pour générer 50 cibles.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/30">
            {top.map((c) => {
              const score = Number(c.score ?? 0);
              const scoreColor = score >= 90
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                : score >= 80
                  ? 'bg-violet-500/15 text-violet-300 border-violet-500/40'
                  : score >= 50
                    ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                    : 'bg-secondary text-muted-foreground border-border';
              return (
                <li key={c.id}>
                  <Link
                    to={`/companies/${encodeURIComponent(c.id)}`}
                    className="group flex items-center gap-4 p-3 hover:bg-violet-500/5 rounded-lg transition-colors"
                  >
                    <div className={cn(
                      'shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-lg border tabular-nums font-black text-sm',
                      scoreColor,
                    )}>
                      {score || '–'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold truncate">{c.name || c.id}</span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-widest shrink-0 border-border text-muted-foreground">
                          {c.status ?? 'active'}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                        {c.sector && <span>{c.sector}</span>}
                        {(c.location || c.city) && <><span>·</span><span>{c.location || c.city}</span></>}
                        {c.website && <><span>·</span><span className="font-mono text-[10px]">{c.website.replace(/^https?:\/\//,'').slice(0,28)}</span></>}
                      </div>
                    </div>
                    <ExternalLink size={14} className="text-muted-foreground/40 group-hover:text-violet-300 transition-colors shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function MonitoringPanel({
  open,
  list,
  loading,
  onClose,
}: {
  open: boolean;
  list: any[];
  loading: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  // Filter to last 24h, sort by confidence desc, take top 10.
  const now = Date.now();
  const filtered = (list ?? []).filter((s) => {
    const t = s.detected_at ?? s.created_at ?? null;
    if (!t) return true;
    const ms = now - new Date(t).getTime();
    return ms >= 0 && ms < 24 * 60 * 60 * 1000;
  }).sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0));
  const top = filtered.slice(0, 10);
  const SEV: Record<string, string> = {
    critical: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
    warning: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    info:    'bg-cyan-500/15 text-cyan-300 border-cyan-500/40',
    ok:      'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  };
  return (
    <Card className="bg-card/50 border-emerald-500/30 backdrop-blur-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300">
      <CardHeader className="pb-3 border-b border-emerald-500/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 text-emerald-300">
              <div className="inline-flex w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 items-center justify-center">
                <Radar size={14} />
              </div>
              {filtered.length} signaux captés · dernières 24h
            </CardTitle>
            <CardDescription className="text-xs">
              Watcher Zentara (RSS, sites officiels, search APIs). Confiance descendant → ascending · cliquer
              une ligne navigue vers la fiche Monitoring.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground hover:text-emerald-300"
          >
            <ChevronDown size={14} />
            Replier
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-3">
        {loading ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            <Loader2 size={14} className="inline animate-spin mr-2" />
            Chargement du feed monitoring…
          </div>
        ) : top.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6 space-y-1">
            <p>Aucun signal faible détecté sur les dernières 24h.</p>
            <p>Le watcher scanne périodiquement ; clique « Run watcher tick » dans Monitoring pour forcer.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/30">
            {top.map((s) => {
              const sev = String(s.severity ?? 'info');
              const sevStyle = SEV[sev] ?? SEV.info;
              const link = s.entity_id
                ? (s.entity_type === 'company'
                    ? `/companies/${encodeURIComponent(s.entity_id)}?focus=${encodeURIComponent(s.id)}`
                    : `/prospects?focus=${encodeURIComponent(s.entity_id)}&sig=${encodeURIComponent(s.id)}`)
                : `/monitoring?focus=${encodeURIComponent(s.id)}`;
              return (
                <li key={s.id}>
                  <Link
                    to={link}
                    className="group flex items-center gap-4 p-3 hover:bg-emerald-500/5 rounded-lg transition-colors"
                  >
                    <div className={cn(
                      'shrink-0 inline-flex items-center justify-center w-11 h-11 rounded-lg border tabular-nums font-black text-sm',
                      sevStyle,
                    )}>
                      {Number(s.confidence ?? 0) || '–'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold truncate">
                          {s.entity_name || s.title || s.type || s.source || 'Signal'}
                        </span>
                        <Badge variant="outline" className={cn('text-[10px] uppercase tracking-widest shrink-0', sevStyle)}>
                          {sev}
                        </Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 mt-0.5">
                        {s.source && <span className="font-mono text-[10px]">{s.source}</span>}
                        {s.type && <><span>·</span><span>{s.type}</span></>}
                        {s.detected_at && <><span>·</span><span>{new Date(s.detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></>}
                      </div>
                      {s.content && (
                        <div className="text-[10px] text-emerald-300/80 mt-1 line-clamp-2">
                          {s.content}
                        </div>
                      )}
                    </div>
                    <ExternalLink size={14} className="text-muted-foreground/40 group-hover:text-emerald-300 transition-colors shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * Round 52 — SingleProspectEnginesPipeline
 * ------------------------------------------------------------
 *  Visualisation des 7 engines IA spécialisés tel qu'enchainés
 *  par IntelligencePipeline :
 *    Research → IntelligenceAnalysis → {Prospect, Company,
 *    OpportunityDetector} → Scoring → StrategicSynthesis.
 *
 *  Affichée comme carte horizontale avec des "nodes" reliés par
 *  des flèches. Chaque engine montre : icône, nom, rôle en
 *  2-3 mots. But : montrer à l'utilisateur ce qui va se passer
 *  en coulisses quand il lance une analyse, et remplir le
 *  viewport (effet "page noire" résolu).
 * ============================================================ */
function SingleProspectEnginesPipeline() {
  const engines: Array<{
    icon: React.ReactNode;
    name: string;
    role: string;
    accent: string;       // "from-X-500/40 via-X-500/20 border-X-400/60 text-X-300 bg-X-500/30"
    ring: string;
    glow: string;
  }> = [
    { icon: <Search size={16} />,        name: 'Research',            role: 'Collect sources',       accent: 'from-amber-500/40 via-amber-500/10 border-amber-400/70 text-amber-300 bg-amber-500/30', ring: 'ring-amber-500/50', glow: 'bg-amber-400/30' },
    { icon: <Brain size={16} />,         name: 'IntelligenceAnalysis',role: 'Signals & trends',      accent: 'from-amber-500/40 via-amber-500/10 border-amber-400/70 text-amber-300 bg-amber-500/30', ring: 'ring-amber-500/50', glow: 'bg-amber-400/30' },
    { icon: <Users size={16} />,         name: 'ProspectIntel',       role: 'Profile + intent',      accent: 'from-amber-500/40 via-amber-500/10 border-amber-400/70 text-amber-300 bg-amber-500/30', ring: 'ring-amber-500/50', glow: 'bg-amber-400/30' },
    { icon: <Building2 size={16} />,     name: 'CompanyIntel',        role: 'Business profile',      accent: 'from-amber-500/40 via-amber-500/10 border-amber-400/70 text-amber-300 bg-amber-500/30', ring: 'ring-amber-500/50', glow: 'bg-amber-400/30' },
    { icon: <Lightbulb size={16} />,     name: 'OpportunityDetection',role: 'Detect opportunities',  accent: 'from-amber-500/40 via-amber-500/10 border-amber-400/70 text-amber-300 bg-amber-500/30', ring: 'ring-amber-500/50', glow: 'bg-amber-400/30' },
    { icon: <Gauge size={16} />,         name: 'Scoring',             role: 'Multi-axis scores',     accent: 'from-amber-500/40 via-amber-500/10 border-amber-400/70 text-amber-300 bg-amber-500/30', ring: 'ring-amber-500/50', glow: 'bg-amber-400/30' },
    { icon: <CompassIcon size={16} />,   name: 'StrategicSynthesis',  role: 'Executive brief',       accent: 'from-amber-500/40 via-amber-500/10 border-amber-400/70 text-amber-300 bg-amber-500/30', ring: 'ring-amber-500/50', glow: 'bg-amber-400/30' },
  ];

  return (
    <Card className="bg-gradient-to-br from-card/60 via-card/40 to-card/30 border-amber-400/30 backdrop-blur-xl shadow-2xl overflow-hidden relative">
      {/* Aurora background glow */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-32 bg-amber-400/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-24 bg-amber-500/10 rounded-full blur-3xl" />
      </div>
      <CardHeader className="pb-2 relative">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <div className="inline-flex w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400/40 to-amber-400/10 border border-amber-400/50 items-center justify-center shadow-lg">
                <Network size={16} className="text-amber-300" />
              </div>
              <span className="bg-gradient-to-r from-amber-100 via-amber-200 to-amber-400 bg-clip-text text-transparent font-black">
                7-engine Strategic Pipeline
              </span>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Quand tu lances une analyse, ces 7 moteurs IA spécialisés tournent en cascade
              avec timeouts, retries et cascade conditionnelle.
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-amber-400/40 text-amber-300 bg-amber-400/15 text-[10px] uppercase tracking-widest shadow-md">
            <Sparkles size={10} className="mr-1" /> Live
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-3 pb-5 relative">
        <div className="relative flex flex-wrap md:flex-nowrap items-stretch justify-between gap-2">
          {engines.map((eng, idx) => (
            <React.Fragment key={eng.name}>
              <div
                className={cn(
                  'group relative flex-1 min-w-[140px] rounded-lg border-2 px-3 py-3 bg-gradient-to-br backdrop-blur-md transition-all hover:scale-[1.04] hover:shadow-xl cursor-default overflow-hidden',
                  eng.accent,
                )}
              >
                {/* per-engine glow */}
                <div className={cn('absolute -top-8 -right-8 w-24 h-24 rounded-full blur-2xl opacity-70 group-hover:opacity-100 transition-opacity duration-500', eng.glow)} />
                <div className="flex items-center gap-2 mb-1.5 relative">
                  <div className={cn('inline-flex w-8 h-8 rounded-md items-center justify-center border-2 shadow-md', eng.accent)}>
                    {eng.icon}
                  </div>
                  <span className={cn('text-[11px] uppercase tracking-widest font-black', eng.accent.split(' ').find(c => c.startsWith('text-')))}>
                    Step {idx + 1}
                  </span>
                </div>
                <div className="text-sm font-black truncate relative">{eng.name}</div>
                <div className="text-[11px] text-foreground/70 truncate relative">{eng.role}</div>
              </div>
              {idx < engines.length - 1 && (
                <div className="hidden md:flex items-center justify-center px-1 text-primary/60">
                  <ArrowRight size={18} className="drop-shadow-md" />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] text-foreground/70">
          <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/30">
            <Radar size={12} className="text-cyan-400" />
            <span className="font-medium"><span className="text-cyan-300 font-black">Cascade conditionnelle</span> : si signaux faibles, le pipeline s'arrête après l'analyse.</span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30">
            <Clock size={12} className="text-amber-400" />
            <span className="font-medium"><span className="text-amber-300 font-black">Cache 24h</span> : prospect inchangé → réutilise la dernière analyse.</span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30">
            <RefreshCw size={12} className="text-emerald-400" />
            <span className="font-medium"><span className="text-emerald-300 font-black">Fallback heuristique</span> si provider IA limité ou offline.</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================================================
 * STRATEGIC PROSPECTING TAB (Round 32 — master prompt 22 sections)
 * ============================================================ */
function ProspectingTab() {
  const toast = useToast();
  // Round 67 — params URL (autoRun=1) lus localement pour piloter
  // l'auto-exécution sans dépendre du parent AICenterPage.
  const [searchParams, setSearchParams] = useSearchParams();
  const [sector, setSector] = React.useState('SaaS B2B');
  const [region, setRegion] = React.useState('France');
  const [targetCount, setTargetCount] = React.useState(10);
  const [context, setContext] = React.useState('');
  const [lite, setLite] = React.useState(false);
  const [autoAnalyze, setAutoAnalyze] = React.useState(true);
  const [autoThreshold, setAutoThreshold] = React.useState(70);
  // Round 46 — modèle IA (chargé depuis /api/chat/status).
  const [model, setModel] = React.useState('');
  const [models, setModels] = React.useState<Array<{ id: string; label: string; hint?: string }>>([]);
  React.useEffect(() => {
    getApiClient().get<{ model?: string; models?: Array<{ id: string; label: string; hint?: string }> }>(ENDPOINTS.chatStatus)
      .then((s) => {
        if (Array.isArray(s?.models)) setModels(s.models);
        if (s?.model && !model) setModel(s.model);
      })
      .catch(() => undefined); // best-effort
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [isRunning, setIsRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<ProspectingResponse | null>(null);
  const [expandedRank, setExpandedRank] = React.useState<number | null>(null);
  // Round 33 — manual sweep state
  const [sweepRunning, setSweepRunning] = React.useState(false);
  const [aaStatus, setAaStatus] = React.useState<AutoAnalysisStatus | null>(null);
  const [lastSweepSummary, setLastSweepSummary] = React.useState<AutoAnalysisSweepResult | null>(null);

  // Fetch auto-analysis status on mount (best-effort).
  React.useEffect(() => {
    aiService.getAutoAnalysisStatus().then(setAaStatus).catch(() => undefined);
  }, []);
  const handleRun = async () => {
    if (!sector.trim()) {
      setError('Le secteur est obligatoire (ex: SaaS B2B).');
      return;
    }
    setIsRunning(true);
    setError(null);
    setResult(null);
    setExpandedRank(null);
    try {
      const r = await aiService.runProspecting({
        sector: sector.trim(),
        region: region.trim() || 'Global',
        target_count: targetCount,
        context: context.trim() || undefined,
        lite,
        auto_analyze: autoAnalyze,
        auto_analyze_threshold: autoAnalyze ? autoThreshold : undefined,
        model: model.trim() || undefined,
      });
      setResult(r);
      const analyzedCount = r.auto_analyzed?.filter((x) => x.status === 'analyzed').length ?? 0;
      toast.success(
        `Prospecting #${r.companies.length} companies · ${r.persisted_companies} saved · ${analyzedCount} auto-analyzed · ${(r.duration_ms / 1000).toFixed(1)}s`,
      );
      if (analyzedCount > 0) {
        toast.info(`${analyzedCount} deep analyses lancées automatiquement (score ≥ ${r.auto_analyze_threshold ?? autoThreshold}).`);
      }
      // Round 67 — persiste la requête + résultat dans localStorage
      // pour que le dashboard puisse afficher la «Dernière prospection».
      try {
        const last = {
          sector: sector.trim(),
          region: region.trim() || 'Global',
          target_count: targetCount,
          context: context.trim() || undefined,
          auto_analyze: autoAnalyze,
          auto_analyze_threshold: autoAnalyze ? autoThreshold : undefined,
          duration_ms: r.duration_ms ?? 0,
          result_companies: r.companies.length,
          result_persisted: r.persisted_companies,
          result_auto_analyzed: analyzedCount,
          status: 'done' as const,
          created_at: Date.now(),
          triggered_from: searchParams.get('autoRun') === '1' ? 'auto-run-from-dashboard' : 'manual',
        };
        window.localStorage.setItem('zentara.prospection.last_result', JSON.stringify(last));
        // Nettoie le preset après usage.
        window.localStorage.removeItem('zentara.prospection.preset');
        // Détache le flag autoRun=1 de l'URL pour qu'un F5 ne relance pas.
        if (searchParams.get('autoRun') === '1') {
          const next = new URLSearchParams(searchParams);
          next.delete('autoRun');
          setSearchParams(next, { replace: true });
        }
      } catch {
        /* ignore quota */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur introspection.';
      setError(msg);
      toast.error(msg);
      try {
        window.localStorage.setItem(
          'zentara.prospection.last_result',
          JSON.stringify({
            sector: sector.trim(),
            region: region.trim() || 'Global',
            target_count: targetCount,
            context: context.trim() || undefined,
            auto_analyze: autoAnalyze,
            auto_analyze_threshold: autoAnalyze ? autoThreshold : undefined,
            status: 'failed',
            created_at: Date.now(),
          }),
        );
      } catch { /* ignore */ }
    } finally {
      setIsRunning(false);
    }
  };

  // Round 67 — Auto-run si le bouton « Run Global Analysis » du
  // dashboard a été cliqué (`?autoRun=1` dans l'URL + preset localStorage).
  // On hydrate le formulaire depuis le preset AVANT de cliquer « Run »
  // pour que l'utilisateur voie les paramètres qui ont été utilisés.
  const autoRunTriggeredRef = React.useRef(false);
  React.useEffect(() => {
    if (autoRunTriggeredRef.current) return;
    if (searchParams.get('autoRun') !== '1') return;
    autoRunTriggeredRef.current = true;
    try {
      const raw = window.localStorage.getItem('zentara.prospection.preset');
      if (raw) {
        const p = JSON.parse(raw);
        if (typeof p?.sector === 'string' && p.sector.length > 0) setSector(p.sector);
        if (typeof p?.region === 'string') setRegion(p.region || 'France');
        if (Number.isFinite(p?.target_count) && p.target_count > 0) setTargetCount(p.target_count);
        if (typeof p?.context === 'string') setContext(p.context);
        if (typeof p?.auto_analyze === 'boolean') setAutoAnalyze(p.auto_analyze);
        if (Number.isFinite(p?.auto_analyze_threshold)) setAutoThreshold(p.auto_analyze_threshold);
      }
    } catch { /* no preset → fallback aux défauts */ }
    // Laisse React.flushSync poser les setters avant de cliquer.
    window.setTimeout(() => void handleRun(), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Round 33 — sweep manuel : scan toutes les entités scorées >= seuil
   * et déclenche leur analyse 7-engines. Utile pour rejouer après une
   * coupure réseau ou un changement de provider LLM.
   */
  const handleSweep = async () => {
    setSweepRunning(true);
    try {
      const r = await aiService.sweepAutoAnalysis({
        threshold: autoThreshold,
        force: false,
        limit: 50,
        concurrency: 2,
      });
      setLastSweepSummary(r);
      try {
        const status = await aiService.getAutoAnalysisStatus();
        setAaStatus(status);
      } catch { /* best-effort */ }
      if (r.analyzed > 0) {
        toast.success(
          `Auto-analysis sweep · ${r.analyzed} analysed, ${r.fresh_skipped} fresh-skipped, ${r.failed} failed (threshold ${r.threshold}).`,
        );
      } else if (r.candidates === 0) {
        toast.info(`Aucun candidat ≥ ${r.threshold}. Marque quelques prospects/companies d'abord.`);
      } else {
        toast.info(`Sweep terminé : 0 nouvelles analyses (toutes déjà fraîches).`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Sweep failed');
    } finally {
      setSweepRunning(false);
    }
  };

  return (
    <>
      {/* Round 53 — StatsHero : remplit le viewport dès le 1er render
          du tab Prospecting. Les 4 tiles affichent la requête courante
          + le résultat de la dernière sweep (si déjà fait). */}
      <AiCenterHero tiles={buildProspectingHeroTiles(sector, region, targetCount, result)} />
      <Card className="bg-card/50 border-border shadow-2xl overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Sparkles size={20} className="text-primary" /> Strategic Prospecting Engine
          </CardTitle>
          <CardDescription>
            Round 32 — méthodologie 22 sections : 50 entreprises de référence + pattern detection + ICP dérivée + scoring
            déterministe + multi-agent stack. Coût typique : 1 appel LLM (~10 s).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField label="Secteur" required icon={<Briefcase size={14} />}>
            <input
              type="text"
              value={sector}
              onChange={e => setSector(e.target.value)}
              placeholder="SaaS B2B, FinTech, Pharma, Defense..."
              className="w-full bg-secondary/50 border border-border rounded-lg h-10 px-3 focus:ring-2 focus:ring-primary outline-none text-sm"
            />
          </FormField>
          <FormField label="Région / marché" icon={<Globe size={14} />}>
            <input
              type="text"
              value={region}
              onChange={e => setRegion(e.target.value)}
              placeholder="France, EMEA, DACH, Global..."
              className="w-full bg-secondary/50 border border-border rounded-lg h-10 px-3 focus:ring-2 focus:ring-primary outline-none text-sm"
            />
          </FormField>
          <FormField label="Nombre d'entreprises cibles" icon={<Users size={14} />}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={25}
                value={targetCount}
                onChange={e => setTargetCount(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="text-sm font-bold w-8 text-right">{targetCount}</span>
            </div>
          </FormField>
          <FormField label="Mode prompt" icon={<Layers size={14} />}>
            <label className="h-10 px-3 inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-border bg-secondary/50"
                checked={lite}
                onChange={e => setLite(e.target.checked)}
              />
              Lite (modèles open-source / free)
            </label>
          </FormField>
          <FormField label="Modèle IA" icon={<Bot size={14} />}>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              disabled={isRunning}
              className="w-full bg-secondary/50 border border-border rounded-lg h-10 px-3 focus:ring-2 focus:ring-primary outline-none text-sm disabled:opacity-50"
            >
              {model === '' && <option value="">Auto (backend)</option>}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}{m.hint ? ` — ${m.hint}` : ''}
                </option>
              ))}
              {model && !models.some((m) => m.id === model) && (
                <option value={model}>{model} (configuré)</option>
              )}
            </select>
          </FormField>
          <FormField label="Auto-analyse 7-engines" icon={<Bot size={14} />}>
            <div className="space-y-2">
              <label className="h-10 px-3 inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded border-border bg-secondary/50"
                  checked={autoAnalyze}
                  onChange={e => setAutoAnalyze(e.target.checked)}
                />
                Trigger analyses si score ≥ seuil
              </label>
              {autoAnalyze && (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={50}
                    max={95}
                    value={autoThreshold}
                    onChange={e => setAutoThreshold(Number(e.target.value))}
                    className="flex-1 accent-primary"
                    aria-label="Auto-analyze threshold"
                  />
                  <span className="text-sm font-bold w-8 text-right">{autoThreshold}</span>
                </div>
              )}
            </div>
          </FormField>
          <FormField label="Contexte additionnel" fullWidth icon={<Flag size={14} />}>
            <textarea
              value={context}
              onChange={e => setContext(e.target.value)}
              placeholder="Précisions marché, ciblage, ICP custom, événements déclencheurs..."
              className="w-full bg-secondary/50 border border-border rounded-lg min-h-[80px] px-3 py-2 focus:ring-2 focus:ring-primary outline-none text-sm resize-y"
            />
          </FormField>
        </CardContent>
        <div className="px-8 pb-8 flex items-center justify-between gap-4 flex-wrap">
          <p className="text-xs text-muted-foreground flex-1 min-w-[280px]">
            Positionnement Zentara : <em>« couche d'intelligence stratégique continue »</em>, jamais « chatbot IA ».
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-11 px-5 border-border text-foreground hover:bg-secondary/60"
              disabled={sweepRunning || isRunning}
              onClick={handleSweep}
              title={`Sweep manuel : scan DB et lance le pipeline sur les entités scorées ≥ ${autoThreshold}`}
            >
              {sweepRunning ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sweeping…</>
              ) : (
                <><RefreshCw className="mr-2 h-4 w-4" /> Run auto-sweep ({autoThreshold}+)</>
              )}
            </Button>
            <Button
              className="h-11 px-8 bg-primary hover:bg-primary/90 disabled:opacity-50"
              disabled={isRunning || !sector.trim()}
              onClick={handleRun}
            >
              {isRunning ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running prospecting engine…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" /> Run Strategic Prospecting
                </>
              )}
            </Button>
          </div>
        </div>
        {/* Auto-analysis status row */}
        {aaStatus && (
          <div className="px-8 pb-6 flex items-center gap-2 flex-wrap text-xs">
            <Badge className={cn(
              'border',
              aaStatus.running
                ? 'bg-green-500/10 text-green-500 border-green-500/30'
                : 'bg-secondary text-muted-foreground border-border',
            )}>
              <Bot size={10} className="mr-1" /> Auto-analysis cron: {aaStatus.running ? 'ACTIVE' : 'off'}
            </Badge>
            {aaStatus.last_sweep_at && (
              <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/30">
                last sweep {new Date(aaStatus.last_sweep_at).toLocaleString()}
              </Badge>
            )}
            {aaStatus.last_sweep_summary && (
              <span className="text-muted-foreground">
                · {aaStatus.last_sweep_summary.analyzed} analyzed ·{' '}
                {aaStatus.last_sweep_summary.fresh_skipped} fresh ·{' '}
                {aaStatus.last_sweep_summary.failed} failed
              </span>
            )}
          </div>
        )}
        {error && (
          <div className="px-8 pb-6">
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-3">
              <AlertCircle size={20} />
              <p className="text-sm font-medium">{error}</p>
            </div>
          </div>
        )}
      </Card>

      {isRunning && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-pulse">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 bg-card/50 rounded-xl border border-border" />
          ))}
        </div>
      )}

      {!isRunning && result && (
        <ProspectingResult
          result={result}
          expandedRank={expandedRank}
          setExpandedRank={setExpandedRank}
          autoStatus={aaStatus}
          lastSweep={lastSweepSummary}
        />
      )}
    </>
  );
}

/* ----- helpers (ProspectingTab) ----- */
function FormField({ label, children, required, icon, fullWidth }: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div className={cn('space-y-2', fullWidth && 'md:col-span-2')}>
      <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
        {icon}{label}{required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

function PriorityBadge({ tier }: { tier: ProspectingCompany['priority_tier'] }) {
  const style: Record<ProspectingCompany['priority_tier'], string> = {
    ABSOLUTE: 'bg-red-500/15 text-red-500 border-red-500/30',
    VERY_HIGH: 'bg-orange-500/15 text-orange-500 border-orange-500/30',
    HIGH: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
    MEDIUM: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
    LOW: 'bg-secondary text-muted-foreground border-border',
  };
  return <Badge className={cn('border', style[tier])}>{tier}</Badge>;
}

function ProspectingResult({
  result,
  expandedRank,
  setExpandedRank,
  autoStatus,
  lastSweep,
}: {
  result: ProspectingResponse;
  expandedRank: number | null;
  setExpandedRank: (n: number | null) => void;
  autoStatus: AutoAnalysisStatus | null;
  lastSweep: AutoAnalysisSweepResult | null;
}) {
  const sorted = [...result.companies].sort((a, b) => a.rank - b.rank);
  const autoRecords: AutoAnalyzedRecordFE[] = result.auto_analyzed ?? [];
  const autoAnalyzedCount = autoRecords.filter((r) => r.status === 'analyzed').length;
  const autoFailedCount = autoRecords.filter((r) => r.status === 'failed').length;
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <Card className="bg-card/60 border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-xl flex items-center gap-2">
              <BarChart size={20} className="text-primary" /> Panorama prospect — session {result.prospecting_session_id.slice(-8)}
            </CardTitle>
            <div className="flex items-center gap-2 text-xs flex-wrap">
              {result.lite && <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/30">LITE prompt</Badge>}
              <Badge className="bg-primary/10 text-primary border-primary/30">{result.companies.length} companies</Badge>
              <Badge className="bg-green-500/10 text-green-500 border-green-500/30">+{result.persisted_companies} persisted</Badge>
              <Badge className="bg-secondary text-muted-foreground border-border flex items-center gap-1">
                <Clock size={10} /> {(result.duration_ms / 1000).toFixed(1)}s
              </Badge>
            </div>
          </div>
          <CardDescription className="mt-2 italic text-base">« {result.summary} »</CardDescription>
          {/* Round 33 — auto-analysis execution summary */}
          {result.auto_analyze_enabled && (
            <div className="mt-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs flex items-start gap-2">
              <Bot size={14} className="text-blue-500 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="font-semibold text-blue-400">
                  Auto-analyse 7-engines · seuil {result.auto_analyze_threshold ?? 70}
                </div>
                {autoAnalyzedCount > 0 ? (
                  <div className="text-muted-foreground">
                    ✅ {autoAnalyzedCount} cibles (score ≥ {result.auto_analyze_threshold ?? 70}) ont reçu leur analyse approfondie en arrière-plan.
                    Les fiches Companies sont maintenant enrichies d'une Executive Summary + Recommendations + Risks.
                    {autoFailedCount > 0 && (
                      <span className="text-red-400 ml-2">⚠ {autoFailedCount} failed</span>
                    )}
                  </div>
                ) : (
                  <div className="text-muted-foreground">
                    Aucune cible au-dessus du seuil ({result.auto_analyze_threshold ?? 70}) cette fois — l'analyse sera tentée au prochain sweep périodique.
                  </div>
                )}
              </div>
            </div>
          )}
        </CardHeader>
      </Card>

      {/* Round 33 — Auto-Analyzed Records (if any) */}
      {autoAnalyzedCount > 0 && (
        <Card className="bg-blue-500/5 border-blue-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-400 text-base">
              <Bot size={16} /> Auto-analyzed records ({autoAnalyzedCount})
              <span className="text-xs font-normal text-muted-foreground ml-2">— 7-engines pipeline déclenché automatiquement</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {autoRecords.map((r, i) => (
                <li key={i} className="flex items-center gap-2">
                  {r.status === 'analyzed' ? (
                    <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                  ) : r.status === 'failed' ? (
                    <AlertCircle size={14} className="text-red-500 shrink-0" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  )}
                  <span className="font-semibold">{r.entity_name}</span>
                  <Badge className="bg-secondary text-muted-foreground border-border text-[10px]">
                    {r.entity_type}
                  </Badge>
                  <span className="text-xs text-muted-foreground">score {r.score}</span>
                  {r.duration_ms && <span className="text-xs text-muted-foreground">· {(r.duration_ms / 1000).toFixed(1)}s</span>}
                  {r.ai_analysis_id && (
                    <span className="text-[10px] text-muted-foreground/60 ml-auto font-mono">{r.ai_analysis_id.slice(0, 12)}…</span>
                  )}
                  {r.error && (
                    <span className="text-xs text-red-400 truncate max-w-[260px]" title={r.error}>⚠ {r.error.slice(0, 60)}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Round 33 — Auto-Analysis status panel (cron) */}
      {(autoStatus || lastSweep) && (
        <Card className="bg-card/60 border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw size={16} className="text-blue-500" /> Auto-analysis service
              {autoStatus && (
                <Badge className={cn(
                  'border ml-2',
                  autoStatus.running
                    ? 'bg-green-500/10 text-green-500 border-green-500/30'
                    : 'bg-secondary text-muted-foreground border-border',
                )}>
                  cron {autoStatus.running ? 'RUNNING' : 'off'}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {autoStatus?.last_sweep_summary && (
                <>
                  <MetricBox label="Candidats" value={autoStatus.last_sweep_summary.candidates} />
                  <MetricBox label="Analysés" value={autoStatus.last_sweep_summary.analyzed} accent="green" />
                  <MetricBox label="Fresh skipped" value={autoStatus.last_sweep_summary.fresh_skipped} accent="blue" />
                  <MetricBox label="Failed" value={autoStatus.last_sweep_summary.failed} accent="red" />
                  <MetricBox label="Seuil" value={autoStatus.last_sweep_summary.threshold} accent="amber" />
                  <MetricBox label="Dernier sweep" value={autoStatus.last_sweep_at ? new Date(autoStatus.last_sweep_at).toLocaleString() : '—'} />
                </>
              )}
              {lastSweep && (
                <>
                  <MetricBox label="Last sweep · candidates" value={lastSweep.candidates} />
                  <MetricBox label="Last sweep · analyzed" value={lastSweep.analyzed} accent="green" />
                  <MetricBox label="Last sweep · fresh" value={lastSweep.fresh_skipped} accent="blue" />
                  <MetricBox label="Last sweep · failed" value={lastSweep.failed} accent="red" />
                  <MetricBox label="Last sweep · durée" value={`${(lastSweep.durée_ms / 1000).toFixed(1)}s`} accent="amber" />
                  <MetricBox label="Seuil manuel" value={lastSweep.threshold} accent="amber" />
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ICP card */}
      <Card className="bg-card/60 border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Crown size={18} className="text-amber-400" /> Ideal Customer Profile (ICP)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <IcpBlock label="Industries" items={result.icp.industry_verticals} icon={<Briefcase size={14} />} />
          <IcpBlock label="Taille typique" items={[result.icp.company_size_range]} icon={<Users size={14} />} />
          <IcpBlock label="Équipe intelligence visée" items={[result.icp.expected_team_size_intelligence]} icon={<Layers size={14} />} />
          <IcpBlock label="Buyer idéal" items={[result.icp.ideal_buyer_role]} icon={<Crown size={14} />} />
          <IcpBlock label="Buying triggers" items={result.icp.common_buying_triggers} icon={<Flag size={14} />} />
          <IcpBlock label="Intent signals" items={result.icp.common_intent_signals} icon={<Eye size={14} />} />
          <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-4 gap-3 mt-2">
            <IcpTag label="Pression concurrentielle" value={result.icp.competitive_pressure_level} variant={
              result.icp.competitive_pressure_level === 'HIGH' ? 'orange' :
              result.icp.competitive_pressure_level === 'MEDIUM' ? 'amber' : 'blue'
            } />
            <IcpTag label="Cadence monitoring" value={result.icp.monitoring_cadence_required} variant="blue" />
            <IcpTag label="Budget cible" value={result.icp.budget_size} variant="primary" />
            <IcpTag label="Compromis / exclusions" value={`${result.icp.exclusions.length} segments exclus`} variant="muted" />
          </div>
          <div className="md:col-span-3 p-4 rounded-lg bg-secondary/50 text-sm leading-relaxed italic">
            {result.icp.rationale}
          </div>
        </CardContent>
      </Card>

      {/* Top lists */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <TopListCard title="Must contact now" icon={<Zap size={14} />} accent="red" items={result.top_lists.top_10_must_contact_now} />
        <TopListCard title="Urgent need" icon={<ShieldAlert size={14} />} accent="orange" items={result.top_lists.top_10_most_urgent_need} />
        <TopListCard title="Strongest automation" icon={<Sparkles size={14} />} accent="amber" items={result.top_lists.top_10_strongest_automation_potential} />
        <TopListCard title="Best commercial fit" icon={<Crown size={14} />} accent="purple" items={result.top_lists.top_10_best_commercial_fit} />
      </div>

      {/* Companies ranked */}
      <Card className="bg-card/60 border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Database size={18} className="text-primary" /> Companies ranked
            <span className="text-xs font-normal text-muted-foreground ml-2">— cliquez pour déplier l'évidence + agent recommandé</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {sorted.map(c => (
            <CompanyRankRow
              key={c.rank}
              company={c}
              expanded={expandedRank === c.rank}
              onToggle={() => setExpandedRank(expandedRank === c.rank ? null : c.rank)}
            />
          ))}
        </CardContent>
      </Card>

      {/* Next steps + risk notes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-green-500/5 border-green-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-500 text-base">
              <ArrowDown size={18} /> Next steps
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2 list-decimal pl-4 text-sm">
              {result.next_steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
        {result.global_risk_notes.length > 0 && (
          <Card className="bg-amber-500/5 border-amber-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-500 text-base">
                <ShieldAlert size={18} /> Global risk notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {result.global_risk_notes.map((note, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" /> {note}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="text-center text-[10px] text-muted-foreground/60 tracking-widest">
        ai_analysis_id #{result.ai_analysis_id} — provider driven by AI_PROVIDER env
      </div>
    </div>
  );
}

function CompanyRankRow({
  company, expanded, onToggle,
}: { company: ProspectingCompany; expanded: boolean; onToggle: () => void }) {
  return (
    <div className={cn(
      'rounded-xl border transition-all',
      expanded ? 'border-primary/40 bg-primary/5 shadow-md' : 'border-border bg-card/40 hover:bg-card/60',
    )}>
      <button
        type="button"
        className="w-full p-4 text-left flex items-start gap-4"
        onClick={onToggle}
      >
        <div className="flex flex-col items-center w-12 shrink-0">
          <div className="text-2xl font-black text-primary">#{company.rank}</div>
          <Sparkles size={14} className="text-muted-foreground mt-0.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-base">{company.name}</span>
            <PriorityBadge tier={company.priority_tier} />
            {company.rank_evidence_tags.map(t => (
              <span key={t} className="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider bg-secondary text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1"><Briefcase size={10} /> {company.sector}</span>
            <span className="flex items-center gap-1"><Globe size={10} /> {company.hq_city}, {company.hq_country}</span>
            <span className="flex items-center gap-1"><Users size={10} /> {company.company_size}</span>
            {company.website && (
              <a className="flex items-center gap-1 hover:text-primary transition-colors" href={company.website} target="_blank" rel="noreferrer">
                <ExternalLink size={10} /> {prettyHost(company.website)}
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <ScoreDial score={company.zentara_opportunity_score} />
          <div className="text-[10px] text-muted-foreground mt-1">conf {company.confidence_score}%</div>
        </div>
        <div className="text-muted-foreground shrink-0 mt-1">
          {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pl-16 space-y-4 border-t border-border/30 pt-3 animate-in fade-in slide-in-from-top-2 duration-300">
          <p className="text-sm italic text-muted-foreground">{company.primary_intelligence_need}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DetailBlock title="Intelligence problem" icon={<Lightbulb size={14} />} body={company.intelligence_problem} />
            <DetailBlock title="Why now — buying trigger" icon={<Zap size={14} />} body={company.buying_trigger_now} />
            <DetailBlock title="Decision maker" icon={<Crown size={14} />} body={
              <div className="space-y-1">
                <div className="font-semibold">{company.decision_maker.role}</div>
                <div className="text-xs">{company.decision_maker.rationale}</div>
                <div className="text-[10px] text-muted-foreground">🔎 {company.decision_maker.search_hint}</div>
                {company.decision_maker.publicly_visible_evidence && (
                  <div className="text-xs italic">{company.decision_maker.publicly_visible_evidence}</div>
                )}
              </div>
            } />
            <DetailBlock title="Integration difficulty" icon={<Layers size={14} />} body={company.integration_difficulty} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <BlockList title="Needs — public evidence" items={company.needs_evidence} icon={<Eye size={14} />} accent="green" />
            <BlockList title="Weak signals to monitor" items={company.weak_signals_to_monitor} icon={<Eye size={14} />} accent="amber" />
            <BlockList title="What to monitor" items={company.what_to_monitor} icon={<BarChart size={14} />} accent="blue" />
            <BlockList title="Public sources used" items={company.public_sources_used} icon={<ExternalLink size={14} />} accent="muted" />
          </div>

          <BlockList
            title="Multi-agent stack recommandé"
            items={company.multi_agent_stack}
            icon={<Database size={14} />}
            accent="purple"
          />

          <div className="rounded-lg bg-secondary/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-primary" />
              <div className="font-bold">{company.zentara_agent_recommended.name}</div>
              <Badge className="bg-primary/10 text-primary border-primary/30 text-[10px]">{company.zentara_agent_recommended.frequency}</Badge>
            </div>
            <div className="text-xs italic text-muted-foreground">{company.zentara_agent_recommended.mission}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <BlockList title="Functions" items={company.zentara_agent_recommended.functions} icon={<CheckCircle2 size={12} />} accent="muted" />
              <BlockList title="Sources" items={company.zentara_agent_recommended.sources} icon={<Globe size={12} />} accent="muted" />
              <BlockList title="Alerts" items={company.zentara_agent_recommended.alerts} icon={<ShieldAlert size={12} />} accent="red" />
              <BlockList title="Recommended actions" items={company.zentara_agent_recommended.recommended_actions} icon={<Target size={12} />} accent="blue" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <RoiBox label="Time saved" v={company.roi_potential_qualitative.time_saved} />
            <RoiBox label="Manual reduction" v={company.roi_potential_qualitative.manual_work_reduction} />
            <RoiBox label="Decision velocity" v={company.roi_potential_qualitative.decision_velocity_improvement} />
            <RoiBox label="Risk reduction" v={company.roi_potential_qualitative.risk_reduction} />
            <RoiBox label="Opportunity detection" v={company.roi_potential_qualitative.opportunity_detection} />
            <RoiBox label="Commercial impact" v={company.roi_potential_qualitative.commercial_impact} />
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreDial({ score }: { score: number }) {
  const color = score >= 90 ? 'text-red-500' : score >= 80 ? 'text-orange-500' : score >= 70 ? 'text-amber-500' : score >= 60 ? 'text-blue-500' : 'text-muted-foreground';
  return (
    <div className={cn('text-3xl font-black', color)}>{score}</div>
  );
}

function MetricBox({ label, value, accent }: { label: string; value: React.ReactNode; accent?: 'green' | 'red' | 'blue' | 'amber' }) {
  const cls: Record<NonNullable<typeof accent>, string> = {
    green: 'border-green-500/30 text-green-500',
    red: 'border-red-500/30 text-red-500',
    blue: 'border-blue-500/30 text-blue-500',
    amber: 'border-amber-500/30 text-amber-500',
  };
  return (
    <div className={cn(
      'rounded-lg border p-3 bg-secondary/30',
      accent ? cls[accent] : 'border-border text-muted-foreground',
    )}>
      <div className="text-[9px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="font-bold text-base">{value}</div>
    </div>
  );
}

function IcpBlock({ label, items, icon }: { label: string; items: string[]; icon: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
        {icon}{label}
      </div>
      <ul className="space-y-1 text-sm">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="w-1 h-1 rounded-full bg-primary mt-2 shrink-0" /> {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function IcpTag({ label, value, variant }: { label: string; value: string; variant: 'orange' | 'amber' | 'blue' | 'primary' | 'muted' }) {
  const map: Record<typeof variant, string> = {
    orange: 'border-orange-500/30 text-orange-500 bg-orange-500/10',
    amber: 'border-amber-500/30 text-amber-500 bg-amber-500/10',
    blue: 'border-blue-500/30 text-blue-500 bg-blue-500/10',
    primary: 'border-primary/30 text-primary bg-primary/10',
    muted: 'border-border text-muted-foreground bg-secondary/60',
  };
  return (
    <div className={cn('rounded-lg border px-3 py-2', map[variant])}>
      <div className="text-[10px] uppercase tracking-wider opacity-80">{label}</div>
      <div className="font-semibold text-sm">{value}</div>
    </div>
  );
}

function TopListCard({ title, items, icon, accent }: { title: string; items: string[]; icon: React.ReactNode; accent: 'red' | 'orange' | 'amber' | 'purple' }) {
  const map: Record<typeof accent, string> = {
    red: 'text-red-500',
    orange: 'text-orange-500',
    amber: 'text-amber-500',
    purple: 'text-purple-500',
  };
  return (
    <Card className="bg-card/60 border-border">
      <CardHeader>
        <CardTitle className={cn('text-sm font-semibold flex items-center gap-2', map[accent])}>
          {icon}{title}
          <Badge className="ml-auto bg-secondary text-muted-foreground border-border">{items.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">—</p>
        ) : (
          <ol className="space-y-1.5 text-sm">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className={cn('w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold shrink-0', map[accent].replace('text-', 'bg-').replace('-500', '-500/20'))}>{i + 1}</span>
                <span className="truncate">{it}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function DetailBlock({ title, body, icon }: { title: string; body: React.ReactNode; icon: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
        {icon}{title}
      </div>
      <div className="text-sm">{body}</div>
    </div>
  );
}

function BlockList({ title, items, icon, accent }: {
  title: string; items: string[]; icon: React.ReactNode;
  accent: 'green' | 'amber' | 'blue' | 'red' | 'purple' | 'muted';
}) {
  const dot: Record<typeof accent, string> = {
    green: 'bg-green-500',
    amber: 'bg-amber-500',
    blue: 'bg-blue-500',
    red: 'bg-red-500',
    purple: 'bg-purple-500',
    muted: 'bg-muted-foreground',
  };
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1.5">
        {icon}{title}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">—</p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5 shrink-0', dot[accent])} />
              <span className="break-words">{it}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RoiBox({ label, v }: { label: string; v: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' }) {
  const color = v === 'VERY_HIGH' ? 'text-emerald-500' : v === 'HIGH' ? 'text-green-500' : v === 'MEDIUM' ? 'text-amber-500' : 'text-muted-foreground';
  return (
    <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-bold">{label}</div>
      <div className={cn('font-black text-sm', color)}>{v}</div>
    </div>
  );
}

function prettyHost(url: string): string {
  try { return new URL(url).host.replace(/^www\./, ''); } catch { return url.slice(0, 32); }
}

// =====================================================================
// Round 35 — Outreach tab : dashboard CRM-wide de l'outreach sequences
// =====================================================================

function OutreachTab(): React.ReactElement {
  const [inbox, setInbox] = React.useState<Array<{
    id: string; prospect_id: string; tone: string; status: string; subject: string;
    created_at: string; sent_at: string | null; replied_at: string | null;
  }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [filterStatus, setFilterStatus] = React.useState<'all' | 'draft' | 'sent' | 'replied' | 'bounced'>('all');
  const toast = useToast();

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const api = getApiClient();
      const url = filterStatus === 'all' ? ENDPOINTS.outreachInbox : `${ENDPOINTS.outreachInbox}?status=${filterStatus}`;
      const raw = await api.get<{ data: typeof inbox }>(url);
      setInbox(raw.data ?? []);
    } catch (e) {
      toast.error('Chargement inbox impossible');
      setInbox([]);
    }
    setLoading(false);
  }, [filterStatus, toast]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  // KPIs agrégés.
  const kpis = React.useMemo(() => {
    let sent = 0, replied = 0, bounced = 0, draft = 0;
    for (const e of inbox) {
      if (e.status === 'sent' || e.status === 'opened') sent++;
      else if (e.status === 'replied') { replied++; sent++; }
      else if (e.status === 'bounced' || e.status === 'failed') bounced++;
      else if (e.status === 'draft') draft++;
    }
    const responseRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;
    return { total: inbox.length, sent, replied, bounced, draft, responseRate };
  }, [inbox]);

  return (
    <div className="space-y-6">
      <header className="text-center space-y-2">
        <div className="inline-flex p-3 rounded-2xl bg-purple-500/10 text-purple-400 mb-2">
          <Bot size={32} />
        </div>
        <h3 className="text-2xl font-bold tracking-tight">Outreach Centre</h3>
        <p className="text-muted-foreground max-w-2xl mx-auto text-sm">
          Toutes les communications outbound générées par l'IA et leur progression dans les séquences
          (cold → follow-up → breakup). Génère des drafts depuis chaque fiche Company ou Prospect pour
          démarrer.
        </p>
      </header>

      <div className="flex items-center justify-center gap-2 flex-wrap">
        {(['all', 'draft', 'sent', 'replied', 'bounced'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilterStatus(s)}
            className={cn(
              'h-9 px-3 rounded-xl border text-[10px] uppercase font-black tracking-widest transition-all',
              filterStatus === s
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border bg-card/60 text-muted-foreground hover:bg-primary/10',
            )}
          >
            {s}
          </button>
        ))}
        <button
          type="button"
          onClick={refresh}
          className="h-9 px-3 rounded-xl border border-border bg-card/60 text-xs font-bold hover:text-primary text-muted-foreground inline-flex items-center gap-1.5"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* KPI hero — Round 53 : remplit le viewport dès le 1er render.
          Les 5 anciens OutreachKpi tiles deviennent un AiCenterHero visible
          immédiatement (bounce est reporté en micro-badge sur la tile REPLY). */}
      <AiCenterHero tiles={buildOutreachHeroTiles(kpis)} />
      {kpis.bounced > 0 && (
        <div className="flex items-center justify-center">
          <Badge variant="outline" className="border-red-500/40 text-red-400 bg-red-500/10 text-[10px] uppercase tracking-widest">
            <AlertCircle size={10} className="mr-1" />
            {kpis.bounced} bounced
          </Badge>
        </div>
      )}

      {/* Inbox list */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Inbox — AI-generated emails</CardTitle>
          <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
            {kpis.total} entries
          </span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">
              <Loader2 size={16} className="inline animate-spin mr-2" /> Chargement…
            </div>
          ) : inbox.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground space-y-2">
              <p>Aucun email {filterStatus !== 'all' && (<>(status: <em>{filterStatus}</em>)</>)} pour l'instant.</p>
              <p className="text-xs">Ouvre une fiche Company → Email drafts → Generate pour démarrer une séquence.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {inbox.slice(0, 50).map((e) => (
                <li key={e.id} className="py-3 flex items-start gap-3">
                  <span className={cn(
                    'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border shrink-0',
                    e.status === 'replied' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : e.status === 'sent' || e.status === 'opened' ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                    : e.status === 'bounced' ? 'bg-red-500/15 text-red-400 border-red-500/30'
                    : 'bg-slate-500/15 text-slate-400 border-slate-500/30',
                  )}>
                    {e.status}
                  </span>
                  <span className={cn(
                    'inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider border shrink-0',
                    e.tone === 'cold' ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                    : e.tone === 'follow_up' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                    : e.tone === 'breakup' ? 'bg-red-500/10 text-red-400 border-red-500/30'
                    : 'bg-slate-500/10 text-slate-400 border-slate-500/30',
                  )}>
                    {e.tone}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold truncate">📧 {e.subject}</div>
                    <div className="text-[10px] text-muted-foreground/80 font-mono">
                      prospect <code>{e.prospect_id.slice(0, 12)}</code> · {new Date(e.created_at).toLocaleString()}
                      {e.sent_at && <span> · sent {new Date(e.sent_at).toLocaleString()}</span>}
                      {e.replied_at && <span className="text-emerald-500"> · replied {new Date(e.replied_at).toLocaleString()}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OutreachKpi({ label, value, icon, accent }: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  accent: 'primary' | 'cyan' | 'blue' | 'green' | 'amber';
}): React.ReactElement {
  const accentCls: Record<typeof accent, string> = {
    primary: 'text-primary bg-primary/10 border-primary/30',
    cyan: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
    green: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
  };
  return (
    <div className={cn('rounded-xl border p-4', accentCls[accent])}>
      <div className="flex items-center gap-2 mb-2">
        <div className="w-8 h-8 rounded-lg bg-card/40 border border-current/30 flex items-center justify-center">
          {icon}
        </div>
        <span className="text-[10px] uppercase tracking-widest font-bold opacity-80">{label}</span>
      </div>
      <div className="text-2xl font-black tabular-nums">{value}</div>
    </div>
  );
}

// suppress TS-unused import warnings for legacy icons we keep for future use
void TrendingUp; void Star;
