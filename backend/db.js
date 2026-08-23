/**
 * db.js — SQLite layer (Node built-in `node:sqlite`, no native deps).
 *
 * Recreates the Zentara schema (from the historical backend + the surviving
 * `data/zentara.db` snapshot) and seeds a default admin user.
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.ZENTARA_DB_PATH || path.join(__dirname, 'data', 'zentara.db');

// Ensure the data dir exists.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// =====================================================================
// Schema (matches the historical backend snapshot)
// =====================================================================

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  status TEXT DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  pin_hash TEXT NULL,
  biometric_enabled INTEGER NOT NULL DEFAULT 0,
  biometric_token TEXT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  lockout_until TEXT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  auth_method TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  ip TEXT NULL,
  user_agent TEXT NULL,
  metadata TEXT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  sector TEXT,
  industry TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  phone TEXT,
  email TEXT,
  social_profiles TEXT,
  google_maps_url TEXT,
  score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',
  notes TEXT,
  tags TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prospects (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT,
  sector TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  website TEXT,
  social_profiles TEXT,
  google_maps_url TEXT,
  score INTEGER DEFAULT 0,
  status TEXT DEFAULT 'new',
  tags TEXT,
  quality TEXT,
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  social_profiles TEXT,
  status TEXT DEFAULT 'active',
  notes TEXT,
  tags TEXT,
  linkedin_url TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',
  target TEXT,
  created_by TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS campaign_prospects (
  id TEXT PRIMARY KEY,
  campaign_id TEXT,
  prospect_id TEXT,
  status TEXT DEFAULT 'added',
  added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (campaign_id, prospect_id),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS intelligence (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  score INTEGER DEFAULT 0,
  opportunity_score INTEGER,
  relevance_score INTEGER,
  intent_score INTEGER,
  activity_score INTEGER,
  confidence_score INTEGER,
  summary TEXT,
  insights TEXT,
  risks TEXT,
  recommendations TEXT,
  email_subject TEXT,
  email_html TEXT,
  email_body TEXT,
  email_cta_url TEXT,
  profile TEXT,
  product_estimate TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS intelligence_signals (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  source TEXT,
  signal_type TEXT,
  signal TEXT,
  confidence INTEGER,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_analysis (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  summary TEXT,
  insights TEXT,
  recommendations TEXT,
  confidence INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  action TEXT,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS monitoring (
  id TEXT PRIMARY KEY,
  entity_type TEXT,
  entity_id TEXT,
  source TEXT,
  signal_type TEXT,
  signal TEXT,
  confidence INTEGER,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_ref TEXT,
  title TEXT,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  embedding TEXT,
  dim INTEGER,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT DEFAULT 'pending',
  severity TEXT DEFAULT 'info',
  title TEXT,
  message TEXT,
  payload TEXT,
  started_at DATETIME,
  finished_at DATETIME,
  seen_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  prospect_id TEXT,
  company_id TEXT,
  subject TEXT,
  body TEXT,
  status TEXT DEFAULT 'draft',
  tone TEXT,
  sent_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL DEFAULT 'default',
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  title TEXT,
  body TEXT,
  party_a_id TEXT,
  party_b_id TEXT,
  party_b_kind TEXT,
  party_b_name TEXT,
  party_b_email TEXT,
  product_ref TEXT,
  variables TEXT,
  created_via TEXT DEFAULT 'manual',
  source_task_id TEXT,
  source_signal_id TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME,
  signed_at DATETIME
);

CREATE TABLE IF NOT EXISTS design_audits (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  domain TEXT,
  score INTEGER,
  category_scores TEXT,
  issues TEXT,
  recommended_actions TEXT,
  ai_summary TEXT,
  meta TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- AXE 1 : persistance de la "matière première" utilisée pour une analyse.
--   On garde le NormalizedInput (JSON) + son input_hash SHA-256.
--   Une nouvelle analyse qui partage le même input_hash RÉUTILISE l'agrégat
--   déterministe déjà calculé ⇒ reproductibilité parfaite.
CREATE TABLE IF NOT EXISTS intelligence_inputs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  sources TEXT NOT NULL,
  normalized TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (entity_type, entity_id, input_hash),
  FOREIGN KEY (entity_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- AXE 1 : breakdown déterministe (50 critères + agrégat) lié à un input_hash.
--   Plusieurs analyses (intel. runs) peuvent partager le même scoring_breakdown.
CREATE TABLE IF NOT EXISTS scoring_breakdowns (
  id TEXT PRIMARY KEY,
  input_hash TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  prompt_version TEXT,
  breakdown TEXT NOT NULL,
  aggregate TEXT NOT NULL,
  computed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (input_hash, entity_type, entity_id, prompt_version)
);

-- AXE 2 : jobs async d'analyse (pour éviter les timeout HTTP sur les analyses longues).
--   Cycle de vie : queued → running → succeeded | failed | canceled.
CREATE TABLE IF NOT EXISTS analysis_jobs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  input_hash TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT,
  progress REAL NOT NULL DEFAULT 0,
  steps TEXT,
  result_id TEXT,
  error TEXT,
  provider TEXT,
  model TEXT,
  prompt_version TEXT,
  started_at DATETIME,
  finished_at DATETIME,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

db.exec(SCHEMA);

// Migrations idempotentes (colonnes ajoutées après la création initiale).
(function migrate() {
  const cols = db.prepare("SELECT name FROM pragma_table_info('intelligence')").all().map((r) => r.name);
  const adds = [
    ['email_subject', 'TEXT'],
    ['email_html', 'TEXT'],
    ['email_body', 'TEXT'],
    ['email_cta_url', 'TEXT'],
    ['profile', 'TEXT'],
    ['product_estimate', 'TEXT'],
    // AXE 1 : trace la plus fine du calcul déterministe + entrée utilisée.
    ['input_hash', 'TEXT'],
    ['scoring_version', 'TEXT'],
    ['score_source', 'TEXT'],
    // AXE 1bis : moteur d'intelligence déterministe (consensus, signaux, opportunités, forecast, qualité).
    ['engine', 'TEXT'],
  ];
  for (const [name, type] of adds) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE intelligence ADD COLUMN ${name} ${type}`);
    }
  }
  // Index de cache : permet de retrouver une analyse par son hash.
  db.exec('CREATE INDEX IF NOT EXISTS idx_intelligence_input_hash ON intelligence(input_hash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_scoring_breakdowns_hash ON scoring_breakdowns(input_hash)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_entity ON analysis_jobs(entity_type, entity_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_jobs_status ON analysis_jobs(status)');
})();

// =====================================================================
// Helpers
// =====================================================================

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function generateId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

/** Hash du PIN (cohérent avec l'ancien backend : sha256 du PIN salé). */
function hashPin(pin) {
  return sha256(`zentara:pin:${pin}`);
}

// =====================================================================
// Seed — default admin user (Tuna)
// =====================================================================

function seed() {
  const existing = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (existing) return;

  const now = nowIso();
  db.prepare(
    `INSERT INTO users (id, email, name, role, status, pin_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId('usr'),
    'tunation.fr@gmail.com',
    'Tuna',
    'admin',
    'active',
    null, // PIN supprimé — login toujours auto
    now,
    now,
  );
  console.log('[db] Seeded default user: tunation.fr@gmail.com (sans PIN)');
}

seed();

module.exports = {
  db,
  sha256,
  generateId,
  nowIso,
  hashPin,
  DB_PATH,
};
