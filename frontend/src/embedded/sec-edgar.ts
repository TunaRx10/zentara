/**
 * sec-edgar.ts — Client SEC EDGAR (v2) direct depuis le navigateur.
 *
 * Stratégie : API EDGAR Full-Text Search (efts.sec.gov) d'abord (CORS ✓, rapide),
 * puis enrichissement des résultats avec submissions SEC par CIK.
 *
 * Docs : https://www.sec.gov/edgar/sec-api-documentation
 * Rate limit : 10 req/s (User-Agent obligatoire).
 */
'use strict';

export interface EDGARCompany {
  cik: string;
  name: string;
  ticker: string | null;
  exchange: string | null;
  sector: string | null;
  city: string | null;
  state: string | null;
  country: string;
  website: null;
  email: null;
  source: string;
  confidence: number;
}

interface EDGARTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

interface EDGARSubmissions {
  cik: string;
  name: string;
  sic: string;
  sicDescription: string;
  tickers: string[];
  exchanges: string[];
  addresses?: {
    mailing?: { city?: string; stateOrCountry?: string };
    business?: { city?: string; stateOrCountry?: string };
  };
}

const UA = 'Zentara/1.0 (tunation.fr@gmail.com)';

const SIC_MAP: Record<string, string> = {
  '73':'Technology / Software','737':'Technology / Software','7370':'SaaS / Software','7371':'Software Consulting',
  '7372':'Enterprise Software','7373':'SaaS / Cloud','60':'Finance / Banking','602':'Banking','61':'Finance',
  '62':'Trading / Brokerage','63':'Insurance','64':'Insurance','65':'Real Estate',
  '28':'Chemicals / Pharma','283':'Pharma / Biotech','2834':'Pharma','2836':'Biotech',
  '35':'Industrial','36':'Electronics','367':'Semiconductors','3674':'Semiconductors',
  '38':'Medical Instruments','384':'Medical Devices','48':'Telecom','481':'Telecom',
  '80':'Healthcare','801':'Healthcare Services','82':'Education','87':'Consulting','874':'Consulting',
};

function sicToSector(sic: string | null): string | null {
  if (!sic) return null;
  const keys = Object.keys(SIC_MAP).sort((a, b) => b.length - a.length);
  for (const k of keys) { if (sic.startsWith(k)) return SIC_MAP[k]; }
  return null;
}

// ---- Ticker mapping (2MB, mise en cache 6h) ----

let _tickerMap: Record<string, EDGARTickerEntry> | null = null;
let _tickerTs = 0;

async function loadTickerMap(): Promise<Record<string, EDGARTickerEntry>> {
  const now = Date.now();
  // Cache 6h en mémoire (le fetch prend ~2s sur une bonne connexion)
  if (_tickerMap && (now - _tickerTs) < 21_600_000) return _tickerMap;

  // Essayer le cache localStorage d'abord
  try {
    const cached = localStorage.getItem('zsec.tickers');
    const cachedTs = Number(localStorage.getItem('zsec.tickersTs') || '0');
    if (cached && (now - cachedTs) < 3_600_000) {
      _tickerMap = JSON.parse(cached);
      _tickerTs = cachedTs;
      return _tickerMap!;
    }
  } catch { /* noop */ }

  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`SEC tickers HTTP ${res.status}`);
  const raw: Record<string, EDGARTickerEntry> = await res.json();

  const map: Record<string, EDGARTickerEntry> = {};
  for (const v of Object.values(raw)) {
    if (v.ticker) map[v.ticker.toUpperCase()] = v;
  }
  _tickerMap = map;
  _tickerTs = now;

  // Cache localStorage
  try { localStorage.setItem('zsec.tickers', JSON.stringify(map)); localStorage.setItem('zsec.tickersTs', String(now)); } catch { /* noop */ }

  return map;
}

function cikToPadded(cik: number | string): string {
  return String(Number(cik)).padStart(10, '0');
}

/** Enrichit une entrée ticker avec les détails submissions SEC (secteur, ville, etc.). */
async function enrichWithSubmissions(r: EDGARCompany): Promise<EDGARCompany> {
  try {
    const res = await fetch(`https://data.sec.gov/submissions/CIK${r.cik}.json`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return r;
    const sub: EDGARSubmissions = await res.json();
    r.name = sub.name || r.name;
    r.ticker = sub.tickers?.[0] || r.ticker;
    r.exchange = sub.exchanges?.[0] || null;
    r.sector = sicToSector(sub.sic) || sub.sicDescription || null;
    r.city = sub.addresses?.business?.city || sub.addresses?.mailing?.city || null;
    r.state = sub.addresses?.business?.stateOrCountry || sub.addresses?.mailing?.stateOrCountry || null;
    r.country = 'US';
    r.confidence = 0.85;
  } catch { /* keep base data */ }
  return r;
}

// =====================================================================
// API publique : recherche
// =====================================================================

/**
 * Recherche rapide via EDGAR Full-Text Search (CORS ✓).
 * Renvoie les résultats immédiatement, puis les enrichit en arrière-plan.
 */
export async function searchEDGAR(query: string, limit = 10): Promise<EDGARCompany[]> {
  const q = String(query || '').trim();
  if (!q || q.length < 2) return [];

  try {
    // 1. EDGAR Full-Text Search (rapide, CORS ✓)
    const searchUrl = new URL('https://efts.sec.gov/LATEST/search-index');
    searchUrl.searchParams.set('q', q);
    searchUrl.searchParams.set('pageSize', String(Math.min(limit * 5, 100)));
    searchUrl.searchParams.set('startDate', '2023-01-01');
    searchUrl.searchParams.set('forms', '10-K,10-Q,8-K,S-1');

    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) throw new Error(`SEC efts HTTP ${res.status}`);

    const data = await res.json();
    const hits: Array<{ _source?: { ciks?: string[]; display_name?: string } }> = data?.hits?.hits || [];

    // 2. Regrouper par CIK unique
    const seen = new Set<string>();
    const companies: EDGARCompany[] = [];

    for (const h of hits) {
      const ciks = h._source?.ciks || [];
      for (const rawCik of ciks) {
        const cik = cikToPadded(rawCik);
        if (seen.has(cik)) continue;
        seen.add(cik);

        companies.push({
          cik,
          name: h._source?.display_name || `Company ${cik}`,
          ticker: null, exchange: null, sector: null,
          city: null, state: null, country: 'US',
          website: null, email: null,
          source: 'sec-edgar',
          confidence: 0.5,
        });

        if (companies.length >= limit) break;
      }
      if (companies.length >= limit) break;
    }

    // 3. Essayer de résoudre ticker + nom via le mapping (optionnel, async, best-effort)
    loadTickerMap().then(async (map) => {
      for (const c of companies) {
        // Chercher par CIK dans le mapping
        const cikNum = Number(c.cik);
        for (const [ticker, entry] of Object.entries(map)) {
          if (entry.cik_str === cikNum) {
            c.ticker = ticker;
            c.name = entry.title;
            break;
          }
        }
        // Enrichir avec submissions pour secteur/ville
        await enrichWithSubmissions(c);
      }
    }).catch(() => { /* best-effort */ });

    return companies;
  } catch (e) {
    console.warn('[sec-edgar] search failed:', e);
    return [];
  }
}

/** Recherche par ticker (ex: AAPL, MSFT). */
export async function searchEDGARByTicker(ticker: string): Promise<EDGARCompany | null> {
  try {
    const map = await loadTickerMap();
    const entry = map[ticker.toUpperCase().trim()];
    if (!entry) return null;

    const cik = cikToPadded(entry.cik_str);
    const company: EDGARCompany = {
      cik, name: entry.title, ticker: entry.ticker, exchange: null,
      sector: null, city: null, state: null, country: 'US',
      website: null, email: null, source: 'sec-edgar', confidence: 0.7,
    };
    return await enrichWithSubmissions(company);
  } catch (e) {
    console.warn('[sec-edgar] ticker search failed:', e);
    return null;
  }
}

/** Recherche par nom (fallback lent, parcourt le mapping ticker). */
export async function searchEDGARByName(name: string, limit = 10): Promise<EDGARCompany[]> {
  try {
    const map = await loadTickerMap();
    const nl = name.toLowerCase().trim();
    const results: EDGARCompany[] = [];

    for (const [ticker, entry] of Object.entries(map)) {
      if (entry.title.toLowerCase().includes(nl)) {
        results.push({
          cik: cikToPadded(entry.cik_str), name: entry.title, ticker: entry.ticker,
          exchange: null, sector: null, city: null, state: null, country: 'US',
          website: null, email: null, source: 'sec-edgar', confidence: 0.6,
        });
      }
      if (results.length >= limit + 10) break;
    }

    // Enrichir top 3
    for (let i = 0; i < Math.min(results.length, 3); i++) {
      results[i] = await enrichWithSubmissions(results[i]);
    }
    return results.slice(0, limit);
  } catch (e) {
    console.warn('[sec-edgar] name search failed:', e);
    return [];
  }
}

/** Recherche par secteur (parcourt le mapping ticker + submissions SIC). */
export async function searchEDGARBySector(keyword: string, limit = 10): Promise<EDGARCompany[]> {
  try {
    const map = await loadTickerMap();
    const kw = keyword.toLowerCase();
    const seen = new Set<string>();
    const results: EDGARCompany[] = [];

    for (const [ticker, entry] of Object.entries(map)) {
      if (entry.title.toLowerCase().includes(kw)) {
        if (seen.has(ticker)) continue;
        seen.add(ticker);
        results.push({
          cik: cikToPadded(entry.cik_str), name: entry.title, ticker: entry.ticker,
          exchange: null, sector: null, city: null, state: null, country: 'US',
          website: null, email: null, source: 'sec-edgar', confidence: 0.5,
        });
      }
      if (results.length >= limit * 3) break;
    }

    for (let i = 0; i < Math.min(results.length, limit); i++) {
      results[i] = await enrichWithSubmissions(results[i]);
    }
    return results.slice(0, limit);
  } catch (e) {
    console.warn('[sec-edgar] sector search failed:', e);
    return [];
  }
}