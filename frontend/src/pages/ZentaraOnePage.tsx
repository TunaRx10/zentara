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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmailComposerModal } from '@/components/EmailComposerModal';
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

  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<EngineResult | null>(null);
  const [status, setStatus] = React.useState<EngineStatus | null>(null);

  React.useEffect(() => {
    getApiClient()
      .get<EngineStatus>(ENDPOINTS.engineStatus)
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const run = React.useCallback(async () => {
    if (!query.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const data = await api.post<EngineResult>(ENDPOINTS.engineSearch, {
        mode,
        query: query.trim(),
        needs: needs.trim() || undefined,
        roles: needs.trim() || undefined,
        location: location.trim() || undefined,
        radius: radius ? Number(radius) : undefined,
        limit,
        save: true,
      }, { timeoutMs: 120_000 });
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
