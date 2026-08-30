/**
 * DashboardPage — Tableau de bord principal enrichi.
 * 
 * Rassemble :
 * - KPIs principaux avec tendances et sparklines
 * - Widgets d'activité (entonnoir, heatmap)
 * - Actions rapides intelligentes
 * - Dernières activités
 * - Graphiques de performance
 * - Alertes et notifications
 */
import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  Users,
  Building2,
  Target,
  Mail,
  Phone,
  Calendar,
  Activity,
  BarChart3,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  Zap,
  Filter,
  Download,
  RefreshCw,
  Bell,
  Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { KPICard, StatsGrid, FunnelWidget, ActivityHeatmap } from '@/components/KPIWidgets';
import { QuickActions } from '@/components/QuickActions';

// Mock data
const mockKPIs = [
  {
    label: 'Prospects actifs',
    value: 247,
    change: 12,
    icon: <Users size={18} />,
    color: 'lime' as const,
    trend: [120, 145, 168, 189, 210, 232, 247],
  },
  {
    label: 'Taux de conversion',
    value: '24.8%',
    change: 3.2,
    icon: <Target size={18} />,
    color: 'blue' as const,
    trend: [18, 19, 21, 22, 23, 24, 24.8],
  },
  {
    label: 'Pipeline valeur',
    value: '€1.2M',
    change: 18,
    icon: <TrendingUp size={18} />,
    color: 'emerald' as const,
    trend: [850, 920, 980, 1050, 1100, 1150, 1200],
  },
  {
    label: 'Deals clos',
    value: 38,
    change: -5,
    icon: <CheckCircle2 size={18} />,
    color: 'amber' as const,
    trend: [42, 40, 45, 43, 39, 41, 38],
  },
];

const mockFunnelStages = [
  { label: 'Visiteurs', value: 12450 },
  { label: 'Leads', value: 2847 },
  { label: 'Qualifiés', value: 892 },
  { label: 'Propositions', value: 234 },
  { label: 'Clos', value: 89 },
];

const mockActivityData = [
  [5, 8, 12, 7, 15, 3, 1],
  [6, 9, 14, 8, 12, 4, 2],
  [4, 7, 11, 9, 14, 5, 1],
  [7, 11, 16, 10, 18, 6, 2],
  [5, 9, 13, 8, 16, 4, 1],
  [8, 12, 18, 11, 20, 7, 3],
  [6, 10, 15, 9, 17, 5, 2],
];

const mockQuickActions = [
  {
    id: '1',
    type: 'email' as const,
    title: 'Suivi email - TechCorp',
    description: 'Pas de réponse depuis 5 jours',
    entity: 'TechCorp · Marie Dupont',
    priority: 'urgent' as const,
    dueIn: 'Hier',
    onExecute: () => console.log('Execute email followup'),
    onDismiss: () => console.log('Dismiss email followup'),
  },
  {
    id: '2',
    type: 'call' as const,
    title: 'Appeler DataFlow SAS',
    description: 'Décisionnaire identifié, prêt à avancer',
    entity: 'DataFlow SAS · Pierre Martin',
    priority: 'high' as const,
    dueIn: "Aujourd'hui",
    onExecute: () => console.log('Execute call'),
    onDismiss: () => console.log('Dismiss call'),
  },
  {
    id: '3',
    type: 'meeting' as const,
    title: 'RDV confirmé demain',
    entity: 'InnoVation · Julie Blanc',
    description: 'Démo produit · 14h00',
    priority: 'high' as const,
    dueIn: 'Demain 14h',
    onExecute: () => console.log('Execute meeting'),
    onDismiss: () => console.log('Dismiss meeting'),
  },
  {
    id: '4',
    type: 'task' as const,
    title: 'Préparer proposition',
    entity: 'GreenEnergy · Marc Leroy',
    description: 'Offre sur mesure à envoyer',
    priority: 'medium' as const,
    dueIn: 'Dans 2 jours',
    onExecute: () => console.log('Execute proposal'),
    onDismiss: () => console.log('Dismiss proposal'),
  },
  {
    id: '5',
    type: 'followup' as const,
    title: 'Relance devis',
    entity: 'LogiTrans · Sophie Moreau',
    description: 'Devis envoyé il y a 8 jours',
    priority: 'high' as const,
    dueIn: 'En retard',
    onExecute: () => console.log('Execute followup'),
    onDismiss: () => console.log('Dismiss followup'),
  },
];

interface ActivityItem {
  id: string;
  type: 'email' | 'call' | 'deal' | 'note' | 'meeting';
  title: string;
  entity: string;
  time: string;
  outcome?: 'positive' | 'neutral' | 'negative';
}

const mockRecentActivity: ActivityItem[] = [
  { id: '1', type: 'deal', title: 'Deal clos · 45k€', entity: 'TechCorp', time: 'Il y a 2h', outcome: 'positive' },
  { id: '2', type: 'email', title: 'Email ouvert', entity: 'DataFlow SAS', time: 'Il y a 3h', outcome: 'positive' },
  { id: '3', type: 'call', title: 'Appel effectué', entity: 'InnoVation', time: 'Il y a 5h', outcome: 'neutral' },
  { id: '4', type: 'meeting', title: 'RDV terminé', entity: 'GreenEnergy', time: 'Il y a 1j', outcome: 'positive' },
  { id: '5', type: 'note', title: 'Note ajoutée', entity: 'LogiTrans', time: 'Il y a 1j', outcome: 'neutral' },
];

const activityTypeConfig = {
  email: { icon: Mail, color: 'text-blue-400' },
  call: { icon: Phone, color: 'text-emerald-400' },
  deal: { icon: TrendingUp, color: 'text-purple-400' },
  note: { icon: Activity, color: 'text-amber-400' },
  meeting: { icon: Calendar, color: 'text-red-400' },
};

export function DashboardPage(): React.ReactElement {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Tableau de bord</h1>
          <p className="text-sm text-muted-foreground">Vue d'ensemble de votre activité</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Rechercher..."
              className="pl-9 pr-3 py-2 rounded-xl border border-border/50 bg-card/50 text-xs w-48 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
            />
          </div>
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
          {/* Actions */}
          <button
            onClick={handleRefresh}
            className={cn(
              'w-9 h-9 rounded-xl border border-border/50 bg-card/50 flex items-center justify-center text-muted-foreground hover:text-foreground transition-all',
              refreshing && 'animate-spin',
            )}
          >
            <RefreshCw size={16} />
          </button>
          <button className="w-9 h-9 rounded-xl border border-border/50 bg-card/50 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors relative">
            <Bell size={16} />
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[9px] font-bold text-white flex items-center justify-center">3</span>
          </button>
        </div>
      </div>

      {/* KPI Grid */}
      <StatsGrid columns={4}>
        {mockKPIs.map((kpi, i) => (
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
        {/* Left: Funnel + Activity */}
        <div className="lg:col-span-2 space-y-4">
          {/* Funnel */}
          <FunnelWidget
            title="Entonnoir de conversion"
            stages={mockFunnelStages}
          />

          {/* Activity Heatmap */}
          <ActivityHeatmap
            title="Activité des 7 dernières semaines"
            data={mockActivityData}
            rowLabels={['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']}
            colLabels={['S-5', 'S-4', 'S-3', 'S-2', 'S-1', 'S-0', '+1']}
          />

          {/* Recent Activity */}
          <div className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden">
            <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-r from-purple-500/5 to-transparent">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/15 text-purple-400 flex items-center justify-center">
                    <Activity size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-black tracking-tight">Activité récente</h3>
                    <p className="text-[10px] text-muted-foreground">Dernières interactions</p>
                  </div>
                </div>
                <button className="text-[10px] font-bold text-primary hover:text-primary/80 flex items-center gap-1">
                  Voir tout <ArrowUpRight size={10} />
                </button>
              </div>
            </div>
            <div className="p-3 space-y-2">
              {mockRecentActivity.map((item) => {
                const config = activityTypeConfig[item.type];
                const Icon = config.icon;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-secondary/30 transition-colors"
                  >
                    <div className={cn('w-8 h-8 rounded-lg bg-secondary/40 flex items-center justify-center', config.color)}>
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{item.title}</p>
                      <p className="text-[10px] text-muted-foreground">{item.entity}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.outcome === 'positive' && (
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded">+</span>
                      )}
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{item.time}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Quick Actions + Alerts */}
        <div className="space-y-4">
          <QuickActions actions={mockQuickActions} />

          {/* Performance summary */}
          <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={14} className="text-primary" />
              <h4 className="text-sm font-black">Performance</h4>
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-muted-foreground">Objectif mensuel</span>
                  <span className="font-bold">72%</span>
                </div>
                <div className="h-2 rounded-full bg-secondary/40 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400" style={{ width: '72%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-muted-foreground">Emails envoyés</span>
                  <span className="font-bold">156/200</span>
                </div>
                <div className="h-2 rounded-full bg-secondary/40 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400" style={{ width: '78%' }} />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-muted-foreground">RDV planifiés</span>
                  <span className="font-bold">18/25</span>
                </div>
                <div className="h-2 rounded-full bg-secondary/40 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-purple-400" style={{ width: '72%' }} />
                </div>
              </div>
            </div>
          </div>

          {/* Alerts */}
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle size={14} className="text-amber-400" />
              <h4 className="text-sm font-black text-amber-400">Alertes</h4>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-[11px]">
                <Clock size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <span className="text-foreground">3 prospects chauds sans activité depuis +5 jours</span>
              </div>
              <div className="flex items-start gap-2 text-[11px]">
                <Clock size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <span className="text-foreground">2 devis en attente de réponse (J+8)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
