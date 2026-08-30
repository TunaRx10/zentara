/**
 * LeadflowPage — flux Leadify simplifié (2 étapes).
 *
 *   Étape 1 · Cible  : niche + localisation + quantité (+ source & enrichissement)
 *   Étape 2 · Leads  : chaque lead a un bouton « Générer l'email » →
 *                      composer personnalisé (sujet + message), aperçu, puis
 *                      envoi via ton Google Apps Script (Réglages → Sheets Sync)
 *                      vers l'email du lead (ou le contact retrouvé en base).
 *
 * L'ancien « provider mock/resend + délivrabilité » a été retiré : l'envoi
 * se fait désormais via ton propre Apps Script (Gmail), comme pour le reste
 * de l'app.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import {
  Rocket,
  MapPin,
  Search as SearchIcon,
  Loader2,
  Mail,
  MailPlus,
  Phone,
  Globe,
  Users,
  Building2,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { EmailComposerModal } from '@/components/EmailComposerModal';
import { getApiClient } from '@/services/api/client';
import { cn } from '@/lib/utils';

interface LeadflowLead {
  name: string;
  category?: string | null;
  phone?: string | null;
  website?: string | null;
  email?: string | null;
  confidence?: number;
  enriched?: boolean;
}

interface LeadflowRunResult {
  campaign_id: string;
  campaign_name: string;
  source: string;
  companies_created: number;
  prospects_created: number;
  contacts_created: number;
  emails_drafted: number;
  sequences_created: number;
  leads: LeadflowLead[];
}

type Step = 'target' | 'leads';

export function LeadflowPage(): React.ReactElement {
  const [step, setStep] = React.useState<Step>('target');

  // Step 1 — cible
  const [query, setQuery] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [limit, setLimit] = React.useState(10);
  const [radius, setRadius] = React.useState('');
  const [source, setSource] = React.useState('osm');
  const [enrichLimit, setEnrichLimit] = React.useState(5);

  // Step 2 — résultats
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<LeadflowRunResult | null>(null);

  const run = React.useCallback(async () => {
    if (!query.trim()) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const data = await getApiClient().post<LeadflowRunResult>('/leadflow/run', {
        query: query.trim(),
        location: location.trim(),
        limit,
        radius: radius ? Number(radius) : undefined,
        source,
        enrichLimit,
      });
      setResult(data);
      setStep('leads');
    } catch (e) {
      setError((e as Error)?.message ?? 'Erreur inconnue');
    } finally {
      setRunning(false);
    }
  }, [query, location, limit, radius, source, enrichLimit]);

  const steps: Array<{ key: Step; label: string; help?: string }> = [
    { key: 'target', label: '1 · Cible' },
    {
      key: 'leads',
      label: '2 · Leads (génère email à la volée)',
      help:
        "Chaque lead se voit proposer un email personnalisé, automatiquement poussé comme brouillon sur la page Emails. Tu édites / envois depuis /emails — ici tu fais du triage rapide.",
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-20 pt-4">
      {/* Header + stepper */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-2xl bg-gradient-to-br from-primary to-violet-600 text-white">
            <Rocket size={24} />
          </div>
          <div>
            <h2 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              Leadflow
            </h2>
            <p className="text-muted-foreground text-sm">
              Maps → enrichissement → email personnalisé → envoi via Gmail (Apps Script).
            </p>
          </div>
        </div>

        {/* Stepper */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold">
            {steps.map((s, i) => {
              const active = step === s.key;
              const done = step === 'leads' && s.key === 'target';
              return (
                <React.Fragment key={s.key}>
                  <span
                    title={s.help}
                    className={cn(
                      'px-3 py-1.5 rounded-full border cursor-help',
                      active
                        ? 'bg-primary text-primary-foreground border-primary'
                        : done
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'text-muted-foreground border-border',
                    )}
                  >
                    {s.label}
                  </span>
                  {i < steps.length - 1 && <ChevronRight size={14} className="text-muted-foreground" />}
                </React.Fragment>
              );
            })}
          </div>
          {steps.find((s) => s.key === step)?.help && (
            <p className="text-[11px] text-muted-foreground leading-snug">
              <Info size={11} className="inline -mt-0.5 mr-1" />
              {steps.find((s) => s.key === step)?.help}
            </p>
          )}
        </div>
      </div>

      {/* Step 1 — Cible */}
      {step === 'target' && (
        <Card className="border-border/60 bg-card/60">
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Niche / activité</label>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="dentistes, agences web, restaurants…" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Localisation</label>
                <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Paris, Lyon…" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Quantité</label>
                <Input type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(Math.max(1, Math.min(100, Number(e.target.value) || 10)))} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Rayon (km) — grille de points</label>
                <select value={radius} onChange={(e) => setRadius(e.target.value)} className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm">
                  <option value="">Zone complète (bbox auto)</option>
                  <option value="5">5 km</option>
                  <option value="10">10 km</option>
                  <option value="15">15 km</option>
                  <option value="25">25 km</option>
                  <option value="50">50 km</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Source Maps</label>
                <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm">
                  <option value="osm">OpenStreetMap / Overpass (gratuit, sans clé)</option>
                  <option value="places">Google Places (clé requise)</option>
                  <option value="serpapi">SerpAPI (clé requise)</option>
                  <option value="outscraper">Outscraper (clé requise)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sites à enrichir (emails)</label>
                <Input type="number" min={0} max={20} value={enrichLimit} onChange={(e) => setEnrichLimit(Math.max(0, Math.min(20, Number(e.target.value) || 5)))} />
              </div>
            </div>
            <Button onClick={run} disabled={running || !query.trim()} className="gap-2">
              {running ? <Loader2 size={16} className="animate-spin" /> : <SearchIcon size={16} />}
              {running ? 'Scraping + enrichissement…' : 'Lancer le flux'}
            </Button>
            {error && <ErrorBox message={error} />}
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Leads & Emails */}
      {step === 'leads' && result && (
        <div className="space-y-4">
          <SummaryStrip result={result} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.leads.map((lead, i) => (
              <LeadCard key={`${lead.name}-${i}`} lead={lead} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setStep('target')} variant="outline">
              ← Nouveau flux
            </Button>
            {result.emails_drafted > 0 && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-400" />
                {result.emails_drafted} email(s) drafté(s) — visibles sur la page{' '}
                <Link to="/emails" className="underline hover:text-foreground font-bold">Emails</Link>{' '}
                pour édition / envoi.
              </p>
            )}
          </div>
          {error && <ErrorBox message={error} />}
        </div>
      )}
    </div>
  );
}

function SummaryStrip({ result }: { result: LeadflowRunResult }): React.ReactElement {
  const items = [
    { icon: <Building2 size={14} />, label: 'Companies', value: result.companies_created },
    { icon: <Users size={14} />, label: 'Prospects', value: result.prospects_created },
    { icon: <Mail size={14} />, label: 'Contacts', value: result.contacts_created },
    { icon: <MapPin size={14} />, label: 'Source', value: result.source },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((it) => (
        <div key={it.label} className="rounded-2xl border border-border/60 bg-card/60 p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">{it.icon}</div>
          <div>
            <div className="text-lg font-black tabular-nums">{it.value}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{it.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function LeadCard({ lead }: { lead: LeadflowLead }): React.ReactElement {
  const [emailOpen, setEmailOpen] = React.useState(false);
  const conf = lead.confidence ?? 0;
  return (
    <Card className="border-border/60 bg-card/60">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-bold truncate">{lead.name}</p>
            <p className="text-xs text-muted-foreground">{lead.category ?? 'Business'}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {lead.enriched && (
              <span className="px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-400 border border-violet-500/30 text-[10px] font-bold">
                ✨ enrichi
              </span>
            )}
            <span
              className={cn(
                'px-2 py-0.5 rounded-lg border text-xs font-black',
                conf >= 70
                  ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                  : 'text-amber-400 bg-amber-500/10 border-amber-500/20',
              )}
            >
              {conf}%
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          {lead.phone && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Phone size={12} /> {lead.phone}
            </span>
          )}
          {lead.website && (
            <a href={lead.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              <Globe size={12} /> site
            </a>
          )}
          {lead.email && (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <Mail size={12} /> {lead.email}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEmailOpen(true)}
          className="w-full border-primary/40 text-primary hover:bg-primary/10 gap-2"
        >
          <MailPlus size={14} /> Générer l'email
        </Button>
      </CardContent>
      {emailOpen && (
        <EmailComposerModal
          entityName={lead.name}
          entityCategory={lead.category}
          initialEmail={lead.email}
          searchQuery={lead.name}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </Card>
  );
}

function ErrorBox({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
      <AlertTriangle size={16} />
      {message}
    </div>
  );
}