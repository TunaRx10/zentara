// scoring-engine.js — Moteur de scoring DÉTERMINISTE Zentara
//
// ARCHITECTURE
//   Sources brutes → NormalizedInput (hash stable) → 50 critères (0-1, weight)
//   → calc() → AggregatedScores {need, opportunity, urgency, contact_risk, confidence}
//   → prompt AI reçoit UNIQUEMENT les chiffres calculés (PLUS de score deviné)
//
// GARANTIES
//   • Pure function : mêmes inputs ⇒ mêmes outputs (testé via input_hash).
//   • Aucune dépendance à l'IA pour les chiffres.
//   • Sortie reproductible + traçable (chaque score affiche ses critères).
//   • Aucun chiffre inventé : tout est dérivé d'observations présentes
//     dans le NormalizedInput (ou absent ⇒ contribution 0).
//
// VOCABULAIRE
//   • criterion = { id, label, category, direction, weight, value, raw, evidence }
//       direction ∈ { 'positive' (une bonne valeur augmente le besoin/opportunité ?),
//                     'negative' (une mauvaise valeur augmente le besoin ?),
//                     'informational' (n'affecte pas l'agrégat mais apparaît dans le rapport) }
//       value ∈ [0, 1]              // valeur normalisée
//       weight ∈ [0, 1]             // poids dans la catégorie
//       evidence = sous-objet            // preuve / source / calcul
//   • breakdown = liste des 50 critères calculés
//   • Aggregate = { need_score, opportunity_score, urgency, contact_risk, confidence,
//                   category_scores, strengths, weaknesses, missing_data }
//   • input_hash = sha256(JSON canonique du NormalizedInput)
//
// NOTE — le framework historique de 34 champs est PRÉSERVÉ dans prospect-prompt.js
// (il sert au prompt AI pour la narration) ; ici on expose 50 critères de scoring
// dérivant directement de ces 34 champs + signaux agrégés.
'use strict';

const CATEGORIES = require('./scoring-criteria');

// --------------------------------------------------------------------------
// Helpers arithmétiques (toutes pures, pas d'arrondi aléatoire)
// --------------------------------------------------------------------------

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampInt(v, min = 0, max = 100) {
  const n = Math.round(Number(v) || 0);
  return Math.max(min, Math.min(max, n));
}

/** Bucketize linéaire : 0 → 0, x0 → v0, x1 → v1. Clamp final. */
function linear(value, x0, x1) {
  const x = Number(value);
  if (!Number.isFinite(x)) return 0;
  if (x <= x0) return 0;
  if (x >= x1) return 1;
  return (x - x0) / (x1 - x0);
}

/** Inverse : 5 → 0, 0 → 1 (utilisé pour les avis négatifs, problèmes, etc.) */
function inverseLinear(value, x0, x1) {
  return 1 - linear(value, x0, x1);
}

/** Premier match dans une table de seuils. */
function bucket(value, thresholds) {
  // thresholds = [{ upTo: X, val: V }, ...]
  const x = Number(value);
  if (!Number.isFinite(x)) return thresholds[0]?.val ?? 0;
  for (const t of thresholds) {
    if (x <= t.upTo) return t.val;
  }
  return thresholds[thresholds.length - 1].val;
}

function sum(arr) {
  let s = 0;
  for (const x of arr) s += Number(x) || 0;
  return s;
}

function avg(arr) {
  if (!arr.length) return 0;
  return sum(arr) / arr.length;
}

// --------------------------------------------------------------------------
// Évaluateurs par catégorie
//   Chaque évaluateur retourne un tableau de Criterion { id, value, raw, evidence }.
// --------------------------------------------------------------------------

// ---------- Catégorie A : Identité / Complétude (cri 1-8) --------------------

function evalIdentity(input) {
  return [
    c('name_provided', input.name ? 1 : 0,
      { name: input.name || null }),
    c('sector_provided', input.sector ? 1 : 0,
      { sector: input.sector || null }),
    c('subsector_provided', input.subsector ? 1 : 0,
      { subsector: input.subsector || null }),
    c('location_provided', input.location?.city ? 1 : 0,
      { city: input.location?.city || null, country: input.location?.country || null }),
    c('area_served_provided', input.area_served ? 1 : 0,
      { area_served: input.area_served || null }),
    c('company_size_provided', input.company_size ? 1 : 0,
      { size: input.company_size || null }),
    c('founded_year_provided', input.founded_year ? 1 : 0,
      { founded_year: input.founded_year || null }),
    c('company_age_years', computeAgeYears(input.founded_year),
      { founded_year: input.founded_year || null, age_years: computeAgeYears(input.founded_year) * 80 }),
  ];
}

// helper pour fabriquer un Criterion avec value+raw+evidence
function c(id, value, evidence = {}) {
  const meta = CATEGORIES.BY_ID[id];
  if (!meta) throw new Error(`scoring-criteria: unknown id "${id}"`);
  return {
    id,
    label: meta.label,
    category: meta.category,
    direction: meta.direction,
    weight: meta.weight,
    value: clamp01(value),
    evidence,
  };
}

function computeAgeYears(fy) {
  if (!fy) return 0;
  const y = Number(fy);
  if (!Number.isFinite(y) || y < 1800 || y > 2200) return 0;
  const current = new Date().getUTCFullYear();
  return current - y;
}

// ---------- Catégorie B : Présence digitale site (cri 9-18) -----------------

function evalSiteProfile(input) {
  const p = input.site_profile || {};
  return [
    c('website_present', p.url ? 1 : 0, { url: p.url || null }),
    c('site_status_reachable', p.reachable === true ? 1 : p.reachable === false ? 0 : 0,
      { reachable: p.reachable ?? null, http_status: p.http_status ?? null }),
    c('mobile_quality_score', p.mobile_quality != null ? Number(p.mobile_quality) : 0,
      { viewport: p.viewport || null, mobile_score: p.mobile_quality ?? null }),
    c('site_speed_score', p.speed_ms != null ? inverseLinear(p.speed_ms, 200, 5000) : 0,
      { speed_ms: p.speed_ms ?? null, target_ms: 200 }),
    c('has_main_cta', !!p.main_cta,
      { cta: p.main_cta || null, cta_count: p.cta_count || 0 }),
    c('has_contact_form', !!p.contact_form,
      { has_form: !!p.contact_form, form_count: p.form_count || 0 }),
    c('has_booking_or_quote', !!p.booking_quote ? 1 : (p.has_booking ? 1 : 0),
      { booking_url: p.booking_quote || p.booking_url || null }),
    c('has_payment_system', !!p.payment_system,
      { payment_url: p.payment_system || null }),
    c('has_chatbot', !!p.chatbot,
      { vendor: p.chatbot || null }),
    c('has_crm_signal', !!p.crm_detected,
      { vendor: p.crm_detected || null }),
  ];
}

// ---------- Catégorie C : Automatisations / tracking (cri 19-21) -------------

function evalAutomation(input) {
  const p = input.site_profile || {};
  return [
    c('automations_detected', !!p.automations ? 1 : 0,
      { automations: Array.isArray(p.automations) ? p.automations : [] }),
    c('has_forms_count', linear(p.form_count || 0, 1, 5),
      { form_count: p.form_count || 0 }),
    c('has_tracking_pixels', Array.isArray(p.tracking) && p.tracking.length > 0 ? 1 : 0,
      { pixels: p.tracking || [] }),
  ];
}

// ---------- Catégorie D : Réputation / Google (cri 22-27) --------------------

function evalReputation(input) {
  const g = input.gbusiness || {};
  const rating = Number(g.rating) || 0;
  const reviews = Number(g.review_count) || 0;
  const responseRate = Number(g.response_rate) || 0; // 0-1
  const issuesSev = MapIssueSeverity(g.top_issues);
  const trend = g.trend || 'unknown';
  let trendVal = 0;
  if (trend === 'up') trendVal = 1;
  else if (trend === 'flat') trendVal = 0.5;
  else if (trend === 'down') trendVal = 0;
  // 'unknown' (ou pas de signal) → 0 par défaut pour ne pas gonfler artificiellement
  // le score quand aucune donnée réelle n'est disponible.

  return [
    c('has_google_business_profile', !!g.url || !!g.name ? 1 : 0,
      { url: g.url || null, name: g.name || null }),
    c('google_rating', rating ? linear(rating, 3.0, 4.8) : 0,
      { rating, target: 4.5 }),
    c('review_count_bucket', reviews ? linear(reviews, 5, 200) : 0,
      { review_count: reviews, target: 50 }),
    c('review_response_rate', clamp01(responseRate),
      { response_rate: responseRate }),
    c('negative_review_issues_severity', issuesSev,
      { top_issues: g.top_issues || [] }),
    c('review_trend', trendVal,
      { trend }),
  ];
}

function MapIssueSeverity(issues) {
  if (!Array.isArray(issues) || issues.length === 0) return 0;
  // Pondère par mots-clés fréquents — 0 à 1.
  const costly = /attente|réponse|sav|service|client|téléphone|injoign|rappel/i;
  let hits = 0;
  let n = 0;
  for (const it of issues) {
    n++;
    if (costly.test(String(it))) hits++;
  }
  if (n === 0) return 0;
  return clamp01(hits / n);
}

// ---------- Catégorie E : Réseaux sociaux (cri 28-33) -----------------------

function evalSocial(input) {
  const s = input.social || {};
  const handles = s.handles || {};
  const presence = ['facebook', 'instagram', 'linkedin', 'tiktok'];
  // Pré-normalise les valeurs 0-1
  const activity = clamp01(Number(s.activity_score));
  const engagement = clamp01(Number(s.engagement_score));
  const presenceNum = presence.reduce((acc, k) => acc + (handles[k] ? 1 : 0), 0) / presence.length;

  return [
    c('facebook_present', handles.facebook ? 1 : 0, { handle: handles.facebook || null }),
    c('instagram_present', handles.instagram ? 1 : 0, { handle: handles.instagram || null }),
    c('linkedin_present', handles.linkedin ? 1 : 0, { handle: handles.linkedin || null }),
    c('tiktok_present', handles.tiktok ? 1 : 0, { handle: handles.tiktok || null }),
    c('social_activity_score', activity,
      { posts_per_week: s.posts_per_week ?? null, activity_score: activity }),
    c('social_engagement_score', engagement,
      { engagement_rate: s.engagement_rate ?? null, engagement_score: engagement }),
    c('social_presence_coverage', presenceNum,
      { platforms: Object.keys(handles), coverage: presenceNum }),
  ];
}

// ---------- Catégorie F : Marketing / SEO / contenu (cri 34-38) -------------

function evalMarketing(input) {
  const m = input.marketing || {};
  const seo = clamp01(Number(m.local_seo_score));
  const words = Number(m.main_keywords_count) || 0;
  const ads = Array.isArray(m.ads_platforms) ? m.ads_platforms.filter(Boolean) : [];
  const cq = clamp01(Number(m.content_quality_score));
  const cf = clamp01(Number(m.content_freshness_days != null
    ? inverseLinear(m.content_freshness_days, 30, 730)
    : 0));

  return [
    c('local_seo_score', seo, { local_seo_score: seo, gbp: !!m.gbp_claimed }),
    c('main_keywords_bucket', linear(words, 0, 25),
      { keyword_count: words }),
    c('ads_detected', ads.length > 0 ? 1 : 0,
      { platforms: ads }),
    c('content_quality_score', cq, { content_quality_score: cq }),
    c('content_freshness', cf, { last_publish_days: m.content_freshness_days ?? null }),
  ];
}

// ---------- Catégorie G : Conformité / accessibilité publique (cri 39-42) ---

function evalAccessibility(input) {
  const e = input.contact || {};
  const l = input.legal || {};
  return [
    c('has_valid_email_public', e.email_ok === true ? 1 : 0,
      { email: e.email || null, mx_ok: !!e.mx_ok, smtp_ok: !!e.smtp_ok }),
    c('has_phone_reachable', e.phone_ok === true ? 1 : 0,
      { phone: e.phone || null, country_code: e.phone_country || null }),
    c('has_clear_address', !!e.address, { address: e.address || null }),
    c('has_legal_pages', (l.has_privacy ? 0.6 : 0) + (l.has_terms ? 0.4 : 0),
      { has_privacy: !!l.has_privacy, has_terms: !!l.has_terms }),
  ];
}

// ---------- Catégorie H : Signaux dérivés / métadonnées (cri 43-50) --------

function evalDerived(state_so_far, input) {
  // state_so_far est une lookup { criterion_id → Criterion }
  const cat = (catName) => Object.values(state_so_far)
    .filter((x) => x.category === catName);

  const digital = cat('site_profile').concat(cat('site_automation'));
  const trust = cat('reputation');
  const social = cat('social');
  const mkt = cat('marketing');
  const acc = cat('accessibility');

  const digital_maturity = avg(digital.map((x) => x.value));
  const trust_score = avg(trust.map((x) => x.value));
  const social_reach = avg(social.map((x) => x.value));
  const marketing_maturity = avg(mkt.map((x) => x.value));
  const accessibility = avg(acc.map((x) => x.value));

  // Complétude : % de critères à value > 0 sur les catégories "data" (A et G)
  const dataCats = cat('identity').concat(cat('accessibility'));
  const completeness = dataCats.length
    ? dataCats.filter((x) => x.value > 0).length / dataCats.length
    : 0;

  // Recency : moyenne pondérée des dates de scrape (en jours) → 0 si tout est vieux
  const sources = input.source_timestamps || {};
  const sourceKeys = Object.keys(sources).filter((k) => sources[k] != null);
  let recency = 0;
  if (sourceKeys.length) {
    const now = Date.now();
    const ages = sourceKeys.map((k) => {
      const t = new Date(sources[k]).getTime();
      if (!Number.isFinite(t)) return 365;
      return (now - t) / (1000 * 60 * 60 * 24);
    });
    recency = 1 - linear(avg(ages), 7, 120); // 7j → 1, 120j → 0
  }

  // opportunity_signal : agrège digital_maturity + trust + mkt — pondéré par accessibilité
  const opportunity_signal = clamp01(
    digital_maturity * 0.35 +
    trust_score * 0.25 +
    marketing_maturity * 0.20 +
    accessibility * 0.20,
  );

  return [
    c('digital_maturity_score', digital_maturity, { from: 'site_profile+site_automation' }),
    c('trust_score', trust_score, { from: 'reputation' }),
    c('social_reach_score', social_reach, { from: 'social' }),
    c('marketing_maturity_score', marketing_maturity, { from: 'marketing' }),
    c('data_completeness_score', completeness,
      { covered: dataCats.filter((x) => x.value > 0).length, total: dataCats.length }),
    c('data_recency_score', recency,
      { source_keys: sourceKeys, source_ages_days: sourceKeys.length }),
    c('opportunity_signal_strength', opportunity_signal,
      { from: 'digital*0.35 + trust*0.25 + marketing*0.20 + access*0.20' }),
  ];
}

// --------------------------------------------------------------------------
// Agrégats
// --------------------------------------------------------------------------

/** Calcule le score de besoin (0-100) :
 *   • critères 'positive' → 1-value (manque d'un signal positif = besoin)
 *   • critères 'negative' → value (sévérité du problème = besoin)
 *   • critères 'informational' → 0 (n'influence pas le besoin)
 *
 *  Le besoin total est la moyenne pondérée de ces contributions.
 *  Cela reflète l'idée : "ce qui manque" + "ce qui est problématique" = besoin.
 */
function calcNeedScore(breakdown) {
  const relevant = breakdown.filter((x) => x.direction !== 'informational');
  if (!relevant.length) return 0;
  const num = sum(relevant.map((x) => {
    const contrib = x.direction === 'negative' ? x.value : (1 - x.value);
    return contrib * x.weight;
  }));
  const den = sum(relevant.map((x) => x.weight)) || 1;
  return clampInt((num / den) * 100);
}

/** Calcule le score d'opportunité commerciale (0-100) :
 *  combine maturité digitale + accessibilité + reputation + accessibilité aux coordonnées. */
function calcOpportunityScore(breakdown) {
  const positive = breakdown.filter((x) => x.direction === 'positive');
  if (!positive.length) return 0;
  // Pondéré par weight (chaque métrique contribute value * weight).
  const num = sum(positive.map((x) => x.value * x.weight));
  const den = sum(positive.map((x) => x.weight)) || 1;
  return clampInt((num / den) * 100);
}

/** Calcule la confiance de l'analyse (0-100), dérivée de la qualité des sources. */
function calcConfidenceScore(breakdown) {
  const completeness = breakdown.find((x) => x.id === 'data_completeness_score')?.value || 0;
  const recency = breakdown.find((x) => x.id === 'data_recency_score')?.value || 0;
  // Sites richement profilés (test réussis) ont un petit bonus
  const reachable = breakdown.find((x) => x.id === 'site_status_reachable')?.value || 0;
  return clampInt(
    completeness * 60 +
    recency * 25 +
    reachable * 15,
  );
}

/** Mapping besoin+accessibilité → urgence.
 *  Seuils choisis pour coller au barème du framework 34 :
 *  0-30 faible, 31-60 modérée, 61-80 élevée, 81-100 critique. */
function calcUrgency(need, opportunity) {
  // Urgence principalement tirée par le besoin.
  // Modulée par accessibilité/opportunité — une entreprise inaccessible reste
  // urgente même si elle a du potentiel (sinon elle n'est pas adressable).
  if (need >= 81 || opportunity >= 81) return 'critique';
  if (need >= 61) return 'élevée';
  if (need >= 31) return 'modérée';
  return 'faible';
}

/** Risque de contact : accessibilité faible + confiance faible. */
function calcContactRisk(confidence, breakdown) {
  const acc = breakdown.find((x) => x.id === 'data_completeness_score')?.value || 0;
  const email = breakdown.find((x) => x.id === 'has_valid_email_public')?.value || 0;
  const phone = breakdown.find((x) => x.id === 'has_phone_reachable')?.value || 0;
  const address = breakdown.find((x) => x.id === 'has_clear_address')?.value || 0;
  const accessibility = avg([email, phone, address]);
  // Coefficients : confiance faible ET accessibilité faible = élevé
  const penalty = (1 - avg([confidence / 100, acc, accessibility])) * 100;
  if (penalty >= 60) return 'élevé';
  if (penalty >= 30) return 'moyen';
  return 'faible';
}

// --------------------------------------------------------------------------
// API publique
// --------------------------------------------------------------------------

/**
 * Calcule le breakdown complet + agrégats pour un NormalizedInput.
 * @param {NormalizedInput} input
 * @returns {{
 *   breakdown: Array<Criterion>,
 *   aggregate: {
 *     need_score, opportunity_score, confidence,
 *     urgency, contact_risk, category_scores,
 *     strengths: Array, weaknesses: Array, missing_data: Array,
 *     input_hash: string, computed_at: string
 *   }
 * }}
 */
function calc(input) {
  // Phase 1 : évaluateurs indépendants par catégorie
  const parts = []
    .concat(evalIdentity(input))
    .concat(evalSiteProfile(input))
    .concat(evalAutomation(input))
    .concat(evalReputation(input))
    .concat(evalSocial(input))
    .concat(evalMarketing(input))
    .concat(evalAccessibility(input));

  // Lookup pour évaluer la catégorie H qui agrège les précédentes.
  const lookup = {};
  for (const x of parts) lookup[x.id] = x;
  const derived = evalDerived(lookup, input);

  const breakdown = parts.concat(derived);

  // Phase 2 : agrégats
  const opportunity = calcOpportunityScore(breakdown);
  const need = calcNeedScore(breakdown);
  const confidence = calcConfidenceScore(breakdown);
  const urgency = calcUrgency(need, opportunity);
  const contact_risk = calcContactRisk(confidence, breakdown);

  // Catégorie-level snapshot
  const byCat = {};
  for (const x of breakdown) {
    if (!byCat[x.category]) byCat[x.category] = { sum: 0, n: 0, weight_sum: 0 };
    byCat[x.category].sum += x.value * x.weight;
    byCat[x.category].weight_sum += x.weight;
    byCat[x.category].n++;
  }
  const category_scores = {};
  for (const [k, v] of Object.entries(byCat)) {
    category_scores[k] = v.weight_sum > 0 ? clampInt((v.sum / v.weight_sum) * 100) : 0;
  }

  // Top forces / faiblesses
  const sortedPositive = breakdown
    .filter((x) => x.direction === 'positive' && x.value > 0)
    .sort((a, b) => (b.value * b.weight) - (a.value * a.weight));
  const sortedWeak = breakdown
    .filter((x) => x.direction !== 'informational')
    .sort((a, b) => (a.value * a.weight) - (b.value * b.weight));

  const strengths = sortedPositive.slice(0, 5).map((x) => ({
    id: x.id, label: x.label, value: x.value, weight: x.weight, evidence: x.evidence,
  }));
  const weaknesses = sortedWeak.slice(0, 5).map((x) => ({
    id: x.id, label: x.label, value: x.value, weight: x.weight, evidence: x.evidence,
  }));

  const missing_data = breakdown
    .filter((x) => x.direction === 'informational' && x.value === 0)
    .slice(0, 10)
    .map((x) => x.id);

  return {
    breakdown,
    aggregate: {
      need_score: need,
      opportunity_score: opportunity,
      confidence,
      urgency,
      contact_risk,
      category_scores,
      strengths,
      weaknesses,
      missing_data,
      input_hash: input.input_hash,
      computed_at: new Date().toISOString(),
    },
  };
}

/** Critères dont la valeur est 0 dans le calcul → "data manquante critique". */
function missingCriticalData(breakdown, topN = 5) {
  return breakdown
    .filter((x) => x.direction === 'negative' || x.direction === 'informational')
    .filter((x) => x.weight >= 0.05)
    .filter((x) => x.value === 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, topN)
    .map((x) => ({ id: x.id, label: x.label, weight: x.weight }));
}

module.exports = {
  CATEGORIES,
  calc,
  calcNeedScore,
  calcOpportunityScore,
  calcConfidenceScore,
  calcUrgency,
  calcContactRisk,
  missingCriticalData,
};
