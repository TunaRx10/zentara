// scoring-adapter.js — Collecte et normalisation des sources pour une entité.
//
// Pour une entité donnée (company ou prospect), ce module :
//   1. Récupère la row DB (companies / prospects).
//   2. Scrape le site web officiel (si présent) → siteProfile (24 champs legacy
//      + meta avec socials, phones, emails, forms, ads, etc.).
//   3. Lit les derniers signaux dans intelligence_signals et monitoring.
//   4. Construit le NormalizedInput canonique → pour le moteur déterministe.
//
// Aucun I/O caché : purement séquentiel + cache-friendly.
'use strict';

const SITE_PROFILE = require('./site-profile');
const SCORING_INPUTS = require('./scoring-inputs');
const PROMPT = require('./prospect-prompt');

// --------------------------------------------------------------------------
// Helpers d'extraction depuis le profil site (legacy "fields" / "meta")
// --------------------------------------------------------------------------

function getField(p, key) {
  if (!p || !p.fields) return null;
  const v = p.fields[key];
  if (v == null) return null;
  return (typeof v === 'object' && 'value' in v) ? v.value : v;
}

/** Convertit une appréciation textuelle legacy en score 0-1. */
function textToScore01(text, options = {}) {
  if (text == null) return 0;
  const s = String(text).toLowerCase();
  if (!s || s === 'non disponible') return 0;
  // Patterns positifs
  if (/responsive|viewport|léger|light|rapide|fast|présent|excellent/i.test(s)) {
    return options.highBonus != null ? 1 : 0.9;
  }
  if (/modéré|moderate|moyen|léger/i.test(s)) return 0.6;
  if (/lourd|heavy|probablement non|slow|erreur|inaccessible/i.test(s)) return 0.2;
  // Patterns par préfixe simple
  if (/^oui$|^present$|^présent$/.test(s.trim())) return options.highBonus != null ? 1 : 0.85;
  if (/^non$|^absent$/.test(s.trim())) return 0;
  return 0.5; // texte reconnu mais indéterminé
}

/** Mappe les évaluations textuelles du profil site vers des scores 0-1. */
function siteProfileToEngineShape(p) {
  if (!p || !p.fields) return null;

  const meta = p.meta || {};
  const fields = p.fields;

  // Cote de vitesse : on observe status + script counts.
  const scripts = Number(meta.scripts) || 0;
  const words = Number(meta.words) || 0;
  const speedProxy = scripts > 30 || words < 200 ? 'lourd'
    : scripts > 12 ? 'moderé'
    : 'léger';

  return {
    url: getField(p, 'website') || p.scanned_urls?.[0] || null,
    reachable: meta.status && meta.status >= 200 && meta.status < 400 ? true : (meta.status === 0 ? false : null),
    http_status: meta.status ?? null,
    fetched_at: new Date().toISOString(),
    // Adapte le texte legacy → 0-1 pour le scoring
    mobile_quality: textToScore01(getField(p, 'mobile_quality')),
    speed_ms: speedProxy === 'léger' ? 800 : speedProxy === 'modéré' ? 1800 : 4000,
    viewport: !!meta.viewport,
    main_cta: normalizeBool(getField(p, 'main_cta')),
    cta_count: (getField(p, 'main_cta') || '').split(/[·|]/).filter(Boolean).length || 0,
    contact_form: normalizeBool(getField(p, 'contact_form')),
    form_count: Number(meta.forms) || 0,
    booking_quote: normalizeBool(getField(p, 'booking_quote')),
    payment_system: normalizeBool(getField(p, 'payment_system')),
    chatbot: normalizeBool(getField(p, 'chatbot')),
    crm_detected: normalizeBool(getField(p, 'crm_detected')),
    automations: parseVendorList(getField(p, 'automations')),
    tracking: parseVendorList(getField(p, 'ads_detected')),
    content_freshness_days: null, // pas mesuré ici
    content_quality_score: textToScore01(getField(p, 'content_quality')),
    // Sous-blocs exploités ailleurs :
    gbusiness: {
      name: getField(p, 'google_business_profile'),
      rating: parseFloat(getField(p, 'google_rating')) || 0,
      review_count: Number(getField(p, 'review_count')) || 0,
      url: getField(p, 'google_business_profile'),
      fetched_at: new Date().toISOString(),
    },
    social_handles: extractSocialHandles(meta.socials),
    ads_platforms: parseVendorList(getField(p, 'ads_detected')),
    schema_local: /LocalBusiness|Store|Restaurant|MedicalBusiness|ProfessionalService/i
      .test(JSON.stringify(fields || {})),
  };
}

function normalizeBool(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'non disponible') return null;
  if (/^non$|absent/.test(s)) return false;
  if (/présent|present|oui|yes|true/.test(s)) return true;
  // Pour les listes (Stripe, etc.), la présence d'au moins un vendor = true
  return /(stripe|paypal|hubspot|salesforce|intercom|calendly|doctolib|brevo|mailchimp|klaviyo)/i.test(s);
}

function parseVendorList(text) {
  if (!text) return [];
  return String(text).split(/[,·|]/).map((s) => s.trim()).filter(Boolean);
}

function extractSocialHandles(socials) {
  if (!Array.isArray(socials)) return { facebook: null, instagram: null, linkedin: null, tiktok: null };
  const out = { facebook: null, instagram: null, linkedin: null, tiktok: null };
  for (const s of socials) {
    if (/facebook|fb/i.test(s)) out.facebook = s;
    else if (/instagram/i.test(s)) out.instagram = s;
    else if (/linkedin/i.test(s)) out.linkedin = s;
    else if (/tiktok/i.test(s)) out.tiktok = s;
  }
  return out;
}

// --------------------------------------------------------------------------
// Construction du contact (vérification minimaliste)
// --------------------------------------------------------------------------

function buildContact(entity, siteProfile) {
  const meta = siteProfile?.meta || {};
  const email = entity.email || (meta.emails?.[0]) || null;
  // Validation minimale côté serveur : pas de SMTP (géré ailleurs).
  const phone = entity.phone || (meta.phones?.[0]) || null;
  return {
    email,
    email_ok: email ? /^[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(email) : null,
    mx_ok: null,
    smtp_ok: null,
    phone,
    phone_ok: phone ? /^[+\d][\d\s().-]{5,}$/.test(String(phone)) : null,
    phone_country: null,
    address: entity.address || null,
  };
}

// --------------------------------------------------------------------------
// Marketing signals — heuristique depuis le profil site
// --------------------------------------------------------------------------

function buildMarketing(entity, spShape) {
  const fields = spShape && Object.keys(spShape).length ? spShape : null;
  const hasGb = !!fields?.gbusiness?.name || !!entity.google_maps_url;
  return {
    local_seo_score: fields?.schema_local ? 0.85 : (hasGb ? 0.5 : 0.2),
    gbp_claimed: hasGb,
    main_keywords_count: 0, // pas mesuré dans site_profile actuel
    main_keywords: [],
    ads_platforms: fields?.ads_platforms || [],
    content_quality_score: fields?.content_quality_score ?? null,
    content_freshness_days: null,
    fetched_at: new Date().toISOString(),
  };
}

// --------------------------------------------------------------------------
// Réseaux sociaux — synthèse depuis site profile + entity
// --------------------------------------------------------------------------

function buildSocial(entity, spShape) {
  const handles = {};
  const eProfiles = parseEntitySocialProfiles(entity);
  const sProfiles = spShape?.social_handles || {};
  for (const k of ['facebook', 'instagram', 'linkedin', 'tiktok']) {
    handles[k] = eProfiles[k] || sProfiles[k] || null;
  }
  return {
    handles,
    posts_per_week: null,
    activity_score: handles.facebook || handles.instagram || handles.linkedin || handles.tiktok ? 0.5 : 0,
    engagement_rate: null,
    engagement_score: null,
    fetched_at: new Date().toISOString(),
  };
}

function parseEntitySocialProfiles(entity) {
  const out = { facebook: null, instagram: null, linkedin: null, tiktok: null };
  if (!entity || !entity.social_profiles) return out;
  try {
    const arr = typeof entity.social_profiles === 'string'
      ? JSON.parse(entity.social_profiles)
      : entity.social_profiles;
    if (Array.isArray(arr)) {
      for (const s of arr) {
        const url = String(s.url || s.handle || s);
        if (/facebook|fb\.com/i.test(url)) out.facebook = url;
        else if (/instagram/i.test(url)) out.instagram = url;
        else if (/linkedin/i.test(url)) out.linkedin = url;
        else if (/tiktok/i.test(url)) out.tiktok = url;
      }
    }
  } catch { /* ignore */ }
  return out;
}

// --------------------------------------------------------------------------
// Légal — heuristique purement basée sur les pages trouvées
// --------------------------------------------------------------------------

function buildLegal(siteProfile) {
  const scanned = Array.isArray(siteProfile?.scanned_urls) ? siteProfile.scanned_urls : [];
  const all = scanned.join(',').toLowerCase();
  return {
    has_privacy: /mentions|mentions-légales|mentions_legales|privacy|legal|cgu|cgv/i.test(all),
    has_terms: /cgu|cgv|terms|conditions/i.test(all),
    has_legal_mention: /mentions/i.test(all),
    fetched_at: new Date().toISOString(),
  };
}

// --------------------------------------------------------------------------
// API publique : récupère UN NormalizedInput pour une entité
// --------------------------------------------------------------------------

/**
 * @param {{
 *   entityType: 'company' | 'prospect',
 *   entity: object,             // row companies ou prospects
 *   company?: object|null,      // row companies pour un prospect
 *   siteProfile?: object|null,  // résultat de SITE_PROFILE.profileSite
 * }} input
 */
function buildNormalizedForEntity(input) {
  const e = input.entity || {};
  const entityForInputs = {
    id: e.id,
    name: e.name || `${e.first_name || ''} ${e.last_name || ''}`.trim(),
    sector: e.sector || e.industry || input.company?.sector || input.company?.industry || null,
    industry: e.industry || input.company?.industry || null,
    subsector: e.industry || e.subsector || input.company?.industry || null,
    city: e.city || input.company?.city || null,
    country: e.country || input.company?.country || null,
    area_served: e.area_served || null,
    size: e.size || e.company_size || null,
    company_size: e.size || e.company_size || null,
    year: e.founded_year || null,
    founded_year: e.founded_year || null,
    website: e.website || input.company?.website || null,
  };

  const spShape = siteProfileToEngineShape(input.siteProfile);
  return SCORING_INPUTS.buildNormalizedInput({
    entity: entityForInputs,
    site_profile: spShape,
    gbusiness: spShape?.gbusiness || buildGbusinessFromEntity(e, input.company),
    social: buildSocial(e, spShape),
    marketing: buildMarketing(e, spShape),
    contact: buildContact(e, input.siteProfile),
    legal: buildLegal(input.siteProfile),
  });
}

function buildGbusinessFromEntity(entity, company) {
  const url = entity.google_maps_url || company?.google_maps_url || null;
  return {
    url, name: null, rating: 0, review_count: 0,
    response_rate: null, top_issues: [], trend: 'unknown',
  };
}

// --------------------------------------------------------------------------
// Wrapper pratique : scrape + normalisation en une seule passe.
// Utilisé pour ne pas dupliquer la logique de scraping dans server.js.
// --------------------------------------------------------------------------

/**
 * @param {object} entity         row companies ou prospects
 * @param {object|null} company   row companies (si prospect)
 * @param {{maxPages?: number, timeoutMs?: number}} [opts]
 */
async function buildNormalizedFromScrape(entity, company, opts = {}) {
  const website = entity.website || (company && company.website) || null;
  let siteProfile = null;
  if (website) {
    try {
      const p = await SITE_PROFILE.profileSite(website, {
        maxPages: opts.maxPages ?? 4,
        timeoutMs: opts.timeoutMs ?? 12000,
      });
      if (p && p.ok) siteProfile = p;
    } catch { /* site inaccessible — on continue sans */ }
  }
  return {
    ...buildNormalizedForEntity({ entityType: entity.company_id ? 'prospect' : 'company', entity, company, siteProfile }),
    siteProfileTextFields: siteProfile?.fields || null,
    siteProfileMeta: siteProfile?.meta || null,
  };
}

module.exports = {
  buildNormalizedForEntity,
  buildNormalizedFromScrape,
  textToScore01,
  siteProfileToEngineShape,
};
