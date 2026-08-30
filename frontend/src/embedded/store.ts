/**
 * store.ts — Persistance locale du moteur embarqué (backend in-app).
 *
 * Tables JSON dans localStorage (stable dans la WebView Capacitor, aucun
 * serveur requis — l'application reste opérationnelle même après des années
 * sans backend distant). Première ouverture : seed depuis `seed-data.ts`
 * (snapshot de la base backend).
 */
import { SEED } from './seed-data';

const PREFIX = 'zh:emb:';
const SEEDED_KEY = PREFIX + 'seeded';
const SEED_VERSION_KEY = PREFIX + 'seedVersion';
const SEED_VERSION = 'v2-empty'; // bump pour forcer un reset de toutes les données

/** Si la version du seed a changé → wipe complet avant re-seed. */
function maybeWipeForNewVersion(): void {
  try {
    const stored = localStorage.getItem(SEED_VERSION_KEY);
    if (!stored || stored !== SEED_VERSION) {
      // Nouvelle version du seed → vider toutes les vieilles données
      embStore.clear();
      localStorage.removeItem(SEEDED_KEY);
      localStorage.setItem(SEED_VERSION_KEY, SEED_VERSION);
      console.info('[zentara/embedded] seed version bump → wipe complet');
    }
  } catch { /* ignore */ }
}

export type EmbTable =
  | 'users'
  | 'companies'
  | 'prospects'
  | 'contacts'
  | 'campaigns'
  | 'emails'
  | 'contracts'
  | 'intelligence'
  | 'jobs'
  | 'settings'
  | 'tasks'
  | 'signals'
  | 'breakdowns'
  | 'chat_messages';

function readRows(t: EmbTable): any[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(PREFIX + t);
    return raw ? (JSON.parse(raw) as any[]) : [];
  } catch {
    return [];
  }
}

function writeRows(t: EmbTable, rows: any[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PREFIX + t, JSON.stringify(rows));
  } catch (e) {
    console.error('[zentara/embedded] store write failed', t, e);
  }
}

export const embStore = {
  list<T = any>(t: EmbTable): T[] {
    return readRows(t) as T[];
  },
  get<T = any>(t: EmbTable, id: string): T | undefined {
    return readRows(t).find((r) => String(r.id) === String(id)) as T | undefined;
  },
  upsert<T = any>(t: EmbTable, row: T): void {
    const rows = readRows(t);
    const idx = rows.findIndex((r) => String(r.id) === String((row as any).id));
    if (idx >= 0) rows[idx] = { ...rows[idx], ...(row as any) };
    else rows.push(row as any);
    writeRows(t, rows);
  },
  remove(t: EmbTable, id: string): void {
    writeRows(t, readRows(t).filter((r) => String(r.id) !== String(id)));
  },
  replace(t: EmbTable, rows: any[]): void {
    writeRows(t, rows);
  },
  count(t: EmbTable): number {
    return readRows(t).length;
  },
  /** Vide toutes les tables (reset complet). */
  clear(): void {
    if (typeof localStorage === 'undefined') return;
    const tables: string[] = ['users', 'companies', 'prospects', 'contacts', 'campaigns', 'intelligence', 'emails', 'contracts', 'settings', 'signals', 'breakdowns'];
    for (const t of tables) {
      try { localStorage.removeItem(PREFIX + t); } catch { /* ignore */ }
    }
  },
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function genId(prefix: string): string {
  const rand = Math.random().toString(16).slice(2, 10);
  const ts = Date.now().toString(16).slice(-6);
  return `${prefix}_${rand}${ts}`;
}

export function isSeeded(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(SEEDED_KEY) === '1';
  } catch {
    return true;
  }
}

/** Seed la base locale une seule fois (première ouverture). */
export function ensureSeeded(): void {
  if (typeof localStorage === 'undefined') return;
  maybeWipeForNewVersion();
  if (isSeeded()) return;
  try {
    const src = SEED as any;
    const tables: EmbTable[] = ['users', 'companies', 'prospects', 'contacts', 'campaigns', 'intelligence', 'emails', 'contracts'];
    for (const t of tables) {
      const rows = src?.[t];
      if (Array.isArray(rows) && rows.length > 0 && embStore.count(t) === 0) {
        embStore.replace(t, rows);
      }
    }
    embStore.upsert('settings', { id: 'app', backend_mode: 'embedded', seeded_at: nowIso() });
    localStorage.setItem(SEEDED_KEY, '1');
    console.info(`[zentara/embedded] seed appliqué — ${embStore.count('companies')} companies, ${embStore.count('intelligence')} analyses`);
  } catch (e) {
    console.warn('[zentara/embedded] seed échoué (continu en mode vierge)', e);
    try { localStorage.setItem(SEEDED_KEY, '1'); } catch { /* ignore */ }
  }
}
