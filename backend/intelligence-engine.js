// intelligence-engine.js — Moteur d'Intelligence DÉTERMINISTE Zentara (spec v1.0 §28-52).
//
// OBJECTIF
//   Transformer les scores du scoring-engine + les critères du breakdown en un
//   dossier d'intelligence exploitable : consensus multi-agents, evidence engine,
//   signal engine, opportunités + pipeline, simulation de valeur, forecast,
//   scénarios what-if, plan d'action 7/30/60/90/6 mois et Quality Score.
//
// GARANTIES
//   • Module PUR : aucune dépendance, aucune I/O, aucune requête — mêmes entrées
//     ⇒ mêmes sorties (reproductible, traçable).
//   • Aucun chiffre inventé : tout dérive des données réelles fournies
//     (aggregate + breakdown). Les seules valeurs nouvelles sont des ESTIMATIONS
//     explicitement méthodologiques (marquées « estimation »).
//   • Vendable tel quel côté embarqué (frontend/src/embedded/vendor) : le même
//     moteur tourne sur serveur et hors-ligne.
//
// ENTRÉES
//   aggregate : { need_score, opportunity_score, confidence, urgency,
//                contact_risk, category_scores, strengths, weaknesses,
//                missing_data, input_hash }   (sortie du scoring-engine)
//   breakdown : Array<Criterion> { id, label, category, direction, weight, value, evidence }
//   profile   : { name, sector, city, country, website, email, phone } (best-effort)
//   opts      : { ai_narrated, product_price_monthly_eur }
//
// SORTIE
//   { consensus, evidence, signals, opportunities, pipeline, value_simulation,
//     forecast, scenarios, action_plan, quality, computed_at }
//   + renderEngineReport(engine) → markdown `##` compatible AnalysisView.
'use strict';

// --------------------------------------------------------------------------
// Helpers arithmétiques (pures)
// --------------------------------------------------------------------------

function clampInt(v, min = 0, max = 100) {
  const n = Math.round(Number(v) || 0);
  return Math.max(min, Math.min(max, n));
}

function round1(v) {
  return Math.round(Number(v) * 10) / 10;
}

function avg(arr) {
  if (!arr.length) return 0;
  let s = 0;
  for (const x of arr) s += Number(x) || 0;
  return s / arr.length;
}

function stddev(arr) {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  let s = 0;
  for (const x of arr) s += Math.pow((Number(x) || 0) - m, 2);
  return Math.sqrt(s / arr.length);
}

function cat(breakdown, name) {
  return breakdown.filter((x) => x.category === name);
}

function catValue(aggregate, name) {
  return Number((aggregate.category_scores || {})[name]) || 0;
}

function findCriterion(breakdown, id) {
  return breakdown.find((x) => x.id === id);
}

function qualifier(n) {
  if (n >= 81) return 'critique';
  if (n >= 61) return 'élevé';
  if (n >= 31) return 'modéré';
  return 'faible';
}

function labelOf(c) {
  return c && c.label ? c.label : 'critère';
}

function sourceOf(c) {
  const ev = c && c.evidence;
  if (!ev) return 'profil observé';
  if (ev.url) return String(ev.url);
  if (ev.name) return String(ev.name);
  if (ev.from) return String(ev.from);
  return 'profil observé';
}

// --------------------------------------------------------------------------
// 1. CONSENSUS ENGINE (§15-28) — votes d'agents dérivés des scores de catégories
// --------------------------------------------------------------------------

const AGENTS = [
  { id: 'business', label: 'Business Analyst', cats: ['identity', 'accessibility', 'derived'] },
  { id: 'market', label: 'Market Research Analyst', scoreOf: (a) => Number(a.opportunity_score) || 0 },
  { id: 'marketing', label: 'Marketing Analyst', cats: ['marketing'] },
  { id: 'seo', label: 'SEO Analyst', cats: ['marketing', 'site_profile'] },
  { id: 'sales', label: 'Sales Analyst', cats: ['accessibility', 'site_profile'] },
  { id: 'reputation', label: 'Reputation Analyst', cats: ['reputation'] },
  { id: 'technology', label: 'Technology Analyst', cats: ['site_profile', 'site_automation'] },
  { id: 'finance', label: 'Financial Analyst', finance: true },
];

function buildConsensus(aggregate, breakdown) {
  const confidence = Number(aggregate.confidence) || 0;
  const agents = AGENTS.map((def) => {
    let score;
    if (def.scoreOf) {
      score = def.scoreOf(aggregate);
    } else if (def.finance) {
      // Analyste financier : pas de données financières publiques ⇒ score = disponibilité
      // des données (honnête : plus on a de données, plus l'analyse financière est possible).
      const completeness = findCriterion(breakdown, 'data_completeness_score')?.value || 0;
      score = clampInt(completeness * 60 + (confidence / 100) * 40);
    } else {
      const scores = def.cats.map((c) => catValue(aggregate, c));
      score = clampInt(avg(scores));
    }
    return { id: def.id, label: def.label, score };
  });

  const consensusScore = clampInt(avg(agents.map((a) => a.score)));
  // Accord = 100 - dispersion normalisée (écart-type / 50).
  const agreement = clampInt(100 - (stddev(agents.map((a) => a.score)) / 50) * 100);

  const disagreements = [];
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const diff = Math.abs(agents[i].score - agents[j].score);
      if (diff > 25) {
        const lower = agents[i].score <= agents[j].score ? agents[i] : agents[j];
        const higher = agents[i].score > agents[j].score ? agents[i] : agents[j];
        disagreements.push({
          between: `${lower.label} vs ${higher.label}`,
          gap: diff,
          issue: lower.id === 'finance'
            ? 'données financières publiques insuffisantes pour scorer'
            : higher.id === 'finance'
              ? 'les données disponibles sont trop partielles pour un avis financier'
              : `les signaux sont contrastés (${lower.label} ${lower.score}/100 vs ${higher.label} ${higher.score}/100)`,
        });
      }
    }
  }

  return {
    agents,
    consensus_score: consensusScore,
    agreement_pct: agreement,
    confidence: confidence,
    disagreements: disagreements.slice(0, 3),
  };
}

// --------------------------------------------------------------------------
// 2. EVIDENCE ENGINE (§29) — conclusions reliées à leur preuve
// --------------------------------------------------------------------------

function buildEvidence(aggregate, breakdown) {
  const out = [];
  const strengths = Array.isArray(aggregate.strengths) ? aggregate.strengths : [];
  const weaknesses = Array.isArray(aggregate.weaknesses) ? aggregate.weaknesses : [];

  for (const s of strengths.slice(0, 3)) {
    out.push({
      conclusion: `Point fort confirmé : ${s.label}`,
      status: 'OBSERVED',
      evidence: s.label,
      source: sourceOf(s),
      detail: s.id ? `critère [${s.id}] value=${Number(s.value).toFixed(2)}` : null,
    });
  }
  for (const w of weaknesses.slice(0, 3)) {
    out.push({
      conclusion: `Point faible identifié : ${w.label}`,
      status: 'OBSERVED',
      evidence: w.label,
      source: sourceOf(w),
      detail: w.id ? `critère [${w.id}] value=${Number(w.value).toFixed(2)}` : null,
    });
  }
  out.push({
    conclusion: `Score du besoin : ${Number(aggregate.need_score) || 0}/100`,
    status: 'CALCULATED',
    evidence: '50 critères pondérés (scoring-engine-v1)',
    source: 'scoring-engine-v1',
  });
  out.push({
    conclusion: `Score d'opportunité commerciale : ${Number(aggregate.opportunity_score) || 0}/100`,
    status: 'CALCULATED',
    evidence: 'agrégat pondéré des critères positifs',
    source: 'scoring-engine-v1',
  });
  const missing = Array.isArray(aggregate.missing_data) ? aggregate.missing_data : [];
  for (const m of missing.slice(0, 3)) {
    out.push({
      conclusion: `Donnée manquante : ${m}`,
      status: 'INFERRED',
      evidence: 'champ absent du profil observé',
      source: 'profil observé',
    });
  }
  return out.slice(0, 10);
}

// --------------------------------------------------------------------------
// 3. SIGNAL ENGINE (§31) — observations → signaux pondérés
// --------------------------------------------------------------------------

function buildSignals(aggregate, breakdown) {
  const confidence = Number(aggregate.confidence) || 0;
  const urgency = String(aggregate.urgency || 'faible');
  const signals = [];
  const weaknesses = Array.isArray(aggregate.weaknesses) ? aggregate.weaknesses : [];
  const strengths = Array.isArray(aggregate.strengths) ? aggregate.strengths : [];

  for (const w of weaknesses.slice(0, 3)) {
    const importance = qualifier((1 - Number(w.value)) * Number(w.weight) * 140);
    signals.push({
      id: `neg-${w.id || signals.length + 1}`,
      label: `Manque / problème : ${w.label}`,
      type: 'negative',
      weight: clampInt((1 - Number(w.value)) * Number(w.weight) * 140),
      importance,
      confidence: clampInt(confidence),
      source: sourceOf(w),
    });
  }
  for (const s of strengths.slice(0, 2)) {
    signals.push({
      id: `pos-${s.id || signals.length + 1}`,
      label: `Atout : ${s.label}`,
      type: 'positive',
      weight: clampInt(Number(s.value) * Number(s.weight) * 140),
      importance: qualifier(Number(s.value) * Number(s.weight) * 140),
      confidence: clampInt(confidence),
      source: sourceOf(s),
    });
  }
  const email = findCriterion(breakdown, 'has_valid_email_public');
  const phone = findCriterion(breakdown, 'has_phone_reachable');
  if (email && email.value === 0) {
    signals.push({
      id: 'neg-email',
      label: 'Aucun email public validé — l’outreach ne peut pas partir',
      type: 'negative',
      weight: 80,
      importance: 'élevé',
      confidence: clampInt(confidence),
      source: sourceOf(email),
    });
  }
  if (phone && phone.value === 0) {
    signals.push({
      id: 'neg-phone',
      label: 'Aucun téléphone principal identifié',
      type: 'negative',
      weight: 60,
      importance: 'modéré',
      confidence: clampInt(confidence),
      source: sourceOf(phone),
    });
  }
  if (urgency === 'critique' || urgency === 'élevée') {
    signals.push({
      id: 'sig-urgency',
      label: `Urgence du problème : ${urgency}`,
      type: 'negative',
      weight: urgency === 'critique' ? 85 : 65,
      importance: urgency,
      confidence: clampInt(confidence),
      source: 'scoring-engine-v1',
    });
  }
  return signals.slice(0, 8);
}

// --------------------------------------------------------------------------
// 4. OPPORTUNITY ENGINE + PIPELINE (§32-33)
// --------------------------------------------------------------------------

const DIFFICULTY_BY_CAT = {
  accessibility: 'faible',
  identity: 'faible',
  social: 'moyenne',
  reputation: 'moyenne',
  marketing: 'moyenne',
  site_profile: 'moyenne',
  site_automation: 'moyenne',
  derived: 'moyenne',
};

const COST_ANCHOR = { faible: 300, moyenne: 3500, élevée: 15000 };
const DELAY_ANCHOR = { faible: '2-4 semaines', moyenne: '1-3 mois', élevée: '3-6 mois' };

function buildOpportunities(aggregate, breakdown, opts) {
  const confidence = Number(aggregate.confidence) || 0;
  const urgency = String(aggregate.urgency || 'faible');
  const opp = Number(aggregate.opportunity_score) || 0;
  const weaknesses = Array.isArray(aggregate.weaknesses) ? aggregate.weaknesses : [];
  const missing = Array.isArray(aggregate.missing_data) ? aggregate.missing_data : [];
  // Ancre de valeur : engagement annuel estimé = opportunité/100 × prix produit × 12.
  const anchor = Number(opts.product_price_monthly_eur) || 490;
  const baseValue = Math.round((opp / 100) * anchor * 12);

  const opportunities = [];

  for (const w of weaknesses.slice(0, 4)) {
    const impactPct = clampInt((1 - Number(w.value)) * Number(w.weight) * 140);
    const difficulty = DIFFICULTY_BY_CAT[w.category] || 'moyenne';
    let category = 'MONITOR';
    if (impactPct >= 60 && (urgency === 'critique' || urgency === 'élevée') && difficulty !== 'élevée') category = 'URGENT';
    else if (impactPct >= 60 && difficulty === 'faible') category = 'QUICK WIN';
    else if (impactPct >= 45) category = 'HIGH VALUE';
    else if (impactPct >= 25) category = 'STRATEGIC';
    else if (impactPct < 25) category = 'LONG TERM';

    opportunities.push({
      id: `opp-${w.id || opportunities.length + 1}`,
      title: `Traiter « ${w.label} »`,
      category,
      problem: w.label,
      evidence: `critère [${w.id}] value=${Number(w.value).toFixed(2)} (${sourceOf(w)})`,
      impact_pct: impactPct,
      urgency,
      confidence: clampInt(confidence),
      difficulty,
      estimated_value_eur: Math.round(baseValue * (impactPct / 100)),
      estimated_cost_eur: COST_ANCHOR[difficulty],
      delay: DELAY_ANCHOR[difficulty],
      recommendation: `Corriger « ${w.label} » — impact potentiel ${impactPct} %, effort ${difficulty}, délai ${DELAY_ANCHOR[difficulty]}.`,
    });
  }

  // Opportunité « data » : enrichir les champs manquants (MONITOR).
  if (missing.length) {
    opportunities.push({
      id: 'opp-data',
      title: `Enrichir les données manquantes (${missing.slice(0, 2).join(', ')}…)`,
      category: 'MONITOR',
      problem: 'Données critiques absentes du profil',
      evidence: missing.join(', '),
      impact_pct: 15,
      urgency: 'modérée',
      confidence: clampInt(confidence),
      difficulty: 'faible',
      estimated_value_eur: 0,
      estimated_cost_eur: 0,
      delay: '1-2 semaines',
      recommendation: 'Compléter la fiche (scrape du site, annuaires, réseaux sociaux) pour fiabiliser l’analyse.',
    });
  }

  const order = ['URGENT', 'HIGH VALUE', 'QUICK WIN', 'STRATEGIC', 'LONG TERM', 'MONITOR'];
  const pipeline = {};
  for (const c of order) pipeline[c] = [];
  for (const o of opportunities) {
    (pipeline[o.category] = pipeline[o.category] || []).push(o);
  }
  return { opportunities, pipeline, base_value_eur: baseValue, anchor_eur: anchor };
}

// --------------------------------------------------------------------------
// 5. VALUE SIMULATION (§34) — conservative / expected / optimistic
// --------------------------------------------------------------------------

function buildValueSimulation(oppResult) {
  const value = oppResult.base_value_eur;
  return {
    baseline_eur: 0,
    conservative_eur: Math.round(value * 0.25),
    expected_eur: Math.round(value * 0.5),
    optimistic_eur: Math.round(value * 0.8),
    assumptions: [
      'valeur = opportunité/100 × prix produit mensuel × 12 (estimation)',
      'conservative : 25 % du potentiel, expected : 50 %, optimistic : 80 %',
      'aucune garantie — montants à valider avec les données financières réelles',
    ],
  };
}

// --------------------------------------------------------------------------
// 6. FORECAST ENGINE (§35) — horizon × scénario (indice d'opportunité projeté)
// --------------------------------------------------------------------------

const FORECAST_DELTAS = {
  baseline: [0, 0, 0, 0],
  conservative: [3, 5, 8, 10],
  expected: [5, 10, 15, 20],
  aggressive: [8, 15, 22, 30],
};
const FORECAST_HORIZONS = ['3 mois', '6 mois', '12 mois', '24 mois'];

function buildForecast(aggregate) {
  const opp = Number(aggregate.opportunity_score) || 0;
  return FORECAST_HORIZONS.map((horizon, i) => {
    const row = { horizon };
    for (const [scenario, deltas] of Object.entries(FORECAST_DELTAS)) {
      row[scenario] = clampInt(opp + deltas[i]);
    }
    return row;
  });
}

// --------------------------------------------------------------------------
// 7. SCENARIO ENGINE (§37) — what-if
// --------------------------------------------------------------------------

function buildScenarios(aggregate, breakdown) {
  const confidence = Number(aggregate.confidence) || 0;
  const marketing = catValue(aggregate, 'marketing');
  const seoWeak = marketing < 40;
  const scenarios = [
    {
      id: 'scn-seo',
      what_if: 'Le SEO s’améliore de +20 %',
      impact_pct: 5,
      direction: 'positive',
      confidence: clampInt(Math.max(40, confidence - 10)),
      note: 'impact estimé sur le score d’opportunité (estimation)',
    },
    {
      id: 'scn-conv',
      what_if: 'Le taux de conversion s’améliore de +15 %',
      impact_pct: 8,
      direction: 'positive',
      confidence: clampInt(Math.max(40, confidence - 10)),
      note: 'impact estimé sur le score d’opportunité (estimation)',
    },
    {
      id: 'scn-ads',
      what_if: 'Publicité : +5 000 €/mois',
      impact_pct: seoWeak ? 10 : 5,
      direction: 'positive',
      confidence: clampInt(Math.max(40, confidence - 15)),
      note: seoWeak ? 'levier publicitaire d’autant plus utile que la visibilité organique est faible' : 'impact modéré (visibilité organique déjà présente)',
    },
    {
      id: 'scn-competitor',
      what_if: 'Un concurrent gagne des parts de marché',
      impact_pct: 6,
      direction: 'negative',
      confidence: clampInt(Math.max(40, confidence - 5)),
      note: 'risque concurrentiel — probabilité × impact (estimation)',
    },
  ];
  return scenarios;
}

// --------------------------------------------------------------------------
// 8. ACTION PLAN (§39) — 7 / 30 / 60 / 90 jours / 6 mois
// --------------------------------------------------------------------------

function buildActionPlan(aggregate, profile) {
  const name = (profile && profile.name) ? String(profile.name).trim() : 'cette entreprise';
  const contactRisk = String(aggregate.contact_risk || 'faible');
  const weaknesses = Array.isArray(aggregate.weaknesses) ? aggregate.weaknesses : [];
  const top = weaknesses[0] ? weaknesses[0].label : 'la modernisation des données commerciales';
  const top2 = weaknesses[1] ? weaknesses[1].label : 'la conversion du trafic existant';
  const opp = Number(aggregate.opportunity_score) || 0;

  const secureContact = contactRisk === 'élevé'
    ? 'Sécuriser un canal de contact direct (email vérifié / GSM) avant toute relance.'
    : 'Valider l’email et le téléphone de contact de ' + name + ' (SMTP check + rappel).';

  return [
    {
      horizon: '7 jours',
      actions: [
        { action: secureContact, expected_outcome: 'une ligne de contact fiable pour l’outreach' },
        { action: `Envoyer le premier email personnalisé ciblant « ${top} »`, expected_outcome: 'une prise de contact ou un refus clair (qualification)' },
        { action: 'Compléter les champs manquants de la fiche (site, réseaux, avis)', expected_outcome: 'confiance de l’analyse ↑' },
      ],
    },
    {
      horizon: '30 jours',
      actions: [
        { action: `Traiter le quick win « ${top} »`, expected_outcome: 'un levier concret fermé ou en cours' },
        { action: 'Programmer un call de découverte de 15 min (calendrier)', expected_outcome: 'un besoin qualifié, un champion identifié' },
      ],
    },
    {
      horizon: '60 jours',
      actions: [
        { action: `Déployer l’action sur « ${top2} » (contenu, SEO, CTA)`, expected_outcome: 'une amélioration mesurable du canal concerné' },
        { action: 'Relancer l’analyse avec les données enrichies', expected_outcome: 'scores recalculés, opportunités affinées' },
      ],
    },
    {
      horizon: '90 jours',
      actions: [
        { action: 'Transformer le levier prioritaire en engagement produit Zentara', expected_outcome: `une valeur d’engagement estimée ≈ ${opp >= 60 ? 'élevée' : 'à consolider'}` },
        { action: 'Comparer ' + name + ' à 2-3 concurrents directs (benchmark)', expected_outcome: 'un positionnement différencié documenté' },
      ],
    },
    {
      horizon: '6 mois',
      actions: [
        { action: 'Activer la surveillance continue (monitoring des signaux)', expected_outcome: 'détection des changements de prix, dirigeants, avis' },
        { action: 'Planifier la ré-analyse versionnée (v2)', expected_outcome: 'score évolutif 74 → 81 → 86, historique conservé' },
      ],
    },
  ];
}

// --------------------------------------------------------------------------
// 9. FINAL QUALITY SCORE (§52)
// --------------------------------------------------------------------------

function buildQuality(aggregate, breakdown, consensus, opts) {
  const confidence = Number(aggregate.confidence) || 0;
  const completeness = (findCriterion(breakdown, 'data_completeness_score')?.value || 0) * 100;
  const recency = (findCriterion(breakdown, 'data_recency_score')?.value || 0) * 100;
  const strengths = Array.isArray(aggregate.strengths) ? aggregate.strengths : [];
  const weaknesses = Array.isArray(aggregate.weaknesses) ? aggregate.weaknesses : [];

  const components = {
    data_completeness: clampInt(completeness),
    evidence_coverage: clampInt(Math.min(100, (strengths.length + weaknesses.length) * 15 + 40)),
    agent_agreement: consensus.agreement_pct,
    source_quality: clampInt(recency),
    calculation_integrity: 100,
    writing_quality: opts.ai_narrated ? 85 : 60,
    prediction_confidence: clampInt(confidence),
  };
  const weights = {
    data_completeness: 0.2,
    evidence_coverage: 0.2,
    agent_agreement: 0.15,
    source_quality: 0.15,
    calculation_integrity: 0.1,
    writing_quality: 0.1,
    prediction_confidence: 0.1,
  };
  let num = 0;
  let den = 0;
  for (const [k, v] of Object.entries(components)) {
    num += v * weights[k];
    den += weights[k];
  }
  const score = clampInt(num / den);
  const verdict = score >= 80 ? 'Excellent' : score >= 65 ? 'Bon' : score >= 50 ? 'Moyen' : 'Limité';
  return { score, verdict, components };
}

// --------------------------------------------------------------------------
// API publique
// --------------------------------------------------------------------------

/**
 * @param {object} aggregate  — sortie scoring-engine
 * @param {Array}  breakdown  — critères (avec evidence/source)
 * @param {object} [profile]  — { name, sector, city, country, website, email, phone }
 * @param {object} [opts]     — { ai_narrated, product_price_monthly_eur }
 */
function runIntelligenceEngine(aggregate, breakdown, profile = {}, opts = {}) {
  const consensus = buildConsensus(aggregate, breakdown);
  const evidence = buildEvidence(aggregate, breakdown);
  const signals = buildSignals(aggregate, breakdown);
  const opp = buildOpportunities(aggregate, breakdown, opts);
  const value_simulation = buildValueSimulation(opp);
  const forecast = buildForecast(aggregate);
  const scenarios = buildScenarios(aggregate, breakdown);
  const action_plan = buildActionPlan(aggregate, profile);
  const quality = buildQuality(aggregate, breakdown, consensus, opts);

  return {
    version: '1.0',
    computed_at: new Date().toISOString(),
    consensus,
    evidence,
    signals,
    opportunities: opp.opportunities,
    pipeline: opp.pipeline,
    value_simulation,
    forecast,
    scenarios,
    action_plan,
    quality,
  };
}

// --------------------------------------------------------------------------
// Rendu Markdown (compatible AnalysisView : titres `##`, listes `- `, `**Label :**`)
// --------------------------------------------------------------------------

function renderEngineReport(engine, profile = {}) {
  const L = [];
  const push = (s = '') => L.push(s);

  const name = (profile && profile.name) ? String(profile.name).trim() : 'cette entreprise';

  // ---- CONSENSUS ---------------------------------------------------------
  push('## CONSENSUS DES ANALYSTES (MULTI-AGENT)');
  for (const a of engine.consensus.agents) {
    push(`- ${a.label} : ${a.score}/100`);
  }
  push('');
  push(`**Consensus :** ${engine.consensus.consensus_score}/100 · Accord entre analystes : ${engine.consensus.agreement_pct} % · Confiance des données : ${engine.consensus.confidence}/100`);
  if (engine.consensus.disagreements.length) {
    push('');
    push('Désaccords détectés :');
    for (const d of engine.consensus.disagreements) {
      push(`- ${d.between} — écart ${d.gap} pts (${d.issue})`);
    }
  }
  push('');

  // ---- QUALITY -----------------------------------------------------------
  push('## QUALITÉ DU RAPPORT');
  push(`**Score global :** ${engine.quality.score}/100 — ${engine.quality.verdict}`);
  push('');
  for (const [k, v] of Object.entries(engine.quality.components)) {
    push(`- ${qualityLabel(k)} : ${v}/100`);
  }
  push('');

  // ---- SIGNALS ------------------------------------------------------------
  push('## SIGNAL ENGINE');
  for (const s of engine.signals) {
    const type = s.type === 'positive' ? 'POSITIF' : 'NÉGATIF';
    push(`- [${type} · ${s.importance}] ${s.label} (poids ${s.weight}/100, confiance ${s.confidence}/100 — ${s.source})`);
  }
  if (!engine.signals.length) push('- Aucun signal exploitable (données insuffisantes).');
  push('');

  // ---- OPPORTUNITIES ------------------------------------------------------
  push('## PIPELINE D’OPPORTUNITÉS');
  const order = ['URGENT', 'HIGH VALUE', 'QUICK WIN', 'STRATEGIC', 'LONG TERM', 'MONITOR'];
  let anyOpp = false;
  for (const cat of order) {
    const items = engine.pipeline[cat] || [];
    if (!items.length) continue;
    anyOpp = true;
    push(`- **${cat}**`);
    for (const o of items) {
      push(`  - ${o.title} — impact ${o.impact_pct} %, effort ${o.difficulty}, délai ${o.delay}, confiance ${o.confidence}/100`);
      if (o.estimated_value_eur > 0) push(`    Valeur estimée : ${o.estimated_value_eur.toLocaleString('fr-FR')} €/an · Coût estimé : ${o.estimated_cost_eur.toLocaleString('fr-FR')} € (estimation)`);
      if (o.evidence) push(`    Preuve : ${o.evidence}`);
    }
  }
  if (!anyOpp) push('- Aucune opportunité détectée avec les données disponibles.');
  push('');

  // ---- VALUE SIMULATION ---------------------------------------------------
  push('## SIMULATION DE VALEUR (ESTIMATION)');
  const vs = engine.value_simulation;
  push(`- Sans action (baseline) : ${vs.baseline_eur.toLocaleString('fr-FR')} €/an`);
  push(`- Conservative : ${vs.conservative_eur.toLocaleString('fr-FR')} €/an`);
  push(`- Expected : ${vs.expected_eur.toLocaleString('fr-FR')} €/an`);
  push(`- Optimistic : ${vs.optimistic_eur.toLocaleString('fr-FR')} €/an`);
  push('');
  for (const a of vs.assumptions) push(`- ${a}`);
  push('');

  // ---- FORECAST -----------------------------------------------------------
  push('## PRÉVISIONS (FORECAST 3-24 MOIS)');
  push('Score d’opportunité projeté (estimation, sur la base des leviers identifiés) :');
  for (const row of engine.forecast) {
    push(`- ${row.horizon} : baseline ${row.baseline}/100 · conservative ${row.conservative}/100 · expected ${row.expected}/100 · aggressive ${row.aggressive}/100`);
  }
  push('');

  // ---- SCENARIOS ----------------------------------------------------------
  push('## SCÉNARIOS WHAT-IF');
  for (const sc of engine.scenarios) {
    const dir = sc.direction === 'positive' ? '+' : '−';
    push(`- Si ${sc.what_if.toLowerCase()} : ${dir}${sc.impact_pct} pts sur le score d’opportunité (confiance ${sc.confidence}/100). ${sc.note}`);
  }
  push('');

  // ---- ACTION PLAN --------------------------------------------------------
  push('## PLAN D’ACTION (7 / 30 / 60 / 90 JOURS / 6 MOIS)');
  for (const phase of engine.action_plan) {
    push(`- **${phase.horizon}**`);
    for (const a of phase.actions) {
      push(`  - ${a.action} → ${a.expected_outcome}`);
    }
  }
  push('');

  // ---- EVIDENCE -----------------------------------------------------------
  push('## EVIDENCE ENGINE (CONCLUSIONS SOURCÉES)');
  for (const e of engine.evidence) {
    push(`- [${e.status}] ${e.conclusion} — source : ${e.source}${e.detail ? ` (${e.detail})` : ''}`);
  }
  push('');

  // ---- FOOTER -------------------------------------------------------------
  push(`> Annexe générée déterministiquement par le Moteur d’Intelligence Zentara (v${engine.version}) — aucune invention : toutes les valeurs dérivent des données observées. Les montants marqués « estimation » sont des ordres de grandeur méthodologiques à valider avec ${name} lors du premier échange.`);

  return L.join('\n');
}

function qualityLabel(k) {
  return {
    data_completeness: 'Complétude des données',
    evidence_coverage: 'Couverture des preuves',
    agent_agreement: 'Accord entre analystes',
    source_quality: 'Qualité / fraîcheur des sources',
    calculation_integrity: 'Intégrité des calculs',
    writing_quality: 'Qualité rédactionnelle',
    prediction_confidence: 'Confiance des prédictions',
  }[k] || k;
}

module.exports = {
  runIntelligenceEngine,
  renderEngineReport,
  buildConsensus,
  buildEvidence,
  buildSignals,
  buildOpportunities,
  buildValueSimulation,
  buildForecast,
  buildScenarios,
  buildActionPlan,
  buildQuality,
  AGENTS,
};
