// Vercel serverless function — proxy SEC EDGAR avec le User-Agent requis par SEC
// (le navigateur ne peut pas définir cet en-tête et SEC n'envoie pas de CORS).
// Le frontend appelle /api/sec/<chemin>?query en même origine.
export default async function handler(req, res) {
  try {
    const reqUrl = new URL(req.url, 'http://localhost');
    // /api/sec/LATEST/search-index → https://efts.sec.gov/LATEST/search-index
    // /api/sec/submissions/CIK0000320193.json → https://data.sec.gov/submissions/...
    // /api/sec/files/company_tickers.json → https://www.sec.gov/files/...
    const rest = reqUrl.pathname.replace(/^\/api\/sec\/?/, '');
    let host = 'https://efts.sec.gov';
    if (rest.startsWith('submissions/')) host = 'https://data.sec.gov';
    if (rest.startsWith('files/')) host = 'https://www.sec.gov';
    const target = new URL(`${host}/${rest}`);
    for (const [k, v] of reqUrl.searchParams) target.searchParams.set(k, v);

    const r = await fetch(target.toString(), {
      headers: {
        'User-Agent': 'Zentara/1.0 (contact@zentara.app)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    const text = await r.text();
    res
      .status(r.status)
      .setHeader('Content-Type', r.headers.get('content-type') || 'application/json')
      .setHeader('Cache-Control', 'public, max-age=300')
      .send(text);
  } catch (e) {
    res.status(502).json({ error: String(e && e.message ? e.message : e) });
  }
}
