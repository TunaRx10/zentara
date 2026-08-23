/**
 * scrape.js — native-fetch site scraper + SEC EDGAR company search.
 *
 * No external deps (Node global fetch). Used by:
 *   - POST /companies/:id/scrape-contacts  (email + phone extraction)
 *   - POST /design-audit/run               (HTML signals + AI summary)
 *   - GET  /search/external                (SEC EDGAR name search)
 */
'use strict';

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// SEC EDGAR requires a declared UA with a contact email.
const SEC_UA = 'Tunation Research tunation.fr@gmail.com';

const FETCH_TIMEOUT_MS = 8000;

async function fetchText(url, headers = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });
    const text = await res.text();
    return { status: res.status, ok: res.ok, text };
  } catch (e) {
    if (e && e.name === 'AbortError') return { status: 0, ok: false, text: '', timeout: true };
    return { status: 0, ok: false, text: '', error: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Dé-obfusque les emails protégés (ex: info[at]acme[dot]com). */
function deobfuscate(html) {
  return html
    .replace(/&#64;/gi, '@')
    .replace(/%40/gi, '@')
    .replace(/\[at\]/gi, '@')
    .replace(/\(at\)/gi, '@')
    .replace(/\[dot\]/gi, '.')
    .replace(/\(dot\)/gi, '.')
    .replace(/\s+at\s+/gi, '@')
    .replace(/\s+dot\s+/gi, '.');
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const JUNK_EMAIL = /\.(png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?|ttf|mp4|pdf)$/i;
const JUNK_DOMAIN = /(example\.com|sentry\.io|wixpress\.com|schema\.org|yourdomain|your-?company|email\.com|domain\.com|acme\.|\.local$|localhost|sentry|w3\.org)/i;

function extractEmails(html) {
  const seen = new Set();
  const out = [];
  const text = deobfuscate(html);
  const matches = text.match(EMAIL_RE) || [];
  for (const m of matches) {
    const email = m.toLowerCase().replace(/[.\s]+$/, '');
    if (!email || email.length > 80) continue;
    if (JUNK_EMAIL.test(email)) continue;
    if (JUNK_DOMAIN.test(email)) continue;
    if (email.startsWith('.') || email.endsWith('.')) continue;
    if (!seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

/** Normalise les téléphones (9 à 15 chiffres). */
function extractPhones(html) {
  const text = deobfuscate(html);
  const re = /(?:\+?\d[\d\s().-]{6,}\d)/g;
  const seen = new Set();
  const out = [];
  const matches = text.match(re) || [];
  for (const m of matches) {
    const digits = m.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) continue;
    if (!seen.has(digits)) {
      seen.add(digits);
      out.push('+' + digits.replace(/^00/, ''));
    }
  }
  return out;
}

/** Extraits les href (relatifs résolus) d'une page HTML. */
function extractLinks(html, baseUrl) {
  const re = /<a\b[^>]*href=["']([^"']+)["']/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl).href;
      out.add(abs);
    } catch {
      /* ignore invalid */
    }
  }
  return Array.from(out).slice(0, 60);
}

/**
 * Scrape un site : homepage + sous-pages de contact classiques.
 * Retourne les emails, téléphones, et les URLs scannées.
 */
async function scrapeSite(url) {
  const normalized = normalizeUrl(url);
  const base = new URL(normalized);
  const root = base.origin;
  const pages = ['/', '/contact', '/contact-us', '/about', '/about-us', '/team', '/fr/contact'];
  const scanned = new Set();
  const emails = [];
  const phones = [];
  let status = 0;
  let blocked = false;
  let unreachable = false;
  let htmlBytes = 0;
  let note = '';

  const seenPages = new Set();
  for (const p of pages) {
    if (seenPages.has(p)) continue;
    seenPages.add(p);
    let target;
    try {
      target = new URL(p, root).href;
    } catch {
      continue;
    }
    const r = await fetchText(target, { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' });
    if (r.timeout) continue;
    if (r.status === 403 || r.status === 401 || r.status === 429 || r.status === 503) {
      blocked = true;
      continue;
    }
    if (r.status === 0 || !r.ok) {
      unreachable = true;
      continue;
    }
    status = r.status;
    scanned.add(target);
    htmlBytes += r.text.length;
    for (const e of extractEmails(r.text)) emails.push(e);
    for (const ph of extractPhones(r.text)) phones.push(ph);
    if (p === '/') {
      // follow contact-ish links found on the homepage
      const links = extractLinks(r.text, root).filter((l) =>
        /(contact|about|team|presse|press)/i.test(l),
      );
      for (const l of links.slice(0, 4)) {
        if (seenPages.has(l)) continue;
        seenPages.add(l);
        const lr = await fetchText(l, { 'User-Agent': BROWSER_UA });
        if (lr.ok && lr.text) {
          scanned.add(l);
          htmlBytes += lr.text.length;
          for (const e of extractEmails(lr.text)) emails.push(e);
          for (const ph of extractPhones(lr.text)) phones.push(ph);
        }
      }
    }
  }

  // Dedup
  const uniqEmails = Array.from(new Set(emails));
  const uniqPhones = Array.from(new Set(phones));

  if (scanned.size === 0) {
    if (blocked) note = 'Site bloqué (403/429) — bot protection détectée.';
    else if (unreachable) note = 'Site injoignable.';
    else note = 'Aucune page lisible.';
  }

  return {
    url: normalized,
    scanned_urls: Array.from(scanned),
    emails: uniqEmails,
    phones: uniqPhones,
    html_bytes: htmlBytes,
    blocked,
    unreachable,
    note,
  };
}

function normalizeUrl(url) {
  let u = String(url || '').trim();
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

// =====================================================================
// SEC EDGAR — name search via the full company_tickers.json registry.
// =====================================================================

let _tickersCache = null;
let _tickersAt = 0;

async function getCompanyRegistry() {
  if (_tickersCache && Date.now() - _tickersAt < 6 * 3600 * 1000) return _tickersCache;
  const r = await fetchText('https://www.sec.gov/files/company_tickers.json', { 'User-Agent': SEC_UA }, 20000);
  if (!r.ok || !r.text) return _tickersCache || [];
  try {
    const obj = JSON.parse(r.text);
    _tickersCache = Object.values(obj).map((c) => ({
      name: String(c.title || ''),
      ticker: String(c.ticker || '').toUpperCase(),
      cik: String(c.cik_str || ''),
    }));
    _tickersAt = Date.now();
    return _tickersCache;
  } catch {
    return _tickersCache || [];
  }
}

/** Recherche une société US cotée par nom/ticker. Retourne jusqu'à `limit` résultats. */
async function searchEdgar(query, limit = 10) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const list = await getCompanyRegistry();
  const scored = [];
  for (const c of list) {
    const name = c.name.toLowerCase();
    const ticker = c.ticker.toLowerCase();
    let score = 0;
    if (name === q || ticker === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 60;
    else if (ticker.startsWith(q)) score = 70;
    else if (q.length >= 3 && (name.includes(q) || ticker.includes(q))) score = 40;
    if (score > 0) scored.push({ ...c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((c) => ({
    source: 'sec-edgar',
    name: c.name,
    ticker: c.ticker || null,
    cik: c.cik || null,
    company_number: null,
    jurisdiction: 'US',
    incorporation_date: null,
    url: c.cik
      ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.cik}&type=&dateb=&owner=include&count=40`
      : null,
    matched_on: q,
  }));
}

module.exports = {
  fetchText,
  extractEmails,
  extractPhones,
  extractLinks,
  scrapeSite,
  normalizeUrl,
  searchEdgar,
  BROWSER_UA,
};
