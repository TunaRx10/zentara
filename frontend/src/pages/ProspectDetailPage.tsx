/**
 * ProspectDetailPage — Round 117.
 *
 * Page dédiée à un prospect (route `/prospects/:id`). Affiche :
 *
 *   1. Hero : avatar + nom + rôle + score + tier + status + tags.
 *   2. Coordonnées : email, téléphone, secteur, ville/pays, site, Maps.
 *   3. Qualité/confiance : barres email/téléphone/rôle/global (Round 91).
 *   4. Intelligence : bloc AI Strategic Analysis (summary + insights +
 *      risks + recommendations) + bouton "Relancer l'analyse".
 *   5. Actions : email, appel, suppression, retour liste.
 *
 * Ouverte en cliquant une ligne de ProspectsPage (ou via un lien direct).
 */
import React from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Mail,
  Phone,
  Send,
  MapPin,
  Building2,
  Globe,
  ExternalLink,
  Trash2,
  Zap,
  Loader2,
  CheckCircle2,
  Circle,
  Sparkles,
  User,
  Tag,
  ShieldCheck,
  BadgeCheck,
  AlertTriangle,
  TrendingDown,
  ChevronDown,
  Eye,
} from 'lucide-react';
import { cn, parseQuality, safeString } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { AnalysisView } from '@/components/AnalysisView';
import { useToast } from '@/contexts/ToastProvider';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProspectsQuery, useIntelligenceForEntity } from '@/hooks/useBackendData';
import { useAnalyzeMutation, useDeleteProspectMutation } from '@/hooks/useEntityActions';
import { getApiClient } from '@/services/api/client';
import { TierPill, ScoreCell, getTier } from '@/components/LeadTier';
import { buildEmailHtml } from '@/lib/email-template';
import type { Prospect } from '@/types';

interface ProspectAnalysisLocal {
  problems: Array<{ title: string; detail: string; evidence: string; revenue_lost_hint: string }>;
  revenue_lost_summary: string;
  suggested_subject: string;
  suggested_sections: { problem: string; impact: string; solution: string; cta: string };
  source: 'ai' | 'heuristic';
}

function tagsOf(p: Prospect | null | undefined): string[] {
  if (!p || !p.tags) return [];
  if (Array.isArray(p.tags)) return p.tags;
  if (typeof p.tags === 'string') {
    try {
      const parsed = JSON.parse(p.tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function QualityBar({
  label,
  value,
}: {
  label: string;
  value: number;
}): React.ReactElement {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const color =
    pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary/60 overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ProspectDetailPage(): React.ReactElement {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: prospects = [], isLoading, refetch: refetchProspects } = useProspectsQuery();
  const prospect = React.useMemo(
    () => prospects.find((p) => p.id === id) ?? null,
    [prospects, id],
  );

  const intelligence = useIntelligenceForEntity('prospect', id);
  const analyzeMut = useAnalyzeMutation();
  const deleteMut = useDeleteProspectMutation();
  const [pendingDelete, setPendingDelete] = React.useState(false);

  // Composer email personnalisé → envoi via Google Apps Script (Gmail).
  const [emailOpen, setEmailOpen] = React.useState(false);
  const [emailSubject, setEmailSubject] = React.useState('');
  const [emailBody, setEmailBody] = React.useState('');
  const [emailBusy, setEmailBusy] = React.useState(false);
  // CTA par défaut : calendrier de rendez-vous configuré dans Réglages → Emails & CTA.
  const [emailCtaUrl, setEmailCtaUrl] = React.useState<string>('');
  const [emailCtaLabel, setEmailCtaLabel] = React.useState<string>('Planifier un échange');
  // Pré-remplissage depuis l'analyse IA : HTML complet + destinataire + preview.
  const [emailRecipientOverride, setEmailRecipientOverride] = React.useState<string | null>(null);
  const [emailPreviewHtml, setEmailPreviewHtml] = React.useState<string>('');
  const [emailShowPreview, setEmailShowPreview] = React.useState(false);
  // Round 132 — analyse prospect (problèmes + revenus perdus).
  const [emailAnalysis, setEmailAnalysis] = React.useState<ProspectAnalysisLocal | null>(null);
  const [emailAnalyzing, setEmailAnalyzing] = React.useState(false);
  const [emailShowAnalysis, setEmailShowAnalysis] = React.useState(false);

  const handleAnalyze = async () => {
    if (!prospect) return;
    try {
      await analyzeMut.mutateAsync({
        entityType: 'prospect',
        entityId: prospect.id,
        first_name: prospect.first_name,
        last_name: prospect.last_name,
        company_name: prospect.company_name ?? undefined,
      });
      toast.success(`Analyse relancée pour ${prospect.first_name}.`);
    } catch (e) {
      toast.error(`Analyse impossible : ${(e as Error).message}`);
    }
  };

  const handleDelete = async () => {
    if (!prospect) return;
    // Le dialog tire son propre toast de succès/échec ; on navigue seulement.
    await deleteMut.mutateAsync(prospect.id);
    navigate('/prospects', { replace: true });
  };

  /** Enrichissement email automatique : permutations + vérification MX (domaine de la company). */
  const [enriching, setEnriching] = React.useState(false);
  const handleEnrichEmail = async () => {
    if (!prospect) return;
    setEnriching(true);
    try {
      const api = getApiClient();
      const r = await api.post<{
        email: string | null;
        pattern?: string | null;
        score?: number;
        has_mx?: boolean;
        updated?: boolean;
        reason?: string | null;
      }>(`/prospects/${prospect.id}/enrich-email`, {});
      if (r.updated && r.email) {
        toast.success(`Email trouvé : ${r.email} (pattern ${r.pattern || '?'}, confiance ${r.score}%)`);
        await refetchProspects();
      } else {
        toast.error(`Aucun email fiable : ${r.reason || 'domaine sans MX ou données insuffisantes'}`);
      }
    } catch (e) {
      toast.error(`Enrichissement impossible : ${(e as Error).message}`);
    } finally {
      setEnriching(false);
    }
  };

  const openEmailComposer = () => {
    if (!prospect) return;
    const company = prospect.company_name || 'votre entreprise';
    const name = prospect.first_name || 'Bonjour';
    setEmailSubject(`${name}, un mot à propos de ${company}`);
    setEmailBody(
      `Bonjour ${prospect.first_name ?? ''},\n\n` +
        `Je me permets de vous écrire car ${company} nous semble pertinent pour Zentara (prospection & intelligence stratégique automatisées).\n\n` +
        `Auriez-vous 10 minutes cette semaine pour en discuter ?\n\n` +
        `Bien cordialement,`,
    );
    // Charge le CTA calendrier par défaut depuis Réglages → Emails & CTA.
    setEmailCtaUrl('');
    (async () => {
      try {
        const api = getApiClient();
        const cfg = await api.get<{ cta_calendar_url: string | null }>('/integrations/outreach');
        if (cfg?.cta_calendar_url) {
          setEmailCtaUrl(cfg.cta_calendar_url.trim());
          setEmailCtaLabel('Planifier un échange');
        }
      } catch {
        /* silencieux */
      }
    })();
    setEmailOpen(true);
  };

  /** Analyse le prospect (problèmes + revenus) et pré-remplit le mail structuré. */
  const handleAnalyzeProspect = async () => {
    if (!prospect) return;
    setEmailAnalyzing(true);
    try {
      const api = getApiClient();
      const a = await api.post<ProspectAnalysisLocal>(`/outreach/analyze-prospect/${prospect.id}`, {});
      setEmailAnalysis(a);
      setEmailShowAnalysis(true);
      if (a.suggested_subject) setEmailSubject(a.suggested_subject);
      const s = a.suggested_sections;
      const structured = [s.problem, s.impact, s.solution, s.cta].filter(Boolean).join('\n\n');
      if (structured) setEmailBody(structured);
      toast.success(`Analyse ${a.source === 'ai' ? 'IA' : 'heuristique'} prête — mail structuré généré.`);
    } catch (e) {
      toast.error(`Analyse impossible : ${(e as Error).message}`);
    } finally {
      setEmailAnalyzing(false);
    }
  };

  const handleSendEmail = async () => {
    if (!prospect?.email) return;
    setEmailBusy(true);
    try {
      const api = getApiClient();
      const { html } = buildEmailHtml({
        companyName: prospect.company_name || 'votre entreprise',
        category: prospect.sector || null,
        body: emailBody,
        recipientName: prospect.first_name || null,
        signature: 'L’équipe Zentara — Enterprise Intelligence',
        cta: emailCtaUrl ? { label: emailCtaLabel, url: emailCtaUrl } : null,
      });
      const r = await api.post<{ ok: boolean; error?: string | null; http_status?: number | null }>(
        '/integrations/sheets/send-email',
        {
          to: prospect.email,
          subject: emailSubject.trim(),
          html,
          prospect_id: prospect.id,
        },
      );
      if (r.ok) {
        toast.success(`Email envoyé à ${prospect.email} via Apps Script (Gmail).`);
        setEmailOpen(false);
      } else {
        toast.error(`Envoi refusé par l'Apps Script${r.error ? ` : ${r.error}` : ''}`);
      }
    } catch (e) {
      toast.error(`Envoi impossible : ${(e as Error).message}`);
    } finally {
      setEmailBusy(false);
    }
  };

  // Not found / loading states
  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-6 text-center text-muted-foreground">
        <Loader2 className="inline animate-spin mr-2" size={16} />
        Chargement du prospect…
      </div>
    );
  }

  if (!prospect) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="rounded-2xl border border-border/60 bg-card/40 p-8 text-center space-y-3">
          <p className="text-sm font-bold">Prospect introuvable</p>
          <p className="text-xs text-muted-foreground">
            Ce prospect n'existe plus ou a été supprimé.
          </p>
          <Button asChild variant="outline" className="border-primary/40">
            <Link to="/prospects">
              <ArrowLeft className="mr-2 h-4 w-4" /> Retour aux prospects
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const tier = getTier(prospect.score);
  const quality = parseQuality(prospect.quality);
  const tags = tagsOf(prospect);
  const status = prospect.status ?? 'lead';
  const intel = intelligence.data;
  const isAnalyzing = analyzeMut.isPending;

  return (
    <div className="max-w-3xl mx-auto space-y-4 p-4 sm:p-6">
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate('/prospects')}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-primary transition-colors"
      >
        <ArrowLeft size={14} /> Prospects
      </button>

      {/* Hero */}
      <div className="rounded-2xl border border-border/60 bg-card/50 overflow-hidden">
        <div className="p-4 sm:p-6">
          <div className="flex items-start gap-4">
            <div
              className={cn(
                'w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-black shrink-0',
                tier === 'hot'
                  ? 'bg-emerald-500/15 text-emerald-500'
                  : tier === 'warm'
                    ? 'bg-amber-500/15 text-amber-500'
                    : 'bg-slate-500/15 text-slate-400',
              )}
            >
              {`${prospect.first_name?.[0] ?? '?'}${prospect.last_name?.[0] ?? ''}`.toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight truncate">
                {prospect.first_name} {prospect.last_name}
              </h1>
              <p className="text-sm text-muted-foreground truncate">
                {prospect.role ?? 'Contact'}
                {prospect.company_name ? (
                  <>
                    {' · '}
                    <Link
                      to={prospect.company_id ? `/companies/${prospect.company_id}` : '/companies'}
                      className="text-primary hover:underline"
                    >
                      {prospect.company_name}
                    </Link>
                  </>
                ) : null}
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <ScoreCell score={prospect.score ?? 0} />
                <TierPill tier={tier} />
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] h-5',
                    status === 'qualified' ? 'border-emerald-500/40 text-emerald-500' : 'border-border',
                  )}
                >
                  {status === 'qualified' ? (
                    <CheckCircle2 size={11} className="mr-1" />
                  ) : (
                    <Circle size={11} className="mr-1" />
                  )}
                  <span className="capitalize">{status}</span>
                </Badge>
              </div>
            </div>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mt-4 pt-4 border-t border-border/40">
              <Tag size={13} className="text-muted-foreground shrink-0" />
              {tags.map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                  className="text-[10px] h-5 border-border/60 text-muted-foreground"
                >
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-t border-border/40 bg-secondary/20">
          {prospect.email && (
            <Button asChild size="sm" className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <a href={`mailto:${prospect.email}`}>
                <Mail className="mr-2 h-4 w-4" /> Email
              </a>
            </Button>
          )}
          {prospect.email && (
            <Button size="sm" variant="outline" onClick={openEmailComposer} className="border-border/60">
              <Send className="mr-2 h-4 w-4" /> Envoyer via Gmail
            </Button>
          )}
          {prospect.phone && (
            <Button asChild size="sm" variant="outline" className="border-border/60">
              <a href={`tel:${prospect.phone}`}>
                <Phone className="mr-2 h-4 w-4" /> Appeler
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={handleEnrichEmail}
            disabled={enriching}
            className="border-accent/40 text-accent hover:bg-accent/10"
            title="Devine prénom.nom@domaine de l'entreprise et vérifie le MX avant d'enregistrer"
          >
            {enriching ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Sparkles size={14} className="mr-2" />}
            {enriching ? 'Recherche…' : prospect.email ? 'Re-vérifier l’email' : 'Enrichir l’email'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="border-accent/40 text-accent hover:bg-accent/10"
          >
            {isAnalyzing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-2 h-4 w-4" />
            )}
            {intel ? 'Relancer l\u2019analyse' : 'Analyser'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setPendingDelete(true)}
            className="ml-auto text-red-500 hover:bg-red-500/10"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Coordonnées */}
      <div className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-6">
        <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground mb-3">
          Coordonnées
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Mail size={15} className="text-muted-foreground shrink-0" />
            {prospect.email ? (
              <a href={`mailto:${prospect.email}`} className="text-primary hover:underline break-all">
                {prospect.email}
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Phone size={15} className="text-muted-foreground shrink-0" />
            {prospect.phone ? (
              <a href={`tel:${prospect.phone}`} className="hover:underline">
                {prospect.phone}
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Building2 size={15} className="text-muted-foreground shrink-0" />
            <span>{prospect.sector ?? '—'}</span>
          </div>
          <div className="flex items-center gap-2">
            <MapPin size={15} className="text-muted-foreground shrink-0" />
            <span>
              {[prospect.city, prospect.country].filter(Boolean).join(', ') || '—'}
            </span>
          </div>
          {prospect.website && (
            <div className="flex items-center gap-2 sm:col-span-2">
              <Globe size={15} className="text-muted-foreground shrink-0" />
              <a
                href={prospect.website}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline break-all"
              >
                {prospect.website}
              </a>
              <ExternalLink size={12} className="text-muted-foreground" />
            </div>
          )}
          {prospect.google_maps_url && (
            <div className="flex items-center gap-2 sm:col-span-2">
              <MapPin size={15} className="text-muted-foreground shrink-0" />
              <a
                href={prospect.google_maps_url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline break-all"
              >
                Voir sur Google Maps
              </a>
            </div>
          )}
        </div>
      </div>

      {/* Qualité / confiance */}
      {quality.overall > 0 && (
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-6">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={15} className="text-emerald-500" />
            <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Confiance du contact
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            <QualityBar label="Email valide" value={quality.email_validity} />
            <QualityBar label="Téléphone joignable" value={quality.phone_reachability} />
            <QualityBar label="Rôle décisionnaire" value={quality.decision_maker} />
            <QualityBar label="Global" value={quality.overall} />
          </div>
        </div>
      )}

      {/* Intelligence */}
      <div className="rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-6">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles size={15} className="text-accent" />
          <h2 className="text-xs font-black uppercase tracking-widest text-muted-foreground">
            Intelligence
          </h2>
          {isAnalyzing && <Loader2 size={13} className="animate-spin text-accent ml-auto" />}
        </div>

        {intel ? (
          <AnalysisView
            intel={intel}
            contact={{ name: `${prospect.first_name} ${prospect.last_name}`.trim() || null, email: prospect.email, category: prospect.sector }}
            onSendEmail={(subject, body, meta) => {
              if (subject) setEmailSubject(subject);
              if (body) setEmailBody(body);
              if (meta?.ctaUrl) {
                setEmailCtaUrl(meta.ctaUrl);
                setEmailCtaLabel('Planifier un échange');
              }
              if (meta?.recipient) setEmailRecipientOverride(meta.recipient);
              setEmailPreviewHtml(meta?.html || '');
              setEmailShowPreview(!!meta?.html);
              setEmailOpen(true);
            }}
          />
        ) : (
          <div className="text-center py-6 space-y-2">
            <User size={20} className="mx-auto text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">
              Aucune analyse IA pour ce prospect. Lance une analyse pour générer
              un score d'opportunité, des insights et des recommandations.
            </p>
          </div>
        )}
      </div>

      <DeleteConfirmDialog
        open={pendingDelete}
        onOpenChange={setPendingDelete}
        itemLabel={`${safeString(prospect.first_name)} ${safeString(prospect.last_name)}`.trim() || 'ce prospect'}
        entityLabel="prospect"
        meta={prospect.email ?? undefined}
        onConfirm={handleDelete}
      />

      {/* Composer email personnalisé → envoi via Google Apps Script (Gmail) */}
      {emailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70 backdrop-blur-sm"
          onClick={() => !emailBusy && setEmailOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10 p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black tracking-tight flex items-center gap-2">
                <Send size={16} className="text-primary" /> Email personnalisé
              </h3>
              <button
                type="button"
                onClick={() => setEmailOpen(false)}
                disabled={emailBusy}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="text-xs text-muted-foreground">
              Destinataire :{' '}
              <span className="text-foreground font-mono">{emailRecipientOverride || prospect.email}</span>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Sujet</label>
              <input
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full h-10 px-3 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Message</label>
              <textarea
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                rows={7}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm resize-none"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                Lien du bouton (CTA)
              </label>
              <input
                value={emailCtaUrl}
                onChange={(e) => setEmailCtaUrl(e.target.value)}
                placeholder="https://calendly.com/… (défaut : Réglages → Emails & CTA)"
                className="w-full h-10 px-3 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm font-mono"
              />
            </div>

            {/* Analyse prospect (problèmes + revenus) */}
            <button
              type="button"
              onClick={handleAnalyzeProspect}
              disabled={emailAnalyzing}
              className={cn(
                'w-full h-10 rounded-lg border text-[11px] font-black uppercase tracking-widest transition-all inline-flex items-center justify-center gap-2',
                emailAnalyzing
                  ? 'border-border bg-background/60 text-muted-foreground'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
              )}
            >
              {emailAnalyzing ? <Loader2 size={13} className="animate-spin" /> : <TrendingDown size={13} />}
              {emailAnalyzing ? 'Analyse en cours…' : emailAnalysis ? 'Relancer l’analyse' : 'Analyser le prospect (problèmes + revenus)'}
            </button>

            {emailAnalysis && (
              <div className="rounded-lg border border-border bg-background/40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setEmailShowAnalysis((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground hover:text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles size={11} className="text-amber-400" />
                    {emailAnalysis.problems.length} problème(s) · revenus perdus
                  </span>
                  <ChevronDown size={12} className={cn('transition-transform', emailShowAnalysis && 'rotate-180')} />
                </button>
                {emailShowAnalysis && (
                  <div className="px-3 pb-3 space-y-2 max-h-52 overflow-y-auto">
                    {emailAnalysis.revenue_lost_summary && (
                      <p className="text-[11px] text-amber-400/90 leading-snug">{emailAnalysis.revenue_lost_summary}</p>
                    )}
                    {emailAnalysis.problems.map((p, i) => (
                      <div key={i} className="rounded-lg bg-secondary/20 border border-border p-2">
                        <p className="text-[11px] font-bold text-foreground">{p.title}</p>
                        <p className="text-[10px] text-muted-foreground leading-snug">{p.detail}</p>
                        <p className="text-[10px] text-amber-400/80 leading-snug mt-1">💸 {p.revenue_lost_hint}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Aperçu HTML (email complet de l'analyse IA ou rendu du brouillon) */}
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setEmailShowPreview((v) => !v)}
                className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1.5 hover:text-primary transition-colors"
              >
                <Eye size={11} /> {emailShowPreview ? 'Masquer' : 'Aperçu HTML'} — rendu final
              </button>
              {emailShowPreview && (
                <iframe
                  title="Aperçu de l'email"
                  srcDoc={
                    emailPreviewHtml ||
                    buildEmailHtml({
                      companyName: prospect.company_name || 'votre entreprise',
                      category: prospect.sector || null,
                      body: emailBody,
                      recipientName: prospect.first_name || null,
                      signature: 'L’équipe Zentara — Enterprise Intelligence',
                      cta: emailCtaUrl ? { label: emailCtaLabel, url: emailCtaUrl } : null,
                    }).html
                  }
                  className="w-full rounded-lg border border-border bg-white"
                  style={{ height: 320 }}
                  sandbox=""
                />
              )}
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEmailOpen(false)} disabled={emailBusy}>
                Annuler
              </Button>
              <Button size="sm" onClick={handleSendEmail} disabled={emailBusy || !emailSubject.trim() || !emailBody.trim()}>
                {emailBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Envoyer
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Envoi via ton Google Apps Script (Gmail). Configure l'URL dans Réglages → Sheets Sync.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
