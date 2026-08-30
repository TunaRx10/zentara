/**
 * ChatPage — Round 39.
 *
 * Mode "Discussion" :
 *   Bulles style ChatGPT, composer textarea + bouton Envoyer.
 *
 * Mode "🔍 Recherche" (Round 39 — capacité principale) :
 *   - Formulaire structuré : niche (secteur), région, quantité, contexte.
 *   - Bouton "Lancer la recherche" → POST /engine/search (MOTEUR RÉEL unifié :
 *     annuaires gratuits + SEC EDGAR + OpenStreetMap/Maps + LinkedIn).
 *   - Le résultat est versé dans l'historique du chat (carte "Moteur réel")
 *     avec un lien vers /one (Moteur Zentara) et /companies.
 *
 * Robustesse réseau (Round 39 fix) :
 *   - Le composer textarea n'est PLUS désactivé si /api/chat/status échoue.
 *   - Si l'envoi réel échoue (backend injoignable / timeout), on montre
 *     un message d'erreur clair + toast, mais le champ reste éditable.
 *   - On tolère un status inconnu (EAI_AGAIN, etc.) au lieu de geler l'UI.
 *
 * Historique :
 *   - Polling 12s pour sync multi-onglets.
 *   - L'historique est stocké en SQLite côté backend (chat_messages).
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
  Loader2,
  Trash2,
  Sparkles,
  Bot,
  User as UserIcon,
  WifiOff,
  Wifi,
  RefreshCw,
  Lightbulb,
  ChevronRight,
  Megaphone,
  Radar,
  Building2,
  Target,
  Activity,
  Search,
  Globe,
  Layers,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Briefcase,
  Mail,
  Save,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/contexts/ToastProvider';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import type { ChatMessage } from '@/types';

// =====================================================================
// Helpers
// =====================================================================

/** Round 45 — un modèle proposable par le backend (GET /api/chat/status). */
interface ChatModelOption {
  id: string;
  label: string;
  hint?: string;
}

interface ChatProviderOption {
  name: string;
  configured?: boolean;
  verified?: boolean;
}

interface ChatStatusFE {
  provider: string;
  configured?: boolean;
  /** Round 45 — modèle actif (env AI_MODEL côté backend). */
  model?: string;
  /** Round 45 — liste des modèles proposables pour le provider courant. */
  models?: ChatModelOption[];
  /** Round 131 — tous les providers configurés (sélecteur de provider). */
  providers?: ChatProviderOption[];
}

function fmtTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function parseAssistantStructured(raw: string): {
  isStructured: boolean;
  message?: string;
  capabilities?: string[];
  action?: string;
} {
  if (!raw || raw.trim()[0] !== '{') return { isStructured: false };
  try {
    const obj = JSON.parse(raw);
    if (typeof obj === 'object' && obj) {
      return {
        isStructured: true,
        message: typeof obj.message === 'string' ? obj.message : undefined,
        capabilities: Array.isArray(obj.capabilities)
          ? obj.capabilities.filter((x: unknown) => typeof x === 'string')
          : undefined,
        action: typeof obj.action_suggérée === 'string'
          ? obj.action_suggérée
          : typeof obj.action_suggerée === 'string'
            ? obj.action_suggerée
            : typeof obj.action === 'string'
              ? obj.action
              : undefined,
      };
    }
  } catch { /* not JSON */ }
  return { isStructured: false };
}

// Format libre du payload renvoyé par /api/intelligence/prospect.
interface ProspectingResponseFE {
  prospecting_session_id: string;
  executed_at?: string;
  summary?: string;
  persisted_companies?: number;
  duration_ms?: number;
  auto_analyze_enabled?: boolean;
  auto_analyze_threshold?: number;
  /** Round — true si les entreprises viennent des annuaires réels (pas de l'IA). */
  verified?: boolean;
  /** Sources réelles utilisées par le moteur unifié Zentara One. */
  real_sources?: string[];
  companies?: Array<{
    rank: number;
    name: string;
    sector?: string;
    hq_city?: string;
    hq_country?: string;
    company_size?: string;
    zentara_opportunity_score?: number;
    priority_tier?: string;
    primary_intelligence_need?: string;
  }>;
  top_lists?: {
    top_10_must_contact_now?: string[];
    top_10_most_urgent_need?: string[];
  };
}

// Format libre du payload renvoyé par POST /engine/search (mode jobs).
interface EngineJobResult {
  id: string;
  type?: string;
  name: string;
  title?: string | null;
  category?: string | null;
  city?: string | null;
  country?: string | null;
  linkedin?: string | null;
  website?: string | null;
  source?: string;
  score?: number;
  tags?: string[];
  jobId?: string | null;
  postedDate?: string | null;
  salary?: string | null;
  snippet?: string | null;
  needs?: string[];
  hiringContext?: string | null;
  outreachSequence?: {
    ok?: boolean;
    sequence?: Array<{ step?: string; subject?: string; body?: string; rationale?: string }>;
    cold?: { subject?: string; body?: string; rationale?: string } | null;
    follow_up?: { subject?: string; body?: string; rationale?: string } | null;
    breakup?: { subject?: string; body?: string; rationale?: string } | null;
    error?: string;
  } | null;
  companyInfo?: {
    sector?: string | null;
    industry?: string | null;
    size?: string | null;
    headquarters?: string | null;
    website?: string | null;
    description?: string | null;
  } | null;
}

interface EngineSearchResponseFE {
  engine?: string;
  mode?: string;
  results?: EngineJobResult[];
  total?: number;
  sources?: string[];
  errors?: Array<{ source?: string; message?: string }>;
}

// =====================================================================
// Sub-components
// =====================================================================

const StatusBadge: React.FC<{
  provider?: string | null;
  ok: boolean;
  unknown: boolean;
}> = ({ provider, ok, unknown }) => {
  const color = unknown
    ? 'bg-amber-500/15 text-amber-500 border-amber-500/30'
    : ok
      ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
      : 'bg-red-500/15 text-red-500 border-red-500/30';
  const icon = unknown ? <WifiOff size={10} /> : ok ? <Wifi size={10} /> : <WifiOff size={10} />;
  const text = unknown ? 'statut inconnu' : ok ? 'connecté' : 'injoignable';
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border',
      color,
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', unknown ? 'bg-amber-500' : ok ? 'bg-emerald-500 animate-pulse' : 'bg-red-500')} />
      {icon}
      {provider ?? 'AI'} · {text}
    </span>
  );
};

const MessageBubble: React.FC<{ msg: ChatMessage }> = ({ msg }) => {
  const isUser = msg.kind === 'user';
  const isSystem = msg.kind === 'system';
  const parsed = !isUser && !isSystem ? parseAssistantStructured(msg.content) : { isStructured: false };
  // Détection d'une carte "Recherche" injectée localement (Round 39) :
  //   - metadata.kind === 'prospecting'        → résultat de /api/intelligence/prospect
  //   - metadata.kind === 'research_error'    → message d'erreur détaillé
  let metaObj: {
    kind?: string; session_id?: string; persisted?: number; duration_ms?: number; link?: string;
    error?: string; auto_analyze?: boolean; threshold?: number; verified?: boolean;
    keywords?: string; location?: string; total?: number; sources?: string[];
    results?: EngineJobResult[]; errors?: Array<{ source?: string; message?: string }>;
  } = {};
  if (!isUser && !isSystem && msg.metadata) {
    try { metaObj = JSON.parse(msg.metadata); } catch { /* ignore */ }
  }

  // Round 44 — hook hoisté : useLocalNavigate() doit être appelé
  // inconditionnellement (règle react/rules-of-hooks) et non pas à
  // l'intérieur d'une branche de rendu conditionnel (bug React #310).
  const localNavigate = useLocalNavigate();
  const wrapCls = isUser
    ? 'flex justify-end'
    : isSystem
      ? 'flex justify-center'
      : 'flex justify-start';    return (
    <div className={cn(wrapCls, 'mb-3 px-2 md:px-6')}>
      {isSystem ? (
        <div className="rounded-full bg-amber-500/10 border border-amber-500/30 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-300">
          {msg.content}
        </div>
      ) : (
        <div className={cn(
          'flex items-start gap-2 max-w-[85%] md:max-w-[75%]',
          isUser && 'flex-row-reverse',
        )}>
          <div className={cn(
            'w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold',
            isUser
              ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/30'
              : 'bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 text-white shadow-lg',
          )}>
            {isUser ? <UserIcon size={14} /> : <Bot size={14} />}
          </div>
          <div className={cn(
            'rounded-2xl px-4 py-3 text-sm leading-relaxed',
            isUser
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-card/80 border border-border/40 text-foreground rounded-tl-sm',
          )}>
            {parsed.isStructured ? (
              <div className="space-y-2">
                {parsed.message && <p className="font-bold">{parsed.message}</p>}
                {parsed.capabilities && parsed.capabilities.length > 0 && (
                  <ul className="space-y-1 mt-1">
                    {parsed.capabilities.map((cap, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs">
                        <ChevronRight size={10} className="mt-0.5 shrink-0 opacity-70" />
                        <span>{cap}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {parsed.action && (
                  <p className="text-[11px] mt-2 pt-2 border-t border-border/30 italic">
                    <Lightbulb size={10} className="inline mr-1" />
                    {parsed.action}
                  </p>
                )}
              </div>
            ) : metaObj.kind === 'jobs_search' ? (
              <JobsResultCard meta={metaObj} />
            ) : metaObj.kind === 'engine_search' ? (
              // Carte des résultats du MOTEUR RÉEL (annuaires + Maps + LinkedIn).
              <EngineSearchResultCard meta={metaObj} navigate={localNavigate} />
            ) : metaObj.kind === 'prospecting' ? (
              // Carte riche cliquable pour les résultats de recherche
              <ResearchResultCard meta={metaObj} text={msg.content} navigate={localNavigate} />
            ) : (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            )}
            <div className={cn(
              'flex items-center justify-between gap-3 mt-2 pt-1 border-t border-border/30',
              isUser && 'flex-row-reverse',
            )}>
              <span className={cn(
                'text-[10px] font-mono opacity-50',
                isUser && 'text-primary-foreground/60',
              )}>
                {fmtTime(msg.created_at)}
              </span>
              {!isUser && msg.metadata && metaObj.kind !== 'prospecting' && (
                <ProviderMeta meta={msg.metadata} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const useLocalNavigate = (): any => {
  return useNavigate();
};

// =====================================================================
// Analyse IA en arrière-plan — barre de progression live (Round 41)
// =====================================================================

interface ProspectingStatusFE {
  session_id: string;
  total: number;
  analyzed: number;
  pending: number;
  done: boolean;
  updated_at: string;
}

/**
 * Poll le statut de l'auto-analyse 7-engines de la session de prospection
 * et affiche une barre de progression. S'arrête automatiquement quand tout
 * est analysé (done) ou quand aucune cible n'est suivie.
 */
const AnalysisProgress: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const statusQ = useQuery<ProspectingStatusFE | null, Error>({
    queryKey: ['prospecting', 'status', sessionId],
    queryFn: async ({ signal }) => {
      try {
        const api = getApiClient();
        // `api.get` déballe déjà le champ `data` du payload backend.
        return await api.get<ProspectingStatusFE>(ENDPOINTS.prospectingStatus(sessionId), { signal });
      } catch {
        return null; // backend temporairement injoignable → on réessaiera au prochain tick
      }
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      // Stop polling : done, aucune cible, ou échec permanent du query.
      if (d && (d.done || d.total === 0)) return false;
      if (query.state.error) return 30_000;
      return 4_000; // tick toutes les 4s pendant l'analyse
    },
    retry: false,
  });

  const st = statusQ.data;
  if (!st || st.total === 0) return null;

  const pct = st.total > 0 ? Math.round((st.analyzed / st.total) * 100) : 0;
  const done = st.done;

  return (
    <div className={cn(
      'rounded-xl border px-3 py-2.5 mt-2 space-y-1.5',
      done
        ? 'border-emerald-500/30 bg-emerald-500/10'
        : 'border-cyan-500/30 bg-cyan-500/5',
    )}>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={cn('font-black uppercase tracking-widest flex items-center gap-1.5', done ? 'text-emerald-500' : 'text-cyan-400')}>
          {done ? (
            <><CheckCircle2 size={12} /> Analyse IA terminée</>
          ) : (
            <><Loader2 size={12} className="animate-spin" /> Analyse IA en arrière-plan…</>
          )}
        </span>
        <span className="font-mono text-muted-foreground">
          {st.analyzed}/{st.total} · {pct}%
        </span>
      </div>
      {/* Barre de progression */}
      <div className="h-1.5 w-full rounded-full bg-card/80 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-700', done ? 'bg-emerald-500' : 'bg-gradient-to-r from-cyan-500 to-violet-500')}
          style={{ width: `${Math.max(4, pct)}%` }}
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        {done
          ? `${st.analyzed} entreprise(s) analysée(s) en profondeur (7 engines).`
          : `${st.pending} entreprise(s) encore en file — l'analyse complète prend 1-3 min par cible.`}
      </p>
    </div>
  );
};

const ResearchResultCard: React.FC<{
  meta: { session_id?: string; persisted?: number; duration_ms?: number; link?: string; auto_analyze?: boolean; threshold?: number; verified?: boolean; sources?: string[] };
  text: string;
  navigate: (to: string) => void;
}> = ({ meta, text, navigate }) => {
  const href = meta.link || '/intelligence?tab=prospecting';
  const verified = meta.verified !== false;
  return (
    <div className="space-y-2">
      <div className="text-sm">{text}</div>
      {/* Badge de vérification : sources réelles vs IA non vérifiée */}
      <div className="flex flex-wrap items-center gap-1.5">
        {verified ? (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-lime-500/15 text-lime-400 border border-lime-500/30 text-[10px] font-black uppercase tracking-wider">
            <CheckCircle2 size={11} /> Sources réelles
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] font-black uppercase tracking-wider">
            <AlertTriangle size={11} /> IA non vérifiée
          </span>
        )}
        {verified && meta.sources && meta.sources.length > 0 && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[60%]" title={meta.sources.join(', ')}>
            {meta.sources.join(' · ')}
          </span>
        )}
      </div>
      {/* Progression de l'auto-analyse 7-engines (Round 41) */}
      {meta.session_id && meta.auto_analyze !== false && (
        <AnalysisProgress sessionId={meta.session_id} />
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <button
          onClick={() => navigate(href)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 text-[11px] font-bold transition-all shadow-sm"
        >
          <Megaphone size={12} /> Ouvrir le résultat complet
          <ExternalLink size={10} />
        </button>
        <button
          onClick={() => navigate('/companies')}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-[11px] font-bold transition-colors"
        >
          <Building2 size={12} /> Voir dans /companies
          <ExternalLink size={10} />
        </button>
        {meta.session_id && (
          <span className="text-[10px] font-mono text-muted-foreground/70 truncate ml-auto" title={`Session: ${meta.session_id}`}>
            session #{meta.session_id.slice(-6)}
          </span>
        )}
      </div>
    </div>
  );
};

const EngineSearchResultCard: React.FC<{
  meta: { total?: number; sources?: string[]; results?: EngineJobResult[]; errors?: Array<{ source?: string; message?: string }> };
  navigate: (to: string) => void;
}> = ({ meta, navigate }) => {
  const results = meta.results ?? [];
  const sources = meta.sources ?? [];
  const errors = meta.errors ?? [];
  const top = results.slice(0, 8);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-black uppercase tracking-wider">
          <CheckCircle2 size={11} /> Moteur réel
        </span>
        {sources.length > 0 && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[60%]" title={sources.join(', ')}>
            {sources.join(' · ')}
          </span>
        )}
      </div>
      {errors.length > 0 && (
        <div className="text-[11px] text-amber-400 space-y-1">
          <p className="font-bold">
            {errors.length} source{errors.length > 1 ? 's' : ''} indisponible{errors.length > 1 ? 's' : ''}
            {top.length > 0 ? ' — résultats partiels.' : ' (hors-ligne).'}
          </p>
          <ul className="space-y-0.5">
            {errors.slice(0, 5).map((e, i) => (
              <li key={i} className="text-[10px] text-amber-400/80 leading-snug">• {e.message || e.source}</li>
            ))}
            {errors.length > 5 && <li className="text-[10px] text-amber-400/60">+ {errors.length - 5} autre(s)</li>}
          </ul>
        </div>
      )}
      {top.length === 0 ? (
        <p className="text-xs text-muted-foreground">Aucun résultat réel pour cette recherche.</p>
      ) : (
        <ul className="space-y-1">
          {top.map((r, i) => {
            const kind = r.type === 'person' ? 'contact' : r.type === 'job' ? 'job' : 'company';
            return (
              <li key={r.id ?? `${r.name}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="text-[10px] font-black text-muted-foreground w-5 shrink-0">#{i + 1}</span>
                <span className="font-bold truncate max-w-[200px]">{r.name}</span>
                <span className="px-1 rounded bg-secondary/60 text-muted-foreground text-[9px] uppercase shrink-0">{kind}</span>
                {r.category && <span className="text-muted-foreground truncate max-w-[120px] hidden sm:inline">· {r.category}</span>}
                {r.score != null && <span className="ml-auto text-[10px] font-black tabular-nums text-muted-foreground shrink-0">{r.score}%</span>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <button
          onClick={() => navigate('/one')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/15 hover:bg-primary/25 text-primary text-[11px] font-bold transition-colors"
        >
          <Layers size={10} /> Ouvrir le Moteur
          <ExternalLink size={10} />
        </button>
        <button
          onClick={() => navigate('/companies')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-[11px] font-bold transition-colors"
        >
          <Building2 size={10} /> Voir dans /companies
          <ExternalLink size={10} />
        </button>
      </div>
    </div>
  );
};

const ProviderMeta: React.FC<{ meta: string }> = ({ meta }) => {
  let obj: { provider?: string; model?: string; latencyMs?: number; error?: string } = {};
  try { obj = JSON.parse(meta); } catch { /* keep raw */ }
  if (obj.error) {
    return <span className="text-[10px] font-mono text-red-400 truncate" title={obj.error}>erreur</span>;
  }
  const tokens = [obj.provider, obj.model].filter(Boolean);
  if (tokens.length === 0) return null;
  return (
    <span className="text-[10px] font-mono text-muted-foreground/70 truncate">
      {tokens.join(' · ')}
      {obj.latencyMs ? <span className="ml-1 opacity-60">· {obj.latencyMs}ms</span> : null}
    </span>
  );
};

// =====================================================================
// Composition de la réponse "Recherche" dans l'historique du chat
// =====================================================================

const LinkedResult: React.FC<{ navigate: ReturnType<typeof useNavigate>; payload: ProspectingResponseFE; sector: string; quantity: number }> = ({ navigate, payload, sector, quantity }) => {
  const top3 = (payload.companies ?? [])
    .slice()
    .sort((a, b) => (b.zentara_opportunity_score ?? 0) - (a.zentara_opportunity_score ?? 0))
    .slice(0, 3);
  const total = payload.companies?.length ?? 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-cyan-400">
        <Sparkles size={14} />
        <span className="font-bold">Recherche lancée</span>
      </div>
      <p className="text-sm">
        <strong>{total} entreprise{total > 1 ? 's' : ''}</strong> identifiée{total > 1 ? 's' : ''} dans
        le secteur <em>{sector}</em> ({quantity} cible{quantity > 1 ? 's' : ''} demandée{quantity > 1 ? 's' : ''}).
        {payload.persisted_companies != null && <> · <strong>{payload.persisted_companies}</strong> persistée{payload.persisted_companies > 1 ? 's' : ''} en base.</>}
        {payload.duration_ms != null && <> · {(payload.duration_ms / 1000).toFixed(1)}s.</>}
      </p>
      {payload.summary && (
        <p className="text-[12px] italic text-muted-foreground border-l-2 border-violet-500/40 pl-2">
          {payload.summary}
        </p>
      )}
      {top3.length > 0 && (
        <ul className="space-y-1 text-[12px]">
          {top3.map((c) => (
            <li key={c.rank} className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-primary/20 text-primary inline-flex items-center justify-center text-[10px] font-black shrink-0">
                #{c.rank}
              </span>
              <span className="font-bold">{c.name}</span>
              {c.sector && <span className="text-muted-foreground"> · {c.sector}</span>}
              {c.zentara_opportunity_score != null && (
                <span className={cn(
                  'ml-auto px-1.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider',
                  c.zentara_opportunity_score >= 80
                    ? 'bg-orange-500/15 text-orange-500'
                    : c.zentara_opportunity_score >= 70
                      ? 'bg-amber-500/15 text-amber-500'
                      : 'bg-blue-500/15 text-blue-400',
                )}>
                  score {c.zentara_opportunity_score}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <button
          onClick={() => navigate(`/intelligence?tab=prospecting&highlight=${encodeURIComponent(payload.prospecting_session_id)}`)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/15 hover:bg-primary/25 text-primary text-[11px] font-bold transition-colors"
        >
          <Megaphone size={10} /> Voir le résultat complet
          <ExternalLink size={10} />
        </button>
        <button
          onClick={() => navigate('/companies')}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 text-[11px] font-bold transition-colors"
        >
          <Building2 size={10} /> Voir dans /companies
          <ExternalLink size={10} />
        </button>
      </div>
    </div>
  );
};

// =====================================================================
// Suggestions de Discussion
// =====================================================================

const SUGGESTIONS: Array<{
  label: string;
  icon: React.ReactNode;
  prompt: string;
}> = [
  {
    label: 'Prospecter une entreprise',
    icon: <Megaphone size={12} />,
    prompt: "Je veux prospecter une entreprise SaaS B2B européenne qui recrute un Head of Sales. Comment structurer ma campagne ?",
  },
  {
    label: 'Analyser un secteur',
    icon: <Radar size={12} />,
    prompt: "Analyse les tendances du marché FinTech France 2025 — quelles verticales encore sous-exploitées ?",
  },
  {
    label: 'Préparer un cold email',
    icon: <Sparkles size={12} />,
    prompt: "J'ai trouvé un prospect : CTO d'une startup IA à Paris. Rédige un cold email court et personnalisé pour proposer Zentara.",
  },
  {
    label: 'Audit intelligence',
    icon: <Building2 size={12} />,
    prompt: "Comment Zentara peut m'aider à structurer une analyse intelligence complète sur une de mes fiches Company ?",
  },
  {
    label: 'ICP & scoring',
    icon: <Target size={12} />,
    prompt: "Comment définir l'ICP idéal pour mon SaaS B2B pricing 100€/mois, et comment Zentara score-t-il les contacts ?",
  },
  {
    label: 'Monitoring',
    icon: <Activity size={12} />,
    prompt: "Le monitoring Zentara capte quoi actuellement pour mes entreprises ? Et comment l'amplifier avec mes propres sources ?",
  },
];

// =====================================================================
// Main page
// =====================================================================

type Mode = 'discussion' | 'research' | 'jobs';

export const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const session_id = 'default';

  // Mode (Discussion ⇄ Recherche).
  const [mode, setMode] = React.useState<Mode>('research');

  // --- Chat status (tolérant : un échec ne désactive plus le composer) ---
  // NB : `api.get` déballe déjà `parsed.data` → statusQ.data = { provider, configured }.
  // Round 131 — la query dépend du provider choisi (models du provider demandé).
  const [provider, setProvider] = React.useState<string>('');
  const statusQ: UseQueryResult<ChatStatusFE | null, Error> = useQuery({
    queryKey: ['chat', 'status', provider],
    queryFn: async ({ signal }) => {
      try {
        const r = await getApiClient().get<ChatStatusFE>(
          provider ? `/chat/status?provider=${encodeURIComponent(provider)}` : `/chat/status`,
          { signal },
        );
        return r ?? null;
      } catch {
        // Tolérant : on renvoie null plutôt que throw.
        return null;
      }
    },
    refetchInterval: 30_000,
    retry: false,
  });

  const ok = !statusQ.error && statusQ.data != null;
  const statusUnknown = !statusQ.error && !ok && !statusQ.isLoading && !statusQ.data;
  const activeProvider = statusQ.data?.provider ?? null;
  const configuredProviders = statusQ.data?.providers ?? [];

  // --- Round 45 : modèle IA sélectionné (par défaut : celui du backend). ---
  const availableModels = statusQ.data?.models ?? [];
  const [model, setModel] = React.useState<string>('');
  React.useEffect(() => {
    if (!model && statusQ.data?.model) {
      setModel(statusQ.data.model);
    }
  }, [statusQ.data?.model, provider, model]);

  // --- Messages ---
  const listQ = useQuery({
    queryKey: ['chat', 'messages', session_id],
    queryFn: async ({ signal }) => {
      try {
        const api = getApiClient();
        const r = await api.get<ChatMessage[]>(
          `${ENDPOINTS.chatMessages || '/api/chat/messages'}?session_id=${encodeURIComponent(session_id)}&limit=200`,
          { signal },
        );
        // `api.get` déballe déjà `data` → r est directement le tableau.
        return Array.isArray(r) ? r : [];
      } catch {
        // Tolérant : pas d'historique si backend down mais le composer reste ouvert.
        return [] as ChatMessage[];
      }
    },
    refetchInterval: 12_000,
    retry: false,
  });
  const messages = listQ.data ?? [];

  // --- Auto-scroll ---
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // --- Discussion mode : composer + send ---
  const [text, setText] = React.useState('');
  const sendMut = useMutation({
    mutationFn: async (content: string) => {
      const api = getApiClient();
      const r = await api.post<{
        user_message: ChatMessage;
        assistant_message: ChatMessage;
      }>(ENDPOINTS.chatSend ?? '/api/chat/send', {
        content,
        session_id,
        // Round 45 — modèle choisi dans le selecteur (sinon backend decide).
        model: model || undefined,
        // Round 131 — provider choisi dans le selecteur (sinon backend decide).
        provider: provider || undefined,
      });
      return r;
    },
    onSuccess: (data) => {
      qc.setQueryData<ChatMessage[]>(['chat', 'messages', session_id], (old) => [
        ...(old ?? []),
        data.user_message,
        data.assistant_message,
      ]);
      setText('');
    },
    onError: (e) =>
      toast.error(`Échec envoi : ${(e as Error).message}. Le composer reste ouvert — réessaie.`, 5000),
  });

  const clearMut = useMutation({
    mutationFn: async () => {
      const api = getApiClient();
      return api
        .delete<{ success: boolean; data: { deleted: number; session_id: string } }>(
          `${ENDPOINTS.chatMessages || '/api/chat/messages'}?session_id=${encodeURIComponent(session_id)}`,
        )
        .catch(() => ({ success: false, data: { deleted: 0, session_id } } as any));
    },
    onSuccess: () => {
      qc.setQueryData<ChatMessage[]>(['chat', 'messages', session_id], []);
      toast.success('Conversation effacée', 2500);
    },
    onError: (e) => toast.error(`Échec : ${(e as Error).message}`, 4000),
  });

  const handleSendDiscussion = (override?: string) => {
    const payload = (override ?? text).trim();
    if (!payload || sendMut.isPending) return;
    sendMut.mutate(payload);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendDiscussion();
    }
  };

  // --- Recherche mode : niche + quantity + region + context ---
  const [niche, setNiche] = React.useState('SaaS B2B');
  const [region, setRegion] = React.useState('France');
  const [quantity, setQuantity] = React.useState(8);
  const [context, setContext] = React.useState('');

  const researchMut = useMutation({
    mutationFn: async () => {
      const api = getApiClient();
      // Le bouton « Lancer la recherche » pointe sur le MOTEUR RÉEL unifié
      // (Zentara One) : annuaires gratuits + SEC EDGAR + OpenStreetMap/Maps +
      // LinkedIn. Aucune IA ne génère les entreprises — elles viennent des
      // sources réelles, et `save: true` les persiste en base.
      const payload = (await api.post<EngineSearchResponseFE>(
        ENDPOINTS.engineSearch,
        {
          mode: 'all',
          query: niche.trim() || 'SaaS B2B',
          location: region.trim() || undefined,
          limit: quantity,
          needs: context.trim() || undefined,
          save: true,
        },
        { timeoutMs: 60_000, retries: 0 },
      )) as EngineSearchResponseFE;
      if (!payload || typeof payload !== 'object') {
        throw new Error('Backend engine : réponse invalide (vide)');
      }
      return payload;
    },
    // 2) Pousse aussi un message user + assistant dans la conversation.
    onSuccess: (payload: EngineSearchResponseFE) => {
      const results = payload?.results ?? [];
      const total = payload?.total ?? results.length;
      const sources = payload?.sources ?? [];
      const errors = payload?.errors ?? [];
      const userContent = `🔍 Recherche (moteur réel) : "${niche}" · région="${region}" · ${quantity} cible${quantity > 1 ? 's' : ''}${context.trim() ? ` · besoins="${context.trim().slice(0, 120)}${context.trim().length > 120 ? '…' : ''}"` : ''}.`;
      const userMsg: ChatMessage = {
        id: `msg_local_${Date.now()}_u`,
        session_id,
        kind: 'user',
        content: userContent,
        metadata: null,
        created_at: new Date().toISOString(),
      };
      const assistantMsg: ChatMessage = {
        id: `msg_local_${Date.now()}_a`,
        session_id,
        kind: 'assistant',
        content: `**${total}** résultat${total > 1 ? 's' : ''} réel${total > 1 ? 's' : ''} via ${sources.length ? sources.join(' · ') : 'les sources publiques'}.`,
        metadata: JSON.stringify({
          kind: 'engine_search',
          total,
          sources,
          results,
          errors,
        }),
        created_at: new Date().toISOString(),
      };
      qc.setQueryData<ChatMessage[]>(['chat', 'messages', session_id], (old) => [
        ...(old ?? []),
        userMsg,
        assistantMsg,
      ]);
      toast.success(`Recherche réelle · ${total} résultat${total > 1 ? 's' : ''}`, 4500);
    },
    onError: (e) => {
      const msg = (e as Error).message ?? 'Erreur';
      // Injecte un assistant message honnête pour que ça reste lisible.
      qc.setQueryData<ChatMessage[]>(['chat', 'messages', session_id], (old) => [
        ...(old ?? []),
        {
          id: `msg_local_${Date.now()}_e`,
          session_id,
          kind: 'assistant',
          content: `⚠ La recherche n'a pas pu être lancée : ${msg}. Le moteur réel (annuaires + Maps + LinkedIn) est peut-être temporairement indisponible.`,
          metadata: JSON.stringify({ error: msg, kind: 'research_error' }),
          created_at: new Date().toISOString(),
        },
      ]);
      toast.error(`Recherche échouée : ${msg}`, 5000);
    },
  });

  const handleSendResearch = () => {
    if (!niche.trim() || researchMut.isPending) return;
    researchMut.mutate();
  };

  // --- Jobs (LinkedIn) mode : recherche d'offres + entreprises via /engine/search ---
  const [jobsKeywords, setJobsKeywords] = React.useState('Head of Sales');
  const [jobsLocation, setJobsLocation] = React.useState('France');
  const [jobsCount, setJobsCount] = React.useState(10);

  const jobsMut = useMutation({
    mutationFn: async () => {
      const api = getApiClient();
      const payload = (await api.post<EngineSearchResponseFE>(
        ENDPOINTS.engineSearch,
        {
          mode: 'jobs',
          query: jobsKeywords.trim(),
          needs: jobsKeywords.trim(),
          location: jobsLocation.trim() || undefined,
          limit: jobsCount,
        },
        { timeoutMs: 150_000, retries: 0 },
      )) as EngineSearchResponseFE;
      if (!payload || typeof payload !== 'object') {
        throw new Error('Backend engine : réponse invalide (vide)');
      }
      return payload;
    },
    onSuccess: (payload: EngineSearchResponseFE) => {
      const results = payload?.results ?? [];
      const errors = payload?.errors ?? [];
      const total = payload?.total ?? results.length;
      const userMsg: ChatMessage = {
        id: `msg_local_${Date.now()}_u`,
        session_id,
        kind: 'user',
        content: `💼 Jobs LinkedIn : mots-clés="${jobsKeywords.trim()}" · localisation="${jobsLocation.trim() || '—'}" · ${jobsCount} offre${jobsCount > 1 ? 's' : ''}.`,
        metadata: null,
        created_at: new Date().toISOString(),
      };
      const assistantMsg: ChatMessage = {
        id: `msg_local_${Date.now()}_a`,
        session_id,
        kind: 'assistant',
        content: total > 0
          ? `💼 **${total}** offre${total > 1 ? 's' : ''} d'emploi trouvée${total > 1 ? 's' : ''} via LinkedIn (avec les entreprises qui recrutent).`
          : '💼 Aucune offre LinkedIn trouvée pour le moment.',
        metadata: JSON.stringify({
          kind: 'jobs_search',
          keywords: jobsKeywords.trim(),
          location: jobsLocation.trim(),
          total,
          results,
          errors,
          sources: payload?.sources ?? [],
        }),
        created_at: new Date().toISOString(),
      };
      qc.setQueryData<ChatMessage[]>(['chat', 'messages', session_id], (old) => [
        ...(old ?? []),
        userMsg,
        assistantMsg,
      ]);
      toast.success(
        total > 0
          ? `${total} offre${total > 1 ? 's' : ''} LinkedIn trouvée${total > 1 ? 's' : ''}`
          : 'Recherche LinkedIn terminée (0 offre)',
        4500,
      );
    },
    onError: (e) => {
      const msg = (e as Error).message ?? 'Erreur';
      qc.setQueryData<ChatMessage[]>(['chat', 'messages', session_id], (old) => [
        ...(old ?? []),
        {
          id: `msg_local_${Date.now()}_e`,
          session_id,
          kind: 'assistant',
          content: `⚠ La recherche de jobs LinkedIn a échoué : ${msg}.`,
          metadata: JSON.stringify({ error: msg, kind: 'research_error' }),
          created_at: new Date().toISOString(),
        },
      ]);
      toast.error(`Recherche de jobs LinkedIn échouée : ${msg}`, 5000);
    },
  });

  const handleSendJobs = () => {
    if (!jobsKeywords.trim() || jobsMut.isPending) return;
    jobsMut.mutate();
  };

  const isEmpty = messages.length === 0 && !listQ.isLoading;

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] max-w-5xl mx-auto px-3 md:px-6 py-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-border/40">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-violet-500/30">
            <Bot size={18} />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg md:text-xl font-black tracking-tight flex items-center gap-2 truncate">
              Zentara Chat
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 hidden md:inline">
                · Assistant stratégique
              </span>
            </h1>
            <p className="text-[11px] text-muted-foreground truncate">
              {mode === 'research'
                ? 'Mode 🔍 Recherche — niche / quantité / contexte, résultat versé dans l\'historique.'
                : mode === 'jobs'
                  ? 'Mode 💼 Jobs — offres LinkedIn + entreprises qui recrutent (search_jobs + company profile).'
                  : 'Conversationnel · historique persisté · powered by ' + (activeProvider ?? 'AI')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge provider={activeProvider} ok={ok} unknown={statusUnknown} />
          <Button variant="outline" size="icon" onClick={() => listQ.refetch()} title="Refresh">
            <RefreshCw size={14} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => clearMut.mutate()}
            disabled={clearMut.isPending || messages.length === 0}
            title="Effacer la conversation"
          >
            <Trash2 size={12} className="md:mr-1" />
            <span className="hidden md:inline">Clear</span>
          </Button>
        </div>
      </div>

      {/* Mode toggle (Discussion ⇄ Recherche) */}
      <div className="flex items-center justify-center py-2">
        <div className="inline-flex p-1 rounded-xl bg-card/60 border border-border shadow-sm">
          <button
            type="button"
            onClick={() => setMode('discussion')}
            className={cn(
              'h-9 px-4 inline-flex items-center gap-2 rounded-lg text-xs font-bold transition-all',
              mode === 'discussion'
                ? 'bg-primary text-primary-foreground shadow'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Discussion libre avec Zentara"
          >
            <Bot size={14} /> Discussion
          </button>
          <button
            type="button"
            onClick={() => setMode('research')}
            className={cn(
              'h-9 px-4 inline-flex items-center gap-2 rounded-lg text-xs font-bold transition-all',
              mode === 'research'
                ? 'bg-gradient-to-r from-lime-500 to-lime-400 text-black shadow'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Recherche structurée (niche / quantité / contexte → moteur de prospection)"
          >
            <Search size={14} /> 🔍 Recherche
          </button>
          <button
            type="button"
            onClick={() => setMode('jobs')}
            className={cn(
              'h-9 px-4 inline-flex items-center gap-2 rounded-lg text-xs font-bold transition-all',
              mode === 'jobs'
                ? 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white shadow'
                : 'text-muted-foreground hover:text-foreground',
            )}
            title="Recherche de jobs LinkedIn (MCP search_jobs + enrichissement entreprise)"
          >
            <Briefcase size={14} /> 💼 Jobs
          </button>
        </div>
      </div>

      {/* Body : zone de messages scrollable */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 relative">
        {listQ.isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
            <Loader2 size={20} className="animate-spin mr-2" />
            Chargement de l'historique…
          </div>
        ) : isEmpty ? (
          <EmptyView onPick={(p) => handleSendDiscussion(p)} provider={activeProvider} mode={mode} />
        ) : (
          <div className="space-y-1">
            {messages.map((m) => (
              <MessageBubble key={m.id} msg={m} />
            ))}
            {sendMut.isPending && (
              <div className="px-2 md:px-6 mt-2">
                <div className="flex items-start gap-2">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 text-white">
                    <Bot size={14} />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-card/80 border border-border/40 px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" />
                    <span>Zentara réfléchit…</span>
                  </div>
                </div>
              </div>
            )}
            {researchMut.isPending && (
              <div className="px-2 md:px-6 mt-2">
                <div className="flex items-start gap-2">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-lime-500 to-lime-400 text-black">
                    <Search size={14} />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-card/80 border border-cyan-500/30 px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" />
                    <span>Lancement du moteur de prospection ({niche}, {region}, {quantity} cibles)…</span>
                  </div>
                </div>
              </div>
            )}
            {jobsMut.isPending && (
              <div className="px-2 md:px-6 mt-2">
                <div className="flex items-start gap-2">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
                    <Briefcase size={14} />
                  </div>
                  <div className="rounded-2xl rounded-tl-sm bg-card/80 border border-violet-500/30 px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" />
                    <span>Recherche de jobs LinkedIn ({jobsKeywords}, {jobsLocation})…</span>
                  </div>
                </div>
              </div>
            )}
            {/* Banner "statut inconnu / injoignable" — n'empêche plus l'envoi */}
            {!ok && !statusQ.isLoading && (
              <div className="px-2 md:px-6 mt-4">
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2 text-xs text-amber-400">
                  <WifiOff size={14} className="shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold mb-0.5">Statut connexion inconnu</div>
                    Le composer reste ouvert. Si ton message échoue à l'envoi, on affichera l'erreur détaillée.
                    Le moteur de prospection nécessite l'accès au provider IA — bascule si besoin.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Composer (mode-aware) */}
      {mode === 'discussion' ? (
        <div className="border-t border-border/40 bg-background/50 backdrop-blur pt-3">
          <div className="rounded-2xl border border-border/60 bg-card/60 focus-within:border-primary/60 transition-colors">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              disabled={sendMut.isPending}
              placeholder={
                ok || statusUnknown
                  ? "Pose ta question à Zentara… (Entrée = envoyer, Shift+Entrée = saut de ligne)"
                  : "Composer ouvert — l'envoi peut échouer si le backend est down."
              }
              className={cn(
                'w-full resize-none bg-transparent outline-none px-4 py-3 text-sm',
                'placeholder:text-muted-foreground/70',
                'min-h-[44px] max-h-40',
                sendMut.isPending && 'opacity-50',
              )}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = 'auto';
                t.style.height = `${Math.min(160, t.scrollHeight)}px`;
              }}
            />
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span className="font-bold uppercase tracking-widest">{messages.length} message(s)</span>
                {text.length > 0 && <span>· {text.length} char</span>}
              </div>
              <div className="flex items-center gap-1.5">
                {/* Round 131 — provider IA pour la discussion */}
                <select
                  value={provider}
                  onChange={(e) => { setProvider(e.target.value); setModel(''); }}
                  disabled={sendMut.isPending}
                  title="Provider IA utilisé pour cette conversation"
                  className="h-8 max-w-[110px] bg-card/80 border border-border/60 rounded-lg px-2 text-[10px] font-bold text-muted-foreground focus:border-primary/60 focus:outline-none disabled:opacity-50"
                >
                  <option value="">Auto</option>
                  {configuredProviders.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}{p.verified ? ' ✓' : ''}
                    </option>
                  ))}
                </select>
                {/* Round 45 — modèle IA pour la discussion */}
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={sendMut.isPending}
                  title="Modèle IA utilisé pour cette conversation"
                  className="h-8 max-w-[130px] bg-card/80 border border-border/60 rounded-lg px-2 text-[10px] font-bold text-muted-foreground focus:border-primary/60 focus:outline-none disabled:opacity-50"
                >
                  {model === '' && <option value="">Auto (backend)</option>}
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                  {model && !availableModels.some((m) => m.id === model) && (
                    <option value={model}>{model}</option>
                  )}
                </select>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setText('')}
                  disabled={!text.length || sendMut.isPending}
                  className="text-muted-foreground"
                >
                  <Trash2 size={12} />
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleSendDiscussion()}
                  disabled={!text.trim() || sendMut.isPending}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground"
                >
                  {sendMut.isPending
                    ? <><Loader2 size={12} className="mr-1 animate-spin" /> Envoi…</>
                    : <><Send size={12} className="mr-1" /> Envoyer</>}
                </Button>
              </div>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1.5 text-center hidden md:block">
            Zentara peut faire des erreurs. Vérifie les informations stratégiques importantes.
          </p>
        </div>
      ) : mode === 'jobs' ? (
        <JobsComposer
          keywords={jobsKeywords}
          setKeywords={setJobsKeywords}
          location={jobsLocation}
          setLocation={setJobsLocation}
          count={jobsCount}
          setCount={setJobsCount}
          onSubmit={handleSendJobs}
          isPending={jobsMut.isPending}
        />
      ) : (
        <ResearchComposer
          niche={niche}
          setNiche={setNiche}
          region={region}
          setRegion={setRegion}
          quantity={quantity}
          setQuantity={setQuantity}
          context={context}
          setContext={setContext}
          onSubmit={handleSendResearch}
          isPending={researchMut.isPending}
        />
      )}
    </div>
  );
};

// =====================================================================
// Jobs (LinkedIn) — carte de résultats + composer
// =====================================================================

const JobsResultCard: React.FC<{
  meta: {
    results?: EngineJobResult[];
    errors?: Array<{ source?: string; message?: string }>;
    total?: number;
  };
}> = ({ meta }) => {
  const results = meta.results ?? [];
  const errors = meta.errors ?? [];
  if (results.length === 0) {
    return (
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-amber-400">
          <Briefcase size={14} />
          <span className="font-bold">Aucune offre LinkedIn trouvée</span>
        </div>
        {errors.length > 0 && (
          <ul className="space-y-1 text-[11px] text-muted-foreground">
            {errors.map((e, i) => (
              <li key={i} className="border-l-2 border-amber-500/40 pl-2">
                <span className="font-mono text-muted-foreground/70">{e.source}</span> · {e.message}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground/80">
          La recherche de jobs LinkedIn nécessite une session — configure StaffSpy (identifiants) ou le runtime MCP (<code>--login</code>). Sans session, le moteur répond proprement « session absente ».
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {results.map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </ul>
  );
};

interface OutreachEmailVariant {
  subject?: string;
  body?: string;
  rationale?: string;
}

interface OutreachSequence {
  ok?: boolean;
  sequence?: Array<{ step?: string; subject?: string; body?: string; rationale?: string }>;
  cold?: OutreachEmailVariant | null;
  follow_up?: OutreachEmailVariant | null;
  breakup?: OutreachEmailVariant | null;
  error?: string;
}

const JobCard: React.FC<{ job: EngineJobResult }> = ({ job: j }) => {
  const navigate = useNavigate();
  const toast = useToast();
  const autoSeq = j.outreachSequence && j.outreachSequence.sequence && j.outreachSequence.sequence.length > 0
    ? (j.outreachSequence as OutreachSequence)
    : undefined;
  const [seq, setSeq] = React.useState<OutreachSequence | undefined>(autoSeq);
  const [variant, setVariant] = React.useState<'cold' | 'follow_up' | 'breakup'>('cold');
  const [loading, setLoading] = React.useState(false);
  const [emailError, setEmailError] = React.useState<string | undefined>();
  const [copied, setCopied] = React.useState(false);
  const [saved, setSaved] = React.useState<{ status: 'idle' | 'saving' | 'done' | 'error'; id?: string; message?: string }>({ status: 'idle' });
  const [send, setSend] = React.useState<{ status: 'idle' | 'prompt' | 'sending' | 'sent' | 'error'; to?: string; message?: string }>({ status: 'idle' });
  const [draft, setDraft] = React.useState<{ status: 'idle' | 'saving' | 'done' | 'error'; count?: number; message?: string }>({ status: 'idle' });

  const saveLead = async () => {
    if (saved.status === 'saving' || saved.status === 'done') return;
    setSaved({ status: 'saving' });
    try {
      const api = getApiClient();
      const data = await api.post<{ ok?: boolean; prospect_id?: string; company_id?: string; error?: string }>(
        ENDPOINTS.engineJobSave,
        {
          job: {
            title: j.name,
            company: j.category,
            location: j.city,
            needs: j.needs,
            hiringContext: j.hiringContext,
            companyInfo: j.companyInfo,
            linkedin: j.linkedin,
            snippet: j.snippet,
          },
        },
        { timeoutMs: 30_000, retries: 0 },
      );
      if (!data?.ok || !data?.prospect_id) throw new Error(data?.error || 'Réponse invalide');
      setSaved({ status: 'done', id: data.prospect_id });
    } catch (e) {
      setSaved({ status: 'error', message: (e as Error).message || 'Erreur' });
    }
  };

  const regenerateSequence = async () => {
    if (loading) return;
    setLoading(true);
    setEmailError(undefined);
    try {
      const api = getApiClient();
      const data = await api.post<OutreachSequence>(
        ENDPOINTS.engineJobEmailSequence,
        {
          job: {
            title: j.name,
            company: j.category,
            location: j.city,
            needs: j.needs,
            hiringContext: j.hiringContext,
            companyInfo: j.companyInfo,
            description_snippet: j.snippet,
          },
        },
        { timeoutMs: 120_000, retries: 0 },
      );
      if (!data?.sequence || data.sequence.length === 0) throw new Error(data?.error || 'Réponse IA vide');
      setSeq(data);
      setVariant('cold');
    } catch (e) {
      setEmailError((e as Error).message || 'Erreur');
    } finally {
      setLoading(false);
    }
  };

  const current = seq
    ? (variant === 'cold' ? seq.cold : variant === 'follow_up' ? seq.follow_up : seq.breakup)
    : undefined;

  const copyEmail = async () => {
    const text = `${current?.subject || ''}\n\n${current?.body || ''}`.replace(/<[^>]+>/g, '');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const sendEmail = async () => {
    const to = (send.to || '').trim();
    if (!to || !current) return;
    setSend({ status: 'sending', to });
    try {
      const api = getApiClient();
      const r = await api.post<{ ok: boolean; error?: string | null }>('/integrations/sheets/send-email', {
        to,
        subject: current.subject || '',
        html: current.body || '',
      });
      if (r.ok) {
        setSend({ status: 'sent', to });
        toast.success(`Email envoyé à ${to} via Apps Script (Gmail).`);
      } else {
        setSend({ status: 'error', to, message: r.error || "Apps Script a refusé l'envoi." });
      }
    } catch (e) {
      setSend({ status: 'error', to, message: (e as Error).message || 'Erreur' });
    }
  };

  const saveDraft = async () => {
    if (!seq || draft.status === 'saving' || draft.status === 'done') return;
    setDraft({ status: 'saving' });
    try {
      const api = getApiClient();
      const emails = [
        { tone: 'cold', subject: seq.cold?.subject || '', body: seq.cold?.body || '' },
        { tone: 'follow_up', subject: seq.follow_up?.subject || '', body: seq.follow_up?.body || '' },
        { tone: 'breakup', subject: seq.breakup?.subject || '', body: seq.breakup?.body || '' },
      ].filter((e) => e.body);
      const data = await api.post<{ ok?: boolean; saved?: number; ids?: string[]; error?: string }>(
        ENDPOINTS.engineJobSaveDraft,
        {
          job: { title: j.name, company: j.category, location: j.city, hiringContext: j.hiringContext, companyInfo: j.companyInfo },
          prospect_id: saved.status === 'done' ? saved.id : undefined,
          emails,
        },
        { timeoutMs: 30_000, retries: 0 },
      );
      if (!data?.ok) throw new Error(data?.error || 'Réponse invalide');
      setDraft({ status: 'done', count: data.saved });
      toast.success(`${data.saved} draft(s) enregistré(s) dans Emails.`);
    } catch (e) {
      setDraft({ status: 'error', message: (e as Error).message || 'Erreur' });
    }
  };

  return (
    <li className="rounded-xl border border-border/40 bg-card/40 p-3 space-y-1.5">
      <div className="flex items-start gap-2">
        <span className={cn(
          'w-8 h-8 rounded-lg inline-flex items-center justify-center text-[10px] font-black shrink-0',
          (j.score ?? 0) >= 80
            ? 'bg-emerald-500/20 text-emerald-400'
            : (j.score ?? 0) >= 60
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-violet-500/20 text-violet-400',
        )}>
          {j.score ?? '?'}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-sm leading-tight">{j.name}</div>
          <div className="text-[11px] text-muted-foreground leading-snug">
            {j.category ? <span className="font-semibold text-foreground/90">{j.category}</span> : null}
            {j.city ? ` · ${j.city}` : ''}
          </div>
        </div>
        <Briefcase size={14} className="text-violet-400 shrink-0 mt-1" />
      </div>
      {(j.postedDate || j.salary) && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground pl-10">
          {j.postedDate && <span>🕒 {j.postedDate}</span>}
          {j.salary && <span className="text-emerald-400 font-semibold">{j.salary}</span>}
        </div>
      )}
      {j.snippet && (
        <p className="text-[11px] text-muted-foreground leading-snug pl-10">{j.snippet}</p>
      )}
      {j.companyInfo && (
        <div className="pl-10 flex flex-wrap gap-1.5">
          {j.companyInfo.sector && (
            <span className="px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20 text-[9px] text-violet-300">
              Secteur : {j.companyInfo.sector}
            </span>
          )}
          {j.companyInfo.size && (
            <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/20 text-[9px] text-cyan-300">
              Taille : {j.companyInfo.size}
            </span>
          )}
          {j.companyInfo.headquarters && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[9px] text-emerald-300">
              Siège : {j.companyInfo.headquarters}
            </span>
          )}
        </div>
      )}
      {(j.needs && j.needs.length > 0) && (
        <ul className="pl-10 space-y-0.5">
          {j.needs.map((n, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <CheckCircle2 size={10} className="mt-0.5 shrink-0 text-violet-400" />
              <span>Besoin : {n}</span>
            </li>
          ))}
        </ul>
      )}
      {j.hiringContext && (
        <p className="text-[11px] italic text-muted-foreground/80 pl-10">🎯 {j.hiringContext}</p>
      )}
      <div className="pl-10 pt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={regenerateSequence}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-violet-500/40 bg-violet-500/10 text-violet-300 text-[11px] font-bold hover:bg-violet-500/20 transition-colors disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}
          {loading ? 'Génération…' : seq ? '↻ Regénérer (3 variantes)' : 'Générer 3 emails'}
        </button>
        <button
          type="button"
          onClick={saveLead}
          disabled={saved.status === 'saving' || saved.status === 'done'}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-[11px] font-bold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
        >
          {saved.status === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {saved.status === 'saving' ? 'Enregistrement…' : saved.status === 'done' ? '✓ Lead enregistré' : 'Enregistrer en lead'}
        </button>
        {seq && (
          <button
            type="button"
            onClick={saveDraft}
            disabled={draft.status === 'saving' || draft.status === 'done'}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 text-[11px] font-bold hover:bg-cyan-500/20 transition-colors disabled:opacity-50"
          >
            {draft.status === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            {draft.status === 'saving' ? 'Sauvegarde…' : draft.status === 'done' ? '✓ Drafts enregistrés' : 'Sauver en drafts'}
          </button>
        )}
        {j.linkedin && (
          <a
            href={j.linkedin}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-blue-400 hover:underline inline-flex items-center gap-1"
          >
            Voir l'offre <ExternalLink size={10} />
          </a>
        )}
      </div>
      {saved.status === 'done' && saved.id && (
        <p className="pl-10 text-[11px] text-emerald-400 inline-flex items-center gap-1.5">
          ✓ Lead créé —{' '}
          <button type="button" onClick={() => navigate(`/prospects/${saved.id}`)} className="text-emerald-300 hover:underline font-bold">
            Voir la fiche
          </button>
        </p>
      )}
      {saved.status === 'error' && (
        <p className="pl-10 text-[11px] text-red-400">⚠ {saved.message}</p>
      )}
      {draft.status === 'done' && (
        <p className="pl-10 text-[11px] text-cyan-400 inline-flex items-center gap-1.5">
          ✓ {draft.count ?? 0} draft(s) enregistré(s) —{' '}
          <button type="button" onClick={() => navigate('/emails')} className="text-cyan-300 hover:underline font-bold">
            Voir dans Emails
          </button>
        </p>
      )}
      {draft.status === 'error' && (
        <p className="pl-10 text-[11px] text-red-400">⚠ {draft.message}</p>
      )}
      {emailError && (
        <p className="pl-10 text-[11px] text-red-400">⚠ {emailError}</p>
      )}
      {seq && current && (
        <div className="pl-10 space-y-1.5">
          <div className="inline-flex p-0.5 rounded-lg bg-muted/40 border border-border/40">
            {(['cold', 'follow_up', 'breakup'] as const).map((v) => {
              const label = v === 'cold' ? '❄️ Cold' : v === 'follow_up' ? '🔁 Follow-up' : '👋 Breakup';
              const has = v === 'cold' ? !!seq.cold?.body : v === 'follow_up' ? !!seq.follow_up?.body : !!seq.breakup?.body;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVariant(v)}
                  className={cn(
                    'px-2 py-1 rounded-md text-[10px] font-bold transition-colors',
                    variant === v ? 'bg-violet-500/20 text-violet-300' : 'text-muted-foreground hover:text-foreground',
                    !has && 'opacity-40',
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          {current.rationale && (
            <p className="text-[10px] italic text-muted-foreground/80">💡 {current.rationale}</p>
          )}
          {current.subject && (
            <div className="text-[12px] font-bold leading-snug">Objet : {current.subject}</div>
          )}
          {current.body && (
            <div className="rounded-lg border border-border/40 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-2 py-1 bg-muted/40 border-b border-border/40">
                <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Aperçu email (HTML)</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={copyEmail} className="text-[10px] font-bold text-primary hover:underline">
                    {copied ? 'Copié ✓' : 'Copier'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSend((s) => (s.status === 'prompt' || s.status === 'sending' ? { status: 'idle' } : { status: 'prompt' }))}
                    className="text-[10px] font-bold text-emerald-300 hover:underline inline-flex items-center gap-1"
                  >
                    <Send size={10} /> Envoyer
                  </button>
                </div>
              </div>
              <div
                className="max-h-64 overflow-y-auto p-3 text-[11px] leading-relaxed [&_a]:text-blue-400 [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: current.body }}
              />
            </div>
          )}
          {(send.status === 'prompt' || send.status === 'sending' || send.status === 'error') && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <input
                value={send.to || ''}
                onChange={(e) => setSend((s) => ({ ...s, to: e.target.value }))}
                placeholder="Destinataire (email)…"
                className="h-9 flex-1 min-w-[180px] bg-card/80 border border-border/60 rounded-lg px-3 text-sm focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
              <button
                type="button"
                onClick={sendEmail}
                disabled={send.status === 'sending' || !(send.to || '').trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[11px] font-bold hover:bg-emerald-500/90 transition-colors disabled:opacity-50"
              >
                {send.status === 'sending' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                {send.status === 'sending' ? 'Envoi…' : 'Envoyer via Gmail'}
              </button>
            </div>
          )}
          {send.status === 'sent' && (
            <p className="text-[11px] text-emerald-400">✓ Email envoyé à {send.to} via Apps Script (Gmail).</p>
          )}
          {send.status === 'error' && (
            <p className="text-[11px] text-red-400">⚠ {send.message}</p>
          )}
        </div>
      )}
    </li>
  );
};

const JobsComposer: React.FC<{
  keywords: string;
  setKeywords: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
  count: number;
  setCount: (v: number) => void;
  onSubmit: () => void;
  isPending: boolean;
}> = ({ keywords, setKeywords, location, setLocation, count, setCount, onSubmit, isPending }) => {
  const valid = keywords.trim().length > 0;
  return (
    <div className="border-t border-border/40 bg-background/50 backdrop-blur pt-3 space-y-2">
      <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/5 via-card/60 to-fuchsia-500/5 p-4 space-y-3 shadow-lg shadow-violet-500/10">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <label className="md:col-span-5 block">
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-400 mb-1 inline-flex items-center gap-1">
              <Briefcase size={10} /> Poste / mots-clés *
            </div>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Ex : Head of Sales, Account Executive, SDR…"
              className="w-full h-10 bg-card/80 border border-border/60 rounded-lg px-3 text-sm focus:border-violet-500/60 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </label>
          <label className="md:col-span-4 block">
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-400 mb-1 inline-flex items-center gap-1">
              <Globe size={10} /> Localisation
            </div>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="France, Europe, Remote…"
              className="w-full h-10 bg-card/80 border border-border/60 rounded-lg px-3 text-sm focus:border-violet-500/60 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
            />
          </label>
          <label className="md:col-span-3 block">
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-400 mb-1 inline-flex items-center gap-1">
              <Target size={10} /> Quantité
              <span className="ml-auto font-mono text-violet-400 normal-case tracking-normal">{count}</span>
            </div>
            <input
              type="range"
              min={1}
              max={25}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full h-10 accent-violet-500"
              style={{ padding: 0 }}
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[10px] text-muted-foreground leading-snug max-w-[440px]">
            Recherche de jobs + entreprises LinkedIn via <strong>Zentara Jobs</strong> — moteur MCP
            <code> search_jobs</code> + enrichissement <code>get_company_profile</code>.
          </p>
          <Button
            onClick={onSubmit}
            disabled={!valid || isPending}
            className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-95 shadow-lg shadow-violet-500/30 h-11 px-5 shrink-0"
          >
            {isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recherche…</>
            ) : (
              <><Briefcase className="mr-2 h-4 w-4" /> 💼 Chercher des jobs LinkedIn</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

// =====================================================================
// Research composer (Round 39 — niche / quantity / region / context)
// =====================================================================

const QUICK_NICHES = [
  'SaaS B2B', 'FinTech', 'HealthTech', 'Marketplace', 'EdTech', 'SaaS B2C',
  'GreenTech', 'Consulting', 'Cybersécurité', 'IA / ML',
];

const ResearchComposer: React.FC<{
  niche: string;
  setNiche: (v: string) => void;
  region: string;
  setRegion: (v: string) => void;
  quantity: number;
  setQuantity: (v: number) => void;
  context: string;
  setContext: (v: string) => void;
  onSubmit: () => void;
  isPending: boolean;
}> = ({ niche, setNiche, region, setRegion, quantity, setQuantity, context, setContext, onSubmit, isPending }) => {
  const valid = niche.trim().length > 0;
  return (
    <div className="border-t border-border/40 bg-background/50 backdrop-blur pt-3 space-y-2">
      {/* Quick niche chips */}
      <div className="flex items-center gap-1.5 flex-wrap pb-1">
        <Layers size={11} className="text-muted-foreground" />
        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mr-1">
          Niche rapide :
        </span>
        {QUICK_NICHES.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setNiche(q)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors',
              niche.trim().toLowerCase() === q.toLowerCase()
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border/40 bg-card/40 text-muted-foreground hover:bg-primary/10 hover:text-primary',
            )}
          >
            {q}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-lime-500/30 bg-gradient-to-br from-lime-500/5 via-card/60 to-lime-400/5 p-4 space-y-3 shadow-lg shadow-lime-500/10">
        {/* Ligne : niche + région + quantité */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <label className="md:col-span-5 block">
            <div className="text-[10px] font-black uppercase tracking-widest text-lime-400 mb-1 inline-flex items-center gap-1">
              <Megaphone size={10} /> Niche / secteur *
            </div>
            <input
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="Ex : SaaS B2B FinTech, Marketplace, HealthTech…"
              className="w-full h-10 bg-card/80 border border-border/60 rounded-lg px-3 text-sm focus:border-lime-500/60 focus:outline-none focus:ring-2 focus:ring-lime-500/20"
            />
          </label>
          <label className="md:col-span-4 block">
            <div className="text-[10px] font-black uppercase tracking-widest text-lime-400 mb-1 inline-flex items-center gap-1">
              <Globe size={10} /> Région
            </div>
            <input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="France, EMEA, DACH, Global…"
              className="w-full h-10 bg-card/80 border border-border/60 rounded-lg px-3 text-sm focus:border-lime-500/60 focus:outline-none focus:ring-2 focus:ring-lime-500/20"
            />
          </label>
          <label className="md:col-span-3 block">
            <div className="text-[10px] font-black uppercase tracking-widest text-lime-400 mb-1 inline-flex items-center gap-1">
              <Target size={10} /> Quantité
              <span className="ml-auto font-mono text-lime-400 normal-case tracking-normal">{quantity}</span>
            </div>
            <input
              type="range"
              min={1}
              max={25}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full h-10 accent-lime-500"
              style={{ padding: 0 }}
            />
            <div className="flex justify-between text-[9px] font-mono text-muted-foreground/60 mt-0.5">
              <span>1</span><span>10</span><span>25</span>
            </div>
          </label>
        </div>

        {/* Contexte long */}
        <label className="block">
          <div className="text-[10px] font-black uppercase tracking-widest text-cyan-400 mb-1 inline-flex items-center gap-1">
            <Lightbulb size={10} /> Contexte additionnel (ICP custom, événements déclencheurs, ciblage…)
          </div>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={2}
            placeholder="Ex : cibles ayant levé récemment, qui recrutent des commerciaux ou un CIO, en pleine expansion EMEA, sensibles à la veille concurrentielle…"
            className="w-full bg-card/80 border border-border/60 rounded-lg px-3 py-2 text-sm resize-y focus:border-lime-500/60 focus:outline-none focus:ring-2 focus:ring-lime-500/20"
          />
        </label>

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-[10px] text-muted-foreground leading-snug max-w-[440px]">
            Lance le <em>moteur de recherche réel Zentara</em> : annuaires publics + SEC EDGAR +
            OpenStreetMap/Maps + LinkedIn. Les entreprises trouvées sont persistées dans Companies.
          </p>
          <Button
            onClick={onSubmit}
            disabled={!valid || isPending}
            className="bg-gradient-to-r from-lime-500 via-lime-400 to-lime-300 text-black hover:opacity-95 shadow-lg shadow-lime-500/30 h-11 px-5 shrink-0"
          >
            {isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Recherche réelle en cours…</>
            ) : (
              <><Search className="mr-2 h-4 w-4" /> 🚀 Lancer la recherche</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

// =====================================================================
// Empty state
// =====================================================================

const EmptyView: React.FC<{
  onPick: (prompt: string) => void;
  provider: string | null;
  mode: Mode;
}> = ({ onPick, provider, mode }) => (
  <div className="px-2 md:px-6 py-6 max-w-3xl mx-auto">
    <div className="flex flex-col items-center text-center mb-6">
      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-pink-500 text-white flex items-center justify-center mb-4 shadow-xl shadow-violet-500/30">
        <Sparkles size={28} />
      </div>
      <h2 className="text-xl md:text-2xl font-black tracking-tight mb-1">
        {mode === 'research'
          ? 'Lance une recherche stratégique'
          : mode === 'jobs'
            ? 'Cherche des jobs LinkedIn'
            : 'Comment puis-je t aider ?'}
      </h2>
      <p className="text-sm text-muted-foreground max-w-md">
        {mode === 'research'
          ? 'Choisis une niche, une quantité et un contexte, puis clique sur 🚀 Lancer la recherche. Le moteur Zentara interrogera les annuaires publics, Maps et LinkedIn pour trouver de vraies entreprises.'
          : mode === 'jobs'
            ? 'Saisis un poste ou des mots-clés, puis clique sur 💼 Chercher des jobs LinkedIn. Le moteur interroge search_jobs puis enrichit chaque entreprise qui recrute.'
            : `Je suis ${provider ?? 'Zentara'} — ton copilote stratégique. Pose-moi une question, ou choisis une piste ci-dessous.`}
      </p>
    </div>
    {mode === 'discussion' && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => onPick(s.prompt)}
            className={cn(
              'group rounded-2xl border border-border/40 bg-card/60 p-4 text-left',
              'hover:border-primary/40 hover:bg-card transition-all active:scale-[0.99] shadow-sm',
            )}
          >
            <div className="flex items-center gap-2 mb-2 text-primary">
              <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center">
                {s.icon}
              </div>
              <span className="text-sm font-black tracking-tight">{s.label}</span>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">{s.prompt}</p>
            <div className="flex justify-end mt-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity">
              <ChevronRight size={14} />
            </div>
          </button>
        ))}
      </div>
    )}
  </div>
);

export default ChatPage;
