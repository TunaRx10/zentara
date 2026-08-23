import React from 'react';
import { AlertTriangle, Brain, Copy, Check, Send, TrendingUp, Mail, Gauge, ShieldAlert, Zap, Eye, Euro, Percent, Target, BarChart3, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface IntelShape {
  summary?: string | null;
  insights?: string | string[] | null;
  risks?: string | string[] | null;
  recommendations?: string | string[] | null;
  score?: number | null;
  opportunity_score?: number | null;
  confidence_score?: number | null;
  email_html?: string | null;
  email_cta_url?: string | null;
  email_body?: string | null;
  email_subject?: string | null;
  product_estimate?: {
    product?: string | null;
    price_monthly_eur?: number | null;
    impact_pct?: number | null;
    roi_12m_eur?: number | null;
    justification?: string | null;
    note?: string | null;
  } | null;
  /** Moteur d'Intelligence déterministe — json parsé (consensus, signaux, opportunités, forecast, qualité). */
  engine?: Record<string, any> | null;
}

export interface EmailActionMeta {
  /** Corps HTML complet (email_html de l'analyse) — pour l'aperçu direct. */
  html?: string;
  /** URL du CTA (bouton calendrier / contrat). */
  ctaUrl?: string;
  /** Destinataire pré-rempli. */
  recipient?: string;
  /** Ouvre uniquement le preview (sans composeur). */
  previewOnly?: boolean;
}

interface AnalysisViewProps {
  intel: IntelShape;
  /** Si fourni, affiche les boutons d'action email (Envoi / Preview). */
  onSendEmail?: (subject: string, body: string, meta?: EmailActionMeta) => void;
  /** Infos contact pour pré-remplir le composeur (destinataire, nom, catégorie). */
  contact?: { name?: string | null; email?: string | null; category?: string | null } | null;
  className?: string;
}

function parseList(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  try {
    const j = JSON.parse(v);
    if (Array.isArray(j)) return j.map(String).filter(Boolean);
  } catch {
    /* pas du JSON */
  }
  return v
    .split('\n')
    .map((s) => s.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);
}

/** Détecte si le summary contient le nouveau format « analyse complète » */
function isNewFormat(summary?: string | null): boolean {
  if (!summary) return false;
  return (
    summary.includes('PROFIL DE L') ||
    summary.includes('PROCHAINE ACTION') ||
    summary.includes('### ')
  );
}

interface Section {
  title: string;
  lines: string[];
}

/** Découpe le markdown en sections `### TITRE`, `## TITRE` ou `**TITRE**` (gras seul). */
function splitSections(md: string): Section[] {
  const raw = String(md || '');
  // Titres markdown (#) OU titre gras seul sur une ligne (**TITRE** sans contenu après).
  const parts = raw.split(/\n(?=(?:#{1,3}\s+|\*\*[^*]{2,60}\*\*\s*$))/g);
  const sections: Section[] = [];
  for (const part of parts) {
    const m = part.match(/^(?:#{1,3}\s+)?\*\*([^*]{2,60})\*\*\s*$/m) || part.match(/^#{1,3}\s+(.*)$/m);
    if (!m) {
      const t = part.trim();
      if (t) sections.push({ title: '', lines: t.split('\n') });
      continue;
    }
    const body = part.slice(m.index! + m[0].length);
    sections.push({ title: m[1].trim(), lines: body.split('\n') });
  }
  return sections.filter((s) => s.title || s.lines.some((l) => l.trim()));
}

function renderLine(line: string, idx: number) {
  const t = line.trim();
  if (!t) return <div key={idx} className="h-2" />;
  // Séparateur
  if (/^---+$/.test(t)) return <div key={idx} className="h-px bg-border/60 my-1" />;
  // Liste
  if (/^[-*•]\s+/.test(t)) {
    return (
      <div key={idx} className="flex gap-2 text-sm leading-relaxed">
        <span className="text-primary mt-1.5 shrink-0">•</span>
        <span className="text-muted-foreground">{renderInline(t.replace(/^[-*•]\s+/, ''))}</span>
      </div>
    );
  }
  // Label gras en début de ligne (**Label :** texte) — rendu propre, sans asterisques
  const bold = t.match(/^\*\*(.+?)\*\*\s*:?\s*(.*)$/);
  if (bold) {
    return (
      <div key={idx} className="text-sm leading-relaxed">
        <span className="font-bold text-foreground">{bold[1]}</span>
        {bold[2] ? <span className="text-muted-foreground"> : {renderInline(bold[2])}</span> : null}
      </div>
    );
  }
  // Paragraphe standard — texte complet pour lisibilité
  return (
    <p key={idx} className="text-sm leading-relaxed text-foreground/90">
      {renderInline(t)}
    </p>
  );
}

function renderInline(s: string) {
  return s
    .replace(/\*\*(.+?)\*\*/g, (_, x) => x)
    .replace(/`(.+?)`/g, (_, x) => x);
}

/** Extrait la section EMAIL (sujet + corps) depuis le markdown complet */
function extractEmail(md: string): { subject: string; body: string } {
  const raw = String(md || '');
  const m =
    raw.match(/(?:^|\n)#{1,3}\s*(?:EMAIL|EMAIL PERSONNALISÉ)[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n\*\*[^*]{2,60}\*\*\s*$|\n*$)/i) ||
    raw.match(/(?:^|\n)\*\*(?:EMAIL|EMAIL PERSONNALISÉ)\*\*[^\n]*\n([\s\S]*?)(?=\n#{1,3}\s|\n\*\*[^*]{2,60}\*\*\s*$|\n*$)/i);
  const section = m ? m[1] : '';
  let subject = '';
  const sm =
    section.match(/\*\*(?:Objet|Sujet|Subject)\s*:?\*\*\s*:?\s*(.+)/i) ||
    section.match(/(?:Objet|Sujet|Subject)\s*:?\s*(.+)/i);
  if (sm) subject = sm[1].trim();
  const body = section
    .replace(/\*\*(?:Objet|Sujet|Subject)\s*:?\*\*[^\n]*\n?/i, '')
    .replace(/(?:Objet|Sujet|Subject)\s*:?[^\n]*\n?/i, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n\n');
  return { subject, body };
}

/** Extraits clés : revenu estimé + urgence/risque/confiance depuis le markdown */
function extractHighlights(md: string) {
  const raw = String(md || '');
  let revenue =
    raw.match(/Revenu potentiellement non capturé estimé\s*:\s*([^\n.]+)/i)?.[1]?.trim() ||
    raw.match(/Estimation prudente\s*:\s*([^\n.]+)/i)?.[1]?.trim() ||
    null;
  // Ne pas afficher de bannière quand l'IA déclare le montant inestimable.
  if (revenue && /non disponible|indisponible|impossible|n\/?a\b/i.test(revenue)) revenue = null;
  const urgency = raw.match(/Urgence du problème\s*:\s*([^\n.]+)/i)?.[1]?.trim() || null;
  const need = raw.match(/Score du besoin\s*:\s*(\d{1,3})\s*\/\s*100/i)?.[1] || null;
  const opp = raw.match(/Score d'opportunité commerciale\s*:\s*(\d{1,3})\s*\/\s*100/i)?.[1] || null;
  const contactRisk = raw.match(/Risque de contact\s*:\s*([^\n.]+)/i)?.[1]?.trim() || null;
  const confidence = raw.match(/Niveau de confiance\s*:\s*([^\n.]+)/i)?.[1]?.trim() || null;
  return { revenue, urgency, need, opp, contactRisk, confidence };
}

const SEVERITY_COLOR: Record<string, string> = {
  critique: 'bg-red-500/15 text-red-400 border-red-500/30',
  élevée: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  modérée: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  faible: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

function scoreColor(v: number | null | undefined): string {
  if (v == null) return 'text-muted-foreground';
  if (v >= 80) return 'text-emerald-400';
  if (v >= 60) return 'text-amber-400';
  return 'text-red-400';
}

function impactColor(pct: number | null | undefined): string {
  if (pct == null) return 'bg-muted text-muted-foreground';
  if (pct >= 70) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
  if (pct >= 40) return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
  return 'bg-red-500/15 text-red-400 border-red-500/30';
}

/** Carte « Estimation produit & impact » : produit recommandé, prix, % impact, ROI 12 mois. */
function ProductEstimateCard({ est }: { est: NonNullable<IntelShape['product_estimate']> }) {
  const impact = est.impact_pct;
  return (
    <div className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 via-card to-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Target size={14} className="text-accent" />
        <p className="text-[10px] font-black uppercase tracking-widest text-foreground">Estimation produit & impact</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 rounded-lg bg-card border border-border/70 p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Produit recommandé</p>
          <p className="text-sm font-bold text-foreground mt-0.5">{est.product || '—'}</p>
        </div>
        <div className="rounded-lg bg-card border border-border/70 p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold flex items-center gap-1">
            <Euro size={11} /> Prix mensuel
          </p>
          <p className="text-lg font-black text-primary mt-0.5">
            {est.price_monthly_eur ? `${est.price_monthly_eur} €` : '—'}
            {est.price_monthly_eur ? <span className="text-xs font-semibold text-muted-foreground">/mois</span> : null}
          </p>
        </div>
        <div className={cn('rounded-lg border p-3', impactColor(impact))}>
          <p className="text-[10px] uppercase tracking-widest font-bold flex items-center gap-1 opacity-80">
            <Percent size={11} /> Impact estimé
          </p>
          <p className="text-lg font-black mt-0.5">{impact != null ? `${impact}%` : '—'}</p>
        </div>
        <div className="col-span-2 rounded-lg bg-card border border-border/70 p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold flex items-center gap-1">
            <TrendingUp size={11} /> ROI estimé sur 12 mois
          </p>
          <p className="text-lg font-black text-emerald-400 mt-0.5">
            {est.roi_12m_eur ? `${est.roi_12m_eur.toLocaleString('fr-FR')} €` : '—'}
          </p>
        </div>
      </div>
      {est.justification && <p className="text-xs text-muted-foreground leading-relaxed">{est.justification}</p>}
      {est.note && <p className="text-[11px] italic text-muted-foreground/80 leading-relaxed">{est.note}</p>}
    </div>
  );
}

/** Parse engine JSON — can come as string or already-parsed object from the DB. */
function parseEngine(raw: string | Record<string, any> | null | undefined): Record<string, any> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return null; }
}

const PIPELINE_ORDER = ['URGENT', 'HIGH VALUE', 'QUICK WIN', 'STRATEGIC', 'LONG TERM', 'MONITOR'];
const PIPELINE_COLORS: Record<string, string> = {
  URGENT: 'bg-red-500/15 text-red-400 border-red-500/30',
  'HIGH VALUE': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'QUICK WIN': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  STRATEGIC: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  'LONG TERM': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  MONITOR: 'bg-muted text-muted-foreground border-border',
};

/** Mini-carte pour l'intelligence engine : consensus, qualité + pipeline d'opportunités. */
function IntelEngineBlock({ eng }: { eng: any }) {
  const e = React.useMemo(() => parseEngine(eng), [eng]);
  if (!e) return null;
  const cs = e.consensus;
  const q = e.quality;
  const pipeline = e.pipeline || {};
  const oppCount = PIPELINE_ORDER.reduce((a, k) => a + ((pipeline[k] || []).length), 0);

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Layers size={14} className="text-blue-400" />
        <p className="text-[10px] font-black uppercase tracking-widest text-foreground">Moteur d'Intelligence (Multi-Agent)</p>
        {q?.score != null && (
          <Badge className={cn('ml-auto', q.score >= 80 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : q.score >= 60 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30')}>
            Qualité {q.score}/100
          </Badge>
        )}
      </div>
      {/* Consensus */}
      {cs && (
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-card border border-border/70 p-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Consensus</p>
            <p className="text-lg font-black text-blue-400">{cs.consensus_score}/100</p>
          </div>
          <div className="rounded-lg bg-card border border-border/70 p-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Accord</p>
            <p className="text-lg font-black text-emerald-400">{cs.agreement_pct}%</p>
          </div>
          <div className="rounded-lg bg-card border border-border/70 p-2 text-center">
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">Confiance</p>
            <p className="text-lg font-black text-amber-400">{cs.confidence}/100</p>
          </div>
        </div>
      )}
      {/* Analystes */}
      {cs?.agents && cs.agents.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {cs.agents.map((a: any) => (
            <Badge key={a.id} className="bg-muted/60 text-muted-foreground border border-border/50 text-[10px]" title={`${a.label} — score ${a.score}/100`}>
              <BarChart3 size={10} className="mr-1 opacity-60" /> {a.label} {a.score}/100
            </Badge>
          ))}
        </div>
      )}
      {/* Pipeline d'opportunités */}
      {oppCount > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1">
            <Target size={10} /> Pipeline d'opportunités ({oppCount})
          </p>
          <div className="flex flex-wrap gap-1">
            {PIPELINE_ORDER.map((cat) => {
              const items = pipeline[cat] || [];
              if (!items.length) return null;
              return (
                <Badge key={cat} className={cn('text-[10px]', PIPELINE_COLORS[cat] || 'bg-muted text-muted-foreground border-border')}>
                  {cat} ({items.length})
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function AnalysisView({ intel, onSendEmail, contact, className }: AnalysisViewProps) {
  const md = intel?.summary || '';
  const newFormat = isNewFormat(md);
  const [copied, setCopied] = React.useState(false);
  const highlights = React.useMemo(() => (newFormat ? extractHighlights(md) : null), [md, newFormat]);
  // Email prioritaire : champs structurés de l'analyse (email_subject/email_html/email_body)
  // sinon extraction depuis le markdown de la section EMAIL.
  const email = React.useMemo(() => {
    const structured = {
      subject: intel?.email_subject || '',
      body: intel?.email_body || '',
      html: intel?.email_html || '',
      ctaUrl: intel?.email_cta_url || '',
    };
    const fallback = newFormat ? extractEmail(md) : { subject: '', body: '' };
    return {
      subject: structured.subject || fallback.subject,
      body: structured.body || fallback.body,
      html: structured.html,
      ctaUrl: structured.ctaUrl,
    };
  }, [md, newFormat, intel?.email_subject, intel?.email_body, intel?.email_html, intel?.email_cta_url]);
  const sections = React.useMemo(() => (newFormat ? splitSections(md) : []), [md, newFormat]);
  const insights = parseList(intel?.insights);
  const risks = parseList(intel?.risks);
  const recos = parseList(intel?.recommendations);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard indisponible */
    }
  };

  // --- Ancien format (résumé court) : rendu classique ---
  if (!newFormat) {
    return (
      <div className={cn('space-y-3', className)}>
        <div className="flex flex-wrap gap-1.5">
          {intel.opportunity_score != null && (
            <Badge className="bg-primary/15 text-primary border border-primary/30">
              <Gauge size={11} className="mr-1" /> Opportunité {intel.opportunity_score}/100
            </Badge>
          )}
          {intel.confidence_score != null && (
            <Badge className="bg-muted text-muted-foreground border border-border">
              Confiance {intel.confidence_score}/100
            </Badge>
          )}
        </div>
        {md && <p className="text-sm leading-relaxed whitespace-pre-wrap">{md}</p>}
        {insights.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1.5">Insights</p>
            <ul className="space-y-1">
              {insights.map((i, idx) => (
                <li key={idx} className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
                  <span className="text-primary mt-1.5">•</span>
                  {i}
                </li>
              ))}
            </ul>
          </div>
        )}
        {recos.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1.5">Recommandations</p>
            <ul className="space-y-1">
              {recos.map((r, idx) => (
                <li key={idx} className="flex gap-2 text-sm text-muted-foreground leading-relaxed">
                  <span className="text-accent mt-1.5">→</span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}
        {risks.length > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
            <p className="text-[10px] uppercase tracking-widest font-bold text-amber-400 flex items-center gap-1">
              <AlertTriangle size={12} /> Risques
            </p>
            {risks.map((r, idx) => (
              <p key={idx} className="text-xs text-amber-400/90 leading-relaxed">
                • {r}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Nouveau format : rapport structuré ---
  return (
    <div className={cn('space-y-4', className)}>
      {/* Badges d'évaluation */}
      <div className="flex flex-wrap gap-1.5">
        {(highlights?.need || intel.opportunity_score != null || highlights?.opp) && (
          <Badge className="bg-primary/15 text-primary border border-primary/30">
            <Gauge size={11} className="mr-1" />
            Besoin {highlights?.need || '—'}/100
          </Badge>
        )}
        <Badge className="bg-accent/15 text-accent border border-accent/30">
          <Zap size={11} className="mr-1" /> Opportunité {highlights?.opp || intel.opportunity_score || '—'}/100
        </Badge>
        {highlights?.urgency && (
          <Badge className={cn('border', SEVERITY_COLOR[highlights.urgency.toLowerCase()] || 'bg-muted text-muted-foreground border-border')}>
            <TrendingUp size={11} className="mr-1" /> Urgence : {highlights.urgency}
          </Badge>
        )}
        {highlights?.contactRisk && (
          <Badge className="bg-muted text-muted-foreground border border-border">
            <ShieldAlert size={11} className="mr-1" /> Contact : {highlights.contactRisk}
          </Badge>
        )}
        {intel.confidence_score != null && (
          <Badge className="bg-muted text-muted-foreground border border-border">
            <Brain size={11} className="mr-1" /> Confiance {intel.confidence_score}/100
          </Badge>
        )}
      </div>

      {/* Impact financier mis en avant */}
      {highlights?.revenue && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 flex items-center gap-2">
          <TrendingUp size={15} className="text-emerald-400 shrink-0" />
          <p className="text-xs leading-snug text-emerald-300">
            Revenu potentiellement non capturé estimé : <span className="font-black">{highlights.revenue}</span>
          </p>
        </div>
      )}

      {/* Estimation produit & impact (product_estimate de l'analyse) */}
      {intel?.product_estimate?.product && (
        <ProductEstimateCard est={intel.product_estimate} />
      )}

      {/* Moteur d'Intelligence (consensus, qualité, pipeline) */}
      {intel?.engine && <IntelEngineBlock eng={intel.engine} />}

      {/* Sections du rapport */}
      <div className="space-y-4">
        {sections.map((sec, i) => {
          const isEmail = /email/i.test(sec.title);
          const isAction = /prochaine action/i.test(sec.title);
          return (
            <div
              key={i}
              className={cn(
                'rounded-xl border p-3.5',
                isEmail
                  ? 'border-accent/30 bg-accent/5'
                  : isAction
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-border/60 bg-card/50',
              )}
            >
              {sec.title && (
                <div className="flex items-center gap-2 mb-2">
                  {isEmail ? <Mail size={13} className="text-accent" /> : isAction ? <Send size={13} className="text-primary" /> : <Brain size={13} className="text-primary/70" />}
                  <p className="text-[10px] font-black uppercase tracking-widest text-foreground">{sec.title}</p>
                </div>
              )}
              <div className="space-y-1.5">
                {sec.lines.map((l, j) => renderLine(l, j))}
              </div>
              {isEmail && (email.body || email.subject) && onSendEmail && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-accent/40 text-accent hover:bg-accent/10 gap-1.5"
                    onClick={() =>
                      onSendEmail(email.subject, email.body || email.html, {
                        html: email.html || undefined,
                        ctaUrl: email.ctaUrl || undefined,
                        recipient: contact?.email || undefined,
                      })
                    }
                  >
                    <Send size={12} /> Envoyer
                  </Button>
                  {(email.subject || email.body) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground gap-1.5"
                      onClick={() => onSendEmail(email.subject, email.body || email.html, { previewOnly: true })}
                    >
                      <Eye size={12} /> Preview
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Insights / risques / reco structurés */}
      {(insights.length > 0 || risks.length > 0 || recos.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.length > 0 && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-emerald-400 mb-1.5">Signaux clés</p>
              <ul className="space-y-1">
                {insights.map((i, idx) => (
                  <li key={idx} className="flex gap-2 text-xs text-foreground/90 leading-relaxed">
                    <span className="text-emerald-400 mt-1">•</span>
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {recos.length > 0 && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-blue-400 mb-1.5">Actions recommandées</p>
              <ul className="space-y-1">
                {recos.map((r, idx) => (
                  <li key={idx} className="flex gap-2 text-xs text-foreground/90 leading-relaxed">
                    <span className="text-blue-400 mt-1">→</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {risks.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
              <p className="text-[10px] uppercase tracking-widest font-bold text-amber-400 mb-1.5 flex items-center gap-1">
                <AlertTriangle size={12} /> Risques
              </p>
              <ul className="space-y-1">
                {risks.map((r, idx) => (
                  <li key={idx} className="flex gap-2 text-xs text-amber-400/90 leading-relaxed">
                    <span className="mt-1">•</span>
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button size="sm" variant="ghost" className="text-muted-foreground gap-1.5" onClick={handleCopy}>
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          {copied ? 'Copié' : 'Copier l’analyse'}
        </Button>
      </div>
    </div>
  );
}