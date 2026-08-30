/**
 * Generic Skeleton primitive — shimmer placeholder pendant le lazy-load
 * ou la récupération de données.
 *
 * Utilisé par AiCenterSkeleton et tout autre écran qui souhaite
 * montrer une charpente pendant la résolution React.lazy + Suspense.
 *
 * Round 63 — créé en parallèle du code-split de AICenterPage.
 * Utilise Tailwind `animate-pulse` natif (pas d'inline keyframes).
 */
import React from 'react';
import { cn } from '@/lib/utils';

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Round 63 — variante pré-définie (h1, h2, text, circle) au lieu
   *  de calculer width/height à la main dans chaque cas d'usage. */
  variant?: 'text' | 'h1' | 'h2' | 'h3' | 'circle';
  /** Width override — accepte toutes les unités CSS (%, px, rem…). */
  width?: string | number;
  /** Height override — accepte toutes les unités CSS. */
  height?: string | number;
}

const VARIANT_DEFAULT: Record<
  NonNullable<SkeletonProps['variant']>,
  string
> = {
  text: 'w-full h-3',
  h1: 'w-3/4 h-7',
  h2: 'w-1/2 h-5',
  h3: 'w-1/3 h-4',
  circle: 'w-10 h-10 rounded-full',
};

export function Skeleton({
  className,
  variant = 'text',
  width,
  height,
  style,
  ...rest
}: SkeletonProps): React.ReactElement {
  const inlineStyle: React.CSSProperties = {
    ...(width !== undefined ? { width: typeof width === 'number' ? `${width}px` : width } : {}),
    ...(height !== undefined ? { height: typeof height === 'number' ? `${height}px` : height } : {}),
    ...style,
  };
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Chargement…"
      className={cn(
        'rounded-md bg-secondary/40 animate-pulse',
        VARIANT_DEFAULT[variant],
        className,
      )}
      style={inlineStyle}
      {...rest}
    />
  );
}
