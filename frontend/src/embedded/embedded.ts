/**
 * embedded.ts — Point d'entrée du « backend embarqué » Zentara.
 *
 * L'application embarque désormais son propre moteur (données locales +
 * scoring déterministe + templates email + jobs async). Le mode embarqué est
 * actif par défaut dès qu'aucune URL serveur explicite n'est configurée :
 * l'APK fonctionne sans tunnel, sans serveur, même des années plus tard.
 */
import { handleLocalRequest, type LocalRouteResult } from './local-api';
import { ensureSeeded } from './store';

export { handleLocalRequest };
export type { LocalRouteResult };

/** Prépare la base locale (seed) au boot. */
export function bootstrapEmbeddedEngine(): void {
  try {
    ensureSeeded();
  } catch (e) {
    console.warn('[zentara/embedded] bootstrap échoué', e);
  }
}

/**
 * Mode embarqué actif quand :
 *   - aucune URL serveur n'est stockée (Settings → Backend vide), ET
 *   - soit on tourne sur Capacitor natif (APK), soit aucune VITE_API_BASE_URL
 *     n'est compilée dans le bundle.
 * Si l'utilisateur configure explicitement une URL serveur, on repasse en
 * mode distant (enrichissement web/IA), avec repli local si le serveur meurt.
 */
export function isEmbeddedMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const stored = localStorage.getItem('zentara.api.base');
    if (stored && stored.trim().length > 0) return false;
  } catch {
    /* ignore */
  }
  const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } };
  const isNative = Boolean(w.Capacitor?.isNativePlatform?.());
  if (isNative) return true;
  const envBase = import.meta.env?.VITE_API_BASE_URL as string | undefined;
  return !(envBase && envBase.trim().length > 0);
}
