/**
 * SearchPage — recherche réelle (base locale + annuaires publics).
 *
 * Round 134 — remplace l'ancienne page statique (recentSearches/trendingTopics
 * factices) par une vraie recherche :
 *   - GET /api/search                → base locale (prospects/companies/contacts/campaigns)
 *   - GET /api/search/external       → annuaires publics (SEC EDGAR + OpenCorporates)
 *   - POST /api/search/external/import → import en masse de la sélection en companies
 */
import React from 'react';
import {
  Search as SearchIcon,
  Loader2,
  Building2,
  Users,
  Target,
  FileText,
  ExternalLink,
  Check,
  AlertTriangle,
  Database,
  Globe,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import { useToast } from '@/contexts/ToastProvider';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

// =====================================================================
// Types
// =====================================================================

interface LocalHit {
  entity: 'prospect' | 'company' | 'contact' | 'campaign';
  id: string;
  title: string;
  subtitle: string | null;
  score: number | null;
  status: string | null;
  data: Record<string, unknown>;
}

interface DirectoryCompany {
  source: 'sec-edgar' | 'opencorporates';
  name: string;
  ticker: string | null;
  cik: string | null;
  company_number: string | null;
  jurisdiction: string | null;
  incorporation_date: string | null;
  url: string | null;
  matched_on: string;
}

interface ExternalResult {
  results: DirectoryCompany[];
  errors: Array<{ source: string; message: string }>;
}

type SourceId = 'sec-edgar' | 'opencorporates';

const SOURCE_META: Record<SourceId, { label: string; short: string }> = {
  'sec-edgar': { label: 'SEC EDGAR', short: 'EDGAR' },
  opencorporates: { label: 'OpenCorporates', short: 'OC' },
};

const ENTITY_META: Record<LocalHit['entity'], { label: string; icon: React.ComponentType<{ size?: number; className?: string }> }> = {
  prospect: { label: 'Prospect', icon: Users },
  company: { label: 'Company', icon: Building2 },
  contact: { label: 'Contact', icon: Users },
  campaign: { label: 'Campaign', icon: Target },
};

const ENTITY_ROUTE: Record<LocalHit['entity'], string> = {
  prospect: 'prospects',
  company: 'companies',
  contact: 'contacts',
  campaign: 'campaigns',
};

function dirKey(c: DirectoryCompany): string {
  return `${c.source}:${c.cik ?? c.company_number ?? c.name}`;
}

function jurisdictionToCountry(code: string | null): string | null {
  if (!code) return null;
  const c = code.trim().toLowerCase();
  if (c === 'us' || c === 'us_de' || c === 'us_ny') return 'US';
  return c.toUpperCase();
}

// =====================================================================
// Page
// =====================================================================

export function SearchPage(): React.ReactElement {
  const api = getApiClient();
  const toast = useToast();
  const navigate = useNavigate();

  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [localHits, setLocalHits] = React.useState<LocalHit[]>([]);
  const [external, setExternal] = React.useState<ExternalResult | null>(null);
  const [searched, setSearched] = React.useState(false);
  const [sources, setSources] = React.useState<Record<SourceId, boolean>>({
    'sec-edgar': true,
    opencorporates: true,
  });
  const [selected, setSelected] = React.useState<Record<string, DirectoryCompany>>({});
  const [importing, setImporting] = React.useState(false);

  const activeSources = React.useMemo(
    () => (Object.keys(sources) as SourceId[]).filter((s) => sources[s]),
    [sources],
  );

  const runSearch = React.useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    setExternal(null);
    setLocalHits([]);
    setSelected({});
    try {
      const sourcesCsv = activeSources.join(',');
      const [localRes, extRes] = await Promise.all([
        api.get<LocalHit[]>(ENDPOINTS.search, {
          query: { q, entity: 'all', limit: 30 },
        }),
        api.get<ExternalResult>(ENDPOINTS.searchExternal, {
          query: { q, sources: sourcesCsv, limit: 20 },
        }),
      ]);
      setLocalHits(localRes ?? []);
      setExternal(extRes ?? { results: [], errors: [] });
    } catch (e) {
      toast.error(`Recherche impossible : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [api, query, activeSources, toast]);

  const toggleSelect = (c: DirectoryCompany) => {
    const key = dirKey(c);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = c;
      return next;
    });
  };

  const selectedItems = React.useMemo(() => Object.values(selected), [selected]);
  const allExternal = external?.results ?? [];
  const allSelected = allExternal.length > 0 && selectedItems.length === allExternal.length;

  const toggleAll = () => {
    if (allSelected) {
      setSelected({});
    } else {
      const map: Record<string, DirectoryCompany> = {};
      for (const c of allExternal) map[dirKey(c)] = c;
      setSelected(map);
    }
  };

  const handleBulkImport = async () => {
    if (selectedItems.length === 0) return;
    setImporting(true);
    try {
      const res = await api.post<{ created: number; skipped: number; ids: string[] }>(
        ENDPOINTS.searchExternalImport,
        { items: selectedItems },
      );
      setSelected({});
      toast.success(
        `Importé : ${res.created} entreprise(s) créée(s)${res.skipped > 0 ? `, ${res.skipped} doublon(s) ignoré(s)` : ''}.`,
      );
    } catch (e) {
      toast.error(`Import impossible : ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  const localByEntity = React.useMemo(() => {
    const map = new Map<string, LocalHit[]>();
    for (const h of localHits) {
      const arr = map.get(h.entity) ?? [];
      arr.push(h);
      map.set(h.entity, arr);
    }
    return map;
  }, [localHits]);

  const externalEdgar = external?.results.filter((r) => r.source === 'sec-edgar') ?? [];
  const externalOC = external?.results.filter((r) => r.source === 'opencorporates') ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 pt-6">
      {/* Header */}
      <div className="text-center space-y-3">
        <h2 className="text-4xl font-black tracking-tight">
          Global Intelligence Search
        </h2>
        <p className="text-muted-foreground">
          Recherche dans ta base locale + les annuaires publics d'entreprises (SEC EDGAR, OpenCorporates).
        </p>
      </div>

      {/* Search box */}
      <div className="relative">
        <div className="relative flex items-center gap-2 p-2 rounded-2xl bg-card border border-border shadow-2xl">
          <SearchIcon className="ml-4 text-muted-foreground shrink-0" size={22} />
          <Input
            placeholder="Nom d'entreprise, ticker, secteur…"
            className="border-none bg-transparent text-lg h-12 focus-visible:ring-0 placeholder:text-muted-foreground/50"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && query.trim()) void runSearch();
            }}
          />
          <Button
            size="lg"
            className="h-11 px-6 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => void runSearch()}
            disabled={loading || !query.trim()}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <SearchIcon size={18} />}
            <span className="ml-2">Search</span>
          </Button>
        </div>

        {/* Source toggles */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {(Object.keys(SOURCE_META) as SourceId[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSources((prev) => ({ ...prev, [s]: !prev[s] }))}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors',
                sources[s]
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', sources[s] ? 'bg-primary' : 'bg-muted-foreground/40')} />
              {SOURCE_META[s].label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="text-center py-10 text-muted-foreground">
          <Loader2 className="inline animate-spin mr-2" size={16} />
          Recherche en cours…
        </div>
      )}

      {!loading && searched && (
        <div className="space-y-8">
          {/* ===== Local DB ===== */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Database size={16} className="text-primary" />
              <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
                Base locale
              </h3>
              <span className="text-xs text-muted-foreground">{localHits.length} résultat(s)</span>
            </div>
            {localHits.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun résultat en base pour « {query} ».</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {localHits.map((h) => {
                  const meta = ENTITY_META[h.entity];
                  const Icon = meta.icon;
                  return (
                    <Card
                      key={`${h.entity}:${h.id}`}
                      className="bg-card/50 border-border hover:border-primary/40 cursor-pointer transition-colors"
                      onClick={() => navigate(`/${ENTITY_ROUTE[h.entity]}/${h.id}`)}
                    >
                      <CardContent className="p-3.5">
                        <div className="flex items-center gap-3">
                          <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            <Icon size={16} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-bold truncate flex items-center gap-2">
                              {h.title}
                              <Badge variant="outline" className="text-[9px] h-4 px-1 border-primary/30 text-primary">
                                {meta.label}
                              </Badge>
                            </div>
                            {h.subtitle && (
                              <div className="text-[11px] text-muted-foreground truncate">{h.subtitle}</div>
                            )}
                          </div>
                          {typeof h.score === 'number' && (
                            <span className="text-xs font-black tabular-nums text-muted-foreground">
                              {h.score}
                            </span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {/* ===== External ===== */}
          <section>
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Globe size={16} className="text-primary" />
              <h3 className="text-sm font-black uppercase tracking-widest text-muted-foreground">
                Annuaires publics
              </h3>
              <span className="text-xs text-muted-foreground">
                {(external?.results.length ?? 0)} résultat(s)
              </span>
              <div className="ml-auto flex items-center gap-2">
                {allExternal.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="text-[11px] font-bold text-muted-foreground hover:text-foreground uppercase tracking-wider"
                  >
                    {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </button>
                )}
                {selectedItems.length > 0 && (
                  <Button
                    size="sm"
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                    disabled={importing}
                    onClick={() => void handleBulkImport()}
                  >
                    {importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    <span className="ml-1.5">Importer ({selectedItems.length})</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Errors (sources indisponibles) */}
            {(external?.errors.length ?? 0) > 0 && (
              <div className="mb-3 space-y-1">
                {external?.errors.map((e) => (
                  <div
                    key={e.source}
                    className="flex items-center gap-2 text-[12px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-1.5"
                  >
                    <AlertTriangle size={12} />
                    <span className="font-bold">{SOURCE_META[e.source as SourceId]?.label ?? e.source}</span>
                    <span className="text-amber-300/80">{e.message}</span>
                  </div>
                ))}
              </div>
            )}

            {external && external.results.length === 0 && (external.errors.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">Aucun résultat externe pour « {query} ».</p>
            )}

            {externalEdgar.length > 0 && (
              <ExternalSourceBlock
                title="SEC EDGAR"
                items={externalEdgar}
                selected={selected}
                onToggle={toggleSelect}
              />
            )}
            {externalOC.length > 0 && (
              <ExternalSourceBlock
                title="OpenCorporates"
                items={externalOC}
                selected={selected}
                onToggle={toggleSelect}
              />
            )}
          </section>
        </div>
      )}

      {!searched && !loading && (
        <div className="text-center py-16 text-muted-foreground space-y-2">
          <SearchIcon size={28} className="mx-auto opacity-40" />
          <p className="text-sm">Tape un nom d'entreprise (ex: « Apple », « Stripe », « SaaS ») et lance la recherche.</p>
          <p className="text-xs opacity-70">
            SEC EDGAR couvre les émetteurs US · OpenCorporates le registre mondial (clé requise).
          </p>
        </div>
      )}
    </div>
  );
}

function ExternalSourceBlock({
  title,
  items,
  selected,
  onToggle,
}: {
  title: string;
  items: DirectoryCompany[];
  selected: Record<string, DirectoryCompany>;
  onToggle: (c: DirectoryCompany) => void;
}): React.ReactElement {
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <FileText size={13} className="text-muted-foreground" />
        <span className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">{title}</span>
      </div>
      <div className="space-y-2">
        {items.map((c) => {
          const key = dirKey(c);
          const isSelected = !!selected[key];
          return (
            <div
              key={key}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 transition-colors cursor-pointer',
                isSelected
                  ? 'border-primary/60 bg-primary/10'
                  : 'border-border/60 bg-card/50 hover:border-primary/40',
              )}
              onClick={() => onToggle(c)}
            >
              <span
                className={cn(
                  'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                  isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40',
                )}
              >
                {isSelected && <Check size={12} />}
              </span>
              <div className="w-9 h-9 rounded-lg bg-secondary/60 text-muted-foreground flex items-center justify-center shrink-0">
                <Building2 size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold truncate flex items-center gap-2 flex-wrap">
                  {c.name}
                  {c.ticker && (
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                      {c.ticker}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[c.jurisdiction ? `jur. ${c.jurisdiction.toUpperCase()}` : null, c.incorporation_date]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                </div>
              </div>
              {c.url && (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Ouvrir la fiche source"
                  onClick={(e) => e.stopPropagation()}
                  className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center"
                >
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
