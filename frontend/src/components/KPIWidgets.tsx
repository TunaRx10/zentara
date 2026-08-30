/**
 * KPIWidgets — Widgets KPI réutilisables pour le dashboard.
 * 
 * Composants :
 * - KPICard : carte KPI avec tendance, icône, sparkline
 * - StatsGrid : grille responsive de KPIs
 * - FunnelWidget : entonnoir de conversion visuel
 * - ActivityHeatmap : activité hebdomadaire
 */
import React from 'react';
import { TrendingUp, TrendingDown, Minus, ArrowUpRight, ArrowDownRight, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KPICardProps {
  label: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  color?: 'lime' | 'blue' | 'purple' | 'amber' | 'emerald' | 'red';
  trend?: number[];
  className?: string;
}

const colorMap = {
  lime: { bg: 'bg-lime-500/10', border: 'border-lime-500/30', text: 'text-lime-400', glow: 'shadow-lime-500/5' },
  blue: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-400', glow: 'shadow-blue-500/5' },
  purple: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-400', glow: 'shadow-purple-500/5' },
  amber: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-400', glow: 'shadow-amber-500/5' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', glow: 'shadow-emerald-500/5' },
  red: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-400', glow: 'shadow-red-500/5' },
};

export function KPICard({
  label,
  value,
  change,
  changeLabel = 'vs mois dernier',
  icon,
  color = 'lime',
  trend,
  className,
}: KPICardProps): React.ReactElement {
  const colors = colorMap[color];
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <div className={cn(
      'group relative rounded-2xl border bg-card/50 p-4 overflow-hidden transition-all duration-300',
      'hover:bg-card/70 hover:scale-[1.02] hover:shadow-xl',
      colors.border,
      colors.glow,
      className,
    )}>
      {/* Background glow */}
      <div className={cn('absolute -top-12 -right-12 w-32 h-32 rounded-full blur-3xl opacity-20 transition-opacity group-hover:opacity-30', colors.bg)} />

      <div className="relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center', colors.bg)}>
            {icon && <span className={colors.text}>{icon}</span>}
          </div>
          {change !== undefined && (
            <div className={cn(
              'flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full',
              isPositive && 'bg-emerald-500/15 text-emerald-400',
              isNegative && 'bg-red-500/15 text-red-400',
              !isPositive && !isNegative && 'bg-secondary text-muted-foreground',
            )}>
              {isPositive && <ArrowUpRight size={12} />}
              {isNegative && <ArrowDownRight size={12} />}
              {isPositive ? '+' : ''}{change}%
            </div>
          )}
        </div>

        {/* Value */}
        <p className="text-2xl font-black tracking-tight">{typeof value === 'number' ? value.toLocaleString('fr-FR') : value}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>

        {/* Trend sparkline */}
        {trend && trend.length > 0 && (
          <div className="mt-3 h-8 flex items-end gap-0.5">
            {trend.map((v, i) => {
              const max = Math.max(...trend);
              const height = max > 0 ? (v / max) * 100 : 0;
              return (
                <div
                  key={i}
                  className={cn('flex-1 rounded-sm transition-all duration-300', colors.bg)}
                  style={{ height: `${Math.max(height, 8)}%`, opacity: 0.4 + (i / trend.length) * 0.6 }}
                />
              );
            })}
          </div>
        )}

        {/* Change label */}
        {change !== undefined && (
          <p className="text-[10px] text-muted-foreground/70 mt-2">{changeLabel}</p>
        )}
      </div>
    </div>
  );
}

// StatsGrid — grille responsive
interface StatsGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function StatsGrid({ children, columns = 4, className }: StatsGridProps): React.ReactElement {
  return (
    <div className={cn(
      'grid gap-3',
      columns === 2 && 'grid-cols-1 sm:grid-cols-2',
      columns === 3 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      columns === 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
      className,
    )}>
      {children}
    </div>
  );
}

// FunnelWidget — entonnoir de conversion
interface FunnelStage {
  label: string;
  value: number;
  color?: string;
}

interface FunnelWidgetProps {
  title: string;
  stages: FunnelStage[];
  className?: string;
}

export function FunnelWidget({ title, stages, className }: FunnelWidgetProps): React.ReactElement {
  const maxValue = Math.max(...stages.map(s => s.value), 1);
  const maxValueWidth = 90;

  return (
    <div className={cn('rounded-2xl border border-border/60 bg-card/40 p-4', className)}>
      <h4 className="text-sm font-black tracking-tight mb-4">{title}</h4>
      <div className="space-y-2">
        {stages.map((stage, i) => {
          const width = (stage.value / maxValue) * maxValueWidth;
          const conversionRate = i > 0 && stages[i - 1].value > 0
            ? Math.round((stage.value / stages[i - 1].value) * 100)
            : 100;

          return (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] font-medium text-foreground">{stage.label}</span>
                  <span className="text-[10px] font-bold text-muted-foreground">{stage.value.toLocaleString('fr-FR')}</span>
                </div>
                <div className="relative h-7 rounded-lg bg-secondary/30 overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-lg transition-all duration-700"
                    style={{
                      width: `${width}%`,
                      background: stage.color || `linear-gradient(135deg, #22c55e, #16a34a)`,
                    }}
                  />
                </div>
              </div>
              {i > 0 && (
                <span className="text-[10px] font-bold text-muted-foreground w-12 text-right">{conversionRate}%</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ActivityHeatmap — activité hebdomadaire
interface ActivityHeatmapProps {
  title?: string;
  data: number[][];
  rowLabels?: string[];
  colLabels?: string[];
  className?: string;
}

export function ActivityHeatmap({
  title = 'Activité',
  data,
  rowLabels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'],
  colLabels = ['S1', 'S2', 'S3', 'S4', 'S5'],
  className,
}: ActivityHeatmapProps): React.ReactElement {
  const flatData = data.flat();
  const maxVal = Math.max(...flatData, 1);

  return (
    <div className={cn('rounded-2xl border border-border/60 bg-card/40 p-4', className)}>
      <h4 className="text-sm font-black tracking-tight mb-3">{title}</h4>
      <div className="flex gap-1">
        {/* Row labels */}
        <div className="flex flex-col gap-1 pr-2">
          {rowLabels.slice(0, data.length).map((label, i) => (
            <div key={i} className="h-5 flex items-center justify-end">
              <span className="text-[9px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
        {/* Grid */}
        <div className="flex-1 flex flex-col gap-1">
          {data.map((row, i) => (
            <div key={i} className="flex gap-1 h-5">
              {row.slice(0, colLabels.length).map((val, j) => {
                const intensity = val / maxVal;
                return (
                  <div
                    key={j}
                    className="flex-1 rounded-sm transition-all duration-300 hover:scale-125"
                    style={{
                      background: `rgba(34, 197, 94, ${0.1 + intensity * 0.8})`,
                      boxShadow: intensity > 0.6 ? '0 0 8px rgba(34, 197, 94, 0.3)' : 'none',
                    }}
                    title={`${rowLabels[i]} · ${colLabels[j]}: ${val}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {/* Legend */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/30">
        <span className="text-[9px] text-muted-foreground">Faible</span>
        <div className="flex gap-0.5">
          {[0.1, 0.3, 0.5, 0.7, 0.9].map((opacity, i) => (
            <div
              key={i}
              className="w-4 h-3 rounded-sm"
              style={{ background: `rgba(34, 197, 94, ${opacity})` }}
            />
          ))}
        </div>
        <span className="text-[9px] text-muted-foreground">Élevé</span>
      </div>
    </div>
  );
}

export default KPICard;
