/**
 * ZentaraOnePage — moteur de prospection unifié « Zentara One ».
 *
 * Fusionne en une seule page :
 *   - Zentara Companies : annuaires publics (keelead 42 + SEC EDGAR + OpenCorporates)
 *   - Zentara People     : LinkedIn live (StaffSpy) — décideurs par niche / besoins
 *   - Zentara Local      : OpenStreetMap / Overpass (+ Google Places / SerpAPI / Outscraper si clé)
 *
 * Mode tabs (Tous / Companies / People / Local) + champs niche / besoins / géo / quantité,
 * puis résultats unifiés avec score + bouton « Générer l'email ».
 */
import React from 'react';
import {
  Search as SearchIcon,
  Loader2,
  Building2,
  Users,
  MapPin,
  Rocket,
  Mail,
  MailPlus,
  Phone,
  Globe,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Layers,
  Tag,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  TrendingUp,
  DollarSign,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmailComposerModal } from '@/components/EmailComposerModal';
import { EngineLauncher } from '@/components/EngineLauncher';
import { getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import { useToast } from '@/contexts/ToastProvider';
import { cn } from '@/lib/utils';

// =====================================================================
// Types
// =====================================================================

type Mode = 'all' | 'companies' | 'people' | 'local';

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
  linkedin: string | null;
  source: string;
  sourceGroup: string;
  confidence: number;
  score: number;
  tags: string[];
  company_id?: string | null;
  company_created?: boolean;
}

interface EngineResult {
  engine: string;
  mode: Mode;
  results: EngineHit[];
  total: number;
  sources: string[];
  errors: Array<{ source?: string; group?: string; message: string }>;
  companies_created: number;
  prospects_created: number;
  contacts_created: number;
}

interface EngineStatus {
  engine: string;
  groups: Array<{ id: string; label: string; available: boolean }>;
  modes: Mode[];
  backend?: { configured: boolean; reachable: boolean; url: string | null };
}

interface EngineStatusFull extends EngineStatus {
  _backendChecked: boolean;
  _linkedinReason: string;
}

const MODES: Array<{ id: Mode; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
  { id: 'all', label: 'Tous', icon: Layers },
  { id: 'companies', label: 'Companies', icon: Building2 },
  { id: 'people', label: 'People', icon: Users },
  { id: 'local', label: 'Local', icon: MapPin },
];

const GROUP_LABEL: Record<string, string> = {
  'zentara-companies': 'Companies',
  'zentara-local': 'Local',
  'zentara-people': 'People',
};

// =====================================================================
// Page
// =====================================================================

export function ZentaraOnePage(): React.ReactElement {
  const api = getApiClient();
  const toast = useToast();

  const [mode, setMode] = React.useState<Mode>('all');
  const [query, setQuery] = React.useState('');
  const [needs, setNeeds] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [limit, setLimit] = React.useState(20);
  const [radius, setRadius] = React.useState('');

  // Advanced search criteria
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const [companySize, setCompanySize] = React.useState('');
  const [revenueRange, setRevenueRange] = React.useState('');
  const [fundingStage, setFundingStage] = React.useState('');
  const [techStack, setTechStack] = React.useState('');
  const [growthSignal, setGrowthSignal] = React.useState('');
  const [minScore, setMinScore] = React.useState(0);

  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<EngineResult | null>(null);
  const [status, setStatus] = React.useState<EngineStatusFull | null>(null);

  React.useEffect(() => {
    getApiClient()
      .get<EngineStatus>(ENDPOINTS.engineStatus)
      .then((s) => {
        const backend = (s as any).backend ?? { configured: false, reachable: false, url: null };
        const liGroup = s.groups.find((g) => g.id === 'zentara-people');
        let linkedinReason = '';
        if (!backend.configured) {
          linkedinReason = 'Aucun backend configuré — allez dans Réglages → Backend pour connecter votre serveur Zentara';
        } else if (!backend.reachable) {
          linkedinReason = `Backend injoignable à ${backend.url} — vérifiez que le serveur tourne`;
        } else if (liGroup && !liGroup.available) {
          linkedinReason = 'Session LinkedIn non configurée sur le backend';
        } else {
          linkedinReason = 'Connecté ✓';
        }
        setStatus({ ...s, _backendChecked: true, _linkedinReason: linkedinReason });
      })
      .catch(() => undefined);
  }, []);

  const run = React.useCallback(async () => {
    if (!query.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const payload: any = {
        mode,
        query: query.trim(),
        needs: needs.trim() || undefined,
        roles: needs.trim() || undefined,
        location: location.trim() || undefined,
        radius: radius ? Number(radius) : undefined,
        limit,
        save: true,
      };
      // Advanced criteria
      if (companySize) payload.company_size = companySize;
      if (revenueRange) payload.revenue_range = revenueRange;
      if (fundingStage) payload.funding_stage = fundingStage;
      if (techStack) payload.tech_stack = techStack;
      if (growthSignal) payload.growth_signal = growthSignal;
      if (minScore > 0) payload.min_score = minScore;

      const data = await api.post<EngineResult>(ENDPOINTS.engineSearch, payload, { timeoutMs: 120_000 });
      setResult(data);
    } catch (e) {
      toast.error(`Recherche impossible : ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [api, mode, query, needs, location, radius, limit, toast]);

  const groupAvailable = (id: string) => {
    if (!status) return true;
    const g = status.groups.find((x) => x.id === id);
    return g ? g.available : true;
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-20 pt-4">
      {/* Source status indicators */}
      {status && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {status.groups.map((g) => (
            <div key={g.id} className="flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full', g.available ? 'bg-emerald-500' : 'bg-red-500/60')} />
              <span className="text-muted-foreground">{g.label}</span>
              {!g.available && g.id === 'zentara-people' && (
                <a href="/settings" className="text-primary hover:underline font-bold ml-1">
                  Connecter →
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* LinkedIn off-line banner */}
      {status && !status.groups.find((g) => g.id === 'zentara-people')?.available && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-1">
          <p className="text-sm font-bold text-amber-400 flex items-center gap-2">
            <AlertTriangle size={14} /> LinkedIn People hors-ligne
          </p>
          <p className="text-xs text-muted-foreground">{status._linkedinReason}</p>
          <p className="text-xs text-muted-foreground">
            Pour activer LinkedIn : lancez <code className="bg-secondary/40 px-1 rounded text-[11px]">node server.js</code> dans <code className="bg-secondary/40 px-1 rounded text-[11px]">zentara/backend</code>, puis configurez l'URL dans{' '}
            <a href="/settings" className="text-primary hover:underline font-bold">Réglages → Backend</a>.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-primary to-violet-600 text-white">
            <Rocket size={24} />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Zentara One
            </h2>
            <p className="text-muted-foreground text-sm">
              Companies + People + Local fusionnés en un seul moteur de prospection.
            </p>
          </div>
        </div>
      </div>

      {/* Moteur — section de lancement (toutes sources, session persistée) */}
      <EngineLauncher />

      {/* Form */}
      <Card className="border-border/60 bg-card/60">
        <CardContent className="p-5 space-y-4">
          {/* Mode tabs */}
          <div className="flex flex-wrap gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-bold transition-colors',
                    active
                      ? 'border-primary/60 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon size={13} />
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Niche / entreprise / activité
              </label>
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SaaS B2B, Lucca, dentistes à Paris…" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Besoins ciblés / rôles
              </label>
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
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Rayon (km, Local)</label>
              <select value={radius} onChange={(e) => setRadius(e.target.value)} className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm">
                <option value="">Zone complète</option>
                <option value="5">5 km</option>
                <option value="10">10 km</option>
                <option value="25">25 km</option>
                <option value="50">50 km</option>
              </select>
            </div>
          </div>

          {/* Advanced toggle */}
          <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground hover:text-primary transition-colors">
            <SlidersHorizontal size={12} />
            Critères avancés
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-xl border border-border/40 bg-background/40">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                  <Building2 size={10} /> Taille entreprise
                </label>
                <select value={companySize} onChange={(e) => setCompanySize(e.target.value)} className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-xs">
                  <option value="">Toutes tailles</option>
                  <option value="1-10">1-10 employés (micro)</option>
                  <option value="11-50">11-50 (PME)</option>
                  <option value="51-200">51-200 (mid-market)</option>
                  <option value="201-1000">201-1000 (scale-up)</option>
                  <option value="1001+">1001+ (enterprise)</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                  <DollarSign size={10} /> Revenu estimé
                </label>
                <select value={revenueRange} onChange={(e) => setRevenueRange(e.target.value)} className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-xs">
                  <option value="">Tous revenus</option>
                  <option value="0-1M">&lt; 1 M€</option>
                  <option value="1M-10M">1-10 M€</option>
                  <option value="10M-50M">10-50 M€</option>
                  <option value="50M-250M">50-250 M€</option>
                  <option value="250M+">250 M€+</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                  <TrendingUp size={10} /> Stade financement
                </label>
                <select value={fundingStage} onChange={(e) => setFundingStage(e.target.value)} className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-xs">
                  <option value="">Tous stades</option>
                  <option value="bootstrapped">Bootstrapped</option>
                  <option value="seed">Seed / Pre-seed</option>
                  <option value="series-a">Series A</option>
                  <option value="series-b">Series B</option>
                  <option value="series-c">Series C+</option>
                  <option value="public">Public / IPO</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                  <Globe size={10} /> Stack technique
                </label>
                <Input value={techStack} onChange={(e) => setTechStack(e.target.value)} placeholder="React, AWS, Shopify…" className="h-9 text-xs" />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                  <Rocket size={10} /> Signal de croissance
                </label>
                <select value={growthSignal} onChange={(e) => setGrowthSignal(e.target.value)} className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-xs">
                  <option value="">Tous signaux</option>
                  <option value="hiring">Recrute activement</option>
                  <option value="funding_raised">A levé des fonds récemment</option>
                  <option value="new_product">Nouveau produit / feature</option>
                  <option value="expanding">Expansion géographique</option>
                  <option value="rebranding">Refonte / rebranding</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 size={10} /> Score minimum
                </label>
                <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-xs">
                  <option value="0">Tous scores</option>
                  <option value="40">≥ 40 (basique)</option>
                  <option value="60">≥ 60 (potentiel)</option>
                  <option value="75">≥ 75 (qualifié)</option>
                  <option value="85">≥ 85 (prioritaire)</option>
                </select>
              </div>
            </div>
          )}

          <Button onClick={() => void run()} disabled={running || !query.trim()} className="gap-2">
            {running ? <Loader2 size={16} className="animate-spin" /> : <SearchIcon size={16} />}
            {running ? 'Fusion des moteurs…' : 'Lancer Zentara One'}
          </Button>
        </CardContent>
      </Card>

      {/* Result summary */}
      {result && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatTile icon={<Building2 size={14} />} label="Companies" value={result.companies_created} />
          <StatTile icon={<Users size={14} />} label="Prospects" value={result.prospects_created} />
          <StatTile icon={<Mail size={14} />} label="Contacts" value={result.contacts_created} />
          <StatTile icon={<Layers size={14} />} label="Résultats" value={result.total} />
          <StatTile icon={<Globe size={14} />} label="Sources" value={result.sources.length} />
        </div>
      )}

      {/* Errors */}
      {result && result.errors.length > 0 && (
        <div className="space-y-1.5">
          {result.errors.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-[12px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-1.5">
              <AlertTriangle size={12} />
              <span className="font-bold">{e.group ?? e.source ?? 'source'}</span>
              <span className="text-amber-300/80">{e.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {result && result.results.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun résultat pour « {query} ».</p>
      )}

      {result && result.results.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {result.results.map((hit, i) => (
            <HitCard key={`${hit.id}-${i}`} hit={hit} />
          ))}
        </div>
      )}

      {!result && !running && (
        <div className="text-center py-16 text-muted-foreground space-y-2">
          <Rocket size={28} className="mx-auto opacity-40" />
          <p className="text-sm">Choisis une niche + besoins, puis lance la fusion des moteurs.</p>
          <p className="text-xs opacity-70">
            People (LinkedIn) nécessite une session configurée · Local utilise OpenStreetMap · Companies les annuaires publics.
          </p>
        </div>
      )}
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }): React.ReactElement {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-3 flex items-center gap-3">
      <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{icon}</div>
      <div>
        <div className="text-lg font-black tabular-nums">{value}</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{label}</div>
      </div>
    </div>
  );
}

function HitCard({ hit }: { hit: EngineHit }): React.ReactElement {
  const [emailOpen, setEmailOpen] = React.useState(false);
  const isPerson = hit.type === 'person';
  const conf = Math.round(hit.score ?? 0);
  const confidencePct = Math.round((hit.confidence ?? 0) * 100);
  const sourceLabel = GROUP_LABEL[hit.sourceGroup] ?? hit.sourceGroup ?? hit.source;

  return (
    <Card className="border-border/60 bg-card/60 hover:border-primary/40 transition-colors h-full">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-bold truncate flex items-center gap-2 text-base">
              {hit.name}
              <Badge variant="outline" className={cn('text-[9px] h-4 px-1 border-primary/30 text-primary shrink-0')}>
                {sourceLabel}
              </Badge>
            </p>
            {isPerson ? (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{hit.title ?? '—'}</p>
            ) : (
              <p className="text-xs truncate flex items-center gap-1.5 mt-1">
                <Tag size={11} className="text-primary shrink-0" />
                <span className="font-medium text-primary/90">{hit.category || 'Secteur non identifié'}</span>
                {hit.country && <span className="text-muted-foreground">· {hit.country}</span>}
              </p>
            )}
          </div>
          <div className="flex flex-col items-end gap-0.5 shrink-0">
            <span className="text-[8px] uppercase tracking-widest text-muted-foreground/60 font-bold">Pertinence IA</span>
            <div className={cn(
              'px-2 py-0.5 rounded-lg border text-xs font-black tabular-nums',
              conf >= 70 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : conf >= 40 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                  : 'text-muted-foreground bg-secondary/40 border-border',
            )}>
              {conf}%
            </div>
            {hit.confidence != null && hit.confidence < 1 && (
              <span
                className="text-[8px] uppercase tracking-widest text-muted-foreground mt-0.5"
                title="Niveau de confiance de la donnée (téléchargement / scraping réussi ou partiel)"
              >
                conf. {confidencePct}%
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          {hit.city && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/40 border border-border/50 text-muted-foreground"><MapPin size={11} /> {hit.city}{hit.country && `, ${hit.country}`}</span>}
          {hit.email && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 truncate max-w-[220px]" title={hit.email}><Mail size={11} /> {hit.email}</span>}
          {hit.phone && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/20 text-primary"><Phone size={11} /> {hit.phone}</span>}
          {hit.website && (
            <a href={hit.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/40 border border-border/50 text-primary hover:border-primary/40 max-w-[180px] truncate" title={hit.website}>
              <Globe size={11} /> {hit.website.replace(/^https?:\/\//, '')}
            </a>
          )}
          {hit.linkedin && (
            <a href={hit.linkedin} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-sky-500/10 border border-sky-500/20 text-sky-400 hover:border-sky-400/40">
              <ExternalLink size={11} /> LinkedIn
            </a>
          )}
        </div>

        {hit.tags && hit.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {hit.tags.slice(0, 6).map((t, idx) => (
              <span
                key={`${t}-${idx}`}
                className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border/40 bg-secondary/20 text-muted-foreground"
              >
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEmailOpen(true)}
            className="flex-1 border-primary/40 text-primary hover:bg-primary/10 gap-2"
          >
            <MailPlus size={13} /> Générer l'email
          </Button>
          {hit.website && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => window.open(hit.website!, '_blank', 'noopener')}
              title="Ouvrir le site"
              className="text-muted-foreground hover:text-foreground"
            >
              <Globe size={13} />
            </Button>
          )}
        </div>
      </CardContent>
      {emailOpen && (
        <EmailComposerModal
          entityName={hit.name}
          entityCategory={hit.category}
          initialEmail={hit.email}
          searchQuery={isPerson ? `${hit.name} ${hit.category ?? ''}`.trim() : hit.name}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </Card>
  );
}
