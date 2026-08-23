/**
 * hash.ts — hash déterministe (FNV-1a double passe) pour les clés de cache locales.
 *
 * Garantie : même entrée sérialisée ⇒ même hash, quel que soit l'ordre des clés
 * (on trie les clés d'objet récursivement). Utilisé pour le `input_hash` des
 * analyses locales — la reproductibilité « mêmes données ⇒ mêmes statistiques »
 * en dépend. Pas besoin de crypto forte ici (clé de cache, pas de sécurité).
 */

function fnv1a(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Trie récursivement les clés d'un objet pour un JSON canonique stable. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      o[k] = sortKeys((v as Record<string, unknown>)[k]);
    }
    return o;
  }
  return v;
}

export function stableHash(input: string): string {
  const a = fnv1a(input, 0x811c9dc5);
  const b = fnv1a(input, 0x01000193);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** Hash déterministe d'un objet (JSON canonique à clés triées). */
export function stableHashObject(obj: unknown): string {
  return stableHash(JSON.stringify(sortKeys(obj)));
}
