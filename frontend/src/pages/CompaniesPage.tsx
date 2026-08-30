/**
 * CompaniesPage — Page de gestion des entreprises, 100 % données BACKEND réelles.
 *
 * Source de vérité : GET /api/companies (back + routeur embarqué), enrichi par
 * useHotCompaniesQuery (GET /api/companies/hot-companies) qui expose le score
 * agrégé + les raisons. Aucune donnée inventée : si la base est vide, la page
 * affiche un état honnête + un lien vers le moteur.
 *
 * Boutons fonctionnels :
 *   - clic ligne → /companies/:id (fiche détaillée)
 *   - email / téléphone → mailto:/tel: si coordonnées réelles
 *   - filtres (recherche, statut, tri) agissent sur les données chargées
 */
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Plus,
  Building2,
  Mail,
  Phone,
  MoreVertical,
  ArrowUpDown,
  LayoutGrid,
  List,
  Star,
  ChevronRight,
  Zap,
  ExternalLink,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCompaniesQuery, useHotCompaniesQuery } from '@/hooks/useBackendData';
import type { Company } from '@/types';

/** Score agrégé (0-100) exposé par /api/companies/hot-companies. */
interface HotRow {
  id: string;
  aggregate_score?: number;
  prospect_count?: number;
  prospect_avg_score?: number;
  hot_prospect_count?: number;
  recent_signals?: boolean;
  recent_analysis?: boolean;
  reasons?: string[];
}

function parseTags(tags?: string[] | string | null): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  try {
    const p = JSON.parse(tags);
    return Array.isArray(p) ? p : [tags];
  } catch {
    return [tags];
  }
}

function scoreColor(score: number | undefined): { text: string; bg: string; label: string } {
  const s = score ?? 0;
  if (s >= 70) return { text: 'text-emerald-400', bg: 'bg-emerald-500/15', label: 'Excellent' };
  if (s >= 40) return { text: 'text-amber-400', bg: 'bg-amber-500/15', label: 'Bon' };
  return { text: 'text-red-400', bg: 'bg-red-500/15', label: 'Faible' };
}

function statusBadge(status?: Company['status']): { label: string; color: string; bg: string; border: string } {
  switch (status) {
    case 'target':
      return { label: 'Cible', color: 'text-purple-400', bg: 'bg-purple-500/15', border: 'border-purple-500/30' };
    case 'inactive':
    case 'blacklisted':
      return { label: 'Inactif', color: 'text-muted-foreground', bg: 'bg-secondary/30', border: 'border-border/40' };
    case 'active':
      return { label: 'Active', color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30' };
    case 'new':
      return { label: 'Nouvelle', color: 'text-sky-400', bg: 'bg-sky-500/15', border: 'border-sky-500/30' };
    default:
      return { label: 'Nouvelle', color: 'text-sky-400', bg: 'bg-sky-500/15', border: 'border-sky-500/30' };
  }
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('fr-FR');
  } catch {
    return '—';
  }
}

type SortKey = 'score' | 'name' | 'updated';

export function CompaniesPage(): React.ReactElement {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  const { data: companies = [], isLoading, isError } = useCompaniesQuery();
  const { data: hot } = useHotCompaniesQuery({ minScore: 0, limit: 200, enabled: true });

  // Index score agrégé par company id (rollup local → robuste si hot-companies 404).
  const hotIndex = useMemo(() => {
    const idx = new Map<string, HotRow>();
    if (hot?.data && Array.isArray(hot.data)) {
      for (const r of hot.data) idx.set(String(r.id), r);
    }
    return idx;
  }, [hot]);

  const filtered = useMemo(() => {
    let result = [...companies];
    const hotRows = hotIndex;

    if (search) {
      const s = search.toLowerCase();
      result = result.filter((c) =>
        [c.name, c.sector, c.industry, c.city, c.country].some((k) =>
          String(k ?? '').toLowerCase().includes(s),
        ) ||
        parseTags(c.tags).some((t) => t.toLowerCase().includes(s)),
      );
    }

    if (statusFilter === 'hot' || statusFilter === 'warm' || statusFilter === 'cold') {
      // Statuts métier absent du type Company → on dérive chaud/tiède/froid du score agrégé.
      result = result.filter((c) => {
        const s = hotIndex.get(String(c.id))?.aggregate_score ?? c.score ?? 0;
        if (statusFilter === 'hot') return s >= 70;
        if (statusFilter === 'cold') return s < 40;
        return s >= 40 && s < 70;
      });
    } else if (statusFilter !== 'all') {
      result = result.filter((c) => (c.status ?? 'new') === statusFilter);
    }

    const getScore = (c: Company) => hotRows.get(String(c.id))?.aggregate_score ?? c.score ?? 0;
    result.sort((a, b) => {
      if (sortBy === 'score') return getScore(b) - getScore(a);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return String(b.updated_at).localeCompare(String(a.updated_at));
    });
    return result;
  }, [companies, search, statusFilter, sortBy, hotIndex]);

  const hotCount = companies.filter((c) => (hotIndex.get(String(c.id))?.aggregate_score ?? c.score ?? 0) >= 70).length;

  const openDetail = (id: string) => navigate(`/companies/${encodeURIComponent(id)}`);

  const renderTags = (c: Company) => {
    const tags = parseTags(c.tags);
    if (!tags.length) return null;
    return (
      <div className="flex items-center gap-1 mt-1">
        {tags.slice(0, 3).map((tag, i) => (
          <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground">
            {tag}
          </span>
        ))}
      </div>
    );
  };

  const cellScore = (c: Company) => {
    const agg = hotIndex.get(String(c.id))?.aggregate_score ?? c.score ?? 0;
    const sc = scoreColor(agg);
    return (
      <div className={cn('inline-flex items-center gap-1 px-2 py-1 rounded-full', sc.bg)}>
        <span className={cn('text-sm font-black', sc.text)}>{agg}</span>
        <span className={cn('text-[10px]', sc.text)}>/100</span>
      </div>
    );
  };

  const cellStatus = (c: Company) => {
    const s = statusBadge(c.status ?? 'new');
    return (
      <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border', s.bg, s.color, s.border)}>
        {s.label}
      </span>
    );
  };

  const actionButtons = (c: Company) => (
    <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
      {c.email && (
        <a
          href={`mailto:${c.email}`}
          title={c.email}
          className="w-7 h-7 rounded-lg bg-secondary/50 hover:bg-primary/15 text-muted-foreground hover:text-primary flex items-center justify-center transition-colors"
        >
          <Mail size={12} />
        </a>
      )}
      {c.phone && (
        <a
          href={`tel:${c.phone}`}
          title={c.phone}
          className="w-7 h-7 rounded-lg bg-secondary/50 hover:bg-emerald-500/15 text-muted-foreground hover:text-emerald-400 flex items-center justify-center transition-colors"
        >
          <Phone size={12} />
        </a>
      )}
      <button
        className="w-7 h-7 rounded-lg bg-secondary/50 hover:bg-secondary text-muted-foreground hover:text-primary flex items-center justify-center transition-colors"
        onClick={() => setSelectedCompany(c.id === selectedCompany ? null : c.id)}
        title="Actions"
      >
        <MoreVertical size={12} />
      </button>
    </div>
  );

  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Entreprises</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Chargement…' : `${filtered.length} entreprise(s) réelle(s) · ${hotCount} chaude(s)`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate('/chat')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-primary/40 bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
            title="Lancer le moteur de recherche"
          >
            <Zap size={14} /> Lancer le moteur
          </button>
          <button
            onClick={() => navigate('/campaigns')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
          >
            <Plus size={14} /> Campagne
          </button>
        </div>
      </div>

      {/* Filters bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une entreprise (nom, secteur, ville, tag)…"
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-border/50 bg-card/50 text-xs focus:outline-none focus:border-primary/50"
          />
        </div>

        <div className="flex rounded-xl border border-border/50 bg-card/50 p-0.5">
          {[
            { key: 'all', label: 'Tous' },
            { key: 'hot', label: 'Chaud' },
            { key: 'warm', label: 'Tiède' },
            { key: 'cold', label: 'Froid' },
            { key: 'target', label: 'Cible' },
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

        <button
          onClick={() => setSortBy(sortBy === 'score' ? 'name' : sortBy === 'name' ? 'updated' : 'score')}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowUpDown size={12} />
          {sortBy === 'score' ? 'Score' : sortBy === 'name' ? 'Nom' : 'Date'}
        </button>

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

      {isError && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
          Impossible de charger les entreprises depuis le backend. Vérifie la connexion, puis réessaie.
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' && !isLoading && (
        <div className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/40 bg-secondary/20">
                <th className="text-left px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Entreprise</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Score</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Statut</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Ajoutée</th>
                <th className="text-center px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((company) => (
                <tr
                  key={company.id}
                  className="border-b border-border/20 hover:bg-secondary/20 transition-colors cursor-pointer"
                  onClick={() => openDetail(company.id)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center font-black text-sm">
                        {company.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-bold flex items-center gap-1.5">
                          {company.name}
                          {(company.website || company.country) && (
                            <>
                              {company.website && <ExternalLink size={11} className="text-primary" />}
                              {company.country && <span className="text-[9px] text-muted-foreground">{company.country}</span>}
                            </>
                          )}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-[10px] text-muted-foreground">{company.sector ?? company.industry ?? 'Non classée'}</span>
                          {company.city && (
                            <>
                              <span className="text-[10px] text-muted-foreground">·</span>
                              <span className="text-[10px] text-muted-foreground">{company.city}</span>
                            </>
                          )}
                        </div>
                        {renderTags(company)}
                      </div>
                    </div>
                  </td>

                  <td className="px-4 py-3 text-center">{cellScore(company)}</td>
                  <td className="px-4 py-3 text-center">{cellStatus(company)}</td>
                  <td className="px-4 py-3 text-center text-[11px] text-muted-foreground">{formatDate(company.created_at)}</td>
                  <td className="px-4 py-3">{actionButtons(company)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Grid view */}
      {viewMode === 'grid' && !isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((company) => {
            const agg = hotIndex.get(String(company.id))?.aggregate_score ?? company.score ?? 0;
            const sc = scoreColor(agg);
            const s = statusBadge(company.status ?? 'new');
            return (
              <div
                key={company.id}
                onClick={() => openDetail(company.id)}
                className="rounded-2xl border border-border/60 bg-card/40 p-4 hover:bg-card/60 hover:scale-[1.02] transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black">
                      {company.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold">{company.name}</h3>
                      <p className="text-[10px] text-muted-foreground">
                        {company.sector ?? company.industry ?? 'Non classée'}
                        {company.city ? ` · ${company.city}` : ''}
                      </p>
                    </div>
                  </div>
                  <span className={cn('text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border', s.bg, s.color, s.border)}>
                    {s.label}
                  </span>
                </div>

                <div className="flex items-center justify-between mb-3">
                  <div className={cn('flex items-center gap-1 px-2 py-1 rounded-full', sc.bg)}>
                    <Star size={10} className={sc.text} />
                    <span className={cn('text-sm font-black', sc.text)}>{agg}</span>
                    <span className={cn('text-[10px]', sc.text)}>/100</span>
                  </div>
                  {company.website && (
                    <a
                      href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                      title={company.website}
                    >
                      <ExternalLink size={9} /> Visiter
                    </a>
                  )}
                </div>

                {renderTags(company)}

                <div className="flex items-center justify-between pt-3 border-t border-border/30">
                  <span className="text-[10px] text-muted-foreground">Ajoutée le {formatDate(company.created_at)}</span>
                  <span className="flex items-center gap-0.5 text-[10px] font-bold text-primary" onClick={(e) => { e.stopPropagation(); openDetail(company.id); }}>
                    Fiche <ChevronRight size={11} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="rounded-2xl border border-border/60 bg-card/40 p-12 text-center">
          <Building2 size={40} className="mx-auto text-muted-foreground/30 mb-4 animate-pulse" />
          <p className="text-sm font-bold text-muted-foreground">Chargement des entreprises…</p>
        </div>
      )}

      {/* Empty / honest state */}
      {!isLoading && filtered.length === 0 && !isError && (
        <div className="rounded-2xl border border-border/60 bg-card/40 p-12 text-center">
          <Building2 size={48} className="mx-auto text-muted-foreground/30 mb-4" />
          <p className="text-lg font-bold text-muted-foreground">
            {companies.length === 0 ? 'Aucune entreprise en base' : 'Aucune entreprise ne correspond aux filtres'}
          </p>
          <p className="text-sm text-muted-foreground/70 mt-1">
            {companies.length === 0
              ? 'Lance le moteur pour trouver tes premières pistes réelles depuis les annuaires (SEC EDGAR, OpenStreetMap…).'
              : 'Modifie la recherche ou les filtres.'}
          </p>
          {companies.length === 0 && (
            <button
              onClick={() => navigate('/chat')}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
            >
              <ArrowRight size={14} /> Lancer le moteur de recherche
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default CompaniesPage;