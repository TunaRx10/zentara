import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(prefix: string): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `${prefix}_${random}`;
}

/**
 * Sérialise n'importe quelle valeur en string safe pour `.includes()` /
 * `.toLowerCase()`. Évite le `TypeError: ... .includes is not a function`
 * quand le backend renvoie un nombre, un array ou un objet au lieu d'une
 * string (schema drift, bigint, etc.).
 */
export function safeString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(safeString).join(' ');
  try {
    return String(value);
  } catch {
    return '';
  }
}

/**
 * `value.includes(query)` null-safe : utile dans les filtres de tableaux
 * où `value` peut venir d'un JSON avec un type inattendu.
 */
export function safeIncludes(value: unknown, query: string): boolean {
  if (!query) return true;
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) {
    return value.some((v) => safeIncludes(v, query));
  }
  return safeString(value).toLowerCase().includes(query.toLowerCase());
}

/**
 * Round 50 — coerces une valeur `tags` backend (string[] | string | null)
 * en string[] propre. Le backend stocke les tags en TEXT (`'[]'`),
 * et l'API renvoie soit un tableau déjà parsé, soit la string JSON.
 *
 * Ne throw jamais : retourne [] pour toute entrée non parsable.
 */
export function getTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((t): t is string => typeof t === 'string');
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === 'string');
    }
  } catch {
    // not JSON — could be a single legacy tag
    return [value];
  }
  return [];
}

/**
 * Round 50 — vérifie si une valeur `tags` contient un tag donné (case-insensitive).
 */
export function hasTag(tags: unknown, wanted: string): boolean {
  const list = getTags(tags);
  const w = wanted.toLowerCase();
  return list.some((t) => String(t).toLowerCase() === w);
}

/**
 * Normalise une valeur date (timestamp SQLite ms, ISO string, ou string
 * avec espace) en timestamp ms. Retourne NaN si non parsable.
 *
 * Le backend renvoie des timestamps numériques (epoch ms) pour la plupart
 * des colonnes created_at/detected_at — ne jamais appeler .includes/.split
 * directement sur ces valeurs.
 */
/**
 * Round 91 — parse défensivement la colonne JSON `quality` d'un prospect.
 * Renvoie un objet {email_validity, phone_reachability, decision_maker, overall}.
 * Si la chaîne est absente, vide, ou mal formée → renvoie `EMPTY_QUALITY`.
 */
export function parseQuality(raw: unknown): import('@/types').ContactQuality {
  const empty: import('@/types').ContactQuality = {
    email_validity: 0,
    phone_reachability: 0,
    decision_maker: 0,
    overall: 0,
  };
  if (typeof raw !== 'string' || !raw.trim()) return empty;
  try {
    const j = JSON.parse(raw);
    if (typeof j?.overall === 'number') {
      return {
        email_validity: typeof j.email_validity === 'number' ? j.email_validity : 0,
        phone_reachability: typeof j.phone_reachability === 'number' ? j.phone_reachability : 0,
        decision_maker: typeof j.decision_maker === 'number' ? j.decision_maker : 0,
        overall: j.overall,
      };
    }
  } catch { /* fallthrough */ }
  return empty;
}

/**
 * Round 91 — bucket UI pour un sub-score [0..1].
 *  - high (green):   >= 0.7
 *  - mid  (amber):   >= 0.4
 *  - low  (slate):   <  0.4
 */
export function qualityTier(value: number): 'high' | 'mid' | 'low' {
  if (value >= 0.7) return 'high';
  if (value >= 0.4) return 'mid';
  return 'low';
}

/** Round 91 — seuil global pour griser un prospect. */
export const GRAYSCALE_THRESHOLD = 0.5;

export function toDateMs(value: unknown): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string') return NaN;
  const s = value.trim();
  if (!s) return NaN;
  // string ISO (contient T) ou "YYYY-MM-DD HH:mm:ss" (espace)
  const iso = s.indexOf('T') !== -1 ? s : s.replace(' ', 'T');
  return new Date(iso).getTime();
}
