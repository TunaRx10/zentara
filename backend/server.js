/**
 * server.js — Zentara backend (minimal rebuild).
 *
 * Stack : Express + node:sqlite (built-in) + zod (validation).
 * Envelope : { success: true, data } / { success: false, error: { code, message } }.
 *
 * Sert aussi le frontend `../frontend/dist` en SPA (monolith), pour que
 * le client (base `/api` relatif) et le tunnel pointent sur la même origine.
 */
'use strict';

const express = require('express');
const cors = require('cors');
const { z } = require('zod');
const path = require('node:path');
const fs = require('node:fs');

// Load backend/.env (keys AI). Ignore if absent (keys may come from the shell).
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
} catch (_e) {
  /* .env absent or malformed → keep process.env */
}

// Snapshot des variables d'env "de base" (issues du .env/shell) pour pouvoir
// restaurer proprement process.env quand on efface une clé des réglages.
const ORIGINAL_ENV = Object.assign({}, process.env);

const { db, sha256, generateId, nowIso, hashPin } = require('./db');
const ai = require('./ai');
const { buildProspectPrompt, parseAnalysisResponse } = require('./prospect-prompt');
const PROMPT = require('./prospect-prompt');
const SITE_PROFILE = require('./site-profile');
const scrape = require('./scrape');
const MULTI = require('./multi-source');
const ENGINES = require('./maps-engines');
const ENRICH = require('./email-enrich');
const LINKEDIN = require('./linkedin');
const ENGINE = require('./engine');
const SCRAPERS = require('./scrapers');
// AXE 1 — framework de scoring déterministe (50 critères).
const SCORING_ENGINE = require('./scoring-engine');
const SCORING_INPUTS = require('./scoring-inputs');
const SCORING_STORE = require('./scoring-store');
const SCORING_ADAPTER = require('./scoring-adapter');
// AXE 1bis — moteur d'intelligence déterministe (consensus, signaux, opportunités, forecast, action plan, qualité).
const INTEL_ENGINE = require('./intelligence-engine');
// AXE 2 — file de jobs async pour analyses longues.
const { JobManager } = require('./analysis-jobs');
// AXE 3 — système de templates email premium.
const EMAIL_TEMPLATES = require('./email-templates');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const PORT = Number(process.env.PORT || 4000);
const FRONTEND_DIST = path.join(__dirname, '..', 'frontend', 'dist');
const startedAt = Date.now();

// =====================================================================
// Helpers
// =====================================================================

const ok = (res, data) => res.json({ success: true, data });
const fail = (res, status, code, message, details) =>
  res.status(status).json({ success: false, error: { code, message, ...(details !== undefined ? { details } : {}) } });

function parseJsonField(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Normalise une ligne SQLite → JSON (parse tags/social_profiles/quality). */
function normalizeRow(row, jsonFields = ['tags', 'social_profiles', 'quality', 'metadata', 'profile', 'product_estimate', 'engine']) {
  const out = { ...row };
  for (const f of jsonFields) {
    if (f in out) out[f] = parseJsonField(out[f]);
  }
  return out;
}

function all(table, orderBy = 'created_at DESC') {
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
  return rows.map((r) => normalizeRow(r));
}

function getById(table, id) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  return row ? normalizeRow(row) : null;
}

function count(table) {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c ?? 0);
}

const JSON_COLUMNS = new Set(['tags', 'social_profiles', 'quality', 'metadata', 'payload', 'embedding']);

function coerceForInsert(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/** Génère les routes CRUD pour une table. */
function mountCrud(router, base, table, columns) {
  const colSet = new Set(columns);

  // GET list
  router.get(base, (_req, res) => {
    try {
      ok(res, all(table));
    } catch (e) {
      fail(res, 500, 'DB_ERROR', String(e.message));
    }
  });

  // GET by id
  router.get(`${base}/:id`, (req, res) => {
    try {
      const row = getById(table, req.params.id);
      if (!row) return fail(res, 404, 'NOT_FOUND', `${table} not found`);
      ok(res, row);
    } catch (e) {
      fail(res, 500, 'DB_ERROR', String(e.message));
    }
  });

  // POST create
  router.post(base, (req, res) => {
    try {
      const body = req.body || {};
      const keys = columns.filter((c) => c in body && body[c] !== undefined);
      if (table === 'prospects' && !body.first_name) return fail(res, 422, 'VALIDATION', 'first_name required');
      if (table === 'contacts' && !body.first_name) return fail(res, 422, 'VALIDATION', 'first_name required');
      if (table === 'companies' && !body.name) return fail(res, 422, 'VALIDATION', 'name required');
      if (table === 'campaigns' && !body.name) return fail(res, 422, 'VALIDATION', 'name required');

      const id = generateId(table === 'prospects' ? 'pros' : table === 'companies' ? 'com' : table === 'contacts' ? 'con' : table === 'campaigns' ? 'cam' : 'id');
      const now = nowIso();
      const allKeys = ['id', ...keys, 'created_at', 'updated_at'];
      const placeholders = allKeys.map(() => '?').join(', ');
      const values = [id, ...keys.map((k) => coerceForInsert(body[k])), now, now];
      db.prepare(`INSERT INTO ${table} (${allKeys.join(', ')}) VALUES (${placeholders})`).run(...values);

      ok(res, getById(table, id));
    } catch (e) {
      fail(res, 500, 'DB_ERROR', String(e.message));
    }
  });

  // PATCH / PUT update
  const update = (req, res) => {
    try {
      const existing = getById(table, req.params.id);
      if (!existing) return fail(res, 404, 'NOT_FOUND', `${table} not found`);
      const body = req.body || {};
      const keys = columns.filter((c) => c in body && body[c] !== undefined && c !== 'id');
      if (keys.length === 0) return ok(res, existing);

      const setClause = keys.map((k) => `${k} = ?`).join(', ');
      const values = keys.map((k) => coerceForInsert(body[k]));
      db.prepare(`UPDATE ${table} SET ${setClause}, updated_at = ? WHERE id = ?`).run(...values, nowIso(), req.params.id);

      ok(res, getById(table, req.params.id));
    } catch (e) {
      fail(res, 500, 'DB_ERROR', String(e.message));
    }
  };
  router.patch(`${base}/:id`, update);
  router.put(`${base}/:id`, update);

  // DELETE
  router.delete(`${base}/:id`, (req, res) => {
    try {
      const existing = getById(table, req.params.id);
      if (!existing) return fail(res, 404, 'NOT_FOUND', `${table} not found`);
      db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
      ok(res, { id: req.params.id });
    } catch (e) {
      fail(res, 500, 'DB_ERROR', String(e.message));
    }
  });
}

// =====================================================================
// Health
// =====================================================================

const healthPayload = () => ({
  status: 'ok',
  ts: nowIso(),
  uptime_s: Math.round((Date.now() - startedAt) / 1000),
  zone: process.env.TZ || 'UTC',
});
app.get('/health', (_req, res) => ok(res, healthPayload()));

// =====================================================================
// API router (mounted at /api)
// =====================================================================

const api = express.Router();

api.get('/health', (_req, res) => ok(res, healthPayload()));

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

function currentUser() {
  return db.prepare("SELECT * FROM users WHERE status = 'active' ORDER BY created_at ASC LIMIT 1").get();
}

function createSession(user, authMethod = 'pin') {
  const token = sha256(`${user.id}:${nowIso()}:${Math.random()}`);
  const sessionId = generateId('ses');
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO auth_sessions (id, user_id, token_hash, auth_method, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, user.id, sha256(token), authMethod, expiresAt, nowIso());
  return {
    session_id: sessionId,
    token,
    expires_at: expiresAt,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      biometric_enabled: Boolean(user.biometric_enabled),
    },
  };
}

api.get('/auth/status', (_req, res) => {
  const user = currentUser();
  ok(res, {
    hasUser: Boolean(user),
    email: user ? user.email : null,
    name: user ? user.name : null,
    setupAllowed: !user,
  });
});

const setupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  pin: z.string().min(1).optional(),
});

api.post('/auth/setup', (req, res) => {
  const parsed = setupSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 422, 'VALIDATION', parsed.error.issues[0]?.message || 'invalid body');
  if (currentUser()) return fail(res, 409, 'CONFLICT', 'User already exists');

  const { email, name, pin } = parsed.data;
  const id = generateId('usr');
  db.prepare(
    `INSERT INTO users (id, email, name, role, status, pin_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'admin', 'active', ?, ?, ?)`,
  ).run(id, email, name, pin ? hashPin(pin) : null, nowIso(), nowIso());

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  ok(res, createSession(user, pin ? 'pin' : 'auto'));
});

api.post('/auth/login', (req, res) => {
  const body = req.body || {};
  const user = currentUser();
  if (!user) return fail(res, 404, 'NOT_FOUND', 'No user configured');
  if (!user.pin_hash) return ok(res, createSession(user, 'auto')); // PIN-less mode
  if (!body.pin || hashPin(String(body.pin)) !== user.pin_hash) {
    return fail(res, 401, 'INVALID_PIN', 'Wrong PIN');
  }
  ok(res, createSession(user, 'pin'));
});

api.post('/auth/auto-login', (_req, res) => {
  let user = currentUser();
  if (!user) {
    const id = generateId('usr');
    db.prepare(
      `INSERT INTO users (id, email, name, role, status, created_at, updated_at)
       VALUES (?, 'tunation.fr@gmail.com', 'Tuna', 'admin', 'active', ?, ?)`,
    ).run(id, nowIso(), nowIso());
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }
  ok(res, createSession(user, 'auto'));
});

api.post('/auth/refresh', (req, res) => {
  const user = currentUser();
  if (!user) return fail(res, 404, 'NOT_FOUND', 'No user configured');
  ok(res, createSession(user, 'refresh'));
});

api.post('/auth/logout', (_req, res) => ok(res, { revoked: true }));

api.get('/auth/me', (_req, res) => {
  const user = currentUser();
  if (!user) return fail(res, 404, 'NOT_FOUND', 'No user configured');
  ok(res, {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    biometric_enabled: Boolean(user.biometric_enabled),
    lockout: { locked: false, until: null, failed_attempts: Number(user.failed_attempts || 0) },
  });
});

api.delete('/auth/me', (_req, res) => {
  const user = currentUser();
  if (!user) return fail(res, 404, 'NOT_FOUND', 'No user configured');
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(user.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
  ok(res, { deleted: true, sessions_revoked: 0 });
});

// ---------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------

mountCrud(api, '/prospects', 'prospects', [
  'company_id', 'first_name', 'last_name', 'email', 'phone', 'role', 'sector',
  'address', 'city', 'country', 'website', 'social_profiles', 'google_maps_url',
  'score', 'status', 'tags', 'quality', 'notes',
]);

mountCrud(api, '/companies', 'companies', [
  'name', 'website', 'sector', 'industry', 'address', 'city', 'country', 'phone',
  'email', 'social_profiles', 'google_maps_url', 'score', 'status', 'notes', 'tags',
]);

mountCrud(api, '/contacts', 'contacts', [
  'company_id', 'first_name', 'last_name', 'role', 'email', 'phone', 'social_profiles',
  'status', 'notes', 'tags', 'linkedin_url',
]);

mountCrud(api, '/campaigns', 'campaigns', ['name', 'description', 'status', 'target', 'created_by']);

// Campaign <-> prospects
api.get('/campaigns/:id/prospects', (req, res) => {
  const rows = db.prepare(
    `SELECT p.* FROM prospects p
     JOIN campaign_prospects cp ON cp.prospect_id = p.id
     WHERE cp.campaign_id = ? ORDER BY cp.added_at DESC`,
  ).all(req.params.id);
  ok(res, rows.map((r) => normalizeRow(r)));
});
api.post('/campaigns/:id/prospects', (req, res) => {
  const campaign = getById('campaigns', req.params.id);
  if (!campaign) return fail(res, 404, 'NOT_FOUND', 'campaign not found');
  const pid = req.body?.prospect_id || req.body?.prospectId;
  if (!pid) return fail(res, 422, 'VALIDATION', 'prospect_id required');
  db.prepare(
    `INSERT OR IGNORE INTO campaign_prospects (id, campaign_id, prospect_id, status, added_at)
     VALUES (?, ?, ?, 'added', ?)`,
  ).run(generateId('cp'), req.params.id, pid, nowIso());
  ok(res, { campaign_id: req.params.id, prospect_id: pid });
});
api.delete('/campaigns/:id/prospects/:pid', (req, res) => {
  db.prepare('DELETE FROM campaign_prospects WHERE campaign_id = ? AND prospect_id = ?').run(req.params.id, req.params.pid);
  ok(res, { removed: true });
});

// ---------------------------------------------------------------------
// Company-specific
// ---------------------------------------------------------------------

api.get('/companies/:id/prospects', (req, res) => {
  const rows = db.prepare('SELECT * FROM prospects WHERE company_id = ? ORDER BY created_at DESC').all(req.params.id);
  ok(res, rows.map((r) => normalizeRow(r)));
});

api.get('/companies/:id/aggregate-score', (req, res) => {
  const company = getById('companies', req.params.id);
  if (!company) return fail(res, 404, 'NOT_FOUND', 'company not found');

  const prospects = db.prepare("SELECT score FROM prospects WHERE company_id = ?").all(req.params.id);
  const prospectsAvg = prospects.length > 0 ? prospects.reduce((acc, p) => acc + (p.score || 0), 0) / prospects.length : 0;
  
  const intel = db.prepare('SELECT score FROM intelligence WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1').get('company', req.params.id);
  const criticalSignals = Number(db.prepare("SELECT COUNT(*) AS c FROM monitoring WHERE entity_type = ? AND entity_id = ? AND confidence >= 90").get('company', req.params.id).c);
  const warningSignals = Number(db.prepare("SELECT COUNT(*) AS c FROM monitoring WHERE entity_type = ? AND entity_id = ? AND confidence >= 80 AND confidence < 90").get('company', req.params.id).c);

  ok(res, {
    company_id: req.params.id,
    score: Number(company.score || 0),
    breakdown: {
      company_score: Number(company.score || 0),
      prospects_avg: Math.round(prospectsAvg),
      prospects_count: prospects.length,
      intelligence_score: intel ? Number(intel.score || 0) : null,
      critical_signals: criticalSignals,
      warning_signals: warningSignals,
      replied_emails: 0,
      active_outreach_sequences: 0,
    },
    tier: Number(company.score || 0) >= 70 ? 'HOT' : Number(company.score || 0) >= 40 ? 'WARM' : 'COLD',
  });
});

// ---------------------------------------------------------------------
// Scrape contacts depuis le site d'une company (email + téléphone réels)
// ---------------------------------------------------------------------

const GENERIC_PREFIXES = ['info', 'contact', 'hello', 'bonjour', 'sales', 'support', 'team', 'admin', 'office', 'presse', 'press', 'media', 'jobs', 'hr', 'recrutement', 'accueil', 'service'];

function deriveNameFromEmail(email, companyName) {
  const local = String(email || '').split('@')[0].toLowerCase();
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return { first_name: companyName || 'Contact', last_name: '' };
  const head = parts[0];
  if (GENERIC_PREFIXES.includes(head)) return { first_name: companyName || 'Contact', last_name: '' };
  const first = head.charAt(0).toUpperCase() + head.slice(1);
  const last = parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  return { first_name: first, last_name: last };
}

function roleFromEmail(email) {
  const local = String(email || '').split('@')[0].toLowerCase();
  const head = local.split(/[._-]+/)[0] || '';
  const map = {
    info: 'Contact général', contact: 'Contact général', hello: 'Contact général', bonjour: 'Contact général',
    sales: 'Sales', support: 'Support', presse: 'Presse', press: 'Presse', media: 'Presse',
    jobs: 'RH', hr: 'RH', admin: 'Administration', office: 'Administration', ceo: 'Direction', founder: 'Direction',
  };
  return map[head] || null;
}

api.post('/companies/:id/scrape-contacts', async (req, res) => {
  const company = getById('companies', req.params.id);
  if (!company) return fail(res, 404, 'NOT_FOUND', 'company not found');
  const website = company.website;
  if (!website) return ok(res, { url: null, scraped_urls: [], phone: null, email: null, contacts: [], created_prospect_ids: [], created_count: 0, skipped_duplicates: [], persisted_company_fields: [], note: 'Aucun site web renseigné sur cette company.' });

  const persist = req.body?.persist !== false;
  const createProspects = req.body?.create_prospects !== false;
  const s = await scrape.scrapeSite(website);

  const emails = s.emails || [];
  const phones = s.phones || [];
  const contacts = [];
  const skipped_duplicates = [];
  const created_prospect_ids = [];
  const persisted_company_fields = [];

  // 1 contact par email (le téléphone est attaché au premier contact)
  emails.forEach((email, i) => {
    const { first_name, last_name } = deriveNameFromEmail(email, company.name);
    const role = roleFromEmail(email);
    const phone = i === 0 ? (phones[0] || null) : null;
    const personal = !GENERIC_PREFIXES.includes(String(email).split('@')[0].split(/[._-]+/)[0]);
    const email_validity = 80;
    const phone_reachability = phone ? 70 : 0;
    const decision_maker = /^(ceo|founder|cto|coo|directeur|direction)$/.test(String(email).split('@')[0].split(/[._-]+/)[0]) ? 75 : personal ? 45 : 30;
    const overall = Math.round((email_validity + phone_reachability + decision_maker) / 3);
    contacts.push({
      first_name, last_name, role, email, phone,
      source_url: s.scanned_urls[0] || website,
      confidence: overall,
      quality: { email_validity, phone_reachability, decision_maker, overall },
      extractor: 'dom',
    });
  });

  // S'il n'y a que des téléphones (pas d'email), on signale mais on ne crée pas de prospect
  if (emails.length === 0 && phones.length > 0) {
    contacts.push({
      first_name: company.name, last_name: '', role: 'Contact général', email: null,
      phone: phones[0], source_url: s.scanned_urls[0] || website,
      confidence: 40,
      quality: { email_validity: 0, phone_reachability: 70, decision_maker: 30, overall: 33 },
      extractor: 'dom',
    });
  }

  if (persist) {
    // Renseigne phone/email de la company si vides
    if (!company.phone && phones[0]) {
      db.prepare('UPDATE companies SET phone = ?, updated_at = ? WHERE id = ?').run(phones[0], nowIso(), company.id);
      persisted_company_fields.push('phone');
    }
    if (!company.email && emails[0]) {
      db.prepare('UPDATE companies SET email = ?, updated_at = ? WHERE id = ?').run(emails[0], nowIso(), company.id);
      persisted_company_fields.push('email');
    }

    if (createProspects) {
      for (const c of contacts) {
        if (!c.email) continue; // règle : pas d'email → pas de prospect
        const existing = db.prepare('SELECT id FROM prospects WHERE email = ? AND company_id = ?').get(c.email, company.id);
        if (existing) {
          skipped_duplicates.push({ email: c.email, reason: 'duplicate' });
          continue;
        }
        const pid = generateId('pros');
        const now = nowIso();
        db.prepare(
          `INSERT INTO prospects (id, company_id, first_name, last_name, email, phone, role, website, tags, quality, status, score, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, ?, ?)`,
        ).run(
          pid, company.id, c.first_name || company.name, c.last_name || '', c.email, c.phone, c.role,
          website, JSON.stringify(['scraped']), JSON.stringify(c.quality), now, now,
        );
        created_prospect_ids.push(pid);
      }
      // Crée aussi des entrées contacts
      for (const c of contacts) {
        if (!c.email) continue;
        const existing = db.prepare('SELECT id FROM contacts WHERE email = ? AND company_id = ?').get(c.email, company.id);
        if (existing) continue;
        const cid = generateId('con');
        const now = nowIso();
        db.prepare(
          `INSERT INTO contacts (id, company_id, first_name, last_name, role, email, phone, tags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(cid, company.id, c.first_name || company.name, c.last_name || '', c.role, c.email, c.phone, JSON.stringify(['scraped']), now, now);
      }
    }
  }

  ok(res, {
    url: website,
    scraped_urls: s.scanned_urls,
    phone: phones[0] || null,
    email: emails[0] || null,
    contacts,
    created_prospect_ids,
    created_count: created_prospect_ids.length,
    skipped_duplicates,
    persisted_company_fields,
    note: s.note || (contacts.length ? 'Contacts extraits du site.' : 'Aucun contact trouvé.'),
  });
});

// ---------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------

api.get('/analytics/overview', (_req, res) => {
  ok(res, {
    users: count('users'),
    companies: count('companies'),
    prospects: count('prospects'),
    contacts: count('contacts'),
    campaigns: count('campaigns'),
    intelligence: count('intelligence'),
    signals: count('monitoring'),
    ai_analyses: count('ai_analysis'),
    monitoring: count('monitoring'),
  });
});

api.get('/analytics/timeseries', (req, res) => {
  const metric = String(req.query.metric || 'hot_prospects');
  const days = Math.min(Math.max(Number(req.query.days || 12), 7), 90);

  const points = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD

    let val = 0;
    try {
      if (metric === 'hot_prospects') {
        val = Number(db.prepare("SELECT COUNT(*) AS c FROM prospects WHERE score >= 70 AND date(created_at) <= date(?)").get(dateStr).c);
      } else if (metric === 'hot_companies') {
        val = Number(db.prepare("SELECT COUNT(*) AS c FROM companies WHERE score >= 70 AND date(created_at) <= date(?)").get(dateStr).c);
      } else if (metric === 'signals') {
        val = Number(db.prepare("SELECT COUNT(*) AS c FROM monitoring WHERE date(detected_at) <= date(?)").get(dateStr).c);
      } else if (metric === 'won') {
        val = Number(db.prepare("SELECT COUNT(*) AS c FROM prospects WHERE status = 'won' AND date(updated_at) <= date(?)").get(dateStr).c);
      }
    } catch (e) {
      /* ignore db error for a single point */
    }
    points.push({ date: dateStr, value: val });
  }

  ok(res, { metric, days, points });
});

api.get('/analytics/hot-prospects', (req, res) => {
  const minScore = Number(req.query.min_score || 70);
  const limit = Number(req.query.limit || 25);
  const offset = Number(req.query.offset || 0);

  const rows = db.prepare(`
    SELECT p.*, c.name AS company_name 
    FROM prospects p
    LEFT JOIN companies c ON p.company_id = c.id
    WHERE p.score >= ? 
    ORDER BY p.score DESC, p.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(minScore, limit, offset);

  const total = Number(db.prepare("SELECT COUNT(*) AS c FROM prospects WHERE score >= ?").get(minScore).c);

  ok(res, {
    data: rows.map((r) => normalizeRow(r)),
    meta: { total, limit, offset, threshold: minScore, sector: req.query.sector || null },
  });
});

api.get('/companies/hot-companies', (req, res) => {
  const minScore = Number(req.query.min_score || 70);
  const limit = Number(req.query.limit || 25);
  const offset = Number(req.query.offset || 0);

  const rows = db.prepare(`
    SELECT * FROM companies 
    WHERE score >= ? 
    ORDER BY score DESC, updated_at DESC
    LIMIT ? OFFSET ?
  `).all(minScore, limit, offset);

  const total = Number(db.prepare("SELECT COUNT(*) AS c FROM companies WHERE score >= ?").get(minScore).c);

  ok(res, {
    data: rows.map((r) => normalizeRow(r)),
    meta: { total, limit, offset, threshold: minScore, sector: req.query.sector || null },
  });
});

// ---------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------

function entityName(entityType, entityId) {
  if (!entityType || !entityId) return null;
  try {
    if (entityType === 'company') return db.prepare('SELECT name FROM companies WHERE id = ?').get(entityId)?.name ?? null;
    if (entityType === 'prospect') {
      const p = db.prepare('SELECT first_name, last_name FROM prospects WHERE id = ?').get(entityId);
      return p ? `${p.first_name} ${p.last_name}` : null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function severityFor(confidence) {
  const c = Number(confidence || 0);
  if (c >= 90) return 'critical';
  if (c >= 80) return 'warning';
  if (c >= 70) return 'info';
  return 'ok';
}

api.get('/monitoring', (_req, res) => {
  const rows = db.prepare('SELECT * FROM monitoring ORDER BY detected_at DESC').all();
  ok(res, rows.map((r) => ({
    id: r.id,
    entity_type: r.entity_type || null,
    entity_id: r.entity_id || null,
    source: r.source || 'unknown',
    entity_name: entityName(r.entity_type, r.entity_id) || '—',
    type: r.signal_type || 'signal',
    content: r.signal || '',
    confidence: Number(r.confidence || 0),
    severity: severityFor(r.confidence),
    detected_at: r.detected_at || r.created_at || nowIso(),
  })));
});

api.delete('/monitoring/:id', (req, res) => {
  db.prepare('DELETE FROM monitoring WHERE id = ?').run(req.params.id);
  ok(res, { id: req.params.id });
});

// ---------------------------------------------------------------------
// Tasks / notifications
// ---------------------------------------------------------------------

api.get('/tasks', (req, res) => {
  const limit = Number(req.query.limit || 25);
  const rows = db.prepare('SELECT * FROM tasks ORDER BY COALESCE(started_at, created_at) DESC LIMIT ?').all(limit);
  ok(res, rows.map((r) => ({
    id: r.id,
    type: r.type || 'manual',
    entity_type: r.entity_type || null,
    entity_id: r.entity_id || null,
    status: r.status || 'done',
    severity: r.severity || 'info',
    title: r.title || '',
    message: r.message || '',
    payload: r.payload || null,
    started_at: r.started_at || r.created_at || nowIso(),
    finished_at: r.finished_at || null,
    seen_at: r.seen_at || null,
    seen: Boolean(r.seen_at),
  })));
});

api.get('/tasks/counts', (_req, res) => {
  const unseen = Number(db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE seen_at IS NULL").get().c);
  const running = Number(db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status = 'running'").get().c);
  const failed = Number(db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status = 'failed' AND seen_at IS NULL").get().c);

  ok(res, {
    unseen_done: 0,
    unseen_failed: failed,
    running: running,
    last_24h_done: 0,
    last_24h_failed: 0,
    unseen: unseen,
    last_24h: 0,
  });
});

api.get('/tasks/heartbeat', (_req, res) => ok(res, healthPayload()));

api.post('/tasks/seen-bulk', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const stmt = db.prepare('UPDATE tasks SET seen_at = ? WHERE id = ?');
  for (const id of ids) stmt.run(nowIso(), id);
  ok(res, { updated: ids.length });
});

api.post('/tasks/:id/seen', (req, res) => {
  db.prepare('UPDATE tasks SET seen_at = ? WHERE id = ?').run(nowIso(), req.params.id);
  ok(res, { id: req.params.id, seen: true });
});

api.delete('/tasks/:id', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  ok(res, { id: req.params.id });
});

// ---------------------------------------------------------------------
// Auto-analysis — analyse IA réelle (sweep + analyze-now + enrich)
// ---------------------------------------------------------------------

const autoFailures = new Set();
let lastSweepSummary = null;
let lastSweepAt = null;

/** Données disponibles d'une entité (company ou prospect) pour l'analyse commerciale. */
function buildEntityData(entityType, entity) {
  const comp = entityType === 'prospect' && entity.company_id ? getById('companies', entity.company_id) : null;
  const isProspect = entityType === 'prospect';
  const name = isProspect ? `${entity.first_name || ''} ${entity.last_name || ''}`.trim() : entity.name;
  const sector = entity.sector || entity.industry || (comp ? comp.sector || comp.industry : null) || null;
  const website = entity.website || (comp ? comp.website : null) || null;
  return {
    entityType,
    name: name || entity.name || 'Inconnu',
    sector,
    subsector: !isProspect ? entity.industry || null : null,
    location: [entity.city, entity.country].filter(Boolean).join(', ') || null,
    website: website || entity.website || null,
    phone: entity.phone || null,
    email: entity.email || null,
    companyName: isProspect ? comp?.name || null : entity.name,
    notes: entity.notes || null,
    currentScore: Number(entity.score) || null,
    mapsUrl: entity.google_maps_url || null,
  };
}

async function analyzeEntity(entityType, entityId, opts = {}) {
  const table = entityType === 'prospect' ? 'prospects' : 'companies';
  const entity = getById(table, entityId);
  if (!entity) throw new Error(entityType + ' not found');
  const company = entityType === 'prospect' && entity.company_id
    ? getById('companies', entity.company_id) : null;

  // 1) Sources → NormalizedInput (incl. scrape site).
  const normalized = await SCORING_ADAPTER.buildNormalizedFromScrape(entity, company, {
    maxPages: opts.maxPages ?? 4,
    timeoutMs: opts.timeoutMs ?? 12000,
  });

  // 2) Persist NormalizedInput + cache du breakdown déterministe.
  const inputSaved = SCORING_STORE.saveInput(entityType, entityId, normalized);
  let breakdown = SCORING_STORE.loadBreakdown(entityType, entityId, inputSaved.input_hash);
  if (!breakdown) {
    const calc = SCORING_ENGINE.calc(normalized);
    breakdown = SCORING_STORE.saveBreakdown(entityType, entityId, inputSaved.input_hash, calc.breakdown, calc.aggregate);
    breakdown = { ...breakdown, breakdown: calc.breakdown, aggregate: calc.aggregate };
  }
  const aggregate = breakdown.aggregate;

  // 2bis) Moteur d'Intelligence déterministe (consensus, signaux, opportunités,
  //   forecast, scénarios, plan d'action, qualité) — spec v1.0 §28-52.
  const profileEntity = { name: entity.name, sector: entity.sector, city: entity.city,
    country: entity.country, website: entity.website, email: entity.email, phone: entity.phone };
  const intelEngine = INTEL_ENGINE.runIntelligenceEngine(aggregate, breakdown.breakdown,
    profileEntity, { ai_narrated: !!(opts.provider || opts.model || opts.fullAI),
    product_price_monthly_eur: 490 /* anchor — affiné après narration IA */ });
  const engineMd = INTEL_ENGINE.renderEngineReport(intelEngine, profileEntity);
  const engineJson = JSON.stringify(intelEngine);

  // 3) Prompt AI : reçoit UNIQUEMENT les chiffres déterministes à narrer.
  const prompt = buildProspectPrompt({
    entity: buildEntityData(entityType, entity),
    siteProfile: normalized.siteProfileTextFields || {},
    scoring: {
      aggregate,
      breakdown: breakdown.breakdown,
      strengths: aggregate.strengths,
      weaknesses: aggregate.weaknesses,
      missing_data: aggregate.missing_data,
    },
    productCatalog: PROMPT.ZENTARA_CATALOG,
  });

  // 4) Appel AI → narration (resume, insights, recommendations, risks, email).
  //    Les scores numériques viennent du moteur — on ignore ceux de l'IA.
  let narrative = null;
  let provider = null;
  let model = null;
  let aiLatencyMs = 0;
  try {
    const providerOpts = { provider: opts.provider || undefined, model: opts.model || undefined, maxTokens: 4000 };
    const started = Date.now();
    const r = await ai.chatCompletion([{ role: 'user', content: prompt }], providerOpts);
    aiLatencyMs = Date.now() - started;
    provider = r.provider;
    model = r.model;
    narrative = parseAnalysisResponse(r.content);
    // Validation catalogue produit
    narrative.product_estimate = PROMPT.validateProductEstimate(narrative.product_estimate);
  } catch (e) {
    // L'IA peut échouer (timeout, rate-limit) — les chiffres déterministes
    // subsistent et un résumé minimal est conservé fallback.
    narrative = {
      summary: `Analyse déterministe uniquement (IA indisponible : ${e.message}).`,
      insights: aggregate.strengths.slice(0, 4).map((s) => `${s.label} : observé (value=${s.value.toFixed(2)}).`),
      recommendations: aggregate.weaknesses.slice(0, 3).map((w) => `Levier identifié : ${w.label} (value=${w.value.toFixed(2)}).`),
      risks: aggregate.weaknesses.slice(0, 3).map((w) => `${w.label} : point de vigilance.`),
      email_subject: '', email_html: '', email_body: '', email_cta_url: 'https://calendly.com/zentara-demo',
      profile: null, product_estimate: null, full_md: '',
    };
  }

  if (!narrative.summary && !narrative.full_md && !aggregate.opportunity_score && !aggregate.need_score) {
    throw new Error('Réponse IA vide ET aucune donnée déterministe exploitable.');
  }
  // Append engine report to display markdown.
  const baseDisplay = (narrative.full_md || narrative.summary || '');
  const display = baseDisplay ? `${baseDisplay}\n\n---\n\n${engineMd}` : engineMd;
  const now = nowIso();
  const analysisId = generateId('ana');

  // 5) Persist ai_analysis (résumé narratif) + intelligence (chiffré + meta).
  db.prepare(
    `INSERT INTO ai_analysis (id, entity_type, entity_id, provider, model, prompt_version, summary, insights, recommendations, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(analysisId, entityType, entityId, provider || 'engine-only', model || 'deterministic-v2',
       SCORING_STORE.PROMPT_VERSION,
       display.slice(0, 200000) || JSON.stringify(aggregate),
       JSON.stringify(narrative.insights), JSON.stringify(narrative.recommendations),
       aggregate.confidence, now, now);

  db.prepare(
    `INSERT INTO intelligence (id, entity_type, entity_id, score, opportunity_score, relevance_score, intent_score, activity_score, confidence_score, summary, insights, risks, recommendations, email_subject, email_html, email_body, email_cta_url, profile, product_estimate, input_hash, scoring_version, score_source, engine, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId('int'), entityType, entityId,
    aggregate.opportunity_score, aggregate.opportunity_score,
    0, 0, 0,
    aggregate.confidence,
    (display.slice(0, 200000)) || '',
    JSON.stringify(narrative.insights),
    JSON.stringify(narrative.risks),
    JSON.stringify(narrative.recommendations),
    narrative.email_subject || null, narrative.email_html || null, narrative.email_body || null, narrative.email_cta_url || null,
    narrative.profile ? JSON.stringify(narrative.profile) : null,
    narrative.product_estimate ? JSON.stringify(narrative.product_estimate) : null,
    inputSaved.input_hash, SCORING_STORE.PROMPT_VERSION, 'engine', engineJson, now, now,
  );

  // 6) Score agrégé écrit directement sur la row de l'entité.
  const finalScore = aggregate.opportunity_score;
  if (entityType === 'company') {
    db.prepare('UPDATE companies SET score = ?, updated_at = ? WHERE id = ?').run(finalScore, now, entityId);
  } else {
    db.prepare('UPDATE prospects SET score = ?, updated_at = ? WHERE id = ?').run(finalScore, now, entityId);
  }

  return {
    analysis: {
      id: analysisId, entity_type: entityType, entity_id: entityId,
      summary: narrative.summary, full_md: narrative.full_md,
      insights: narrative.insights, recommendations: narrative.recommendations, risks: narrative.risks,
      email_subject: narrative.email_subject, email_html: narrative.email_html,
      email_body: narrative.email_body, email_cta_url: narrative.email_cta_url,
      profile: narrative.profile, product_estimate: narrative.product_estimate,
      provider, model,
      // Scores déterminés par le moteur, pas l'IA :
      scores: {
        relevance:        0,
        opportunity:      aggregate.opportunity_score,
        intent:           0,
        activity:         0,
        confidence:       aggregate.confidence,
        need:             aggregate.need_score,
        opportunity_score: aggregate.opportunity_score,
        urgency:          aggregate.urgency,
        contact_risk:     aggregate.contact_risk,
      },
      scores_breakdown: breakdown.breakdown,
      score_source: 'engine',
      scoring_version: SCORING_STORE.PROMPT_VERSION,
      scoring_cached: !!breakdown.cached,
      input_hash: inputSaved.input_hash,
      ai_latency_ms: aiLatencyMs,
      engine: intelEngine,
    },
    provider, model,
    aggregate,
  };
}

api.get('/auto-analysis/failures', (_req, res) => ok(res, Array.from(autoFailures)));

api.get('/auto-analysis/status', (_req, res) => ok(res, {
  running: false,
  sweep_in_flight: false,
  last_sweep_at: lastSweepAt,
  last_sweep_summary: lastSweepSummary,
}));

api.get('/auto-analysis/last', (_req, res) => ok(res, lastSweepSummary ? { summary: lastSweepSummary, at: lastSweepAt } : null));

// ---------------------------------------------------------------------
// AXE 2 — File de jobs async pour les analyses longues (anti-TIMEOUT).
// ---------------------------------------------------------------------

/**
 * Runner pour la JobManager : exécute une analyse en passant les étapes.
 * À chaque étape on appelle onStage(stage, progress) pour mettre à jour le job.
 */
async function runAnalysisJob({ jobId, signal, onStage, params }) {
  const entityType = params.entity_type === 'prospect' ? 'prospect' : 'company';
  const entityId = String(params.entity_id || '');
  if (!entityId) throw new Error('entity_id manquant');

  // Étape 1 : sources (déjà géré par analyzeEntity → NormalizedInput).
  onStage('sources', 0.15);
  if (signal?.aborted) throw new Error('aborted');

  // Étape 2 : engine-calc + cache (le moteur est synchrone et rapide, <100ms).
  onStage('engine-calc', 0.35);
  if (signal?.aborted) throw new Error('aborted');

  // Étape 3 : exécution réelle (analyzeEntity fait scrape + IA + persist).
  //   Pendant la phase IA (la plus longue : ~10-25s), on rapporte
  //   "ai-narrative" à 0.65 puis "persisted" à 0.95 une fois analyzeEntity
  //   de retour (le persist a déjà eu lieu à l'intérieur).
  onStage('ai-narrative', 0.65);
  if (signal?.aborted) throw new Error('aborted');

  const result = await analyzeEntity(entityType, entityId, {
    provider: params.provider || undefined,
    model: params.model || undefined,
    maxPages: params.maxPages || 4,
    timeoutMs: params.timeoutMs || 12000,
  });

  onStage('persisted', 0.95);
  if (signal?.aborted) throw new Error('aborted');
  return { result_id: result?.analysis?.id || null, result_url: `/api/intelligence/${entityType}/${entityId}` };
}

// Initialise la JobManager après les autres globals.
const jobManager = new JobManager({
  maxConcurrent: Number(process.env.ZENTARA_JOB_MAX_CONCURRENT) || 2,
  runFn: runAnalysisJob,
});

// Endpoints de gestion de jobs.

api.post('/jobs', async (req, res) => {
  const body = req.body || {};
  const entityType = body.entity_type === 'prospect' ? 'prospect' : 'company';
  const entityId = String(body.entity_id || '');
  if (!entityId) return fail(res, 400, 'BAD_REQUEST', 'entity_id manquant');
  if (!getById(entityType === 'prospect' ? 'prospects' : 'companies', entityId)) {
    return fail(res, 404, 'NOT_FOUND', `${entityType} introuvable`);
  }
  try {
    const id = await jobManager.create({
      entityType, entityId,
      params: {
        entity_type: entityType, entity_id: entityId,
        provider: body.provider || null, model: body.model || null,
        maxPages: body.maxPages || 4, timeoutMs: body.timeoutMs || 12000,
        prompt_version: SCORING_STORE.PROMPT_VERSION,
      },
    });
    return ok(res, { job_id: id, status: 'queued', poll_url: `/api/jobs/${id}` });
  } catch (e) {
    return fail(res, 500, 'JOB_CREATE_FAILED', e.message);
  }
});

api.get('/jobs/:id', (req, res) => {
  const job = jobManager.get(req.params.id);
  if (!job) return fail(res, 404, 'NOT_FOUND', 'job introuvable');
  ok(res, job);
});

api.get('/jobs', (req, res) => {
  const list = jobManager.list({
    entityType: req.query.entity_type,
    entityId: req.query.entity_id,
    status: req.query.status,
    limit: Math.min(Number(req.query.limit) || 20, 100),
  });
  ok(res, { jobs: list });
});

api.post('/jobs/:id/cancel', (req, res) => {
  const ok_ = jobManager.cancel(req.params.id);
  if (!ok_) return fail(res, 409, 'CANCEL_FAILED', 'job déjà terminé ou introuvable');
  ok(res, { id: req.params.id, status: 'canceled' });
});

api.post('/jobs/:id/retry', async (req, res) => {
  const oldJob = jobManager.get(req.params.id);
  if (!oldJob) return fail(res, 404, 'NOT_FOUND', 'job introuvable');
  if (!['failed', 'canceled'].includes(oldJob.status)) {
    return fail(res, 409, 'BAD_RETRY', `seuls les jobs canceled/failed peuvent être relancés (status=${oldJob.status})`);
  }
  try {
    const newId = await jobManager.create({
      entityType: oldJob.entity_type, entityId: oldJob.entity_id,
      params: {
        entity_type: oldJob.entity_type, entity_id: oldJob.entity_id,
        provider: oldJob.provider, model: oldJob.model,
        prompt_version: oldJob.prompt_version,
      },
    });
    return ok(res, { job_id: newId, status: 'queued', poll_url: `/api/jobs/${newId}`, retry_of: req.params.id });
  } catch (e) {
    return fail(res, 500, 'RETRY_FAILED', e.message);
  }
});

api.post('/auto-analysis/sweep', async (req, res) => {
  const body = req.body || {};
  const threshold = Number(body.threshold ?? 70);
  const force = !!body.force;
  const candidates = force
    ? db.prepare('SELECT * FROM companies ORDER BY score DESC').all()
    : db.prepare('SELECT * FROM companies WHERE score >= ? ORDER BY score DESC').all(threshold);
  const startedAt = nowIso();
  const started = Date.now();
  const records = [];
  let analyzed = 0;
  let fresh_skipped = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await analyzeEntity('company', c.id);
      autoFailures.delete(c.id);
      analyzed++;
      records.push({ entity_type: 'company', entity_id: c.id, entity_name: c.name, score: Number(c.score || 0), status: 'analyzed', duration_ms: 0 });
    } catch (e) {
      failed++;
      autoFailures.add(c.id);
      records.push({ entity_type: 'company', entity_id: c.id, entity_name: c.name, score: Number(c.score || 0), status: 'failed', error: String(e.message) });
    }
  }
  lastSweepSummary = { candidates: candidates.length, analyzed, fresh_skipped, failed, threshold };
  lastSweepAt = nowIso();
  ok(res, {
    threshold, force, candidates: candidates.length, analyzed, fresh_skipped, failed,
    durée_ms: Date.now() - started, started_at: startedAt, finished_at: nowIso(), records,
    last_error: failed > 0 ? `${failed} analyse(s) échouée(s).` : undefined,
  });
});

api.post('/auto-analysis/analyze-now', async (req, res) => {
  const body = req.body || {};
  const entityType = body.prospect_id ? 'prospect' : 'company';
  const entityId = String(body.company_id || body.prospect_id || '');
  if (!entityId) return fail(res, 422, 'VALIDATION', 'company_id or prospect_id required');
  try {
    const r = await analyzeEntity(entityType, entityId);
    autoFailures.delete(entityId);
    ok(res, { id: r.analysis.id, status: 'analyzed', provider: r.provider, model: r.model });
  } catch (e) {
    autoFailures.add(entityId);
    fail(res, 502, 'AI_ERROR', 'auto-analysis échouée : ' + e.message);
  }
});

api.post('/auto-analysis/enrich', async (req, res) => {
  const body = req.body || {};
  const companyId = body.company_id;
  if (!companyId) return fail(res, 422, 'VALIDATION', 'company_id required');
  const company = getById('companies', companyId);
  if (!company) return fail(res, 404, 'NOT_FOUND', 'company not found');
  const results = {};
  if (body.analyze) {
    try { await analyzeEntity('company', companyId); results.analyze = 'ok'; } catch (e) { results.analyze = String(e.message); }
  }
  if (body.scrape && company.website) {
    try {
      const s = await scrape.scrapeSite(company.website);
      const emails = s.emails || [];
      let created = 0;
      for (const email of emails) {
        const existing = db.prepare('SELECT id FROM prospects WHERE email = ? AND company_id = ?').get(email, companyId);
        if (existing) continue;
        const { first_name, last_name } = deriveNameFromEmail(email, company.name);
        const now = nowIso();
        db.prepare(
          `INSERT INTO prospects (id, company_id, first_name, last_name, email, website, tags, status, score, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 0, ?, ?)`,
        ).run(generateId('pros'), companyId, first_name, last_name, email, company.website, JSON.stringify(['scraped']), now, now);
        created++;
      }
      results.scrape = created + ' prospects créés';
    } catch (e) { results.scrape = String(e.message); }
  }
  if (body.design && company.website) {
    try {
      const audit = await runDesignAudit(company.website);
      const id = generateId('aud');
      const now = nowIso();
      db.prepare(
        `INSERT INTO design_audits (id, url, domain, score, category_scores, issues, recommended_actions, ai_summary, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, audit.url, audit.domain, audit.score, JSON.stringify(audit.category_scores), JSON.stringify(audit.issues), JSON.stringify(audit.recommended_actions), audit.ai_summary, JSON.stringify(audit.meta), now);
      const tags = Array.isArray(company.tags) ? company.tags : [];
      if (!tags.includes('design')) tags.push('design');
      db.prepare('UPDATE companies SET tags = ? WHERE id = ?').run(JSON.stringify(tags), companyId);
      results.design = 'ok (score ' + audit.score + ')';
    } catch (e) { results.design = String(e.message); }
  }
  if (body.monitoring) {
    const now = nowIso();
    db.prepare(
      `INSERT INTO monitoring (id, entity_type, entity_id, source, signal_type, signal, confidence, detected_at, created_at)
       VALUES (?, 'company', ?, 'manual-enrich', 'enrichment', 'Module monitoring activé pour cette company.', 50, ?, ?)`,
    ).run(generateId('mon'), companyId, now, now);
    results.monitoring = 'ok';
  }
  ok(res, { done: true, results });
});

// ---------------------------------------------------------------------
// Leadflow + Maps (stubs — minimal backend)
// ---------------------------------------------------------------------

api.post('/leadflow/run', async (req, res) => {
  const { query, location, limit, source, enrichLimit, radius } = req.body || {};
  if (!query || !String(query).trim()) {
    return ok(res, {
      campaign_id: null, campaign_name: '', source: 'openstreetmap',
      companies_created: 0, prospects_created: 0, contacts_created: 0,
      emails_drafted: 0, sequences_created: 0, leads: [],
    });
  }
  try {
    const q = String(query).trim();
    const loc = String(location || '').trim();
    const lim = Math.max(1, Math.min(Number(limit) || 10, 50));
    const rad = radius !== undefined && radius !== null && radius !== '' ? Number(radius) : undefined;
    const src = String(source || 'osm');
    const enrichN = Math.max(0, Math.min(Number(enrichLimit) || 0, 20));

    // 1) Recherche Maps réelle (mêmes moteurs que /maps/search)
    let result;
    if (src === 'places' && apiKeyValue('google_places')) {
      try {
        const leads = await ENGINES.googlePlacesSearch({ query: q, location: loc, limit: lim, key: apiKeyValue('google_places') });
        result = { source: 'google-places', reason: `${leads.length} résultats via Google Places API`, leads };
      } catch (e) {
        const fb = await MULTI.runMaps({ query: q, location: loc, radius: rad, limit: lim });
        result = { ...fb, source: 'osm-fallback' };
      }
    } else if (src === 'serpapi' && apiKeyValue('serpapi')) {
      try {
        const leads = await ENGINES.serpapiSearch({ query: q, location: loc, limit: lim, key: apiKeyValue('serpapi') });
        result = { source: 'serpapi', reason: `${leads.length} résultats via SerpAPI`, leads };
      } catch (e) {
        const fb = await MULTI.runMaps({ query: q, location: loc, radius: rad, limit: lim });
        result = { ...fb, source: 'osm-fallback' };
      }
    } else if (src === 'outscraper' && apiKeyValue('outscraper')) {
      try {
        const leads = await ENGINES.outscraperSearch({ query: q, location: loc, limit: lim, key: apiKeyValue('outscraper') });
        result = { source: 'outscraper', reason: `${leads.length} résultats via Outscraper`, leads };
      } catch (e) {
        const fb = await MULTI.runMaps({ query: q, location: loc, radius: rad, limit: lim });
        result = { ...fb, source: 'osm-fallback' };
      }
    } else {
      result = await MULTI.runMaps({ query: q, location: loc, radius: rad, limit: lim });
    }

    // 2) Persistance companies + prospects + contacts
    const now = nowIso();
    let companies_created = 0;
    let prospects_created = 0;
    let contacts_created = 0;
    const leadsOut = [];
    const prospectIds = [];
    let enriched = 0;

    for (const lead of (result.leads || [])) {
      const co = persistCompany({
        name: lead.name,
        sector: lead.category || null,
        city: lead.city || null,
        country: lead.country || null,
        website: lead.website || null,
        score: Math.round((lead.confidence || 0.5) * 100),
        need: `Commerce local détecté (${lead.category || 'business'}) via ${lead.source || 'OpenStreetMap'}`,
        source: lead.source || 'maps',
      });
      if (!co) continue;
      if (co.created) companies_created++;

      let email = lead.email || null;
      let phone = lead.phone || null;
      let confidence = lead.confidence ?? 0;

      // 3) Enrichissement email : scraping du site si pas d'email (jusqu'à enrichLimit)
      if (!email && lead.website && enriched < enrichN) {
        try {
          const s = await scrape.scrapeSite(lead.website);
          const emails = s.emails || [];
          const phones = s.phones || [];
          if (emails.length) {
            email = emails[0];
            confidence = Math.max(confidence, 60);
            enriched++;
          }
          if (!phone && phones.length) phone = phones[0];
        } catch {
          /* site injoignable — on garde le lead tel quel */
        }
      }

      // Prospect uniquement si email (ou téléphone en secours)
      if (email || phone) {
        const dup = email
          ? db.prepare('SELECT id FROM prospects WHERE LOWER(email) = LOWER(?) AND company_id = ? LIMIT 1').get(email, co.id)
          : db.prepare('SELECT id FROM prospects WHERE phone = ? AND company_id = ? LIMIT 1').get(phone, co.id);
        if (!dup) {
          const pid = generateId('pros');
          db.prepare(
            `INSERT INTO prospects (id, company_id, first_name, last_name, email, phone, role, sector, address, city, country, website, score, status, tags, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            pid, co.id, lead.name, '', email, phone || null,
            lead.category || null, lead.category || null, lead.address || null, lead.city || null,
            lead.country || null, lead.website || null,
            Math.round(confidence * 100), 'new',
            JSON.stringify(['maps', 'local', lead.source || 'osm']), now, now
          );
          prospectIds.push(pid);
          prospects_created++;
        }
      }

      // Contact uniquement si email
      if (email) {
        const dupC = db.prepare('SELECT id FROM contacts WHERE LOWER(email) = LOWER(?) AND company_id = ? LIMIT 1').get(email, co.id);
        if (!dupC) {
          db.prepare(
            `INSERT INTO contacts (id, company_id, first_name, last_name, role, email, phone, tags, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            generateId('con'), co.id, lead.name, '', lead.category || null, email, phone || null,
            JSON.stringify(['maps', 'local', lead.source || 'osm']), now, now
          );
          contacts_created++;
        }
      }

      leadsOut.push({
        name: lead.name,
        category: lead.category || null,
        phone,
        website: lead.website || null,
        email,
        confidence: Math.round(confidence * 100),
        enriched: !!email && !lead.email,
      });
    }

    // 4) Campagne + rattachement des prospects
    const campaignId = generateId('cam');
    const campaignName = `Leadflow · ${q}${loc ? ' · ' + loc : ''}`;
    db.prepare(
      `INSERT INTO campaigns (id, name, description, status, target, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?)`
    ).run(
      campaignId, campaignName,
      `Campagne générée par Leadflow (${result.source}) — ${lim} cibles.`, lim, now, now
    );
    for (const pid of prospectIds) {
      db.prepare(
        `INSERT OR IGNORE INTO campaign_prospects (id, campaign_id, prospect_id) VALUES (?, ?, ?)`
      ).run(generateId('cp'), campaignId, pid);
    }

    ok(res, {
      campaign_id: campaignId,
      campaign_name: campaignName,
      source: result.source,
      companies_created,
      prospects_created,
      contacts_created,
      emails_drafted: 0,
      sequences_created: 0,
      leads: leadsOut,
    });
  } catch (e) {
    ok(res, {
      campaign_id: null, campaign_name: '', source: 'openstreetmap',
      companies_created: 0, prospects_created: 0, contacts_created: 0,
      emails_drafted: 0, sequences_created: 0, leads: [],
      error: String(e.message),
    });
  }
});

api.get('/maps/status', (_req, res) => ok(res, {
  places: { configured: !!apiKeyValue('google_places'), free: false, label: 'Google Places API (clé requise)' },
  serpapi: { configured: !!apiKeyValue('serpapi'), free: false, label: 'SerpAPI (clé requise)' },
  outscraper: { configured: !!apiKeyValue('outscraper'), free: false, label: 'Outscraper (clé requise)' },
  osm: { configured: true, free: true, label: 'OpenStreetMap / Overpass (gratuit, sans clé)' },
  mock: { configured: false },
}));

api.post('/maps/search', async (req, res) => {
  const { query, location, limit, radius, save } = req.body || {};
  if (!query || !String(query).trim()) {
    return ok(res, { source: 'openstreetmap', reason: 'Requête vide.', leads: [], created_companies: 0, skipped_duplicates: 0 });
  }
  try {
    const q = String(query).trim();
    const loc = String(location || '').trim();
    const lim = Number(limit) || 20;
    const rad = radius !== undefined && radius !== null && radius !== '' ? Number(radius) : undefined;
    const source = String(req.body?.source || 'osm');
    let result;
    // Moteurs payants optionnels (si la clé est configurée) sinon fallback gratuit OSM.
    if (source === 'places' && apiKeyValue('google_places')) {
      try {
        const leads = await ENGINES.googlePlacesSearch({ query: q, location: loc, limit: lim, key: apiKeyValue('google_places') });
        result = { source: 'google-places', reason: `${leads.length} résultats réels via Google Places API`, leads };
      } catch (e) {
        result = { source: 'osm-fallback', reason: 'Google Places a échoué (' + String(e.message) + ') → fallback OpenStreetMap', leads: [] };
        const fb = await MULTI.runMaps({ query: q, location: loc, radius: rad, limit: lim });
        result = { ...fb, source: 'osm-fallback' };
      }
    } else if (source === 'serpapi' && apiKeyValue('serpapi')) {
      try {
        const leads = await ENGINES.serpapiSearch({ query: q, location: loc, limit: lim, key: apiKeyValue('serpapi') });
        result = { source: 'serpapi', reason: `${leads.length} résultats réels via SerpAPI (Google Maps)`, leads };
      } catch (e) {
        const fb = await MULTI.runMaps({ query: q, location: loc, radius: rad, limit: lim });
        result = { ...fb, source: 'osm-fallback', reason: 'SerpAPI a échoué (' + String(e.message) + ') → fallback OpenStreetMap' };
      }
    } else if (source === 'outscraper' && apiKeyValue('outscraper')) {
      try {
        const leads = await ENGINES.outscraperSearch({ query: q, location: loc, limit: lim, key: apiKeyValue('outscraper') });
        result = { source: 'outscraper', reason: `${leads.length} résultats réels via Outscraper`, leads };
      } catch (e) {
        const fb = await MULTI.runMaps({ query: q, location: loc, radius: rad, limit: lim });
        result = { ...fb, source: 'osm-fallback', reason: 'Outscraper a échoué (' + String(e.message) + ') → fallback OpenStreetMap' };
      }
    } else {
      result = await MULTI.runMaps({ query: q, location: loc, radius: rad, limit: lim });
    }
    let created = 0;
    let skipped = 0;
    if (save !== false) {
      for (const lead of result.leads || []) {
        const co = persistCompany({
          name: lead.name,
          sector: lead.category || null,
          city: lead.city || null,
          country: lead.country || null,
          website: lead.website || null,
          score: Math.round((lead.confidence || 0.5) * 100),
          need: `Commerce local détecté (${lead.category || 'business'}) via ${lead.source || 'OpenStreetMap'}`,
          source: lead.source || 'maps',
        });
        if (!co) { skipped++; continue; }
        if (co.created) created++;
        // Prospect si on a un email ou un téléphone réel
        if (lead.email || lead.phone) {
          const email = lead.email || '';
          const dup = email
            ? db.prepare('SELECT id FROM prospects WHERE LOWER(email) = LOWER(?) AND company_id = ? LIMIT 1').get(email, co.id)
            : db.prepare('SELECT id FROM prospects WHERE phone = ? AND company_id = ? LIMIT 1').get(lead.phone, co.id);
          if (!dup) {
            db.prepare(
              `INSERT INTO prospects (id, company_id, first_name, last_name, email, phone, role, sector, address, city, country, website, score, status, tags, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              generateId('pros'), co.id, lead.name, '', email, lead.phone || null,
              lead.category || null, lead.category || null, lead.address || null, lead.city || null,
              lead.country || null, lead.website || null,
              Math.round((lead.confidence || 0.5) * 100), 'new',
              JSON.stringify(['maps', 'local', lead.source || 'osm']), nowIso(), nowIso()
            );
          }
        }
      }
    }
    ok(res, { ...result, created_companies: created, skipped_duplicates: skipped });
  } catch (e) {
    ok(res, { source: 'openstreetmap', reason: 'Erreur : ' + String(e.message), leads: [], created_companies: 0, skipped_duplicates: 0 });
  }
});

// ---------------------------------------------------------------------
// Intelligence (stubs — no AI provider wired yet)
// ---------------------------------------------------------------------

// In-memory prospecting session status (for the chat progress card).
const prospectingSessions = new Map();

/** Persiste une company trouvée (dédup par nom insensible à la casse). */
function persistCompany({ name, sector, city, country, website, score, need, source }) {
  const nameNorm = String(name || '').trim();
  if (!nameNorm) return null;
  // Garde anti-bruit : repos GitHub / pages docs / sites poubelles ne deviennent jamais une company.
  if (MULTI.isNoiseCompany({ name: nameNorm, website })) return null;
  const existing = db
    .prepare('SELECT id FROM companies WHERE LOWER(TRIM(name)) = LOWER(?) LIMIT 1')
    .get(nameNorm);
  if (existing) return { id: existing.id, created: false };

  const id = generateId('com');
  const now = nowIso();
  const notes = [
    `Besoin d'intelligence principal : ${need || 'n/a'}`,
    `Source : ${source || 'IA prospection'}`,
  ].join('\n');
  db.prepare(
    `INSERT INTO companies (id, name, website, sector, city, country, score, status, notes, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
  ).run(id, nameNorm, website || null, sector || null, city || null, country || null, Number(score || 0), notes, 'ai-generated', now, now);
  return { id, created: true };
}

api.post('/intelligence/prospect', async (req, res) => {
  const body = req.body || {};
  const sector = String(body.sector || body.niche || 'SaaS B2B').trim();
  const region = String(body.region || 'France').trim();
  const targetCount = Math.min(Math.max(Number(body.target_count || 8), 1), 25);
  const context = String(body.context || '').trim();
  const started = Date.now();
  const sessionId = generateId('pros');

  try {
    // 1) Recherche RÉELLE via Zentara One (annuaires gratuits + SEC EDGAR + maps).
    //    On cherche de VRAIES entreprises — on ne laisse plus l'IA inventer des noms.
    const apiKeys = {
      opencorporates: apiKeyValue('opencorporates'),
      google_places: apiKeyValue('google_places'),
      serpapi: apiKeyValue('serpapi'),
      outscraper: apiKeyValue('outscraper'),
    };
    const searchLimit = Math.max(targetCount * 3, 20);
    const withTimeout = (p, ms) => Promise.race([
      p,
      new Promise((_, rej) => setTimeout(() => rej(new Error('search timeout')), ms)),
    ]);
    // NOTE : les deux recherches tournent en parallèle. La recherche
    // « companies » (39 sources) sature le pool HTTP et ralentit Overpass,
    // d'où un délai de ~20-35s. 15s faisait échouer LES DEUX et basculait
    // sur l'IA inventée (verified:false). On laisse 40s pour que les vraies
    // entreprises (SEC EDGAR / OpenStreetMap) remontent réellement.
    // Sources « companies » limitées aux annuaires métier (pas de github/npm/
    // orcid/etc.) pour éviter de remonter des profils et des artefacts.
    const businessSources = MULTI.businessSourceIds().join(',');
    const [dirRes, localRes] = await Promise.allSettled([
      withTimeout(ENGINE.search({ mode: 'companies', query: sector, location: region, limit: searchLimit, apiKeys, sources: businessSources }), 40000),
      withTimeout(ENGINE.search({ mode: 'local', query: sector, location: region, limit: searchLimit, apiKeys }), 40000),
    ]);

    const realSources = [];
    const seenNames = new Set();
    const realCompanies = [];
    // Local (OpenStreetMap) D'ABORD : pour une requête géolocalisée, les
    // entreprises du secteur réel sont prioritaires sur les annuaires généraux.
    for (const sr of [localRes, dirRes]) {
      if (sr.status !== 'fulfilled') continue;
      const value = sr.value || {};
      for (const s of value.sources || []) realSources.push(s);
      for (const r of value.results || []) {
        if (!r || r.type !== 'company') continue;
        const name = String(r.name || '').trim();
        if (!name) continue;
        if (MULTI.isNoiseCompany({ name, website: r.website })) continue;
        const key = name.toLowerCase();
        if (seenNames.has(key)) continue;
        seenNames.add(key);
        realCompanies.push({
          name,
          sector: r.category || sector,
          hq_city: r.city || null,
          hq_country: r.country || null,
          website: r.website || null,
          source: r.source || r.sourceGroup || 'annuaire',
        });
      }
    }

    // 2) Qualification par l'IA : elle ne crée PAS d'entreprises, elle évalue le
    //    besoin d'intelligence de CHACUNE des entreprises réelles trouvées.
    let qualified = [];
    let provider = null;
    let model = null;
    let summary = '';
    if (realCompanies.length > 0) {
      const listBlock = realCompanies
        .slice(0, Math.min(realCompanies.length, 40))
        .map((c, i) => `${i + 1}. ${c.name}${c.sector ? ` (${c.sector})` : ''}${c.hq_city ? ` — ${c.hq_city}` : ''}${c.hq_country ? `, ${c.hq_country}` : ''}`)
        .join('\n');
      const qPrompt = `Tu es l'analyste prospection de Zentara.
Voici une liste d'entreprises RÉELLES trouvées par nos moteurs d'annuaire.
N'INVENTE AUCUNE entreprise supplémentaire : travaille UNIQUEMENT sur ces noms.

${listBlock}

Pour CHAQUE entreprise de la liste, évalue :
- zentara_opportunity_score (0-100) : potentiel d'outreach pour une solution d'intelligence commerciale B2B (pression concurrentielle, complexité/fragmentation des données, fréquence de veille, urgence, budget probable).
- primary_intelligence_need : le besoin le plus probable (ex: "Competitive Intelligence", "Market Intelligence", "Sales Intelligence", "Regulatory Intelligence", "Corporate Intelligence").

Réponds UNIQUEMENT en JSON valide, sans texte autour :
{"summary":"...","companies":[{"name":"<nom EXACT de la liste>","zentara_opportunity_score":80,"primary_intelligence_need":"..."}]}`;
      try {
        const r = await ai.chatCompletion(
          [{ role: 'user', content: qPrompt }],
          { provider: body.provider || undefined, model: body.model || undefined, maxTokens: 4000, json: true },
        );
        provider = r.provider;
        model = r.model;
        const parsed = ai.extractJson(r.content);
        if (parsed && Array.isArray(parsed.companies)) {
          summary = String(parsed.summary || '').trim();
          const byName = new Map();
          for (const q of parsed.companies) {
            if (q && q.name) byName.set(String(q.name).toLowerCase().trim(), q);
          }
          qualified = realCompanies.map((c) => {
            const q = byName.get(c.name.toLowerCase());
            return {
              ...c,
              zentara_opportunity_score: Number(q?.zentara_opportunity_score || 0),
              primary_intelligence_need: String(q?.primary_intelligence_need || 'Market Intelligence'),
            };
          });
        }
      } catch (_e) {
        /* IA indisponible — on garde les entreprises réelles avec score neutre */
      }
    }

    if (qualified.length === 0 && realCompanies.length > 0) {
      qualified = realCompanies.map((c) => ({
        ...c,
        zentara_opportunity_score: 50,
        primary_intelligence_need: 'Market Intelligence',
      }));
    }

    // 3) Fallback : uniquement si la recherche réelle ne remonte RIEN
    //    (annuaires vides / hors-ligne). On prévient alors que la liste est
    //    issue de l'IA et NON vérifiée.
    let verified = true;
    let finalList = qualified;
    if (finalList.length === 0) {
      verified = false;
      const inventPrompt = `Tu es le moteur de prospection stratégique Zentara.
Trouve ${targetCount} entreprises RÉELLES et VÉRIFIABLES correspondant à cette recherche :
- Niche / secteur : ${sector}
- Région : ${region}
${context ? `- Contexte : ${context}` : ''}
RÈGLES : uniquement des entreprises réelles, connues et vérifiables. En cas de doute, EXCLUS-la.
Réponds UNIQUEMENT en JSON valide, sans texte autour :
{"summary":"...","companies":[{"name":"...","sector":"...","hq_city":"...","hq_country":"...","company_size":"...","zentara_opportunity_score":80,"primary_intelligence_need":"..."}]}`;
      try {
        const r = await ai.chatCompletion(
          [{ role: 'user', content: inventPrompt }],
          { provider: body.provider || undefined, model: body.model || undefined, maxTokens: 4000, json: true },
        );
        provider = r.provider;
        model = r.model;
        const parsed = ai.extractJson(r.content);
        if (!parsed || !Array.isArray(parsed.companies)) throw new Error('Réponse IA invalide (JSON attendu non reçu)');
        summary = parsed.summary || summary;
        finalList = parsed.companies.slice(0, targetCount).map((c) => ({
          name: c.name || '',
          sector: c.sector || sector,
          hq_city: c.hq_city || '',
          hq_country: c.hq_country || '',
          company_size: c.company_size || '',
          website: c.website || null,
          zentara_opportunity_score: Number(c.zentara_opportunity_score || 0),
          primary_intelligence_need: c.primary_intelligence_need || '',
          source: `IA prospection (${sector})`,
        }));
      } catch (e) {
        return fail(res, 502, 'AI_ERROR', `Prospection échouée : ${e.message}`);
      }
    }

    // 4) Persistance + réponse (forme stable pour le front).
    const companies = [];
    let persisted = 0;
    finalList.slice(0, targetCount).forEach((c, i) => {
      const rec = persistCompany({
        name: c.name,
        sector: c.sector,
        city: c.hq_city,
        country: c.hq_country,
        website: c.website,
        score: c.zentara_opportunity_score,
        need: c.primary_intelligence_need,
        source: c.source || (verified ? `annuaire (${sector})` : `IA prospection (${sector})`),
      });
      if (rec?.created) persisted += 1;
      companies.push({
        rank: i + 1,
        name: c.name || '',
        sector: c.sector || '',
        hq_city: c.hq_city || '',
        hq_country: c.hq_country || '',
        company_size: c.company_size || '',
        website: c.website || '',
        zentara_opportunity_score: Number(c.zentara_opportunity_score || 0),
        priority_tier: Number(c.zentara_opportunity_score || 0) >= 70 ? 'HOT' : Number(c.zentara_opportunity_score || 0) >= 40 ? 'WARM' : 'COLD',
        primary_intelligence_need: c.primary_intelligence_need || '',
        verified,
      });
    });

    const done = companies.length;
    prospectingSessions.set(sessionId, {
      session_id: sessionId,
      total: done,
      analyzed: done,
      pending: 0,
      done: true,
      updated_at: nowIso(),
    });

    ok(res, {
      prospecting_session_id: sessionId,
      executed_at: nowIso(),
      summary: summary || `${done} entreprise(s) identifiée(s) dans ${sector} (${region}).`,
      persisted_companies: persisted,
      duration_ms: Date.now() - started,
      auto_analyze_enabled: true,
      auto_analyze_threshold: 70,
      provider,
      model,
      verified,
      real_sources: [...new Set(realSources)],
      companies,
      top_lists: {
        top_10_must_contact_now: companies
          .slice()
          .sort((a, b) => b.zentara_opportunity_score - a.zentara_opportunity_score)
          .slice(0, 10)
          .map((c) => c.name),
        top_10_most_urgent_need: companies
          .slice()
          .sort((a, b) => b.zentara_opportunity_score - a.zentara_opportunity_score)
          .slice(0, 10)
          .map((c) => `${c.name} — ${c.primary_intelligence_need}`),
      },
    });
  } catch (e) {
    return fail(res, 502, 'AI_ERROR', `Prospection échouée : ${e.message}`);
  }
});

api.get('/intelligence/prospect/:sessionId/status', (req, res) => {
  const st = prospectingSessions.get(req.params.sessionId);
  ok(res, st || {
    session_id: req.params.sessionId,
    total: 0,
    analyzed: 0,
    pending: 0,
    done: true,
    updated_at: nowIso(),
  });
});

api.post('/intelligence/analyze', async (req, res) => {
  const body = req.body || {};
  const entityType = body.entity_type === 'prospect' ? 'prospect' : 'company';
  const entityId = String(body.entity_id || '');
  const entity = getById(entityType === 'prospect' ? 'prospects' : 'companies', entityId);
  if (!entity) return fail(res, 404, 'NOT_FOUND', `${entityType} not found`);

  try {
    const result = await analyzeEntity(entityType, entityId, {
      provider: body.provider || undefined,
      model: body.model || undefined,
      maxPages: body.maxPages || 4,
      timeoutMs: body.timeoutMs || 12000,
    });
    const analysis = result.analysis;
    return ok(res, {
      id: analysis.id,
      entity_type: entityType,
      entity_id: entityId,
      summary: analysis.summary || '',
      profile_md: analysis.full_md || '',
      insights: analysis.insights || [],
      recommendations: analysis.recommendations || [],
      risks: analysis.risks || [],
      // Les scores viennent du moteur déterministe — JAMAIS du LLM.
      scores: analysis.scores,
      need_score: analysis.scores.need,
      opportunity_score: analysis.scores.opportunity_score,
      urgency: analysis.scores.urgency,
      contact_risk: analysis.scores.contact_risk,
      confidence_level: analysis.scores.confidence >= 70 ? 'élevé'
                      : analysis.scores.confidence >= 40 ? 'moyen' : 'faible',
      email_subject: analysis.email_subject,
      email_html: analysis.email_html,
      email_cta_url: analysis.email_cta_url,
      email_body: analysis.email_body,
      profile: analysis.profile,
      product_estimate: analysis.product_estimate,
      source: 'engine+ai-narrative-v2',
      score_source: analysis.score_source,
      scoring_version: analysis.scoring_version,
      scoring_cached: analysis.scoring_cached,
      input_hash: analysis.input_hash,
      ai_latency_ms: analysis.ai_latency_ms,
      ai_skipped: !analysis.provider,
      provider: analysis.provider,
      model: analysis.model,
      engine: analysis.engine,
      engines_run: ['scoring-engine-v1', 'intelligence-engine-v1', 'strategic-intelligence'],
    });
  } catch (e) {
    return fail(res, 502, 'ANALYZE_ERROR', `Analyse échouée : ${e.message}`);
  }
});

api.get('/analytics/overview', (_req, res) => {
  ok(res, {
    users: count('users'),
    companies: count('companies'),
    prospects: count('prospects'),
    contacts: count('contacts'),
    campaigns: count('campaigns'),
    intelligence: count('intelligence'),
    signals: count('monitoring'),
    ai_analyses: Number(db.prepare("SELECT COUNT(*) AS c FROM intelligence WHERE provider IS NOT NULL").get().c),
    monitoring: count('monitoring'),
  });
});

api.get('/intelligence/:type/:id/signals', (req, res) => {
  const type = req.params.type === 'prospect' ? 'prospect' : 'company';
  const rows = db.prepare('SELECT * FROM monitoring WHERE entity_type = ? AND entity_id = ? ORDER BY detected_at DESC').all(type, req.params.id);
  ok(res, rows.map((r) => ({
    id: r.id,
    entity_type: r.entity_type || null,
    entity_id: r.entity_id || null,
    source: r.source || 'unknown',
    entity_name: entityName(r.entity_type, r.entity_id) || '—',
    type: r.signal_type || 'signal',
    content: r.signal || '',
    confidence: Number(r.confidence || 0),
    severity: severityFor(r.confidence),
    detected_at: r.detected_at || r.created_at || nowIso(),
  })));
});

// GET /api/intelligence/explain/:type/:id — trace détaillée & reproductibilité.
// Renvoie les sources sérialisées, le calcul des 50 critères,
// l'agrégat + les analyses IA successives (et l'input_hash qui les explique).
api.get('/intelligence/explain/:type/:id', (req, res) => {
  const type = req.params.type === 'prospect' ? 'prospect' : 'company';
  const explain = SCORING_STORE.explain(type, req.params.id);
  if (!explain) return fail(res, 404, 'NOT_FOUND', 'entité introuvable');
  ok(res, {
    entity: explain.entity,
    inputs: explain.inputs.map((i) => ({
      id: i.id, input_hash: i.input_hash, sources: i.sources, created_at: i.created_at,
    })),
    breakdowns: explain.breakdowns.map((b) => ({
      id: b.id, input_hash: b.input_hash, prompt_version: b.prompt_version,
      computed_at: b.computed_at,
      aggregate: b.aggregate,
      criteria: b.breakdown.map((c) => ({
        id: c.id, category: c.category, label: c.label, direction: c.direction,
        weight: c.weight, value: c.value, evidence: c.evidence,
      })),
    })),
    analyses: explain.analyses.map((a) => ({
      id: a.id, created_at: a.created_at, provider: a.provider, model: a.model,
      prompt_version: a.prompt_version, confidence: a.confidence,
      insights: parseJsonField(a.insights), recommendations: parseJsonField(a.recommendations),
    })),
    intelligence: explain.intelligence,
  });
});

api.post('/intelligence/pipeline/prospect', (_req, res) => ok(res, { done: true, provider: ai.DEFAULT_PROVIDER }));
api.post('/intelligence/pipeline/company', (_req, res) => ok(res, { done: true, provider: ai.DEFAULT_PROVIDER }));
api.post('/intelligence/pipeline/query', (_req, res) => ok(res, { done: true, provider: ai.DEFAULT_PROVIDER }));
api.get('/intelligence/engines', (_req, res) => ok(res, {
  engines: ['strategic-intelligence', 'prospecting', 'outreach'],
}));
api.get('/intelligence/:type/:id', (req, res) => {
  const type = req.params.type === 'prospect' ? 'prospect' : 'company';
  const row = db.prepare('SELECT * FROM intelligence WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1').get(type, req.params.id);
  ok(res, row ? normalizeRow(row) : null);
});

// ---------------------------------------------------------------------
// AXE 3 — Templates email premium (list / preview / render).
// ---------------------------------------------------------------------

api.get('/email-templates', (_req, res) => {
  ok(res, { templates: EMAIL_TEMPLATES.listTemplates(), brand: EMAIL_TEMPLATES.BRAND });
});

api.get('/email-templates/:id', (req, res) => {
  const t = EMAIL_TEMPLATES.getTemplate(req.params.id);
  if (!t) return fail(res, 404, 'NOT_FOUND', 'template introuvable');
  ok(res, t);
});

api.post('/email-templates/:id/render', (req, res) => {
  const vars = (req.body && req.body.variables) || {};
  try {
    const r = EMAIL_TEMPLATES.renderEmailTemplate(req.params.id, vars);
    return ok(res, {
      template_id: r.template.id,
      subject: r.subject,
      html: r.html,
      variables_used: r.variables_used,
      bytes: r.html.length,
    });
  } catch (e) {
    return fail(res, 400, 'RENDER_FAILED', e.message);
  }
});

api.post('/email-templates/render', (req, res) => {
  const { template_id, variables } = req.body || {};
  if (!template_id) return fail(res, 400, 'BAD_REQUEST', 'template_id manquant');
  try {
    const r = EMAIL_TEMPLATES.renderEmailTemplate(template_id, variables || {});
    return ok(res, {
      template_id: r.template.id,
      subject: r.subject,
      html: r.html,
      variables_used: r.variables_used,
      bytes: r.html.length,
    });
  } catch (e) {
    return fail(res, 400, 'RENDER_FAILED', e.message);
  }
});

/**
 * Génère un email premium à partir d'une intelligence déjà calculée :
 *  • Récupère la dernière intelligence row pour l'entité.
 *  • Mappe scores/narrative → variables du template demandé.
 *  • Rend via le moteur premium.
 *
 * Idempotent : mêmes inputs ⇒ même HTML (output reproductible).
 */
api.post('/email-templates/from-analysis/:type/:id', (req, res) => {
  const type = req.params.type === 'prospect' ? 'prospect' : 'company';
  const id = req.params.id;
  const row = db.prepare('SELECT * FROM intelligence WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1').get(type, id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'pas d\'analyse pour cette entité');

  const aggregate = (() => {
    const latestBreak = db.prepare(
      `SELECT aggregate FROM scoring_breakdowns
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY computed_at DESC LIMIT 1`,
    ).get(type, id);
    return latestBreak ? JSON.parse(latestBreak.aggregate) : {};
  })();

  // Récupère le prospect / company pour les variables de personnalisation.
  const isProspect = type === 'prospect';
  const entityRow = isProspect
    ? db.prepare('SELECT * FROM prospects WHERE id = ?').get(id)
    : db.prepare('SELECT * FROM companies WHERE id = ?').get(id);

  const firstName = isProspect ? (entityRow?.first_name || '') : '';
  const lastName = isProspect ? (entityRow?.last_name || '') : '';
  const companyName = isProspect
    ? (db.prepare('SELECT name FROM companies WHERE id = ?').get(entityRow?.company_id)?.name || '')
    : (entityRow?.name || '');

  // Auto-mapping scores → contenu narratif.
  const strengths = Array.isArray(aggregate.strengths) ? aggregate.strengths : [];
  const weaknesses = Array.isArray(aggregate.weaknesses) ? aggregate.weaknesses : [];
  const strengthLabels = strengths.slice(0, 3).map((s) => s.label).join(', ');
  const weaknessLabels = weaknesses.slice(0, 3).map((w) => w.label).join(', ');
  const opportunity = Number(aggregate.opportunity_score || 0);

  const templateId = (req.body && req.body.template_id) || 'outreach_first_touch';
  try {
    const r = EMAIL_TEMPLATES.renderEmailTemplate(templateId, {
      recipient_first_name: firstName,
      recipient_last_name: lastName,
      recipient_role: '',
      company_name: companyName,
      company_sector: entityRow?.sector || '',
      observation: strengthLabels
        ? `Parmi vos points forts actuels : ${strengthLabels}.`
        : '',
      problem: weaknessLabels
        ? `Nous avons relevé plusieurs axes d'amélioration détectables : ${weaknessLabels}.`
        : '',
      consequence: opportunity < 40
        ? 'Sans amélioration ciblée, ces angles morts resteront un frein à votre croissance.'
        : 'Une démarche structurée permettrait de transformer ces signaux en leviers commerciaux.',
      solution: `Zentara Intelligence Pro (990 €/mois HT) vous donne accès à l'analyse déterministe 50 critères et au monitoring continu.`,
      cta_text: 'En discuter 15 min',
      cta_url: 'https://calendly.com/zentara-demo',
    });
    return ok(res, {
      template_id: r.template.id,
      subject: r.subject,
      html: r.html,
      variables_used: r.variables_used,
      bytes: r.html.length,
      source: { entity_type: type, entity_id: id, opportunity_score: opportunity },
    });
  } catch (e) {
    return fail(res, 400, 'RENDER_FAILED', e.message);
  }
});

// ---------------------------------------------------------------------
// Knowledge — base de connaissances (RAG hash-v1 : ingest + search)
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Knowledge — base de connaissances (RAG hash-v1 : ingest + search)
// ---------------------------------------------------------------------

function hashEmbedding(text) {
  const vec = new Array(256).fill(0);
  const tokens = String(text || '').toLowerCase().split(/[^a-z0-9à-ÿ]+/).filter(Boolean);
  for (const t of tokens) {
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    vec[h % 256] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function chunkText(text, size = 600, overlap = 60) {
  const chunks = [];
  const t = String(text || '').trim();
  if (!t) return chunks;
  let start = 0;
  while (start < t.length) {
    chunks.push(t.slice(start, start + size));
    if (start + size >= t.length) break;
    start += size - overlap;
  }
  return chunks;
}

api.post('/knowledge/ingest', (req, res) => {
  const body = req.body || {};
  const content = String(body.content || '').trim();
  if (!content) return fail(res, 422, 'VALIDATION', 'content required');
  const source = String(body.source || 'note');
  const title = String(body.title || '').slice(0, 200) || content.slice(0, 60);
  const meta = body.metadata || {};
  const chunks = chunkText(content);
  const ids = [];
  const now = nowIso();
  chunks.forEach((chunk, i) => {
    const id = generateId('kn');
    db.prepare(
      `INSERT INTO knowledge_chunks (id, source, source_ref, title, content, chunk_index, embedding, dim, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 256, ?, ?, ?)`,
    ).run(id, source, body.source_ref || null, title, chunk, i, JSON.stringify(hashEmbedding(chunk)), JSON.stringify(meta), now, now);
    ids.push(id);
  });
  ok(res, { chunk_ids: ids, chunk_count: ids.length, dim: 256, embedding_backend: 'hash-v1' });
});

function knowledgeSearch(query, limit, minScore) {
  const q = String(query || '').trim();
  if (!q) return { query: q, snippets: [], query_embedding_dim: 256, backend: 'hash-v1', duration_ms: 0 };
  const started = Date.now();
  const qv = hashEmbedding(q);
  const rows = db.prepare('SELECT * FROM knowledge_chunks ORDER BY created_at DESC LIMIT 1000').all();
  const scored = [];
  for (const r of rows) {
    let emb = null;
    if (r.embedding) { try { emb = JSON.parse(r.embedding); } catch { emb = null; } }
    if (!emb) emb = hashEmbedding(r.content);
    const score = cosineSimilarity(qv, emb);
    if (score >= (minScore || 0)) scored.push({ r, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const snippets = scored.slice(0, limit || 5).map(({ r, score }) => ({
    title: r.title || '',
    snippet: r.content.slice(0, 300),
    score: Math.round(score * 100) / 100,
    source: r.source,
    source_ref: r.source_ref || null,
    chunk_id: r.id,
  }));
  return { query: q, snippets, query_embedding_dim: 256, backend: 'hash-v1', duration_ms: Date.now() - started };
}

api.post('/knowledge/search', (req, res) => {
  const body = req.body || {};
  ok(res, knowledgeSearch(body.query, body.limit || 5, body.min_score || 0));
});

api.get('/knowledge/search', (req, res) => {
  ok(res, knowledgeSearch(req.query?.q, Number(req.query?.limit || 5), Number(req.query?.min_score || 0)));
});

api.get('/knowledge/stats', (_req, res) => {
  const rows = db.prepare('SELECT source, metadata, content FROM knowledge_chunks').all();
  const by_source = {};
  const by_kind = {};
  let total_chars = 0;
  for (const r of rows) {
    by_source[r.source] = (by_source[r.source] || 0) + 1;
    let kind = 'note';
    if (r.metadata) { try { kind = JSON.parse(r.metadata).kind || 'note'; } catch {} }
    by_kind[kind] = (by_kind[kind] || 0) + 1;
    total_chars += String(r.content || '').length;
  }
  ok(res, { total: rows.length, by_source, by_kind, dim: 256, embedding_backend: 'hash-v1', total_chars });
});

api.delete('/knowledge/:id', (req, res) => {
  const r = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?').run(req.params.id);
  ok(res, { deleted: r.changes > 0 });
});

// ---------------------------------------------------------------------
// Search — base locale + annuaires publics (SEC EDGAR)
// ---------------------------------------------------------------------

api.get('/search', (req, res) => {
  const q = String(req.query?.q || '').trim().toLowerCase();
  const limit = Math.min(Number(req.query?.limit || 30), 100);
  if (!q) return ok(res, []);
  const like = `%${q}%`;
  const hits = [];
  const push = (entity, row, title, subtitle) => {
    if (hits.length >= limit) return;
    hits.push({ entity, id: row.id, title, subtitle, score: row.score ?? null, status: row.status ?? null, data: row });
  };

  const companies = db.prepare(`SELECT * FROM companies WHERE name LIKE ? OR sector LIKE ? OR industry LIKE ? OR city LIKE ? OR country LIKE ? OR website LIKE ? OR email LIKE ? ORDER BY score DESC LIMIT ?`).all(like, like, like, like, like, like, like, limit);
  for (const r of companies) push('company', normalizeRow(r), r.name, [r.sector, r.industry, r.city, r.country].filter(Boolean).join(' · ') || null);

  const prospects = db.prepare(`SELECT * FROM prospects WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR role LIKE ? OR sector LIKE ? ORDER BY score DESC LIMIT ?`).all(like, like, like, like, like, limit);
  for (const r of prospects) push('prospect', normalizeRow(r), `${r.first_name} ${r.last_name}`.trim(), [r.role, r.email].filter(Boolean).join(' · ') || null);

  const contacts = db.prepare(`SELECT * FROM contacts WHERE first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR role LIKE ? LIMIT ?`).all(like, like, like, like, limit);
  for (const r of contacts) push('contact', normalizeRow(r), `${r.first_name} ${r.last_name}`.trim(), [r.role, r.email].filter(Boolean).join(' · ') || null);

  const campaigns = db.prepare(`SELECT * FROM campaigns WHERE name LIKE ? OR description LIKE ? LIMIT ?`).all(like, like, limit);
  for (const r of campaigns) push('campaign', normalizeRow(r), r.name, r.description || null);

  ok(res, hits);
});

api.get('/search/external', async (req, res) => {
  const q = String(req.query?.q || '').trim();
  const sources = String(req.query?.sources || '');
  const limit = Math.min(Number(req.query?.limit || 20), 50);
  if (!q) return ok(res, { results: [], errors: [], sources: [] });
  try {
    const r = await MULTI.runSearch(q, { sources, limit, apiKeys: apiKeysConfigObject() });
    ok(res, r);
  } catch (e) {
    ok(res, { results: [], errors: [{ source: 'multi', message: String(e.message) }], sources: [] });
  }
});

api.get('/search/external/status', (_req, res) => ok(res, {
  sources: MULTI.listSources(),
  total_free: MULTI.listSources().filter((s) => s.free).length,
}));

// ---------------------------------------------------------------------
// LinkedIn Live (StaffSpy + MCP vendored) — recherche par niche / besoins
// ---------------------------------------------------------------------

api.get('/search/linkedin/status', async (_req, res) => {
  try {
    ok(res, await LINKEDIN.status());
  } catch (e) {
    ok(res, { ok: false, error: String(e.message) });
  }
});

api.post('/search/linkedin', async (req, res) => {
  const body = req.body || {};
  const company = String(body.company || '').trim();
  const niche = String(body.niche || body.query || body.keywords || '').trim();
  const roles = String(body.roles || body.needs || '').trim();
  const location = String(body.location || '').trim();
  const limit = Math.max(1, Math.min(Number(body.limit || 25), 100));

  if (!niche && !company) {
    return ok(res, { ok: false, available: false, error: 'niche (ou company) requis', results: [] });
  }

  const isStaff = !!company || String(body.mode || '') === 'staff';
  const result = isStaff
    ? await LINKEDIN.searchStaff(company || niche, { roles, location, limit })
    : await LINKEDIN.searchPeople(niche, { roles, location, limit });

  ok(res, {
    ok: !!result.ok,
    available: result.available !== false,
    engine: result.engine || 'staffspy',
    mode: isStaff ? 'staff' : 'people',
    count: (result.leads || []).length,
    error: result.error || null,
    note: result.note || null,
    results: (result.leads || []).map((l) => ({
      name: [l.firstName, l.lastName].filter(Boolean).join(' '),
      firstName: l.firstName,
      lastName: l.lastName,
      company: l.company || null,
      title: l.title || null,
      email: l.email || null,
      phone: l.phone || null,
      location: l.location || null,
      linkedin: l.linkedin || null,
      confidence: l.confidence,
      score: Math.round((l.confidence || 0.5) * 100),
      tags: l.tags || [],
    })),
  });
});

// ---------------------------------------------------------------------
// Zentara One — moteur de recherche unifié (companies + people + local)
// ---------------------------------------------------------------------

api.get('/engine/status', async (_req, res) => {
  try {
    ok(res, await ENGINE.status(apiKeysConfigObject()));
  } catch (e) {
    ok(res, { engine: 'Zentara One', error: String(e.message), groups: [], modes: [] });
  }
});

api.post('/engine/search', async (req, res) => {
  const body = req.body || {};
  const mode = String(body.mode || 'all');
  const hasQuery = Boolean(String(body.query || body.niche || '').trim()) || Boolean(String(body.company || '').trim());
  if (!hasQuery) {
    return ok(res, { engine: 'Zentara One', mode, results: [], total: 0, sources: [], errors: [], companies_created: 0, prospects_created: 0, contacts_created: 0 });
  }

  const r = await ENGINE.search({
    mode,
    query: body.query || body.niche,
    niche: body.niche,
    needs: body.needs,
    roles: body.roles,
    company: body.company,
    location: body.location,
    radius: body.radius,
    limit: body.limit,
    sources: body.sources,
    apiKeys: apiKeysConfigObject(),
  });

  let companies_created = 0;
  let prospects_created = 0;
  let contacts_created = 0;
  const leads = [];
  const save = body.save !== false;

  if (save) {
    for (const hit of r.results) {
      // Entité company : l'entreprise détectée, ou l'employeur d'une personne.
      const companyName = hit.type === 'person' ? (hit.category || null) : hit.name;
      const co = companyName
        ? persistCompany({
            name: companyName,
            sector: hit.category || null,
            city: hit.city || null,
            country: hit.country || null,
            website: hit.website || null,
            score: hit.score,
            need: `${hit.type === 'person' ? 'Décideur' : 'Entreprise'} détecté via ${hit.source} (${hit.sourceGroup})`,
            source: hit.sourceGroup,
          })
        : null;
      if (co?.created) companies_created++;

      const isPerson = hit.type === 'person';
      const parts = String(hit.name || '').split(' ');
      const firstName = isPerson ? (parts[0] || hit.name) : hit.name;
      const lastName = isPerson ? parts.slice(1).join(' ') : '';
      const email = hit.email || null;
      const phone = hit.phone || null;
      const coId = co ? co.id : null;

      if (email || phone) {
        const dup = email
          ? db.prepare('SELECT id FROM prospects WHERE LOWER(email) = LOWER(?) AND company_id = ? LIMIT 1').get(email, coId)
          : db.prepare('SELECT id FROM prospects WHERE phone = ? AND company_id = ? LIMIT 1').get(phone, coId);
        if (!dup) {
          const now = nowIso();
          db.prepare(
            `INSERT INTO prospects (id, company_id, first_name, last_name, email, phone, role, sector, city, country, website, social_profiles, score, status, tags, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
          ).run(
            generateId('pros'), coId, firstName, lastName, email, phone || null,
            hit.title || null, hit.category || null, hit.city || null, hit.country || null,
            hit.website || null, hit.linkedin ? JSON.stringify({ linkedin: hit.linkedin }) : null,
            hit.score, JSON.stringify(hit.tags || []), now, now,
          );
          prospects_created++;
        }
      }

      if (email) {
        const dupC = db.prepare('SELECT id FROM contacts WHERE LOWER(email) = LOWER(?) AND company_id = ? LIMIT 1').get(email, coId);
        if (!dupC) {
          const now = nowIso();
          db.prepare(
            `INSERT INTO contacts (id, company_id, first_name, last_name, role, email, phone, linkedin_url, tags, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            generateId('con'), coId, firstName, lastName, hit.title || null, email, phone || null,
            hit.linkedin || null, JSON.stringify(hit.tags || []), now, now,
          );
          contacts_created++;
        }
      }

      leads.push({ ...hit, company_id: coId, company_created: !!co?.created });
    }
  }

  ok(res, {
    ...r,
    companies_created,
    prospects_created,
    contacts_created,
    results: save ? leads : r.results,
  });
});

// ---------------------------------------------------------------------
// Scrapers additionnels — SMTP verify + Photon OSINT (on-demand)
// ---------------------------------------------------------------------

api.post('/engine/verify-email', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email) return ok(res, { email, syntax: false, deliverable: null, reason: 'email requis', confidence: 0 });
  try {
    ok(res, await SCRAPERS.verifyEmail(email));
  } catch (e) {
    ok(res, { email, syntax: false, deliverable: null, reason: String(e.message), confidence: 0 });
  }
});

api.post('/engine/photon', async (req, res) => {
  const url = String(req.body?.url || req.body?.domain || '').trim();
  if (!url) return ok(res, { ok: false, available: false, error: 'url requis', emails: [], urls: [] });
  try {
    ok(res, await SCRAPERS.photon(url));
  } catch (e) {
    ok(res, { ok: false, available: false, error: String(e.message), emails: [], urls: [] });
  }
});

api.post('/engine/job-email', async (req, res) => {
  const job = req.body?.job || req.body || {};
  try {
    ok(res, await LINKEDIN.generateJobEmail(job, { provider: req.body?.provider, model: req.body?.model }));
  } catch (e) {
    ok(res, { ok: false, error: String(e.message) });
  }
});

api.post('/engine/job-email-sequence', async (req, res) => {
  const job = req.body?.job || req.body || {};
  try {
    ok(res, await LINKEDIN.generateJobEmailSequence(job, { provider: req.body?.provider, model: req.body?.model }));
  } catch (e) {
    ok(res, { ok: false, error: String(e.message), sequence: [] });
  }
});

api.post('/engine/job-save', (req, res) => {
  const j = req.body?.job || req.body || {};
  const title = String(j.title || j.name || '').trim();
  const companyName = String(j.company || j.category || '').trim();
  if (!title && !companyName) return ok(res, { ok: false, saved: false, error: 'offre invalide (title/company requis)' });

  const co = companyName
    ? persistCompany({
        name: companyName,
        sector: j.companyInfo?.industry || j.companyInfo?.sector || null,
        city: j.location || j.city || null,
        country: null,
        website: j.companyInfo?.website || j.website || null,
        score: 75,
        need: j.hiringContext || (Array.isArray(j.needs) && j.needs[0]) || `Recrute : ${title}`,
        source: 'linkedin-mcp-jobs',
      })
    : null;

  const needs = Array.isArray(j.needs) ? j.needs.filter(Boolean) : [];
  const notes = [
    title ? `Poste : ${title}` : null,
    needs.length ? `Besoins détectés :\n${needs.map((n) => '- ' + n).join('\n')}` : null,
    j.hiringContext ? `Contexte de recrutement : ${j.hiringContext}` : null,
    j.linkedin ? `Offre : ${j.linkedin}` : null,
  ].filter(Boolean).join('\n');

  const tags = ['job', 'linkedin', 'hiring'];
  const now = nowIso();
  const id = generateId('pros');
  db.prepare(
    `INSERT INTO prospects (id, company_id, first_name, last_name, email, phone, role, sector, city, country, website, social_profiles, score, status, tags, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)`,
  ).run(
    id,
    co ? co.id : null,
    title || companyName,
    companyName || '(recrutement)',
    null, null,
    title || null,
    j.companyInfo?.industry || j.companyInfo?.sector || null,
    j.location || j.city || null,
    null,
    j.companyInfo?.website || j.website || null,
    j.linkedin ? JSON.stringify({ linkedin: j.linkedin }) : null,
    75,
    JSON.stringify(tags),
    notes,
    now, now,
  );

  ok(res, {
    ok: true,
    saved: true,
    prospect_id: id,
    company_id: co ? co.id : null,
    company_created: !!co?.created,
    title,
    company: companyName,
    needs,
  });
});

api.post('/engine/job-save-draft', (req, res) => {
  const job = req.body?.job || {};
  const emails = Array.isArray(req.body?.emails)
    ? req.body.emails.filter((e) => e && (e.subject || e.body))
    : [];
  if (emails.length === 0) return ok(res, { ok: false, saved: 0, error: 'aucun email à sauvegarder' });

  const companyName = String(job.company || job.category || '').trim();
  const co = companyName
    ? persistCompany({
        name: companyName,
        sector: job.companyInfo?.industry || job.companyInfo?.sector || null,
        city: job.location || job.city || null,
        country: null,
        website: job.companyInfo?.website || null,
        score: 75,
        need: job.hiringContext || (Array.isArray(job.needs) && job.needs[0]) || null,
        source: 'linkedin-mcp-jobs',
      })
    : null;

  const now = nowIso();
  const ids = [];
  for (const e of emails) {
    const id = generateId('eml');
    db.prepare(
      `INSERT INTO emails (id, prospect_id, company_id, subject, body, status, tone, created_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
    ).run(id, req.body?.prospect_id || null, co ? co.id : null, e.subject || '', e.body || '', e.tone || e.step || 'cold', now);
    ids.push(id);
  }

  ok(res, {
    ok: true,
    saved: ids.length,
    ids,
    company_id: co ? co.id : null,
    company_created: !!co?.created,
  });
});

api.post('/search/external/import', (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  let created = 0;
  let skipped = 0;
  const ids = [];
  for (const it of items) {
    const name = String(it?.name || '').trim();
    if (!name) { skipped++; continue; }
    const existing = db.prepare('SELECT id FROM companies WHERE name = ? COLLATE NOCASE').get(name);
    if (existing) { skipped++; continue; }
    const id = generateId('com');
    const now = nowIso();
    db.prepare(
      `INSERT INTO companies (id, name, website, sector, country, status, score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'new', 0, ?, ?)`,
    ).run(id, name, it.url || null, null, it.jurisdiction || it.country || null, now, now);
    ids.push(id);
    created++;
  }
  ok(res, { created, skipped, ids });
});

api.get('/outreach/company/:id', (req, res) => {
  const companyId = req.params.id;
  const emails = db.prepare('SELECT * FROM emails WHERE company_id = ?').all(companyId);

  ok(res, {
    company_id: companyId,
    emails: emails.map((r) => normalizeRow(r)),
    sequences: [],
    total_emails: emails.length,
    total_sent: emails.filter((e) => e.status === 'sent').length,
    total_replied: emails.filter((e) => e.status === 'replied').length,
    total_bounced: emails.filter((e) => e.status === 'bounced').length,
    total_active_sequences: 0,
  });
});
api.get('/outreach/timeline/:prospectId', (req, res) => ok(res, { prospect_id: req.params.prospectId, emails: [], current_sequence: null }));
api.get('/outreach/inbox', (_req, res) => {
  const rows = db.prepare('SELECT * FROM emails ORDER BY created_at DESC LIMIT 200').all();
  ok(res, rows.map((r) => normalizeRow(r)));
});
api.get('/outreach/emails/:id', (req, res) => {
  const row = getById('emails', req.params.id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'email not found');
  ok(res, row);
});
api.patch('/outreach/emails/:id', (req, res) => {
  const existing = getById('emails', req.params.id);
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'email not found');
  const body = req.body || {};
  const keys = ['subject', 'body', 'status', 'tone'].filter((k) => k in body && body[k] !== undefined);
  if (keys.length === 0) return ok(res, existing);
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE emails SET ${setClause} WHERE id = ?`).run(...keys.map((k) => body[k]), req.params.id);
  ok(res, getById('emails', req.params.id));
});
// Réécriture d'un email par l'IA (HTML/CSS ou texte), sans persister :
// l'utilisateur prévisualise puis Enregistre via PATCH s'il valide.
api.post('/outreach/emails/:id/rewrite', async (req, res) => {
  const existing = getById('emails', req.params.id);
  if (!existing) return fail(res, 404, 'NOT_FOUND', 'email not found');
  const body = req.body || {};
  const instruction = String(body.instruction || '').trim();
  const format = String(body.format || 'html').toLowerCase() === 'text' ? 'text' : 'html';
  if (!instruction) return fail(res, 422, 'VALIDATION', 'instruction required');

  const prompt = `Tu es un expert en rédaction d'emails de prospection B2B. ` +
    `Modifie cet email selon l'instruction donnée, en conservant la personnalisation ` +
    `(nom, entreprise, contexte) et le sens général.\n\n` +
    `EMAIL ACTUEL :\nSujet : ${existing.subject || ''}\nCorps : ${existing.body || ''}\n\n` +
    `INSTRUCTION : ${instruction}\n` +
    `FORMAT DE SORTIE : ${format === 'html' ? 'HTML/CSS inline (structure claire, un bouton CTA, signature)' : 'texte brut (aucune balise HTML)'}\n\n` +
    `Réponds UNIQUEMENT en JSON valide, sans texte autour :\n` +
    `{"subject":"...","body":"..."}`;

  try {
    const r = await ai.chatCompletion(
      [{ role: 'user', content: prompt }],
      { provider: body.provider || undefined, model: body.model || undefined, maxTokens: 3000, json: true },
    );
    const p = ai.extractJson(r.content);
    if (!p || !p.subject || !p.body) throw new Error('Réponse IA invalide (JSON attendu non reçu)');
    ok(res, {
      subject: String(p.subject),
      body: String(p.body),
      format,
      provider: r.provider,
      model: r.model,
      fallback: r.fallback,
    });
  } catch (e) {
    return fail(res, 502, 'AI_ERROR', `Réécriture échouée : ${e.message}`);
  }
});

api.delete('/outreach/emails/:id', (req, res) => {
  db.prepare('DELETE FROM emails WHERE id = ?').run(req.params.id);
  ok(res, { deleted: true });
});

// Analyse heuristique d'un prospect (problèmes + revenus perdus) → pré-remplit
// le mail structuré dans EmailComposerModal (sans provider IA).
api.post('/outreach/analyze-prospect/:id', (req, res) => {
  const p = getById('prospects', req.params.id);
  if (!p) return fail(res, 404, 'NOT_FOUND', 'prospect not found');
  const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'ce prospect';
  let company = null;
  if (p.company_id) company = getById('companies', p.company_id)?.name || null;
  if (!company) company = p.website || p.sector || null;

  const problems = [];
  if (!p.email) {
    problems.push({ title: 'Email décisionnel manquant', detail: 'Aucun email direct en base pour ce prospect.', evidence: 'Champ email vide sur la fiche prospect.', revenue_lost_hint: 'Impossible de lancer l\'outreach → leads jamais contactés.' });
  }
  if (!p.phone) {
    problems.push({ title: 'Téléphone non identifié', detail: 'Aucun numéro direct capturé.', evidence: 'Champ phone vide.', revenue_lost_hint: 'Relances téléphoniques impossibles → cycle de vente allongé.' });
  }
  if ((p.score ?? 0) < 50) {
    problems.push({ title: 'Score de qualification faible', detail: 'Le prospect est classé basse priorité.', evidence: `Score ${p.score ?? 0}/100.`, revenue_lost_hint: 'Risque de passer du temps sur un compte non qualifié.' });
  }
  if (!p.company_id) {
    problems.push({ title: 'Entreprise non rattachée', detail: 'Le prospect n\'est lié à aucune company.', evidence: 'company_id vide.', revenue_lost_hint: 'Contexte commercial manquant pour personnaliser l\'approche.' });
  }
  if (problems.length === 0) {
    problems.push({ title: 'Veille externe absente', detail: 'Aucun signal public capté pour ce compte.', evidence: 'Aucune entrée monitoring.', revenue_lost_hint: 'Mouvements concurrents non détectés → décisions retardées.' });
  }

  const sector = p.sector || company || 'votre marché';
  ok(res, {
    problems,
    revenue_lost_summary: `${problems.length} problème(s) identifié(s) sur la fiche de ${name} — autant de points de friction qui retardent ou bloquent la conversion.`,
    suggested_subject: `${company || p.first_name || 'Compte'} — ${sector} : un point rapide ?`,
    suggested_sections: {
      problem: `${problems[0].title} : ${problems[0].detail}`,
      impact: `Impact : ${problems[0].revenue_lost_hint}`,
      solution: `Zentara automatise la collecte, la qualification et la veille pour combler ce manque sans effort manuel.`,
      cta: `Seriez-vous disponible 10 minutes cette semaine pour un échange ?`,
    },
    source: 'heuristic',
  });
});

// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Enrichissement email automatique (permutator + vérification MX)
// ---------------------------------------------------------------------

function safeQuality(q) {
  if (q && typeof q === 'object') return { email_validity: 0, phone_reachability: 0, decision_maker: 0, overall: 0, ...q };
  try {
    return { email_validity: 0, phone_reachability: 0, decision_maker: 0, overall: 0, ...JSON.parse(q || '{}') };
  } catch {
    return { email_validity: 0, phone_reachability: 0, decision_maker: 0, overall: 0 };
  }
}

api.post('/prospects/:id/enrich-email', async (req, res) => {
  const prospect = getById('prospects', req.params.id);
  if (!prospect) return fail(res, 404, 'NOT_FOUND', 'prospect not found');
  const company = prospect.company_id ? getById('companies', prospect.company_id) : null;
  const r = await ENRICH.enrichEmail({
    firstName: prospect.first_name,
    lastName: prospect.last_name,
    website: prospect.website,
    companyWebsite: company && company.website,
  });
  let updated = false;
  if (r.email && r.has_mx) {
    const dup = db
      .prepare('SELECT id FROM prospects WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1')
      .get(r.email, prospect.id);
    if (!dup) {
      const q = safeQuality(prospect.quality);
      q.email_validity = Math.max(Number(q.email_validity) || 0, r.role_based ? 45 : 80);
      q.overall = Math.round(((Number(q.email_validity) || 0) + (Number(q.phone_reachability) || 0) + (Number(q.decision_maker) || 0)) / 3);
      const note = `Email enrichi automatiquement (pattern ${r.pattern || '?'} · MX confirmé · confiance ${r.score}%) — ${r.reason}.`;
      db.prepare(
        `UPDATE prospects SET email = ?, quality = ?, notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END, updated_at = ? WHERE id = ?`,
      ).run(r.email, JSON.stringify(q), note, note, nowIso(), prospect.id);
      updated = true;
    }
  }
  ok(res, { ...r, updated, prospect_id: prospect.id, previous_email: prospect.email || null });
});

api.post('/enrichment/emails/run', async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.body?.limit || 20), 100));
  const targets = db
    .prepare(`SELECT * FROM prospects WHERE (email IS NULL OR email = '') ORDER BY score DESC, created_at DESC LIMIT ?`)
    .all(limit);
  if (targets.length === 0) return ok(res, { processed: 0, enriched: 0, results: [] });
  const mapped = targets.map((p) => ({
    ...p,
    firstName: p.first_name,
    lastName: p.last_name,
    website: p.website,
    companyWebsite: p.company_id ? getById('companies', p.company_id)?.website : null,
  }));
  const results = await ENRICH.enrichBatch(mapped, { limit });
  let enriched = 0;
  for (const r of results) {
    const e = r.enrichment || {};
    if (e.email && e.has_mx) {
      const dup = db
        .prepare('SELECT id FROM prospects WHERE LOWER(email) = LOWER(?) AND id != ? LIMIT 1')
        .get(e.email, r.id);
      if (!dup) {
        const q = safeQuality(r.quality);
        q.email_validity = Math.max(Number(q.email_validity) || 0, e.role_based ? 45 : 80);
        q.overall = Math.round(((Number(q.email_validity) || 0) + (Number(q.phone_reachability) || 0) + (Number(q.decision_maker) || 0)) / 3);
        const note = `Email enrichi automatiquement (pattern ${e.pattern || '?'} · MX confirmé · confiance ${e.score}%) — ${e.reason}.`;
        db.prepare(
          `UPDATE prospects SET email = ?, quality = ?, notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END, updated_at = ? WHERE id = ?`,
        ).run(e.email, JSON.stringify(q), note, note, nowIso(), r.id);
        enriched++;
      }
    }
  }
  ok(res, {
    processed: results.length,
    enriched,
    results: results.map((r) => ({
      id: r.id,
      name: `${r.first_name || ''} ${r.last_name || ''}`.trim(),
      email: r.enrichment?.email || null,
      pattern: r.enrichment?.pattern || null,
      score: r.enrichment?.score || 0,
      has_mx: !!r.enrichment?.has_mx,
      reason: r.enrichment?.reason || null,
    })),
  });
});

api.get('/enrichment/emails/status', (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM prospects').get().c;
  const missing = db.prepare("SELECT COUNT(*) c FROM prospects WHERE email IS NULL OR email = ''").get().c;
  const eligible = db
    .prepare(
      `SELECT COUNT(*) c FROM prospects p LEFT JOIN companies c ON c.id = p.company_id
       WHERE (p.email IS NULL OR p.email = '') AND (p.website IS NOT NULL OR c.website IS NOT NULL)`,
    )
    .get().c;
  ok(res, { total, missing_email: missing, eligible });
});

// Integrations (outreach config + envoi via Apps Script)
// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// Clés tierces optionnelles (Google Places, SerpAPI, Outscraper, OpenCorporates)
// Stockées dans app_settings (masquées à l'affichage), fallback env.
// ---------------------------------------------------------------------
const API_KEY_META = {
  gemini: { label: 'Gemini (Google AI)', env: 'GEMINI_API_KEY' },
  openrouter: { label: 'OpenRouter', env: 'OPENROUTER_API_KEY' },
  mistral: { label: 'Mistral', env: 'MISTRAL_API_KEY' },
  nvidia: { label: 'NVIDIA NIM', env: 'NVIDIA_API_KEY' },
  google_places: { label: 'Google Places API', env: 'GOOGLE_MAPS_API_KEY' },
  serpapi: { label: 'SerpAPI', env: 'SERPAPI_KEY' },
  outscraper: { label: 'Outscraper', env: 'OUTSCRAPER_API_KEY' },
  opencorporates: { label: 'OpenCorporates', env: 'OPENCORPORATES_API_KEY' },
};

function apiKeyValue(key) {
  const stored = getSetting('api_keys') || {};
  const meta = API_KEY_META[key];
  return stored[key] || (meta && process.env[meta.env]) || '';
}

function apiKeysConfig() {
  const stored = getSetting('api_keys') || {};
  return Object.entries(API_KEY_META).map(([key, meta]) => {
    const val = stored[key] || process.env[meta.env] || '';
    return {
      key,
      label: meta.label,
      configured: !!val,
      masked: val ? `••••${val.slice(-4)}` : null,
      has_env: !!process.env[meta.env],
    };
  });
}

/** Mapping brut clé → valeur (settings runtime puis env) pour les moteurs externes. */
function apiKeysConfigObject() {
  const stored = getSetting('api_keys') || {};
  const out = {};
  for (const key of Object.keys(API_KEY_META)) {
    const meta = API_KEY_META[key];
    out[key] = stored[key] || process.env[meta.env] || '';
  }
  return out;
}

api.get('/settings/api-keys', (_req, res) => ok(res, { keys: apiKeysConfig() }));

api.put('/settings/api-keys/:key', (req, res) => {
  const key = String(req.params.key || '');
  if (!API_KEY_META[key]) return fail(res, 400, 'UNKNOWN_KEY', 'Clé inconnue : ' + key);
  const value = String(req.body?.value || '').trim();
  const stored = getSetting('api_keys') || {};
  if (value) stored[key] = value;
  else delete stored[key];
  setSetting('api_keys', stored);
  applyRuntimeSettingsToEnv();
  ok(res, { keys: apiKeysConfig() });
});

api.delete('/settings/api-keys/:key', (req, res) => {
  const key = String(req.params.key || '');
  const stored = getSetting('api_keys') || {};
  delete stored[key];
  setSetting('api_keys', stored);
  applyRuntimeSettingsToEnv();
  ok(res, { keys: apiKeysConfig() });
});

api.get('/settings/linkedin', (_req, res) => {
  const li = getSetting('linkedin') || {};
  ok(res, {
    username: li.username || '',
    password_set: !!li.password,
    session_file: li.session_file || '',
    has_env_username: !!process.env.LINKEDIN_USERNAME,
    has_env_password: !!process.env.LINKEDIN_PASSWORD,
  });
});

api.put('/settings/linkedin', (req, res) => {
  const body = req.body || {};
  const li = getSetting('linkedin') || {};
  if (body.username !== undefined) li.username = String(body.username || '').trim();
  if (body.password !== undefined) {
    const p = String(body.password || '');
    if (p) li.password = p;
    else delete li.password;
  }
  if (body.session_file !== undefined) li.session_file = String(body.session_file || '').trim();
  setSetting('linkedin', li);
  applyRuntimeSettingsToEnv();
  ok(res, { username: li.username || '', password_set: !!li.password, session_file: li.session_file || '' });
});

api.delete('/settings/linkedin', (_req, res) => {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run('linkedin');
  applyRuntimeSettingsToEnv();
  ok(res, { username: '', password_set: false, session_file: '' });
});

function getSetting(key) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  if (!row || row.value === null || row.value === undefined) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), nowIso());
}

/** Injecte les clés/identifiants stockés en réglages dans process.env (priorité réglage > .env). */
function applyRuntimeSettingsToEnv() {
  const stored = getSetting('api_keys') || {};
  for (const key of Object.keys(API_KEY_META)) {
    const meta = API_KEY_META[key];
    const base = ORIGINAL_ENV[meta.env] || '';
    if (stored[key]) process.env[meta.env] = String(stored[key]);
    else if (base) process.env[meta.env] = base;
    else delete process.env[meta.env];
  }
  const li = getSetting('linkedin') || {};
  const liPairs = [
    ['LINKEDIN_USERNAME', li.username],
    ['LINKEDIN_PASSWORD', li.password],
    ['LINKEDIN_SESSION_FILE', li.session_file],
  ];
  for (const [envKey, val] of liPairs) {
    const base = ORIGINAL_ENV[envKey] || '';
    if (val) process.env[envKey] = String(val);
    else if (base) process.env[envKey] = base;
    else delete process.env[envKey];
  }
  try { LINKEDIN.configure({ username: li.username || null, password: li.password || null, session_file: li.session_file || null }); } catch { /* ignore */ }
}

async function callAppScript(url, payload, timeoutMs = 20_000) {
  if (!url || !String(url).startsWith('http')) return { status: 0, ok: false, body: '', data: null, error: 'Apps Script non configurée' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, ok: res.status >= 200 && res.status < 400, body: text.slice(0, 600), data, error: null };
  } catch (e) {
    return { status: 0, ok: false, body: '', data: null, error: e && e.name === 'AbortError' ? 'Timeout Apps Script (' + Math.round(timeoutMs / 1000) + 's)' : String((e && e.message) || e) };
  }
}

const SYNCABLE_TABLES = ['companies', 'prospects', 'contacts', 'campaigns', 'emails', 'contracts', 'monitoring', 'intelligence', 'tasks'];

function sheetsConfig() {
  const cfg = getSetting('sheets') || {};
  return {
    key: 'sheets',
    apps_script_url: cfg.apps_script_url || null,
    enabled: cfg.enabled !== false,
    sync_targets: Array.isArray(cfg.sync_targets) ? cfg.sync_targets : [],
    last_sync_at: cfg.last_sync_at || null,
    last_sync_status: cfg.last_sync_status || null,
    last_sync_log: cfg.last_sync_log || null,
  };
}

api.get('/integrations', (_req, res) => ok(res, { integrations: [sheetsConfig()], syncable_tables: SYNCABLE_TABLES }));

api.get('/integrations/outreach', (_req, res) => ok(res, {
  ...{ cta_calendar_url: null, sender_name: 'Zentara', sender_email: null, reply_to: null },
  ...(getSetting('outreach') || {}),
}));

api.put('/integrations/outreach', (req, res) => {
  const body = req.body || {};
  const next = {
    cta_calendar_url: body.cta_calendar_url || null,
    sender_name: body.sender_name || 'Zentara',
    sender_email: body.sender_email || null,
    reply_to: body.reply_to || null,
  };
  setSetting('outreach', next);
  ok(res, next);
});

api.delete('/integrations/outreach', (_req, res) => {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run('outreach');
  ok(res, { cta_calendar_url: null, sender_name: 'Zentara', sender_email: null, reply_to: null });
});

api.put('/integrations/sheets', (req, res) => {
  const body = req.body || {};
  const cfg = {
    apps_script_url: body.apps_script_url || null,
    enabled: body.enabled !== false,
    sync_targets: Array.isArray(body.sync_targets) ? body.sync_targets : [],
  };
  setSetting('sheets', cfg);
  ok(res, sheetsConfig());
});

api.delete('/integrations/sheets', (_req, res) => {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run('sheets');
  ok(res, sheetsConfig());
});

api.post('/integrations/sheets/test', async (_req, res) => {
  const cfg = sheetsConfig();
  if (!cfg.apps_script_url) return ok(res, { ok: false, http_status: null, response_excerpt: null, error: 'Aucune URL Apps Script configurée.' });
  const r = await callAppScript(cfg.apps_script_url, { action: 'ping' });
  // Tolérant : le ping est OK si le script répond avec une spreadsheet_id sans erreur
  // (certaines versions anciennes du script n'exposent pas ok:true au ping).
  const d = r.data || {};
  const good = r.ok && (d.ok === true || (d.spreadsheet_id && !d.error));
  ok(res, {
    ok: good,
    http_status: r.status || null,
    response_excerpt: r.data ? JSON.stringify(r.data).slice(0, 200) : (r.body || null),
    error: good ? null : (r.error || (d.error) || 'Apps Script a refusé (HTTP ' + r.status + ')'),
  });
});

api.post('/integrations/sheets/sync', async (req, res) => {
  const cfg = sheetsConfig();
  if (!cfg.apps_script_url) return ok(res, { ok: false, rows: 0, tables: [], http_status: null, error: 'Apps Script non configuré.' });
  const targets = cfg.sync_targets.length > 0 ? cfg.sync_targets : SYNCABLE_TABLES;
  const tables = {};
  let totalRows = 0;
  for (const t of targets) {
    const rows = db.prepare(`SELECT * FROM ${t} ORDER BY created_at DESC LIMIT 200`).all().map((r) => normalizeRow(r));
    if (rows.length) { tables[t] = rows; totalRows += rows.length; }
  }
  if (totalRows === 0) return ok(res, { ok: true, rows: 0, tables: [], http_status: null, error: null });
  const r = await callAppScript(cfg.apps_script_url, { action: 'sync', tables, body: req.body?.note || null }, 90_000);
  const good = r.ok && !!(r.data && r.data.ok !== false);
  setSetting('sheets', {
    ...cfg,
    last_sync_at: nowIso(),
    last_sync_status: good ? 'ok' : 'error',
    last_sync_log: good ? 'Sync terminé : ' + totalRows + ' lignes.' : ('Sync refusé : ' + ((r.data && r.data.error) || r.error || 'HTTP ' + r.status)),
  });
  ok(res, {
    ok: good,
    rows: totalRows,
    tables: Object.keys(tables),
    http_status: r.status || null,
    error: good ? null : ((r.data && r.data.error) || r.error || 'Apps Script a refusé (HTTP ' + r.status + ')'),
  });
});

api.post('/integrations/sheets/send-email', async (req, res) => {
  const cfg = sheetsConfig();
  if (!cfg.apps_script_url || !cfg.enabled) {
    return ok(res, { ok: false, error: "Apps Script non configuré — ajoute l'URL et active la sync dans Réglages → Sheets Sync." });
  }
  const body = req.body || {};
  const r = await callAppScript(cfg.apps_script_url, {
    action: 'email-send',
    to: body.to || body.recipient || null,
    subject: body.subject || null,
    html: body.html || body.body || null,
    cc: body.cc || null,
    bcc: body.bcc || null,
    replyTo: body.replyTo || body.reply_to || null,
    tone: body.tone || null,
    track_open: !!body.track_open,
    entity_id: body.email_id || body.entity_id || null,
    prospect_id: body.prospect_id || null,
    company_id: body.company_id || null,
  });
  const good = r.ok && !!(r.data && r.data.ok !== false);
  if (good && body.email_id) {
    db.prepare("UPDATE emails SET status = 'sent', sent_at = ? WHERE id = ?").run(nowIso(), body.email_id);
  }
  ok(res, {
    ok: good,
    error: good ? null : ((r.data && r.data.error) || r.error || 'Apps Script a refusé (HTTP ' + r.status + ')'),
    message_id: good && r.data ? r.data.message_id || null : null,
  });
});

api.post('/integrations/sheets/calendar-event', async (req, res) => {
  const cfg = sheetsConfig();
  if (!cfg.apps_script_url || !cfg.enabled) {
    return ok(res, { ok: false, error: "Apps Script non configuré — Réglages → Sheets Sync." });
  }
  const b = req.body || {};
  const r = await callAppScript(cfg.apps_script_url, {
    action: 'calendar-event',
    title: b.title || 'RDV Zentara',
    start: b.start || null,
    end: b.end || null,
    description: b.description || null,
    location: b.location || null,
    attendees: b.attendees || null,
  }, 30000);
  const good = r.ok && !!(r.data && r.data.ok !== false);
  ok(res, {
    ok: good,
    error: good ? null : ((r.data && r.data.error) || r.error || 'Apps Script a refusé (HTTP ' + r.status + ')'),
    event_id: good && r.data ? r.data.event_id || null : null,
    url: good && r.data ? r.data.url || null : null,
    calendar_id: good && r.data ? r.data.calendar_id || null : null,
  });
});

api.post('/integrations/sheets/document', async (req, res) => {
  const cfg = sheetsConfig();
  if (!cfg.apps_script_url || !cfg.enabled) {
    return ok(res, { ok: false, error: "Apps Script non configuré — Réglages → Sheets Sync." });
  }
  const b = req.body || {};
  const r = await callAppScript(cfg.apps_script_url, {
    action: 'contract',
    title: b.title || 'Document Zentara',
    markdown: b.markdown || b.body || b.content || null,
    email_to: b.email_to || null,
  }, 45000);
  const good = r.ok && !!(r.data && r.data.ok !== false);
  ok(res, {
    ok: good,
    error: good ? null : ((r.data && r.data.error) || r.error || 'Apps Script a refusé (HTTP ' + r.status + ')'),
    doc_id: good && r.data ? r.data.doc_id || null : null,
    url: good && r.data ? r.data.url || null : null,
    pdf_url: good && r.data ? r.data.pdf_url || null : null,
    sent_to: good && r.data ? r.data.sent_to || null : null,
  });
});

api.post('/integrations/sheets/train', async (req, res) => {
  const cfg = sheetsConfig();
  if (!cfg.apps_script_url || !cfg.enabled) {
    return ok(res, { ok: false, error: "Apps Script non configuré — Réglages → Sheets Sync." });
  }
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return ok(res, { ok: false, error: 'items requis (au moins un enregistrement prompt/output).' });
  const r = await callAppScript(cfg.apps_script_url, { action: 'train', items }, 45000);
  const good = r.ok && !!(r.data && r.data.ok !== false);
  ok(res, {
    ok: good,
    error: good ? null : ((r.data && r.data.error) || r.error || 'Apps Script a refusé (HTTP ' + r.status + ')'),
    rows: good && r.data ? r.data.rows || items.length : 0,
  });
});
api.post('/outreach/draft', async (req, res) => {
  const body = req.body || {};
  const pid = String(body.prospect_id || '');
  const p = getById('prospects', pid);
  if (!p) return fail(res, 404, 'NOT_FOUND', 'prospect not found');

  const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'décideur';
  let company = p.company_id ? getById('companies', p.company_id)?.name || null : null;
  if (!company) company = p.website || p.sector || 'votre entreprise';
  const tone = String(body.tone || 'all');
  const context = String(body.context || '').trim();

  const prompt = `Tu es un expert en prospection B2B outbound. Rédige un email de vente personnalisé, ` +
    `en HTML/CSS inline (couleurs sobres, responsive, bouton CTA), pour ce prospect :\n` +
    `- Prospect : ${name}\n- Entreprise : ${company}\n- Secteur : ${p.sector || 'inconnu'}\n` +
    `- Rôle : ${p.role || 'inconnu'}\n${context ? `- Contexte : ${context}\n` : ''}` +
    `\nTon objectif : proposer Zentara, une couche d'intelligence stratégique qui surveille en continu ` +
    `l'environnement externe de l'entreprise, transforme des données fragmentées en signaux vérifiés, ` +
    `et fournit des recommandations actionnables aux décideurs.\n` +
    `\nRÈGLES :\n` +
    `- Réponds UNIQUEMENT en JSON valide, sans texte autour.\n` +
    `- Le corps (body) doit être du HTML/CSS inline valide, avec une structure claire :\n` +
    `  accroche personnalisée, 1-2 paragraphes, 1 bouton CTA (lien ${'https://calendly.com/zentara-demo'}), signature.\n` +
    `- Subject : court et personnalisé (max 60 caractères).\n` +
    `\nFormat JSON attendu :\n` +
    `{"drafts":[{"subject":"...","body":"<html>...</html>","personalization_score":85,"rationale":"...","call_to_action":"...","warnings":[],"recommended_next_step":"cold"}]}`;

  try {
    const r = await ai.chatCompletion(
      [{ role: 'user', content: prompt }],
      { provider: body.provider || undefined, model: body.model || undefined, maxTokens: 3000, json: true },
    );
    const parsed = ai.extractJson(r.content);
    const drafts = Array.isArray(parsed?.drafts) ? parsed.drafts : [];
    if (drafts.length === 0) throw new Error('Réponse IA invalide (aucun draft)');

    const persisted = [];
    for (const d of drafts) {
      const id = generateId('eml');
      const now = nowIso();
      db.prepare(
        `INSERT INTO emails (id, prospect_id, company_id, subject, body, status, tone, created_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)`,
      ).run(id, pid, p.company_id || null, d.subject || '', d.body || '', tone === 'all' ? 'cold' : tone, now);
      persisted.push({
        id,
        prospect_id: pid,
        company_id: p.company_id || null,
        tone: tone === 'all' ? 'cold' : tone,
        subject: d.subject || '',
        body: d.body || '',
        status: 'draft',
        sent_at: null,
        replied_at: null,
        next_action_at: null,
        provider: r.provider,
        model: r.model,
        prompt_version: 'ai-v1',
        metadata: null,
        created_at: now,
        updated_at: now,
      });
    }

    ok(res, {
      drafts: drafts.map((d) => ({
        subject: d.subject || '',
        body: d.body || '',
        personalization_score: Number(d.personalization_score || 0),
        rationale: d.rationale || '',
        call_to_action: d.call_to_action || '',
        warnings: Array.isArray(d.warnings) ? d.warnings : [],
        recommended_next_step: d.recommended_next_step || 'cold',
      })),
      persisted,
    });
  } catch (e) {
    return fail(res, 502, 'AI_ERROR', `Génération email échouée : ${e.message}`);
  }
});
api.post('/outreach/send', (_req, res) => ok(res, { sent: true }));
api.post('/outreach/respond', (_req, res) => ok(res, { responded: true }));

api.get('/chat/status', (req, res) => {
  const requested = String(req.query.provider || '').toLowerCase();
  const provider = ai.resolveProvider(requested || undefined) || 'nvidia';
  ok(res, {
    provider,
    configured: Boolean(ai.resolveProvider(provider)),
    model: ai.DEFAULT_MODEL,
    models: ai.modelsFor(provider),
    providers: ai.providers(),
  });
});

api.get('/chat/messages', (req, res) => {
  const sessionId = String(req.query.session_id || 'default');
  const limit = Math.min(Number(req.query.limit || 200), 500);
  const rows = db
    .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?')
    .all(sessionId, limit);
  ok(res, rows.map((r) => ({
    id: r.id,
    session_id: r.session_id,
    kind: r.kind,
    content: r.content,
    metadata: r.metadata,
    created_at: r.created_at,
  })));
});

api.delete('/chat/messages', (req, res) => {
  const sessionId = String(req.query.session_id || 'default');
  const info = db.prepare('DELETE FROM chat_messages WHERE session_id = ?').run(sessionId);
  ok(res, { deleted: Number(info.changes || 0), session_id: sessionId });
});

api.post('/chat/send', async (req, res) => {
  const body = req.body || {};
  const content = String(body.content || '').trim();
  if (!content) return fail(res, 422, 'VALIDATION', 'content required');
  const sessionId = String(body.session_id || 'default');

  const userMsg = {
    id: generateId('msg'),
    session_id: sessionId,
    kind: 'user',
    content,
    metadata: null,
    created_at: nowIso(),
  };
  db.prepare(
    'INSERT INTO chat_messages (id, session_id, kind, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(userMsg.id, sessionId, userMsg.kind, userMsg.content, null, userMsg.created_at);

  // Récupère les ~12 derniers messages pour le contexte conversationnel.
  const history = db
    .prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 12')
    .all(sessionId)
    .reverse();

  const system = `Tu es Zentara, un assistant d'intelligence stratégique et de prospection B2B. ` +
    `Tu réponds en français, de façon claire, structurée et actionnable. ` +
    `Tu es honnête : tu distingues les faits vérifiés des inférences. ` +
    `Tu aides à structurer des campagnes de prospection, analyser des entreprises, ` +
    `rédiger des emails, scorer des prospects et surveiller la concurrence.`;

  const messages = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.kind === 'user' ? 'user' : 'assistant', content: m.content })),
  ];

  try {
    const r = await ai.chatCompletion(messages, {
      provider: body.provider || undefined,
      model: body.model || undefined,
      maxTokens: 1500,
    });
    const assistantMsg = {
      id: generateId('msg'),
      session_id: sessionId,
      kind: 'assistant',
      content: r.content,
      metadata: JSON.stringify({ provider: r.provider, model: r.model, latencyMs: r.latencyMs }),
      created_at: nowIso(),
    };
    db.prepare(
      'INSERT INTO chat_messages (id, session_id, kind, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(assistantMsg.id, sessionId, assistantMsg.kind, assistantMsg.content, assistantMsg.metadata, assistantMsg.created_at);
    ok(res, { user_message: userMsg, assistant_message: assistantMsg });
  } catch (e) {
    const errMsg = `Erreur IA (${e.code || 'AI_ERROR'}): ${e.message}`;
    const assistantMsg = {
      id: generateId('msg'),
      session_id: sessionId,
      kind: 'assistant',
      content: errMsg,
      metadata: JSON.stringify({ error: String(e.message) }),
      created_at: nowIso(),
    };
    db.prepare(
      'INSERT INTO chat_messages (id, session_id, kind, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(assistantMsg.id, sessionId, assistantMsg.kind, assistantMsg.content, assistantMsg.metadata, assistantMsg.created_at);
    ok(res, { user_message: userMsg, assistant_message: assistantMsg });
  }
});

// ---------------------------------------------------------------------
// Contracts — AI-generated (NDA / QUOTE / TOS)
// ---------------------------------------------------------------------

const ZENTARA_PRODUCTS = [
  {
    key: 'intelligence-core',
    name: 'Zentara Intelligence Core',
    description: 'Veille stratégique continue, signaux vérifiés et briefings exécutifs.',
    monthly_price_eur: 490,
    commitment_months: 12,
    included_modules: ['Competitive Intelligence', 'Market Intelligence', 'Executive Briefing'],
  },
  {
    key: 'intelligence-pro',
    name: 'Zentara Intelligence Pro',
    description: 'Core + prospection outbound + emails IA + contrats + monitoring multi-source.',
    monthly_price_eur: 990,
    commitment_months: 12,
    included_modules: ['Core', 'Prospecting Engine', 'Outreach IA', 'Monitoring multi-source'],
  },
  {
    key: 'enterprise',
    name: 'Zentara Enterprise',
    description: 'Déploiement dédié, architecture multi-agents, intégrations sur mesure et SLA.',
    monthly_price_eur: 2900,
    commitment_months: 24,
    included_modules: ['Pro', 'Multi-agents', 'Intégrations sur mesure', 'Support dédié'],
  },
];

function productByKey(key) {
  return ZENTARA_PRODUCTS.find((p) => p.key === key) || null;
}

function partyA() {
  const u = db.prepare('SELECT name, email FROM users ORDER BY created_at ASC LIMIT 1').get();
  return { name: (u && u.name) || 'Zentara', email: (u && u.email) || '' };
}

function toContract(row) {
  if (!row) return null;
  const out = normalizeRow(row);
  if (out.variables) {
    try { out.variables = JSON.parse(out.variables); } catch { out.variables = null; }
  } else {
    out.variables = null;
  }
  return out;
}

function contractPrompt(type, ctx) {
  const a = ctx.party_a_name;
  const b = ctx.party_b_name;
  const email = ctx.party_b_email || '—';
  const p = ctx.product;
  const context = ctx.context ? ('\nContexte supplémentaire : ' + ctx.context) : '';

  if (type === 'NDA') {
    return 'Tu es un juriste expert. Rédige un Accord de Confidentialité (NDA) mutuel, en Markdown, ' +
      'en français, entre « ' + a + ' » (Partie A, prestataire Zentara) et « ' + b + ' » (Partie B, client, email ' + email + ').' +
      context +
      '\nInclus : objet (échange d\'informations confidentielles dans le cadre d\'une collaboration ' +
      'd\'intelligence stratégique), définitions, obligations des parties, durée (24 mois), exclusions, ' +
      'restitution/destruction, droit applicable (France).' +
      '\nRéponds UNIQUEMENT en JSON valide : {\'title\':\'...\',\'body\':\'...markdown...\'}.';
  }
  if (type === 'QUOTE') {
    const prod = p ? (p.name + ' — ' + p.monthly_price_eur + '€/mois, engagement ' + p.commitment_months + ' mois') : 'produit Zentara';
    return 'Tu es un commercial expert. Rédige une Proposition Commerciale (QUOTE), en Markdown, en français, ' +
      'de Zentara (Partie A : ' + a + ') à « ' + b + ' » (Partie B, email ' + email + ').' +
      context +
      '\nProduit proposé : ' + prod + ' — modules inclus : ' + (p ? p.included_modules.join(', ') : 'à préciser') + '.' +
      '\nInclus : résumé du besoin, périmètre, tarification, engagement, modalités, prochaines étapes et un espace signature.' +
      '\nRéponds UNIQUEMENT en JSON valide : {\'title\':\'...\',\'body\':\'...markdown...\'}.';
  }
  // TOS
  const prodName = p ? p.name : 'Zentara';
  return 'Tu es un juriste expert. Rédige des Conditions Générales d\'Utilisation (TOS), en Markdown, en français, ' +
    'pour le produit « ' + prodName + ' » de Zentara (éditeur : ' + a + '), destinées à « ' + b + ' » (email ' + email + ').' +
    context +
    '\nInclus : objet, accès au service, obligations des utilisateurs, propriété intellectuelle, ' +
    'confidentialité, responsabilité, résiliation, droit applicable (France).' +
    '\nRéponds UNIQUEMENT en JSON valide : {\'title\':\'...\',\'body\':\'...markdown...\'}.';
}

function templateContract(type, ctx) {
  const a = ctx.party_a_name;
  const b = ctx.party_b_name;
  const email = ctx.party_b_email || '';
  const date = new Date().toLocaleDateString('fr-FR');
  const p = ctx.product;

  if (type === 'NDA') {
    return {
      title: 'Accord de confidentialité — ' + b,
      body: [
        '# ACCORD DE CONFIDENTIALITÉ',
        '',
        '**Date :** ' + date,
        '',
        '**Entre :**',
        '- **' + a + '** (ci-après « Partie A »)',
        '- **' + b + '**' + (email ? ' (' + email + ')' : '') + ' (ci-après « Partie B »)',
        '',
        '## 1. Objet',
        'Le présent accord régit l\'échange d\'informations confidentielles dans le cadre d\'une collaboration d\'intelligence stratégique.',
        '',
        '## 2. Informations confidentielles',
        'Sont confidentielles toutes les informations techniques, commerciales ou stratégiques communiquées par écrit ou oralement.',
        '',
        '## 3. Obligations',
        'Chaque partie s\'engage à ne pas divulguer les informations confidentielles à des tiers et à les protéger avec le même soin que ses propres informations sensibles.',
        '',
        '## 4. Durée',
        'Les obligations de confidentialité restent en vigueur 24 mois après la signature.',
        '',
        '## 5. Droit applicable',
        'Le présent accord est soumis au droit français.',
        '',
        '**Partie A :** ' + a + '\n**Partie B :** ' + b,
      ].join('\n'),
    };
  }
  if (type === 'QUOTE') {
    const prod = p ? p.name : 'Zentara';
    const price = p ? p.monthly_price_eur : 0;
    const commit = p ? p.commitment_months : 12;
    const modules = p ? p.included_modules.join(', ') : '—';
    return {
      title: 'Proposition commerciale — ' + b,
      body: [
        '# PROPOSITION COMMERCIALE',
        '',
        '**Date :** ' + date,
        '**Émetteur :** ' + a,
        '**Client :** ' + b + (email ? ' (' + email + ')' : ''),
        '',
        '## Produit proposé',
        prod + ' — ' + price + '€/mois (engagement ' + commit + ' mois)',
        '',
        '## Modules inclus',
        modules,
        '',
        '## Prochaines étapes',
        '1. Validation de la proposition\n2. Signature\n3. Déploiement',
        '',
        '**Signature (Partie A) :** ________________\n**Signature (Partie B) :** ________________',
      ].join('\n'),
    };
  }
  return {
    title: 'Conditions d\'utilisation — ' + (p ? p.name : 'Zentara'),
    body: [
      '# CONDITIONS GÉNÉRALES D\'UTILISATION',
      '',
      '**Éditeur :** ' + a,
      '**Utilisateur :** ' + b + (email ? ' (' + email + ')' : ''),
      '',
      '## 1. Objet',
      'Les présentes conditions régissent l\'accès et l\'utilisation de la plateforme Zentara.',
      '',
      '## 2. Accès au service',
      'L\'accès est réservé aux utilisateurs autorisés via un compte et un code d\'accès sécurisé.',
      '',
      '## 3. Obligations de l\'utilisateur',
      'L\'utilisateur s\'engage à un usage licite et conforme du service.',
      '',
      '## 4. Propriété intellectuelle',
      'La plateforme et ses contenus restent la propriété exclusive de Zentara.',
      '',
      '## 5. Droit applicable',
      'Les présentes conditions sont soumises au droit français.',
    ].join('\n'),
  };
}

api.get('/contracts', (req, res) => {
  const q = req.query || {};
  const clauses = [];
  const params = [];
  if (q.type) { clauses.push('type = ?'); params.push(String(q.type).toUpperCase()); }
  if (q.status) { clauses.push('status = ?'); params.push(String(q.status)); }
  if (q.party_b_id) { clauses.push('party_b_id = ?'); params.push(String(q.party_b_id)); }
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare('SELECT * FROM contracts' + where + ' ORDER BY created_at DESC').all(...params);
  ok(res, rows.map(toContract));
});

api.get('/contracts/catalog', (_req, res) => ok(res, ZENTARA_PRODUCTS));

api.get('/contracts/by-party/:partyBId', (req, res) => {
  const rows = db.prepare('SELECT * FROM contracts WHERE party_b_id = ? ORDER BY created_at DESC').all(req.params.partyBId);
  ok(res, rows.map(toContract));
});

api.post('/contracts/generate', async (req, res) => {
  const body = req.body || {};
  const type = String(body.type || 'NDA').toUpperCase();
  if (!['NDA', 'QUOTE', 'TOS'].includes(type)) return fail(res, 422, 'VALIDATION', 'type must be NDA | QUOTE | TOS');

  const kind = body.party_b_kind === 'company' ? 'company' : 'prospect';
  let partyB = null;
  if (body.party_b_id) {
    const row = getById(kind === 'company' ? 'companies' : 'prospects', body.party_b_id);
    if (row) {
      const name = kind === 'prospect'
        ? ((row.first_name || '') + ' ' + (row.last_name || '')).trim()
        : (row.name || '');
      partyB = { id: row.id, name: name || body.party_b_name || '', email: row.email || body.party_b_email || '' };
    }
  }
  if (!partyB) {
    partyB = {
      id: body.party_b_id || null,
      name: body.party_b_name || '',
      email: body.party_b_email || '',
    };
  }
  if (!partyB.name) return fail(res, 422, 'VALIDATION', 'party_b_name required');

  const product = body.product_ref ? productByKey(body.product_ref) : null;
  const a = partyA();
  const ctx = {
    party_a_name: a.name,
    party_b_name: partyB.name,
    party_b_email: partyB.email,
    product,
    context: String(body.context || '').trim(),
  };

  let title = '';
  let content = '';
  let provider = null;
  let model = null;

  if (body.simulate) {
    const t = templateContract(type, ctx);
    title = t.title;
    content = t.body;
  } else {
    try {
      const r = await ai.chatCompletion(
        [{ role: 'user', content: contractPrompt(type, ctx) }],
        { provider: body.provider || undefined, model: body.model || undefined, maxTokens: 3000, json: true },
      );
      const parsed = ai.extractJson(r.content);
      title = (parsed && parsed.title) || templateContract(type, ctx).title;
      content = (parsed && parsed.body) || '';
      provider = r.provider;
      model = r.model;
      if (!content) throw new Error('Réponse IA vide');
    } catch (e) {
      // Fallback template si l'IA échoue.
      const t = templateContract(type, ctx);
      title = t.title;
      content = t.body;
    }
  }

  const id = generateId('ctr');
  const now = nowIso();
  const variables = {
    party_a_name: a.name,
    party_b_name: partyB.name,
    party_b_email: partyB.email || null,
    product: product ? { key: product.key, name: product.name, monthly_price_eur: product.monthly_price_eur, commitment_months: product.commitment_months } : null,
    context: ctx.context || null,
  };
  const createdVia = body.auto ? 'auto-hot-signal' : 'manual';
  db.prepare(
    `INSERT INTO contracts (id, type, status, title, body, party_a_id, party_b_id, party_b_kind, party_b_name, party_b_email, product_ref, variables, created_via, source_task_id, source_signal_id, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, type, title, content,
    partyB.id, kind, partyB.name, partyB.email || null, product ? product.key : null,
    JSON.stringify(variables), createdVia,
    body.source_task_id || null, body.source_signal_id || null, now, now,
  );

  ok(res, { contract: toContract(getById('contracts', id)), provider, model });
});

api.post('/contracts/auto-draft', async (req, res) => {
  const body = req.body || {};
  const type = String(body.type || 'QUOTE').toUpperCase();
  const kind = body.party_b_kind === 'company' ? 'company' : 'prospect';
  const pid = body.party_b_id || body.prospect_id || null;
  let name = body.party_b_name || '';
  let email = body.party_b_email || '';
  if (pid) {
    const row = getById(kind === 'company' ? 'companies' : 'prospects', pid);
    if (row) {
      name = kind === 'prospect' ? ((row.first_name || '') + ' ' + (row.last_name || '')).trim() : (row.name || '');
      email = row.email || email;
    }
  }
  if (!name) return fail(res, 422, 'VALIDATION', 'prospect_id or party_b_name required');
  const product = body.product_ref ? productByKey(body.product_ref) : null;
  const a = partyA();
  const ctx = { party_a_name: a.name, party_b_name: name, party_b_email: email, product, context: String(body.context || '') };
  let title, content, provider = null, model = null;
  try {
    const r = await ai.chatCompletion([{ role: 'user', content: contractPrompt(type, ctx) }], { maxTokens: 3000, json: true });
    const parsed = ai.extractJson(r.content);
    title = (parsed && parsed.title) || templateContract(type, ctx).title;
    content = (parsed && parsed.body) || '';
    provider = r.provider; model = r.model;
    if (!content) throw new Error('Réponse IA vide');
  } catch {
    const t = templateContract(type, ctx);
    title = t.title; content = t.body;
  }
  const id = generateId('ctr');
  const now = nowIso();
  db.prepare(
    `INSERT INTO contracts (id, type, status, title, body, party_b_id, party_b_kind, party_b_name, party_b_email, product_ref, variables, created_via, source_task_id, source_signal_id, created_at, updated_at)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, 'auto-hot-signal', ?, ?, ?, ?)`,
  ).run(
    id, type, title, content, pid, kind, name, email || null, product ? product.key : null,
    JSON.stringify({ party_a_name: a.name, party_b_name: name, product }),
    body.source_task_id || null, body.source_signal_id || null, now, now,
  );
  ok(res, { contract: toContract(getById('contracts', id)), provider, model });
});

api.post('/contracts/:id/status', (req, res) => {
  const row = getById('contracts', req.params.id);
  if (!row) return fail(res, 404, 'NOT_FOUND', 'contract not found');
  const status = String(req.body?.status || '');
  const valid = ['draft', 'pending_signature', 'signed', 'rejected', 'superseded'];
  if (!valid.includes(status)) return fail(res, 422, 'VALIDATION', 'invalid status');
  const now = nowIso();
  const notes = req.body?.notes ?? row.notes;
  const sentAt = status === 'pending_signature' ? (row.sent_at || now) : row.sent_at;
  const signedAt = status === 'signed' ? (row.signed_at || now) : row.signed_at;
  db.prepare('UPDATE contracts SET status = ?, notes = ?, sent_at = ?, signed_at = ?, updated_at = ? WHERE id = ?')
    .run(status, notes, sentAt, signedAt, now, req.params.id);
  ok(res, toContract(getById('contracts', req.params.id)));
});

api.get('/contracts/:id', (req, res) => {
  const row = toContract(getById('contracts', req.params.id));
  if (!row) return fail(res, 404, 'NOT_FOUND', 'contract not found');
  ok(res, row);
});

api.delete('/contracts/:id', (req, res) => {
  const r = db.prepare('DELETE FROM contracts WHERE id = ?').run(req.params.id);
  ok(res, { deleted: r.changes > 0 });
});

// ---------------------------------------------------------------------
// Design Audit — scrape + heuristics + AI summary
// ---------------------------------------------------------------------

function toDesignAudit(row) {
  if (!row) return null;
  const out = { ...row };
  for (const f of ['category_scores', 'issues', 'recommended_actions', 'meta']) {
    if (out[f]) {
      try { out[f] = JSON.parse(out[f]); } catch { out[f] = f === 'issues' ? [] : f === 'recommended_actions' ? [] : f === 'meta' ? {} : {}; }
    } else {
      out[f] = f === 'issues' ? [] : f === 'recommended_actions' ? [] : f === 'meta' ? {} : (f === 'category_scores' ? {} : out[f]);
    }
  }
  return out;
}

function heuristicAudit(url, html) {
  const issues = [];
  const add = (severity, category, title, message, fix, roi, effort) => {
    issues.push({
      id: 'iss_' + generateId('x').slice(4),
      severity, category, title, message, fix,
      roi_estimate: roi, effort_estimate: effort,
    });
  };

  const has = (re) => re.test(html);
  const count = (re) => (html.match(re) || []).length;
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const metaDesc = (html.match(/<meta[^>]*name=["']description["'][^>]*>/i) || [])[0] || '';
  const hasLang = /<html[^>]*lang=["'][a-zA-Z-]+["']/i.test(html);
  const hasViewport = /<meta[^>]*name=["']viewport["']/i.test(html);
  const imgs = count(/<img\b/gi);
  const imgsWithAlt = count(/<img\b[^>]*alt=["'][^"']+["']/gi);
  const headings = (html.match(/<h[1-6]\b[^>]*>/gi) || []).length;
  const hasH1 = /<h1\b/i.test(html);
  const hasSemantic = /<(header|nav|main|footer|section|article)\b/i.test(html);
  const hasCanonical = /rel=["']canonical["']/i.test(html);
  const hasOg = /property=["']og:/i.test(html);
  const scripts = count(/<script\b/gi);
  const inlineStyles = count(/style=["']/gi);
  const hasHttps = /^https:/i.test(url);
  const hasFormLabels = count(/<label\b/gi);
  const inputs = count(/<input\b/gi);

  // structure
  if (!hasSemantic) add('high', 'structure', 'Structure sémantique absente', 'Aucune balise sémantique (header/nav/main/footer) détectée.', 'Structurer la page avec header, main, footer et nav.', 60, 6);
  if (!hasH1) add('medium', 'structure', 'Pas de H1', 'Aucun titre principal <h1> détecté.', 'Ajouter un unique <h1> descriptif.', 40, 1);
  if (headings === 0) add('high', 'structure', 'Aucun titre', 'Aucune balise de titre h1-h6.', 'Hiérarchiser le contenu avec des titres.', 50, 3);

  // a11y
  if (imgs > 0 && imgsWithAlt < imgs) add('high', 'a11y', 'Images sans alt', imgs - imgsWithAlt + ' image(s) sans attribut alt.', 'Ajouter un alt descriptif à chaque image.', 55, 2);
  if (!hasLang) add('medium', 'a11y', 'Langue non déclarée', 'Attribut lang manquant sur <html>.', 'Ajouter lang="fr" (ou la langue du site).', 35, 1);
  if (inputs > 0 && hasFormLabels < inputs) add('medium', 'a11y', 'Champs sans label', 'Champs de formulaire sans <label> associé.', 'Associer un label à chaque champ.', 40, 2);

  // seo
  if (!title) add('critical', 'seo', 'Title manquant', 'Aucune balise <title>.', 'Ajouter un title unique et descriptif (<60 car).', 70, 1);
  if (!metaDesc) add('high', 'seo', 'Meta description manquante', 'Aucune meta description.', 'Ajouter une meta description (<160 car).', 50, 1);
  if (!hasCanonical) add('low', 'seo', 'Canonical absent', 'Pas de balise rel=canonical.', 'Ajouter un lien canonical pour éviter le contenu dupliqué.', 25, 1);
  if (!hasOg) add('low', 'seo', 'Open Graph absent', 'Pas de balises og: pour le partage social.', 'Ajouter og:title, og:description, og:image.', 30, 2);

  // perf
  if (scripts > 15) add('medium', 'perf', 'Trop de scripts', scripts + ' balises <script>.', 'Regrouper/différer les scripts (defer, async).', 45, 4);
  if (inlineStyles > 10) add('low', 'perf', 'Styles inline nombreux', inlineStyles + ' styles inline détectés.', 'Externaliser les styles en CSS.', 20, 3);
  if (imgs > 20) add('medium', 'perf', 'Beaucoup d\'images', imgs + ' images sans lazy-loading détectable.', 'Ajouter loading="lazy" et optimiser les images.', 35, 3);

  // ux
  if (!hasViewport) add('critical', 'ux', 'Viewport absent', 'Meta viewport manquante → non responsive sur mobile.', 'Ajouter <meta name="viewport" content="width=device-width, initial-scale=1">.', 65, 1);
  if (!hasHttps) add('critical', 'ux', 'Site non sécurisé', 'Le site est servi en HTTP (pas de HTTPS).', 'Activer HTTPS/TLS sur le domaine.', 75, 4);

  const cat = (base, countIssues) => Math.max(5, Math.min(100, base - countIssues * 12));
  const category_scores = {
    structure: cat(hasSemantic ? 90 : 50, issues.filter((i) => i.category === 'structure').length),
    a11y: cat(imgs > 0 && imgsWithAlt >= imgs && hasLang ? 90 : 55, issues.filter((i) => i.category === 'a11y').length),
    seo: cat(title && metaDesc ? 85 : 40, issues.filter((i) => i.category === 'seo').length),
    perf: cat(90, issues.filter((i) => i.category === 'perf').length),
    ux: cat(hasViewport && hasHttps ? 90 : 45, issues.filter((i) => i.category === 'ux').length),
  };
  const score = Math.round(
    (category_scores.structure + category_scores.a11y + category_scores.seo + category_scores.perf + category_scores.ux) / 5,
  );

  const sevRank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  issues.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  const recommended_actions = issues.slice(0, 5).map((i) => i.fix);

  return { score, category_scores, issues, recommended_actions };
}

async function runDesignAudit(url) {
  const normalized = scrape.normalizeUrl(url);
  if (!normalized) throw new Error('URL invalide');
  const domain = (() => { try { return new URL(normalized).hostname.replace(/^www\./, ''); } catch { return null; } })();
  const s = await scrape.scrapeSite(normalized);
  const home = await scrape.fetchText(normalized, { 'User-Agent': scrape.BROWSER_UA, Accept: 'text/html' });
  const html = home.text || '';
  const h = heuristicAudit(normalized, html);

  let ai_summary = 'Résumé IA indisponible (analyse heuristique uniquement).';
  if (h.issues.length > 0) {
    try {
      const top = h.issues.slice(0, 6).map((i) => `- [${i.severity}/${i.category}] ${i.title}`).join('\n');
      const r = await ai.chatCompletion(
        [{ role: 'user', content: 'Tu es un expert UX/SEO. Résume en 2-3 phrases en français les problèmes principaux de ce site et le gain attendu en les corrigeant.\nSite : ' + normalized + '\nProblèmes détectés :\n' + top + '\nRéponds uniquement par le résumé.' }],
        { maxTokens: 400 },
      );
      if (r.content && r.content.trim()) ai_summary = r.content.trim();
    } catch { /* fallback */ }
  } else {
    ai_summary = 'Le site présente une base correcte. Les principaux signaux (title, viewport, HTTPS, sémantique) sont présents.';
  }

  return {
    url: normalized,
    domain,
    score: h.score,
    category_scores: h.category_scores,
    issues: h.issues,
    recommended_actions: h.recommended_actions,
    ai_summary,
    meta: {
      html_bytes: s.html_bytes || html.length,
      scanned_url: s.scanned_urls[0] || normalized,
      blocked: s.blocked,
      unreachable: s.unreachable,
      note: s.note,
    },
  };
}

api.get('/design-audit', (_req, res) => {
  const rows = db.prepare('SELECT * FROM design_audits ORDER BY created_at DESC').all();
  ok(res, rows.map(toDesignAudit));
});

api.get('/design-audit/for-company/:companyId', (req, res) => {
  const c = getById('companies', req.params.companyId);
  let domain = null;
  if (c && c.website) {
    try { domain = new URL(c.website).hostname.replace(/^www\./, ''); } catch { domain = String(c.website).replace(/^https?:\/\//, '').replace(/^www\./, ''); }
  }
  if (!domain) return ok(res, []);
  const rows = db.prepare('SELECT * FROM design_audits WHERE domain = ? ORDER BY created_at DESC').all(domain);
  ok(res, rows.map(toDesignAudit));
});

api.post('/design-audit/run', async (req, res) => {
  try {
    const url = req.body?.url;
    if (!url) return fail(res, 422, 'VALIDATION', 'url required');
    const audit = await runDesignAudit(url);
    const id = generateId('aud');
    const now = nowIso();
    db.prepare(
      `INSERT INTO design_audits (id, url, domain, score, category_scores, issues, recommended_actions, ai_summary, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, audit.url, audit.domain, audit.score,
      JSON.stringify(audit.category_scores), JSON.stringify(audit.issues),
      JSON.stringify(audit.recommended_actions), audit.ai_summary, JSON.stringify(audit.meta), now,
    );
    // auto-tag la company correspondante avec le tag 'design'
    if (audit.domain) {
      const companies = db.prepare('SELECT id FROM companies WHERE website IS NOT NULL AND website != \'\'').all();
      for (const co of companies) {
        let cd = null;
        try { cd = new URL(co.website).hostname.replace(/^www\./, ''); } catch { continue; }
        if (cd === audit.domain) {
          const tags = (getById('companies', co.id)?.tags) || [];
          const arr = Array.isArray(tags) ? tags : [];
          if (!arr.includes('design')) arr.push('design');
          db.prepare('UPDATE companies SET tags = ? WHERE id = ?').run(JSON.stringify(arr), co.id);
        }
      }
    }
    ok(res, toDesignAudit(getById('design_audits', id)));
  } catch (e) {
    fail(res, 502, 'AUDIT_ERROR', 'Audit échoué : ' + e.message);
  }
});

api.post('/design-audit', async (req, res) => {
  // Alias de /design-audit/run (compat endpoints.ts designAuditCreate).
  req.url = '/design-audit/run';
  // simplest: forward body manually
  return (async () => {
    try {
      const url = req.body?.url;
      if (!url) return fail(res, 422, 'VALIDATION', 'url required');
      const audit = await runDesignAudit(url);
      const id = generateId('aud');
      const now = nowIso();
      db.prepare(
        `INSERT INTO design_audits (id, url, domain, score, category_scores, issues, recommended_actions, ai_summary, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, audit.url, audit.domain, audit.score,
        JSON.stringify(audit.category_scores), JSON.stringify(audit.issues),
        JSON.stringify(audit.recommended_actions), audit.ai_summary, JSON.stringify(audit.meta), now,
      );
      ok(res, toDesignAudit(getById('design_audits', id)));
    } catch (e) {
      fail(res, 502, 'AUDIT_ERROR', 'Audit échoué : ' + e.message);
    }
  })();
});

api.post('/design-audit/hunt', async (req, res) => {
  const body = req.body || {};
  const target = Math.min(Number(body.target_count || 5), 20);
  const started = Date.now();
  const companies = db.prepare("SELECT * FROM companies WHERE website IS NOT NULL AND website != '' ORDER BY score DESC LIMIT ?").all(target);
  const audits = [];
  let succeeded = 0;
  let failed = 0;
  for (const co of companies) {
    try {
      const audit = await runDesignAudit(co.website);
      const id = generateId('aud');
      const now = nowIso();
      db.prepare(
        `INSERT INTO design_audits (id, url, domain, score, category_scores, issues, recommended_actions, ai_summary, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, audit.url, audit.domain, audit.score,
        JSON.stringify(audit.category_scores), JSON.stringify(audit.issues),
        JSON.stringify(audit.recommended_actions), audit.ai_summary, JSON.stringify(audit.meta), now,
      );
      const tags = (getById('companies', co.id)?.tags) || [];
      const arr = Array.isArray(tags) ? tags : [];
      if (!arr.includes('design')) arr.push('design');
      db.prepare('UPDATE companies SET tags = ? WHERE id = ?').run(JSON.stringify(arr), co.id);
      succeeded++;
      audits.push({
        company_name: co.name, company_id: co.id, url: audit.url, score: audit.score,
        issues_count: audit.issues.length, blocked: audit.meta.blocked, unreachable: audit.meta.unreachable,
        outreach_drafted: false, error: null, audit_id: id,
      });
    } catch (e) {
      failed++;
      audits.push({
        company_name: co.name, company_id: co.id, url: co.website, score: null, issues_count: 0,
        blocked: false, unreachable: true, outreach_drafted: false, error: String(e.message), audit_id: null,
      });
    }
  }
  ok(res, {
    niche: body.niche || '', region: body.region || '', target_count: target,
    discovered: companies.length, succeeded, failed, audits,
    options_applied: { save_companies: false, outreach_below: body.outreach_below || null, auto_tag: true },
    duration_ms: Date.now() - started,
  });
});

api.get('/design-audit/:id', (req, res) => {
  const row = toDesignAudit(getById('design_audits', req.params.id));
  if (!row) return fail(res, 404, 'NOT_FOUND', 'audit not found');
  ok(res, row);
});

api.delete('/design-audit/:id', (req, res) => {
  const r = db.prepare('DELETE FROM design_audits WHERE id = ?').run(req.params.id);
  ok(res, { deleted: r.changes > 0 });
});

// ---------------------------------------------------------------------
// Prospects: clean legacy channels (stub)
// ---------------------------------------------------------------------

api.post('/prospects/clean-legacy-channels', (_req, res) => ok(res, { deleted: 0, sample: [] }));

// ---------------------------------------------------------------------
// 404 for unknown API routes
// ---------------------------------------------------------------------

api.use((req, res) => fail(res, 404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));

app.use('/api', api);

// =====================================================================
// Static frontend (SPA fallback)
// =====================================================================

app.use(express.static(FRONTEND_DIST));
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
  }
  next();
});

// =====================================================================
// Error handler
// =====================================================================

app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err);
  fail(res, 500, 'INTERNAL', err?.message || 'Internal error');
});

applyRuntimeSettingsToEnv();

const LISTEN_HOST = process.env.LISTEN_HOST || '0.0.0.0';
app.listen(PORT, LISTEN_HOST, () => {
  console.log(`[server] Zentara backend listening on http://${LISTEN_HOST}:${PORT}`);
  console.log(`[server] Serving frontend from ${FRONTEND_DIST}`);
  console.log(`[server] LinkedIn: ${process.env.LINKEDIN_USERNAME ? 'configuré' : 'non configuré (StaffSpy session only)'}`);
});
