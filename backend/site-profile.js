// site-profile.js — Profil « 34 champs » d'un site web (framework d'analyse Zentara).
// Scrape la homepage (+ pages contact/about si trouvées) et remplit les 34 données
// par heuristiques HTML/JS — sans clé, sans navigateur. Chaque champ vaut :
//   { value: ..., source: 'dom' | 'heuristic' | 'external' }  ou null si absent.
// Consommé par prospect-prompt.js → buildProspectPrompt(data.siteProfile).
'use strict';

const SCRAPE = require('./scrape');

const KNOWN_PAGES = ['', '/contact', '/contact-us', '/nous-contacter', '/about', '/a-propos', '/qui-sommes-nous', '/team', '/equipe'];

const PLATFORMS = {
  facebook: /(?:facebook\.com|fb\.com)/i,
  instagram: /instagram\.com/i,
  linkedin: /linkedin\.com/i,
  tiktok: /tiktok\.com/i,
  twitter: /(?:twitter\.com|x\.com)/i,
  youtube: /youtube\.com/i,
};

const CHAT_PLATFORMS = [
  ['Intercom', /intercom/i], ['Crisp', /crisp\.chat/i], ['Tawk.to', /tawk\.to/i],
  ['Drift', /drift\.com/i], ['Zendesk', /zendesk/i], ['HubSpot Chat', /hubspot.*(?:chat|messages)/i],
  ['Facebook Messenger', /m\.me\/|messenger\.com/i], ['WhatsApp', /wa\.me\/|api\.whatsapp\.com/i],
  ['Chatwoot', /chatwoot/i], ['Userlike', /userlike/i], ['Tidio', /tidio/i], ['LiveChat', /livechatinc\.com/i],
  ['Olark', /olark/i], ['Smartsupp', /smartsupp/i], ['Textline', /textline/i], ['Freshchat', /freshchat/i],
];

const PAYMENT_PLATFORMS = [
  ['Stripe', /stripe\.com|js\.stripe\.com|pk_(live|test)_/i], ['PayPal', /paypal\.com|paypalobjects/i],
  ['Virement bancaire', /rib|iban|virement/i], ['CB', /carte bancaire|paiement s(?:é|e)curis/i],
  ['Lydia', /lydia\.com|lydia-app/i], ['SumUp', /sumup/i], ['Square', /squareup\.com/i],
  ['GoCardless', /gocardless/i], ['Mollie', /mollie\.com/i],
];

const RESERVATION_PLATFORMS = [
  ['Calendly', /calendly\.com/i], ['Doctolib', /doctolib\.(?:fr|com)/i], ['Reservia', /reservia/i],
  ['OpenTable', /opentable/i], ['TheFork', /thefork\.(?:fr|com)/i], ['Doodle', /doodle\.com/i],
  ['Acuity', /acuityscheduling/i], ['Bookeo', /bookeo/i], ['Planity', /planity\.com/i],
  ['YouCanBookMe', /youcanbook\.me/i],
];

const CRM_PLATFORMS = [
  ['Salesforce', /salesforce\.com|force\.com|salesforcedx/i], ['HubSpot', /hubspot/i], ['Pipedrive', /pipedrive/i],
  ['Zoho CRM', /zoho.*crm|crm\.zoho/i], ['Monday', /monday\.com/i], ['Notion', /notion\.(?:so|com)/i],
  ['Airtable', /airtable\.com/i], ['ClickUp', /clickup/i], ['Attio', /attio\.com/i], ['Copper', /copper\.com/i],
  ['Salesloft', /salesloft/i], ['Gong', /gong\.io/i], ['Clearbit', /clearbit/i], ['Apollo', /apollo\.io/i],
  ['Lemlist', /lemlist/i], ['Outreach', /outreach\.io/i], ['Close CRM', /close\.com|closeio/i],
];

const AUTOMATION_PLATFORMS = [
  ['Zapier', /zapier\.com/i], ['Make', /make\.com|integromat/i], ['n8n', /n8n\.io|n8n\.cloud/i],
  ['Mailchimp', /mailchimp\.com|mc\.us\d+\.list-manage/i], ['Klaviyo', /klaviyo/i], ['Brevo', /brevo\.com/i],
  ['ActiveCampaign', /activecampaign/i], ['Sendinblue', /sendinblue/i], ['Iterable', /iterable\.com/i],
  ['Segment', /segment\.com|cdn\.segment\.com/i], ['Amplitude', /amplitude\.com/i], ['Mixpanel', /mixpanel/i],
  ['HubSpot Marketing', /hubspot.*(?:forms|marketing|track)/i], ['Customer.io', /customer\.io/i], ['Braze', /braze/i],
];

const ADS_PLATFORMS = [
  ['Google Ads', /googletagmanager\.com|gtag\s*\(|googleads|adsbygoogle|google\/ads/i],
  ['Meta Pixel', /connect\.facebook\.net|fbq\s*\(|fbq\s*\[|facebook\/tr|facebook.*pixel/i],
  ['LinkedIn Insight', /snap\.licdn\.com|linkedin.*insight/i],
  ['TikTok Pixel', /analytics\.tiktok\.com|ttq\s*\.load/i],
  ['X/Twitter Pixel', /static\.ads-twitter\.com|twq\s*\(/i],
  ['Criteo', /criteo/i], ['Taboola', /taboola/i], ['Outbrain', /outbrain/i],
];

const LOCAL_SCHEMA = /"@type"\s*:\s*"?(LocalBusiness|Store|Restaurant|MedicalBusiness|ProfessionalService|Organization)/i;

function count(re, html) {
  const m = html.match(re);
  return m ? m.length : 0;
}

/** Remonte l'origine du site (homepage) depuis une URL de page quelconque. */
function originOf(url) {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Scrape la homepage + pages courantes et construit le profil 34 champs.
 * @param {string} website
 * @param {{maxPages?: number, timeoutMs?: number}} [opts]
 */
async function profileSite(website, opts = {}) {
  const origin = originOf(website);
  if (!origin) {
    return { ok: false, error: 'URL invalide', fields: null, scanned_urls: [] };
  }
  const maxPages = Math.min(Number(opts.maxPages) || 6, 10);
  const timeoutMs = Number(opts.timeoutMs) || 15000;

  // 1) Scrape les pages (homepage d'abord, puis contact/about/team).
  const pages = [];
  const scanned_urls = [];
  for (const suffix of KNOWN_PAGES) {
    if (pages.length >= maxPages) break;
    const url = origin + suffix;
    const r = await SCRAPE.fetchText(url, { 'User-Agent': SCRAPE.BROWSER_UA, Accept: 'text/html,application/xhtml+xml' }, timeoutMs);
    if (!r.ok || !r.text || r.text.length < 200) continue;
    pages.push({ url, html: r.text, status: r.status, bytes: r.text.length });
    scanned_urls.push(url);
  }
  if (pages.length === 0) {
    return { ok: false, error: 'Site injoignable ou bloqué', fields: null, scanned_urls };
  }

  const home = pages[0];
  const html = home.html;
  const allHtml = pages.map((p) => p.html).join('\n');

  // 2) Heuristiques sur le contenu agrégé.
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || null;
  const metaDesc = ((html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) || [])[1] || (html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i) || [])[1] || null);
  const hasViewport = /<meta[^>]*name=["']viewport["']/i.test(html);
  const hasHttps = /^https:/i.test(origin);
  const scripts = count(/<script\b/gi, html);
  const imgs = count(/<img\b/gi, html);
  const imgsWithAlt = count(/<img\b[^>]*alt=["'][^"']+["']/gi, html);
  const headings = (html.match(/<h[1-6]\b[^>]*>/gi) || []).length;
  const h1s = (html.match(/<h1\b[^>]*>([^<]*)<\/h1>/gi) || []).map((h) => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  const inputs = count(/<input\b/gi, allHtml);
  const textareas = count(/<textarea\b/gi, allHtml);
  const labels = count(/<label\b/gi, allHtml);
  const buttons = (allHtml.match(/<(?:button|a)\b[^>]*>/gi) || []).length;
  const forms = count(/<form\b/gi, allHtml);
  const formSignals = count(/<input\b|<textarea\b|<select\b/gi, allHtml) + count(/placeholder=["']/gi, allHtml);
  const hasAddress = /(?:<div[^>]*itemprop=["'](?:streetAddress|addressLocality)["']|"streetAddress"|"addressLocality")/i.test(allHtml) || /(?:adresse|address)/i.test(allHtml.slice(0, 20000));
  const hasGeo = /"latitude"|"longitude"|itemprop=["'](?:latitude|longitude)["']/i.test(allHtml);
  const hasReviews = /"reviewCount"|"aggregateRating"|"ratingValue"|itemprop=["']ratingValue["']/i.test(allHtml);
  const ratingMatch = allHtml.match(/"ratingValue"\s*:\s*"?([\d.]+)"?/i) || allHtml.match(/itemprop=["']ratingValue["'][^>]*>([\d.]+)</i);
  const reviewCountMatch = allHtml.match(/"reviewCount"\s*:\s*"?(\d+)"?/i) || allHtml.match(/itemprop=["']reviewCount["'][^>]*>(\d+)</i);
  const googleMaps = /(?:maps\.google\.com|goo\.gl\/maps)/i.test(allHtml) ? (allHtml.match(/https?:\/\/[^\s"']*(?:maps\.google\.com|goo\.gl\/maps)[^\s"']*/i) || [])[0] || true : null;
  const phoneInHtml = SCRAPE.extractPhones(allHtml)[0] || null;
  const emailInHtml = SCRAPE.extractEmails(allHtml)[0] || null;

  // CTA : liens/buttons au texte actionnable (homepage + sous-pages) + href vers pages d'action.
  const ctaTexts = (allHtml.match(/<(?:a|button)\b[^>]*>\s*([^<]{2,70}?)\s*<\/[ab]>/gi) || [])
    .map((t) => t.replace(/<[^>]+>/g, '').replace(/[\s\n]+/g, ' ').trim())
    .filter((t) => /(?:demander|devis|contact|r(?:é|e)server|essai|essayer|s(?:é|e)lectionner|commander|acheter|d(?:é|e)couvrir|commencer|gratuit|rendez[- ]vous|estimation|obtenir|inscri|d(?:é|e)mo|voir|r(?:é|e)server|t(?:é|e)l(?:é|e)charger|tester|parler|discuter|booker)/i.test(t))
    .slice(0, 3);
  // Fallback : href pointant vers des pages d'action (contact, demo, essai, tarifs, rendez-vous).
  if (ctaTexts.length === 0) {
    const actionHrefs = (allHtml.match(/href=["'][^"']*(?:contact|demande|devis|demo|essai|essay|rdv|rendez|book|inscription|compte|commencer)[^"']*["']/gi) || [])
      .slice(0, 3)
      .map((h) => h.replace(/^href=["']/, '').replace(/["']$/, ''));
    if (actionHrefs.length) ctaTexts.push('lien vers ' + actionHrefs[0].split('/').filter(Boolean).pop());
  }

  const socials = [];
  for (const [platform, re] of Object.entries(PLATFORMS)) {
    const m = allHtml.match(new RegExp('https?://[^"\\s\']*' + re.source.replace(/^https?:\/\//, 'https?:\\/\\/'), 'i'));
    if (m) socials.push(platform);
  }
  const chat = [];
  for (const [name, re] of CHAT_PLATFORMS) if (re.test(allHtml)) chat.push(name);
  const payment = [];
  for (const [name, re] of PAYMENT_PLATFORMS) if (re.test(allHtml)) payment.push(name);
  const reservation = [];
  for (const [name, re] of RESERVATION_PLATFORMS) if (re.test(allHtml)) reservation.push(name);
  const crm = [];
  for (const [name, re] of CRM_PLATFORMS) if (re.test(allHtml)) crm.push(name);
  const automation = [];
  for (const [name, re] of AUTOMATION_PLATFORMS) if (re.test(allHtml)) automation.push(name);
  const ads = [];
  for (const [name, re] of ADS_PLATFORMS) if (re.test(allHtml)) ads.push(name);

  const words = html.replace(/<[^>]+>/g, ' ').replace(/[\s\n]+/g, ' ').trim().split(' ').length;
  const contentQuality = words > 1500 ? 'riche' : words > 500 ? 'moyen' : words > 100 ? 'faible' : 'très faible';

  // 3) Construit les 34 champs.
  const F = (value, source = 'dom') => (value === null || value === undefined || value === '' ? null : { value, source });

  const fields = {
    company_name: F(title && title.split(/[|–—-]/)[0].trim() || null, 'dom'),
    sector: null,
    subsector: null,
    location: null,
    area_served: null,
    company_size: null,
    founded_year: null,
    website: F(origin, 'dom'),
    site_status: F(home.status >= 400 ? 'erreur HTTP ' + home.status : 'en ligne', 'dom'),
    mobile_quality: F(!hasViewport ? 'probablement non responsive (viewport absent)' : 'viewport présent', 'heuristic'),
    site_speed: F(scripts > 30 ? 'lourd (plus de ' + scripts + ' scripts)' : scripts > 12 ? 'modéré (' + scripts + ' scripts)' : 'léger (' + scripts + ' scripts)', 'heuristic'),
    main_cta: F(ctaTexts.length ? ctaTexts.join(' · ') : null, 'dom'),
    contact_form: F(forms > 0 || formSignals > 0 ? (labels > 0 ? 'présent (' + (forms || formSignals) + ' champs/formulaire(s), labels détectés)' : 'présent (' + (forms || formSignals) + ' champs/formulaire(s))') : null, 'heuristic'),
    booking_quote: F(reservation.length ? reservation.join(', ') : null, 'heuristic'),
    payment_system: F(payment.length ? payment.join(', ') : null, 'heuristic'),
    chatbot: F(chat.length ? chat.join(', ') : null, 'heuristic'),
    crm_detected: F(crm.length ? crm.join(', ') : null, 'heuristic'),
    automations: F(automation.length ? automation.join(', ') : null, 'heuristic'),
    google_business_profile: F(googleMaps ? (typeof googleMaps === 'string' ? 'lien présent (' + googleMaps.slice(0, 60) + ')' : 'lien présent') : null, 'dom'),
    google_rating: F(ratingMatch ? ratingMatch[1] : null, 'dom'),
    review_count: F(reviewCountMatch ? reviewCountMatch[1] : null, 'dom'),
    review_trends: null,
    review_issues: null,
    review_response: null,
    facebook: F(socials.includes('facebook') ? 'présence détectée' : null, 'heuristic'),
    instagram: F(socials.includes('instagram') ? 'présence détectée' : null, 'heuristic'),
    linkedin: F(socials.includes('linkedin') ? 'présence détectée' : null, 'heuristic'),
    tiktok: F(socials.includes('tiktok') ? 'présence détectée' : null, 'heuristic'),
    social_activity: F(socials.length ? 'détectée sur ' + socials.join(', ') : null, 'heuristic'),
    engagement: null,
    local_seo: F((hasAddress || hasGeo) ? (LOCAL_SCHEMA.test(allHtml) ? 'schema LocalBusiness présent + adresse/géo' : 'adresse/géo détectée (schema à enrichir)') : null, 'heuristic'),
    main_keywords: F([...new Set([...(h1s.slice(0, 2)), ...(title ? [title.split(/[|–—-]/)[0].trim()] : [])].filter(Boolean))].slice(0, 3).join(', ') || null, 'dom'),
    ads_detected: F(ads.length ? ads.join(', ') : null, 'heuristic'),
    content_quality: F(contentQuality, 'heuristic'),
  };

  const meta = {
    scanned_urls,
    html_bytes: home.bytes,
    status: home.status,
    blocked: home.status >= 400 || home.status === 0,
    unreachable: home.status === 0,
    title,
    meta_description: metaDesc,
    page_count: pages.length,
    scripts,
    images: imgs,
    images_without_alt: imgs - imgsWithAlt,
    headings,
    forms,
    inputs,
    textareas,
    labels,
    buttons,
    words,
    phones: phoneInHtml ? [phoneInHtml] : [],
    emails: emailInHtml ? [emailInHtml] : [],
    socials,
    chatbot: chat,
    payment: payment,
    reservation,
    crm,
    automations: automation,
    ads,
    note: pages.length > 1 ? `${pages.length} pages analysées (homepage + sous-pages)` : 'Homepage analysée uniquement',
  };

  return { ok: true, fields, meta, scanned_urls };
}

module.exports = { profileSite, KNOWN_PAGES };
