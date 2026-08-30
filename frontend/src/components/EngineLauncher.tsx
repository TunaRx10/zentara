/**
 * EngineLauncher — Section « Lancer le moteur ».
 *
 * Lance le moteur Zentara réel (POST /engine/search) : 39+ sources
 * (annuaires, SEC EDGAR, OpenStreetMap, LinkedIn…), résultats réels
 * persistés en session locale (localStorage) pour garder l'historique.
 * Aucune donnée inventée : si le moteur ne remonte rien, on l'affiche.
 */
import React from 'react';
import { Rocket, Loader2, MapPin, Globe, AlertTriangle, Layers, Database } from 'lucide-react';
import { getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import { useToast } from '@/contexts/ToastProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const SESSION_KEY = 'zentara.engine.session_id';

function getSessionId(): string {
  try {
    const stored = localStorage.getItem(SESSION_KEY);
    if (stored) return stored;
    const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return `sess_${Date.now()}`;
  }
}

interface EngineHit {
  id?: string;
  name?: string;
  source?: string;
  sourceGroup?: string;
  website?: string | null;
  city?: string | null;
  country?: string | null;
  score?: number;
  category?: string | null;
  email?: string | null;
  phone?: string | null;
}

interface EngineResponse {
  results?: EngineHit[];
  total?: number;
  sources?: string[];
  errors?: Array<{ source?: string; message?: string }>;
}

export function EngineLauncher(): React.ReactElement {
  const toast = useToast();
  const [niche, setNiche] = React.useState('SaaS B2B');
  const [location, setLocation] = React.useState('France');
  const [quantity, setQuantity] = React.useState(10);
  const [context, setContext] = React.useState('');
  const [sessionId] = React.useState<string>(getSessionId);
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState<EngineResponse | null>(null);
  const [ran, setRan] = React.useState(false);

  const launch = async () => {
    if (!niche.trim() || loading) return;
    setLoading(true);
    try {
      const api = getApiClient();
      const payload = await api.post<EngineResponse>(ENDPOINTS.engineSearch, {
        mode: 'all',
        query: niche.trim(),
        location: location.trim() || undefined,
        limit: Math.max(1, Math.min(Number(quantity) || 10, 50)),
        needs: context.trim() || undefined,
        save: true,
        session_id: sessionId,
      }, { timeoutMs: 60_000, retries: 0 });
      setResult(payload || null);
      setRan(true);
      const total = payload?.total ?? payload?.results?.length ?? 0;
      if (total > 0) toast.success(`Moteur · ${total} résultat${total > 1 ? 's' : ''} réel${total > 1 ? 's' : ''}`, 4000);
      else toast.info('Moteur · aucune donnée remontée (sources publiques silencieuses) — réessaie.', 5000);
    } catch (e) {
      setRan(true);
      toast.error(`Échec moteur : ${(e as Error).message}`, 5000);
    } finally {
      setLoading(false);
    }
  };

  const results = result?.results ?? [];
  const sources = result?.sources ?? [];
  const errors = result?.errors ?? [];

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-card via-card to-primary/5">
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/15 text-primary">
              <Rocket size={18} />
            </div>
            <div>
              <h3 className="font-black tracking-tight">Lancer le moteur</h3>
              <p className="text-xs text-muted-foreground">
                39+ sources réelles · session <code className="bg-secondary/40 px-1 rounded">{sessionId.slice(0, 14)}…</code>
              </p>
            </div>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Database size={11} /> {sources.length || 39} sources
          </Badge>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground">Niche / secteur</span>
            <Input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="SaaS B2B, FinTech…" onKeyDown={(e) => e.key === 'Enter' && launch()} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground flex items-center gap-1"><MapPin size={11} /> Région</span>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="France, Paris…" onKeyDown={(e) => e.key === 'Enter' && launch()} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground">Quantité</span>
            <Input type="number" min={1} max={50} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} onKeyDown={(e) => e.key === 'Enter' && launch()} />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-muted-foreground">Besoins / contexte (optionnel)</span>
            <Input value={context} onChange={(e) => setContext(e.target.value)} placeholder="ex : besoin d'intelligence commerciale" onKeyDown={(e) => e.key === 'Enter' && launch()} />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={launch} disabled={loading || !niche.trim()} className="font-bold">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Rocket size={16} />}
            {loading ? 'Moteur en cours…' : '🚀 Lancer le moteur'}
          </Button>
          {ran && (
            <span className="text-xs text-muted-foreground">
              {loading ? 'Interrogation des sources (SEC, OSM, annuaires…)…' : `${result?.total ?? results.length} résultat(s) · ${sources.length} source(s)`}
            </span>
          )}
        </div>

        {/* Sources utilisées */}
        {sources.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {sources.slice(0, 24).map((s) => (
              <Badge key={s} variant="outline" className="text-[10px] gap-1">
                <Layers size={9} className="text-emerald-400" /> {s}
              </Badge>
            ))}
            {sources.length > 24 && <Badge variant="outline" className="text-[10px]">+{sources.length - 24}</Badge>}
          </div>
        )}

        {/* Erreurs honnêtes (LinkedIn hors-ligne, etc.) */}
        {errors.length > 0 && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-1">
            {errors.slice(0, 4).map((e, i) => (
              <p key={i} className="text-[11px] text-amber-400/90 flex items-center gap-1.5">
                <AlertTriangle size={11} /> {e.source ?? 'source'} : {e.message}
              </p>
            ))}
          </div>
        )}

        {/* Résultats */}
        {ran && !loading && (
          <div className="space-y-1.5">
            {results.length === 0 ? (
              <div className="rounded-lg border border-border/40 bg-secondary/20 p-4 text-center text-sm text-muted-foreground">
                Aucune donnée remontée par les sources publiques pour cette recherche. Réessaie avec un autre terme.
              </div>
            ) : (
              results.map((r, i) => (
                <div key={r.id ?? i} className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card/60 p-2.5 px-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-primary/70">{i + 1}.</span>
                      <span className="text-sm font-bold truncate">{r.name}</span>
                      {r.category && <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">{r.category}</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                      <Badge variant="secondary" className="text-[9px]">{r.source}</Badge>
                      {r.city && <span className="flex items-center gap-0.5"><MapPin size={9} /> {r.city}{r.country ? `, ${r.country}` : ''}</span>}
                      {r.website && <a href={r.website} target="_blank" rel="noreferrer" className="flex items-center gap-0.5 text-primary hover:underline truncate"><Globe size={9} /> {r.website.replace(/^https?:\/\//, '').slice(0, 30)}</a>}
                    </div>
                  </div>
                  {typeof r.score === 'number' && (
                    <span className={cn('text-xs font-black', r.score >= 70 ? 'text-emerald-400' : r.score >= 40 ? 'text-amber-400' : 'text-muted-foreground')}>{r.score}</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
