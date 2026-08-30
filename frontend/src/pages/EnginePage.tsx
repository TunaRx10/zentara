/**
 * EnginePage — Page du moteur de scoring Zentara.
 * 
 * Fonctionnalités :
 * - Vue d'ensemble du moteur (50 critères, 8 catégories)
 * - Détail des catégories avec poids
 * - Configuration des seuils
 * - Benchmark sectoriel
 * - Historique des analyses
 * - Export de configuration
 */
import React, { useState } from 'react';
import {
  Zap,
  Settings,
  BarChart3,
  Target,
  TrendingUp,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Download,
  RotateCcw,
  Info,
  Layers,
  Gauge,
  Beaker,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Types
interface ScoringCategory {
  id: string;
  name: string;
  icon: React.ReactNode;
  weight: number;
  maxScore: number;
  description: string;
  criteria: number;
  benchmarks: {
    excellent: number;
    good: number;
    average: number;
    poor: number;
  };
  expanded?: boolean;
}

// Mock data — scoring engine configuration
const scoringCategories: ScoringCategory[] = [
  {
    id: 'digital_presence',
    name: 'Présence Digitale',
    icon: <Layers size={16} />,
    weight: 15,
    maxScore: 15,
    description: 'Site web, SEO, réseaux sociaux, contenu',
    criteria: 8,
    benchmarks: { excellent: 14, good: 10, average: 6, poor: 2 },
  },
  {
    id: 'data_quality',
    name: 'Qualité des Données',
    icon: <Database size={16} />,
    weight: 12,
    maxScore: 12,
    description: 'Exactitude, complétude, fraîcheur des données',
    criteria: 6,
    benchmarks: { excellent: 11, good: 8, average: 5, poor: 2 },
  },
  {
    id: 'engagement',
    name: 'Engagement',
    icon: <TrendingUp size={16} />,
    weight: 15,
    maxScore: 15,
    description: 'Taux d\'ouverture, réponses, interactions',
    criteria: 7,
    benchmarks: { excellent: 14, good: 10, average: 6, poor: 2 },
  },
  {
    id: 'firmographics',
    name: 'Firmographiques',
    icon: <Building size={16} />,
    weight: 10,
    maxScore: 10,
    description: 'Taille, secteur, localisation, revenus',
    criteria: 5,
    benchmarks: { excellent: 9, good: 7, average: 4, poor: 1 },
  },
  {
    id: 'intent_signals',
    name: 'Signaux d\'Intention',
    icon: <Target size={16} />,
    weight: 18,
    maxScore: 18,
    description: 'Visites pages pricing, recherches, comparaisons',
    criteria: 10,
    benchmarks: { excellent: 16, good: 12, average: 7, poor: 2 },
  },
  {
    id: 'buyer_fit',
    name: 'Buyer Fit',
    icon: <CheckCircle2 size={16} />,
    weight: 10,
    maxScore: 10,
    description: 'Adéquation ICP, budget, autorité, besoin',
    criteria: 5,
    benchmarks: { excellent: 9, good: 7, average: 4, poor: 1 },
  },
  {
    id: 'timing',
    name: 'Timing',
    icon: <Clock size={16} />,
    weight: 10,
    maxScore: 10,
    description: 'Annonces funding, recrutements, projets',
    criteria: 5,
    benchmarks: { excellent: 9, good: 7, average: 4, poor: 1 },
  },
  {
    id: 'competitive',
    name: 'Position Concurrentielle',
    icon: <Shield size={16} />,
    weight: 10,
    maxScore: 10,
    description: 'Parts de marché, différenciation, barrières',
    criteria: 4,
    benchmarks: { excellent: 9, good: 7, average: 4, poor: 1 },
  },
];

// Mock components for icons not imported
function Database({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5V19A9 3 0 0 0 21 19V5" /><path d="M3 12A9 3 0 0 0 21 12" />
    </svg>
  );
}

function Building({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01" /><path d="M16 6h.01" /><path d="M12 6h.01" /><path d="M12 10h.01" /><path d="M12 14h.01" /><path d="M16 10h.01" /><path d="M16 14h.01" /><path d="M8 10h.01" /><path d="M8 14h.01" />
    </svg>
  );
}

const recentAnalyses = [
  { id: '1', company: 'TechCorp SAS', score: 78, date: '2024-01-16', time: '14:32', status: 'completed' },
  { id: '2', company: 'InnoVation Group', score: 82, date: '2024-01-16', time: '11:15', status: 'completed' },
  { id: '3', company: 'DataFlow Solutions', score: 65, date: '2024-01-15', time: '16:48', status: 'completed' },
  { id: '4', company: 'GreenEnergy France', score: 45, date: '2024-01-15', time: '09:22', status: 'completed' },
  { id: '5', company: 'FinanceHub Pro', score: 35, date: '2024-01-14', time: '13:10', status: 'completed' },
];

export function EnginePage(): React.ReactElement {
  const [categories, setCategories] = useState(scoringCategories);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const toggleCategory = (id: string) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, expanded: !c.expanded } : c)),
    );
  };

  const totalCriteria = categories.reduce((s, c) => s + c.criteria, 0);
  const totalMaxScore = categories.reduce((s, c) => s + c.maxScore, 0);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Moteur de scoring</h1>
          <p className="text-sm text-muted-foreground">Configuration et performance</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <Download size={14} /> Export
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <RotateCcw size={14} /> Reset
          </button>
        </div>
      </div>

      {/* Engine overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} className="text-primary" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Critères</span>
          </div>
          <p className="text-2xl font-black">{totalCriteria}</p>
          <p className="text-[10px] text-muted-foreground">actifs</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Layers size={14} className="text-purple-400" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Catégories</span>
          </div>
          <p className="text-2xl font-black">{categories.length}</p>
          <p className="text-[10px] text-muted-foreground">configurées</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Gauge size={14} className="text-emerald-400" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Score max</span>
          </div>
          <p className="text-2xl font-black">{totalMaxScore}</p>
          <p className="text-[10px] text-muted-foreground">points</p>
        </div>
        <div className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center gap-2 mb-2">
            <Beaker size={14} className="text-amber-400" />
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Analyses</span>
          </div>
          <p className="text-2xl font-black">{recentAnalyses.length}</p>
          <p className="text-[10px] text-muted-foreground">cette semaine</p>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Categories list */}
        <div className="lg:col-span-2 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 size={16} className="text-primary" />
            <h2 className="text-sm font-black">Catégories de scoring</h2>
          </div>

          {categories.map((cat) => {
            const isExpanded = cat.expanded;
            const isSelected = selectedCategory === cat.id;

            return (
              <div
                key={cat.id}
                className={cn(
                  'rounded-2xl border transition-all duration-200',
                  isSelected
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border/60 bg-card/40 hover:bg-card/60',
                )}
              >
                {/* Header */}
                <button
                  onClick={() => {
                    toggleCategory(cat.id);
                    setSelectedCategory(isSelected ? null : cat.id);
                  }}
                  className="w-full flex items-center gap-3 p-4 text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-primary/15 text-primary flex items-center justify-center">
                    {cat.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold">{cat.name}</h3>
                      <span className="text-[10px] font-bold text-muted-foreground bg-secondary/50 px-1.5 py-0.5 rounded">
                        {cat.criteria} critères
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{cat.description}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-black">{cat.maxScore}</p>
                      <p className="text-[9px] text-muted-foreground">pts max</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-primary">{cat.weight}%</p>
                      <p className="text-[9px] text-muted-foreground">poids</p>
                    </div>
                    {isExpanded ? (
                      <ChevronDown size={16} className="text-muted-foreground" />
                    ) : (
                      <ChevronRight size={16} className="text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t border-border/30">
                    <div className="pt-3 space-y-3">
                      {/* Weight slider (visual only) */}
                      <div>
                        <div className="flex items-center justify-between text-[10px] mb-1">
                          <span className="text-muted-foreground">Poids dans le score global</span>
                          <span className="font-bold text-primary">{cat.weight}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-secondary/40 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-400 transition-all duration-500"
                            style={{ width: `${cat.weight}%` }}
                          />
                        </div>
                      </div>

                      {/* Benchmarks */}
                      <div>
                        <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
                          Benchmarks sectoriels
                        </p>
                        <div className="grid grid-cols-4 gap-2">
                          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2 text-center">
                            <p className="text-xs font-black text-emerald-400">{cat.benchmarks.excellent}+</p>
                            <p className="text-[9px] text-muted-foreground">Excellent</p>
                          </div>
                          <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-2 text-center">
                            <p className="text-xs font-black text-blue-400">{cat.benchmarks.good}+</p>
                            <p className="text-[9px] text-muted-foreground">Bon</p>
                          </div>
                          <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-center">
                            <p className="text-xs font-black text-amber-400">{cat.benchmarks.average}+</p>
                            <p className="text-[9px] text-muted-foreground">Moyen</p>
                          </div>
                          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-center">
                            <p className="text-xs font-black text-red-400">&lt;{cat.benchmarks.average}</p>
                            <p className="text-[9px] text-muted-foreground">Faible</p>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 pt-2">
                        <button className="flex items-center gap-1 text-[10px] font-bold text-primary hover:text-primary/80 transition-colors">
                          <Settings size={10} /> Configurer
                        </button>
                        <button className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors">
                          <Info size={10} /> Détails
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Recent analyses */}
        <div className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden h-fit">
          <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-r from-emerald-500/5 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
                <Clock size={16} />
              </div>
              <div>
                <h3 className="text-sm font-black">Analyses récentes</h3>
                <p className="text-[10px] text-muted-foreground">Dernières exécutions</p>
              </div>
            </div>
          </div>
          <div className="p-3 space-y-2">
            {recentAnalyses.map((analysis) => (
              <div
                key={analysis.id}
                className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-secondary/30 transition-colors cursor-pointer"
              >
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm',
                  analysis.score >= 70 ? 'bg-emerald-500/15 text-emerald-400' :
                  analysis.score >= 50 ? 'bg-amber-500/15 text-amber-400' :
                  'bg-red-500/15 text-red-400',
                )}>
                  {analysis.score}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{analysis.company}</p>
                  <p className="text-[10px] text-muted-foreground">{analysis.date} · {analysis.time}</p>
                </div>
                <CheckCircle2 size={14} className="text-emerald-400" />
              </div>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-border/30">
            <button className="w-full text-center text-[10px] font-bold text-primary hover:text-primary/80 transition-colors">
              Voir tout l'historique
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EnginePage;
