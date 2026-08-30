// scoring-store.js — Couche de persistance pour le scoring déterministe.
//
// Garantit :
//   • Stockage du NormalizedInput (données sources) à chaque analyse.
//   • Cache du breakdown déterministe par input_hash + entity_id.
//   • Si on relance l'analyse avec les mêmes inputs ⇒ on RÉCUPÈRE le même
//     breakdown + le même agrégat (cohérence parfaite, pas de recalcul).
//   • Si les inputs ont changé ⇒ nouveau breakdown, le précédent reste
//     consultable via GET /api/intelligence/history/:id.
'use strict';

const { db, generateId, nowIso } = require('./db');

const PROMPT_VERSION = 'zentara-v2-deterministic'; // identifiant du schéma de scoring actuel

// --------------------------------------------------------------------------
// Inputs
// --------------------------------------------------------------------------

/**
 * Sauvegarde (ou récupère) le NormalizedInput pour (entity_type, entity_id).
 * Renvoie { input, input_hash, id } — id est l'ID en base (existant ou nouveau).
 */
function saveInput(entityType, entityId, normalized) {
  const input_hash = normalized.input_hash;
  const sources = pickSourceTimestamps(normalized);
  const existing = db.prepare(
    `SELECT id FROM intelligence_inputs WHERE entity_type = ? AND entity_id = ? AND input_hash = ?`,
  ).get(entityType, entityId, input_hash);
  if (existing) return { id: existing.id, input_hash, normalized };
  const id = generateId('inp');
  db.prepare(
    `INSERT INTO intelligence_inputs (id, entity_type, entity_id, input_hash, sources, normalized, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, entityType, entityId, input_hash,
       JSON.stringify(sources),
       JSON.stringify(normalized),
       nowIso());
  return { id, input_hash, normalized };
}

function pickSourceTimestamps(normalized) {
  const out = {};
  const ts = normalized?.source_timestamps && typeof normalized.source_timestamps === 'object'
    ? normalized.source_timestamps
    : {};
  for (const k of Object.keys(ts).sort()) out[k] = ts[k];
  return out;
}

// --------------------------------------------------------------------------
// Breakdowns (cache déterministe)
// --------------------------------------------------------------------------

/**
 * Sauvegarde le breakdown déterministe (50 critères + agrégat).
 * Idempotent sur (input_hash, entity_id, prompt_version).
 */
function saveBreakdown(entityType, entityId, input_hash, breakdown, aggregate, opts = {}) {
  const promptVersion = opts.prompt_version || PROMPT_VERSION;
  const existing = db.prepare(
    `SELECT id FROM scoring_breakdowns
     WHERE input_hash = ? AND entity_type = ? AND entity_id = ? AND prompt_version = ?`,
  ).get(input_hash, entityType, entityId, promptVersion);
  if (existing) {
    return { id: existing.id, cached: true };
  }
  const id = generateId('scb');
  db.prepare(
    `INSERT INTO scoring_breakdowns (id, input_hash, entity_type, entity_id, prompt_version, breakdown, aggregate, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input_hash, entityType, entityId, promptVersion,
       JSON.stringify(breakdown),
       JSON.stringify(aggregate),
       nowIso());
  return { id, cached: false };
}

/**
 * Récupère un breakdown mis en cache (input_hash inchangé).
 */
function loadBreakdown(entityType, entityId, input_hash, promptVersion = PROMPT_VERSION) {
  const row = db.prepare(
    `SELECT * FROM scoring_breakdowns
     WHERE input_hash = ? AND entity_type = ? AND entity_id = ? AND prompt_version = ?`,
  ).get(input_hash, entityType, entityId, promptVersion);
  if (!row) return null;
  return {
    id: row.id,
    breakdown: JSON.parse(row.breakdown),
    aggregate: JSON.parse(row.aggregate),
    computed_at: row.computed_at,
    cached: true,
  };
}

// --------------------------------------------------------------------------
// Analyse « complète » (résumé) — utile pour l'endpoint /explain
// --------------------------------------------------------------------------

/**
 * Renvoie, pour une entité, le dernier input enregistré + le breakdown
 * déterministe lié + la trace des analyses IA qui l'ont exploité.
 */
function explain(entityType, entityId) {
  const entity = entityType === 'prospect'
    ? db.prepare('SELECT id, first_name, last_name, name, sector, website FROM prospects WHERE id = ?').get(entityId)
      || db.prepare('SELECT * FROM prospects WHERE id = ?').get(entityId)
    : db.prepare('SELECT * FROM companies WHERE id = ?').get(entityId);
  if (!entity) return null;

  const inputs = db.prepare(
    `SELECT id, input_hash, sources, normalized, created_at
     FROM intelligence_inputs
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY created_at DESC LIMIT 10`,
  ).all(entityType, entityId).map((row) => ({
    id: row.id,
    input_hash: row.input_hash,
    sources: safeParse(row.sources),
    normalized: safeParse(row.normalized),
    created_at: row.created_at,
  }));

  const breakdowns = db.prepare(
    `SELECT id, input_hash, prompt_version, breakdown, aggregate, computed_at
     FROM scoring_breakdowns
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY computed_at DESC LIMIT 10`,
  ).all(entityType, entityId).map((row) => ({
    id: row.id,
    input_hash: row.input_hash,
    prompt_version: row.prompt_version,
    breakdown: safeParse(row.breakdown),
    aggregate: safeParse(row.aggregate),
    computed_at: row.computed_at,
  }));

  const analyses = db.prepare(
    `SELECT id, created_at, provider, model, prompt_version, summary, insights, recommendations, confidence
     FROM ai_analysis
     WHERE entity_type = ? AND entity_id = ?
     ORDER BY created_at DESC LIMIT 10`,
  ).all(entityType, entityId);

  const intelligence = db.prepare(
    `SELECT * FROM intelligence WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 5`,
  ).all(entityType, entityId);

  return {
    entity_type: entityType,
    entity_id: entityId,
    entity: { id: entity.id, name: entity.name || `${entity.first_name || ''} ${entity.last_name || ''}`.trim() },
    inputs,
    breakdowns,
    analyses,
    intelligence: intelligence.map((row) => ({
      ...row,
      insights: safeParse(row.insights),
      risks: safeParse(row.risks),
      recommendations: safeParse(row.recommendations),
      profile: safeParse(row.profile),
      product_estimate: safeParse(row.product_estimate),
    })),
  };
}

function safeParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

module.exports = {
  PROMPT_VERSION,
  saveInput,
  saveBreakdown,
  loadBreakdown,
  explain,
};
