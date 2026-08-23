// engine.js — « Zentara One » : moteur de recherche unifié.
// Fusionne tous les moteurs Zentara en un seul point d'entrée, TOUS exécutés en
// parallèle (aucun fallback — chaque source contribue) :
//   - Zentara Companies : annuaires publics (keelead 39 sources gratuites + SEC EDGAR)
//   - Zentara Local      : OpenStreetMap/Overpass + Yelp + Google Places (old+new)
//                          + SerpAPI + Outscraper (clés optionnelles)
//   - Zentara People     : LinkedIn StaffSpy + linkedin-mcp-server (Patchright)
//
// Sortie unifiée : { results: [{id,type,name,title,category,city,country,website,
//   email,phone,linkedin,source,sourceGroup,confidence,score,tags}], errors, sources, engine }
'use strict';

const MULTI = require('./multi-source');
const LINKEDIN = require('./linkedin');
const ENGINES = require('./maps-engines');
const SCRAPERS = require('./scrapers');

const ENGINE_NAME = 'Zentara One';

// Groupes de sources exposés au frontend.
const GROUPS = {
  companies: { id: 'zentara-companies', label: 'Zentara Companies' },
  local: { id: 'zentara-local', label: 'Zentara Local' },
  people: { id: 'zentara-people', label: 'Zentara People' },
  jobs: { id: 'zentara-jobs', label: 'Zentara Jobs' },
};

/** Normalise un hit « annuaire » (multi-source) → forme unifiée. */
function fromDirectory(hit) {
  if (!hit?.name) return null;
  return {
    id: hit.id || `c_${Buffer.from(hit.name).toString('base64url').slice(0, 12)}`,
    type: 'company',
    name: hit.name,
    title: null,
    category: hit.sector || null,
    city: hit.city || null,
    country: hit.country || null,
    website: hit.website || null,
    email: hit.email || null,
    phone: hit.phone || null,
    linkedin: null,
    source: hit.source || 'directory',
    sourceGroup: GROUPS.companies.id,
    confidence: Number(hit.confidence) || 0.5,
    score: Number(hit.score) || Math.round((hit.confidence || 0.5) * 100),
    tags: ['company'],
  };
}

/** Normalise un hit « local / maps » → forme unifiée. */
function fromLocal(lead) {
  if (!lead?.name) return null;
  return {
    id: `l_${Buffer.from(`${lead.name}|${lead.address || ''}`).toString('base64url').slice(0, 12)}`,
    type: 'company',
    name: lead.name,
    title: null,
    category: lead.category || null,
    city: lead.city || null,
    country: lead.country || null,
    website: lead.website || null,
    email: lead.email || null,
    phone: lead.phone || null,
    linkedin: null,
    source: lead.source || 'openstreetmap',
    sourceGroup: GROUPS.local.id,
    confidence: Number(lead.confidence) || 0.5,
    score: Math.round((lead.confidence || 0.5) * 100),
    tags: ['local', 'maps'],
  };
}

/** Normalise une personne LinkedIn → forme unifiée. */
function fromPerson(p) {
  const name = (p.full_name || [p.firstName, p.lastName].filter(Boolean).join(' ')).trim();
  if (!name) return null;
  return {
    id: `p_${Buffer.from(name).toString('base64url').slice(0, 12)}`,
    type: 'person',
    name,
    title: p.title || null,
    category: p.company || null,
    city: p.location || null,
    country: null,
    website: null,
    email: p.email || null,
    phone: p.phone || null,
    linkedin: p.linkedin || null,
    source: p.metadata?.source === 'Zentara People (MCP)' ? 'linkedin-mcp' : 'staffspy',
    sourceGroup: GROUPS.people.id,
    confidence: Number(p.confidence) || 0.5,
    score: Math.round((p.confidence || 0.5) * 100),
    tags: ['linkedin', ...(p.open_to_work ? ['open-to-work'] : []), ...(p.is_hiring ? ['hiring'] : [])],
  };
}

/** Normalise une offre d'emploi (MCP search_jobs) → forme unifiée. */
function fromJob(j) {
  if (!j?.title) return null;
  return {
    id: `j_${j.job_id || Buffer.from(`${j.title}|${j.company || ''}`).toString('base64url').slice(0, 12)}`,
    type: 'job',
    name: j.title,
    title: j.company || null,
    category: j.company || null,
    city: j.location || null,
    country: null,
    website: j.companyInfo?.website || null,
    email: null,
    phone: null,
    linkedin: j.apply_url || null,
    source: 'linkedin-mcp',
    sourceGroup: GROUPS.jobs.id,
    confidence: Number(j.confidence) || 0.7,
    score: 75,
    tags: ['job', 'linkedin'],
    jobId: j.job_id || null,
    postedDate: j.posted_date || null,
    salary: j.salary || null,
    snippet: j.description_snippet || null,
    companyInfo: j.companyInfo || null,
    needs: Array.isArray(j.needs) ? j.needs : [],
    hiringContext: j.hiringContext || null,
    outreachSequence: j.outreachSequence || null,
  };
}

/** Dedup + tri unifié. */
function merge(...arrays) {
  const seen = new Set();
  const out = [];
  for (const arr of arrays) {
    for (const r of arr) {
      if (!r?.name) continue;
      const key = `${r.sourceGroup}:${String(r.name).toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  out.sort((a, b) => (b.score || 0) - (a.score || 0));
  return out;
}

/** Normalise un résultat de moteur (tableau OU {leads}) en tableau. */
function toArr(x) {
  if (Array.isArray(x)) return x;
  return (x && Array.isArray(x.leads)) ? x.leads : [];
}

/** Statut du moteur + sous-moteurs. */
async function status(apiKeys = {}) {
  const li = await LINKEDIN.status();
  const scr = await SCRAPERS.status();
  const peopleAvailable = li?.engines?.staffspy?.available === true || li?.engines?.mcp_server?.available === true;
  return {
    engine: ENGINE_NAME,
    version: 2,
    groups: [
      { ...GROUPS.companies, available: true },
      { ...GROUPS.local, available: true },
      { ...GROUPS.people, available: peopleAvailable },
      { ...GROUPS.jobs, available: peopleAvailable },
    ],
    linkedin: li,
    scrapers: (scr && scr.scrapers) || scr,
    maps: {
      osm: { available: true, configured: true, label: 'OpenStreetMap / Overpass (gratuit)' },
      yelp: { available: true, configured: true, label: 'Yelp (best-effort)' },
      google_places: { available: true, configured: !!apiKeys.google_places, label: 'Google Places (clé requise)' },
      google_places_new: { available: true, configured: !!apiKeys.google_places, label: 'Google Places API New (clé requise)' },
      serpapi: { available: true, configured: !!apiKeys.serpapi, label: 'SerpAPI (clé requise)' },
      outscraper: { available: true, configured: !!apiKeys.outscraper, label: 'Outscraper (clé requise)' },
    },
    modes: ['all', 'companies', 'people', 'local', 'jobs'],
  };
}

/**
 * Recherche unifiée.
 * @param {{
 *   mode?: 'all'|'companies'|'people'|'local',
 *   query?: string, niche?: string, needs?: string, roles?: string,
 *   company?: string, location?: string, radius?: number,
 *   limit?: number, sources?: string, apiKeys?: object,
 * }} params
 */
async function search(params = {}) {
  const mode = ['all', 'companies', 'people', 'local', 'jobs'].includes(params.mode) ? params.mode : 'all';
  const q = String(params.query || params.niche || '').trim();
  const needs = String(params.needs || params.roles || '').trim();
  const company = String(params.company || '').trim();
  const location = String(params.location || '').trim();
  const radius = params.radius !== undefined && params.radius !== null && params.radius !== '' ? Number(params.radius) : undefined;
  const limit = Math.max(1, Math.min(Number(params.limit) || 20, 100));
  const apiKeys = params.apiKeys || {};

  const errors = [];
  const sources = [];
  const buckets = [];

  const runCompanies = async () => {
    if (mode === 'people' || mode === 'local') return [];
    if (!q && !company) return [];
    try {
      const r = await MULTI.runSearch(q || company, { sources: params.sources, limit, apiKeys });
      sources.push(...(r.sources || []));
      errors.push(...(r.errors || []).map((e) => ({ group: GROUPS.companies.id, ...e })));
      return (r.results || []).map(fromDirectory).filter(Boolean);
    } catch (e) {
      errors.push({ group: GROUPS.companies.id, message: String(e.message) });
      return [];
    }
  };

  const runPeople = async () => {
    if (mode === 'companies' || mode === 'local') return [];
    if (!q && !company && !needs) return [];
    // StaffSpy + linkedin-mcp-server en PARALLÈLE (aucun fallback).
    const jobs = [
      {
        tag: 'staffspy',
        run: () => company
          ? LINKEDIN.searchStaff(company, { roles: needs, location, limit })
          : LINKEDIN.searchPeople(q || needs, { roles: needs, location, limit }),
      },
      {
        tag: 'linkedin-mcp',
        run: () => LINKEDIN.searchPeopleMCP([company, q, needs].filter(Boolean).join(' '), { location, limit }),
      },
    ];
    const settled = await Promise.allSettled(jobs.map((j) => j.run().then((r) => ({ tag: j.tag, r }))));
    const out = [];
    for (const s of settled) {
      if (s.status === 'rejected') {
        errors.push({ group: GROUPS.people.id, message: String(s.reason?.message || s.reason) });
        continue;
      }
      const { tag, r } = s.value;
      if (r.ok) sources.push(tag);
      if (!r.ok && r.error) errors.push({ group: GROUPS.people.id, source: tag, message: r.error });
      out.push(...(r.leads || []).map(fromPerson).filter(Boolean));
    }
    return out;
  };

  const runJobs = async () => {
    if (mode !== 'jobs' && mode !== 'all') return [];
    if (!q && !needs) return [];
    try {
      // API publique jobs-guest d'abord (fiable, sans session), MCP en fallback.
      let r = await LINKEDIN.searchJobsPublic(q || needs, { location, limit });
      let sourceName = 'linkedin-jobs-public';
      if (!r.ok) {
        r = await LINKEDIN.searchJobsMCP(q || needs, { location, limit });
        sourceName = 'linkedin-mcp-jobs';
      }
      if (r.ok) sources.push(sourceName);
      if (!r.ok && r.error) errors.push({ group: GROUPS.jobs.id, message: r.error });
      return (r.leads || []).map(fromJob).filter(Boolean);
    } catch (e) {
      errors.push({ group: GROUPS.jobs.id, message: String(e.message) });
      return [];
    }
  };

  const runLocal = async () => {
    if (mode === 'companies' || mode === 'people') return [];
    if (!q) return [];
    // Tous les moteurs locaux en PARALLÈLE — OSM + Yelp toujours, moteurs payants si clé.
    const jobs = [
      { tag: 'osm', run: () => MULTI.runMaps({ query: q, location, radiusKm: radius, limit }) },
      { tag: 'yelp', run: () => SCRAPERS.yelp(q, location, limit) },
    ];
    if (apiKeys.google_places) {
      jobs.push({ tag: 'google-places', run: () => ENGINES.googlePlacesSearch({ query: q, location, limit, key: apiKeys.google_places }) });
      jobs.push({ tag: 'google-places-new', run: () => ENGINES.googlePlacesNewSearch({ query: q, location, limit, key: apiKeys.google_places }) });
    }
    if (apiKeys.serpapi) jobs.push({ tag: 'serpapi', run: () => ENGINES.serpapiSearch({ query: q, location, limit, key: apiKeys.serpapi }) });
    if (apiKeys.outscraper) jobs.push({ tag: 'outscraper', run: () => ENGINES.outscraperSearch({ query: q, location, limit, key: apiKeys.outscraper }) });

    const settled = await Promise.allSettled(jobs.map((j) => j.run().then((leads) => ({ tag: j.tag, leads: toArr(leads) }))));
    const out = [];
    for (const s of settled) {
      if (s.status === 'rejected') {
        errors.push({ group: GROUPS.local.id, message: String(s.reason?.message || s.reason) });
        continue;
      }
      const { tag, leads } = s.value;
      if (leads.length) sources.push(tag);
      out.push(...leads.map(fromLocal).filter(Boolean));
    }
    return out;
  };

  if (mode === 'all') {
    const [c, p, l, j] = await Promise.all([runCompanies(), runPeople(), runLocal(), runJobs()]);
    buckets.push(...c, ...p, ...l, ...j);
  } else if (mode === 'companies') {
    buckets.push(...(await runCompanies()));
  } else if (mode === 'people') {
    buckets.push(...(await runPeople()));
  } else if (mode === 'jobs') {
    buckets.push(...(await runJobs()));
  } else if (mode === 'local') {
    buckets.push(...(await runLocal()));
  }

  const results = merge(...[buckets]);
  return {
    engine: ENGINE_NAME,
    mode,
    results: results.slice(0, limit),
    total: results.length,
    sources: [...new Set(sources)],
    errors,
  };
}

module.exports = { search, status, ENGINE_NAME, GROUPS };
