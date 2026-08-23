// scrapers.js — Scrapers gratuits additionnels de Zentara One.
//   - Yelp (natif, best-effort HTML)
//   - Photon (OSINT crawler Python vendored, bridge subprocess)
//   - SMTP email verifier (natif Node)
//   - Google Maps (délègue à gmaps.js natif OSM + best-effort Google)
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SMTP = require('./smtp-verify');
const GMAPS = require('./gmaps');
const SCRAPE = require('./scrape');

const VENDOR_PHOTON = path.join(__dirname, 'scrapers', 'vendor', 'photon', 'photon.py');
const PYTHON = process.env.PYTHON || 'python3';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// Yelp — scrape best-effort de la page de recherche (sans clé Fusion).
// ---------------------------------------------------------------------------

function cleanHtml(s) {
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}

async function yelp(query, location = '', limit = 20) {
  const n = Math.max(1, Math.min(Number(limit) || 20, 50));
  const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(query)}&find_loc=${encodeURIComponent(location || query)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { ok: false, source: 'yelp', leads: [], reason: `HTTP ${res.status}` };
    const html = await res.text();
    // Blocage Cloudflare / consent
    if (/cf-challenge|Just a moment|Enable JavaScript/i.test(html)) {
      return { ok: true, source: 'yelp', leads: [], reason: 'bloqué (Cloudflare) — yelp.com exige JS' };
    }
    // Pattern : résultat de business avec nom + note. Structure Yelp :
    //   <a href="/biz/xxx" ...><span>Nom</span></a>  +  <span aria-label="4.5 star rating">
    const leads = [];
    const seen = new Set();
    const bizRe = /href="(\/biz\/[^"?#]+)"[^>]*>[\s\S]*?<span[^>]*>([^<]{2,120})<\/span>/g;
    let m;
    while ((m = bizRe.exec(html)) !== null && leads.length < n) {
      const name = cleanHtml(m[2]);
      if (!name || name.length < 3) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      leads.push({
        name,
        category: query,
        website: `https://www.yelp.com${m[1]}`,
        source: 'yelp',
        confidence: 0.6,
        tags: ['local', 'yelp'],
      });
    }
    return { ok: true, source: 'yelp', leads, reason: leads.length ? `${leads.length} commerces Yelp` : 'aucun résultat parsable' };
  } catch (e) {
    return { ok: false, source: 'yelp', leads: [], reason: String(e.message || e) };
  }
}

// ---------------------------------------------------------------------------
// Photon — OSINT crawler Python (emails + URLs + social depuis un domaine).
// ---------------------------------------------------------------------------

async function photon(target, { timeoutMs = 90000 } = {}) {
  const t = String(target || '').trim();
  if (!t) return { ok: false, available: false, error: 'domaine requis', emails: [], urls: [] };
  if (!fs.existsSync(VENDOR_PHOTON)) {
    return { ok: false, available: false, error: 'photon.py introuvable', emails: [], urls: [] };
  }
  const outDir = path.join(fs.realpathSync(os.tmpdir()), `zentara-photon-${Date.now()}`);
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [VENDOR_PHOTON, '-u', t, '-l', '1', '-o', outDir, '--stdout', 'intel'], {
      cwd: path.dirname(VENDOR_PHOTON),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; try { child.kill('SIGKILL'); } catch {} fs.rmSync(outDir, { recursive: true, force: true }); resolve(r); } };
    const timer = setTimeout(() => finish({ ok: false, available: true, error: `timeout ${timeoutMs}ms`, emails: [], urls: [] }), timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => { clearTimeout(timer); finish({ ok: false, available: false, error: `python3 introuvable: ${e.message}`, emails: [], urls: [] }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      // Agrège stdout (dataset intel : emails + réseaux sociaux) + fichiers écrits par Photon.
      let fileText = '';
      try {
        for (const f of ['intel.txt', 'external.txt', 'endpoints.txt']) {
          const p = path.join(outDir, f);
          if (fs.existsSync(p)) fileText += '\n' + fs.readFileSync(p, 'utf8');
        }
      } catch {}
      const text = out + '\n' + err + '\n' + fileText;
      const emails = [...new Set((text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []))].slice(0, 50);
      const urls = [...new Set((text.match(/https?:\/\/[^\s"'<>]+/g) || []))].slice(0, 100);
      if (code !== 0) {
        const deps = /No module named '(\w+)'/.exec(err);
        finish({ ok: false, available: true, error: deps ? `dépendance Python manquante: ${deps[1]} (pip install requests urllib3 tld)` : (err.trim().slice(0, 200) || `photon exit ${code}`), emails, urls });
        return;
      }
      finish({ ok: true, available: true, emails, urls, target: t });
    });
  });
}

// ---------------------------------------------------------------------------
// Google Maps — délègue au moteur natif OSM (gratuit) + best-effort Google.
// ---------------------------------------------------------------------------

async function googleMaps(query, location = '', limit = 20) {
  return GMAPS.searchLocal({ query, location, limit: Math.max(1, Math.min(Number(limit) || 20, 60)) });
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

async function status() {
  return {
    scrapers: {
      yelp: { available: true, note: 'best-effort (bloqué si Cloudflare JS)' },
      photon: { available: fs.existsSync(VENDOR_PHOTON), note: 'Python + requests/urllib3/tld requis' },
      smtp_verify: { available: true, note: 'port 25 requis (parfois bloqué côté cloud)' },
      google_maps: { available: true, note: 'OSM/Overpass natif + best-effort Google' },
      website_emails: { available: true, note: 'scrape.js natif (emails/tél)' },
    },
  };
}

module.exports = { yelp, photon, googleMaps, verifyEmail: SMTP.verifyEmail, status, SCRAPE };
