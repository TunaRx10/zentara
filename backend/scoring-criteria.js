// scoring-criteria.js — Métadonnées des 50 critères du framework de scoring.
//
// Chaque critère est défini ici avec :
//   • id           → clé unique
//   • label        → libellé court lisible
//   • category     → un des 8 groupes (A..H)
//   • direction    → 'positive'  : valeur haute = bon (maturité, signal)
//                    'negative'  : valeur basse = bon (absence de problème)
//                    'informational' : neutre / donnée brute, pas d'impact sur l'agrégat
//   • weight       → poids dans la catégorie (somme ≈ 1 par catégorie non-info)
//
// SOMME des poids par catégorie ≈ 1.0 pour les catégories contributives.
// Le scoring-engine.js s'appuie sur ces poids pour l'agrégation déterministe.
//
// Total de critères définis ici : 50 (strictement).
'use strict';

const RAW = [
  // ============ Catégorie A : Identité / complétude des données (8) ============
  ['A', 'name_provided',                 { label: 'Nom de l\'entreprise',           direction: 'informational', weight: 0.10 }],
  ['A', 'sector_provided',               { label: 'Secteur d\'activité',            direction: 'informational', weight: 0.15 }],
  ['A', 'subsector_provided',            { label: 'Sous-secteur',                   direction: 'informational', weight: 0.10 }],
  ['A', 'location_provided',             { label: 'Localisation (ville / pays)',    direction: 'informational', weight: 0.10 }],
  ['A', 'area_served_provided',          { label: 'Zone desservie',                 direction: 'informational', weight: 0.10 }],
  ['A', 'company_size_provided',         { label: 'Taille de l\'entreprise',        direction: 'informational', weight: 0.15 }],
  ['A', 'founded_year_provided',         { label: 'Année de création',              direction: 'informational', weight: 0.10 }],
  ['A', 'company_age_years',             { label: 'Ancienneté (années)',            direction: 'positive',       weight: 0.20 }],

  // ============ Catégorie B : Présence digitale site (10) ====================
  ['B', 'website_present',               { label: 'Présence d\'un site web',        direction: 'positive',       weight: 0.05 }],
  ['B', 'site_status_reachable',         { label: 'Site joignable (HTTP 200)',      direction: 'positive',       weight: 0.10 }],
  ['B', 'mobile_quality_score',          { label: 'Qualité mobile du site',         direction: 'positive',       weight: 0.10 }],
  ['B', 'site_speed_score',              { label: 'Rapidité du site',               direction: 'positive',       weight: 0.10 }],
  ['B', 'has_main_cta',                  { label: 'CTA principal identifiable',     direction: 'positive',       weight: 0.10 }],
  ['B', 'has_contact_form',              { label: 'Formulaire de contact',          direction: 'positive',       weight: 0.10 }],
  ['B', 'has_booking_or_quote',          { label: 'Système de réservation/devis',   direction: 'positive',       weight: 0.15 }],
  ['B', 'has_payment_system',            { label: 'Système de paiement en ligne',   direction: 'positive',       weight: 0.15 }],
  ['B', 'has_chatbot',                   { label: 'Chatbot présent',                direction: 'positive',       weight: 0.05 }],
  ['B', 'has_crm_signal',                { label: 'CRM détecté',                    direction: 'positive',       weight: 0.10 }],

  // ============ Catégorie C : Automatisation (3) =============================
  ['C', 'automations_detected',          { label: 'Automatisations marketing/web',  direction: 'positive',       weight: 0.45 }],
  ['C', 'has_forms_count',               { label: 'Volume de formulaires',          direction: 'positive',       weight: 0.30 }],
  ['C', 'has_tracking_pixels',           { label: 'Pixels de tracking installés',   direction: 'positive',       weight: 0.25 }],

  // ============ Catégorie D : Réputation / Google (6) ========================
  ['D', 'has_google_business_profile',   { label: 'Fiche Google Business Profile',  direction: 'positive',       weight: 0.15 }],
  ['D', 'google_rating',                 { label: 'Note Google (>= 4.5)',           direction: 'positive',       weight: 0.20 }],
  ['D', 'review_count_bucket',           { label: 'Volume d\'avis Google',          direction: 'positive',       weight: 0.10 }],
  ['D', 'review_response_rate',          { label: 'Taux de réponse aux avis',       direction: 'positive',       weight: 0.20 }],
  ['D', 'negative_review_issues_severity',{ label: 'Problèmes graves dans les avis', direction: 'negative',       weight: 0.25 }],
  ['D', 'review_trend',                  { label: 'Tendance des avis (↑)',         direction: 'positive',       weight: 0.10 }],

  // ============ Catégorie E : Réseaux sociaux (7) ============================
  ['E', 'facebook_present',              { label: 'Page Facebook',                  direction: 'positive',       weight: 0.10 }],
  ['E', 'instagram_present',             { label: 'Compte Instagram',               direction: 'positive',       weight: 0.10 }],
  ['E', 'linkedin_present',              { label: 'Page LinkedIn',                  direction: 'positive',       weight: 0.15 }],
  ['E', 'tiktok_present',                { label: 'Compte TikTok',                  direction: 'positive',       weight: 0.10 }],
  ['E', 'social_activity_score',         { label: 'Activité sociale (posts/sem)',   direction: 'positive',       weight: 0.20 }],
  ['E', 'social_engagement_score',       { label: 'Engagement social',              direction: 'positive',       weight: 0.20 }],
  ['E', 'social_presence_coverage',      { label: 'Couverture multi-plateformes',   direction: 'positive',       weight: 0.15 }],

  // ============ Catégorie F : Marketing / SEO / contenu (5) ==================
  ['F', 'local_seo_score',               { label: 'SEO local',                      direction: 'positive',       weight: 0.25 }],
  ['F', 'main_keywords_bucket',          { label: 'Mots-clés principaux',           direction: 'positive',       weight: 0.15 }],
  ['F', 'ads_detected',                  { label: 'Publicité active (Ads)',         direction: 'positive',       weight: 0.20 }],
  ['F', 'content_quality_score',         { label: 'Qualité du contenu éditorial',   direction: 'positive',       weight: 0.20 }],
  ['F', 'content_freshness',             { label: 'Fraîcheur du contenu',           direction: 'positive',       weight: 0.20 }],

  // ============ Catégorie G : Conformité / accessibilité publique (4) =======
  ['G', 'has_valid_email_public',        { label: 'Email public valide',            direction: 'positive',       weight: 0.30 }],
  ['G', 'has_phone_reachable',           { label: 'Téléphone joignable',            direction: 'positive',       weight: 0.30 }],
  ['G', 'has_clear_address',             { label: 'Adresse postale claire',         direction: 'positive',       weight: 0.20 }],
  ['G', 'has_legal_pages',               { label: 'Pages légales (CGU/RGPD)',       direction: 'positive',       weight: 0.20 }],

  // ============ Catégorie H : Signaux dérivés / métadonnées (8) =============
  ['H', 'digital_maturity_score',        { label: 'Maturité digitale (composite)',  direction: 'positive',       weight: 0.25 }],
  ['H', 'trust_score',                   { label: 'Score de confiance (composite)', direction: 'positive',       weight: 0.15 }],
  ['H', 'social_reach_score',            { label: 'Portée sociale (composite)',     direction: 'positive',       weight: 0.10 }],
  ['H', 'marketing_maturity_score',      { label: 'Maturité marketing (composite)', direction: 'positive',       weight: 0.20 }],
  ['H', 'data_completeness_score',       { label: 'Complétude des données',         direction: 'informational', weight: 0.10 }],
  ['H', 'data_recency_score',            { label: 'Fraîcheur des données',          direction: 'informational', weight: 0.10 }],
  ['H', 'opportunity_signal_strength',   { label: 'Force du signal d\'opportunité', direction: 'positive',       weight: 0.20 }],
];

const CRITERIA = RAW.map(([category, id, meta]) => ({
  category, id, label: meta.label, direction: meta.direction, weight: meta.weight,
}));

const BY_ID = Object.fromEntries(CRITERIA.map((x) => [x.id, x]));

const CATEGORIES = ['identity', 'site_profile', 'site_automation', 'reputation', 'social', 'marketing', 'accessibility', 'derived'];

// Mapping interne prod-friendly à ce que scoring-engine.js utilise
const CATEGORY_CODE_TO_NAME = {
  A: 'identity',
  B: 'site_profile',
  C: 'site_automation',
  D: 'reputation',
  E: 'social',
  F: 'marketing',
  G: 'accessibility',
  H: 'derived',
};

// Ré-export avec normalisation des noms de catégorie vers ce que scoring-engine.js attend.
const NORMALIZED = CRITERIA.map((c) => ({ ...c, category: CATEGORY_CODE_TO_NAME[c.category] || c.category }));
const NORMALIZED_BY_ID = Object.fromEntries(NORMALIZED.map((x) => [x.id, x]));

if (NORMALIZED.length !== 50) {
  throw new Error(`scoring-criteria.js: 50 critères attendus, ${NORMALIZED.length} trouvés`);
}

module.exports = {
  CRITERIA: NORMALIZED,
  BY_ID: NORMALIZED_BY_ID,
  CATEGORIES,
  TOTAL: NORMALIZED.length,
};
