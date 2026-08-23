#!/usr/bin/env node
/** backfill-sectors.js — backfill le secteur des companies avec secteur vide, via l'IA.
 *
 * Usage :
 *   node backfill-sectors.js
 *
 * Pour chaque company dont le secteur est vide, l'IA infère le secteur depuis
 * le nom + le site (batch de 20). S'appuie sur ai.js → fallback automatique
 * gemini → openrouter → mistral (donc robuste au rate-limit).
 */
'use strict';
process.loadEnvFile && process.loadEnvFile('.env');
const { db } = require('./db');
const AI = require('./ai');

const BATCH = 20;

async function main() {
  const empty = db
    .prepare("SELECT id, name, website FROM companies WHERE sector IS NULL OR TRIM(sector) = ''")
    .all();
  if (empty.length === 0) {
    console.log('✓ Aucune company avec secteur vide.');
    return;
  }
  console.log(`Backfill de ${empty.length} company(s)…`);
  let filled = 0;

  for (let i = 0; i < empty.length; i += BATCH) {
    const batch = empty.slice(i, i + BATCH);
    const payload = batch.map((r) => ({ id: r.id, name: r.name, website: r.website || '' }));
    try {
      const res = await AI.chatCompletion(
        [
          {
            role: 'system',
            content:
              'Pour chaque entreprise, infère son secteur d\'activité en 2-5 mots (ex "SaaS RH", "Clinique dentaire", "Agence web", "3D Search Software"). Réponds UNIQUEMENT en JSON : {"sectors":[{"id":"...","sector":"..."}]}. Reprends EXACTEMENT les ids fournis.',
          },
          { role: 'user', content: JSON.stringify(payload) },
        ],
        { json: true, maxTokens: 2000, provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      );
      const parsed = AI.extractJson(res.content);
      const list = parsed && Array.isArray(parsed.sectors) ? parsed.sectors : [];
      const byId = new Map(list.map((s) => [String(s.id), String(s.sector || '').trim()]));
      for (const r of batch) {
        const sector = byId.get(r.id);
        if (sector) {
          db.prepare('UPDATE companies SET sector = ?, updated_at = ? WHERE id = ?').run(
            sector,
            new Date().toISOString(),
            r.id,
          );
          filled++;
          console.log(`  ✓ ${r.name} → ${sector}`);
        } else {
          console.log(`  ✗ ${r.name} (non inféré)`);
        }
      }
    } catch (e) {
      console.log('  erreur IA:', e.message);
    }
  }

  const stillEmpty = db
    .prepare("SELECT COUNT(*) c FROM companies WHERE sector IS NULL OR TRIM(sector) = ''")
    .get().c;
  console.log(`Terminé : ${filled} backfillé(s), ${stillEmpty} encore vide(s).`);
}

main().catch((e) => {
  console.error('ERREUR:', e);
  process.exit(1);
});
