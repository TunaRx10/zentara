/**
 * RevenueProjectionCard — Carte de projection financière détaillée.
 * 
 * Affiche les projections de revenus pour une entité (prospect/company) :
 * - État actuel vs Avec Zentara
 * - Métriques : visites, leads, deals, CA
 * - ROI, payback, gain annuel
 * - Graphique de progression visuelle
 * - Hypothèses transparentes
 */
import React from 'react';
import { TrendingUp, Euro, Target, Calendar, AlertTriangle, CheckCircle2, ArrowUpRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RevenueProjection {
  currentMonthlyVisitors: number;
  currentMonthlyLeads: number;
  currentMonthlyDeals: number;
  currentMonthlyRevenue: number;
  projectedMonthlyLeads: number;
  projectedMonthlyDeals: number;
  projectedMonthlyRevenue: number;
  monthlyRevenueUplift: number;
  annualRevenueUplift: number;
  roiMultiple: number;
  paybackMonths: number;
  confidenceLevel: 'low' | 'medium' | 'high';
  assumptions: string[];
}

interface RevenueProjectionCardProps {
  projection: RevenueProjection;
  entityName: string;
  compact?: boolean;
  className?: string;
}

function formatEur(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M€`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)} k€`;
  return `${n.toLocaleString('fr-FR')} €`;
}

function formatNum(n: number): string {
  return n.toLocaleString('fr-FR');
}

const confidenceConfig = {
  high: { label: 'Confiance élevée', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30' },
  medium: { label: 'Confiance modérée', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/30' },
  low: { label: 'Confiance faible', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30' },
};

export function RevenueProjectionCard({
  projection,
  entityName,
  compact = false,
  className,
}: RevenueProjectionCardProps): React.ReactElement {
  const {
    currentMonthlyLeads,
    currentMonthlyDeals,
    currentMonthlyRevenue,
    projectedMonthlyLeads,
    projectedMonthlyDeals,
    projectedMonthlyRevenue,
    monthlyRevenueUplift,
    annualRevenueUplift,
    roiMultiple,
    paybackMonths,
    confidenceLevel,
    assumptions,
  } = projection;

  const conf = confidenceConfig[confidenceLevel];
  const leadGrowth = currentMonthlyLeads > 0 ? Math.round((projectedMonthlyLeads / currentMonthlyLeads - 1) * 100) : 0;
  const dealGrowth = currentMonthlyDeals > 0 ? Math.round((projectedMonthlyDeals / currentMonthlyDeals - 1) * 100) : 0;

  return (
    <div className={cn('rounded-2xl border border-border/60 bg-card/40 overflow-hidden', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-r from-emerald-500/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
              <TrendingUp size={16} />
            </div>
            <div>
              <h3 className="text-sm font-black tracking-tight">Projection financière</h3>
              <p className="text-[10px] text-muted-foreground">{entityName} · Estimation conservative</p>
            </div>
          </div>
          <span className={cn('text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border', conf.bg, conf.color)}>
            {conf.label}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Main KPI */}
        <div className="text-center py-2">
          <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">Gain annuel estimé</p>
          <p className="text-3xl font-black text-emerald-400">+{formatEur(annualRevenueUplift)}</p>
          <p className="text-xs text-muted-foreground mt-1">par an · +{formatEur(monthlyRevenueUplift)}/mois</p>
        </div>

        {/* Metrics comparison */}
        <div className="grid grid-cols-3 gap-2">
          <MetricComparison
            label="Leads/mois"
            current={currentMonthlyLeads}
            projected={projectedMonthlyLeads}
            growth={leadGrowth}
          />
          <MetricComparison
            label="Deals/mois"
            current={currentMonthlyDeals}
            projected={projectedMonthlyDeals}
            growth={dealGrowth}
          />
          <MetricComparison
            label="CA/mois"
            current={formatEur(currentMonthlyRevenue)}
            projected={formatEur(projectedMonthlyRevenue)}
            isText
          />
        </div>

        {/* Visual bar comparison */}
        {!compact && (
          <div className="space-y-2">
            <ComparisonBar label="Leads" current={currentMonthlyLeads} projected={projectedMonthlyLeads} color="bg-emerald-500" />
            <ComparisonBar label="Deals" current={currentMonthlyDeals} projected={projectedMonthlyDeals} color="bg-blue-500" />
          </div>
        )}

        {/* ROI & Payback */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-border/60 bg-card/60 p-3 text-center">
            <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">ROI</p>
            <p className="text-xl font-black text-primary">{roiMultiple}x</p>
            <p className="text-[10px] text-muted-foreground">sur 12 mois</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/60 p-3 text-center">
            <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-1">Payback</p>
            <p className="text-xl font-black text-primary">{paybackMonths} mois</p>
            <p className="text-[10px] text-muted-foreground">remboursé</p>
          </div>
        </div>

        {/* Assumptions */}
        {!compact && assumptions.length > 0 && (
          <div className="rounded-lg border border-border/40 bg-secondary/20 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Info size={11} className="text-muted-foreground" />
              <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Hypothèses</p>
            </div>
            <ul className="space-y-1">
              {assumptions.slice(0, 3).map((a, i) => (
                <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                  <span className="text-primary mt-0.5">•</span>
                  {a}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricComparison({
  label,
  current,
  projected,
  growth,
  isText = false,
}: {
  label: string;
  current: number | string;
  projected: number | string;
  growth?: number;
  isText?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-2 text-center">
      <p className="text-[9px] uppercase tracking-widest font-bold text-muted-foreground mb-1">{label}</p>
      <p className="text-xs font-bold text-muted-foreground/70 line-through">{isText ? current : formatNum(current as number)}</p>
      <p className="text-sm font-black text-foreground">{isText ? projected : formatNum(projected as number)}</p>
      {growth !== undefined && growth > 0 && (
        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-400 mt-0.5">
          <ArrowUpRight size={10} /> +{growth}%
        </span>
      )}
    </div>
  );
}

function ComparisonBar({
  label,
  current,
  projected,
  color,
}: {
  label: string;
  current: number;
  projected: number;
  color: string;
}) {
  const max = Math.max(current, projected, 1);
  const currentPct = (current / max) * 100;
  const projectedPct = (projected / max) * 100;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-bold text-muted-foreground">{label}</span>
        <span className="text-muted-foreground">{current} → <span className="font-bold text-foreground">{projected}</span></span>
      </div>
      <div className="relative h-4 rounded-full bg-secondary/40 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/30 transition-all duration-500"
          style={{ width: `${currentPct}%` }}
        />
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-700', color)}
          style={{ width: `${projectedPct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[9px]">
        <span className="text-muted-foreground">Actuel</span>
        <span className="text-emerald-400 font-bold">Avec Zentara</span>
      </div>
    </div>
  );
}

export default RevenueProjectionCard;
