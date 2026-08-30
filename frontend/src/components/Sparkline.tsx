/**
 * Sparkline — graphe minimaliste inline SVG.
 *
 * Composant pur (pas de recharts) destiné aux KPI cards : trace une courbe
 * lissée sur 12 points avec :
 *   - polyline (path cubic-bezier) en accent color
 *   - remplissage gradient sous la courbe
 *   - point final mis en évidence
 *
 * Props :
 *   - series : 12 valeurs numériques (dérivées de la réalité ou déterministes)
 *   - accent : couleur de la courbe + dot final (CSS color, ex: 'text-emerald-500')
 *   - fillId : id unique pour le gradient (sinon collisions dans une même page)
 *
 * Le composant s'étire au parent (preserveAspectRatio="none") : on peut
 * donc lui donner n'importe quelle largeur/hauteur sans déformation
 * disgracieuse (la courbe reste proportionnelle à viewBox).
 *
 * Animation : optionnelle via `animate`. Utilise un stroke-dasharray pour
 * faire apparaître la courbe de gauche à droite. Couvre 600ms avec une
 * courbe ease-out pour un effet fin et discret.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export interface SparklineProps {
  /** Série de valeurs (12 par défaut, mais tolère 1..N). */
  series: number[];
  /** Couleur Tailwind text-* — ex: 'text-emerald-500'. Défaut 'currentColor'. */
  accent?: string;
  /** Id unique pour le <linearGradient>. Défaut = id stable. */
  fillId?: string;
  /** Hauteur en CSS. Défaut 'h-12' (≈48px). */
  className?: string;
  /** Anime la courbe au mount. Défaut false. */
  animate?: boolean;
}

const VIEWBOX_W = 100;
const VIEWBOX_H = 30;

function buildSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  // Catmull-Rom-ish : quadratique avec contrôle au milieu du segment.
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const cx = (p0.x + p1.x) / 2;
    const cy = (p0.y + p1.y) / 2;
    d += ` Q ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)}`;
  }
  d += ` T ${points[points.length - 1].x.toFixed(2)} ${points[points.length - 1].y.toFixed(2)}`;
  return d;
}

function buildAreaPath(linePath: string, lastY: number): string {
  // Ferme le path en bas pour remplir la zone sous la courbe.
  return `${linePath} L ${VIEWBOX_W} ${lastY} L 0 ${lastY} Z`;
}

export function Sparkline({
  series,
  accent = 'text-primary',
  fillId,
  className,
  animate = false,
}: SparklineProps): React.ReactElement {
  // Defensive : si la série est trop courte, on pad avec la valeur moyenne.
  const safeSeries =
    series.length >= 2
      ? series
      : Array.from({ length: 12 }, (_, i) => (series[0] ?? 0) + Math.sin(i / 2) * 0.1);

  const min = Math.min(...safeSeries);
  const max = Math.max(...safeSeries);
  const range = max - min || 1;
  // Padding haut/bas pour ne pas coller aux bords du viewBox.
  const padTop = 2;
  const padBottom = 2;
  const innerH = VIEWBOX_H - padTop - padBottom;

  const points = safeSeries.map((v, i) => ({
    x: (i / (safeSeries.length - 1)) * VIEWBOX_W,
    y: padTop + (1 - (v - min) / range) * innerH,
    value: v,
  }));

  const linePath = buildSmoothPath(points);
  const areaPath = buildAreaPath(linePath, VIEWBOX_H);
  const lastPoint = points[points.length - 1];

  const gid = fillId ?? `spark-grad-${Math.abs(series.join(',').length)}`;
  const dotId = `spark-dot-${Math.abs(series.join(',').length)}`;

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Trend over the last ${safeSeries.length} days`}
      className={cn('w-full', className ?? 'h-12')}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.35} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0.0} />
        </linearGradient>
      </defs>

      {/* Baseline (baseline = min, aid visuel discret). */}
      <line
        x1={0}
        y1={VIEWBOX_H - padBottom}
        x2={VIEWBOX_W}
        y2={VIEWBOX_H - padBottom}
        stroke="currentColor"
        strokeOpacity={0.06}
        strokeWidth={0.2}
      />

      {/* Area fill */}
      <path
        d={areaPath}
        fill={`url(#${gid})`}
        className={accent}
        opacity={1}
      />

      {/* Path principal */}
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={0.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(accent, animate && 'animate-spark')}
        style={
          animate
            ? ({
                strokeDasharray: 300,
                strokeDashoffset: 300,
                animation: 'spark-draw 700ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards',
              } as React.CSSProperties)
            : undefined
        }
      />

      {/* === Per-point tooltips (Round 22 — hover "Day N: X") ===
          On rend pour chaque point un <g> qui contient :
          - un `<title>` natif SVG (browser tooltip on hover)
          - un dot visible petit
          - un hit-area invisible plus large pour faciliter le hover.
          Chaque <g> grossit le dot au hover via le selector `g:hover .dot`. */}
      <g className="spark-points">
        {points.map((p, i) => (
          <g key={i} className="spark-point-group">
            {/* Tooltip natif (Round 22 de la spec). 1-based indexing : Day 1 = premier point. */}
            <title>{`Day ${i + 1}: ${p.value}`}</title>
            {/* Hit-area invisible (transparent) — plus large pour faciliter le hover. */}
            <circle
              cx={p.x}
              cy={p.y}
              r={2.2}
              fill="transparent"
              className="spark-hit"
            />
            {/* Dot visible qui grossit au hover. */}
            <circle
              cx={p.x}
              cy={p.y}
              r={0.6}
              fill="currentColor"
              className={cn('spark-dot', accent)}
              opacity={0.55}
            />
          </g>
        ))}
      </g>

      {/* Point final mis en évidence (par-dessus les tooltips). */}
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r={1.0}
        fill="currentColor"
        className={accent}
        aria-hidden="true"
      />
      <circle
        cx={lastPoint.x}
        cy={lastPoint.y}
        r={2.4}
        fill="currentColor"
        className={accent}
        opacity={0.18}
        aria-hidden="true"
      />
    </svg>
  );
}
