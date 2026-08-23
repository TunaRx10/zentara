/**
 * KnowledgePage — UI front pour la base de connaissances RAG.
 *
 * Permet à l'utilisateur :
 *  - d'ingérer des notes (notes de veille, transcripts, etc.),
 *  - de tester la recherche par similarité cosinus,
 *  - de voir les stats globales.
 *  - **Round 60** : suppression individuelle de chaque chunk RAG via icône 🗑
 *    dans la liste des résultats de recherche.
 *
 * Round 8 — sync hybride frontend ↔ backend (calls /api/knowledge/*).
 */
import React from 'react';
import { BookOpen, Plus, Search, Trash2, Loader2, Database, Sparkles, Tag, Hash, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { knowledgeService } from '@/services/knowledge/knowledge.service';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useToast } from '@/contexts/ToastProvider';
import { ZentaraApiError } from '@/services/api/client';
import type { KnowledgeStats, KnowledgeSearchResponse } from '@/services/api/types';

/**
 * Round 23 — Friendly error message based on error code.
 */
function friendlyError(e: unknown): string {
  if (e instanceof ZentaraApiError) {
    if (e.code === 'NETWORK_UNAVAILABLE' || e.code === 'TIMEOUT') {
      return 'Backend injoignable — vérifie le service (port 4000).';
    }
    if (e.code === 'RATE_LIMITED') {
      return 'Trop de requêtes — réessaie dans 30s.';
    }
    return `[${e.code}] ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return 'Erreur inconnue.';
}

export function KnowledgePage() {
  const { isOnline } = useNetworkStatus();
  const toast = useToast();
  const [stats, setStats] = React.useState<KnowledgeStats | null>(null);
  const [statsMissing, setStatsMissing] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [tags, setTags] = React.useState('');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<KnowledgeSearchResponse | null>(null);
  const [isIngesting, setIsIngesting] = React.useState(false);
  const [isSearching, setIsSearching] = React.useState(false);
  const [message, setMessage] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ============================================================
  // Round 60 — suppression d'un chunk RAG.
  // ============================================================
  const [pendingDeleteChunk, setPendingDeleteChunk] = React.useState<{
    chunk_id: string;
    title: string;
  } | null>(null);

  const refreshStats = React.useCallback(async () => {
    if (!isOnline) return;
    try {
      const s = await knowledgeService.getStats();
      setStats(s);
      setStatsMissing(false);
    } catch (e) {
      if (e instanceof ZentaraApiError && e.code === 'NOT_FOUND') {
        setStatsMissing(true);
        setStats({
          total: 0,
          by_source: { note: 0, manual: 0, url: 0, pdf: 0, doc: 0 },
          by_kind: {},
          dim: 0,
          embedding_backend: 'hash-v1',
          total_chars: 0,
        });
        return;
      }
      setMessage({ kind: 'err', text: friendlyError(e) });
    }
  }, [isOnline]);

  const handleIngest = React.useCallback(async () => {
    if (!note.trim()) return;
    setIsIngesting(true);
    try {
      const r = await knowledgeService.ingestNote(note, {
        title: title.trim() || undefined,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setMessage({
        kind: 'ok',
        text: `Chunk ing\u00e9r\u00e9 \u2014 ${r?.chunk_count ?? 1} chunk(s) cr\u00e9\u00e9(s)`,
      });
      setNote('');
      setTitle('');
      setTags('');
      void refreshStats();
    } catch (e) {
      setMessage({ kind: 'err', text: friendlyError(e) });
    } finally {
      setIsIngesting(false);
    }
  }, [note, title, tags, refreshStats]);

  const handleSearch = React.useCallback(async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const result = await knowledgeService.search(searchQuery);
      setSearchResults(result);
    } catch (e) {
      setMessage({ kind: 'err', text: friendlyError(e) });
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery]);

  React.useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const confirmChunkDelete = React.useCallback(async () => {
    if (!pendingDeleteChunk) return;
    const target = pendingDeleteChunk;
    setPendingDeleteChunk(null);
    try {
      await knowledgeService.deleteChunk(target.chunk_id);
      toast.successDetailed('Chunk supprim\u00e9 de la base', target.title);
      // Retire le hit de l'affichage local
      setSearchResults((prev) =>
        prev
          ? {
              ...prev,
              snippets: prev.snippets.filter((s) => s.chunk_id !== target.chunk_id),
            }
          : prev,
      );
      void refreshStats();
    } catch (e) {
      toast.error(friendlyError(e));
      throw e;
    }
  }, [pendingDeleteChunk, toast, refreshStats]);

  return (
    <div className="space-y-5 pb-20">
      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus size={18} /> Ing\u00e9rer une note
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Titre (optionnel)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            placeholder="Tags (s\u00e9par\u00e9s par virgule)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <textarea
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={4}
            placeholder="Saisir la note \u00e0 indexer (markdown, transcript, etc.)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button onClick={handleIngest} disabled={!note.trim() || isIngesting || !isOnline} className="bg-primary hover:bg-primary/90">
              {isIngesting ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Plus size={16} className="mr-2" />}
              Indexer
            </Button>
            <Button variant="outline" onClick={() => refreshStats()} disabled={!isOnline}>
              <Database size={14} className="mr-2" /> Stats
              {stats && <span className="ml-2 text-[10px] font-mono opacity-70">({stats.total})</span>}
            </Button>
          </div>
          {statsMissing && (
            <div className="text-xs text-muted-foreground">Aucune base initialis\u00e9e — indexe une premi\u00e8re note pour la cr\u00e9er.</div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search size={18} /> Recherche s\u00e9mantique
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Recherche libre dans la base de connaissances\u2026"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={!searchQuery.trim() || isSearching || !isOnline} variant="secondary">
              {isSearching ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Sparkles size={16} className="mr-2" />}
              Chercher
            </Button>
          </div>

          {searchResults && (
            <div className="space-y-2 mt-4">
              {searchResults.snippets.length === 0 && (
                <div className="text-sm text-muted-foreground p-4 rounded-lg bg-secondary/30">
                  Aucun r\u00e9sultat pertinent.
                </div>
              )}
              {searchResults.snippets.map((hit, i) => (
                <div key={hit.chunk_id ?? `${hit.title}-${i}`} className="p-4 rounded-lg bg-secondary/30 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Hash size={14} className="text-muted-foreground shrink-0" />
                      <span className="font-semibold text-sm truncate">{hit.title}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="border-primary/30 text-primary text-[10px]">
                        score {Math.round(hit.score * 100)}%
                      </Badge>
                      {hit.chunk_id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-500"
                          onClick={() =>
                            setPendingDeleteChunk({
                              chunk_id: hit.chunk_id!,
                              title: hit.title || hit.chunk_id!,
                            })
                          }
                          title="Supprimer ce chunk de la base RAG"
                          aria-label={`Supprimer le chunk ${hit.title}`}
                          data-testid={`kb-chunk-delete-${hit.chunk_id}`}
                        >
                          <Trash2 size={12} />
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{hit.snippet}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {message && (
        <div
          className={cn(
            'p-4 rounded-lg flex items-center gap-3 border text-sm font-medium',
            message.kind === 'ok'
              ? 'bg-green-500/10 border-green-500/20 text-green-500'
              : 'bg-red-500/10 border-red-500/20 text-red-500',
          )}
        >
          <AlertCircle size={16} />
          {message.text}
        </div>
      )}

      {/* ============================================================
          Round 60 — modale de confirmation de suppression d'un chunk RAG.
         ============================================================ */}
      <DeleteConfirmDialog
        open={pendingDeleteChunk !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteChunk(null);
        }}
        itemLabel={pendingDeleteChunk?.title ?? ''}
        entityLabel="chunk RAG"
        meta="Chunk de la base de connaissances"
        cascades={[
          'Le chunk est retir\u00e9 du moteur de recherche s\u00e9mantique (hard-delete rapide)',
          'Les analyses IA pass\u00e9es gardent leur contexte (pas de rollback)',
        ]}
        onConfirm={confirmChunkDelete}
      />
    </div>
  );
}
