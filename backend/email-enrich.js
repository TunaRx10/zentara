// email-enrich.js — Enrichissement email automatique des prospects
// Génère les permutations prénom.nom@domaine (module keelead) puis vérifie :
//   syntaxe, domaine avec MX, jetable, rôle — sans SMTP (port 25 souvent bloqué en cloud).
'use strict';

const dns = require('node:dns/promises');
const { generatePermutations } = require('./kee/email/permutator');

const MX_TTL_MS = 5 * 60 * 1000;
const mxCache = new Map();

const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', 'sharklasers.com', 'temp-mail.org', 'throwawaymail.com',
  'yopmail.com', '10minutemail.com', 'trashmail.com', 'maildrop.cc', 'getnada.com',
  'tempmail.com', 'dispostable.com', 'mailnesia.com', 'fakeinbox.com', 'mytemp.email',
  'spam4.me', 'mintemail.com', 'mailcatch.com', 'tempinbox.com', 'burnermail.io',
]);

function withTimeout(p, ms, fallback) {
  return Promise.race([p, new Promise((res) => setTimeout(() => res(fallback), ms))]);
}

async function domainHasMx(domain) {
  const cached = mxCache.get(domain);
  if (cached && Date.now() - cached.at < MX_TTL_MS) return cached.ok;
  let ok = false;
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 4500, []);
    ok = Array.isArray(mx) && mx.length > 0;
  } catch {
    ok = false;
  }
  mxCache.set(domain, { ok, at: Date.now() });
  return ok;
}

/** Extrait le domaine propre depuis une URL ou un domaine brut. */
function extractDomain(input) {
  if (!input) return null;
  let s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (!s.includes('://')) s = 'https://' + s;
  try {
    const host = new URL(s).hostname;
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    const m = s.match(/([a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?$/);
    return m ? m[0].replace(/:\d+$/, '') : null;
  }
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;

function isDisposable(domain) {
  return DISPOSABLE.has(domain);
}

const ROLE_RE = /^(info|contact|hello|sales|support|admin|office|team|billing|mail|webmaster|service|compta|devis|demande|bonjour|noreply|no-reply|feedback|abuse|postmaster|hr|jobs|recrutement|presse|marketing|commercial)@/i;

function syntaxOk(email) {
  return EMAIL_RE.test(email);
}

/** Génère + filtre les candidats pour une personne + domaine. */
function candidatesFor(firstName, lastName, domain) {
  if (!firstName || !domain) return [];
  const perms = generatePermutations(firstName, lastName, domain);
  return (perms || [])
    .filter((c) => c && c.email && syntaxOk(c.email))
    .sort((a, b) => b.score - a.score);
}

/**
 * Enrichit un prospect : trouve le meilleur email probable + vérifie.
 * @param {{firstName?:string, lastName?:string, website?:string, companyWebsite?:string}} p
 * @returns {Promise<{email:string|null, pattern?:string, score:number, has_mx:boolean, verified:boolean, candidates:number, reason:string}>}
 */
async function enrichEmail(p) {
  const firstName = String(p.firstName || p.first_name || '').trim();
  const lastName = String(p.lastName || p.last_name || '').trim();
  const domain = extractDomain(p.website || p.companyWebsite || null);
  if (!firstName) return { email: null, score: 0, has_mx: false, verified: false, candidates: 0, reason: 'prénom manquant' };
  if (!domain) return { email: null, score: 0, has_mx: false, verified: false, candidates: 0, reason: 'domaine manquant' };
  if (isDisposable(domain)) return { email: null, score: 0, has_mx: false, verified: false, candidates: 0, reason: 'domaine jetable' };

  const cands = candidatesFor(firstName, lastName, domain);
  if (cands.length === 0) return { email: null, score: 0, has_mx: false, verified: false, candidates: 0, reason: 'aucune permutation' };

  const hasMx = await domainHasMx(domain);
  // Si le domaine n'a pas de MX → quasi sûr d'être invalide, on refuse les emails corporate.
  if (!hasMx) {
    return { email: null, score: 0, has_mx: false, verified: false, candidates: cands.length, reason: 'domaine sans MX' };
  }

  // Score seuil : on ne retient que les patterns probables (≥ 0.6), sinon le meilleur.
  const good = cands.filter((c) => c.score >= 0.6);
  const top = (good.length ? good : cands)[0];
  const roleBased = ROLE_RE.test(top.email);

  return {
    email: top.email,
    pattern: top.pattern || null,
    score: Math.round(top.score * 100),
    has_mx: true,
    verified: true,
    candidates: cands.length,
    role_based: roleBased,
    reason: roleBased ? 'trouvé mais rôle générique (info@…) — risque de bounce' : 'email probable vérifié (MX + syntaxe)',
  };
}

/** Enrichit plusieurs prospects (batch) avec limite et budget temps. */
async function enrichBatch(prospects, { limit = 20, timeoutMs = 25000 } = {}) {
  const started = Date.now();
  const out = [];
  for (const p of (prospects || []).slice(0, limit)) {
    if (Date.now() - started > timeoutMs) break;
    try {
      const r = await withTimeout(enrichEmail(p), 6000, {
        email: null, score: 0, has_mx: false, verified: false, candidates: 0, reason: 'timeout',
      });
      out.push({ ...p, enrichment: r });
    } catch (e) {
      out.push({ ...p, enrichment: { email: null, score: 0, has_mx: false, verified: false, candidates: 0, reason: String(e.message) } });
    }
  }
  return out;
}

module.exports = { enrichEmail, enrichBatch, extractDomain, domainHasMx };