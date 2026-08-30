/**
 * useShowMore — Round 25.
 *
 * Hook générique pour implémenter la pagination progressive (bouton
 * "Load more") sur des listes déjà filtrées côté React.
 *
 * Comportement :
 *  - Initiale : `step` premiers items visibles.
 *  - À chaque appel de `showMore()` : +`step` items visibles.
 *  - Reset automatique : dès que la liste passée en argument change
 *    (filtre, recherche, tri), on revient à `step` visibles. C'est
 *    le bon comportement UX : un nouveau contexte = nouvelle première
 *    page.
 *
 * Returns :
 *  - `visible`             : T[] — items à afficher (déjà découpés).
 *  - `hasMore`             : boolean — true s'il reste des items à charger.
 *  - `showMore()`          : () => void — handler du bouton Load more.
 *  - `setVisibleCount(n)`  : (n) => void — Round 57 : setter direct pour
 *                            les drill-downs (jump-to-index sans N clics).
 *  - `shown`               : number — items actuellement visibles.
 *  - `total`               : number — items total dans la liste filtrée.
 *  - `step`                : number — taille d'incrément.
 *  - `remaining`           : number — combien restent après les visibles.
 */
import { useEffect, useState, useCallback } from 'react';

export interface UseShowMoreResult<T> {
  visible: T[];
  hasMore: boolean;
  showMore: () => void;
  /** Round 57 — set direct (par ex. drill-down : setVisibleCount(targetIndex + 1)). */
  setVisibleCount: (n: number) => void;
  shown: number;
  total: number;
  step: number;
  remaining: number;
}

export function useShowMore<T>(items: T[], step = 5): UseShowMoreResult<T> {
  const [visibleCount, setVisibleCount] = useState<number>(step);

  // Reset dès que la liste filtrée change (référence) → UX « back to page 1 ».
  useEffect(() => {
    setVisibleCount(step);
  }, [items, step]);

  const safeStep = Math.max(1, step);
  const visible = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;
  const showMore = useCallback(() => {
    setVisibleCount((curr) => Math.min(curr + safeStep, items.length));
  }, [safeStep, items.length]);
  // Round 57 — setter direct, borné à [0, items.length].
  const setVisibleCountBounded = useCallback((n: number) => {
    setVisibleCount(Math.max(0, Math.min(n, items.length)));
  }, [items.length]);

  return {
    visible,
    hasMore,
    showMore,
    setVisibleCount: setVisibleCountBounded,
    shown: visible.length,
    total: items.length,
    step: safeStep,
    remaining: Math.max(0, items.length - visible.length),
  };
}
