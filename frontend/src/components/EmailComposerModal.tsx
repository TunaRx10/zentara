/**
 * EmailComposerModal — composer d'email personnalisé réutilisable
 * (Leadflow · Companies · fiche prospect…).
 *
 *  - 3 templates d'outreach (Cold / Follow-up / Breakup) pré-remplis.
 *  - Génère un brouillon (sujet + corps) à partir du nom / de la catégorie.
 *  - Retrouve l'email du contact en base (`/api/contacts?q=`) si aucun
 *    email initial n'est fourni.
 *  - Aperçu HTML rendu en direct + envoi d'un email **HTML/CSS inline**
 *    (brandé Zentara) via le Google Apps Script configuré (Gmail)
 *    (`POST /api/integrations/sheets/send-email`).
 */
import React from 'react';
import { Loader2, MailPlus, Send, CheckCircle2, Eye, X, Sparkles, TrendingDown, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getApiClient } from '@/services/api/client';
import { useToast } from '@/contexts/ToastProvider';
import { buildEmailHtml, EMAIL_TEMPLATES } from '@/lib/email-template';
import { cn } from '@/lib/utils';

interface EmailComposerModalProps {
  /** Nom affiché et utilisé dans le brouillon (entreprise / lead). */
  entityName: string;
  /** Catégorie / secteur (optionnel) pour personnaliser le brouillon. */
  entityCategory?: string | null;
  /** Email direct connu (ex. company.email / lead.email). */
  initialEmail?: string | null;
  /** Si pas d'email initial, recherche un contact en base via ce terme. */
  searchQuery?: string;
  /** Nom du destinataire (prénom) pour personnaliser l'appel. */
  recipientName?: string | null;
  /** Id du prospect (optionnel) pour lancer l'analyse problèmes + revenus. */
  prospectId?: string | null;
  /** Sujet pré-rempli (ex. depuis l'analyse IA). */
  initialSubject?: string | null;
  /** Corps pré-rempli (texte ou HTML) (ex. depuis l'analyse IA). */
  initialBody?: string | null;
  /** Corps HTML complet pré-rempli (aperçu direct, ex. email_html de l'analyse). */
  initialHtml?: string | null;
  /** URL du CTA (ex. depuis l'analyse IA). */
  initialCtaUrl?: string | null;
  onClose: () => void;
}

interface ProspectAnalysis {
  problems: Array<{ title: string; detail: string; evidence: string; revenue_lost_hint: string }>;
  revenue_lost_summary: string;
  suggested_subject: string;
  suggested_sections: { problem: string; impact: string; solution: string; cta: string };
  source: 'ai' | 'heuristic';
}

interface ContactHit {
  id: string;
  email?: string | null;
}

export function EmailComposerModal({
  entityName,
  entityCategory,
  initialEmail,
  searchQuery,
  recipientName,
  prospectId,
  initialSubject,
  initialBody,
  initialHtml,
  initialCtaUrl,
  onClose,
}: EmailComposerModalProps): React.ReactElement {
  const toast = useToast();
  const [recipient, setRecipient] = React.useState<string>(initialEmail ?? '');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const [ctaUrl, setCtaUrl] = React.useState('');
  const [template, setTemplate] = React.useState<string>('cold');
  const [loadingContact, setLoadingContact] = React.useState<boolean>(!initialEmail);
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [showPreview, setShowPreview] = React.useState(false);
  const [defaultCtaLoaded, setDefaultCtaLoaded] = React.useState<boolean>(false);
  const [analysis, setAnalysis] = React.useState<ProspectAnalysis | null>(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [showAnalysis, setShowAnalysis] = React.useState(false);

  const name = entityName || 'votre entreprise';
  const category = entityCategory || 'vos services';

  // Applique un preset de template (sujet + corps).
  const applyTemplate = React.useCallback(
    (key: string) => {
      const preset = EMAIL_TEMPLATES.find((t) => t.key === key) ?? EMAIL_TEMPLATES[0];
      setTemplate(preset.key);
      setSubject(preset.subject(name, category));
      setBody(preset.body(name, category, recipientName));
    },
    [name, category, recipientName],
  );

  React.useEffect(() => {
    // Pré-remplissage depuis une analyse IA (sujet + corps + CTA) si fournis,
    // sinon template cold par défaut.
    if (initialSubject || initialBody || initialHtml) {
      if (initialSubject) setSubject(initialSubject);
      if (initialBody) setBody(initialBody);
      if (initialCtaUrl) setCtaUrl(initialCtaUrl);
      return;
    }
    applyTemplate('cold');
    if (initialEmail) return;
    if (!searchQuery) {
      setLoadingContact(false);
      setNotice('Aucun email renseigné sur cette fiche.');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const api = getApiClient();
        const hits = await api.get<ContactHit[]>('/contacts', {
          query: { q: searchQuery, limit: 10 },
        });
        if (cancelled) return;
        const withEmail = (hits ?? []).find((c) => c.email);
        if (withEmail?.email) {
          setRecipient(withEmail.email);
          setNotice(`Contact trouvé en base : ${withEmail.email}`);
        } else {
          setNotice("Aucun email trouvé ni sur la fiche ni en base — lance un scraping des contacts pour le récupérer.");
        }
      } catch {
        setNotice('Impossible de rechercher le contact en base.');
      } finally {
        if (!cancelled) setLoadingContact(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialEmail, searchQuery, applyTemplate]);

  // Pré-remplit le CTA avec le calendrier de rendez-vous configuré dans
  // Réglages → Emails & CTA (`GET /integrations/outreach` → cta_calendar_url).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = getApiClient();
        const cfg = await api.get<{ cta_calendar_url: string | null }>('/integrations/outreach');
        if (cancelled) return;
        const url = cfg?.cta_calendar_url?.trim();
        if (url) {
          setCtaUrl((prev) => (prev.trim() ? prev : url));
          setDefaultCtaLoaded(true);
        }
      } catch {
        /* silencieux : le CTA reste vide si les réglages sont injoignables */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Construit l'email HTML final (brandé, CSS inline). Si un HTML complet a été
  // fourni par l'analyse IA (initialHtml), on le garde tel quel pour l'aperçu.
  const { html } = React.useMemo(() => {
    if (initialHtml && initialHtml.trim().length > 0) {
      return { html: initialHtml, text: body };
    }
    return buildEmailHtml({
      companyName: name,
      category,
      body,
      recipientName,
      cta: ctaUrl.trim() ? { label: 'Planifier un échange', url: ctaUrl.trim() } : null,
      signature: 'L’équipe Zentara — Enterprise Intelligence',
    });
  }, [initialHtml, name, category, body, recipientName, ctaUrl]);

  /** Analyse le prospect (problèmes + revenus perdus) et pré-remplit le mail. */
  const handleAnalyze = async () => {
    if (!prospectId) return;
    setAnalyzing(true);
    try {
      const api = getApiClient();
      const a = await api.post<ProspectAnalysis>(`/outreach/analyze-prospect/${prospectId}`, {});
      setAnalysis(a);
      setShowAnalysis(true);
      if (a.suggested_subject) setSubject(a.suggested_subject);
      const s = a.suggested_sections;
      const structured = [s.problem, s.impact, s.solution, s.cta].filter(Boolean).join('\n\n');
      if (structured) setBody(structured);
      toast.success(`Analyse ${a.source === 'ai' ? 'IA' : 'heuristique'} prête — mail structuré généré.`);
    } catch (e) {
      toast.error(`Analyse impossible : ${(e as Error).message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSend = async () => {
    if (!recipient) return;
    setBusy(true);
    try {
      const api = getApiClient();
      const r = await api.post<{ ok: boolean; error?: string | null }>('/integrations/sheets/send-email', {
        to: recipient,
        subject: subject.trim(),
        html,
      });
      if (r.ok) {
        setSent(true);
        toast.success(`Email HTML envoyé à ${recipient} via Apps Script (Gmail).`);
      } else {
        toast.error(
          `Envoi refusé par l'Apps Script${r.error ? ` : ${r.error}` : ''} — vérifie l'URL dans Réglages → Sheets Sync.`,
        );
      }
    } catch (e) {
      toast.error(`Envoi impossible : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-border/60 bg-secondary/20">
          <div className="min-w-0">
            <h3 className="text-sm font-black tracking-tight flex items-center gap-2">
              <MailPlus size={16} className="text-primary" /> Email personnalisé
            </h3>
            <p className="text-[11px] text-muted-foreground truncate">
              {entityName} · {entityCategory || '—'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[80vh] overflow-y-auto">
          {/* Destinataire */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Destinataire (contact)
            </label>
            {loadingContact ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground h-10 px-3 rounded-lg border border-border bg-background">
                <Loader2 size={13} className="animate-spin" /> Recherche du contact en base…
              </div>
            ) : (
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="email@entreprise.com"
                className="w-full h-10 px-3 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm font-mono"
              />
            )}
            {notice && <p className="text-[10px] text-muted-foreground">{notice}</p>}
          </div>

          {/* Template selector */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1.5">
              <Sparkles size={11} /> Template d'outreach
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {EMAIL_TEMPLATES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => applyTemplate(t.key)}
                  className={cn(
                    'h-8 px-3 rounded-lg border text-[10px] uppercase font-black tracking-widest transition-all',
                    template === t.key
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border bg-background/60 text-muted-foreground hover:bg-primary/10',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Analyse prospect (problèmes + revenus) */}
          {prospectId && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analyzing}
                className={cn(
                  'w-full h-10 rounded-lg border text-[11px] font-black uppercase tracking-widest transition-all inline-flex items-center justify-center gap-2',
                  analyzing
                    ? 'border-border bg-background/60 text-muted-foreground'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20',
                )}
              >
                {analyzing ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <TrendingDown size={13} />
                )}
                {analyzing ? 'Analyse en cours…' : analysis ? 'Relancer l’analyse' : 'Analyser le prospect (problèmes + revenus)'}
              </button>

              {analysis && (
                <div className="rounded-lg border border-border bg-background/40 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowAnalysis((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-muted-foreground hover:text-foreground"
                  >
                    <span className="flex items-center gap-1.5">
                      <Sparkles size={11} className="text-amber-400" />
                      {analysis.problems.length} problème(s) · revenus perdus
                    </span>
                    <ChevronDown size={12} className={cn('transition-transform', showAnalysis && 'rotate-180')} />
                  </button>
                  {showAnalysis && (
                    <div className="px-3 pb-3 space-y-2 max-h-52 overflow-y-auto">
                      {analysis.revenue_lost_summary && (
                        <p className="text-[11px] text-amber-400/90 leading-snug">{analysis.revenue_lost_summary}</p>
                      )}
                      {analysis.problems.map((p, i) => (
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
            </div>
          )}

          {/* Sujet */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Sujet</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full h-10 px-3 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm"
            />
          </div>

          {/* Corps (éditable) */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={7}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm resize-none"
            />
          </div>

          {/* CTA — pré-rempli avec le calendrier par défaut (Réglages → Emails & CTA) */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Lien du bouton (CTA)
            </label>
            <input
              value={ctaUrl}
              onChange={(e) => {
                setCtaUrl(e.target.value);
                if (e.target.value.trim()) setDefaultCtaLoaded(false);
              }}
              placeholder="https://calendly.com/… ou https://votresite.com"
              className="w-full h-10 px-3 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm font-mono"
            />
            {defaultCtaLoaded && (
              <p className="text-[10px] text-emerald-500">
                CTA par défaut appliqué depuis Réglages → Emails & CTA — modifiable ici pour ce mail.
              </p>
            )}
          </div>

          {/* Aperçu HTML rendu */}
          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1.5 hover:text-primary transition-colors"
            >
              <Eye size={11} /> {showPreview ? 'Masquer' : 'Aperçu HTML'} — rendu final
            </button>
            {showPreview && (
              <iframe
                title="Aperçu de l'email"
                srcDoc={html}
                className="w-full rounded-lg border border-border bg-white"
                style={{ height: 360 }}
                sandbox=""
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>
              Annuler
            </Button>
            <Button size="sm" onClick={handleSend} disabled={busy || !recipient || !subject.trim() || !body.trim()}>
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : sent ? (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              {sent ? 'Envoyé ✓' : 'Envoyer via Gmail'}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Email HTML/CSS brandé Zentara, envoyé via ton Google Apps Script (Gmail). Configure l'URL dans Réglages →
            Sheets Sync.
          </p>
        </div>
      </div>
    </div>
  );
}
