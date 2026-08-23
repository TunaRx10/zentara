/**
 * ImportDirectoryModal — recherche + import en masse depuis les annuaires
 * publics (SEC EDGAR / OpenCorporates) vers la table `companies`.
 *
 * Round 134 — réutilisable (CompaniesPage, etc.) :
 *   - GET  /api/search/external        → résultats annuaire
 *   - POST /api/search/external/import → création en masse (dédup par nom)
 */
import React from 'react';
import {
  Search,
  Loader2,
  X,
  Download,
  Check,
  Building2,
  AlertTriangle,
  ExternalLink,
  Globe,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import { useToast } from '@/contexts/ToastProvider';
import { cn } from '@/lib/utils';

interface DirectoryCompany {
  source: 'sec-edgar' | 'opencorporates';
  name: string;
  ticker: string | null;
  cik: string | null;
  company_number: string | null;
  jurisdiction: string | null;
  incorporation_date: string | null;
  url: string | null;
  matched_on: string;
}

interface ExternalResult {
  results: DirectoryCompany[];
  errors: Array<{ source: string; message: string }>;
}

const SOURCE_LABEL: Record<string, string> = {
  'sec-edgar': 'SEC EDGAR',
  opencorporates: 'OpenCorporates',
};

function dirKey(c: DirectoryCompany): string {
  return `${c.source}:${c.cik ?? c.company_number ?? c.name}`;
}

export function ImportDirectoryModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}): React.ReactElement | null {
  const api = getApiClient();
  const toast = useToast();

  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [external, setExternal] = React.useState<ExternalResult | null>(null);
  const [selected, setSelected] = React.useState<Record<string, DirectoryCompany>>({});

  // Reset quand on ferme.
  React.useEffect(() => {
    if (!open) {
      setQuery('');
      setExternal(null);
      setSelected({});
    }
  }, [open]);

  // HOOK — doit être déclaré AVANT tout return conditionnel (rules-of-hooks).
  const selectedItems = React.useMemo(() => Object.values(selected), [selected]);

  if (!open) return null;

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setExternal(null);
    setSelected({});
    try {
      const res = await api.get<ExternalResult>(ENDPOINTS.searchExternal, {
        query: { q, sources: 'sec-edgar,opencorporates', limit: 20 },
      });
      setExternal(res ?? { results: [], errors: [] });
    } catch (e) {
      toast.error(`Recherche impossible : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggle = (c: DirectoryCompany) => {
    const key = dirKey(c);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = c;
      return next;
    });
  };

  const handleImport = async () => {
    if (selectedItems.length === 0) return;
    setImporting(true);
    try {
      const res = await api.post<{ created: number; skipped: number; ids: string[] }>(
        ENDPOINTS.searchExternalImport,
        { items: selectedItems },
      );
      toast.success(
        `Importé : ${res.created} entreprise(s)${res.skipped > 0 ? `, ${res.skipped} doublon(s) ignoré(s)` : ''}.`,
      );
      onImported();
      onClose();
    } catch (e) {
      toast.error(`Import impossible : ${(e as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  const results = external?.results ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !importing && !loading) onClose();
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-primary" />
            <div>
              <h2 className="text-base font-black tracking-tight">Importer depuis les annuaires</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                SEC EDGAR (émetteurs US) · OpenCorporates (registre mondial)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={importing}
            aria-label="Fermer"
            className="h-8 w-8 rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input
                placeholder="Nom d'entreprise (ex: Apple, Stripe, SaaS)…"
                className="pl-9 bg-background/60"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && query.trim() && !loading) void runSearch();
                }}
                autoFocus
              />
            </div>
            <Button
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
              onClick={() => void runSearch()}
              disabled={loading || !query.trim()}
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
              <span className="ml-1.5">Chercher</span>
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {loading && (
            <div className="text-center py-10 text-muted-foreground">
              <Loader2 className="inline animate-spin mr-2" size={16} />
              Recherche…
            </div>
          )}

          {(external?.errors.length ?? 0) > 0 && (
            <div className="space-y-1">
              {external?.errors.map((e) => (
                <div
                  key={e.source}
                  className="flex items-center gap-2 text-[12px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md px-3 py-1.5"
                >
                  <AlertTriangle size={12} />
                  <span className="font-bold">{SOURCE_LABEL[e.source] ?? e.source}</span>
                  <span className="text-amber-300/80">{e.message}</span>
                </div>
              ))}
            </div>
          )}

          {external && results.length === 0 && (external.errors.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">Aucun résultat.</p>
          )}

          {results.map((c) => {
            const key = dirKey(c);
            const isSelected = !!selected[key];
            return (
              <div
                key={key}
                onClick={() => toggle(c)}
                className={cn(
                  'flex items-center gap-3 rounded-xl border p-3 transition-colors cursor-pointer',
                  isSelected
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-border/60 bg-background/40 hover:border-primary/40',
                )}
              >
                <span
                  className={cn(
                    'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                    isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground/40',
                  )}
                >
                  {isSelected && <Check size={12} />}
                </span>
                <div className="w-9 h-9 rounded-lg bg-secondary/60 text-muted-foreground flex items-center justify-center shrink-0">
                  <Building2 size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-bold truncate flex items-center gap-2 flex-wrap">
                    {c.name}
                    {c.ticker && (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                        {c.ticker}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">{SOURCE_LABEL[c.source]}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {[c.jurisdiction ? `jur. ${c.jurisdiction.toUpperCase()}` : null, c.incorporation_date]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </div>
                </div>
                {c.url && (
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Ouvrir la fiche source"
                    onClick={(e) => e.stopPropagation()}
                    className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/40 bg-secondary/20">
          <Button variant="outline" onClick={onClose} disabled={importing} className="border-border">
            Annuler
          </Button>
          <Button
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
            onClick={() => void handleImport()}
            disabled={importing || selectedItems.length === 0}
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            <span className="ml-1.5">Importer ({selectedItems.length})</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
