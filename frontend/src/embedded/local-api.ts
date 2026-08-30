/**
 * local-api.ts — Routeur API EMBARQUÉ (backend in-app).
 *
 * Répond aux endpoints consommés par l'application à partir de la base
 * locale (store.ts) + du scoring déterministe + des templates email.
 * Aucun serveur requis : l'app reste 100 % fonctionnelle hors-ligne.
 *
 * Contrat avec ApiClient (client.ts) :
 *   { handled: true, data }        → réponse réussie (data directe)
 *   { handled: true, error }       → erreur { code, message, status }
 *   { handled: false }             → non géré ici, laisser passer réseau
 */
import { embStore, ensureSeeded, genId, nowIso } from './store';
import {
  buildAnalysisRecord,
  buildEmailDraft,
  runDeterministicAnalysis,
  listEmailTemplates,
  type EntityLike,
} from './scoring';
import { createLocalJob, getJob, listJobs, cancelLocalJob, retryLocalJob, type LocalJob } from './jobs';
import { searchOverpass, searchOverpassByKeyword, geocodeNominatim, type OSMResult } from './overpass';
import { searchEDGAR, searchEDGARByTicker, type EDGARCompany } from './sec-edgar';

export interface LocalError {
  code: string;
  message: string;
  status: number;
}

export interface LocalRouteResult {
  handled: boolean;
  data?: unknown;
  error?: LocalError;
}

const ok = (data: unknown): LocalRouteResult => ({ handled: true, data });
const fail = (code: string, message: string, status = 400): LocalRouteResult => ({
  handled: true,
  error: { code, message, status },
});

// Sources web — on tente d'abord les APIs directes (navigateur).
// Si elles échouent, elles sont marquées comme « hors-ligne ».
let _webSourcesCache: Array<{ source: string; message: string; available: boolean }> | null = null;

const DEFAULT_BACKEND_URL = 'https://zentara-backend.onrender.com/api'; // Backend 39 sources (Render, 24/7)

function getBackendUrl(): string | null {
  try {
    const stored = localStorage.getItem('zentara.api.base');
    if (stored && stored.trim().length > 0) return stored.trim().replace(/\/+$/, '');
    const def = String(DEFAULT_BACKEND_URL || '').trim();
    if (def.length > 0) return def.replace(/\/+$/, '');
    return null;
  } catch { return null; }
}

let _backendReachable = false;

async function probeBackend(): Promise<boolean> {
  const base = getBackendUrl();
  if (!base) { _backendReachable = false; return false; }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    _backendReachable = r.ok;
    return r.ok;
  } catch {
    _backendReachable = false;
    return false;
  }
}

/** Appelle le backend réel pour la recherche engine (LinkedIn inclus). */
async function fetchBackendSearch(payload: any): Promise<any | null> {
  const base = getBackendUrl();
  if (!base) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    const res = await fetch(`${base}/engine/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json();
    return json.success !== false ? (json.data ?? json) : null;
  } catch {
    return null;
  }
}

function getWebSourceStatus(): Array<{ source: string; message: string; available: boolean }> {
  // Refresh people availability based on backend probe
  const peopleAvailable = _backendReachable || getBackendUrl() !== null;

  if (!_webSourcesCache) {
    _webSourcesCache = [
      { source: 'zentara-companies', message: 'SEC EDGAR (API directe)', available: true },
      { source: 'zentara-people', message: peopleAvailable ? 'LinkedIn People (backend connecté)' : 'LinkedIn People — nécessite le backend', available: peopleAvailable },
      { source: 'zentara-local', message: 'OpenStreetMap / Overpass (API directe)', available: true },
    ];
  } else {
    // Update people availability dynamically
    const people = _webSourcesCache.find((s) => s.source === 'zentara-people');
    if (people) {
      people.available = peopleAvailable;
      people.message = peopleAvailable ? 'LinkedIn People (backend connecté)' : 'LinkedIn People — nécessite le backend';
    }
  }
  return _webSourcesCache;
}

function markWebSourceOffline(source: string): void {
  const s = getWebSourceStatus();
  const entry = s.find((x) => x.source === source);
  if (entry) entry.available = false;
}

function getOfflineErrors(): Array<{ source: string; message: string }> {
  return getWebSourceStatus()
    .filter((s) => !s.available)
    .map((s) => ({ source: s.source, message: s.message }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePath(path: string): { segments: string[]; params: URLSearchParams } {
  const [p, qs] = (path || '').split('?');
  const segments = p.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  return { segments, params: new URLSearchParams(qs ?? '') };
}

function parseJson<T = any>(v: unknown): T | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  return v as T;
}

const FR = (n: unknown): number => Math.round(Number(n) || 0);

function companyToEntity(c: any): EntityLike {
  return {
    id: c.id,
    name: c.name,
    sector: c.sector,
    industry: c.industry,
    city: c.city,
    country: c.country,
    website: c.website,
    email: c.email,
    phone: c.phone,
    address: c.address,
    company_size: c.company_size,
    founded_year: c.founded_year,
    updated_at: c.updated_at,
    social_profiles: c.social_profiles,
    status: c.status,
  };
}

function prospectToEntity(p: any): EntityLike {
  return {
    id: p.id,
    name: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.company_name || null,
    first_name: p.first_name,
    last_name: p.last_name,
    role: p.role,
    sector: p.sector,
    city: p.city,
    country: p.country,
    website: p.website,
    email: p.email,
    phone: p.phone,
    company_size: p.company_size,
    updated_at: p.updated_at,
  };
}

function findCompany(id?: string | null): any | undefined {
  if (!id) return undefined;
  return embStore.get('companies', id);
}

function latestIntelligence(type: string, id: string): any | undefined {
  return embStore
    .list<any>('intelligence')
    .filter((r) => r.entity_type === type && String(r.entity_id) === String(id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
}

function latestBreakdown(type: string, id: string): any | undefined {
  return embStore
    .list<any>('breakdowns')
    .filter((r) => r.entity_type === type && String(r.entity_id) === String(id))
    .sort((a, b) => String(b.computed_at).localeCompare(String(a.computed_at)))[0];
}

function aggregateScoreFor(company: any): any {
  const c = company ?? {};
  const prospects = embStore.list<any>('prospects').filter((p) => String(p.company_id) === String(c.id));
  const intel = latestIntelligence('company', c.id);
  const companyScore = Number(c.score) || 0;
  const prospectsAvg = prospects.length
    ? Math.round(prospects.reduce((s, p) => s + (Number(p.score) || 0), 0) / prospects.length)
    : 0;
  const intelScore = Number(intel?.score) || 0;
  const score = Math.round(0.4 * companyScore + 0.3 * prospectsAvg + 0.25 * intelScore);
  const hotProspects = prospects.filter((p) => (Number(p.score) || 0) >= 70).length;
  const reasons: string[] = [];
  if (score >= 70) reasons.push('Score agrégé élevé');
  if (hotProspects > 0) reasons.push(`${hotProspects} prospect(s) hot`);
  if (intel && Date.now() - new Date(intel.created_at).getTime() < 7 * 86400_000) reasons.push('Analyse récente (7 j)');
  return {
    score,
    company_score: companyScore,
    prospects_avg: prospectsAvg,
    intelligence_score: intelScore,
    prospect_count: prospects.length,
    hot_prospect_count: hotProspects,
    recent_signals: 0,
    recent_analysis: Boolean(intel),
    reasons,
  };
}

// Mots-outils FR/EN à ignorer dans la tokenisation : sans eux, un contexte
// libre (« recrutent des commerciaux ») matcherait « des » partout.
const SEARCH_STOPWORDS = new Set([
  'le', 'la', 'les', 'des', 'un', 'une', 'du', 'de', 'et', 'ou', 'au', 'aux',
  'pour', 'avec', 'dans', 'sur', 'par', 'qui', 'que', 'quoi', 'est', 'sont',
  'mais', 'comme', 'plus', 'pas', 'the', 'and', 'for', 'with', 'are', 'not',
]);

function searchLocal(query: string, mode: string, limit: number, needs = ''): any[] {
  const tokenize = (s: string) =>
    String(s || '').toLowerCase().split(/[\s,;|/+&()-]+/).map((t) => t.trim()).filter((t) => t.length >= 2 && !SEARCH_STOPWORDS.has(t));
  // Mots de la niche (ex: « SaaS B2B ») ET du contexte/besoins (ex: « Competitive
  // Intelligence », « recrutent des commerciaux »). Le contexte est cherché dans les
  // champs notes/tags (signaux déjà enrichis), pas uniquement nom/secteur.
  const qTokens = tokenize(query);
  const nTokens = tokenize(needs);
  const results: any[] = [];
  if (qTokens.length === 0 && nTokens.length === 0) return [];

  const textOf = (r: any, keys: string[]) => keys.map((k) => String(r[k] ?? '')).join(' ').toLowerCase();
  const hit = (tokens: string[], text: string) => tokens.some((t) => text.includes(t));
  // Contexte/besoins : on exige une majorité de mots significatifs (≥2 pour une
  // requête multi-mots). Un mot générique comme « intelligence » (présent dans
  // toutes les notes « Besoin d'intelligence principal ») ne doit pas matcher tout.
  const needsHit = (tokens: string[], text: string) => {
    if (tokens.length === 0) return false;
    const required = tokens.length === 1 ? 1 : Math.max(2, Math.ceil(tokens.length / 2));
    const count = tokens.filter((t) => text.includes(t)).length;
    return count >= required;
  };

  if (mode === 'all' || mode === 'companies') {
    for (const c of embStore.list<any>('companies')) {
      const core = textOf(c, ['name', 'sector', 'industry', 'city', 'country', 'website']);
      const tags = parseJson<string[]>(c.tags) ?? [];
      const ctx = [c.notes, c.name, c.sector, ...tags].filter(Boolean).join(' ').toLowerCase();
      const qHit = hit(qTokens, core);
      const nHit = needsHit(nTokens, ctx);
      // La niche OU le contexte/besoins suffit à matcher ; les deux → meilleur rang.
      if (!qHit && !nHit) continue;
      const agg = aggregateScoreFor(c);
      results.push({
        id: c.id,
        type: 'company',
        name: c.name,
        title: null,
        category: c.sector ?? c.industry ?? null,
        city: c.city ?? null,
        country: c.country ?? null,
        website: c.website ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        linkedin: null,
        source: 'local-db',
        sourceGroup: 'local',
        confidence: 1,
        score: Math.min(100, (agg.score ?? 0) + (qHit && nHit ? 10 : 0)),
        tags,
        company_id: c.id,
        company_created: false,
      });
    }
  }
  if (mode === 'all' || mode === 'people') {
    for (const p of embStore.list<any>('prospects')) {
      const name = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
      const core = textOf(p, ['first_name', 'last_name', 'email', 'role', 'sector']) + ' ' + name.toLowerCase();
      const pTags = parseJson<string[]>(p.tags) ?? [];
      const ctx = [p.notes, p.role, p.sector, name, ...pTags].filter(Boolean).join(' ').toLowerCase();
      const qHit = hit(qTokens, core);
      const nHit = needsHit(nTokens, ctx);
      if (!qHit && !nHit) continue;
      results.push({
        id: p.id,
        type: 'person',
        name,
        title: p.role ?? null,
        category: p.sector ?? null,
        city: p.city ?? null,
        country: p.country ?? null,
        website: p.website ?? null,
        email: p.email ?? null,
        phone: p.phone ?? null,
        linkedin: null,
        source: 'local-db',
        sourceGroup: 'local',
        confidence: 1,
        score: Math.min(100, (Number(p.score) || 0) + (qHit && nHit ? 10 : 0)),
        tags: pTags,
        company_id: p.company_id ?? null,
        company_created: false,
      });
    }
  }
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return results.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Router principal
// ---------------------------------------------------------------------------

export async function handleLocalRequest(method: string, path: string, body?: unknown): Promise<LocalRouteResult> {
  ensureSeeded();
  const { segments, params } = parsePath(path);
  const m = method.toUpperCase();
  const seg = segments;
  const [a, b, c, d] = seg; // premiers segments

  // ---------- Health / meta ----------
  if (a === 'health') {
    return ok({ status: 'ok', mode: 'embedded', time: nowIso(), storage: embStore.count('companies') });
  }
  if (a === undefined) return ok({ name: 'zentara-embedded', mode: 'embedded' });

  // ---------- Auth ----------
  if (a === 'auth') {
    const user = embStore.list<any>('users')[0] ?? null;
    if (b === 'status') return ok({ hasUser: Boolean(user), email: user?.email ?? null, name: user?.name ?? null, setupAllowed: false, mode: 'embedded' });
    if (b === 'me') {
      if (!user) return fail('UNAUTHORIZED', 'Aucun utilisateur local', 401);
      return ok({ id: user.id, email: user.email, name: user.name, role: user.role, mode: 'embedded' });
    }
    if (b === 'login' || b === 'setup' || b === 'biometric' || b === 'refresh') {
      if (!user) return fail('UNAUTHORIZED', 'Aucun utilisateur local', 401);
      return ok({ token: 'local-embedded-token', user: { id: user.id, email: user.email, name: user.name } });
    }
    if (b === 'logout') return ok({ ok: true });
  }

  // ---------- Companies ----------
  if (a === 'companies') {
    if (b === 'hot-companies') {
      const minScore = Number(params.get('min_score') ?? 70);
      const limit = Number(params.get('limit') ?? 25);
      const offset = Number(params.get('offset') ?? 0);
      const sector = params.get('sector') ?? null;
      let list = embStore.list<any>('companies')
        .filter((c) => !sector || String(c.sector ?? c.industry ?? '').toLowerCase().includes(sector.toLowerCase()))
        .map((c) => ({ ...c, aggregate_score: aggregateScoreFor(c) }))
        .filter((c) => c.aggregate_score.score >= minScore)
        .sort((x, y) => y.aggregate_score.score - x.aggregate_score.score);
      const total = list.length;
      list = list.slice(offset, offset + limit);
      return ok({
        data: list.map((c) => ({
          ...c,
          aggregate_score: c.aggregate_score.score,
          prospect_count: c.aggregate_score.prospect_count,
          prospect_avg_score: c.aggregate_score.prospects_avg,
          hot_prospect_count: c.aggregate_score.hot_prospect_count,
          recent_signals: c.aggregate_score.recent_signals,
          recent_analysis: c.aggregate_score.recent_analysis,
          reasons: c.aggregate_score.reasons,
        })),
        meta: { total, limit, offset, threshold: minScore, sector },
      });
    }
    if (b === undefined && m === 'GET') {
      const q = params.get('q') ?? params.get('search') ?? '';
      const limit = Number(params.get('limit') ?? 500);
      let list = embStore.list<any>('companies').sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)));
      if (q) {
        const ql = q.toLowerCase();
        list = list.filter((c) =>
          [c.name, c.sector, c.industry, c.city, c.country, c.website].some((k) => String(k ?? '').toLowerCase().includes(ql)));
      }
      return ok(list.slice(0, limit));
    }
    if (b === undefined && m === 'POST') {
      const data = (body ?? {}) as any;
      if (!data.name) return fail('VALIDATION', 'Le nom de l’entreprise est requis');
      const now = nowIso();
      const company = {
        id: genId('comp'),
        name: data.name,
        website: data.website ?? null,
        sector: data.sector ?? data.industry ?? null,
        industry: data.industry ?? null,
        address: data.address ?? null,
        city: data.city ?? data.location ?? null,
        country: data.country ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        social_profiles: data.social_profiles ?? null,
        google_maps_url: data.google_maps_url ?? null,
        score: Number(data.score) || 0,
        status: data.status ?? 'new',
        notes: data.notes ?? null,
        tags: data.tags ?? null,
        created_at: now,
        updated_at: now,
      };
      embStore.upsert('companies', company);
      return ok(company);
    }
    if (b === 'scrape-contacts' || b === 'auto-scrape') {
      if (m === 'GET' && b === 'auto-scrape') return ok({ enabled: false, pending: false, last_run_at: null });
      if (m === 'PATCH' && b === 'auto-scrape') return ok({ enabled: Boolean((body as any)?.enabled), pending: false });
      return ok({ scraped: false, message: 'Scraping web indisponible en mode embarqué (aucun serveur requis pour le reste)', mode: 'embedded' });
    }
    if (c === 'prospects' && b) {
      const list = embStore.list<any>('prospects').filter((p) => String(p.company_id) === String(b));
      return ok(list);
    }
    if (c === 'aggregate-score' && b) {
      const company = findCompany(b);
      if (!company) return fail('NOT_FOUND', 'Entreprise introuvable', 404);
      return ok(aggregateScoreFor(company));
    }
    if (b) {
      const company = findCompany(b);
      if (!company) return fail('NOT_FOUND', 'Entreprise introuvable', 404);
      if (m === 'GET') return ok(company);
      if (m === 'PATCH' || m === 'PUT') {
        const data = (body ?? {}) as any;
        const now = nowIso();
        const updated = { ...company };
        for (const key of ['name', 'website', 'sector', 'industry', 'address', 'city', 'country', 'phone', 'email', 'social_profiles', 'google_maps_url', 'score', 'status', 'notes', 'tags']) {
          if (data[key] !== undefined) updated[key] = data[key];
        }
        if (data.location !== undefined && data.city === undefined) updated.city = data.location;
        updated.updated_at = now;
        embStore.upsert('companies', updated);
        return ok(updated);
      }
      if (m === 'DELETE') {
        embStore.remove('companies', b);
        return ok({ deleted: true });
      }
    }
  }

  // ---------- Prospects ----------
  if (a === 'prospects') {
    if (b === 'clean-legacy-channels' && m === 'POST') {
      const confirm = Boolean((body as any)?.confirm);
      return ok({ deleted: confirm ? 0 : 0, preview: !confirm, message: 'Aucun canal legacy à nettoyer' });
    }
    if (b === undefined && m === 'GET') {
      const q = params.get('q') ?? '';
      let list = embStore.list<any>('prospects').sort((x, y) => String(y.updated_at).localeCompare(String(x.updated_at)));
      if (q) {
        const ql = q.toLowerCase();
        list = list.filter((p) =>
          [p.first_name, p.last_name, p.email, p.role, p.sector, p.city].some((k) => String(k ?? '').toLowerCase().includes(ql)));
      }
      return ok(list);
    }
    if (b === undefined && m === 'POST') {
      const data = (body ?? {}) as any;
      if (!data.first_name || !data.last_name) return fail('VALIDATION', 'Prénom et nom requis');
      const now = nowIso();
      const prospect = {
        id: data.id ?? genId('pros'),
        company_id: data.company_id ?? null,
        first_name: data.first_name,
        last_name: data.last_name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        role: data.role ?? null,
        sector: data.sector ?? null,
        address: data.address ?? null,
        city: data.city ?? null,
        country: data.country ?? null,
        website: data.website ?? null,
        social_profiles: data.social_profiles ?? null,
        google_maps_url: data.google_maps_url ?? null,
        score: Number(data.score) || 0,
        status: data.status ?? 'new',
        tags: data.tags ?? null,
        quality: data.quality ?? null,
        notes: data.notes ?? null,
        created_at: now,
        updated_at: now,
      };
      embStore.upsert('prospects', prospect);
      return ok(prospect);
    }
    if (b) {
      const p = embStore.get('prospects', b);
      if (!p) return fail('NOT_FOUND', 'Prospect introuvable', 404);
      if (m === 'GET') return ok(p);
      if (m === 'PATCH' || m === 'PUT') {
        const data = (body ?? {}) as any;
        const updated = { ...p, ...data, updated_at: nowIso() };
        embStore.upsert('prospects', updated);
        return ok(updated);
      }
      if (m === 'DELETE') {
        embStore.remove('prospects', b);
        return ok({ deleted: true });
      }
    }
  }

  // ---------- Contacts ----------
  if (a === 'contacts') {
    if (b === undefined && m === 'GET') return ok(embStore.list<any>('contacts').sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))));
    if (b === undefined && m === 'POST') {
      const data = (body ?? {}) as any;
      if (!data.first_name || !data.last_name) return fail('VALIDATION', 'Prénom et nom requis');
      const now = nowIso();
      const contact = {
        id: genId('cnt'),
        company_id: data.company_id ?? null,
        first_name: data.first_name,
        last_name: data.last_name,
        role: data.role ?? null,
        email: data.email ?? null,
        phone: data.phone ?? null,
        social_profiles: data.social_profiles ?? null,
        status: data.status ?? 'active',
        notes: data.notes ?? null,
        tags: data.tags ?? null,
        linkedin_url: data.linkedin_url ?? null,
        created_at: now,
        updated_at: now,
      };
      embStore.upsert('contacts', contact);
      return ok(contact);
    }
    if (b) {
      const c = embStore.get('contacts', b);
      if (!c) return fail('NOT_FOUND', 'Contact introuvable', 404);
      if (m === 'GET') return ok(c);
      if (m === 'PATCH' || m === 'PUT') {
        const updated = { ...c, ...(body as any), updated_at: nowIso() };
        embStore.upsert('contacts', updated);
        return ok(updated);
      }
      if (m === 'DELETE') {
        embStore.remove('contacts', b);
        return ok({ deleted: true });
      }
    }
  }

  // ---------- Campaigns ----------
  if (a === 'campaigns') {
    if (b === undefined && m === 'GET') {
      const campaigns = embStore.list<any>('campaigns').sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
      // Enrichir chaque campagne avec le nombre de prospects rattachés
      const enriched = campaigns.map((c) => {
        const pids = embStore.list<any>('settings').filter((s) => String(s.id).startsWith('cpl:') && String(s.id).split(':')[1] === String(c.id)).map((s) => s.prospect_id);
        const prospectCount = embStore.list<any>('prospects').filter((p) => pids.includes(String(p.id))).length;
        return { ...c, prospect_count: prospectCount };
      });
      return ok(enriched);
    }
    if (b === undefined && m === 'POST') {
      const data = (body ?? {}) as any;
      if (!data.name) return fail('VALIDATION', 'Nom de campagne requis');
      const now = nowIso();
      const campaign = {
        id: genId('camp'),
        name: data.name,
        description: data.description ?? null,
        status: data.status ?? 'draft',
        target: data.target ?? null,
        created_by: data.created_by ?? null,
        created_at: now,
        updated_at: now,
      };
      embStore.upsert('campaigns', campaign);
      return ok(campaign);
    }
    if (b && c === 'prospects') {
      if (m === 'POST') {
        const pid = (body as any)?.prospect_id ?? (body as any)?.id;
        if (!pid) return fail('VALIDATION', 'prospect_id requis');
        const link = { id: genId('cpl'), campaign_id: b, prospect_id: pid, status: 'added', added_at: nowIso() };
        const links = parseJson<any[]>(JSON.stringify(embStore.list('campaigns'))) ?? [];
        const rels = embStore.list<any>('settings').filter((s) => s.id?.startsWith('cpl:'));
        // simple approach : stocker les liens dans settings
        const rows = embStore.list<any>('settings').filter((s) => String(s.id).startsWith('cpl:'));
        embStore.upsert('settings', { id: `cpl:${b}:${pid}`, campaign_id: b, prospect_id: pid, added_at: nowIso() });
        void links; void rels;
        return ok({ added: true, prospect_id: pid });
      }
      if (m === 'DELETE' && d) {
        embStore.replace('settings', embStore.list<any>('settings').filter((s) => !(String(s.id) === `cpl:${b}:${d}`)));
        return ok({ removed: true });
      }
      // GET campaign/:id/prospects
      const pids = embStore.list<any>('settings').filter((s) => String(s.campaign_id) === String(b)).map((s) => s.prospect_id);
      const list = embStore.list<any>('prospects').filter((p) => pids.includes(String(p.id)));
      return ok(list);
    }
    if (b && m === 'GET') {
      const campaign = embStore.get('campaigns', b);
      if (!campaign) return fail('NOT_FOUND', 'Campagne introuvable', 404);
      return ok(campaign);
    }
  }

  // ---------- Intelligence ----------
  if (a === 'intelligence') {
    if (b === 'engines') {
      return ok([
        { id: 'local-deterministic', label: 'Scoring déterministe (embarqué)', available: true, offline: true },
        { id: 'web-intelligence', label: 'Analyse web / IA', available: false, offline: false },
        { id: 'linkedin', label: 'LinkedIn People', available: false, offline: false },
        { id: 'maps', label: 'Google Maps / Local', available: false, offline: false },
        { id: 'seo', label: 'SEO / Contenu', available: false, offline: false },
        { id: 'social', label: 'Réseaux sociaux', available: false, offline: false },
        { id: 'crm', label: 'CRM / Signaux', available: false, offline: false },
      ]);
    }
    // GET /intelligence — liste des analyses (résultats récents)
    if (b === undefined && m === 'GET') {
      const list = embStore.list<any>('intelligence').sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
      const qType = params.get('entity_type');
      const qId = params.get('entity_id');
      const filtered = qType ? list.filter((r) => r.entity_type === qType && (!qId || String(r.entity_id) === String(qId))) : list;
      return ok(filtered);
    }
    if (b === 'analyze' && m === 'POST') {
      const data = (body ?? {}) as any;
      const entityType = data.entity_type ?? data.type;
      const entityId = data.entity_id ?? data.id;
      if (!entityType || !entityId) return fail('VALIDATION', 'entity_type et entity_id requis');
      const jobId = createLocalJob(entityType === 'prospect' ? 'prospect' : 'company', String(entityId), {
        provider: data.provider,
        model: data.model,
      });
      return ok({ job_id: jobId, status: 'queued', poll_url: `/api/jobs/${jobId}`, mode: 'embedded' });
    }
    if (b === 'explain' && c && d) {
      const bd = latestBreakdown(c, d);
      if (!bd) return fail('NOT_FOUND', 'Aucune trace de calcul pour cette entité — lancez une analyse', 404);
      return ok({
        entity_type: c,
        entity_id: d,
        input_hash: bd.input_hash,
        computed_at: bd.computed_at,
        prompt_version: 'embedded-v1',
        scoring_version: 'embedded-v1',
        criteria: bd.breakdown,
        aggregate: bd.aggregate,
        missing_critical: bd.breakdown
          .filter((x: any) => (x.direction === 'negative' || x.direction === 'informational') && x.weight >= 0.05 && x.value === 0)
          .sort((x: any, y: any) => y.weight - x.weight)
          .slice(0, 5)
          .map((x: any) => ({ id: x.id, label: x.label, weight: x.weight })),
      });
    }
    if (b === 'prospect' || b === 'pipeline') {
      // Prospection / pipeline — mode embarqué : réponse locale directe
      if (b === 'prospect' && m === 'POST' && c !== undefined) {
        // /intelligence/prospect → sessionId de la forme "sess_..."
        const sessionId = genId('sess');
        const bodyData = (body ?? {}) as any;
        const sector = bodyData.sector ?? bodyData.query ?? params.get('sector') ?? '';
        const companies = sector
          ? embStore.list<any>('companies').filter((x) => String(x.sector ?? x.industry ?? '').toLowerCase().includes(String(sector).toLowerCase())).slice(0, 10)
          : embStore.list<any>('companies').slice(0, 10);
        const ranked = companies.map((c2) => ({ ...c2, aggregate: aggregateScoreFor(c2) }))
          .sort((x, y) => y.aggregate.score - x.aggregate.score);
        return ok({ session_id: sessionId, status: 'done', total: ranked.length, companies: ranked, mode: 'embedded' });
      }
      if (b === 'pipeline' && c === 'local-prospect' && m === 'POST') {
        const data = (body ?? {}) as any;
        const prospect = embStore.get('prospects', data.prospect_id ?? data.id);
        if (!prospect) return fail('NOT_FOUND', 'Prospect introuvable', 404);
        const { record, aggregate, breakdown } = buildAnalysisRecord('prospect', prospect.id, prospectToEntity(prospect), {});
        return ok({ analysis: record, raw: { aggregate, breakdown_count: breakdown.length }, provider: 'local-deterministic', mode: 'embedded' });
      }
      if (b === 'pipeline' && c === 'local-company' && m === 'POST') {
        const data = (body ?? {}) as any;
        const company = embStore.get('companies', data.company_id ?? data.id);
        if (!company) return fail('NOT_FOUND', 'Entreprise introuvable', 404);
        const { record, aggregate, breakdown } = buildAnalysisRecord('company', company.id, companyToEntity(company), {});
        return ok({ analysis: record, raw: { aggregate, breakdown_count: breakdown.length }, provider: 'local-deterministic', mode: 'embedded' });
      }
      if (b === 'pipeline' && (c === 'prospect' || c === 'company' || c === 'query')) {
        return fail('OFFLINE_FEATURE', 'Pipeline IA web indisponible en mode embarqué — utilisez l’analyse locale', 503);
      }
    }
    // GET /intelligence/:type/:id/signals
    if (c === 'signals' && b) {
      return ok(embStore.list<any>('signals').filter((s) => String(s.entity_id) === String(b)).slice(0, 5));
    }
    // GET /intelligence/:type/:id
    if (b && c) {
      const row = latestIntelligence(b, c) ?? null;
      return ok(row);
    }
  }

  // ---------- Jobs ----------
  if (a === 'jobs') {
    if (b === undefined && m === 'GET') return ok(listJobs(50));
    if (b === undefined && m === 'POST') {
      const data = (body ?? {}) as any;
      const entityType = data.entity_type ?? data.type;
      const entityId = data.entity_id ?? data.id;
      if (!entityType || !entityId) return fail('VALIDATION', 'entity_type et entity_id requis');
      const jobId = createLocalJob(entityType === 'prospect' ? 'prospect' : 'company', String(entityId), {
        provider: data.provider,
        model: data.model,
      });
      return ok({ job_id: jobId, status: 'queued', poll_url: `/api/jobs/${jobId}` });
    }
    if (b && c === 'cancel' && m === 'POST') {
      const canceled = cancelLocalJob(b);
      return ok({ ok: canceled, status: getJob(b)?.status ?? 'unknown' });
    }
    if (b && c === 'retry' && m === 'POST') {
      const newId = retryLocalJob(b);
      if (!newId) return fail('NOT_FOUND', 'Job introuvable', 404);
      return ok({ job_id: newId, status: 'queued', poll_url: `/api/jobs/${newId}`, retry_of: b });
    }
    if (b) {
      const job = getJob(b) as LocalJob | undefined;
      if (!job) return fail('NOT_FOUND', 'Job introuvable', 404);
      return ok(job);
    }
  }

  // ---------- Engine (Zentara One) ----------
  if (a === 'engine') {
    if (b === 'status') {
      // Probe du backend (bloquant ici pour donner le vrai statut)
      if (getBackendUrl()) {
        await probeBackend();
      }
      const ws = getWebSourceStatus();
      const linkedinAvailable = ws.find((x) => x.source === 'zentara-people')?.available ?? false;
      const backendConfigured = getBackendUrl() !== null;
      return ok({
        engine: 'zentara-one',
        groups: [
          { id: 'local', label: 'Base locale (offline)', available: true },
          { id: 'zentara-companies', label: 'Companies (SEC EDGAR)', available: ws.find((x) => x.source === 'zentara-companies')?.available ?? false },
          { id: 'zentara-people', label: 'People (LinkedIn)', available: linkedinAvailable },
          { id: 'zentara-local', label: 'Local (OpenStreetMap)', available: ws.find((x) => x.source === 'zentara-local')?.available ?? false },
        ],
        modes: ['all', 'companies', 'people', 'local'],
        mode: 'embedded',
        backend: {
          configured: backendConfigured,
          reachable: _backendReachable,
          url: backendConfigured ? getBackendUrl() : null,
        },
      });
    }
    if (b === 'search' && m === 'POST') {
      const data = (body ?? {}) as any;
      const mode = data.mode ?? 'all';
      const query = String(data.query ?? data.q ?? '').trim();
      const needs = String(data.needs ?? data.roles ?? '').trim();
      const location = String(data.location ?? '').trim();
      const limit = Math.min(Number(data.limit) || 20, 100);
      const radiusKm = Number(data.radius) || 10;

      if (!query && !needs && !location) {
        return ok({ engine: 'local', mode, results: [], total: 0, sources: [], errors: getOfflineErrors(), companies_created: 0, prospects_created: 0, contacts_created: 0 });
      }

      // 1. BACKEND (bonus : LinkedIn + 42 sources) — probe rapide avant d'essayer.
      //    Si le backend est mort, on va directement au fallback SEC+OSM (0 attente).
      let results: any[] = [];
      let usedSources: string[] = [];
      const backendUrl = getBackendUrl();

      if (backendUrl) {
        // Probe rapide : on teste si le backend répond en 4s max.
        const alive = await probeBackend();
        if (alive) {
          try {
            const bp: any = { mode, query: query || undefined, needs: needs || undefined, roles: needs || undefined, location: location || undefined, radius: radiusKm || undefined, limit, save: false };
            const resp = await fetchBackendSearch(bp);
            if (resp && Array.isArray(resp.results) && resp.results.length > 0) {
              results = resp.results.map((bh: any) => ({
                id: bh.id ?? 'be-' + Math.random().toString(36).slice(2, 10),
                type: bh.type ?? 'company', name: bh.name, title: bh.title ?? null,
                category: bh.category ?? null, city: bh.city ?? null, country: bh.country ?? null,
                website: bh.website ?? null, email: bh.email ?? null, phone: bh.phone ?? null,
                linkedin: bh.linkedin ?? null,
                source: bh.source ?? 'backend', sourceGroup: bh.sourceGroup ?? bh.source ?? 'backend',
                confidence: bh.confidence ?? 0.9, score: bh.score ?? 65,
                tags: bh.tags ?? [], company_id: bh.company_id ?? null, company_created: false,
              }));
              usedSources = (resp.sources || []).slice();
            }
          } catch (e) { console.warn('[engine] backend:', e); }
        }
      }

      // 2. FALLBACK: SEC EDGAR + OSM direct (browser) if backend returned nothing
      if (results.length === 0 && (query || needs)) {
        usedSources = ['browser-direct'];
        try {
          const tickerMatch = (query || needs).match(/^[A-Z]{1,5}$/);
          const edgarResults = tickerMatch
            ? (await searchEDGARByTicker(tickerMatch[0]).then(r => r ? [r] : [], () => []))
            : await searchEDGAR(query || needs, Math.ceil(limit));
          for (const r of edgarResults) {
            results.push({
              id: 'edgar-' + r.cik, type: 'company', name: r.name, title: r.ticker,
              category: r.sector, city: r.city, country: r.country,
              website: r.website, email: r.email, phone: null, linkedin: null,
              source: r.source, sourceGroup: 'sec-edgar', confidence: r.confidence,
              score: r.ticker ? 60 : 40, tags: r.ticker ? [r.ticker] : [],
              company_id: null, company_created: false,
            });
          }
          if (edgarResults.length > 0) usedSources.push('sec-edgar');
        } catch {}

        if (results.length < limit) {
          try {
            let lat = 48.8566, lon = 2.3522;
            if (location) {
              const geo = await geocodeNominatim(location);
              if (geo) { lat = geo.lat; lon = geo.lon; }
            }
            const osm = await searchOverpass(query || needs || 'office', lat, lon, radiusKm * 1000, Math.ceil((limit - results.length) / 2));
            for (const r of osm) {
              if (!results.find(x => x.name?.toLowerCase() === r.name.toLowerCase())) {
                results.push({
                  id: r.id, type: 'company', name: r.name, title: null,
                  category: r.category, city: r.city, country: r.country,
                  website: r.website, email: r.email, phone: r.phone, linkedin: null,
                  source: r.source, sourceGroup: 'openstreetmap', confidence: r.confidence,
                  score: 50, tags: [], company_id: null, company_created: false,
                });
              }
            }
            if (osm.length > 0) usedSources.push('openstreetmap');
          } catch {}
        }
      }

      results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      const final = results.slice(0, limit);

      return ok({
        engine: 'zentara-one', mode, results: final, total: final.length,
        sources: [...new Set(usedSources)], errors: getOfflineErrors(),
        companies_created: 0, prospects_created: 0, contacts_created: 0,
      });
    }
    if (b === 'job-email' && m === 'POST') {
      const data = (body ?? {}) as any;
      const company = data.company_id
        ? findCompany(data.company_id)
        : embStore.list<any>('companies').find((c) => String(c.name).toLowerCase() === String(data.name ?? '').toLowerCase() || (data.website && String(c.website).toLowerCase() === String(data.website).toLowerCase()));
      const entity = company ?? { name: data.name ?? data.query ?? 'votre entreprise', website: data.website, email: data.email, sector: data.category ?? data.sector };
      const agg = runDeterministicAnalysis(entity as EntityLike, {}).aggregate;
      const draft = buildEmailDraft(entity as EntityLike, agg, { ctaUrl: data.cta_url });
      return ok({ subject: draft.subject, body: draft.body, html: draft.html, cta_url: draft.cta_url });
    }
    if (b === 'job-email-sequence' && m === 'POST') {
      return ok({ ok: true, sequence: null, message: 'Séquences multi-emails indisponibles en mode embarqué' });
    }
    if (b === 'job-save' && m === 'POST') {
      const data = (body ?? {}) as any;
      if (!data.name) return fail('VALIDATION', 'name requis');
      const now = nowIso();
      const company = {
        id: genId('comp'),
        name: data.name,
        website: data.website ?? null,
        sector: data.category ?? data.sector ?? null,
        industry: data.industry ?? null,
        address: null,
        city: data.city ?? null,
        country: data.country ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        social_profiles: null,
        google_maps_url: null,
        score: Number(data.score) || 0,
        status: 'new',
        notes: data.notes ?? null,
        tags: null,
        created_at: now,
        updated_at: now,
      };
      embStore.upsert('companies', company);
      return ok({ company_id: company.id, created: true });
    }
    if (b === 'job-save-draft' && m === 'POST') {
      return ok({ saved: true });
    }
  }

  // ---------- Emails / Outreach ----------
  if (a === 'emails') {
    if (b === undefined && m === 'GET') return ok(embStore.list<any>('emails').sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))));
    if (b === undefined && m === 'POST') {
      const data = (body ?? {}) as any;
      const email = {
        id: data.id ?? genId('eml'),
        prospect_id: data.prospect_id ?? null,
        company_id: data.company_id ?? null,
        subject: data.subject ?? '',
        body: data.body ?? '',
        html: data.html ?? null,
        status: data.status ?? 'draft',
        tone: data.tone ?? null,
        template_id: data.template_id ?? null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      embStore.upsert('emails', email);
      return ok(email);
    }
    if (b) {
      const e = embStore.get('emails', b);
      if (!e) return fail('NOT_FOUND', 'Email introuvable', 404);
      if (m === 'GET') return ok(e);
      if (m === 'PATCH' || m === 'PUT') {
        const updated = { ...e, ...(body as any), updated_at: nowIso() };
        embStore.upsert('emails', updated);
        return ok(updated);
      }
      if (m === 'DELETE') {
        embStore.remove('emails', b);
        return ok({ deleted: true });
      }
    }
  }

  if (a === 'outreach') {
    if (b === 'company' && c) {
      const company = findCompany(c);
      const prospects = embStore.list<any>('prospects').filter((p) => String(p.company_id) === String(c));
      const emails = embStore.list<any>('emails').filter((e) =>
        String(e.company_id) === String(c) || prospects.some((p) => String(p.id) === String(e.prospect_id)));
      const sent = emails.filter((e) => e.status === 'sent').length;
      const replied = emails.filter((e) => e.status === 'replied').length;
      return ok({
        company: company ?? null,
        emails: emails.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))),
        sequences: [],
        total_emails: emails.length,
        sent_count: sent,
        replied_count: replied,
        best_tone: null,
      });
    }
    if (b === 'draft' && m === 'POST') {
      const data = (body ?? {}) as any;
      const prospect = embStore.get('prospects', data.prospect_id ?? data.id);
      if (!prospect) return fail('NOT_FOUND', 'Prospect introuvable', 404);
      const company = prospect.company_id ? findCompany(prospect.company_id) : undefined;
      const entity = { ...prospectToEntity(prospect), ...(company ? { name: company.name, website: company.website, sector: company.sector ?? prospect.sector } : {}) };
      const agg = runDeterministicAnalysis(entity, {}).aggregate;
      const draft = buildEmailDraft(entity, agg, { ctaUrl: data.cta_url });
      const email = {
        id: genId('eml'),
        prospect_id: prospect.id,
        company_id: company?.id ?? null,
        subject: draft.subject,
        body: draft.body,
        html: draft.html,
        status: 'draft',
        tone: data.tone ?? 'outreach',
        template_id: draft.template_id,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      if (data.persist !== false) embStore.upsert('emails', email);
      return ok({ emails: [email], sequence: null });
    }
    if (b === 'send' && m === 'POST') {
      const data = (body ?? {}) as any;
      const email = embStore.get('emails', data.email_id);
      if (email) {
        embStore.upsert('emails', { ...email, status: 'sent', sent_at: data.sent_at ?? nowIso(), updated_at: nowIso() });
        return ok({ email: embStore.get('emails', data.email_id), sequence: null });
      }
      return fail('NOT_FOUND', 'Email introuvable', 404);
    }
    if (b === 'respond' && m === 'POST') {
      const data = (body ?? {}) as any;
      const email = embStore.get('emails', data.email_id);
      if (email) {
        embStore.upsert('emails', { ...email, status: 'replied', updated_at: nowIso() });
      }
      return ok({ ok: true, sequence: null });
    }
    if (b === 'timeline' && c) {
      const emails = embStore.list<any>('emails')
        .filter((e) => String(e.prospect_id) === String(c))
        .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
      return ok({ prospect_id: c, timeline: emails, sequences: [] });
    }
    if (b === 'inbox') return ok(embStore.list<any>('emails'));
  }

  // ---------- Email templates ----------
  if (a === 'email-templates') {
    if (b === 'from-analysis' && c && d && m === 'POST') {
      const intel = latestIntelligence(c, d);
      const entity = c === 'company' ? findCompany(d) : embStore.get('prospects', d);
      const agg = intel?.profile
        ? { opportunity_score: intel.opportunity_score, need_score: intel.need_score, urgency: null, contact_risk: null, confidence: intel.confidence_score, strengths: parseJson<any[]>(intel.insights)?.map((x) => ({ label: x })) ?? [], weaknesses: parseJson<any[]>(intel.risks)?.map((x) => ({ label: x })) ?? [] }
        : runDeterministicAnalysis((entity ?? { name: d }) as EntityLike, {}).aggregate;
      const draft = buildEmailDraft((entity ?? { name: d }) as EntityLike, agg, { templateId: (body as any)?.template_id });
      return ok({ subject: draft.subject, html: draft.html, body: draft.body, template: draft.template_id });
    }
    return ok(listEmailTemplates());
  }

  // ---------- Search ----------
  if (a === 'search') {
    if (b === 'external') {
      if (m === 'POST') {
        // La recherche web externe (keelead, MCP, etc.) nécessite le backend.
        // Le mode embarqué utilise les APIs directes (Overpass + SEC EDGAR)
        // exposées via /engine/search (Zentara One).
        const ws = getWebSourceStatus();
        const available = ws.filter((s) => s.available);
        return ok({
          results: [],
          total: 0,
          sources: ['local-db', ...available.map((s) => s.source)],
          errors: ws.filter((s) => !s.available).map((s) => ({ source: s.source, message: s.message })),
        });
      }
      if (m === 'GET') return ok({ running: false, last: null, sources: [] });
      if (c === 'import' && m === 'POST') return ok({ imported: 0 });
    }
    if (m === 'GET') {
      const q = params.get('q') ?? '';
      const companies = searchLocal(q, 'all', 25);
      return ok({ query: q, results: companies, total: companies.length, mode: 'embedded' });
    }
  }

  // ---------- Analytics ----------
  if (a === 'analytics') {
    const count = (t: string) => embStore.count(t as any);
    if (b === 'overview') {
      return ok({
        users: count('users'),
        companies: count('companies'),
        prospects: count('prospects'),
        contacts: count('contacts'),
        campaigns: count('campaigns'),
        intelligence: count('intelligence'),
        signals: count('signals'),
        ai_analyses: count('intelligence'),
        monitoring: count('signals'),
        mode: 'embedded',
      });
    }
    if (b === 'prospects' || b === 'companies' || b === 'campaigns' || b === 'intelligence') {
      return ok({ total: count(b), mode: 'embedded' });
    }
    if (b === 'timeseries') {
      const metric = params.get('metric') ?? 'hot_prospects';
      const days = Number(params.get('days') ?? 12);
      const intel = embStore.list<any>('intelligence');
      const companies = embStore.list<any>('companies');
      const prospects = embStore.list<any>('prospects');
      const points: Array<{ date: string; value: number }> = [];
      const now = Date.now();
      for (let i = days - 1; i >= 0; i--) {
        const dayStart = new Date(now - i * 86400_000);
        const dateKey = dayStart.toISOString().slice(0, 10);
        let value = 0;
        const source = metric === 'hot_companies' ? companies : metric === 'hot_prospects' ? prospects : intel;
        value = source.filter((r: any) => (r.created_at ?? '').slice(0, 10) <= dateKey).length;
        points.push({ date: dateKey, value });
      }
      return ok({ metric, days, points, mode: 'embedded' });
    }
    if (b === 'hot-prospects') {
      const minScore = Number(params.get('min_score') ?? 70);
      const limit = Number(params.get('limit') ?? 25);
      const offset = Number(params.get('offset') ?? 0);
      const list = embStore.list<any>('prospects')
        .map((p) => ({ ...p, company_name: findCompany(p.company_id)?.name ?? null, reasons: (Number(p.score) || 0) >= minScore ? ['Score élevé'] : [] }))
        .filter((p) => (Number(p.score) || 0) >= minScore)
        .sort((x, y) => (Number(y.score) || 0) - (Number(x.score) || 0));
      const total = list.length;
      return ok({ data: list.slice(offset, offset + limit), meta: { total, limit, offset, threshold: minScore } });
    }
  }

  // ---------- Tasks ----------
  if (a === 'tasks') {
    if (b === 'counts') {
      const unseen = embStore.list<any>('tasks').filter((t) => !t.seen).length;
      return ok({ total: embStore.count('tasks'), unseen, critical: 0 });
    }
    if (b === 'heartbeat') return ok({ server_time: nowIso(), ok: true, mode: 'embedded' });
    if (b === 'seen-bulk' && m === 'POST') {
      const ids = (body as any)?.ids ?? [];
      for (const id of ids) {
        const t = embStore.get('tasks', id);
        if (t) embStore.upsert('tasks', { ...t, seen: true, seen_at: nowIso() });
      }
      return ok({ marked: ids.length });
    }
    if (b && c === 'seen' && m === 'POST') {
      const t = embStore.get('tasks', b);
      if (t) embStore.upsert('tasks', { ...t, seen: true, seen_at: nowIso() });
      return ok({ ok: true });
    }
    if (b && m === 'DELETE') {
      embStore.remove('tasks', b);
      return ok({ deleted: true });
    }
    if (b === undefined && m === 'GET') {
      const limit = Number(params.get('limit') ?? 25);
      return ok(embStore.list<any>('tasks').sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, limit));
    }
  }

  // ---------- Monitoring ----------
  if (a === 'monitoring') {
    if (b) {
      if (m === 'DELETE') {
        embStore.remove('signals', b);
        return ok({ deleted: true });
      }
      const s = embStore.get('signals', b);
      if (!s) return fail('NOT_FOUND', 'Signal introuvable', 404);
      return ok(s);
    }
    return ok(embStore.list<any>('signals').sort((x, y) => String(y.detected_at ?? y.created_at ?? '').localeCompare(String(x.detected_at ?? x.created_at ?? ''))));
  }

  // ---------- Contracts ----------
  if (a === 'contracts') {
    if (b === 'catalog') {
      return ok([
        { id: 'zentara-prospecting', name: 'Zentara Prospecting', description: 'Automatisation de la prospection commerciale', price_monthly_eur: 49 },
        { id: 'zentara-analytics', name: 'Zentara Analytics', description: 'Tableaux de bord d’intelligence commerciale', price_monthly_eur: 79 },
        { id: 'zentara-enterprise', name: 'Zentara Enterprise', description: 'Déploiement complet + API', price_monthly_eur: 199 },
      ]);
    }
    if (b === 'generate' && m === 'POST') {
      const data = (body ?? {}) as any;
      const type = data.type ?? 'NDA';
      const title = data.title ?? `${type} — Zentara`;
      const now = nowIso();
      const bodyText = buildContractBody(type, data);
      const contract = {
        id: genId('con'),
        type,
        status: 'draft',
        title,
        body: bodyText,
        party_a_id: data.party_a_id ?? null,
        party_b_id: data.party_b_id ?? null,
        party_b_kind: data.party_b_kind ?? 'company',
        party_b_name: data.party_b_name ?? null,
        party_b_email: data.party_b_email ?? null,
        product_ref: data.product_ref ?? null,
        variables: data.variables ?? null,
        created_via: 'embedded',
        source_task_id: null,
        source_signal_id: null,
        notes: data.notes ?? null,
        created_at: now,
        updated_at: now,
      };
      embStore.upsert('contracts', contract);
      return ok({ contract, auto_drafted: true, mode: 'embedded' });
    }
    if (b === 'auto-draft' && m === 'POST') {
      return ok({ contract: null, skipped: true, message: 'Auto-draft indisponible en mode embarqué' });
    }
    if (b === 'by-party' && c) {
      return ok(embStore.list<any>('contracts').filter((x) => String(x.party_b_id) === String(c) || String(x.party_b_name) === String(c)));
    }
    if (b && c === 'status' && m === 'POST') {
      const contract = embStore.get('contracts', b);
      if (!contract) return fail('NOT_FOUND', 'Contrat introuvable', 404);
      const updated = { ...contract, status: (body as any)?.status ?? contract.status, notes: (body as any)?.notes ?? contract.notes, updated_at: nowIso() };
      embStore.upsert('contracts', updated);
      return ok({ contract: updated });
    }
    if (b) {
      const contract = embStore.get('contracts', b);
      if (!contract) return fail('NOT_FOUND', 'Contrat introuvable', 404);
      if (m === 'GET') return ok(contract);
      if (m === 'DELETE') {
        embStore.remove('contracts', b);
        return ok({ deleted: true });
      }
    }
    if (b === undefined && m === 'GET') {
      return ok(embStore.list<any>('contracts').sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))));
    }
  }

  // ---------- Auto-analysis ----------
  if (a === 'auto-analysis') {
    if (b === 'failures') return ok({ company_ids: [] });
    if (b === 'last') return ok(null);
    if (b === 'status') return ok({ running: false, last_run_at: null, mode: 'embedded' });
    if (b === 'analyze-now' && m === 'POST') {
      const data = (body ?? {}) as any;
      const company = findCompany(data.company_id ?? data.id);
      if (company) {
        const jobId = createLocalJob('company', company.id, {});
        return ok({ job_id: jobId, status: 'queued', mode: 'embedded' });
      }
      return fail('NOT_FOUND', 'Entreprise introuvable', 404);
    }
    if (b === 'enrich' && m === 'POST') {
      const data = (body ?? {}) as any;
      const company = findCompany(data.company_id ?? data.id);
      if (company) {
        const jobId = createLocalJob('company', company.id, {});
        return ok({ job_id: jobId, status: 'queued', enriched: true, mode: 'embedded' });
      }
      return fail('NOT_FOUND', 'Entreprise introuvable', 404);
    }
    if (b === 'sweep' && m === 'POST') return ok({ started: true, session_id: genId('sess'), mode: 'embedded' });
  }

  // ---------- Knowledge ----------
  if (a === 'knowledge') {
    if (b === 'stats') return ok({ chunks: 0, sources: [], mode: 'embedded' });
    if (b === 'search' && m === 'POST') return ok({ results: [], total: 0 });
    if (b === 'ingest' && m === 'POST') return ok({ chunk_ids: [], ingested: 0 });
    if (b && m === 'GET') return ok(null);
    if (b && m === 'DELETE') return ok({ deleted: true });
  }

  // ---------- Chat ----------
  if (a === 'chat') {
    if (b === 'status') return ok({ provider: 'local', model: 'zentara-embedded-v1', mode: 'embedded' });
    if (b === 'messages') return ok([]);
  }

  // ---------- Design audit ----------
  if (a === 'design-audit') {
    if (b === 'hunt' && m === 'POST') return ok({ audits: [], message: 'Audit web indisponible en mode embarqué' });
    if (b === undefined && m === 'POST') return fail('OFFLINE_FEATURE', 'Analyse de site web indisponible en mode embarqué (nécessite un serveur ou un accès web)', 503);
    if (b === undefined && m === 'GET') return ok([]);
    if (b === 'for-company' && c) return ok([]);
    if (b && m === 'GET') return ok(null);
    if (b && m === 'DELETE') return ok({ deleted: true });
  }

  // ---------- Settings ----------
  if (a === 'settings') {
    if (m === 'GET') {
      const rows = embStore.list<any>('settings');
      const out: Record<string, unknown> = {};
      for (const r of rows) if (r.key) out[r.key] = r.value;
      out.backend_mode = 'embedded';
      return ok(out);
    }
    if (m === 'POST' || m === 'PATCH' || m === 'PUT') {
      const data = (body ?? {}) as any;
      for (const [k, v] of Object.entries(data)) {
        embStore.upsert('settings', { id: `key:${k}`, key: k, value: v, updated_at: nowIso() });
      }
      return ok({ saved: true });
    }
  }

  // ---------- Non géré ----------
  return { handled: false };
}

function buildContractBody(type: string, data: any): string {
  const partyB = data.party_b_name ?? data.party_b_email ?? '[Partie B]';
  const product = data.product_ref ?? data.product ?? 'les services Zentara';
  const date = new Date().toLocaleDateString('fr-FR');
  const intro = `${type.toUpperCase()} — Zentara\nDate : ${date}\nEntre : Zentara (Partie A) et ${partyB} (Partie B).\n\n`;
  if (type === 'NDA') {
    return intro +
      '1. Objet : confidentialité des informations échangées dans le cadre d’une évaluation commerciale.\n' +
      '2. Obligations : chaque partie s’engage à ne pas divulguer les informations confidentielles reçues.\n' +
      '3. Durée : 24 mois à compter de la signature.\n' +
      '4. Exclusions : informations publiques, antérieures, ou développées indépendamment.\n' +
      '5. Droit applicable : France.\n';
  }
  if (type === 'QUOTE' || type === 'DEVIS') {
    return intro +
      `1. Prestations : ${product}.\n` +
      `2. Prix : ${data.price ?? '[montant]'} € HT / mois.\n` +
      '3. Durée : engagement de 12 mois, reconduction tacite.\n' +
      '4. Facturation : mensuelle, à terme échu.\n' +
      '5. Conditions : signature électronique suffisante.\n';
  }
  return intro +
    `1. Objet : fourniture de ${product}.\n` +
    '2. Responsabilités des parties : conformément aux CGV Zentara.\n' +
    '3. Données : traitement conforme au RGPD (DPA inclus).\n' +
    '4. Durée : 12 mois renouvelables.\n' +
    '5. Droit applicable : France.\n';
}
