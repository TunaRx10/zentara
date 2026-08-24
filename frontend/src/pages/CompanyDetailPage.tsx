/**
 * CompanyDetailPage — Round 37.
 *
 * Page dédiée à une entreprise (route `/companies/:id`). Affiche :
 *
 *  1. Hero card : nom, tier (HOT/WARM/COLD), score, status, coordonnées
 *     complètes (phone, email, address, country, website, Maps, social).
 *
 *  2. 5 onglets :
 *     - Overview     → Profil + signaux clés + métriques dérivées.
 *     - Intelligence → Bloc `AI Strategic Analysis` + Notes de prospection.
 *     - Prospects    → Liste des contacts rattachés à cette company.
 *     - Outreach     → Drafts AI + timeline de séquences.
 *     - Signals      → Signaux monitoring en temps réel.
 *
 *  3. Section **Besoins détectés** : la liste des pain-points détectés
 *     pour cette entreprise (tirés de `notes` + `intelligence.risks` +
 *     signaux monitoring) et la réponse Zentara (comment on y répond).
 *
 * Routage : ouvre via `<Link to={'/companies/' + id}>`. Le bouton
 * back-to-list ramène à `/companies`.
 */
import React from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  Phone,
  Mail,
  Globe,
  MapPin,
  ExternalLink,
  Tag,
  Sparkles,
  Brain,
  Activity,
  Users,
  Target,
  Rocket,
  Eye,
  Zap,
  Lightbulb,
  ScanSearch,
  Cpu,
  Send,
  Loader2,
  MailCheck,
  MailX,
  Palette,
  Trash2,
  FileSignature,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { cn, safeString } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkline } from '@/components/Sparkline';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useToast } from '@/contexts/ToastProvider';
import { getApiClient, ZentaraApiError } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  useCompaniesQuery,
  useCompanyQuery,
  useCompanyProspectsQuery,
  useCompanyAggregateScoreQuery,
  useCompanyOutreachSummaryQuery,
  useIntelligenceForEntity,
  useSignalsForEntity,
  useAnalyticsTimeseriesQuery,
  type TimeseriesMetric,
} from '@/hooks/useBackendData';
import {
  useForceAutoAnalyzeMutation,
  useGenerateOutreachDraftsMutation,
  useOutreachSendMutation,
  useOutreachRespondMutation,
  useEnrichCompanyMutation,
} from '@/hooks/useEntityActions';
import { AutoScrapeToggle } from '@/components/AutoScrapeToggle';
import { AnalysisView, type EmailActionMeta } from '@/components/AnalysisView';
import { EmailComposerModal } from '@/components/EmailComposerModal';
import type { Company, Prospect, OutreachEmail, OutreachSequence } from '@/types';

// =====================================================================
// Helpers de rendu
// =====================================================================

function tierBadge(score?: number | null): {
  label: 'HOT' | 'WARM' | 'COLD';
  className: string;
  emoji: string;
} {
  if ((score ?? 0) >= 70) return { label: 'HOT', className: 'bg-red-500/15 text-red-500 border-red-500/30', emoji: '🔥' };
  if ((score ?? 0) >= 40) return { label: 'WARM', className: 'bg-amber-500/15 text-amber-500 border-amber-500/30', emoji: '🌡️' };
  return { label: 'COLD', className: 'bg-slate-500/15 text-slate-400 border-slate-400/30', emoji: '🧊' };
}

function statusBadge(status?: string | null) {
  const s = status ?? 'active';
  const map: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
    target: 'bg-violet-500/15 text-violet-500 border-violet-500/30',
    new: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
    inactive: 'bg-slate-500/15 text-slate-400 border-slate-400/30',
    blacklisted: 'bg-red-500/15 text-red-500 border-red-500/30',
  };
  return map[s] ?? map.inactive;
}

function safeUrl(s?: string | null): string | null {
  if (!s) return null;
  if (/^https?:/i.test(s)) return s;
  return `https://${s}`;
}

function parseSocialProfiles(raw?: string | null): Array<{ platform: string; url: string; icon: React.ReactNode }> {
  if (!raw) return [];
  type Soc = Record<string, string>;
  let parsed: Soc = {};
  try {
    if (raw.trim().startsWith('{')) {
      parsed = JSON.parse(raw) as Soc;
    } else {
      // Format "twitter:url;linkedin:url"
      raw.split(/[;\n]/).forEach((kv) => {
        const [k, v] = kv.split(':').map((x) => x?.trim());
        if (k && v) parsed[k.toLowerCase()] = v;
      });
    }
  } catch {
    return [];
  }
  return Object.entries(parsed).map(([platform, url]) => {
    const lower = String(platform ?? '').toLowerCase();
    // Tous les social icons : représentation par initiale avec Globe en fallback
    // (lucide-react n'expose pas les social-icons pour LinkedIn, X, etc.)
    let icon = <Globe size={12} />;
    if (lower.includes('in')) icon = <span className="text-[9px] font-black">in</span>;
    else if (lower.includes('x') || lower.includes('tw')) icon = <span className="text-[9px] font-black">X</span>;
    else if (lower.includes('fb') || lower.includes('facebook')) icon = <span className="text-[9px] font-black">f</span>;
    else if (lower.includes('ig') || lower.includes('insta')) icon = <span className="text-[9px] font-black">Ig</span>;
    return { platform, url: safeUrl(url) ?? url, icon };
  });
}

/** Round 43 — module Zentara lançable depuis une carte de besoin détecté.
 *  Round 66 — ajoute `design?: boolean` (audit design + auto-draft outreach). */
type NeedModule = { label: string; analyze?: boolean; prospect?: boolean; outreach?: boolean; monitoring?: boolean; scrape?: boolean; design?: boolean };

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} • ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
}

// =====================================================================
// Sous-composants
// =====================================================================

const ContactStrip: React.FC<{ company: Company }> = ({ company }) => {
  const socials = parseSocialProfiles(company.social_profiles);
  const website = safeUrl(company.website);
  const maps = safeUrl(company.google_maps_url);

  // Phone peut être dans `phone` ou construire depuis les notes.
  const phones = (company.phone ?? '').split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
  const emails = (company.email ?? '').split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Téléphone */}
      <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur p-4 group hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
            <Phone size={13} />
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Téléphone</span>
        </div>
        {phones.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">Non renseigné</div>
        ) : (
          <div className="space-y-1">
            {phones.map((p, i) => (
              <a
                key={i}
                href={`tel:${p.replace(/\s/g, '')}`}
                className="block text-sm font-mono font-bold text-foreground hover:text-primary transition-colors"
              >
                {p}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Email */}
      <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur p-4 group hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-7 h-7 rounded-lg bg-blue-500/15 text-blue-500 flex items-center justify-center">
            <Mail size={13} />
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Email</span>
        </div>
        {emails.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">Non renseigné</div>
        ) : (
          <div className="space-y-1">
            {emails.map((e, i) => (
              <a
                key={i}
                href={`mailto:${e}`}
                className="block text-sm font-mono font-bold text-foreground hover:text-primary transition-colors truncate"
              >
                {e}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Website */}
      <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur p-4 group hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-7 h-7 rounded-lg bg-violet-500/15 text-violet-500 flex items-center justify-center">
            <Globe size={13} />
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Site web</span>
        </div>
        {website ? (
          <a
            href={website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-bold text-foreground hover:text-primary transition-colors flex items-center gap-1 truncate"
          >
            {company.website?.replace(/^https?:\/\//, '')}
            <ExternalLink size={10} />
          </a>
        ) : (
          <div className="text-xs text-muted-foreground italic">Non renseigné</div>
        )}
      </div>

      {/* Adresse */}
      <div className="rounded-2xl border border-border/40 bg-card/40 backdrop-blur p-4 group hover:border-primary/40 transition-colors">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="w-7 h-7 rounded-lg bg-amber-500/15 text-amber-500 flex items-center justify-center">
            <MapPin size={13} />
          </div>
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Adresse</span>
        </div>
        <div className="text-sm font-bold leading-snug text-foreground">
          {company.address
            ?? [company.city, company.country].filter(Boolean).join(', ')
            ?? <span className="text-muted-foreground italic">Non renseignée</span>}
        </div>
        {(company.city || company.country) && company.address && (
          <div className="text-[11px] text-muted-foreground mt-0.5">
            {[company.city, company.country].filter(Boolean).join(', ')}
          </div>
        )}
        {maps && (
          <a href={maps} target="_blank" rel="noopener noreferrer"
             className="mt-1 inline-flex items-center gap-1 text-[10px] text-primary hover:underline font-bold uppercase tracking-widest">
            <MapPin size={9} /> Google Maps
          </a>
        )}
      </div>

      {/* Réseaux sociaux (col séparée sur toute la largeur) */}
      {socials.length > 0 && (
        <div className="md:col-span-2 lg:col-span-4 rounded-2xl border border-border/40 bg-card/40 backdrop-blur p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg bg-pink-500/15 text-pink-500 flex items-center justify-center">
              <Users size={13} />
            </div>
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Réseaux sociaux</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {socials.map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/40 bg-background/40 hover:border-primary/40 hover:text-primary transition-colors text-xs font-bold">
                {s.icon}
                <span className="capitalize">{s.platform}</span>
                <ExternalLink size={10} />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const HeroCard: React.FC<{ company: Company; aggregate?: { score: number; tier: 'HOT' | 'WARM' | 'COLD' } | null; series?: number[] }> = ({ company, aggregate, series }) => {
  const tier = tierBadge(aggregate?.score ?? company.score);
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-gradient-to-br from-card/80 via-card/40 to-card p-6 md:p-8">
      {/* Glow halo (parallèle aurora) */}
      <div className={cn('absolute -top-12 -right-12 w-64 h-64 rounded-full blur-3xl opacity-40 bg-gradient-to-br', tier.label === 'HOT' ? 'from-red-500 to-orange-600' : tier.label === 'WARM' ? 'from-amber-500 to-yellow-600' : 'from-slate-500 to-slate-700')} />
      <div className="relative flex flex-col md:flex-row md:items-center gap-6">
        {/* Logo placeholder */}
        <div className={cn(
          'w-20 h-20 rounded-2xl flex items-center justify-center text-white shadow-2xl shrink-0',
          'bg-gradient-to-br', tier.label === 'HOT' ? 'from-red-500 to-orange-600'
            : tier.label === 'WARM' ? 'from-amber-500 to-yellow-600'
              : 'from-slate-500 to-slate-700'
        )}>
          <Building2 size={32} strokeWidth={2.2} />
        </div>

        {/* Texte */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest border', tier.className)}>
              {tier.emoji} {tier.label}
            </span>
            <span className={cn('px-2 py-0.5 rounded-full text-[10px] font-black tracking-widest border', statusBadge(company.status))}>
              {company.status ?? 'active'}
            </span>
            {company.industry && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-accent/10 text-accent border border-accent/30 uppercase">
                {company.industry}
              </span>
            )}
            {company.sector && company.sector !== company.industry && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide bg-accent/10 text-accent border border-accent/30 uppercase" title="Secteur inféré par l'IA">
                <Tag size={10} /> {company.sector}
              </span>
            )}
          </div>
          <h1 className="text-2xl md:text-4xl font-black tracking-tight mb-2 truncate">
            {company.name}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {company.sector && company.sector !== company.industry && <span>{company.sector}</span>}
            <span>Score : <strong className="text-foreground font-mono">{aggregate?.score ?? company.score ?? 0}</strong>/100</span>
            <span>Mise à jour : <strong className="font-mono">{fmtDate(company.updated_at)}</strong></span>
            <span className="font-mono text-[10px] opacity-60">id {company.id}</span>
          </div>
        </div>

        {/* Sparkline trend */}
        <div className="hidden md:block w-56 shrink-0 flex flex-col items-end gap-1">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Tendance 12j</span>
          <Sparkline
            series={series && series.length > 0 ? series : [0,0,0,0,0,0,0,0,0,0,0,0]}
            accent={tier.label === 'HOT' ? 'text-red-500' : tier.label === 'WARM' ? 'text-amber-500' : 'text-slate-400'}
            className="h-14 w-full"
          />
        </div>
      </div>
    </div>
  );
};

// =====================================================================
// Overview — tuiles KPI + estimation produit & impact
// =====================================================================

const StatTile: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  tone?: 'hot' | 'warm' | 'cold';
}> = ({ icon, label, value, suffix, tone = 'cold' }) => {
  const tones = {
    hot: 'from-orange-500/15 to-red-500/5 border-orange-500/30 text-orange-400',
    warm: 'from-amber-500/15 to-yellow-500/5 border-amber-500/30 text-amber-400',
    cold: 'from-slate-500/10 to-slate-500/5 border-border text-muted-foreground',
  };
  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest opacity-90 mb-1.5">
        {icon}
        {label}
      </div>
      <p className="text-2xl font-black tracking-tight text-foreground">
        {value}
        {suffix ? <span className="text-xs font-bold text-muted-foreground ml-0.5">{suffix}</span> : null}
      </p>
    </div>
  );
};

const OverviewProductEstimate: React.FC<{
  intel: { product_estimate?: {
    product?: string | null;
    price_monthly_eur?: number | null;
    impact_pct?: number | null;
    roi_12m_eur?: number | null;
    justification?: string | null;
    note?: string | null;
  } | null } | null;
}> = ({ intel }) => {
  const est = intel?.product_estimate;
  if (!est?.product) return null;
  const impact = est.impact_pct ?? 0;
  const impactTone =
    impact >= 70 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
    : impact >= 40 ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
    : 'border-red-500/30 bg-red-500/10 text-red-400';
  return (
    <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-5 md:p-6">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-violet-600 text-white flex items-center justify-center">
          <Target size={14} />
        </div>
        <h2 className="text-base md:text-lg font-black tracking-tight">Estimation produit & impact</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Recommandation IA basée sur le catalogue officiel Zentara — estimation prudente, non contractuelle.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border/70 bg-card/60 p-4 sm:col-span-2">
          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">Produit recommandé</div>
          <p className="text-sm font-black text-foreground leading-snug">{est.product}</p>
          {est.justification ? <p className="text-[11px] text-muted-foreground leading-relaxed mt-1.5">{est.justification}</p> : null}
        </div>
        <div className="rounded-xl border border-border/70 bg-card/60 p-4">
          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">Prix mensuel</div>
          <p className="text-xl font-black text-primary">
            {est.price_monthly_eur ? `${est.price_monthly_eur} €` : '—'}
            <span className="text-[11px] font-bold text-muted-foreground">/mois</span>
          </p>
        </div>
        <div className={`rounded-xl border p-4 ${impactTone}`}>
          <div className="text-[10px] uppercase tracking-widest font-bold mb-1 opacity-90">Impact estimé</div>
          <p className="text-xl font-black">{impact > 0 ? `${impact}%` : '—'}</p>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:col-span-2">
          <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">ROI estimé sur 12 mois</div>
          <p className="text-xl font-black text-emerald-400">
            {est.roi_12m_eur ? `${est.roi_12m_eur.toLocaleString('fr-FR')} €` : '—'}
          </p>
        </div>
      </div>
      {est.note ? <p className="text-[11px] italic text-muted-foreground/80 leading-relaxed mt-3">{est.note}</p> : null}
    </div>
  );
};

// =====================================================================
// Section : besoins détectés
// =====================================================================

const NeedsDetected: React.FC<{
  needs: Array<{
    title: string;
    severity: 'high' | 'medium' | 'low';
    detection: string;
    answer: string;
    modules?: NeedModule;
  }>;
  /** Round 43 — déclenche l'exécution des modules recommandés (mutation parent). */
  enrichPending: boolean;
  onRunModule: (m: NeedModule) => void;
}> = ({ needs, enrichPending, onRunModule }) => {
  if (needs.length === 0) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/40 p-6 text-center">
        <Lightbulb size={28} className="text-muted-foreground opacity-30 mx-auto mb-2" />
        <p className="text-sm font-bold mb-1">Aucun besoin spécifique détecté automatiquement</p>
        <p className="text-xs text-muted-foreground">Lancez une analyse IA pour faire émerger les pain-points de cette entreprise.</p>
      </div>
    );
  }
  const sevColor = {
    high: 'border-red-500/30 bg-red-500/10 text-red-500',
    medium: 'border-amber-500/30 bg-amber-500/10 text-amber-500',
    low: 'border-blue-500/30 bg-blue-500/10 text-blue-500',
  };
  const sevIcon = {
    high: '🔥',
    medium: '⚠️',
    low: 'ℹ️',
  };
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-red-500 to-amber-500 text-white flex items-center justify-center">
          <Lightbulb size={14} />
        </div>
        <h2 className="text-base font-black tracking-tight">Besoins détectés & réponses Zentara</h2>
      </div>
      <div className="space-y-3">
        {needs.map((n, i) => (
          <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-border/40 bg-background/40">
            <span className={cn('shrink-0 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest', sevColor[n.severity])}>
              {sevIcon[n.severity]} {n.severity}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold leading-snug">{n.title}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                <strong>Détection :</strong> {n.detection}
              </div>
              <div className="text-[11px] text-primary mt-0.5 leading-snug">
                <strong>Réponse Zentara :</strong> {n.answer}
              </div>
              {n.modules && (
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={enrichPending}
                    onClick={() => onRunModule(n.modules!)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider transition-colors',
                      enrichPending
                        ? 'bg-primary/10 text-primary/60 cursor-wait'
                        : 'bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30',
                    )}
                  >
                    {enrichPending ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />}
                    {n.modules.label}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// =====================================================================
// Onglet : Intelligence (analysis IA)
// =====================================================================

const IntelligenceTab: React.FC<{
  companyId: string;
  company?: { name?: string | null; email?: string | null; category?: string | null } | null;
}> = ({ companyId, company }) => {
  const { data: intel, isLoading } = useIntelligenceForEntity('company', companyId);
  const forceAutoMut = useForceAutoAnalyzeMutation();
  const toast = useToast();
  const [emailDraft, setEmailDraft] = React.useState<{ subject: string; body: string; meta?: EmailActionMeta } | null>(null);

  const handleForce = async () => {
    try {
      await forceAutoMut.mutateAsync({ company_id: companyId });
      toast.success('Analyse IA forcée déclenchée', 3000);
    } catch (e) {
      toast.error(`Échec : ${(e as Error).message}`, 5000);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-black tracking-tight flex items-center gap-2">
          <Brain size={16} className="text-primary" /> Analyse IA stratégique
        </h2>
        <Button onClick={handleForce} disabled={forceAutoMut.isPending} className="text-xs bg-primary hover:bg-primary/90 text-primary-foreground">
          {forceAutoMut.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Zap size={12} className="mr-1" />}
          Force auto-analysis
        </Button>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border/40 bg-card/40 p-6 text-center text-xs text-muted-foreground">
          <Loader2 size={20} className="animate-spin mx-auto mb-2" />
          Chargement de l'analyse existante…
        </div>
      ) : !intel ? (
        <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-6 text-center">
          <Cpu size={28} className="text-primary opacity-60 mx-auto mb-2" />
          <p className="text-sm font-bold mb-1">Aucune analyse IA disponible</p>
          <p className="text-xs text-muted-foreground mb-3">Lancez Force auto-analysis pour activer le pipeline 7-engines.</p>
          <Button onClick={handleForce} disabled={forceAutoMut.isPending} className="bg-primary text-primary-foreground">
            Activer le pipeline 7-engines IA
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <AnalysisView
            intel={intel}
            contact={{ name: company?.name, email: company?.email, category: company?.category }}
            onSendEmail={(subject, body, meta) => setEmailDraft({ subject, body, meta })}
          />
          {/* Scores détaillés */}
          <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
            <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-3">Scores</div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <ScoreBar label="Global" value={intel.score ?? 0} />
              <ScoreBar label="Opportunité" value={intel.opportunity_score ?? 0} />
              <ScoreBar label="Pertinence" value={intel.relevance_score ?? 0} />
              <ScoreBar label="Intention" value={intel.intent_score ?? 0} />
              <ScoreBar label="Activité" value={intel.activity_score ?? 0} />
            </div>
          </div>
        </div>
      )}

      {/* Composeur email (Envoyer / Preview) pré-rempli depuis l'analyse IA */}
      {emailDraft && (
        <EmailComposerModal
          entityName={company?.name || 'cette entreprise'}
          entityCategory={company?.category || null}
          initialEmail={emailDraft.meta?.recipient || company?.email || null}
          initialSubject={emailDraft.subject || null}
          initialBody={emailDraft.body || null}
          initialHtml={emailDraft.meta?.html || null}
          initialCtaUrl={emailDraft.meta?.ctaUrl || null}
          searchQuery={company?.name || undefined}
          onClose={() => setEmailDraft(null)}
        />
      )}
    </div>
  );
};

const ScoreBar: React.FC<{ label: string; value: number }> = ({ label, value }) => {
  const v = Math.max(0, Math.min(100, value));
  const color = v >= 70 ? 'from-red-500 to-orange-600'
    : v >= 40 ? 'from-amber-500 to-yellow-600'
      : 'from-slate-500 to-slate-700';
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
        <span className="text-sm font-black font-mono text-foreground">{v}</span>
      </div>
      <div className="h-2 rounded-full bg-muted/60 overflow-hidden">
        <div className={cn('h-full bg-gradient-to-r', color)} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
};

// =====================================================================
// Onglet : Prospects (liste avec mini-profil)
// =====================================================================

const ProspectsTab: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { data: prospects = [], isLoading } = useCompanyProspectsQuery(companyId);
  if (isLoading) {
    return <div className="text-xs text-muted-foreground p-4">Chargement…</div>;
  }
  if (prospects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/40 bg-card/40 p-8 text-center text-xs text-muted-foreground">
        Aucun prospect rattaché à cette entreprise. Depuis la fiche Prospect, assignez <strong>company_id</strong> à cette société.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
      <div className="grid grid-cols-12 px-4 py-2.5 bg-muted/30 text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-border/40">
        <div className="col-span-8 md:col-span-5">Prospect</div>
        {/* Rôle masqué sur mobile (colonnes trop étroites) */}
        <div className="hidden md:block md:col-span-3">Rôle</div>
        <div className="col-span-2">Statut</div>
        <div className="col-span-2 text-right">Score</div>
      </div>
      {prospects.map((p: Prospect) => (
        <Link key={p.id} to={`/prospects?focus=${encodeURIComponent(p.id)}`}
              className="grid grid-cols-12 px-4 py-3 border-t border-border/40 hover:bg-primary/5 transition-colors items-center text-sm">
          <div className="col-span-8 md:col-span-5 min-w-0">
            <div className="font-bold truncate">{p.first_name} {p.last_name}</div>
            <div className="text-[11px] text-muted-foreground truncate font-mono">{p.email ?? '—'}</div>
          </div>
          <div className="hidden md:block md:col-span-3 truncate text-[12px] text-muted-foreground">{p.role ?? '—'}</div>
          <div className="col-span-2 overflow-hidden">
            <Badge variant="outline" className="text-[9px] capitalize max-w-full truncate">{p.status}</Badge>
          </div>
          <div className="col-span-2 text-right font-mono font-bold">{p.score ?? 0}</div>
        </Link>
      ))}
    </div>
  );
};

// =====================================================================
// Onglet : Outreach (timeline emails + draft inline)
// =====================================================================

const OutreachTab: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { data: prospects = [] } = useCompanyProspectsQuery(companyId);
  const { data: outreach } = useCompanyOutreachSummaryQuery(companyId);
  const draftMut = useGenerateOutreachDraftsMutation();
  const sendMut = useOutreachSendMutation();
  const respondMut = useOutreachRespondMutation();
  const toast = useToast();

  const handleDraft = async (prospect_id: string, tone: 'cold' | 'follow_up' | 'breakup' | 'all') => {
    try {
      const res = await draftMut.mutateAsync({ prospect_id, tone, simulate: true, persist: true });
      toast.success(`${res.data?.drafts?.length ?? 0} drafts générés`, 3000);
    } catch (e) {
      toast.error(String((e as Error).message), 4000);
    }
  };

  const handleSend = async (email_id: string) => {
    try {
      await sendMut.mutateAsync({ email_id });
      toast.success('Email marqué envoyé', 3000);
    } catch (e) {
      toast.error(String((e as Error).message), 4000);
    }
  };

  const handleRespond = async (email_id: string, response: 'replied' | 'bounced') => {
    try {
      await respondMut.mutateAsync({ email_id, response });
      toast.info(response === 'replied' ? 'Réponse enregistrée' : 'Marqué bounced', 3000);
    } catch (e) {
      toast.error(String((e as Error).message), 4000);
    }
  };

  const emails = outreach?.emails ?? [];
  const sequences = outreach?.sequences ?? [];

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <OutreachMini label="Total" value={outreach?.total_emails ?? emails.length} icon={<Mail size={12} />} color="bg-blue-500/15 text-blue-500" />
        <OutreachMini label="Envoyés" value={outreach?.total_sent ?? 0} icon={<Send size={12} />} color="bg-emerald-500/15 text-emerald-500" />
        <OutreachMini label="Répondus" value={outreach?.total_replied ?? 0} icon={<MailCheck size={12} />} color="bg-violet-500/15 text-violet-500" />
        <OutreachMini label="Bounced" value={outreach?.total_bounced ?? 0} icon={<MailX size={12} />} color="bg-red-500/15 text-red-500" />
        <OutreachMini label="Séquences" value={outreach?.total_active_sequences ?? sequences.length} icon={<Sparkles size={12} />} color="bg-amber-500/15 text-amber-500" />
      </div>

      {/* Draft generator */}
      {prospects.length > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Générer un draft AI</div>
          <div className="flex flex-wrap items-center gap-2">
            {prospects.slice(0, 3).map((p) => (
              <div key={p.id} className="flex items-center gap-1.5 rounded-xl border border-border/40 bg-background/40 p-1 pr-2">
                <span className="text-xs font-bold px-2">{p.first_name} {p.last_name}</span>
                {(['cold', 'follow_up', 'breakup', 'all'] as const).map((t) => (
                  <button key={t}
                    type="button"
                    onClick={() => handleDraft(p.id, t)}
                    disabled={draftMut.isPending}
                    className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-md bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50">
                    {t === 'all' ? 'All 3' : t.replace('_', ' ')}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/30 text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-border/40">
          Timeline
        </div>
        {emails.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Aucun email envoyé.</div>
        ) : (
          <ul className="divide-y divide-border/40">
            {emails.map((e: OutreachEmail) => (
              <li key={e.id} className="px-4 py-3 flex flex-wrap items-center gap-2 text-sm hover:bg-primary/5">
                <span className={cn(
                  'px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest',
                  e.status === 'sent' ? 'bg-emerald-500/15 text-emerald-500'
                    : e.status === 'replied' ? 'bg-violet-500/15 text-violet-500'
                      : e.status === 'bounced' ? 'bg-red-500/15 text-red-500'
                        : 'bg-slate-500/15 text-slate-400'
                )}>{e.status}</span>
                <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-muted/40">{e.tone}</span>
                <div className="flex-1 min-w-[140px]">
                  <div className="font-bold truncate">{e.subject}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{fmtDateTime(e.sent_at ?? e.created_at)}</div>
                </div>
                <div className="ml-auto flex gap-1">
                  {e.status === 'draft' && (
                    <button type="button" onClick={() => handleSend(e.id)} disabled={sendMut.isPending}
                      className="text-[10px] font-bold uppercase px-2 py-1 rounded-md bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500">
                      <Send size={10} className="inline mr-1" />Envoyer
                    </button>
                  )}
                  {(e.status === 'sent' || e.status === 'opened') && (
                    <>
                      <button type="button" onClick={() => handleRespond(e.id, 'replied')} disabled={respondMut.isPending}
                        className="text-[10px] font-bold uppercase px-2 py-1 rounded-md bg-violet-500/15 hover:bg-violet-500/25 text-violet-500">
                        Replied
                      </button>
                      <button type="button" onClick={() => handleRespond(e.id, 'bounced')} disabled={respondMut.isPending}
                        className="text-[10px] font-bold uppercase px-2 py-1 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-500">
                        Bounced
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const OutreachMini: React.FC<{ label: string; value: number; icon: React.ReactNode; color: string }> = ({ label, value, icon, color }) => (
  <div className="rounded-xl border border-border/40 bg-background/40 p-3">
    <div className={cn('w-6 h-6 rounded-lg flex items-center justify-center mb-1', color)}>{icon}</div>
    <div className="text-2xl font-black font-mono leading-none">{value}</div>
    <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">{label}</div>
  </div>
);

// =====================================================================
// Onglet : Signals monitoring
// =====================================================================

const SignalsTab: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { data: signals = [], isLoading } = useSignalsForEntity('company', companyId);
  if (isLoading) return <div className="text-xs text-muted-foreground p-4">Chargement…</div>;
  if (signals.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/40 bg-card/40 p-8 text-center text-xs text-muted-foreground">
        Aucun signal rattaché. Le watcher monitoring tourne toutes les 10 minutes.
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
      {signals.map((s) => (
        <div key={s.id} className="px-4 py-3 border-t border-border/40 flex items-start gap-3">
          <span className={cn(
            'mt-1.5 w-2 h-2 rounded-full shrink-0',
            (s.confidence ?? 0) >= 90 ? 'bg-red-500'
              : (s.confidence ?? 0) >= 80 ? 'bg-amber-500'
                : (s.confidence ?? 0) >= 70 ? 'bg-blue-500'
                  : 'bg-slate-500'
          )} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold truncate">{s.entity_name ?? s.source}</div>
            <div className="text-[11px] text-muted-foreground truncate">{s.content}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {fmtDateTime(s.detected_at)} · conf. {s.confidence ?? 0}%
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// =====================================================================
// Onglet : Design Audit (Round 61)
// =====================================================================

interface DesignAuditRecordMini {
  id: string;
  url: string;
  domain: string | null;
  score: number;
  category_scores?: { structure?: number; a11y?: number; seo?: number; perf?: number; ux?: number };
  issues?: Array<{ severity?: string; title?: string }>;
  created_at: string;
}

function useDesignAuditsForCompany(companyId: string | undefined) {
  return useQuery<DesignAuditRecordMini[], Error>({
    queryKey: ['design-audit', 'for-company', companyId],
    enabled: !!companyId,
    queryFn: async ({ signal }) => {
      const api = getApiClient();
      if (!companyId) return [];
      const raw = await api.get<DesignAuditRecordMini[] | { data: DesignAuditRecordMini[] }>(
        ENDPOINTS.designAuditForCompany(companyId),
        { signal },
      );
      const data = 'data' in raw ? (raw as { data: DesignAuditRecordMini[] }).data : (raw as DesignAuditRecordMini[]);
      return Array.isArray(data) ? data : [];
    },
    staleTime: 30_000,
  });
}

function useRelaunchAuditMutation() {
  const qc = useQueryClient();
  return useMutation<DesignAuditRecordMini, Error, { url: string; companyId?: string }>({
    mutationFn: async ({ url }) => {
      const api = getApiClient();
      const r = await api.post<DesignAuditRecordMini | { data: DesignAuditRecordMini }>(
        `${ENDPOINTS.designAuditCreate}/run`,
        { url },
        { timeoutMs: 90_000 },
      );
      return ('data' in r ? r.data : r) as DesignAuditRecordMini;
    },
    onSuccess: (_, vars) => {
      void qc.invalidateQueries({ queryKey: ['design-audit', 'list'] });
      if (vars.companyId) {
        void qc.invalidateQueries({ queryKey: ['design-audit', 'for-company', vars.companyId] });
      }
    },
  });
}

function useDeleteAuditMutationLocal() {
  const qc = useQueryClient();
  return useMutation<void, Error, { id: string }>({
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

function useGenerateNDAMutationLocal() {
  return useMutation<{ id: string; status?: string }, Error, { audit: DesignAuditRecordMini; companyId: string; companyName: string }>({
    mutationFn: async ({ audit, companyId, companyName }) => {
      const api = getApiClient();
      const r = await api.post<{ data?: { id: string }; id?: string }>(
        ENDPOINTS.contractsGenerate,
        {
          type: 'NDA',
          party_b_kind: 'company',
          party_b_id: companyId,
          party_b_name: companyName,
          context: [
            `Audit design Zentara (Round 61) pour ${companyName}.`,
            `Site audité : ${audit.url} — score ${audit.score}/100.`,
            `Issues prioritaires : ${(audit.issues ?? []).slice(0, 3).map((i) => `[${i.severity}] ${i.title}`).join(' | ') || 'aucune'}.`,
            'Contexte : NDA bilatéral en vue d\'un projet de redesign par Zentara.',
          ].join(' '),
        },
      );
      const data = ('data' in r ? r.data : r) as { id: string; status?: string };
      return data;
    },
  });
}

function friendlyApiError(e: unknown): string {
  if (e instanceof ZentaraApiError) {
    if (e.code === 'NETWORK_UNAVAILABLE' || e.code === 'TIMEOUT') return 'Backend injoignable.';
    if (e.code === 'RATE_LIMITED') return 'Trop de requêtes — réessaie dans 30s.';
    return `[${e.code}] ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return 'Erreur inconnue.';
}

const DesignAuditTab: React.FC<{ companyId: string; companyName: string; website?: string }> = ({
  companyId,
  companyName,
  website,
}) => {
  const toast = useToast();
  const { data: audits = [], isLoading, refetch } = useDesignAuditsForCompany(companyId);
  const relaunch = useRelaunchAuditMutation();
  const deleteMut = useDeleteAuditMutationLocal();
  const genNda = useGenerateNDAMutationLocal();
  const enrichMut = useEnrichCompanyMutation();
  const [pendingDelete, setPendingDelete] = React.useState<DesignAuditRecordMini | null>(null);

  const handleRelaunch = async () => {
    if (!website) {
      toast.error('Aucun site web renseigné pour cette entreprise — ajoute une URL dans la fiche.');
      return;
    }
    try {
      const r = await relaunch.mutateAsync({ url: website, companyId });
      toast.successDetailed(
        'Audit relancé',
        `Score ${r.score}/100 — ${r.issues?.length ?? 0} issue(s) détectée(s) sur ${r.url}`,
      );
    } catch (e) {
      toast.error(`Échec audit — ${friendlyApiError(e)}`);
    }
  };

  const handleGenerateNDA = async (audit: DesignAuditRecordMini) => {
    try {
      const r = await genNda.mutateAsync({ audit, companyId, companyName });
      toast.successDetailed(
        'NDA design généré',
        `Brouillon ${(r?.id ?? '').slice(0, 12)} prêt pour ${companyName}. Ouvre l'onglet Contrats pour signer.`,
      );
    } catch (e) {
      toast.error(`Échec génération NDA — ${friendlyApiError(e)}`);
    }
  };

  // Round 66 — déclenchement de l'audit design + auto-draft d'outreach
  // email quand le score est < 70 et que l'email de la company est connu.
  // Sous le capot : POST /api/auto-analysis/enrich { company_id, design: true }
  // → backend orchestre : audit → si OK+low+email → OutreachService.persistEmail.
  const handleSendDesignOutreach = async () => {
    if (!website) {
      toast.error('Aucun site web renseigné — l\'audit design doit pouvoir analyser le site.');
      return;
    }
    try {
      toast.info(`Lancement audit design + outreach pour ${companyName}…`);
      const r = await enrichMut.mutateAsync({
        company_id: companyId,
        analyze: false, // pas d'analyse 7-engines — focus design
        scrape: false,
        prospect: false,
        outreach: false,
        monitoring: false,
        design: true,
      });
      // The api client returns `{ success, data }` envelope; tolerate both shapes.
      const d: any = (r as any)?.data ?? r;
      const audit: any = d?.design;
      const outreach: any = d?.design_outreach;
      const score = Number(audit?.score ?? 0);
      if (!audit) {
        toast.error('Audit design indisponible — réponse backend invalide.', 6000);
        return;
      }
      if (outreach?.drafted && outreach.drafted > 0) {
        const sub = outreach.emails?.[0]?.subject ?? '(sans sujet)';
        toast.successDetailed(
          `Brouillon d'email design créé · audit ${score}/100`,
          `Sujet : « ${sub} ». Ouvre l'onglet Outreach pour le personnaliser et l'envoyer.`,
        );
      } else if (outreach?.skipped === 'already_drafted_today') {
        toast.info('Brouillon design déjà créé aujourd\'hui — vérifie l\'onglet Outreach.');
      } else if (outreach?.skipped === 'no_email') {
        toast.info(`Audit ${score}/100 terminé mais email inconnu — lance d'abord le scraping du site pour récupérer leur contact.`);
      } else if (outreach?.skipped === 'score_above_threshold') {
        toast.success(`Audit ${score}/100 — site OK, pas d'outreach nécessaire.`);
      } else {
        toast.success(`Audit design terminé — score ${score}/100.`, 4000);
      }
    } catch (e) {
      toast.error(`Échec outreach design — ${friendlyApiError(e)}`, 6000);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await deleteMut.mutateAsync({ id: pendingDelete.id });
  };

  if (isLoading && audits.length === 0) {
    return <div className="text-xs text-muted-foreground p-4">Chargement des audits design…</div>;
  }

  return (
    <div className="space-y-3">
      {/* Action bar */}
      <div className="rounded-2xl border border-pink-500/20 bg-pink-500/5 p-4 flex items-start gap-3 flex-wrap">
        <Palette size={18} className="text-pink-400 mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold">Audit design du site de {companyName}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">
            Scraping structurel + analyse IA · {audits.length} audit{audits.length !== 1 ? 's' : ''} en base
            {website ? <> · site actuel : <code className="text-pink-300">{website}</code></> : ' · aucun site web renseigné'}
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => void handleRelaunch()}
          disabled={relaunch.isPending || !website}
          className="bg-pink-500 hover:bg-pink-600 text-white shrink-0 disabled:opacity-40"
          title={website ? 'Relancer un audit structurel du site' : 'Aucun site web renseigné'}
        >
          {relaunch.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <RefreshCw size={14} className="mr-1.5" />}
          Relancer l'audit
        </Button>
        {/* Round 66 — bouton « Lancer outreach design » orchestrateur
            backend (audit + auto-draft email si score < 70 + email connu). */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void handleSendDesignOutreach()}
          disabled={enrichMut.isPending || !website}
          className="border-pink-500/40 text-pink-300 hover:bg-pink-500/15 hover:text-pink-200 shrink-0 disabled:opacity-40"
          title={website ? 'Lancer audit + outreach design' : 'Aucun site web renseigné'}
        >
          {enrichMut.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : <Send size={14} className="mr-1.5" />}
          Lancer outreach design
        </Button>
      </div>

      {/* Empty state */}
      {audits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/40 bg-card/40 p-8 text-center text-xs text-muted-foreground">
          Aucun audit pour cette entreprise. Clique « Relancer l'audit » pour démarrer le diagnostic du site.
        </div>
      ) : (
        <div className="rounded-2xl border border-border/60 bg-card/60 overflow-hidden">
          <div className="grid grid-cols-12 px-4 py-2.5 bg-muted/30 text-[10px] font-black uppercase tracking-widest text-muted-foreground border-b border-border/40">
            <div className="col-span-1">Score</div>
            <div className="col-span-6 md:col-span-5">URL</div>
            <div className="hidden md:block md:col-span-2">Catégories</div>
            <div className="col-span-3 md:col-span-2">Date</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          {audits.map((a) => (
            <div key={a.id} className="grid grid-cols-12 px-4 py-3 border-t border-border/40 items-center text-sm hover:bg-pink-500/5 transition-colors">
              <div className="col-span-1">
                <div
                  className={cn(
                    'text-2xl font-black tabular-nums',
                    a.score >= 80 ? 'text-emerald-400' : a.score >= 60 ? 'text-amber-400' : a.score >= 40 ? 'text-orange-400' : 'text-red-400',
                  )}
                  title={`Score sur 100`}
                >
                  {a.score}
                </div>
              </div>
              <div className="col-span-6 md:col-span-5 min-w-0">
                <div className="font-mono text-xs truncate" title={a.url}>{a.url}</div>
                <div className="text-[10px] text-muted-foreground truncate">{a.domain ?? ''}</div>
                {a.score < 70 && (
                  <Badge className="mt-1 text-[9px] border-pink-500/30 text-pink-300 bg-pink-500/10 inline-flex items-center gap-1">
                    <Palette size={8} />
                    Tag 'design' actif
                  </Badge>
                )}
              </div>
              <div className="hidden md:flex md:col-span-2 gap-1 flex-wrap">
                {a.category_scores &&
                  Object.entries(a.category_scores).map(([k, v]) =>
                    typeof v === 'number' ? (
                      <span
                        key={k}
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded border tabular-nums',
                          v >= 80 ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                            : v >= 60 ? 'border-amber-500/30 text-amber-400 bg-amber-500/10'
                              : 'border-red-500/30 text-red-400 bg-red-500/10',
                        )}
                        title={`${k}: ${v}/100`}
                      >
                        {k[0].toUpperCase() + k.slice(1, 3)} {v}
                      </span>
                    ) : null,
                  )}
              </div>
              <div className="col-span-3 md:col-span-2 text-[11px] text-muted-foreground">
                {fmtDateTime(a.created_at)}
              </div>
              <div className="col-span-2 flex gap-1 justify-end">
                {/* Round 66 — bouton « Outreach design » sur chaque audit
                    à score < 70. Déclenche l'orchestration backend
                    `design: true` qui : re-run audit (passe le refresh si
                    manuel), et si score<70+email connu → draft d'email
                    dans l'onglet Outreach. */}
                {a.score < 70 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void handleSendDesignOutreach()}
                    disabled={enrichMut.isPending}
                    className="h-8 w-8 text-pink-400 hover:bg-pink-500/15 disabled:opacity-40"
                    aria-label={`Lancer outreach design depuis l'audit ${a.url}`}
                    title="Lancer outreach design (audit + draft email)"
                  >
                    {enrichMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  </Button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void handleGenerateNDA(a)}
                  disabled={genNda.isPending}
                  className="h-8 w-8 text-pink-400 hover:bg-pink-500/15 disabled:opacity-40"
                  aria-label={`Générer un NDA design basé sur ${a.url}`}
                  title="Générer un NDA design depuis cet audit"
                >
                  <FileSignature size={14} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setPendingDelete(a)}
                  disabled={deleteMut.isPending && deleteMut.variables?.id === a.id}
                  className="h-8 w-8 text-muted-foreground hover:text-red-500 disabled:opacity-40"
                  aria-label={`Supprimer l'audit ${a.url}`}
                  title="Supprimer cet audit"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
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
          meta={`Score ${pendingDelete.score}/100 · ${(pendingDelete.issues?.length ?? 0)} issue(s) · ${fmtDateTime(pendingDelete.created_at)}`}
          cascades={[
            "L'audit disparaît de cette fiche Company.",
            'Si d\'autres companies utilisaient le même site (même domain), elles garderont leurs propres audits.',
            "Les analyses IA passées garderont leur contexte (pas de rollback).",
          ]}
          onConfirm={() => void confirmDelete()}
          successToast={(label) => ({
            title: 'Audit supprimé',
            description: `${label} a été retiré de l'historique de ${companyName}.`,
          })}
        />
      )}
    </div>
  );
};

// =====================================================================
// Composant principal
// =====================================================================

export const CompanyDetailPage: React.FC = () => {
  const { companyId } = useParams<{ companyId: string }>();
  const navigate = useNavigate();

  const { data: company, isLoading: isCompLoading, isError: isCompError } = useCompanyQuery(companyId);

  const { data: aggregate } = useCompanyAggregateScoreQuery(company?.id);
  const { data: prospects = [] } = useCompanyProspectsQuery(company?.id);
  // Sparkline : tentative timeseries `won` (prospects gagnés cumulés).
  const { data: wonSeries = [] } = useAnalyticsTimeseriesQuery(
    'won' as TimeseriesMetric,
    12,
  );

  const [activeTab, setActiveTab] = React.useState<'overview' | 'intelligence' | 'prospects' | 'outreach' | 'signals' | 'design'>('overview');
  const forceAutoMut = useForceAutoAnalyzeMutation();
  const enrichMut = useEnrichCompanyMutation();
  const showToast = useToast();
  // Round 89 — utilise dans le callback `onComplete` du ScrapeStrip
  // (invalide les queries Prospects + détail de la fiche après scrape).
  const queryClient = useQueryClient();
  // Round 43 — hooks appelés AVANT le guard `if (!company)` (règle des hooks) ;
  // ils tolèrent un id undefined (enabled:false) pendant le chargement.
  const intelResp = useIntelligenceForEntity('company', company?.id);
  const sigResp = useSignalsForEntity('company', company?.id);
  // Sparkline props sûre (renvoyé par la query useAnalyticsTimeseriesQuery).
  const safeSeries = React.useMemo(() => {
    if (Array.isArray(wonSeries) && wonSeries.length > 0) {
      // Pad à 12 pour le rendu visuel.
      const pad = 12 - wonSeries.length;
      const padded = pad > 0 ? new Array(pad).fill(wonSeries[0]) : [];
      return [...padded, ...wonSeries];
    }
    return [0,0,0,0,0,0,0,0,0,0,0,0];
  }, [wonSeries]);

  // Round 43 — exécute les modules recommandés par la réponse Zentara.
  // Round 66 — propage le flag `design` (audit + draft outreach auto)
  //          et ajoute une ligne dédiée au toast.
  const runModule = async (m: NeedModule) => {
    if (!company) return;
    try {
      showToast.info(`Lancement du module : ${m.label}…`);
      const r = (await enrichMut.mutateAsync({
        company_id: company.id,
        analyze: m.analyze,
        prospect: m.prospect,
        outreach: m.outreach,
        monitoring: m.monitoring,
        scrape: m.scrape,
        design: m.design,
      })) as any;
      const d = r?.data ?? r;
      const parts: string[] = [];
      if (d?.analysis?.status === 'analyzed') parts.push('analyse 7-engines ✅');
      if (d?.scrape?.scraped) parts.push(`contact scrapé (${[d.scrape.email, d.scrape.phone].filter(Boolean).join(' · ')}) ✅`);
      if (d?.prospects?.created) parts.push(`${d.prospects.created} prospect décideur créé ✅`);
      if (d?.outreach?.drafted) parts.push(`${d.outreach.drafted} emails pré-draftés ✅`);
      if (d?.monitoring?.tick) parts.push('monitoring activé ✅');
      // Round 66 — design audit + outreach.
      if (d?.design) {
        const sc = Number(d.design.score ?? 0);
        parts.push(`audit design ${sc}/100 (${d.design.issues_count ?? 0} issues) ✅`);
        if (d?.design_outreach?.drafted) {
          const sub = d.design_outreach.emails?.[0]?.subject ?? 'sans sujet';
          parts.push(`outreach design drafte (${truncate(sub, 60)}) ✉️`);
        } else if (d?.design_outreach?.skipped) {
          parts.push(`outreach design : ${skipLabel(d.design_outreach.skipped)}`);
        }
      }
      showToast.success(parts.length ? `${m.label} — ${parts.join(' · ')}` : `${m.label} terminé.`, 5000);
    } catch (e) {
      showToast.error(`Module ${m.label} échoué : ${(e as Error).message}`, 5000);
    }
  };

  // Round 66 — helpers pour le toast récapitulatif du module design.
  function truncate(s: string, n: number): string {
    return s.length <= n ? s : s.slice(0, n - 1) + '…';
  }
  function skipLabel(reason: string): string {
    if (reason === 'already_drafted_today') return 'déjà drafte aujourd\'hui';
    if (reason === 'no_email') return 'email de contact manquant';
    if (reason === 'score_above_threshold') return 'site OK (score ≥ 70)';
    return reason;
  }
  if (isCompLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground animate-pulse">Chargement de la fiche entreprise...</p>
      </div>
    );
  }

  if (isCompError || (!company && !isCompLoading)) {
    return (
      <div className="p-6 md:p-10 max-w-5xl mx-auto">
        <Button onClick={() => navigate('/companies')} variant="ghost" className="mb-6">
          <ArrowLeft size={14} className="mr-2" /> Retour aux entreprises
        </Button>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center">
          <Building2 size={36} className="mx-auto text-muted-foreground opacity-40 mb-3" />
          <h2 className="text-xl font-black mb-2">Entreprise introuvable</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {isCompError ? 'Une erreur est survenue lors du chargement.' : `L'identifiant ${companyId} ne correspond à aucune fiche.`}
          </p>
          <Link to="/companies" className="text-primary text-sm font-bold hover:underline">← Retour à la liste</Link>
        </div>
      </div>
    );
  }

  // Narrow type after loading guard
  if (!company) return null;

  // Besoins détectés (pilotés par les problèmes réels de la fiche).
  const intelSummary = (intelResp.data?.summary ?? null) as string | null;
  const signalCount = (sigResp.data ?? []).length;

  // Besoins détectés (pilotés par les problèmes réels de la fiche)
  const needs: Array<{
    title: string;
    severity: 'high' | 'medium' | 'low';
    detection: string;
    answer: string;
    /** Round 43 — module(s) Zentara à lancer pour répondre à ce besoin. */
    modules?: NeedModule;
  }> = [];
  const notesText = safeString(company.notes).toLowerCase();

  // --- Gaps « site » (Round 117 — besoins pilotés par les vrais problèmes) ---
  if (!company.website) {
    needs.push({
      title: "Site web non identifié",
      severity: "high",
      detection: "Champ `website` vide — impossible de scraper ou de vérifier l'entreprise.",
      answer: "Lancer une recherche Google Maps (page Maps Leads) pour retrouver le site officiel, puis scraper la fiche contact.",
      modules: { label: "Recherche Maps + scrape", analyze: true, scrape: true },
    });
  }
  if (!company.address && !company.city && !company.country) {
    needs.push({
      title: "Localisation incomplète",
      severity: "medium",
      detection: "Adresse / ville / pays absents de la fiche.",
      answer: "Enrichir via Google Maps : adresse, ville, pays et lien Maps (prospection locale + géolocalisation).",
      modules: { label: "Enrichir via Maps", analyze: true },
    });
  }
  if (!intelSummary) {
    needs.push({
      title: "Analyse IA stratégique absente",
      severity: "high",
      detection: "Aucun résumé d'intelligence disponible pour cette entreprise.",
      answer: "Lancer le pipeline 7-engines (score, insights, risques, recommandations, décideurs).",
      modules: { label: "Lancer l'analyse 7-engines", analyze: true },
    });
  }
  if (!company.sector && !company.industry) {
    needs.push({
      title: "Secteur / industrie non qualifié",
      severity: "medium",
      detection: "Aucun secteur ni industrie renseignés — classification impossible.",
      answer: "Market Intelligence : classifier l'entreprise, identifier ses concurrents et son ICP.",
      modules: { label: "Analyser + qualifier", analyze: true },
    });
  }
  if (!company.google_maps_url) {
    needs.push({
      title: "Lien Google Maps manquant",
      severity: "low",
      detection: "`google_maps_url` absent de la fiche.",
      answer: "Ajouter le lien Maps pour la géolocalisation et le suivi local.",
    });
  }
  if (!company.social_profiles) {
    needs.push({
      title: "Présence sociale non capturée",
      severity: "low",
      detection: "Aucun profil social (LinkedIn, Twitter…) enregistré.",
      answer: "Enrichir via le site officiel pour récupérer les profils sociaux et mieux cibler l'outreach.",
      modules: { label: "Scraper + enrichir", analyze: true, scrape: true },
    });
  }
  if (!company.phone) {
    needs.push({
      title: 'Numéro de téléphone principal non identifié',
      severity: 'medium',
      detection: 'Champ `phone` vide ou absent de la fiche.',
      answer: 'Scraper le site officiel (page contact) pour récupérer le standard / standardiste, puis prospection Maps si absent.',
      modules: { label: 'Scraper le site (tél + email)', analyze: true, scrape: true },
    });
  }
  if (!company.email) {
    needs.push({
      title: 'Email décisionnel non capturé',
      severity: 'high',
      detection: 'Aucun email direct ou de contact général.',
      answer: 'Scraper le site officiel pour capturer l\'email de contact, puis Sales Intelligence pour les décideurs.',
      modules: { label: 'Scraper le site (tél + email)', analyze: true, scrape: true },
    });
  }
  if ((company.score ?? 0) >= 70 && (prospects.length === 0)) {
    needs.push({
      title: 'Entreprise à fort potentiel sans prospect rattaché',
      severity: 'high',
      detection: `Score ${company.score}/100, aucun contact en base — opportunité d'outreach non exploitable.`,
      answer: "Scraper le site (tél/email réels) + Sales Intelligence + Outreach : profils décideurs, 3 emails pré-draftés avec les vrais coordonnées.",
      modules: { label: 'Générer décideurs + 3 emails', analyze: true, scrape: true, prospect: true, outreach: true },
    });
  }
  if (signalCount === 0) {
    needs.push({
      title: 'Veille externe absente',
      severity: 'medium',
      detection: 'Aucun signal public (newsroom, hiring, prix) capté pour cette entreprise.',
      answer: 'Module Monitoring : activation du watcher spécifique (sources publiques + LinkedIn + Google News) pour capter les weak signals.',
      // scrape:false — ce bouton n'a pas vocation à scraper le site
      // (le scraping reste réservé aux besoins contact / décideurs).
      modules: { label: 'Activer le monitoring', analyze: true, monitoring: true, scrape: false },
    });
  }
  if (!notesText.includes('prospect')) {
    needs.push({
      title: 'Profil stratégique non structuré',
      severity: 'low',
      detection: "Pas de session de prospection Zentara enregistrée dans `notes`.",
      answer: 'Module Prospecting : analyser le secteur + l\'entreprise, produire un ICP, profiler 3 décideurs et outline de cold email.',
    });
  }
  if ((company.score ?? 0) < 40) {
    needs.push({
      title: 'Score insuffisant — profil à enrichir',
      severity: 'medium',
      detection: `Score agrégé ${company.score ?? 0}/100 — couverture partielle de cette fiche.`,
      answer: 'Forcer une analyse IA (7-engines) pour fairemonter chaque sous-score : pertinence, opportunité, intention, activité, confiance.',
    });
  }
  // Round 66 — design outreach : déclenche un audit design + draft email
  // si le score est inférieur au seuil ET qu'un site web est connu. Cette
  // carte est volontairement mise en avant quand la company a une adresse
  // email connue (sinon on propose d'abord le scraping du site).
  if (company.website && (company.score ?? 0) >= 40) {
    needs.push({
      title: company.email
        ? 'Audit design + outreach prêt à envoyer'
        : 'Audit design (refonte probable) sans email de contact',
      severity: company.email ? 'high' : 'medium',
      detection: company.email
        ? `Site web ${company.website} identifié. Audit design disponible → si score < 70, Zentara peut auto-drafter un email de proposition de refonte.`
        : `Site ${company.website} connu mais email de contact manquant. Audit design pourrait alimenter un outreach automatisé, mais sans email rien ne part.`,
      answer: company.email
        ? 'Module Design : lance un audit structurel (catégories : structure, a11y, SEO, perf, UX). Si score < 70, un brouillon d\'email de proposition de refonte est créé automatiquement avec les vrais coordonnées.'
        : 'Scraper d\'abord le site pour récupérer un email de contact, puis relancer l\'audit design.',
      modules: { label: 'Audit + outreach design', design: true, analyze: false, scrape: !company.email, outreach: false, prospect: false, monitoring: false },
    });
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 pb-32">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Button onClick={() => navigate('/companies')} variant="ghost" size="sm">
          <ArrowLeft size={14} className="mr-2" /> Liste des entreprises
        </Button>
        <div className="flex items-center gap-2">
          <Button onClick={() => forceAutoMut.mutate({ company_id: company.id })} disabled={forceAutoMut.isPending} variant="outline" size="sm" className="border-primary/40">
            {forceAutoMut.isPending ? <Loader2 size={12} className="mr-1 animate-spin" /> : <Sparkles size={12} className="mr-1" />}
            Force re-analyse IA
          </Button>
        </div>
      </div>

      {/* Hero */}
      <HeroCard company={company} aggregate={aggregate ? { score: aggregate.score, tier: aggregate.tier } : null} series={safeSeries as number[]} />

      {/* Contact strip */}
      <ContactStrip company={company} />

      {/* Round 92 — Toggle policy auto-scrape (Off / Always / When hot ≥70).
          Affiché au-dessus du ScrapeStrip pour que la décision
          "j'active l'auto-scrape ou pas" soit prise AVANT le bouton
          de scrape manuel. */}
      <AutoScrapeToggle
        companyId={company.id}
        initialPolicy={company.auto_scrape ?? 'off'}
      />

      {/* Round 89 — Bandeau "Scrape site web" : lance le bot qui visite le
          site de l'entreprise, extrait les personnes (équipe, dirigeants,
          contacts publics) et crée automatiquement des prospects. */}
      <ScrapeStrip
        companyId={company.id}
        website={company.website}
        onComplete={() => {
          // Invalide les queries Prospects + Company pour rafraîchir la fiche.
          queryClient.invalidateQueries({ queryKey: ['company', 'prospects', company.id] });
          queryClient.invalidateQueries({ queryKey: ['company', 'detail', company.id] });
          queryClient.invalidateQueries({ queryKey: ['companies', 'autoscrape', company.id] });
        }}
      />

      {/* Tabs */}
      <div className="rounded-2xl border border-border/60 bg-card/40 p-1 inline-flex gap-1 flex-wrap">
        {[
          { id: 'overview', label: 'Overview', icon: <Eye size={12} /> },
          { id: 'intelligence', label: 'Intelligence IA', icon: <Brain size={12} /> },
          { id: 'prospects', label: `Prospects (${prospects.length})`, icon: <Users size={12} /> },
          { id: 'outreach', label: 'Outreach', icon: <Mail size={12} /> },
          { id: 'signals', label: `Signaux (${signalCount})`, icon: <Activity size={12} /> },
          { id: 'design', label: 'Design Audit', icon: <Palette size={12} /> },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id as typeof activeTab)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-xs font-bold uppercase tracking-widest inline-flex items-center gap-1.5 transition-all',
              activeTab === t.id
                ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/40',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* KPI row — état global de la fiche en un coup d'œil */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile
              icon={<Zap size={14} />}
              label="Score Zentara"
              value={`${aggregate?.score ?? company.score ?? 0}`}
              suffix="/100"
              tone={(aggregate?.score ?? company.score ?? 0) >= 70 ? 'hot' : (aggregate?.score ?? company.score ?? 0) >= 40 ? 'warm' : 'cold'}
            />
            <StatTile
              icon={<Brain size={14} />}
              label="Opportunité IA"
              value={`${intelResp.data?.opportunity_score ?? company.score ?? 0}`}
              suffix="/100"
              tone={(intelResp.data?.opportunity_score ?? 0) >= 70 ? 'hot' : (intelResp.data?.opportunity_score ?? 0) >= 40 ? 'warm' : 'cold'}
            />
            <StatTile
              icon={<Users size={14} />}
              label="Prospects rattachés"
              value={`${prospects.length}`}
              tone={prospects.length > 0 ? 'warm' : 'cold'}
            />
            <StatTile
              icon={<Activity size={14} />}
              label="Signaux monitoring"
              value={`${signalCount}`}
              tone={signalCount > 0 ? 'warm' : 'cold'}
            />
          </div>

          {/* Estimation produit & impact (prix + % impact + ROI) — quand l'IA a analysé */}
          {intelResp.data?.product_estimate?.product ? (
            <OverviewProductEstimate intel={intelResp.data} />
          ) : null}

          {/* Besoins détectés — pilotés par les problèmes réels de la fiche */}
          <NeedsDetected needs={needs} enrichPending={enrichMut.isPending} onRunModule={runModule} />

          {/* Notes / contexte brut */}
          {company.notes && (
            <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Notes internes</div>
              <pre className="text-xs text-foreground leading-relaxed whitespace-pre-wrap font-sans">{company.notes}</pre>
            </div>
          )}
        </div>
      )}
      {activeTab === 'intelligence' && (
        <IntelligenceTab
          companyId={company.id}
          company={{ name: company.name, email: company.email, category: company.sector || company.industry }}
        />
      )}
      {activeTab === 'prospects' && <ProspectsTab companyId={company.id} />}
      {activeTab === 'outreach' && <OutreachTab companyId={company.id} />}
      {activeTab === 'signals' && <SignalsTab companyId={company.id} />}
      {activeTab === 'design' && (
        <DesignAuditTab
          companyId={company.id}
          companyName={company.name}
          website={company.website}
        />
      )}
    </div>
  );
};

// =====================================================================
// Round 89 — ScrapeStrip (bouton "Scrape le site web + créer des prospects")
// =====================================================================
interface ScrapeContactsApiResponse {
  url: string;
  scraped_urls: string[];
  phone: string | null;
  email: string | null;
  contacts: Array<{
    first_name: string | null;
    last_name: string | null;
    role: string | null;
    email: string | null;
    phone: string | null;
    source_url: string;
    confidence: number;
    /** Round 91 — breakdown détaillé calculé backend. */
    quality?: {
      email_validity: number;
      phone_reachability: number;
      decision_maker: number;
      overall: number;
    };
    /** Round 90 — dom (regex/DOM) ou llm (Mistral fallback). */
    extractor?: 'dom' | 'llm';
  }>;
  created_prospect_ids: string[];
  created_count: number;
  skipped_duplicates: Array<{ email: string | null; reason: string }>;
  persisted_company_fields: string[];
  note: string;
}

const ScrapeStrip: React.FC<{
  companyId: string;
  website: string | null | undefined;
  onComplete: () => void;
}> = ({ companyId, website, onComplete }) => {
  const [scrap, setScrap] = React.useState<ScrapeContactsApiResponse | null>(null);
  const showToast = useToast();
  const scrapMut = useMutation<ScrapeContactsApiResponse, Error, void>({
    mutationFn: async () => {
      const api = getApiClient();
      return api.post<ScrapeContactsApiResponse>(
        ENDPOINTS.companyScrapeContacts(companyId),
        { create_prospects: true, persist: true },
        { timeoutMs: 60_000, retries: 0 },
      );
    },
    onSuccess: (data) => {
      setScrap(data);
      const created = data.created_count ?? 0;
      if (created > 0) {
        showToast.success(
          `✅ ${created} prospect${created > 1 ? 's' : ''} créé${created > 1 ? 's' : ''} depuis ${(() => {
            try { return new URL(data.url).hostname.replace(/^www\./, ''); } catch { return data.url; }
          })()} (${data.contacts.length} contact${data.contacts.length > 1 ? 's' : ''} détecté${data.contacts.length > 1 ? 's' : ''})`,
          5000,
        );
      } else if (data.contacts.length > 0) {
        showToast.info(`Aucun nouveau prospect créé — ${data.skipped_duplicates.length} doublon${data.skipped_duplicates.length > 1 ? 's' : ''}.`, 4000);
      } else {
        // L'API toast n'expose pas `warning` → on retombe sur `error`
        // (visuellement équivalent, durée 5 s) pour ces cas « rien trouvé ».
        showToast.error(`Rien trouvé sur ${website ?? 'ce site'} — ${data.note}`, 5000);
      }
      onComplete();
    },
    onError: (e) => {
      const m = e instanceof ZentaraApiError
        ? `${e.code} — ${e.message}`
        : (e.message ?? 'Erreur');
      showToast.error(`Échec scraping : ${m}`, 6000);
    },
  });

  const hasWebsite = !!(website && /^https?:\/\//i.test(String(website).trim()));
  const hasResults = !!scrap;

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent p-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shrink-0 shadow-lg shadow-violet-500/30">
          <ScanSearch size={18} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-sm font-black tracking-tight">Scraping site web → extraction contacts</h3>
            <span className="text-[10px] uppercase tracking-widest font-bold px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-300">
              Round 89
            </span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Le bot visite le site{website ? ` (${website})` : ''}, extrait les personnes de l'équipe / dirigeants / contacts publics
            (via JSON-LD <code className="text-[10px]">Person</code>, vCard, mailto: link + team blocks heuristique), puis crée
            automatiquement un prospect par contact détecté.
          </p>

          {!hasWebsite && (
            <p className="text-xs text-amber-500 mt-2 font-bold">
              ⚠ Aucun site web renseigné sur cette fiche — ajoute une URL d'abord.
            </p>
          )}

          {hasResults && scrap && (
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
              <div className="rounded-lg border border-border/40 bg-card/40 px-2.5 py-1.5">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Contacts détectés</div>
                <div className="text-base font-black text-violet-500">{scrap.contacts.length}</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-card/40 px-2.5 py-1.5">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Prospects créés</div>
                <div className="text-base font-black text-emerald-500">{scrap.created_count}</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-card/40 px-2.5 py-1.5">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Téléphone</div>
                <div className="text-xs font-bold truncate">{scrap.phone ?? '—'}</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-card/40 px-2.5 py-1.5">
                <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Email</div>
                <div className="text-xs font-bold truncate">{scrap.email ?? '—'}</div>
              </div>
            </div>
          )}

          {hasResults && scrap && scrap.contacts.length > 0 && (
            <details className="mt-3">
              <summary className="text-[11px] uppercase tracking-widest font-black text-muted-foreground hover:text-foreground cursor-pointer">
                Voir les {scrap.contacts.length} contact{scrap.contacts.length > 1 ? 's' : ''} détecté{scrap.contacts.length > 1 ? 's' : ''}
              </summary>
              <ul className="mt-2 space-y-1.5 text-[11px]">
                {scrap.contacts.slice(0, 12).map((c, i) => {
                  const q = c.quality;
                  const overall = q?.overall ?? c.confidence ?? 0;
                  // Round 91 — bucket UI pour couleur du badge d'overall.
                  const tier =
                    overall >= 0.7 ? 'high' : overall >= 0.4 ? 'mid' : 'low';
                  const tierBg =
                    tier === 'high'
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : tier === 'mid'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-slate-500/15 text-slate-500 border-slate-500/30';
                  // Sub-scores en mini-pills (icône + %)
                  const ev = Math.round((q?.email_validity ?? 0) * 100);
                  const ph = Math.round((q?.phone_reachability ?? 0) * 100);
                  const dm = Math.round((q?.decision_maker ?? 0) * 100);
                  const sub = (val: number, label: string) => {
                    const cls =
                      val >= 70
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : val >= 40
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : 'bg-slate-500/10 text-slate-500 border-slate-500/20';
                    return (
                      <span
                        key={label}
                        title={`${label} score`}
                        className={`inline-flex items-center gap-0.5 rounded border px-1 py-0 text-[8.5px] font-black uppercase tracking-wider ${cls}`}
                      >
                        <span className="opacity-70">{label}</span>
                        <span>{val}%</span>
                      </span>
                    );
                  };
                  return (
                    <li
                      key={i}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md border bg-card/30 ${
                        overall < 0.5
                          ? 'border-slate-500/30 grayscale opacity-60'
                          : 'border-border/20'
                      }`}
                    >
                      <span
                        className={`h-6 w-6 rounded-full border inline-flex items-center justify-center text-[9px] font-black shrink-0 ${tierBg}`}
                        title={`Score global : ${Math.round(overall * 100)}%`}
                      >
                        {Math.round(overall * 100)}
                      </span>
                      <span className="font-bold">
                        {c.first_name ?? '?'} {c.last_name ?? ''}
                      </span>
                      {c.role && (
                        <span className="text-muted-foreground italic hidden sm:inline truncate max-w-[160px]">
                          — {c.role}
                        </span>
                      )}
                      <span className="ml-auto inline-flex items-center gap-1 shrink-0">
                        {sub(ev, 'Mail')}
                        {sub(ph, 'Tel')}
                        {sub(dm, 'C-Level')}
                      </span>
                      {c.email && (
                        <span
                          className="text-violet-500 truncate max-w-[140px] hidden md:inline ml-2"
                          title={c.email}
                        >
                          {c.email}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => scrapMut.mutate()}
          disabled={!hasWebsite || scrapMut.isPending}
          className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white font-bold shadow-lg shadow-violet-500/30 disabled:opacity-40"
          title={hasWebsite ? 'Scrape le site et crée les prospects' : 'Pas de site web sur la fiche'}
        >
          {scrapMut.isPending ? (
            <Loader2 size={14} className="mr-2 animate-spin" />
          ) : (
            <ScanSearch size={14} className="mr-2" />
          )}
          {scrapMut.isPending ? 'Scraping…' : 'Lancer le scraping'}
        </Button>
      </div>
      {hasResults && scrap?.note && (
        <p className="mt-2 text-[10px] text-muted-foreground italic pl-13">{scrap.note}</p>
      )}
    </div>
  );
};

export default CompanyDetailPage;
