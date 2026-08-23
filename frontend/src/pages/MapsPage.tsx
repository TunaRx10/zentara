import React from 'react';
import {
  MapPin,
  Search as SearchIcon,
  Loader2,
  Phone,
  Globe,
  Mail,
  Star,
  Tag,
  Sparkles,
  Building2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getApiClient } from '@/services/api/client';
import { cn } from '@/lib/utils';

interface MapsLead {
  name: string;
  category?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  website?: string | null;
  email?: string | null;
  rating?: number | null;
  reviews_count?: number | null;
  google_maps_url?: string | null;
  distance_km?: number | null;
  source?: string;
  confidence?: number;
  tags?: string[];
}

interface MapsSearchResult {
  source: string;
  reason: string;
  leads: MapsLead[];
  created_companies: number;
  skipped_duplicates: number;
}

interface MapsSourceStatus {
  places: { configured: boolean };
  serpapi: { configured: boolean };
  outscraper: { configured: boolean };
  osm?: { configured: boolean; free?: boolean; label?: string };
  mock: { configured: boolean };
}

const SOURCES = [
  { value: 'osm', label: 'OpenStreetMap / Overpass (gratuit, sans clé)' },
  { value: 'places', label: 'Google Places (clé requise)' },
  { value: 'serpapi', label: 'SerpAPI (clé requise)' },
  { value: 'outscraper', label: 'Outscraper (clé requise)' },
];

export function MapsPage(): React.ReactElement {
  const [query, setQuery] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [limit, setLimit] = React.useState(20);
  const [radius, setRadius] = React.useState('');
  const [source, setSource] = React.useState('osm');
  const [save, setSave] = React.useState(true);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<MapsSearchResult | null>(null);
  const [status, setStatus] = React.useState<MapsSourceStatus | null>(null);

  React.useEffect(() => {
    getApiClient()
      .get<MapsSourceStatus>('/maps/status')
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  const run = React.useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await getApiClient().post<MapsSearchResult>('/maps/search', {
        query: query.trim(),
        location: location.trim(),
        limit,
        radius: radius ? Number(radius) : undefined,
        source,
        save,
      });
      setResult(data);
    } catch (e) {
      setError((e as Error)?.message ?? 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }, [query, location, limit, radius, source, save]);

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20 pt-4">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-primary/10 text-primary">
            <MapPin size={24} />
          </div>
          <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Google Maps Leads
          </h2>
        </div>
        <p className="text-muted-foreground">
          Transforme une niche + localisation en leads (nom, tél, site, catégorie,
          note, adresse) puis enrichit l'email via le site — sauvegardés en
          Companies / Prospects / Contacts.
        </p>
      </div>

      {/* Formulaire */}
      <Card className="border-border/60 bg-card/60 backdrop-blur">
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Niche / activité
              </label>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="dentistes, agences web, restaurants…"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Localisation
              </label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Paris, Lyon, Bruxelles…"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Quantité
              </label>
              <Input
                type="number"
                min={1}
                max={100}
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 20)))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Rayon (km) — grille de points
              </label>
              <select
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm"
              >
                <option value="">Zone complète (bbox auto)</option>
                <option value="5">5 km</option>
                <option value="10">10 km</option>
                <option value="15">15 km</option>
                <option value="25">25 km</option>
                <option value="50">50 km</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Source
              </label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm"
              >
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm font-medium h-10 cursor-pointer">
              <input
                type="checkbox"
                checked={save}
                onChange={(e) => setSave(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Sauvegarder en base
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={run} disabled={loading || !query.trim()} className="gap-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : <SearchIcon size={16} />}
              {loading ? 'Scraping…' : 'Scraper les leads'}
            </Button>
            {status && (
              <span className="text-xs text-muted-foreground">
                {status.osm?.configured
                  ? '✓ OpenStreetMap actif (gratuit, sans clé)'
                  : status.places.configured
                    ? '✓ Places API configurée'
                    : status.serpapi.configured
                      ? '✓ SerpAPI configurée'
                      : 'Sources externes absentes → fallback mock'}
              </span>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <AlertTriangle size={16} />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Résultats */}
      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="secondary" className="gap-1">
              <Sparkles size={12} />
              source : {result.source}
            </Badge>
            {result.created_companies > 0 && (
              <Badge variant="secondary" className="gap-1">
                <Building2 size={12} />
                +{result.created_companies} companies
              </Badge>
            )}
            {result.skipped_duplicates > 0 && (
              <span className="text-xs text-muted-foreground">
                {result.skipped_duplicates} doublon(s) ignoré(s)
              </span>
            )}
          </div>

          {result.leads.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucun lead trouvé.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {result.leads.map((lead, i) => (
                <LeadCard key={`${lead.name}-${i}`} lead={lead} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LeadCard({ lead }: { lead: MapsLead }): React.ReactElement {
  const conf = lead.confidence ?? 0;
  return (
    <Card className="border-border/60 bg-card/60 hover:border-primary/40 transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold truncate">{lead.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {lead.category ?? 'Business'}
              {lead.city || lead.country ? ` · ${[lead.city, lead.country].filter(Boolean).join(', ')}` : ''}
              {lead.distance_km != null ? ` · ${lead.distance_km} km` : ''}
            </p>
          </div>
          <ConfidenceBadge confidence={conf} />
        </div>

        {lead.address && <p className="text-xs text-muted-foreground">{lead.address}</p>}

        <div className="flex flex-wrap gap-2">
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Phone size={12} /> {lead.phone}
            </a>
          )}
          {lead.website && (
            <a href={lead.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Globe size={12} /> site
            </a>
          )}
          {lead.email && (
            <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <Mail size={12} /> {lead.email}
            </a>
          )}
          {lead.rating != null && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-500">
              <Star size={12} /> {lead.rating}
            </span>
          )}
        </div>

        {lead.tags && lead.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {lead.tags.slice(0, 6).map((t) => (
              <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary/60 text-[10px] text-muted-foreground">
                <Tag size={9} />
                {t}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }): React.ReactElement {
  const color =
    confidence >= 70 ? 'text-green-500 bg-green-500/10 border-green-500/20'
    : confidence >= 50 ? 'text-amber-500 bg-amber-500/10 border-amber-500/20'
    : 'text-red-500 bg-red-500/10 border-red-500/20';
  return (
    <span className={cn('shrink-0 px-2 py-0.5 rounded-lg border text-xs font-black', color)}>
      {confidence}%
    </span>
  );
}
