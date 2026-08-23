/**
 * sec-edgar.ts — Client SEC EDGAR API direct depuis le navigateur.
 *
 * Utilise l'API publique SEC EDGAR (https://efts.sec.gov/) pour rechercher
 * des entreprises enregistrées aux États-Unis. Gratuit, pas de clé requise.
 *
 * Docs : https://www.sec.gov/edgar/sec-api-documentation
 * Rate limit : 10 req/s (User-Agent requis).
 */

export interface EDGARCompany {
  cik: string;
  name: string;
  ticker: string | null;
  exchange: string | null;
  sector: string | null;
  city: string | null;
  state: string | null;
  country: string;
  website: null; // EDGAR ne fournit pas de site web directement
  email: null;
  source: string;
  confidence: number;
}

interface EDGARTickerResult {
  cik_str: number;
  ticker: string;
  title: string;
}

interface EDGARSubmissions {
  cik: string;
  entityType: string;
  sic: string;
  sicDescription: string;
  name: string;
  tickers: string[];
  exchanges: string[];
  addresses?: {
    mailing?: { city?: string; stateOrCountry?: string; zipCode?: string };
    business?: { city?: string; stateOrCountry?: string; zipCode?: string };
  };
}

const USER_AGENT = 'Zentara/1.0 (webapp; contact@zentara.dev)';

const SIC_TO_SECTOR: Record<string, string> = {
  '73': 'Technology / Software',
  '737': 'Technology / Software',
  '7370': 'Technology / Software',
  '7371': 'Technology / Software',
  '7372': 'Technology / Software',
  '7373': 'Technology / Software',
  '7374': 'Technology / Software',
  '60': 'Finance / Banking',
  '602': 'Finance / Banking',
  '603': 'Finance / Banking',
  '61': 'Finance / Banking',
  '62': 'Finance / Banking',
  '63': 'Insurance',
  '64': 'Insurance',
  '65': 'Real Estate',
  '67': 'Finance / Holding',
  '28': 'Chemicals / Pharma',
  '283': 'Pharma / Biotech',
  '2834': 'Pharma',
  '2836': 'Biotech',
  '35': 'Industrial / Manufacturing',
  '36': 'Electronics',
  '367': 'Semiconductors',
  '3674': 'Semiconductors',
  '38': 'Instruments / Medical',
  '384': 'Medical Devices',
  '3845': 'Medical Devices',
  '48': 'Telecom',
  '481': 'Telecom',
  '4813': 'Telecom',
  '49': 'Utilities / Energy',
  '50': 'Wholesale',
  '51': 'Wholesale',
  '52': 'Retail',
  '53': 'Retail',
  '54': 'Retail',
  '55': 'Automotive',
  '56': 'Apparel',
  '57': 'Retail',
  '58': 'Restaurants / Food',
  '581': 'Restaurants',
  '5812': 'Restaurants',
  '59': 'Retail',
  '70': 'Hospitality',
  '701': 'Hotels',
  '72': 'Services',
  '78': 'Entertainment',
  '781': 'Entertainment',
  '79': 'Entertainment',
  '80': 'Healthcare',
  '801': 'Healthcare',
  '82': 'Education',
  '87': 'Consulting / Services',
  '874': 'Consulting',
  '8741': 'Consulting',
};

function sicToSector(sic: string | null | undefined): string | null {
  if (!sic) return null;
  // Commence par les préfixes les plus longs
  const keys = Object.keys(SIC_TO_SECTOR).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (sic.startsWith(k)) return SIC_TO_SECTOR[k];
  }
  return null;
}

/** Télécharge le mapping ticker→CIK (fichier JSON complet, ~2MB). Mis en cache 1h. */
let tickerCache: { data: Record<string, EDGARTickerResult> | null; ts: number } = { data: null, ts: 0 };

async function fetchTickerMapping(): Promise<Record<string, EDGARTickerResult>> {
  const now = Date.now();
  if (tickerCache.data && (now - tickerCache.ts) < 3_600_000) {
    return tickerCache.data;
  }
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`SEC ticker fetch HTTP ${res.status}`);
  const raw = await res.json();
  // Convertit { "0": {cik_str, ticker, title}, ... } → { TICKER: {cik_str, ticker, title}, ... }
  const map: Record<string, EDGARTickerResult> = {};
  for (const v of Object.values(raw) as EDGARTickerResult[]) {
    if (v.ticker) map[v.ticker.toUpperCase()] = v;
  }
  tickerCache = { data: map, ts: now };
  return map;
}

/** Recherche une entreprise par ticker (ex: AAPL, MSFT, GOOGL). */
export async function searchEDGARByTicker(ticker: string): Promise<EDGARCompany | null> {
  try {
    const map = await fetchTickerMapping();
    const entry = map[ticker.toUpperCase().trim()];
    if (!entry) return null;

    const cik = String(entry.cik_str).padStart(10, '0');
    const submissions = await fetch(
      `https://data.sec.gov/submissions/CIK${cik}.json`,
      { headers: { 'User-Agent': USER_AGENT } },
    );
    if (!submissions.ok) {
      // Fallback: info de base depuis le mapping ticker
      return {
        cik,
        name: entry.title,
        ticker: entry.ticker,
        exchange: null,
        sector: null,
        city: null,
        state: null,
        country: 'US',
        website: null,
        email: null,
        source: 'sec-edgar',
        confidence: 0.7,
      };
    }

    const sub: EDGARSubmissions = await submissions.json();
    return {
      cik,
      name: sub.name ?? entry.title,
      ticker: sub.tickers?.[0] ?? entry.ticker,
      exchange: sub.exchanges?.[0] ?? null,
      sector: sicToSector(sub.sic) ?? sub.sicDescription ?? null,
      city: sub.addresses?.business?.city ?? sub.addresses?.mailing?.city ?? null,
      state: sub.addresses?.business?.stateOrCountry ?? sub.addresses?.mailing?.stateOrCountry ?? null,
      country: 'US',
      website: null,
      email: null,
      source: 'sec-edgar',
      confidence: 0.85,
    };
  } catch (e) {
    console.warn('[sec-edgar] ticker search failed:', e);
    return null;
  }
}

/**
 * Recherche d'entreprises par nom dans SEC EDGAR.
 * Utilise l'endpoint /cgi-bin/browse-edgar pour chercher par nom de société.
 */
export async function searchEDGARByName(
  companyName: string,
  limit = 10,
): Promise<EDGARCompany[]> {
  try {
    const map = await fetchTickerMapping();
    const nameLower = companyName.toLowerCase().trim();
    const results: EDGARCompany[] = [];

    // Cherche dans le mapping local (toutes les entreprises enregistrées SEC)
    for (const [ticker, entry] of Object.entries(map)) {
      if (entry.title.toLowerCase().includes(nameLower)) {
        results.push({
          cik: String(entry.cik_str).padStart(10, '0'),
          name: entry.title,
          ticker: entry.ticker,
          exchange: null,
          sector: null,
          city: null,
          state: null,
          country: 'US',
          website: null,
          email: null,
          source: 'sec-edgar',
          confidence: 0.6,
        });
      }
      if (results.length >= limit + 5) break;
    }

    // Enrichir les premiers résultats avec les détails submissions
    for (let i = 0; i < Math.min(results.length, limit); i++) {
      const r = results[i];
      try {
        const subRes = await fetch(
          `https://data.sec.gov/submissions/CIK${r.cik}.json`,
          { headers: { 'User-Agent': USER_AGENT } },
        );
        if (subRes.ok) {
          const sub: EDGARSubmissions = await subRes.json();
          r.sector = sicToSector(sub.sic) ?? sub.sicDescription ?? null;
          r.city = sub.addresses?.business?.city ?? sub.addresses?.mailing?.city ?? null;
          r.state = sub.addresses?.business?.stateOrCountry ?? sub.addresses?.mailing?.stateOrCountry ?? null;
          r.exchange = sub.exchanges?.[0] ?? null;
          r.confidence = 0.85;
        }
      } catch {
        // garde les infos de base
      }
    }

    return results.slice(0, limit);
  } catch (e) {
    console.warn('[sec-edgar] name search failed:', e);
    return [];
  }
}

/** Recherche par mot-clé sectoriel (ex: "software", "bank", "pharma"). */
export async function searchEDGARBySector(
  sectorKeyword: string,
  limit = 10,
): Promise<EDGARCompany[]> {
  try {
    const map = await fetchTickerMapping();
    const kw = sectorKeyword.toLowerCase().trim();
    const seen = new Set<string>();
    const results: EDGARCompany[] = [];

    // On doit d'abord obtenir les submissions pour chaque entreprise
    // pour vérifier le SIC. Limitons à parcourir les tickers et chercher
    // dans le titre d'abord (contient souvent le secteur).
    for (const [ticker, entry] of Object.entries(map)) {
      const titleAndSic = entry.title.toLowerCase();
      if (titleAndSic.includes(kw)) {
        if (seen.has(ticker)) continue;
        seen.add(ticker);
        results.push({
          cik: String(entry.cik_str).padStart(10, '0'),
          name: entry.title,
          ticker: entry.ticker,
          exchange: null,
          sector: null,
          city: null,
          state: null,
          country: 'US',
          website: null,
          email: null,
          source: 'sec-edgar',
          confidence: 0.5,
        });
      }
      if (results.length >= limit * 3) break;
    }

    // Enrichir les meilleurs résultats
    const enriched: EDGARCompany[] = [];
    for (let i = 0; i < Math.min(results.length, limit + 5); i++) {
      const r = results[i];
      try {
        const subRes = await fetch(
          `https://data.sec.gov/submissions/CIK${r.cik}.json`,
          { headers: { 'User-Agent': USER_AGENT } },
        );
        if (subRes.ok) {
          const sub: EDGARSubmissions = await subRes.json();
          r.sector = sicToSector(sub.sic) ?? sub.sicDescription ?? null;
          r.city = sub.addresses?.business?.city ?? sub.addresses?.mailing?.city ?? null;
          r.confidence = 0.8;
        }
      } catch { /* noop */ }
      enriched.push(r);
      if (enriched.length >= limit) break;
    }

    return enriched;
  } catch (e) {
    console.warn('[sec-edgar] sector search failed:', e);
    return [];
  }
}