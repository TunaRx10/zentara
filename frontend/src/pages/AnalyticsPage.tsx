/**
 * AnalyticsPage — Page d'analytiques avancées.
 * 
 * Fonctionnalités :
 * - Vue d'ensemble des performances
 * - Graphiques de tendances (emails, calls, deals)
 * - Analyse par secteur
 * - Comparaison période
 * - Top performers
 * - Métriques d'engagement
 */
import React, { useState } from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Target,
  Mail,
  Phone,
  Calendar,
  Users,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
  Download,
  PieChart as PieChartIcon,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatsGrid, KPICard } from '@/components/KPIWidgets';

// Mock data
const overviewKPIs = [
  { label: 'Taux d\'ouverture', value: '42.3%', change: 5.2, icon: <Mail size={18} />, color: 'blue' as const, trend: [35, 37, 38, 40, 41, 42, 42.3] },
  { label: 'Taux de réponse', value: '12.8%', change: 2.1, icon: <Target size={18} />, color: 'lime' as const, trend: [8, 9, 10, 11, 11.5, 12, 12.8] },
  { label: 'Deals générés', value: 38, change: 18, icon: <TrendingUp size={18} />, color: 'emerald' as const, trend: [25, 28, 30, 32, 34, 36, 38] },
  { label: 'Pipeline créé', value: '€1.2M', change: 24, icon: <Activity size={18} />, color: 'purple' as const, trend: [800, 850, 920, 980, 1050, 1100, 1200] },
];

const sectorData = [
  { sector: 'SaaS', prospects: 68, conversion: 28, revenue: 340, hotPercent: 35 },
  { sector: 'Data', prospects: 42, conversion: 22, revenue: 220, hotPercent: 28 },
  { sector: 'Conseil', prospects: 55, conversion: 18, revenue: 410, hotPercent: 22 },
  { sector: 'Énergie', prospects: 31, conversion: 15, revenue: 180, hotPercent: 18 },
  { sector: 'Fintech', prospects: 28, conversion: 25, revenue: 290, hotPercent: 32 },
  { sector: 'Logistique', prospects: 23, conversion: 20, revenue: 150, hotPercent: 20 },
];

const weeklyData = [
  { day: 'Lun', emails: 45, calls: 12, meetings: 3 },
  { day: 'Mar', emails: 52, calls: 15, meetings: 4 },
  { day: 'Mer', emails: 38, calls: 10, meetings: 5 },
  { day: 'Jeu', emails: 61, calls: 18, meetings: 6 },
  { day: 'Ven', emails: 48, calls: 14, meetings: 4 },
  { day: 'Sam', emails: 12, calls: 3, meetings: 1 },
  { day: 'Dim', emails: 5, calls: 1, meetings: 0 },
];

const topPerformers = [
  { name: 'TechCorp SAS', score: 78, deals: 3, revenue: 125, status: 'hot' },
  { name: 'InnoVation Group', score: 82, deals: 4, revenue: 210, status: 'hot' },
  { name: 'DataFlow Solutions', score: 65, deals: 2, revenue: 85, status: 'warm' },
  { name: 'LogiTrans Express', score: 71, deals: 2, revenue: 95, status: 'warm' },
  { name: 'GreenEnergy France', score: 45, deals: 1, revenue: 45, status: 'cold' },
];

export function AnalyticsPage(): React.ReactElement {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [selectedMetric, setSelectedMetric] = useState<'emails' | 'calls' | 'meetings'>('emails');

  const maxMetricValue = Math.max(...weeklyData.map((d) => d[selectedMetric]));

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Analytiques</h1>
          <p className="text-sm text-muted-foreground">Performance et insights</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Time range */}
          <div className="flex rounded-xl border border-border/50 bg-card/50 p-0.5">
            {(['7d', '30d', '90d'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                  timeRange === range
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {range === '7d' ? '7 jours' : range === '30d' ? '30 jours' : '90 jours'}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* Overview KPIs */}
      <StatsGrid columns={4}>
        {overviewKPIs.map((kpi, i) => (
          <KPICard
            key={i}
            label={kpi.label}
            value={kpi.value}
            change={kpi.change}
            icon={kpi.icon}
            color={kpi.color}
            trend={kpi.trend}
          />
        ))}
      </StatsGrid>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Weekly activity chart */}
        <div className="lg:col-span-2 rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-primary" />
              <h3 className="text-sm font-black">Activité hebdomadaire</h3>
            </div>
            <div className="flex rounded-lg border border-border/50 bg-secondary/30 p-0.5">
              {[
                { key: 'emails', label: 'Emails', color: 'bg-blue-500' },
                { key: 'calls', label: 'Appels', color: 'bg-emerald-500' },
                { key: 'meetings', label: 'RDV', color: 'bg-purple-500' },
              ].map((m) => (
                <button
                  key={m.key}
                  onClick={() => setSelectedMetric(m.key as typeof selectedMetric)}
                  className={cn(
                    'px-2 py-1 rounded text-[10px] font-bold transition-all',
                    selectedMetric === m.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Simple bar chart */}
          <div className="flex items-end gap-2 h-48 px-2">
            {weeklyData.map((d, i) => {
              const value = d[selectedMetric];
              const height = (value / maxMetricValue) * 100;
              const colors = {
                emails: 'bg-blue-500',
                calls: 'bg-emerald-500',
                meetings: 'bg-purple-500',
              };
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[10px] font-bold text-muted-foreground">{value}</span>
                  <div
                    className={cn('w-full rounded-t-lg transition-all duration-500', colors[selectedMetric])}
                    style={{ height: `${height}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground">{d.day}</span>
                </div>
              );
            })}
          </div>

          {/* Summary */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/30">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <p className="text-lg font-black">{weeklyData.reduce((s, d) => s + d.emails, 0)}</p>
                <p className="text-[9px] text-muted-foreground">Emails</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-black">{weeklyData.reduce((s, d) => s + d.calls, 0)}</p>
                <p className="text-[9px] text-muted-foreground">Appels</p>
              </div>
              <div className="text-center">
                <p className="text-lg font-black">{weeklyData.reduce((s, d) => s + d.meetings, 0)}</p>
                <p className="text-[9px] text-muted-foreground">RDV</p>
              </div>
            </div>
          </div>
        </div>

        {/* Top performers */}
        <div className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-r from-amber-500/5 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center">
                <TrendingUp size={16} />
              </div>
              <div>
                <h3 className="text-sm font-black">Top performers</h3>
                <p className="text-[10px] text-muted-foreground">Par revenus générés</p>
              </div>
            </div>
          </div>
          <div className="p-3 space-y-2">
            {topPerformers.map((p, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl p-2 hover:bg-secondary/30 transition-colors">
                <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs font-black flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground">{p.deals} deals · Score {p.score}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-emerald-400">{p.revenue}k€</p>
                  <span className={cn(
                    'text-[9px] font-bold uppercase',
                    p.status === 'hot' ? 'text-red-400' : p.status === 'warm' ? 'text-amber-400' : 'text-blue-400',
                  )}>
                    {p.status === 'hot' ? 'Chaud' : p.status === 'warm' ? 'Tiède' : 'Froid'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sector analysis */}
      <div className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden">
        <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-r from-purple-500/5 to-transparent">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center">
              <PieChartIcon size={16} />
            </div>
            <div>
              <h3 className="text-sm font-black">Analyse par secteur</h3>
              <p className="text-[10px] text-muted-foreground">{sectorData.length} secteurs actifs</p>
            </div>
          </div>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sectorData.map((sector, i) => (
              <div key={i} className="rounded-xl border border-border/40 bg-card/60 p-3 hover:bg-card/80 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-bold">{sector.sector}</h4>
                  <span className="text-[10px] font-bold text-muted-foreground">{sector.prospects} prospects</span>
                </div>
                <div className="space-y-2">
                  <div>
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <span className="text-muted-foreground">Conversion</span>
                      <span className="font-bold text-emerald-400">{sector.conversion}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${sector.conversion}%` }} />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[10px] mb-0.5">
                      <span className="text-muted-foreground">Prospects chauds</span>
                      <span className="font-bold text-red-400">{sector.hotPercent}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                      <div className="h-full rounded-full bg-red-500" style={{ width: `${sector.hotPercent}%` }} />
                    </div>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-border/30">
                  <p className="text-[10px] text-muted-foreground">Revenus générés</p>
                  <p className="text-sm font-black text-primary">{sector.revenue}k€</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnalyticsPage;
