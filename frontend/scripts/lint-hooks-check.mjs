/**
 * lint-hooks-check — Round 44.
 *
 * Test de régression lint : garantit que `react/rules-of-hooks` est bien
 * actif via `.oxlintrc.json` et interdit les hooks appelés APRÈS un
 * `return` conditionnel (le bug React #310 « Rendered more hooks than
 * during the previous render » qui a déjà planté CompanyDetailPage).
 *
 * Usage : npm run test:hooks
 *  - exit 0  → la règle est active et attrape le pattern interdit
 *  - exit 1  → la règle est inactive ou ne détecte plus le bug (régression)
 *
 * Fixtures générées dans un dossier temporaire (jamais commitées) :
 *   - Buggy.tsx  : hook appelé après `if (!data) return` → DOIT échouer
 *   - Clean.tsx  : hooks appelés avant le guard → ne doit PAS échouer
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const oxlintBin = join(root, 'node_modules', '.bin', 'oxlint');

const BUGGY_TSX = `import React from 'react';
import { useQuery } from '@tanstack/react-query';

export function Buggy({ data }: { data: string | null }) {
  // ❌ Ce return conditionnel rend le hook ci-dessous inatteignable sur
  // certains rendus → React #310. react/rules-of-hooks DOIT le signaler.
  if (!data) {
    return <div>loading</div>;
  }
  const { data: fetched } = useQuery({ queryKey: ['x', data], queryFn: () => Promise.resolve('ok') });
  return <div>{fetched}</div>;
}
`;

const CLEAN_TSX = `import React from 'react';
import { useQuery } from '@tanstack/react-query';

export function Clean({ data }: { data: string | null }) {
  // ✅ Hooks appelés inconditionnellement, AVANT le guard.
  const { data: fetched } = useQuery({ queryKey: ['x', data], queryFn: () => Promise.resolve('ok') });
  if (!data) {
    return <div>loading</div>;
  }
  return <div>{fetched}</div>;
}
`;

function runOxlint(...args) {
  try {
    const out = execFileSync(oxlintBin, args, { encoding: 'utf8', cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out };
  } catch (e) {
    // execFileSync throw sur exit ≠ 0 : on capture stdout+stderr pour analyse.
    return { ok: false, out: `${e.stdout ?? ''}\n${e.stderr ?? ''}` };
  }
}

const dir = mkdtempSync(join(tmpdir(), 'zentara-lint-hooks-'));
const buggyPath = join(dir, 'Buggy.tsx');
const cleanPath = join(dir, 'Clean.tsx');
writeFileSync(buggyPath, BUGGY_TSX);
writeFileSync(cleanPath, CLEAN_TSX);

let failed = false;
try {
  // 1) Le fichier buggy DOIT produire une erreur rules-of-hooks (config chargée).
  const buggy = runOxlint('--config', join(root, '.oxlintrc.json'), buggyPath);
  const caught = !buggy.ok && /rules-of-hooks/.test(buggy.out) && /not reachable on every render path/i.test(buggy.out);
  console.log(`[1/2] Buggy.tsx rejeté par react/rules-of-hooks : ${caught ? 'OK ✅' : 'ÉCHEC ❌'}`);
  if (!caught) {
    console.log('  sortie oxlint :\n' + buggy.out.split('\n').slice(-6).join('\n'));
    failed = true;
  }

  // 2) Le fichier propre ne doit PAS être signalé (aucune erreur du tout).
  const clean = runOxlint('--config', join(root, '.oxlintrc.json'), cleanPath);
  const accepted = clean.ok;
  console.log(`[2/2] Clean.tsx accepté (hooks avant guard) : ${accepted ? 'OK ✅' : 'ÉCHEC ❌'}`);
  if (!accepted) {
    console.log('  sortie oxlint :\n' + clean.out.split('\n').slice(-6).join('\n'));
    failed = true;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failed) {
  console.error('❌ Test de lint react/rules-of-hooks ÉCHOUÉ — le pattern interdit n\'est pas détecté.');
  process.exit(1);
}
console.log('✅ react/rules-of-hooks actif (config .oxlintrc.json) : hooks après return conditionnel interdits.');
