#!/usr/bin/env node
/** backfill-cleanup.js — one-off : nettoie le bruit + backfill le secteur des vraies companies. */
'use strict';
process.loadEnvFile && process.loadEnvFile('.env');
const { db } = require('./db');
const AI = require('./ai');

const NOISE = [
  'Stripe Samples',
  'DefinitelyTyped',
  'billfinn-stripe',
  'DjangoDev',
  'Peter Squicciarini',
  'Head of Sales',
];

async function main() {
  // 1) Suppression du bruit
  let deleted = 0;
  for (const n of NOISE) {
    const row = db.prepare('SELECT id FROM companies WHERE LOWER(name) = LOWER(?) LIMIT 1').get(n);
    if (!row) continue;
    db.prepare('DELETE FROM prospects WHERE company_id = ?').run(row.id);
    db.prepare('DELETE FROM contacts WHERE company_id = ?').run(row.id);
    db.prepare('DELETE FROM companies WHERE id = ?').run(row.id);
    deleted++;
  }

  // 2) Backfill des vraies companies sans secteur
  const empty = db
    .prepare("SELECT id, name, website FROM companies WHERE sector IS NULL OR TRIM(sector) = ''")
    .all();
  let filled = 0;
  if (empty.length > 0) {
    const payload = empty.map((r) => ({ id: r.id, name: r.name, website: r.website || '' }));
    try {
      const res = await Promise.race([
        AI.chatCompletion(
          [
            {
              role: 'system',
              content:
                'Pour chaque entreprise, infère son secteur d\'activité en 2-5 mots (ex "3D Search Software", "Agence web"). Réponds UNIQUEMENT en JSON : {"sectors":[{"id":"...","sector":"..."}]}.',
            },
            { role: 'user', content: JSON.stringify(payload) },
          ],
          { json: true, maxTokens: 1000, provider: 'gemini', model: 'gemini-3.1-flash-lite' },
        ),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 20000)),
      ]);
      const parsed = AI.extractJson(res.content);
      const list = parsed && Array.isArray(parsed.sectors) ? parsed.sectors : [];
      const byId = new Map(list.map((s) => [String(s.id), String(s.sector || '').trim()]));
      for (const r of empty) {
        const sector = byId.get(r.id);
        if (sector) {
          db.prepare('UPDATE companies SET sector = ?, updated_at = ? WHERE id = ?').run(
            sector,
            new Date().toISOString(),
            r.id,
          );
          filled++;
        }
      }
    } catch (e) {
      console.log('backfill IA échoué:', e.message);
    }
  }

  const total = db.prepare('SELECT COUNT(*) c FROM companies').get().c;
  const stillEmpty = db
    .prepare("SELECT COUNT(*) c FROM companies WHERE sector IS NULL OR TRIM(sector) = ''")
    .get().c;
  console.log(`bruit supprimé: ${deleted} | secteur backfillé: ${filled} | companies: ${total} | secteur vide restant: ${stillEmpty}`);
}

main().catch((e) => {
  console.error('ERREUR:', e);
  process.exit(1);
});
