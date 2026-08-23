// scoring-inputs.js — Normalisation des sources hétérogènes vers NormalizedInput.
//
// Le NormalizedInput est la SEULE entrée acceptée par scoring-engine.js.
// Toutes les sources brutes (entité DB, profil site scrapé, Google Business,
// social handles, marketing signals) sont fusionnées en un objet canonique
// sérialisé JSON pour hashing. La forme canonique est stable ⇒ même entrée ⇒ même hash.
//
// L'objectif : si on relance l'analyse sur les mêmes sources, le moteur produit
// EXACTEMENT les mêmes scores/agrégats (la partie IA peut varier, mais pas les chiffres).
'use strict';

const crypto = require('node:crypto');

// --------------------------------------------------------------------------
// Normalisation composant par composant
// --------------------------------------------------------------------------

function normalizeEntity(entity) {
  if (!entity || typeof entity !== 'object') entity = {};
  const city = entity.city || null;
  const country = entity.country || null;
  const sector = String(entity.sector || entity.industry || '').trim() || null;
  const subsector = String(entity.industry || entity.subsector || '').trim() || null;
  const company_size = String(entity.size || entity.company_size || '').trim() || null;
  const founded_year = parseYear(entity.founded_year || entity.year || null);
  const area_served = String(entity.area_served || entity.zone || '').trim() || null;

  return {
    id: entity.id || null,
    name: String(entity.name || '').trim() || null,
    sector,
    subsector,
    location: { city, country },
    area_served,
    company_size,
    founded_year,
  };
}

function parseYear(v) {
  if (v == null) return null;
  const n = Number(String(v).match(/-?\d+/)?.[0]);
  if (!Number.isFinite(n)) return null;
  if (n < 1800 || n > 2200) return null;
  return n;
}

function normalizeSiteProfile(p) {
  if (!p || typeof p !== 'object') return null;
  // Accepte deux formats : le format riche du nouveau profil site (fields {key:{value,...}})
  // et un format à plat léger. Tous deux sont mappés ici en un sous-objet cohérent.
  const f = p.fields && typeof p.fields === 'object' ? p.fields : p;

  const get = (k) => {
    const v = f[k];
    if (v == null) return null;
    if (typeof v === 'object' && 'value' in v) return v.value;
    return v;
  };
  const arr = (k) => {
    const v = get(k);
    if (Array.isArray(v)) return v.filter(Boolean);
    return [];
  };

  const out = {
    url: String(get('url') || get('website_url') || f.url || '').trim() || null,
    reachable: p.reachable != null ? !!p.reachable : (f.reachable != null ? !!f.reachable : null),
    http_status: p.http_status != null ? p.http_status : (f.http_status != null ? f.http_status : null),
    fetched_at: p.fetched_at || f.fetched_at || null,
    mobile_quality: Number(get('mobile_quality') ?? f.mobile_quality) || 0,
    speed_ms: Number(get('speed_ms') ?? f.speed_ms) || null,
    viewport: get('viewport') || null,
    main_cta: get('main_cta') || null,
    cta_count: Number(get('cta_count')) || 0,
    contact_form: get('contact_form') || null,
    form_count: Number(get('form_count')) || 0,
    booking_quote: get('booking_quote') || get('booking_url') || p.booking_url || null,
    payment_system: get('payment_system') || null,
    chatbot: get('chatbot') || null,
    crm_detected: get('crm_detected') || null,
    automations: arr('automations'),
    tracking: arr('tracking'),
    content_freshness_days: Number(get('content_freshness_days')) || null,
    content_quality_score: Number(get('content_quality_score')) || null,
  };

  // Garantir que les booléens nullables restent stables dans le hash.
  return out;
}

function normalizeGBusiness(g) {
  if (!g || typeof g !== 'object') return {};
  return {
    url: g.url || g.place_url || null,
    name: g.name || null,
    rating: Number(g.rating) || 0,
    review_count: Number(g.review_count) || Number(g.reviews) || 0,
    response_rate: g.response_rate != null ? Number(g.response_rate) : null,
    top_issues: Array.isArray(g.top_issues) ? g.top_issues.slice(0, 10) : [],
    trend: ['up', 'flat', 'down', 'unknown'].includes(String(g.trend || '').toLowerCase())
      ? String(g.trend).toLowerCase()
      : 'unknown',
    fetched_at: g.fetched_at || null,
  };
}

function normalizeSocial(s) {
  if (!s || typeof s !== 'object') return {};
  const handles = s.handles && typeof s.handles === 'object' ? s.handles : {};
  return {
    handles: {
      facebook: handles.facebook || null,
      instagram: handles.instagram || null,
      linkedin: handles.linkedin || null,
      tiktok: handles.tiktok || null,
      youtube: handles.youtube || null,
      x: handles.x || handles.twitter || null,
    },
    posts_per_week: Number(s.posts_per_week) || null,
    activity_score: Number(s.activity_score) || null,
    engagement_rate: Number(s.engagement_rate) || null,
    engagement_score: Number(s.engagement_score) || null,
    fetched_at: s.fetched_at || null,
  };
}

function normalizeMarketing(m) {
  if (!m || typeof m !== 'object') return {};
  return {
    local_seo_score: Number(m.local_seo_score) || null,
    gbp_claimed: !!m.gbp_claimed,
    main_keywords_count: Number(m.main_keywords_count) || 0,
    main_keywords: Array.isArray(m.main_keywords) ? m.main_keywords.slice(0, 25) : [],
    ads_platforms: Array.isArray(m.ads_platforms)
      ? m.ads_platforms.filter(Boolean)
      : Array.isArray(m.ads)
        ? m.ads.filter(Boolean)
        : [],
    content_quality_score: Number(m.content_quality_score) || null,
    content_freshness_days: Number(m.content_freshness_days) || null,
    fetched_at: m.fetched_at || null,
  };
}

function normalizeContact(c) {
  if (!c || typeof c !== 'object') return {};
  return {
    email: c.email || null,
    email_ok: c.email_ok != null ? !!c.email_ok : null,
    mx_ok: !!c.mx_ok,
    smtp_ok: !!c.smtp_ok,
    phone: c.phone || null,
    phone_ok: c.phone_ok != null ? !!c.phone_ok : null,
    phone_country: c.phone_country || null,
    address: c.address || null,
  };
}

function normalizeLegal(l) {
  if (!l || typeof l !== 'object') return {};
  return {
    has_privacy: !!l.has_privacy,
    has_terms: !!l.has_terms,
    has_legal_mention: !!l.has_legal_mention,
    fetched_at: l.fetched_at || null,
  };
}

// --------------------------------------------------------------------------
// Sérialisation canonique (clé triée, sans undefined, dates ISO)
// --------------------------------------------------------------------------

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (value === undefined) return null;
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  const out = {};
  const keys = Object.keys(value).sort();
  for (const k of keys) {
    let v = value[k];
    if (v === undefined) continue;
    // Strippe les timestamps second-précis avant hash : on ne veut pas
    // qu'une re-analyse à 10 secondes d'écart change la signature.
    if (/_at$|_fetched_at$|_date$/i.test(k) && typeof v === 'string') {
      // Conserve uniquement YYYY-MM-DD, marque comme `_date` pour transparence.
      const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(v);
      if (dateMatch && k !== '_source_dates') {
        out[`${k}__day`] = dateMatch[1];
        continue;
      }
    }
    out[k] = canonicalJson(v);
  }
  return out;
}

function hashInput(input) {
  const json = JSON.stringify(canonicalJson(input));
  return crypto.createHash('sha256').update(json).digest('hex');
}

// --------------------------------------------------------------------------
// Construction d'un NormalizedInput depuis n'importe quelle combo de sources
// --------------------------------------------------------------------------

/**
 * @param {{
 *   entity: object,            // row companies / prospects (brute DB)
 *   site_profile?: object,     // résultat de SITE_PROFILE.profileSite
 *   gbusiness?: object,       // résultat Maps : note, reviews
 *   social?: object,           // { handles, activity_score, engagement_score }
 *   marketing?: object,        // SEO, mots-clés, ads, contenu
 *   contact?: object,          // email + vérifs SMTP/MX
 *   legal?: object,            // { has_privacy, has_terms }
 * }} sources
 */
function buildNormalizedInput(sources = {}) {
  const entity = normalizeEntity(sources.entity);
  const site_profile = normalizeSiteProfile(sources.site_profile);
  const gbusiness = normalizeGBusiness(sources.gbusiness);
  const social = normalizeSocial(sources.social);
  const marketing = normalizeMarketing(sources.marketing);
  const contact = normalizeContact(sources.contact);
  const legal = normalizeLegal(sources.legal);

  // Collected fetch timestamps → pour le critère recency.
  // On distingue deux représentations :
  //   _source_timestamps_full → stocké en clair, utilisé pour la calcul de
  //                            fraîcheur au runtime (recency).
  //   _source_dates          → estampillé au JOUR uniquement, inséré dans
  //                            l'objet HASHÉ pour rendre le hash stable
  //                            entre deux scrapes du même jour (reproductibilité).
  const source_timestamps = {};
  const push = (k, ts) => { if (ts) source_timestamps[k] = ts; };
  push('site_profile', site_profile?.fetched_at);
  push('gbusiness', gbusiness.fetched_at);
  push('social', social.fetched_at);
  push('marketing', marketing.fetched_at);
  push('legal', legal.fetched_at);

  const _source_dates = {};
  for (const [k, ts] of Object.entries(source_timestamps)) {
    const d = new Date(ts);
    if (!Number.isNaN(d.getTime())) _source_dates[k] = d.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  const partial = {
    entity,
    site_profile,
    gbusiness,
    social,
    marketing,
    contact,
    legal,
    source_timestamps,
    _source_dates,
    schema_version: 1,
  };

  // Le hash est sur la même structure mais SANS les timestamps seconde-précis :
  // on reconstruit un payload "quotidien" pour le hashing uniquement.
  const hashPayload = { ...partial };
  delete hashPayload.source_timestamps;          // retirée du hash (gardée pour recency)
  partial.input_hash = hashInput(hashPayload);
  return partial;
}

module.exports = {
  buildNormalizedInput,
  hashInput,
  canonicalJson,
  normalizeEntity,
  normalizeSiteProfile,
  normalizeGBusiness,
  normalizeSocial,
  normalizeMarketing,
  normalizeContact,
  normalizeLegal,
};
