/**
 * scoring.ts — Pont TS vers le moteur de scoring DÉTERMINISTE embarqué.
 *
 * Réutilise tel quel le moteur du backend (`vendor/scoring-engine.cjs` + les
 * 50 critères `vendor/scoring-criteria.cjs`) : mêmes entrées normalisées ⇒
 * exactement les mêmes scores, sans serveur et sans IA.
 *
 * Chaîne : entité (company/prospect locale) → NormalizedInput (hash stable)
 * → calc() → {breakdown, aggregate} → enregistrement intelligence + email.
 */
// @ts-ignore — module CJS vendor (déclaration .d.cjs fournie à côté)
import scoringEngineCjs from './vendor/scoring-engine.cjs';
// @ts-ignore — module CJS vendor (déclaration .d.cjs fournie à côté)
import emailTemplatesCjs from './vendor/email-templates.cjs';
// @ts-ignore — module CJS vendor (déclaration .d.cjs fournie à côté)
import intelEngineCjs from './vendor/intelligence-engine.cjs';
import { stableHashObject } from './hash';
import { genId, nowIso } from './store';
import { calculateRevenuePotential, formatRevenueForEmail, type CompanyProfile, type ScoreProfile } from './revenue-calculator';

const engine: any = (scoringEngineCjs as { default?: unknown }).default ?? scoringEngineCjs;
export const templates: any = (emailTemplatesCjs as { default?: unknown }).default ?? emailTemplatesCjs;
const intelEngine: any = (intelEngineCjs as { default?: unknown }).default ?? intelEngineCjs;

// ---------------------------------------------------------------------------
// Entité → NormalizedInput (forme canonique stable pour le hash)
// ---------------------------------------------------------------------------

export interface EntityLike {
  id?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  sector?: string | null;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
  location?: string | null;
  address?: string | null;
  website?: string | null;
  company_size?: string | null;
  founded_year?: number | null;
  size?: string | null;
  year?: number | null;
  notes?: string | null;
  updated_at?: string | null;
  social_profiles?: unknown;
  status?: string | null;
}

export function buildNormalizedInput(entity: EntityLike, extra: Record<string, unknown> = {}): any {
  const sector = String(entity.sector ?? entity.industry ?? '').trim() || null;
  const subsector = String(entity.industry ?? '').trim() || null;
  const city = entity.city ?? null;
  const country = entity.country ?? null;
  const website = entity.website ?? null;
  const email = entity.email ?? null;
  const phone = entity.phone ?? null;

  // Injecter un site_profile minimal quand on a le site web : cela différencie
  // radicalement les scores (website_present=1, site_status_reachable=1) des
  // entreprises sans site. Sans ça, toutes les entités de la seed ont le même score.
  const hasSite = !!website;
  const defaultSiteProfile: any = hasSite
    ? { url: website, reachable: true, http_status: 200 }
    : {};

  const input: any = {
    id: entity.id ?? null,
    name: String(entity.name ?? '').trim() || null,
    sector,
    subsector,
    location: { city, country },
    area_served: null,
    company_size: String(entity.company_size ?? entity.size ?? '').trim() || null,
    founded_year: parseYear(entity.founded_year ?? entity.year ?? null),
    site_profile: {
      ...defaultSiteProfile,
      ...(extra.site_profile ?? {}),
    },
    gbusiness: extra.gbusiness ?? {},
    social: extra.social ?? {},
    marketing: extra.marketing ?? {},
    contact: {
      email,
      phone,
      address: entity.address ?? null,
      email_ok: Boolean(email),
      phone_ok: Boolean(phone),
    },
    legal: extra.legal ?? {},
    source_timestamps: { db: entity.updated_at ?? nowIso() },
  };
  const { input_hash: _ih, ...canonical } = input;
  input.input_hash = stableHashObject(canonical);
  return input;
}

function parseYear(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(String(v).match(/-?\d+/)?.[0]);
  if (!Number.isFinite(n)) return null;
  if (n < 1800 || n > 2200) return null;
  return n;
}

// ---------------------------------------------------------------------------
// Analyse déterministe
// ---------------------------------------------------------------------------

export interface AnalysisOutput {
  breakdown: any[];
  aggregate: any;
  input: any;
}

export function runDeterministicAnalysis(entity: EntityLike, extra: Record<string, unknown> = {}): AnalysisOutput {
  const input = buildNormalizedInput(entity, extra);
  const { breakdown, aggregate } = engine.calc(input);
  return { breakdown, aggregate, input };
}

const FR = (n: unknown): number => Math.round(Number(n) || 0);

export function buildAnalysisRecord(
  entityType: 'company' | 'prospect',
  entityId: string,
  entity: EntityLike,
  extra: Record<string, unknown> = {},
): { record: Record<string, any>; breakdown: any[]; aggregate: any; input: any } {
  const { breakdown, aggregate, input } = runDeterministicAnalysis(entity, extra);
  const opportunity = aggregate.opportunity_score;
  const need = aggregate.need_score;
  const score = Math.round((Number(opportunity) + Number(need)) / 2);
  const now = nowIso();

  // Intelligence Engine (consensus, signaux, opportunités, forecast, qualité…).
  const profileEntity = { name: entity.name, sector: entity.sector, city: entity.city,
    country: entity.country, website: entity.website, email: entity.email, phone: entity.phone };
  let eng: any = null;
  let engineMd = '';
  try {
    eng = intelEngine.runIntelligenceEngine(aggregate, breakdown, profileEntity,
      { ai_narrated: false, product_price_monthly_eur: 490 });
    engineMd = intelEngine.renderEngineReport(eng, profileEntity);
  } catch (e) {
    // ignore — engine is additive, not critical
  }
  const base = buildStructuredReport(entity, aggregate, breakdown);
  const summary = engineMd ? `${base}\n\n---\n\n${engineMd}` : base;

  const record: Record<string, any> = {
    id: genId('int'),
    entity_type: entityType,
    entity_id: entityId,
    score,
    opportunity_score: opportunity,
    relevance_score: Math.round(Number(need) * 0.6 + Number(opportunity) * 0.4),
    intent_score: null,
    activity_score: FR(aggregate.confidence),
    confidence_score: FR(aggregate.confidence),
    input_hash: input.input_hash,
    scoring_version: 'embedded-v1',
    score_source: 'deterministic-local',
    summary,
    insights: JSON.stringify(aggregate.strengths.map((s: any) => s.label)),
    risks: JSON.stringify(aggregate.weaknesses.map((w: any) => w.label)),
    recommendations: JSON.stringify(buildRecommendations(aggregate)),
    profile: JSON.stringify({ input_hash: input.input_hash, category_scores: aggregate.category_scores }),
    product_estimate: buildProductEstimate(aggregate),
    engine: eng ? JSON.stringify(eng) : null,
    created_at: now,
    updated_at: now,
  };
  return { record, breakdown, aggregate, input };
}

// ---------------------------------------------------------------------------
// Rapport structuré 10 sections (même anatomie que l'analyse IA serveur).
// Généré DÉTERMINISTEMENT depuis les scores du moteur — aucune invention.
// ---------------------------------------------------------------------------

const ZENTARA_CATALOG = [
  { name: 'Zentara Intelligence Core', price_monthly_eur: 490 },
  { name: 'Zentara Intelligence Pro', price_monthly_eur: 990 },
  { name: 'Zentara Enterprise', price_monthly_eur: 2900 },
];

const CATEGORY_LABELS: Record<string, string> = {
  identity: 'Identité',
  site_profile: 'Site & Profil',
  site_automation: 'Site & Automatisation',
  reputation: 'Réputation',
  social: 'Réseaux sociaux',
  marketing: 'Marketing',
  accessibility: 'Accessibilité & Contact',
  derived: 'Maturité digitale (composite)',
};

function qualifier(n: number): string {
  if (n >= 81) return 'critique';
  if (n >= 61) return 'élevé';
  if (n >= 31) return 'modéré';
  return 'faible';
}

function categoryPoints(breakdown: any[], category: string): { strengths: string[]; weaknesses: string[] } {
  const inCat = breakdown.filter((x) => x.category === category && x.direction !== 'informational');
  const strengths = inCat
    .filter((x) => x.value > 0)
    .sort((a, b) => (b.value * b.weight) - (a.value * a.weight))
    .slice(0, 2)
    .map((x) => x.label);
  const strengthSet = new Set(strengths);
  const weaknesses = inCat
    .slice()
    .sort((a, b) => (a.value * a.weight) - (b.value * b.weight))
    .filter((x) => !strengthSet.has(x.label))
    .slice(0, 2)
    .map((x) => x.label);
  return { strengths, weaknesses };
}

function buildProductEstimate(agg: any) {
  const need = FR(agg.need_score);
  const opp = FR(agg.opportunity_score);
  let product = ZENTARA_CATALOG[0];
  if (need >= 80 || opp >= 80) product = ZENTARA_CATALOG[2];
  else if (need >= 60 || opp >= 60) product = ZENTARA_CATALOG[1];
  const impact_pct = Math.max(0, Math.min(100, Math.round((need + opp) / 2)));
  return {
    product: product.name,
    price_monthly_eur: product.price_monthly_eur,
    impact_pct,
    roi_12m_eur: 0,
    justification: `Mapping déterministe : besoin ${need}/100 · opportunité ${opp}/100 → ${product.name}. Impact prudent dérivé des scores du moteur (${impact_pct} %).`,
    note: 'Estimation déterministe (mode embarqué, sans IA) — à affiner par l’analyse web / IA côté serveur.',
  };
}

function buildStructuredReport(entity: EntityLike, agg: any, breakdown: any[]): string {
  const name = String(entity.name ?? '').trim() || 'cette entreprise';
  const sector = String(entity.sector ?? entity.industry ?? '').trim() || null;
  const city = String(entity.city ?? '').trim() || null;
  const country = String(entity.country ?? '').trim() || null;
  const website = String(entity.website ?? '').trim() || null;
  const email = String(entity.email ?? '').trim() || null;
  const phone = String(entity.phone ?? '').trim() || null;

  const need = FR(agg.need_score);
  const opp = FR(agg.opportunity_score);
  const conf = FR(agg.confidence);
  const urgency = String(agg.urgency || 'faible');
  const contactRisk = String(agg.contact_risk || 'faible');
  const catScores: Record<string, number> = agg.category_scores || {};
  const strengths: any[] = agg.strengths || [];
  const weaknesses: any[] = agg.weaknesses || [];

  const verdict = need >= 61 ? 'GO' : (opp >= 70 ? 'GO SOUS CONDITIONS' : (conf < 40 ? 'NO-GO' : 'GO SOUS CONDITIONS'));
  const prob1 = weaknesses[0]?.label ?? 'l’absence de données commerciales exploitables';

  const L: string[] = [];

  // 1 — SYNTHÈSE EXÉCUTIVE
  L.push('## SYNTHÈSE EXÉCUTIVE');
  L.push(`${name}${sector ? ` (${sector})` : ''} présente un besoin d’intelligence ${qualifier(need)} (${need}/100) et une opportunité commerciale ${qualifier(opp)} (${opp}/100). Problème n°1 détecté : ${prob1.toLowerCase()}. Zentara recommande de traiter ce levier en priorité. Verdict : ${verdict}.`);
  L.push('');

  // 2 — PROFIL DE L'ENTREPRISE
  L.push('## PROFIL DE L’ENTREPRISE');
  const facts: string[] = [];
  if (sector) facts.push(`secteur ${sector}`);
  if (city || country) facts.push(`localisation ${[city, country].filter(Boolean).join(', ')}`);
  if (website) facts.push(`site ${website}`);
  if (email) facts.push(`email ${email}`);
  if (phone) facts.push(`téléphone ${phone}`);
  L.push(`${name} — ${facts.length ? facts.join(' · ') + '.' : 'données de profil limitées dans la base locale.'} Profil issu des données réelles enregistrées (aucun champ inventé).`);
  L.push('');

  // 3 — ANALYSE (diagnostic structuré, une sous-partie par catégorie)
  L.push('## ANALYSE (diagnostic structuré)');
  const cats = Object.entries(catScores);
  if (cats.length === 0) {
    L.push('');
    L.push('### Données (Score : 0/100)');
    L.push('- Points forts : aucun signal digital exploitable dans la base locale.');
    L.push('- Points faibles : aucune donnée sectorielle ou de contact renseignée.');
    L.push('- Impact : diagnostic à compléter par un enrichissement web (mode serveur).');
    L.push('- Priorité : P0.');
  } else {
    for (const [cat, rawScore] of cats) {
      const s = FR(rawScore);
      const { strengths: cs, weaknesses: cw } = categoryPoints(breakdown, cat);
      L.push('');
      L.push(`### ${CATEGORY_LABELS[cat] || cat} (Score : ${s}/100)`);
      L.push(`- Points forts : ${cs.length ? cs.join(' ; ') : 'aucun signal fort détecté.'}`);
      L.push(`- Points faibles : ${cw.length ? cw.join(' ; ') : 'aucun point faible majeur.'}`);
      L.push(`- Impact : ${s >= 61 ? 'levier prioritaire' : s >= 31 ? 'levier à surveiller' : 'peu structurant en l’état'} [DÉDUCTION].`);
      L.push(`- Priorité : ${s >= 61 ? 'P0' : s >= 31 ? 'P1' : 'P2'}.`);
    }
  }

  // 4 — IMPACT FINANCIER (avec calculateur de revenu)
  L.push('');
  L.push('## IMPACT FINANCIER');
  try {
    const cProfile: CompanyProfile = {
      name, sector, city: city, country: country, website, email, phone,
      companySize: String((entity as any).company_size ?? (entity as any).size ?? '').trim() || null,
      foundedYear: parseYear((entity as any).founded_year ?? (entity as any).year ?? null),
    };
    const sProfile: ScoreProfile = {
      opportunityScore: opp, needScore: need, confidence: conf,
      strengths: agg.strengths || [], weaknesses: agg.weaknesses || [],
    };
    const est = calculateRevenuePotential(cProfile, sProfile);
    const fm = (n: number) => n.toLocaleString('fr-FR');
    const fe = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M€` : n >= 1000 ? `${(n / 1000).toFixed(0)} k€` : `${n} €`;
    const gainPct = est.projectedMonthlyRevenue > 0 ? Math.round((est.monthlyRevenueUplift / est.projectedMonthlyRevenue) * 100) : 0;
    L.push(`**Potentiel estimé : +${fe(est.annualRevenueUplift)}/an** (${est.roiMultiple}x ROI, remboursé en ${est.paybackMonths} mois)`);
    L.push('');
    L.push('| Métrique | Actuel | Avec Zentara |');
    L.push('|---|---|---|');
    L.push(`| Visites/mois | ${fm(est.currentMonthlyVisitors)} | ${fm(est.currentMonthlyVisitors)} |`);
    L.push(`| Leads/mois | ${fm(est.currentMonthlyLeads)} | **${fm(est.projectedMonthlyLeads)}** (+${Math.round((est.projectedMonthlyLeads / Math.max(1, est.currentMonthlyLeads) - 1) * 100)}%) |`);
    L.push(`| Deals/mois | ${fm(est.currentMonthlyDeals)} | **${fm(est.projectedMonthlyDeals)}** |`);
    L.push(`| CA/mois | ${fe(est.currentMonthlyRevenue)} | **${fe(est.projectedMonthlyRevenue)}** |`);
    L.push('');
    L.push(`> Hypothèses : ${est.assumptions.slice(0, 2).join('. ')}. Confiance : ${est.confidenceLevel === 'high' ? 'élevée' : est.confidenceLevel === 'medium' ? 'modérée' : 'faible'}.`);
  } catch {
    L.push('Revenu potentiellement non capturé estimé : calcul indisponible avec les données actuelles.');
  }
  L.push('');

  // 5 — ESTIMATION PRODUIT & IMPACT
  const pe = buildProductEstimate(agg);
  L.push('## ESTIMATION PRODUIT & IMPACT');
  L.push(`Produit recommandé : ${pe.product} (${pe.price_monthly_eur} €/mois).`);
  L.push(`Impact estimé : ${pe.impact_pct} % (prudent, dérivé des scores du moteur).`);
  L.push(`Justification : ${pe.justification}`);
  L.push('');

  // 6 — ÉVALUATION COMMERCIALE (labels exacts lus par le front)
  L.push('## ÉVALUATION COMMERCIALE');
  L.push(`- Score du besoin : ${need}/100`);
  L.push(`- Score d'opportunité commerciale : ${opp}/100`);
  L.push(`- Urgence du problème : ${urgency}`);
  L.push(`- Risque de contact : ${contactRisk}`);
  L.push(`- Niveau de confiance : ${conf}/100`);
  L.push(`Verdict : ${verdict}.`);
  L.push('');

  // 7 — RECOMMANDATIONS PRIORISÉES
  L.push('## RECOMMANDATIONS PRIORISÉES');
  const recos = buildRecommendations(agg);
  recos.slice(0, 5).forEach((r, i) => {
    const prio = i < 2 ? 'P0' : i < 4 ? 'P1' : 'P2';
    L.push(`- [${prio}] ${r}`);
  });
  if (recos.length === 0) L.push('- [P1] Compléter les données de l’entreprise pour affiner l’analyse.');
  L.push('');

  // 8 — RISQUES & LIMITES
  L.push('## RISQUES & LIMITES');
  const limits: string[] = [];
  if (weaknesses.length) limits.push(`leviers identifiés : ${weaknesses.slice(0, 3).map((w: any) => w.label).join(' ; ')}`);
  if (conf < 50) limits.push(`confiance ${conf}/100 (données partielles)`);
  limits.push('analyse déterministe locale, sans scrape web ni IA — hypothèses à confirmer par une analyse serveur.');
  L.push(`Risques : ${limits.join('. ')}.`);
  L.push('');

  // 9 — EMAIL
  L.push('## EMAIL');
  L.push(`Objet : ${name} — un point que nous avons relevé`);
  L.push('');
  L.push('Bonjour,');
  L.push('');
  const obs = strengths[0]?.label ?? 'votre présence digitale';
  const gap = weaknesses[0]?.label ?? 'la visibilité de vos données commerciales';
  L.push(`J’ai analysé ${obs} chez ${name} (opportunité ${opp}/100). J’ai aussi relevé un point de vigilance : ${gap}.`);
  L.push('');
  L.push('Zentara automatise l’analyse commerciale et la génération d’emails personnalisés. Une démo de 15 minutes suffit pour voir vos premiers résultats.');
  L.push('');
  L.push('Réserver un créneau : https://cal.com/zentara/demo');
  L.push('');

  // 10 — PROCHAINE ACTION
  L.push('## PROCHAINE ACTION');
  L.push(`Contacter le décideur identifié (ou le contact générique) de ${name} par email/GSM vérifié — cette semaine, en priorisant le levier ${prob1.toLowerCase()}.`);

  return L.join('\n');
}

function buildRecommendations(agg: any): string[] {
  const recos: string[] = [];
  if (agg.urgency === 'critique') recos.push('Prioriser cette cible dans les 48 h.');
  else if (agg.urgency === 'élevée') recos.push('Prioriser cette cible cette semaine.');
  if (Number(agg.opportunity_score) >= 60) recos.push('Proposer un call de découverte rapide (15 min).');
  if (Number(agg.need_score) >= 60) recos.push('Préparer un argumentaire orienté problème → solution.');
  if (agg.contact_risk === 'élevé') recos.push('Sécuriser un canal de contact direct (email/GSM vérifié) avant toute relance.');
  for (const w of agg.weaknesses.slice(0, 2)) recos.push(`Travailler le levier « ${w.label} ».`);
  if (recos.length === 0) recos.push('Compléter les données de l’entreprise pour affiner l’analyse.');
  return recos;
}

// ---------------------------------------------------------------------------
// Email (template premium embarqué)
// ---------------------------------------------------------------------------

export interface EmailDraft {
  subject: string;
  html: string;
  body: string;
  cta_url: string;
  template_id: string;
}

const ZENTARA_PRICE = 490;

/** Calcule le potentiel de revenu pour une entité (ou renvoie null si pas assez de données). */
function tryEstimateRevenue(entity: EntityLike, agg: any): ReturnType<typeof calculateRevenuePotential> | null {
  try {
    const cProfile: CompanyProfile = {
      name: String(entity.name ?? '').trim() || 'cette entreprise',
      sector: String(entity.sector ?? entity.industry ?? '').trim() || null,
      city: String(entity.city ?? '').trim() || null,
      country: String(entity.country ?? '').trim() || null,
      website: String(entity.website ?? '').trim() || null,
      email: String(entity.email ?? '').trim() || null,
      phone: String(entity.phone ?? '').trim() || null,
      companySize: String((entity as any).company_size ?? (entity as any).size ?? '').trim() || null,
      foundedYear: parseYear((entity as any).founded_year ?? (entity as any).year ?? null),
    };
    const sProfile: ScoreProfile = {
      opportunityScore: FR(agg.opportunity_score),
      needScore: FR(agg.need_score),
      confidence: FR(agg.confidence),
      strengths: agg.strengths || [],
      weaknesses: agg.weaknesses || [],
    };
    return calculateRevenuePotential(cProfile, sProfile, ZENTARA_PRICE);
  } catch {
    return null;
  }
}

export function buildEmailDraft(
  entity: EntityLike,
  agg: any,
  opts: { templateId?: string; ctaUrl?: string; senderName?: string; senderRole?: string } = {},
): EmailDraft {
  const templateId = opts.templateId ?? 'outreach_first_touch';
  const name = String(entity.name ?? '').trim() || 'votre entreprise';
  const sector = String(entity.sector ?? entity.industry ?? '').trim() || null;
  const city = String(entity.city ?? entity.country ?? '').trim() || null;
  const website = String(entity.website ?? '').trim() || null;
  const email = String(entity.email ?? '').trim() || null;
  const phone = String(entity.phone ?? '').trim() || null;
  const firstName = String(entity.first_name ?? '').trim() || null;
  const lastName = String(entity.last_name ?? '').trim() || null;
  const role = String(entity.role ?? '').trim() || null;
  const need = FR(agg.need_score);
  const opp = FR(agg.opportunity_score);
  const conf = FR(agg.confidence);

  // Calculer le potentiel de revenu
  const est = tryEstimateRevenue(entity, agg);
  const fm = (n: number) => n.toLocaleString('fr-FR');
  const fe = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M€` : n >= 1000 ? `${(n / 1000).toFixed(0)} k€` : `${n} €`;

  // Extraire forces/faiblesses significatives
  const strengths: any[] = agg.strengths ?? [];
  const weaknesses: any[] = agg.weaknesses ?? [];
  const realStrength = strengths.find((s: any) =>
    !['Site web présent', 'Email public détecté', 'Téléphone public détecté'].includes(s.label)
  )?.label ?? strengths[0]?.label ?? null;
  const realGap = weaknesses.find((w: any) =>
    !['Aucun email public', 'Aucun téléphone public'].includes(w.label)
  )?.label ?? weaknesses[0]?.label ?? null;

  // Observation personnalisée
  let observation = '';
  if (website && sector && city) {
    observation = `J'ai parcouru ${website.replace(/^https?:\/\//, '')} — ${name}, ${sector} à ${city}.`;
  } else if (website && sector) {
    observation = `J'ai regardé ${website.replace(/^https?:\/\//, '')} — positionnement ${sector} intéressant.`;
  } else if (website) {
    observation = `J'ai analysé ${website.replace(/^https?:\/\//, '')} — belle vitrine.`;
  } else if (sector && city) {
    observation = `J'analyse les acteurs ${sector} sur ${city} — ${name} ressort.`;
  } else if (sector) {
    observation = `Je cartographie le secteur ${sector} — j'ai repéré ${name}.`;
  } else {
    observation = `Je m'intéresse à ${name} — votre positionnement m'intrigue.`;
  }

  // Revenue headline (le cœur du message)
  let revenueHeadline = '';
  if (est && est.annualRevenueUplift > 0) {
    const upliftLabel = fe(est.annualRevenueUplift);
    revenueHeadline = `Voici le chiffre qui m'a fait vous écrire : d'après nos estimations, ${name} pourrait générer **+${upliftLabel}/an** de revenu additionnel en automatisant sa détection de leads et son outreach.`;

    observation += `\n\n📊 Projection éclair :\n`;
    observation += `• Actuel : ~${fm(est.currentMonthlyLeads)} leads/mois → ${fm(est.currentMonthlyDeals)} deals → ${fe(est.currentMonthlyRevenue)}/mois\n`;
    observation += `• Avec Zentara : ~${fm(est.projectedMonthlyLeads)} leads/mois → ${fm(est.projectedMonthlyDeals)} deals → ${fe(est.projectedMonthlyRevenue)}/mois\n`;
    observation += `• Gain annuel : +${upliftLabel} (ROI ${est.roiMultiple}x, remboursé en ${est.paybackMonths} mois)\n`;
    observation += `• Hypothèse : ${est.confidenceLevel === 'high' ? 'données vérifiées (confiance élevée)' : est.confidenceLevel === 'medium' ? 'estimation modérée' : 'estimation prudente (données partielles)'}`;
  }

  // Problème
  let problemLine = '';
  if (est && est.annualRevenueUplift > 0) {
    problemLine = `Cette différence vient principalement de leads non détectés et non convertis — le problème n°1 que je vois chez la plupart des ${sector || 'entreprises'} qui n'ont pas encore automatisé leur pipeline.`;
  } else if (realGap && !['Aucun email public', 'Aucun téléphone public'].includes(realGap)) {
    problemLine = `J'ai noté un point : ${realGap.toLowerCase()}. C'est souvent synonyme de croissance non captée.`;
  } else if (!email && !phone && website) {
    problemLine = `Un détail : aucun contact direct accessible depuis ${website.replace(/^https?:\/\//, '')}. Vos prospects cherchent — certains abandonnent.`;
  } else if (need >= 50) {
    problemLine = `${name} a un potentiel d'optimisation important sur la détection et la conversion de leads.`;
  } else {
    problemLine = `J'ai identifié quelques angles morts dans le pipeline commercial de ${name}.`;
  }

  const consequence = est && est.monthlyRevenueUplift > 0
    ? `Sans automatisation, c'est potentiellement ${fe(est.monthlyRevenueUplift)}/mois qui passent sous les radars.`
    : 'Des opportunités qualifiées qui passent sans être détectées ni converties.';

  let solution = '';
  if (est && est.roiMultiple >= 3) {
    solution = `Zentara remplit ce gap : détection automatique de signaux d'achat, scoring intelligent, emails prêts à l'envoi. ROI projeté : ${est.roiMultiple}x sur 12 mois.`;
  } else if (opp >= 50) {
    solution = `Zentara automatise la détection de leads, le scoring et les emails d'outreach. Le pipeline se remplit sans effort commercial supplémentaire.`;
  } else {
    solution = `Zentara pose les fondations : scoring automatique, emails prêts à l'envoi, suivi intelligent. 490€/mois, sans engagement.`;
  }

  const ctaUrl = opts.ctaUrl ?? 'https://cal.com/zentara/demo';

  const subjectRevenue = est && est.annualRevenueUplift > 10000
    ? `${name} → +${fe(est.annualRevenueUplift)}/an ?`
    : `${name} — un point que nous avons relevé`;

  const vars: Record<string, unknown> = {
    recipient_first_name: firstName || undefined,
    recipient_last_name: lastName || undefined,
    recipient_role: role || undefined,
    company_name: name,
    company_sector: sector || undefined,
    city: city || undefined,
    revenue_headline: revenueHeadline,
    observation,
    problem: problemLine,
    consequence,
    solution,
    why_now: need >= 60 ? 'Le marché accélère — les premiers arrivés sur ces sujets prennent l\'avantage.' : 'Maintenant, avant que le marché ne se structure — c\'est le bon timing.',
    demo_pitch: est ? `15 minutes pour vous montrer concrètement comment passer de ${fe(est.currentMonthlyRevenue)} à ${fe(est.projectedMonthlyRevenue)}/mois.` : '15 minutes pour vous montrer concrètement, sur vos données.',
    slot_proposal: 'Disponible cette semaine pour un échange — qu\'est-ce qui vous arrange ?',
    top_finding: realStrength || (website ? website.replace(/^https?:\/\//, '') : name),
    cta_text: 'Voir la projection complète',
    cta_url: ctaUrl,
    sender_name: opts.senderName ?? 'Tuna',
    sender_role: opts.senderRole ?? 'Fondateur, Zentara',
    your_name: opts.senderName ?? 'Tuna',
    your_role: opts.senderRole ?? 'Fondateur, Zentara',
  };

  let rendered;
  try {
    rendered = templates.renderEmailTemplate(templateId, vars);
  } catch (e) {
    rendered = templates.renderEmailTemplate('outreach_first_touch', vars);
  }
  return {
    subject: est && est.annualRevenueUplift > 10000
      ? `${name} → +${fe(est.annualRevenueUplift)}/an de revenu potentiel`
      : (rendered.subject || subjectRevenue),
    html: rendered.html,
    body: stripHtml(rendered.html),
    cta_url: ctaUrl,
    template_id: rendered.template?.id ?? templateId,
  };
}

export { tryEstimateRevenue, parseYear };

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function listEmailTemplates(): any[] {
  return templates.listTemplates();
}
