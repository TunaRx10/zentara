/**
 * useNetworkStatus — branchement central sur les events online/offline
 * navigateur ET les events custom émis par le client API.
 *
 * Round 8 — sync hybride.
 *   - `navigator.onLine` indique l'état OS/réseau.
 *   - Quand `apiClient` détecte une erreur réseau type `Failed to fetch`,
 *     il émet `zentara:network-status` avec `online: false` → on peut
 *     sur-réagir même si `navigator.onLine` est encore `true` (latence
 *     d'OS).
 *
 * Round 29 — anti-stale-DISCONNECTED :
 *   - Bug historique : si on flip online:false pendant un hoquet réseau
 *     (restart backend 5 s), le badge DISCONNECTED reste collé même après
 *     que les fetches suivants réussissent. Cause = les events of success
 *     n'étaient dispatchés qu'à partir du PREMIER fetch réussi, pas au
 *     mount de l'app.
 *   - Fix #1 : on dispatch online:true au mount.
 *   - Fix #2 : si online:false pendant plus de `STALE_RECOVERY_MS` sans
 *     être re-confirmé, on bascule online:true automatiquement. La
 *     prochaine requête (qui aura un fetch OK) confirmera.
 */
import { useEffect, useState, useCallback, useRef } from 'react';

export interface NetworkStatusHook {
  isOnline: boolean;
  lastTransitionAt: string | null;
  /** Force l'état (utile en debug). */
  setOnline: (value: boolean) => void;
}

const STALE_RECOVERY_MS = 30_000;

export function useNetworkStatus(): NetworkStatusHook {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine;
  });
  const [lastTransitionAt, setLastTransitionAt] = useState<string | null>(null);

  // Ces refs sont utilisées par le stale-recovery pour décider si la
  // transition online:false est encore "fraîche" (= dans les 30s).
  const wentOfflineAt = useRef<number | null>(null);
  const recoveryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const transition = useCallback((value: boolean) => {
    setIsOnline(value);
    setLastTransitionAt(new Date().toISOString());
    if (value === false) {
      wentOfflineAt.current = Date.now();
      // Armer le stale-recovery : si online:false est resté collé 30s
      // sans rafraîchissement, on rebascule online:true.
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
      recoveryTimer.current = setTimeout(() => {
        // On ne re-flip que si on est TOUJOURS offline après 30s.
        // À ce moment-là, c'est probablement un faux négatif (badge
        // DISCONNECTED bloqué) → on accepte de spéculer recovery.
        setIsOnline(true);
        setLastTransitionAt(new Date().toISOString());
        wentOfflineAt.current = null;
      }, STALE_RECOVERY_MS);
    } else {
      // online:true → on annule le stale-recovery en cours.
      wentOfflineAt.current = null;
      if (recoveryTimer.current) {
        clearTimeout(recoveryTimer.current);
        recoveryTimer.current = null;
      }
    }
  }, []);

  useEffect(() => {
    const onOnline = () => transition(true);
    const onOffline = () => transition(false);
    const onCustom = (ev: Event) => {
      const detail = (ev as CustomEvent<{ online: boolean }>).detail;
      if (!detail) return;
      transition(Boolean(detail.online));
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('zentara:network-status', onCustom);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('zentara:network-status', onCustom);
      if (recoveryTimer.current) clearTimeout(recoveryTimer.current);
    };
  }, [transition]);

  return { isOnline, lastTransitionAt, setOnline: transition };
}
