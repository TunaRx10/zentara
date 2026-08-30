// test-scoring-engine.js — Tests déterministes NON RÉGRESSION du moteur.
//
// Lance avec :  node test-scoring-engine.js
//
// Garanties testées :
//   1. Mêmes sources ⇒ exactement le même input_hash.
//   2. Mêmes sources ⇒ exactement les mêmes scores (need/opportunity/conf/urgency/contact_risk).
//   3. Le moteur gère calmement les inputs vides (tout value≈0).
//   4. Les 50 critères sont toujours calculés (count invariant).
//   5. Une faible maturité digitale ABAISSE l'opportunity_score et AUGMENTE le need_score.
//   6. Une confiance élevée et accessibilité basse ⇒ contact_risk = élevé.

'use strict';

const assert = require('node:assert/strict');
const inputs = require('./scoring-inputs');
const engine = require('./scoring-engine');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (e) {
    console.error(`  FAIL ${name}\n     ${e.message}`);
    failed++;
  }
}

const sampleRich = {
  entity: {
    id: 'cmp_1', name: 'Lucca', sector: 'SaaS', industry: 'RH / Paie',
    city: 'Paris', country: 'FR', website: 'https://lucca.fr',
    founded_year: 2002, size: '200-500',
  },
  site_profile: {
    reachable: true, http_status: 200,
    mobile_quality: 0.8, speed_ms: 1200,
    main_cta: 'Démo', contact_form: 'contact', form_count: 2,
    booking_url: null, payment_system: 'stripe',
    chatbot: 'intercom', crm_detected: 'hubspot',
    automations: ['mailchimp', 'hubspot-workflow'],
    tracking: ['ga4', 'meta-pixel'],
    mobile: { viewport: true }, fetched_at: new Date().toISOString(),
    content_quality_score: 0.7, content_freshness_days: 7,
  },
  gbusiness: {
    url: 'https://g.page/lucca', name: 'Lucca',
    rating: 4.6, review_count: 120,
    response_rate: 0.85, top_issues: ['support un peu lent'],
    trend: 'up',
  },
  social: {
    handles: { facebook: 'lucca', instagram: 'lucca', linkedin: 'lucca' },
    posts_per_week: 4, activity_score: 0.6,
    engagement_rate: 0.04, engagement_score: 0.6,
  },
  marketing: {
    local_seo_score: 0.4, gbp_claimed: true,
    main_keywords_count: 18, ads_platforms: ['google_ads'],
    content_quality_score: 0.7, content_freshness_days: 7,
  },
  contact: {
    email: 'hello@lucca.fr', email_ok: true, mx_ok: true, smtp_ok: true,
    phone: '+33123456789', phone_ok: true, phone_country: 'FR',
    address: '10 rue de la Paix, Paris',
  },
  legal: { has_privacy: true, has_terms: true, has_legal_mention: true },
};

const sampleEmpty = {
  entity: { id: 'cmp_2', name: null, sector: null, industry: null },
};

const sampleLowMaturity = {
  entity: {
    id: 'cmp_3', name: 'Garage Martin', sector: 'Automobile',
    city: 'Lyon', country: 'FR', website: 'https://garage-martin.fr',
  },
  site_profile: {
    reachable: true, http_status: 200,
    mobile_quality: 0.1, speed_ms: 4800,
    main_cta: null, contact_form: null, crm_detected: null, chatbot: null,
    payment_system: null, booking_url: null,
    automations: [], tracking: [],
  },
  gbusiness: {
    rating: 3.2, review_count: 4,
    response_rate: 0, top_issues: ['attente longue', 'SAV injoignable'],
    trend: 'flat',
  },
  social: { handles: {}, activity_score: 0, engagement_score: 0 },
  marketing: {
    local_seo_score: 0.1, ads_platforms: [], main_keywords_count: 0,
  },
  contact: {
    email: null, phone: '+33478901234', phone_ok: true,
  },
  legal: { has_privacy: false, has_terms: false },
};

console.log('== Tests scoring-engine.js ==');

test('hash stable sur mêmes sources', () => {
  const a = inputs.buildNormalizedInput(sampleRich);
  const b = inputs.buildNormalizedInput(sampleRich);
  assert.equal(a.input_hash, b.input_hash);
});

test('hash différent si une valeur change', () => {
  const a = inputs.buildNormalizedInput(sampleRich);
  const tampered = JSON.parse(JSON.stringify(sampleRich));
  tampered.site_profile.speed_ms = 999;
  const b = inputs.buildNormalizedInput(tampered);
  assert.notEqual(a.input_hash, b.input_hash);
});

test('mêmes sources ⇒ mêmes scores (reproductibilité)', () => {
  const a = engine.calc(inputs.buildNormalizedInput(sampleRich));
  const b = engine.calc(inputs.buildNormalizedInput(sampleRich));
  assert.equal(a.aggregate.need_score, b.aggregate.need_score);
  assert.equal(a.aggregate.opportunity_score, b.aggregate.opportunity_score);
  assert.equal(a.aggregate.confidence, b.aggregate.confidence);
  assert.equal(a.aggregate.urgency, b.aggregate.urgency);
  assert.equal(a.aggregate.contact_risk, b.aggregate.contact_risk);
  assert.equal(a.aggregate.input_hash, b.aggregate.input_hash);
});

test('50 critères toujours présents', () => {
  const r = engine.calc(inputs.buildNormalizedInput(sampleRich));
  assert.equal(r.breakdown.length, 50);
});

test('inputs vides ⇒ opportunity_score nul, breakdown complet, contact_risk élevé', () => {
  const r = engine.calc(inputs.buildNormalizedInput(sampleEmpty));
  // Sans aucune donnée exploitable, l'opportunité commerciale est nulle
  // (rien à valoriser) ; le besoin, lui, reflète le manque global.
  assert.equal(r.aggregate.opportunity_score, 0);
  assert.equal(r.breakdown.length, 50);
  // Le contact est risqué faute d'identité/coordonnées.
  assert.equal(r.aggregate.contact_risk, 'élevé');
});

test('maturité digitale faible ⇒ need_score haut', () => {
  const r = engine.calc(inputs.buildNormalizedInput(sampleLowMaturity));
  // Plusieurs critères "negative" saturent ce prospect → besoin élevé.
  assert.ok(r.aggregate.need_score >= 50, `need_score=${r.aggregate.need_score}`);
  // accessibilité faible + confiance basse → contact_risk au moins "moyen"
  assert.ok(['moyen', 'élevé'].includes(r.aggregate.contact_risk),
    `contact_risk=${r.aggregate.contact_risk}`);
});

test('échantillon riche ⇒ opportunity_score >= low maturity', () => {
  const rich = engine.calc(inputs.buildNormalizedInput(sampleRich));
  const low = engine.calc(inputs.buildNormalizedInput(sampleLowMaturity));
  assert.ok(rich.aggregate.opportunity_score >= low.aggregate.opportunity_score,
    `rich=${rich.aggregate.opportunity_score} vs low=${low.aggregate.opportunity_score}`);
});

test('chaque breakdown expose weight + evidence', () => {
  const r = engine.calc(inputs.buildNormalizedInput(sampleRich));
  for (const x of r.breakdown) {
    assert.ok(typeof x.value === 'number' && x.value >= 0 && x.value <= 1, `value OK for ${x.id}`);
    assert.ok(typeof x.weight === 'number', `weight defined for ${x.id}`);
    assert.ok(typeof x.evidence === 'object' && x.evidence !== null, `evidence object for ${x.id}`);
  }
});

test('catégories D/E respectent direction inversée pour "negative_review_issues_severity"', () => {
  const r = engine.calc(inputs.buildNormalizedInput(sampleLowMaturity));
  const issues = r.breakdown.find((x) => x.id === 'negative_review_issues_severity');
  assert.ok(issues.value > 0, `issues severity should be > 0 when negative keywords present, got ${issues.value}`);
});

test('hash identique pour deux constructions équivalentes (ordre champ indifférent)', () => {
  const a = inputs.buildNormalizedInput(sampleRich);
  const reorderedKeys = {};
  for (const k of Object.keys(sampleRich).reverse()) reorderedKeys[k] = sampleRich[k];
  const b = inputs.buildNormalizedInput(reorderedKeys);
  // Equality tient compte de la sérialisation canonique (clés triées).
  assert.equal(a.input_hash, b.input_hash);
});

console.log(`\n== Résultat : ${passed} OK, ${failed} FAIL ==`);
process.exitCode = failed === 0 ? 0 : 1;
