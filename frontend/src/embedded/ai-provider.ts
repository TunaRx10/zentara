/**
 * ai-provider.ts — Appel réel aux providers d'IA (NVIDIA NIM, Gemini, OpenRouter, Mistral)
 * en mode EMBARQUÉ (backend in-app, offline-first).
 *
 * Les clés sont lues :
 *   1. depuis les réglages utilisateur (localStorage, préfixe `zentara.ai.`), puis
 *   2. depuis l'env Vite (`VITE_*_API_KEY`) à la compilation.
 * Elles ne sont JAMAIS committées dans le repo (fichiers .env gitignorés).
 *
 * Si aucune clé n'est configurée, le routeur retombe sur sa réponse heuristique.
 */

export type AiProviderId = 'nvidia' | 'gemini' | 'openrouter' | 'mistral';

export interface AiProviderDef {
  id: AiProviderId;
  label: string;
  baseUrl: string;
  envKey: string;
  defaultModel: string;
  models: string[];
}

export interface AiProviderStatus extends AiProviderDef {
  configured: boolean;
}

const PROVIDERS: AiProviderDef[] = [
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    envKey: 'VITE_NVIDIA_API_KEY',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    models: [
      'nvidia/nemotron-3-ultra-550b-a55b',
      'nvidia/nemotron-3-super-120b',
      'nvidia/nemotron-3.5-lightning-30b',
      'nvidia/nemotron-nano',
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKey: 'VITE_GEMINI_API_KEY',
    defaultModel: 'gemini-3.6-flash',
    models: ['gemini-3.6-flash', 'gemini-3-pro', 'gemini-2.5-flash'],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'VITE_OPENROUTER_API_KEY',
    defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    models: [
      'nvidia/nemotron-3-ultra-550b-a55b:free',
      'google/gemma-3-27b-it:free',
      'deepseek/deepseek-chat:free',
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    envKey: 'VITE_MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    models: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
  },
];

const RUNTIME_PREFIX = 'zentara.ai.';

function readEnv(name: string): string {
  try {
    const env = import.meta.env as Record<string, string | undefined>;
    const v = env[name];
    return typeof v === 'string' && v.trim().length > 0 ? v.trim() : '';
  } catch {
    return '';
  }
}

function readRuntime(id: string): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(RUNTIME_PREFIX + id) ?? '';
  } catch {
    return '';
  }
}

/** Clé effective d'un provider : runtime (réglages) sinon env Vite. */
export function getProviderKey(id: AiProviderId): string {
  const def = PROVIDERS.find((p) => p.id === id);
  if (!def) return '';
  const runtime = readRuntime(id);
  if (runtime.length > 0) return runtime;
  return readEnv(def.envKey);
}

/** Statut complet de tous les providers (avec clé configurée ou non). */
export function getAllProviders(): AiProviderStatus[] {
  return PROVIDERS.map((p) => ({ ...p, configured: getProviderKey(p.id).length > 0 }));
}

export interface ResolvedAiProvider {
  provider: AiProviderDef;
  key: string;
  model: string;
}

/** Résout le provider à utiliser : préféré sinon 1er fournisseur avec une clé. */
export function resolveProvider(preferred?: string, preferredModel?: string): ResolvedAiProvider | null {
  const all = getAllProviders();
  const ordered = preferred
    ? [...all.filter((p) => p.id === preferred), ...all.filter((p) => p.id !== preferred)]
    : [...all.filter((p) => p.id === 'nvidia'), ...all];
  for (const p of ordered) {
    if (!p.configured) continue;
    return { provider: p, key: getProviderKey(p.id), model: preferredModel || p.defaultModel };
  }
  return null;
}

export interface AiChatResult {
  content: string;
  provider: AiProviderId;
  model: string;
  latencyMs: number;
}

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** Appel `POST /chat/completions` (compatible OpenAI) sans streaming. */
export async function callProviderChat(
  resolved: ResolvedAiProvider,
  messages: AiChatMessage[],
  signal?: AbortSignal,
  timeoutMs = 45000,
): Promise<AiChatResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const t0 = Date.now();
  try {
    const res = await fetch(`${resolved.provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.key}`,
        ...(resolved.provider.id === 'openrouter'
          ? { 'HTTP-Referer': 'https://zentara.app', 'X-Title': 'Zentara' }
          : {}),
      },
      body: JSON.stringify({
        model: resolved.model,
        messages,
        temperature: 0.6,
        max_tokens: 1200,
        stream: false,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = '';
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      throw new Error(`HTTP ${res.status} ${detail}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (data?.error) throw new Error(data.error.message ?? 'provider error');
    const content = data?.choices?.[0]?.message?.content ?? '';
    if (!content) throw new Error('réponse vide du provider');
    return { content, provider: resolved.provider.id, model: resolved.model, latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Réponse heuristique de repli quand aucun provider IA n'est configuré.
 * Présente une aide stratégique générique et oriente vers la configuration.
 */
export function buildStubReply(_userContent: string): string {
  return (
    "Je tourne actuellement en mode **local (hors-ligne)** — aucun fournisseur d'IA n'a encore été activé.\n\n" +
    'Pour activer la recherche, l’analyse et la génération réelles, deux options :\n\n' +
    '1. **Clé IA côté « Réglages → API & Clés »** : colle ta clé NVIDIA NIM (ou Gemini/OpenRouter/Mistral) → les sections analyses utiliseront le vrai modèle demandé.\n' +
    '2. **Backend connecté** : renseigne l’URL du backend Zentara dans Réglages → tout le pipeline multi-IA (NVIDIA) est actif.\n\n' +
    'En attendant, je peux quand même t’aider avec la recherche (annuaires SEC EDGAR / OpenStreetMap), le scoring déterministe et le drafting d’emails basés sur le potentiel de revenus estimé. Que veux-tu explorer ?'
  );
}