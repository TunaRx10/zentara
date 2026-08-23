/**
 * ai.js — AI provider helper.
 *
 * NVIDIA NIM primary (tons of free tokens, no rate limits),
 * Gemini / OpenRouter / Mistral as fallback.
 *
 * No external deps: uses Node's global `fetch`. Keys are read from env
 * (loaded via process.loadEnvFile in server.js) or process.env directly.
 */
'use strict';

const DEFAULT_PROVIDER = (process.env.AI_PROVIDER || 'nvidia').toLowerCase();
const DEFAULT_MODEL = process.env.AI_MODEL || 'nvidia/nemotron-3-ultra-550b-a55b';

// Native Google Gemini models (verified working on this key, generateContent).
// flash-lite = non-« thinking » (~3s) → modèle principal par défaut.
// 3.x flash = modèles « thinking » (lents ~10-20s) → conservés en option pour la qualité max.
const GEMINI_MODELS = [
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', hint: 'rapide (~3s) · recommandé' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', hint: 'thinking · ~20s' },
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', hint: 'thinking · ~10s' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', hint: 'thinking · ~15s' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', hint: 'preview' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B', hint: 'open' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 31B', hint: 'open' },
];

// Free-tier OpenRouter models, ordered from the most powerful to the lightest.
const OPENROUTER_MODELS = [
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B', hint: 'le plus puissant (free)' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B', hint: '120B' },
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B', hint: '31B' },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B', hint: '26B · rapide' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron Nano Omni 30B', hint: '30B · raisonnement' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free', label: 'Nemotron Nano 30B', hint: '30B' },
  { id: 'z-ai/glm-5.2:free', label: 'GLM 5.2', hint: 'polyvalent' },
  { id: 'openai/gpt-oss-20b:free', label: 'GPT-OSS 20B', hint: '20B · open' },
  { id: 'nvidia/nemotron-nano-12b-v2-vl:free', label: 'Nemotron Nano 12B VL', hint: '12B · vision' },
  { id: 'nvidia/nemotron-nano-9b-v2:free', label: 'Nemotron Nano 9B', hint: '9B' },
  { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning', hint: 'rapide' },
  { id: 'cohere/north-mini-code:free', label: 'Cohere North Mini Code', hint: 'code' },
  { id: 'poolside/laguna-s-2.1:free', label: 'Laguna S 2.1', hint: 'code' },
  { id: 'poolside/laguna-xs-2.1:free', label: 'Laguna XS 2.1', hint: 'code léger' },
  { id: 'liquid/lfm-2.5-2.6b:free', label: 'Liquid LFM 2.6B', hint: '2.6B · edge' },
  { id: 'nvidia/nemotron-3.5-content-safety:free', label: 'Nemotron Content Safety', hint: 'modération' },
  { id: 'dots-studio/dots-3-note-preview:free', label: 'Dots3 Note', hint: 'note & audio' },
];

const MISTRAL_MODELS = [
  { id: 'mistral-small-latest', label: 'Mistral Small', hint: 'équilibré' },
  { id: 'mistral-medium-latest', label: 'Mistral Medium', hint: 'qualité' },
  { id: 'open-mistral-nemo', label: 'Mistral Nemo', hint: 'rapide' },
];

// NVIDIA NIM (integrate.api.nvidia.com) — OpenAI-compatible endpoint.
// Routeur IA (§49 du cahier des charges) : un modèle par type de tâche.
// Modèles vérifiés live (HTTP 200) le 2026-08-23.
const NVIDIA_MODELS = [
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra 550B', hint: 'raisonnement stratégique · synthèse finale · rapports longs' },
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B', hint: 'analyse business · rédaction · recherche' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', label: 'Nemotron Nano Omni 30B', hint: '30B · raisonnement · multimodal' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b', label: 'Nemotron Nano 30B', hint: '30B · worker agents · classification' },
  { id: 'nvidia/nemotron-nano-12b-v2-vl', label: 'Nemotron Nano 12B VL', hint: '12B · vision · documents' },
];

function geminiKey() {
  return (process.env.GEMINI_API_KEY || '').trim();
}
function openRouterKey() {
  return (process.env.OPENROUTER_API_KEY || '').trim();
}
function mistralKey() {
  return (process.env.MISTRAL_API_KEY || '').trim();
}
function nvidiaKey() {
  return (process.env.NVIDIA_API_KEY || '').trim();
}

/** Resolve a provider name → the best available provider ('nvidia' | 'gemini' | 'openrouter' | 'mistral' | null). */
function resolveProvider(provider) {
  const p = String(provider || DEFAULT_PROVIDER).toLowerCase();
  if (p === 'nvidia' && nvidiaKey()) return 'nvidia';
  if (p === 'gemini' && geminiKey()) return 'gemini';
  if (p === 'openrouter' && openRouterKey()) return 'openrouter';
  if (p === 'mistral' && mistralKey()) return 'mistral';
  if (nvidiaKey()) return 'nvidia';
  if (geminiKey()) return 'gemini';
  if (openRouterKey()) return 'openrouter';
  if (mistralKey()) return 'mistral';
  return null;
}

/** List of configured providers (for the chat provider selector). */
function providers() {
  const list = [];
  if (nvidiaKey()) list.push({ name: 'nvidia', configured: true, verified: true });
  if (geminiKey()) list.push({ name: 'gemini', configured: true, verified: true });
  if (openRouterKey()) list.push({ name: 'openrouter', configured: true, verified: true });
  if (mistralKey()) list.push({ name: 'mistral', configured: true, verified: true });
  return list;
}

/** Models offered for a given provider. */
function modelsFor(provider) {
  const p = resolveProvider(provider);
  if (p === 'openrouter') return OPENROUTER_MODELS;
  if (p === 'mistral') return MISTRAL_MODELS;
  if (p === 'nvidia') return NVIDIA_MODELS;
  return GEMINI_MODELS;
}

/**
 * Ordered list of configured providers to try (requested first, then the rest).
 */
function fallbackChain(requested) {
  const req = String(requested || '').toLowerCase();
  const configured = [];
  if (nvidiaKey()) configured.push('nvidia');
  if (geminiKey()) configured.push('gemini');
  if (openRouterKey()) configured.push('openrouter');
  if (mistralKey()) configured.push('mistral');
  if (configured.length === 0) return [];
  const primary = req && configured.includes(req)
    ? req
    : configured.includes(DEFAULT_PROVIDER)
      ? DEFAULT_PROVIDER
      : configured[0];
  return [primary, ...configured.filter((p) => p !== primary)];
}

/**
 * Single-provider completion (throws on error).
 * @returns {{ content: string, provider: string, model: string, latencyMs: number }}
 */
async function chatCompletionSingle(provider, messages, opts = {}) {
  const started = Date.now();

  if (provider === 'gemini') {
    const model = opts.model || DEFAULT_MODEL;
    const systemParts = messages.filter((m) => m.role === 'system').map((m) => ({ text: m.content }));
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    const generationConfig = {};
    if (opts.maxTokens) generationConfig.maxOutputTokens = opts.maxTokens;
    if (opts.json) generationConfig.responseMimeType = 'application/json';

    const body = { contents, generationConfig };
    if (systemParts.length > 0) body.systemInstruction = { parts: systemParts };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey() },
        body: JSON.stringify(body),
      },
    );
    const parsed = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = parsed?.error?.message || res.statusText;
      const err = new Error(`Gemini ${res.status}: ${msg}`);
      err.code = 'AI_ERROR';
      err.status = res.status;
      throw err;
    }
    const content = (parsed?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('');
    return { content, provider: 'gemini', model, latencyMs: Date.now() - started };
  }

  if (provider === 'mistral') {
    const model = opts.model || 'mistral-small-latest';
    const body = { model, messages };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: 'json_object' };
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mistralKey()}` },
      body: JSON.stringify(body),
    });
    const parsed = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`Mistral ${res.status}: ${parsed?.error?.message || parsed?.message || res.statusText}`);
      err.code = 'AI_ERROR';
      err.status = res.status;
      throw err;
    }
    const content = parsed?.choices?.[0]?.message?.content ?? '';
    return { content, provider: 'mistral', model, latencyMs: Date.now() - started };
  }

  if (provider === 'nvidia') {
    const model = opts.model || 'nvidia/nemotron-3-ultra-550b-a55b';
    const body = { model, messages, temperature: 1, top_p: 0.95 };
    if (opts.maxTokens) body.max_tokens = opts.maxTokens;
    if (opts.json) body.response_format = { type: 'json_object' };
    const res = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${nvidiaKey()}` },
      body: JSON.stringify(body),
    });
    const parsed = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(`NVIDIA ${res.status}: ${parsed?.error?.message || parsed?.message || res.statusText}`);
      err.code = 'AI_ERROR';
      err.status = res.status;
      throw err;
    }
    const content = parsed?.choices?.[0]?.message?.content ?? '';
    return { content, provider: 'nvidia', model, latencyMs: Date.now() - started };
  }

  // OpenRouter
  const model = opts.model || 'google/gemma-4-26b-a4b-it:free';
  const body = { model, messages };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  if (opts.json) body.response_format = { type: 'json_object' };
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${openRouterKey()}`,
      'HTTP-Referer': 'https://zentara.app',
      'X-Title': 'Zentara',
    },
    body: JSON.stringify(body),
  });
  const parsed = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = parsed?.error?.message || parsed?.message || res.statusText;
    const err = new Error(`OpenRouter ${res.status}: ${msg}`);
    err.code = 'AI_ERROR';
    err.status = res.status;
    throw err;
  }
  const content = parsed?.choices?.[0]?.message?.content ?? '';
  return { content, provider: 'openrouter', model, latencyMs: Date.now() - started };
}

/**
 * Low-level chat completion with automatic fallback across providers.
 * Tries the requested (or default) provider first, then falls back to the
 * other configured providers on any error.
 * @returns {{ content: string, provider: string, model: string, latencyMs: number, fallback: boolean }}
 */
async function chatCompletion(messages, opts = {}) {
  const chain = fallbackChain(opts.provider);
  if (chain.length === 0) {
    const err = new Error('Aucune clé IA configurée (GEMINI_API_KEY / OPENROUTER_API_KEY / MISTRAL_API_KEY / NVIDIA_API_KEY)');
    err.code = 'NO_AI_PROVIDER';
    throw err;
  }

  let lastErr;
  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    // Only the first provider gets the explicit model; fallbacks use their default.
    const singleOpts = i === 0 ? opts : { ...opts, model: undefined };
    try {
      const r = await chatCompletionSingle(provider, messages, singleOpts);
      // Un rate-limit (ou un blocage) renvoie parfois HTTP 200 avec un contenu VIDE,
      // sans lever d'exception. On traite ce cas comme un échec → provider suivant.
      if (r && String(r.content || '').trim().length > 0) {
        return { ...r, fallback: i > 0 };
      }
      lastErr = new Error(`${provider} a renvoyé une réponse vide`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Extract a JSON object from an LLM reply (handles ```json fences). */
function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  // 1) Préférer UNIQUEMENT un bloc fencé ```json ... ``` (il peut y avoir d'autres
  //    blocs fencés avant, ex. ```html pour un email — on prend le json).
  const jsonFenced = trimmed.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFenced) {
    try {
      return JSON.parse(jsonFenced[1].trim());
    } catch {
      /* on retombe sur le fallback générique */
    }
  }
  // 2) Sinon dernier bloc fencé quelconque (souvent le JSON final du prompt).
  const fences = trimmed.match(/```(?:json|javascript|js)?\s*([\s\S]*?)```/gi);
  if (fences && fences.length > 0) {
    const last = fences[fences.length - 1].replace(/^```[^\n]*\n?/, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(last);
    } catch {
      /* fallback { ... } */
    }
  }
  const candidate = trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    // Fallback: find the first {...} block.
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

module.exports = {
  DEFAULT_PROVIDER,
  DEFAULT_MODEL,
  GEMINI_MODELS,
  OPENROUTER_MODELS,
  MISTRAL_MODELS,
  NVIDIA_MODELS,
  resolveProvider,
  providers,
  modelsFor,
  chatCompletion,
  extractJson,
};
