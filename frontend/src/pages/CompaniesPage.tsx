/**
 * CompaniesPage — Page de gestion des entreprises enrichie.
 * 
 * Fonctionnalités :
 * - Liste des entreprises avec scoring et tags
 * - Filtres avancés (secteur, score, statut)
 * - Actions rapides (email, appel, analyse)
 * - Vue tableau / carte
 * - Tri par score, nom, date
 * - Indicateurs visuels de santé
 */
import React, { useState, useMemo } from 'react';
import {
  Search,
  Filter,
  Plus,
  Building2,
  TrendingUp,
  TrendingDown,
  Users,
  Mail,
  Phone,
  MoreVertical,
  ArrowUpDown,
  LayoutGrid,
  List,
  Star,
  ExternalLink,
  ChevronRight,
  Zap,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Types
interface Company {
  id: string;
  name: string;
  sector: string;
  score: number;
  maxScore: number;
  employees: string;
  website?: string;
  emailSent: number;
  emailsOpened: number;
  lastContact: string;
  status: 'hot' | 'warm' | 'cold' | 'inactive';
  projectedRevenue?: number;
  tags: string[];
  contacts: number;
}

// Mock data
const mockCompanies: Company[] = [
  {
    id: '1',
    name: 'TechCorp SAS',
    sector: 'SaaS',
    score: 78,
    maxScore: 100,
    employees: '50-200',
    website: 'techcorp.fr',
    emailSent: 5,
    emailsOpened: 4,
    lastContact: '2024-01-15',
    status: 'hot',
    projectedRevenue: 125000,
    tags: ['Premium', 'Tech', 'Decision maker'],
    contacts: 3,
  },
  {
    id: '2',
    name: 'DataFlow Solutions',
    sector: 'Data',
    score: 65,
    maxScore: 100,
    employees: '20-50',
    website: 'dataflow.io',
    emailSent: 3,
    emailsOpened: 2,
    lastContact: '2024-01-12',
    status: 'warm',
    projectedRevenue: 85000,
    tags: ['Startup', 'Growth'],
    contacts: 2,
  },
  {
    id: '3',
    name: 'InnoVation Group',
    sector: 'Conseil',
    score: 82,
    maxScore: 100,
    employees: '200-500',
    website: 'innovation-group.com',
    emailSent: 7,
    emailsOpened: 6,
    lastContact: '2024-01-16',
    status: 'hot',
    projectedRevenue: 210000,
    tags: ['Enterprise', 'Multi-site'],
    contacts: 5,
  },
  {
    id: '4',
    name: 'GreenEnergy France',
    sector: 'Énergie',
    score: 45,
    maxScore: 100,
    employees: '50-200',
    emailSent: 2,
    emailsOpened: 1,
    lastContact: '2024-01-08',
    status: 'cold',
    projectedRevenue: 45000,
    tags: ['Public sector'],
    contacts: 1,
  },
  {
    id: '5',
    name: 'LogiTrans Express',
    sector: 'Logistique',
    score: 71,
    maxScore: 100,
    employees: '20-50',
    website: 'logitrans.fr',
    emailSent: 4,
    emailsOpened: 3,
    lastContact: '2024-01-14',
    status: 'warm',
    projectedRevenue: 95000,
    tags: ['Transport', 'B2B'],
    contacts: 2,
  },
  {
    id: '6',
    name: 'FinanceHub Pro',
    sector: 'Fintech',
    score: 35,
    maxScore: 100,
    employees: '10-20',
    emailSent: 1,
    emailsOpened: 0,
    lastContact: '2023-12-20',
    status: 'inactive',
    tags: ['Early stage'],
    contacts: 1,
  },
];

const statusConfig = {
  hot: { label: 'Chaud', color: 'text-red-400', bg: 'bg-red-500/15', border: 'border-red-500/30' },
  warm: { label: 'Tiède', color: 'text-amber-400', bg: 'bg-amber-500/15', border: 'border-amber-500/30' },
  cold: { label: 'Froid', color: 'text-blue-400', bg: 'bg-blue-500/15', border: 'border-blue-500/30' },
  inactive: { label: 'Inactif', color: 'text-muted-foreground', bg: 'bg-secondary/30', border: 'border-border/40' },
};

const scoreConfig = {
  high: { label: 'Excellent', color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  mid: { label: 'Bon', color: 'text-amber-400', bg: 'bg-amber-500/15' },
  low: { label: 'Faible', color: 'text-red-400', bg: 'bg-red-500/15' },
};

function getScoreConfig(score: number) {
  if (score >= 70) return scoreConfig.high;
  if (score >= 40) return scoreConfig.mid;
  return scoreConfig.low;
}

function formatEur(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)} M€`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)} k€`;
  return `${n.toLocaleString('fr-FR')} €`;
}

export function CompaniesPage(): React.ReactElement {
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'lastContact'>('score');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  // Filter and sort companies
  const filteredCompanies = useMemo(() => {
    let result = mockCompanies;

    // Search
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(s) ||
          c.sector.toLowerCase().includes(s) ||
          c.tags.some((t) => t.toLowerCase().includes(s)),
      );
    }

    // Status filter
    if (statusFilter !== 'all') {
      result = result.filter((c) => c.status === statusFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (sortBy === 'score') return b.score - a.score;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return new Date(b.lastContact).getTime() - new Date(a.lastContact).getTime();
    });

    return result;
  }, [search, statusFilter, sortBy]);

  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Entreprises</h1>
          <p className="text-sm text-muted-foreground">{filteredCompanies.length} entreprises · {mockCompanies.filter(c => c.status === 'hot').length} chaudes</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors">
            <Plus size={14} /> Ajouter
          </button>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une entreprise..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-border/50 bg-card/50 text-xs focus:outline-none focus:border-primary/50"
          />
        </div>

        {/* Status filter */}
        <div className="flex rounded-xl border border-border/50 bg-card/50 p-0.5">
          {[
            { key: 'all', label: 'Tous' },
            { key: 'hot', label: 'Chaud' },
            { key: 'warm', label: 'Tiède' },
            { key: 'cold', label: 'Froid' },
            { key: 'inactive', label: 'Inactif' },
          ].map((s) => (
            <button
              key={s.key}
              onClick={() => setStatusFilter(s.key)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
                statusFilter === s.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <button
          onClick={() => setSortBy(sortBy === 'score' ? 'name' : sortBy === 'name' ? 'lastContact' : 'score')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowUpDown size={12} />
          {sortBy === 'score' ? 'Score' : sortBy === 'name' ? 'Nom' : 'Date'}
        </button>

        {/* View toggle */}
        <div className="flex rounded-xl border border-border/50 bg-card/50 p-0.5">
          <button
            onClick={() => setViewMode('table')}
            className={cn(
              'p-1.5 rounded-lg transition-all',
              viewMode === 'table' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
            )}
          >
            <List size={14} />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-1.5 rounded-lg transition-all',
              viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground',
            )}
          >
            <LayoutGrid size={14} />
          </button>
        </div>
      </div>

      {/* Table view */}
      {viewMode === 'table' && (
        <div className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/40 bg-secondary/20">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Entreprise</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Score</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Statut</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Projection</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Emails</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Contacts</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCompanies.map((company) => {
                const status = statusConfig[company.status];
                const score = getScoreConfig(company.score);
                return (
                  <tr
                    key={company.id}
                    className="border-b border-border/20 hover:bg-secondary/20 transition-colors cursor-pointer"
                    onClick={() => setSelectedCompany(company.id === selectedCompany ? null : company.id)}
                  >
                    {/* Company info */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-black text-sm">
                          {company.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-bold">{company.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">{company.sector}</span>
                            <span className="text-[10px] text-muted-foreground">·</span>
                            <span className="text-[10px] text-muted-foreground">{company.employees}</span>
                            {company.website && (
                              <>
                                <span className="text-[10px] text-muted-foreground">·</span>
                                <span className="text-[10px] text-primary">{company.website}</span>
                              </>
                            )}
                          </div>
                          {/* Tags */}
                          <div className="flex items-center gap-1 mt-1">
                            {company.tags.slice(0, 3).map((tag, i) => (
                              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground">
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Score */}
                    <td className="px-4 py-3 text-center">
                      <div className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full', score.bg)}>
                        <span className={cn('text-sm font-black', score.color)}>{company.score}</span>
                        <span className={cn('text-[10px]', score.color)}>/{company.maxScore}</span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border', status.bg, status.color, status.border)}>
                        {status.label}
                      </span>
                    </td>

                    {/* Projection */}
                    <td className="px-4 py-3 text-center">
                      {company.projectedRevenue ? (
                        <span className="text-xs font-bold text-emerald-400">{formatEur(company.projectedRevenue)}</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>

                    {/* Emails */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Mail size={10} className="text-muted-foreground" />
                        <span className="text-xs font-medium">
                          {company.emailsOpened}/{company.emailSent}
                        </span>
                      </div>
                    </td>

                    {/* Contacts */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Users size={10} className="text-muted-foreground" />
                        <span className="text-xs font-medium">{company.contacts}</span>
                      </div>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button className="w-7 h-7 rounded-lg bg-secondary/50 hover:bg-primary/15 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors">
                          <Mail size={12} />
                        </button>
                        <button className="w-7 h-7 rounded-lg bg-secondary/50 hover:bg-emerald-500/15 text-muted-foreground hover:text-emerald-400 flex items-center justify-center transition-colors">
                          <Phone size={12} />
                        </button>
                        <button className="w-7 h-7 rounded-lg bg-secondary/50 hover:bg-secondary text-muted-foreground flex items-center justify-center transition-colors">
                          <MoreVertical size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Grid view */}
      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredCompanies.map((company) => {
            const status = statusConfig[company.status];
            const score = getScoreConfig(company.score);
            return (
              <div
                key={company.id}
                className="rounded-2xl border border-border/60 bg-card/40 p-4 hover:bg-card/60 hover:scale-[1.02] transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black">
                      {company.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold">{company.name}</h3>
                      <p className="text-[10px] text-muted-foreground">{company.sector} · {company.employees}</p>
                    </div>
                  </div>
                  <span className={cn('text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border', status.bg, status.color, status.border)}>
                    {status.label}
                  </span>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <div className={cn('flex items-center gap-1 px-2 py-1 rounded-full', score.bg)}>
                    <Star size={10} className={score.color} />
                    <span className={cn('text-sm font-black', score.color)}>{company.score}</span>
                  </div>
                  {company.projectedRevenue && (
                    <div className="text-right">
                      <p className="text-[10px] text-muted-foreground">Projection</p>
                      <p className="text-sm font-bold text-emerald-400">{formatEur(company.projectedRevenue)}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-3">
                  {company.tags.slice(0, 2).map((tag, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-border/30">
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Mail size={9} /> {company.emailsOpened}/{company.emailSent}</span>
                    <span className="flex items-center gap-1"><Users size={9} /> {company.contacts}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="w-7 h-7 rounded-lg bg-secondary/50 hover:bg-primary/15 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors">
                      <Mail size={12} />
                    </button>
                    <button className="w-7 h-7 rounded-lg bg-secondary/50 hover:bg-emerald-500/15 text-muted-foreground hover:text-emerald-400 flex items-center justify-center transition-colors">
                      <Phone size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {filteredCompanies.length === 0 && (
        <div className="rounded-2xl border border-border/60 bg-card/40 p-12 text-center">
          <Building2 size={48} className="mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-lg font-bold text-muted-foreground">Aucune entreprise trouvée</p>
          <p className="text-sm text-muted-foreground/70 mt-1">Essayez de modifier vos filtres</p>
        </div>
      )}
    </div>
  );
}

export default CompaniesPage;
