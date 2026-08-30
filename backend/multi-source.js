// multi-source.js — Orchestrateur des moteurs de recherche réels et gratuits
// 39 sources keelead (compilées sans clé) + SEC EDGAR (natif) + OpenStreetMap/Overpass (gmaps).
'use strict';

const SCRAPE = require('./scrape');
const GMAPS = require('./gmaps');
const AI = require('./ai');

let keeManager = null;
let keeFail = null;
try {
  const { sourceManager } = require('./kee/sources/index.js');
  keeManager = sourceManager;
} catch (e) {
  keeFail = String(e.message);
}

/** Sources gratuites installées (registre live) */
function freeSources() {
  if (!keeManager) return [];
  return (keeManager.getAll() || []).filter((s) => s.enabled && !s.requiresApiKey);
}

/**
 * IDs des sources « entreprises réelles » (annuaires métier) — exclut :
 *   - code / artifacts (github, npm, pypi, dockerhub, stackoverflow, devto)
 *   - social (reddit, github-orgs)
 *   - profils / publications (orcid, academia, researchgate, google-scholar,
 *     conference-speakers)
 *   - lookups techniques (whois, dns-lookup, ssl-cert, email-guesser)
 *   - web search brut (duckduckgo, searxng, google-cache)
 *   - géo Overpass (openstreetmap — géré séparément par le mode local)
 * pour ne remonter QUE des sociétés/entités prospectables.
 */
const BUSINESS_SOURCE_CATEGORIES = new Set(['company', 'local', 'government', 'startup', 'professional']);
const BUSINESS_EXTRA_IDS = new Set(['github-orgs']); // orgs GitHub = vraies sociétés (souvent SaaS)
const NON_BUSINESS_SOURCE_IDS = new Set(['openstreetmap', 'linkedin', 'linkedin-live', 'xing']);
function businessSourceIds() {
  const ids = freeSources()
    .filter((s) => (BUSINESS_SOURCE_CATEGORIES.has(s.category) || BUSINESS_EXTRA_IDS.has(s.id)) && !NON_BUSINESS_SOURCE_IDS.has(s.id))
    .map((s) => s.id);
  return [...new Set(ids.concat(['sec-edgar']))];
}

/** Catalogue complet pour /search/external/status */
function listSources() {
  const out = [];
  if (keeManager) {
    for (const s of freeSources()) {
      out.push({
        id: s.id,
        label: s.name,
        category: s.category || 'other',
        free: true,
        configured: true,
        enabled: s.enabled !== false,
      });
    }
  }
  if (keeFail) {
    out.push({ id: 'keelead', label: 'Registre keelead', free: true, configured: false, enabled: false, error: keeFail });
  }
  out.push({ id: 'sec-edgar', label: 'SEC EDGAR', category: 'company', free: true, configured: true, enabled: true, native: true });
  out.push({ id: 'maps-osm', label: 'OpenStreetMap Maps (Overpass)', category: 'local', free: true, configured: true, enabled: true, native: true });
  out.push({ id: 'linkedin-live', label: 'Zentara People', category: 'professional', free: true, configured: true, enabled: false, native: true, note: 'opt-in : session LinkedIn requise (LINKEDIN_SESSION_FILE)' });
  return out;
}

/** Normalise un hit (keelead Lead / SEC / divers) vers la forme LocalHit Zentara */
function toHit(srcId, raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.map((r) => toHit(srcId, r)).filter(Boolean);
  if (raw.id && raw.type === 'company' && raw.name) return raw; // déjà normalisé
  const name = (raw.company || raw.name || [raw.firstName, raw.lastName].filter(Boolean).join(' '))
    .toString().trim();
  if (!name) return null;
  const sector = raw.sector || raw.category || (raw.metadata && raw.metadata.industry) || deduireSecteur(raw) || null;
  return {
    id: `${srcId}_${Buffer.from(name).toString('base64url').slice(0, 16)}`,
    type: 'company',
    name,
    sector,
    city: raw.city || raw.location || (raw.metadata && raw.metadata.city) || null,
    country: raw.country || (raw.metadata && raw.metadata.country) || null,
    website: raw.website || raw.domain || (raw.metadata && raw.metadata.website) || null,
    email: raw.email || (raw.metadata && raw.metadata.email) || null,
    phone: raw.phone || (raw.metadata && raw.metadata.phone) || null,
    source: srcId,
    score: Math.round((raw.confidence ?? 0.5) * 100),
    confidence: raw.confidence ?? 0.5,
  };
}

function deduireSecteur(raw) {
  if (!raw) return null;
  const m = raw.metadata || {};
  return m.sic_description || m.primary_category || m.industry || null;
}

// --- Filtre anti-bruit (résultats d'entreprises gratuits) ---
// Sources géographiques/POI → réservées au mode local (runMaps) ; ici on cherche des entreprises.
const GEO_POI_SOURCES = new Set(['openstreetmap']);
// Commerces/lieux évidents → pas des entreprises à prospecter (mots complets, pour éviter
// de rejeter des noms comme « CafePress »).
const POI_KEYWORDS = /\b(restaurant|hotel|motel|cafe|café|coffee|pizzeria|boulangerie|bakery|patisserie|coiffeur|barber|hostel|chalet|gite|bistro|brasserie|bed\s?&?\s?breakfast)\b/i;

// Repos / packages / gists → jamais une company (un repo n'est pas une entreprise).
const REPO_URL_RE = /(github\.com\/[^/]+\/[^/]+|gist\.github\.com|gitlab\.com\/[^/]+\/[^/]+|bitbucket\.org\/[^/]+\/[^/]+|npmjs\.com\/package|pypi\.org\/project|crates\.io\/crates|packagist\.org\/packages|rubygems\.org\/gems)/i;

// Sous-pages docs/dev/help d'un domaine → de la documentation, pas une company autonome
// (ex. stripe.com/docs, stripe.com/docs/terminal, stripe.com/docs/terminal/...).
const DOC_PATH_RE = /(^|\/)(docs?|documentation|developers?|developer|reference|api|guides?)(\/|$)/i;

// Domaines poubelles / sites invalides (ex. "http://no.").
const GARBAGE_SITE_RE = /^https?:\/\/(no|none|null|example|localhost)(\.|\/|$)|^(no|none|null|example|localhost)$/i;

/**
 * Rejette tout ce qui n'est PAS une entreprise prospectable, à partir du seul couple
 * nom + site web. Utilisé à la fois par les sources gratuites (filtrage avant ranking)
 * et par persistCompany (garde-fou à la persistance).
 */
function isNoiseCompany({ name, website }) {
  if (!name || !String(name).trim()) return true;
  const site = String(website || '').trim().toLowerCase();
  if (!site) return false; // pas de site → on ne tranche pas ici
  if (REPO_URL_RE.test(site)) return true;
  if (DOC_PATH_RE.test(site)) return true;
  if (GARBAGE_SITE_RE.test(site)) return true;
  return false;
}

/** Rejette les faux positifs : POI géo, commerces locaux, repos GitHub, pages docs. */
function looksLikeCompany(hit) {
  if (!hit || !hit.name) return false;
  if (GEO_POI_SOURCES.has(hit.source)) return false;
  const text = `${hit.name} ${hit.website || ''} ${hit.sector || ''}`.toLowerCase();
  if (POI_KEYWORDS.test(text)) return false;
  if (isNoiseCompany(hit)) return false;
  // Comptes GitHub personnels (pas de domaine d'entreprise propre).
  if (hit.source === 'github-orgs' || hit.source === 'github') {
    const site = String(hit.website || '');
    if (/^https?:\/\/github\.com\/[^/]+\/?$/i.test(site)) return false;
  }
  return true;
}

// --- Ranking IA par niche (remplace la pertinence statique par un jugement sémantique) ---
const RANK_SYSTEM = `Tu es un qualificateur d'entreprises pour une prospection B2B.
On te donne une NICHE cible et une liste de candidats bruts issus de sources gratuites (potentiellement bruités).
Pour chaque candidat, décide s'il correspond réellement à la niche.
Réponds UNIQUEMENT en JSON de la forme :
{"ranked":[{"name":"...","keep":true,"relevance":78,"sector":"..."}]}
- "name" : recopie EXACTEMENT le nom fourni.
- "keep" : true si l'entreprise est réellement pertinente pour la niche, false sinon.
- "relevance" : 0-100, degré d'adéquation à la niche.
- "sector" : secteur d'activité inféré (ex "SaaS RH", "Agence web"), ou chaîne vide si inconnu.
Si tu n'es pas sûr, mets keep=true et relevance=50 (ne jette jamais un candidat au moindre doute).`;

/**
 * Reclasse les candidats par pertinence à la niche via l'IA.
 * En cas d'échec IA (aucune clé, timeout, réponse non conforme) → retourne la liste inchangée.
 */
async function rankByNiche(q, hits) {
  if (!hits || hits.length < 2) return hits;
  const candidates = hits.slice(0, 30).map((h) => ({
    name: h.name,
    sector: h.sector || '',
    website: h.website || '',
    source: h.source || '',
  }));
  const messages = [
    { role: 'system', content: RANK_SYSTEM },
    { role: 'user', content: `NICHE : ${q}\n\nCANDIDATS :\n${JSON.stringify(candidates)}` },
  ];

  let parsed = null;
  // UN SEUL essai rapide (gemini flash-lite, ~1s). Le ranking IA est un
  // bonus : s'il timeout ou échoue, on garde les résultats non classés.
  try {
    const res = await Promise.race([
      AI.chatCompletion(messages, { json: true, maxTokens: 1500, provider: 'gemini', model: 'gemini-3.1-flash-lite' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('AI rank timeout')), 1000)),
    ]);
    parsed = AI.extractJson(res && res.content);
  } catch {
    parsed = null;
  }

  const ranked = parsed && Array.isArray(parsed.ranked) ? parsed.ranked : null;
  if (!ranked || ranked.length === 0) return hits;
  const byName = new Map();
  for (const r of ranked) byName.set(String(r.name || '').toLowerCase(), r);
  const out = [];
  for (const h of hits) {
    const r = byName.get(String(h.name || '').toLowerCase());
    if (!r) { out.push(h); continue; } // non jugé → conservé
    if (r.keep === false) continue; // hors-niche → écarté
    const rel = Number(r.relevance);
    if (Number.isFinite(rel)) h.score = Math.round(rel);
    if (r.sector) h.sector = String(r.sector);
    out.push(h);
  }
  out.sort((a, b) => (b.score || 0) - (a.score || 0));
  return out;
}

/**
 * Recherche multi-source réelle (concurrente, timeouts courts par source).
 * @param {string} q
 * @param {{sources?:string[], limit?:number, maxMs?:number, apiKeys?:object}} opts
 */
async function runSearch(q, opts = {}) {
  const limit = Math.max(1, Math.min(Number(opts.limit) || 20, 50));
  const maxMs = Number(opts.maxMs) || 35000;
  const apiKeys = opts.apiKeys || {};
  const asked = String(opts.sources || '').split(',').map((s) => s.trim()).filter(Boolean);
  // Par défaut : TOUTES les sources gratuites (plus de sous-ensemble DEFAULTS).
  const defaultIds = freeSources().map((s) => s.id);
  // Par défaut : UNIQUEMENT les sources d'entreprises réelles (annuaires,
  // registres, startups). Pas de social, developer, education, search brut.
  // L'utilisateur peut override avec ?sources=npm,devto si besoin.
  const wanted = new Set(asked.length ? asked : businessSourceIds());

  let results = [];
  const errors = [];
  const sourcesUsed = new Set();
  const seen = new Set();
  const started = Date.now();

  const jobs = [];

  // 1) 39 sources keelead gratuites
  if (keeManager) {
    for (const s of freeSources()) {
      if (!wanted.has(s.id)) continue;
      jobs.push({
        tag: s.id,
        run: async () => {
          const items = await Promise.race([
            Promise.resolve(s.search(q, {
              count: Math.min(limit, 15),
              // Clés optionnelles injectées aux sources qui les supportent (ex: OpenCorporates)
              apiToken: apiKeys.opencorporates || undefined,
            })).catch(() => []),
            new Promise((res) => setTimeout(() => res([]), 3000)),
          ]);
          return (items || []).map((l) => toHit(s.id, l));
        },
      });
    }
  }

  // 2) SEC EDGAR natif
  if (wanted.has('sec-edgar')) {
    jobs.push({
      tag: 'sec-edgar',
      run: async () => {
        const items = await Promise.race([
          SCRAPE.searchEdgar(q, Math.min(limit, 15)).catch(() => []),
          new Promise((res) => setTimeout(() => res([]), 3000)),
        ]);
        return (items || []).map((r) => ({
          id: `sec_${(r.name || '').replace(/\W+/g, '')}`,
          type: 'company',
          name: r.name,
          sector: r.sector || null,
          city: r.city || null,
          country: r.country || 'US',
          website: r.website || null,
          email: r.email || null,
          phone: null,
          source: 'sec-edgar',
          score: Number(r.score) || 70,
          confidence: Number(r.confidence) || 0.7,
        }));
      },
    });
  }

  // 3) Exécution parallèle complète — toutes les sources en même temps.
  //    Un seul round de 39 jobs → réponse en 4s max (per-source timeout).
  if (Date.now() - started < maxMs) {
    const settled = await Promise.allSettled(jobs.map((j) => j.run().then((hits) => ({ tag: j.tag, hits }))));
    for (const r of settled) {
      if (r.status === 'rejected') {
        errors.push({ source: r.reason?.tag || 'unknown', message: String(r.reason?.message || r.reason) });
        continue;
      }
      sourcesUsed.add(r.value.tag);
      for (const h of r.value.hits || []) {
        if (!looksLikeCompany(h)) continue;
        // Écho de la requête : une « entreprise » dont le nom est exactement la niche recherchée.
        if (q && String(h.name || '').toLowerCase().trim() === String(q).toLowerCase().trim()) continue;
        const key = h.name.toLowerCase().trim();
        if (seen.has(key)) continue;
        seen.add(key);
        results.push(h);
      }
    }
  }

  // 4) Sources demandées mais inactives → signalées (pas d'erreur bloquante)
  for (const id of wanted) {
    if (!jobs.some((j) => j.tag === id)) {
      errors.push({ tag: id, message: 'source non disponible (non incluse dans cette liste gratuite)' });
    }
  }

  results = await rankByNiche(q, results);
  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  return {
    results: results.slice(0, limit),
    errors,
    sources: [...sourcesUsed],
    engine: 'keelead + sec-edgar (39 sources gratuites)',
  };
}

/** Recherche locale Maps (gmaps) — wrapper conforme au frontend MapsPage */
async function runMaps({ query, location, radius, limit }) {
  return GMAPS.searchLocal({ query, location, radiusKm: radius, limit: limit || 20 });
}

module.exports = { listSources, runSearch, runMaps, freeSources, businessSourceIds, rankByNiche, looksLikeCompany, isNoiseCompany };