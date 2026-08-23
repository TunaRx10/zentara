/** Client HTTP typé pour le backend Zentara. ... */
import { ENDPOINTS } from './endpoints';
import { handleLocalRequest, isEmbeddedMode } from '@/embedded/embedded';

export interface ApiErrorPayload {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: unknown;
}

export interface ApiSuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: unknown;
}

export type ApiResponse<T> = ApiSuccessEnvelope<T> | ApiErrorPayload;

export class ZentaraApiError extends Error {
  override name = 'ZentaraApiError';
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly meta?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown, meta?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.meta = meta;
    Object.setPrototypeOf(this, ZentaraApiError.prototype);
  }

  isRetryable(): boolean {
    if (this.code === 'NETWORK_UNAVAILABLE' || this.code === 'TIMEOUT') return true;
    return this.status === 408 || this.status === 429 || (this.status >= 500 && this.status < 600);
  }
}

export interface ApiClientOptions {
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface ApiRequestOptions extends ApiClientOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
}

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY = 250;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function computeBackoff(attempt: number, baseDelay: number): number {
  return Math.min(baseDelay * 2 ** attempt, 8_000) + Math.random() * 120;
}

async function readBody<T>(res: Response): Promise<ApiResponse<T>> {
  const text = await res.text();
  if (!text) {
    if (!res.ok) throw new ZentaraApiError(res.status, 'EMPTY_BODY', `HTTP ${res.status}`);
    return { success: true, data: undefined as unknown as T };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (_e) {
    throw new ZentaraApiError(res.status, 'INVALID_JSON', `Réponse non-JSON (HTTP ${res.status})`);
  }
  if (!parsed || typeof parsed !== 'object' || !('success' in parsed)) {
    throw new ZentaraApiError(res.status, 'BAD_SHAPE', 'Réponse sans champ `success`');
  }
  return parsed as ApiResponse<T>;
}

type TokenGetter = () => string | null | Promise<string | null>;
type UnauthorizedHandler = () => void;

class ApiClient {
  private readonly baseUrl: string;
  private tokenGetter: TokenGetter = () => null;
  private onUnauthorized: UnauthorizedHandler = () => undefined;

  constructor(baseUrl: string) {
    if (!baseUrl) throw new Error('ApiClient : baseUrl manquant');
    this.baseUrl = baseUrl;
  }

  setTokenGetter(getter: TokenGetter): void { this.tokenGetter = getter; }
  setOnUnauthorized(handler: UnauthorizedHandler): void { this.onUnauthorized = handler; }

  get<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }
  post<T>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }
  put<T>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }
  /** Round 92 — PATCH (idempotent partial update). */
  patch<T>(path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, body, options);
  }
  delete<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  async request<T>(method: string, path: string, body?: unknown, options: ApiRequestOptions = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
    const retries = options.retries ?? DEFAULT_RETRIES;
    const baseDelay = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY;

    const queryString = options.query ? buildQuery(options.query) : '';
    const url = `${this.baseUrl}${path}${queryString}`;

    // =====================================================================
    // Round 142 — Backend EMBARQUÉ (mode offline-first).
    //   Le routeur local répond aux endpoints de l'app à partir de la base
    //   locale (données + scoring déterministe + templates + jobs).
    //   - Mode embarqué (par défaut dans l'APK) : local d'abord, réseau
    //     seulement pour les routes non gérées localement.
    //   - Mode distant (URL serveur configurée) : réseau d'abord, repli
    //     local si le serveur est injoignable (l'app ne meurt jamais).
    // =====================================================================
    const embeddedFirst = isEmbeddedMode();
    const localAttempt = (): T | undefined => {
      try {
        const local = handleLocalRequest(method, path, body);
        if (!local.handled) return undefined;
        if (local.error) {
          throw new ZentaraApiError(local.error.status ?? 500, local.error.code, local.error.message);
        }
        try {
          window.dispatchEvent(new CustomEvent('zentara:network-status', { detail: { online: true } }));
        } catch (_e) { /* non-browser */ }
        return local.data as T;
      } catch (err) {
        if (err instanceof ZentaraApiError) throw err;
        return undefined; // routeur local indisponible → réseau
      }
    };

    if (embeddedFirst) {
      const out = localAttempt();
      if (out !== undefined) return out;
    }

    const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
    const tokenResult = this.tokenGetter();
    const token = tokenResult instanceof Promise ? await tokenResult : tokenResult;
    const lowerHeaderKeys = new Set(Object.keys(headers).map((k) => k.toLowerCase()));
    if (token && !lowerHeaderKeys.has('authorization')) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    let bodyPayload: BodyInit | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyPayload = JSON.stringify(body);
    }

    let lastError: ZentaraApiError | null = null;
    try {
      for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
        const onExternalAbort = options.signal ? () => controller.abort(options.signal?.reason) : null;
        options.signal?.addEventListener('abort', onExternalAbort as EventListener, { once: true });

        try {
          const res = await fetch(url, { method, headers, body: bodyPayload, signal: controller.signal });
          clearTimeout(timeoutId);
          options.signal?.removeEventListener?.('abort', onExternalAbort as EventListener);
          try {
            window.dispatchEvent(new CustomEvent('zentara:network-status', { detail: { online: true } }));
          } catch (_e) { /* non-browser */ }
          const parsed = await readBody<T>(res);
          if (!parsed.success) {
            if (res.status === 401) {
              try { this.onUnauthorized(); } catch (_e) { /* ignore */ }
            }
            throw new ZentaraApiError(
              res.status,
              parsed.error?.code ?? 'API_ERROR',
              parsed.error?.message ?? `HTTP ${res.status}`,
              parsed.error?.details,
              parsed.meta,
            );
          }
          return parsed.data;
        } catch (err) {
          clearTimeout(timeoutId);
          options.signal?.removeEventListener?.('abort', onExternalAbort as EventListener);
          if (err instanceof ZentaraApiError) {
            lastError = err;
            if (attempt < retries && err.isRetryable()) {
              await sleep(computeBackoff(attempt, baseDelay));
              continue;
            }
            if (err.code === 'NETWORK_UNAVAILABLE' || err.code === 'TIMEOUT') {
              try {
                window.dispatchEvent(new CustomEvent('zentara:network-status', { detail: { online: false } }));
              } catch (_e) { /* non-browser env */ }
            }
            throw err;
          }
          if (err instanceof DOMException && err.name === 'AbortError') {
            if (options.signal?.aborted) throw new ZentaraApiError(0, 'CANCELLED', 'Requête annulée');
            const timeoutErr = new ZentaraApiError(408, 'TIMEOUT', `Timeout après ${timeoutMs}ms`);
            lastError = timeoutErr;
            if (attempt < retries) { await sleep(computeBackoff(attempt, baseDelay)); continue; }
            throw timeoutErr;
          }
          if (err instanceof TypeError) {
            const netErr = new ZentaraApiError(0, 'NETWORK_UNAVAILABLE', 'Backend injoignable');
            lastError = netErr;
            try {
              window.dispatchEvent(new CustomEvent('zentara:network-status', { detail: { online: false } }));
            } catch (_e) { /* SSR */ }
            if (attempt < retries) { await sleep(computeBackoff(attempt, baseDelay)); continue; }
            throw netErr;
          }
          throw new ZentaraApiError(0, 'UNKNOWN_ERROR', String((err as Error)?.message ?? err));
        }
      }
    } catch (err) {
      // Repli local quand un serveur distant est configuré mais injoignable.
      if (!embeddedFirst && !(err instanceof ZentaraApiError && err.code === 'CANCELLED')) {
        const out = localAttempt();
        if (out !== undefined) return out;
      }
      throw err;
    }
    throw lastError ?? new ZentaraApiError(0, 'UNKNOWN_ERROR', 'Retry épuisé');
  }
}

function buildQuery(q: Record<string, string | number | boolean | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === null || v === undefined) continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

let _client: ApiClient | null = null;

/**
 * Round 12 — baseUrl robuste.
 *
 * Séquence de résolution :
 *  1. Runtime override (window.__ZENTARA_API_BASE__) — utile pour tests E2E.
 *  2. Variable d'env Vite (VITE_API_BASE_URL) — utile pour dev LAN standalone.
 *  3. Chemin RELATIF `/api` — robuste par défaut : fonctionne pour le
 *     monolith (frontend servi par le backend sur la même origine) et
 *     pour tout déploiement reverse-proxifié. Évite le mixed-content
 *     HTTPS → HTTP et les soucis CORS cross-origin (cas des proxys
 *     CloudShell, ngrok, Codespaces, etc.).
 *
 * IMPORTANT : on ne hardcode PLUS `http://localhost:4000/api` car ça
 * bloque les déploiements HTTPS où `localhost` n'est pas le même host
 * que celui servi par le backend (ex: proxy CloudShell).
 */
const API_BASE_STORAGE_KEY = 'zentara.api.base';

/**
 * Résout l'URL de base de l'API, dans l'ordre :
 *  1. Surcharge runtime persistée (Settings → « Backend ») — permet de
 *     changer le tunnel/URL SANS rebuild de l'APK.
 *  2. Runtime override (window.__ZENTARA_API_BASE__) — tests E2E.
 *  3. Variable d'env Vite (VITE_API_BASE_URL) — bake au build.
 *  4. Chemin RELATIF `/api` — monolith / reverse-proxy.
 */
export function getApiBase(): string {
  const stored =
    typeof localStorage !== 'undefined' ? localStorage.getItem(API_BASE_STORAGE_KEY) : null;
  if (stored && stored.trim().length > 0) return stored.trim();
  const runtimeOverride =
    typeof window !== 'undefined'
      ? (window as unknown as { __ZENTARA_API_BASE__?: string }).__ZENTARA_API_BASE__
      : undefined;
  const envBase = import.meta.env?.VITE_API_BASE_URL as string | undefined;
  return runtimeOverride || (envBase && envBase.length > 0 ? envBase : '/api');
}

/** Persiste (ou efface si vide) la surcharge d'URL backend et reset le client. */
export function setApiBase(url: string): void {
  if (typeof localStorage !== 'undefined') {
    if (url && url.trim().length > 0) localStorage.setItem(API_BASE_STORAGE_KEY, url.trim());
    else localStorage.removeItem(API_BASE_STORAGE_KEY);
  }
  _client = null;
}

export function getApiClient(): ApiClient {
  if (_client) return _client;
  _client = new ApiClient(getApiBase());
  return _client;
}

/**
 * Probes un backend sur une URL donnée : renvoie `true` si `/health` répond 2xx
 * en moins de `timeoutMs`. Utilisé pour l'auto-heal au boot et le bouton
 * « Tester la connexion » dans Réglages → Backend.
 */
export async function probeBackend(baseUrl: string, timeoutMs = 5000): Promise<boolean> {
  if (!baseUrl) return false;
  const url = `${baseUrl.replace(/\/+$/, '')}/health`;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(url, { signal: ctrl?.signal, credentials: 'omit' });
    return r.ok;
  } catch (_e) {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Auto-heal au boot : tente successivement
 *   1. l'URL stockée (si elle diffère du défaut)
 *   2. l'URL d'env Vite (si elle existe)
 *   3. le chemin relatif `/api` (même origine que le frontend)
 * Si l'une répond HTTP 200 sur `/health`, on la persiste comme nouvelle base
 * et on notifie via callback. Sinon, on notifie `null` (= toujours KO).
 *
 * Côté navigateur uniquement ; no-op côté SSR.
 */
export async function autoHealApiBase(onResult?: (url: string | null) => void): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  // Round 142 — backend embarqué : en mode local (aucune URL serveur
  // configurée), `/api` répond toujours (routeur embarqué) → pas besoin
  // de probe réseau, l'app fonctionne sans tunnel ni serveur.
  if (isEmbeddedMode()) {
    _client = null;
    onResult?.('/api');
    return '/api';
  }
  const envBase = (import.meta.env?.VITE_API_BASE_URL as string | undefined) || '';
  const candidates: string[] = [];
  const stored =
    typeof localStorage !== 'undefined' ? localStorage.getItem(API_BASE_STORAGE_KEY) : null;
  if (stored && stored.trim()) candidates.push(stored.trim());
  if (envBase && envBase.trim() && envBase.trim() !== '/api') candidates.push(envBase.trim());
  candidates.push('/api');
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await probeBackend(c)) {
      if (c !== '/api' && typeof localStorage !== 'undefined') {
        localStorage.setItem(API_BASE_STORAGE_KEY, c);
      } else if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(API_BASE_STORAGE_KEY);
      }
      _client = null;
      onResult?.(c);
      return c;
    }
  }
  onResult?.(null);
  return null;
}

export { ENDPOINTS };
