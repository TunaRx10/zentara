/**
 * sec-edgar.ts — Client SEC EDGAR direct navigateur (v3).
 *
 * Pipeline : EDGAR Full-Text Search (efts.sec.gov, CORS ✓) → CIK list
 * → submissions SEC (data.sec.gov) pour noms + secteurs → résultats enrichis.
 *
 * Rate limit SEC : 10 req/s. On limite la concurrence à 3 parallèles.
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

interface EDGARSubmissions { name: string; sic: string; sicDescription: string; tickers: string[]; exchanges: string[]; addresses?: { mailing?: { city?: string; stateOrCountry?: string }; business?: { city?: string; stateOrCountry?: string } }; }

const UA = 'Zentara/1.0 (tunation.fr@gmail.com)';

const SIC_MAP: Record<string, string> = {
  '73':'Technology','737':'Technology/Software','7370':'SaaS','7372':'Enterprise Software','7373':'Cloud/SaaS',
  '60':'Finance','602':'Banking','61':'Finance','62':'Trading','63':'Insurance','64':'Insurance',
  '28':'Pharma','283':'Pharma/Biotech','2834':'Pharma','2836':'Biotech',
  '35':'Industrial','36':'Electronics','367':'Semiconductors','38':'Medical','384':'Medical Devices',
  '48':'Telecom','481':'Telecom','80':'Healthcare','801':'Healthcare','82':'Education','87':'Consulting','874':'Consulting',
};

function sicLabel(sic: string | null): string | null {
  if (!sic) return null;
  const keys = Object.keys(SIC_MAP).sort((a, b) => b.length - a.length);
  for (const k of keys) { if (sic.startsWith(k)) return SIC_MAP[k]; }
  return null;
}

function cikPad(raw: string | number): string { return String(Number(raw)).padStart(10, '0'); }

// =====================================================================
// Core: fetch 1 CIK submission (retry × 2, timeout 8s)
// =====================================================================

async function fetchSubmission(cik: string): Promise<EDGARSubmissions | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(attempt === 0 ? 8000 : 5000),
      });
      if (res.status === 404) return null;
      if (!res.ok) continue;
      return await res.json();
    } catch { /* retry */ }
  }
  return null;
}

// =====================================================================
// Enrichissement parallèle (max 3 concurrents, timeout global 12s)
// =====================================================================

interface EnrichedCIK { cik: string; name: string; ticker: string | null; sector: string | null; city: string | null; state: string | null; confidence: number; }

async function enrichBatch(ciks: string[], maxConcurrent = 3): Promise<EnrichedCIK[]> {
  const results: EnrichedCIK[] = [];
  let idx = 0;

  const worker = async (): Promise<void> => {
    while (idx < ciks.length) {
      const i = idx++;
      const cik = ciks[i];
      const sub = await fetchSubmission(cik);
      if (sub) {
        results.push({
          cik,
          name: sub.name || `CIK ${cik}`,
          ticker: sub.tickers?.[0] || null,
          sector: sicLabel(sub.sic) || sub.sicDescription || null,
          city: sub.addresses?.business?.city || sub.addresses?.mailing?.city || null,
          state: sub.addresses?.business?.stateOrCountry || sub.addresses?.mailing?.stateOrCountry || null,
          confidence: 0.85,
        });
      } else {
        results.push({ cik, name: `CIK ${cik}`, ticker: null, sector: null, city: null, state: null, confidence: 0.3 });
      }
    }
  };

  // Lance les workers avec un timeout global
  await Promise.race([
    Promise.all(Array.from({ length: maxConcurrent }, () => worker())),
    new Promise<void>((resolve) => setTimeout(resolve, 12_000)),
  ]);

  return results;
}

// =====================================================================
// API publique
// =====================================================================

/**
 * Recherche rapide via EDGAR Full-Text Search → enrichissement parallèle.
 * Résultats typiques en 2-5s (selon le nombre de CIKs trouvés).
 */
export async function searchEDGAR(query: string, limit = 10): Promise<EDGARCompany[]> {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  try {
    // 1. EDGAR FTS → CIKs
    const url = new URL('https://efts.sec.gov/LATEST/search-index');
    url.searchParams.set('q', q);
    url.searchParams.set('pageSize', String(Math.min(limit * 5, 50)));
    url.searchParams.set('startDate', '2024-01-01');
    url.searchParams.set('forms', '10-K,10-Q,8-K,S-1');

    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`SEC HTTP ${res.status}`);
    const data = await res.json();
    const rawHits: Array<{ _source?: { ciks?: (string | number)[] } }> = data?.hits?.hits || [];

    // Extraire CIKs uniques
    const deduped = new Map<string, string>(); // cik padded → raw
    for (const h of rawHits) {
      for (const rawCik of h._source?.ciks || []) {
        const padded = cikPad(rawCik);
        if (!deduped.has(padded)) deduped.set(padded, String(rawCik));
        if (deduped.size >= limit + 5) break;
      }
      if (deduped.size >= limit + 5) break;
    }

    if (deduped.size === 0) return [];

    // 2. Enrichir en parallèle
    const enriched = await enrichBatch([...deduped.keys()], 4);

    // 3. Assembler
    return enriched.slice(0, limit).map((e) => ({
      cik: e.cik,
      name: e.name,
      ticker: e.ticker,
      exchange: null,
      sector: e.sector,
      city: e.city,
      state: e.state,
      country: 'US',
      website: null,
      email: null,
      source: 'sec-edgar',
      confidence: e.confidence,
    }));
  } catch (e) {
    console.warn('[sec-edgar] search failed:', e);
    return [];
  }
}

/** Recherche par ticker (AAPL, MSFT…). */
export async function searchEDGARByTicker(ticker: string): Promise<EDGARCompany | null> {
  try {
    // Use the company_tickers.json mapping for ticker lookup
    const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const map: Record<string, { cik_str: number; ticker: string; title: string }> = await res.json();
    for (const v of Object.values(map)) {
      if (v.ticker?.toUpperCase() === ticker.toUpperCase().trim()) {
        const cik = cikPad(v.cik_str);
        const sub = await fetchSubmission(cik);
        return {
          cik, name: sub?.name || v.title, ticker: v.ticker, exchange: null,
          sector: sub ? (sicLabel(sub.sic) || sub.sicDescription || null) : null,
          city: sub?.addresses?.business?.city || sub?.addresses?.mailing?.city || null,
          state: sub?.addresses?.business?.stateOrCountry || sub?.addresses?.mailing?.stateOrCountry || null,
          country: 'US', website: null, email: null, source: 'sec-edgar', confidence: 0.9,
        };
      }
    }
    return null;
  } catch { return null; }
}