/**
 * Auth API — wrapper sur les endpoints `/api/auth/*`.
 *
 * Round 9 : interface type-safe + gestion offline (fallback PIN-only si backend down).
 * Round 11 : ajout `status()` (public) + helper `isConflictError()` pour
 *            basculer Setup → Locked automatiquement quand un user existe.
 *
 * Notes sur l'API:
 *  - `setup()`     : initial setup (premier user uniquement).
 *  - `login()`     : email + PIN → token de session Bearer.
 *  - `biometric()` : email + biometric_token (présenté après prompt natif).
 *  - `refresh()`   : rotation de session.
 *  - `logout()`    : révoque la session courante.
 *  - `me()`        : profil utilisateur courant (Bearer requis).
 *  - `status()`    : public — `{hasUser, email, name, setupAllowed}`.
 */
import { getApiClient, ENDPOINTS, ZentaraApiError } from '../api/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  biometric_enabled: boolean;
}

export interface AuthSessionResponse {
  session_id: string;
  token: string;
  expires_at: string;
  user: AuthUser;
}

export interface LockoutStatus {
  locked: boolean;
  until: string | null;
  failed_attempts: number;
}

export interface AuthMeResponse extends AuthUser {
  lockout: LockoutStatus;
}

/**
 * Status public — info sur l'existence d'un compte. Renvoie `hasUser`,
 * `email` (single-user V1) et `setupAllowed` (false si un user existe).
 * Pas d'auth requise.
 *
 * Utilisé par le frontend :
 *  - Au boot, pour décider entre `setup` vs `locked`.
 *  - Sur 409 CONFLICT du `setup()` → bascule automatique vers locked.
 */
export interface AuthStatusResponse {
  hasUser: boolean;
  email: string | null;
  name: string | null;
  setupAllowed: boolean;
}

export const authApi = {
  async setup(payload: {
    email: string;
    name: string;
    pin: string;
    biometric_token?: string | null;
    device_name?: string;
  }): Promise<AuthSessionResponse> {
    const api = getApiClient();
    return api.post<AuthSessionResponse>(ENDPOINTS.authSetup, payload);
  },

  async login(email: string, pin: string): Promise<AuthSessionResponse> {
    const api = getApiClient();
    return api.post<AuthSessionResponse>(ENDPOINTS.authLogin, { email, pin });
  },

  /**
   * Round 120 — auto-login sans PIN. Le backend mint une session pour le
   * user actif (ou crée un user par défaut) sans vérification de PIN.
   * Appelé au boot pour entrer directement dans l'app.
   */
  async autoLogin(): Promise<AuthSessionResponse> {
    const api = getApiClient();
    return api.post<AuthSessionResponse>('/auth/auto-login', {});
  },

  async biometric(email: string, biometric_token: string): Promise<AuthSessionResponse> {
    const api = getApiClient();
    return api.post<AuthSessionResponse>(ENDPOINTS.authBiometric, { email, biometric_token });
  },

  async refresh(token: string): Promise<AuthSessionResponse> {
    const api = getApiClient();
    return api.post<AuthSessionResponse>(ENDPOINTS.authRefresh, { token });
  },

  async logout(token: string): Promise<{ revoked: boolean }> {
    const api = getApiClient();
    return api.post<{ revoked: boolean }>(ENDPOINTS.authLogout, { token });
  },

  async me(token: string): Promise<AuthMeResponse> {
    const api = getApiClient();
    return api.get<AuthMeResponse>(ENDPOINTS.authMe, {
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  /**
   * Round 12 — Reset complet : supprime la session courante + toutes les
   * sessions + l'user lui-même côté backend. Appelée par AuthContext.reset()
   * depuis le bouton LockScreen "Réinitialiser ce compte".
   * Si un Bearer est présent (cas authenticated), il est prévéré pour révoquer
   * la session courante ; sinon la route accepte quand même (V1 mono-user).
   */
  async reset(token: string | null): Promise<{ deleted: boolean; sessions_revoked: number }> {
    const api = getApiClient();
    return api.delete<{ deleted: boolean; sessions_revoked: number }>(
      '/auth/me',
      token ? { headers: { Authorization: `Bearer ${token}` } } : {},
    );
  },

  /**
   * Status public — appelé sans auth pour détecter si un compte existe
   * déjà avant d'afficher le SetupPanel ou en recovery (CONFLICT 409).
   */
  async status(): Promise<AuthStatusResponse> {
    const api = getApiClient();
    return api.get<AuthStatusResponse>(ENDPOINTS.authStatus, {
      timeoutMs: 3000,
      retries: 0,
    });
  },
};

/** Vrai si le code d'erreur correspond à un user déjà existant. */
export function isConflictError(err: unknown): boolean {
  return err instanceof ZentaraApiError && err.code === 'CONFLICT';
}

/** Vrai si l'erreur est "backend injoignable / trop lent". */
export function isNetworkError(err: unknown): boolean {
  return (
    err instanceof ZentaraApiError &&
    (err.code === 'NETWORK_UNAVAILABLE' || err.code === 'TIMEOUT')
  );
}

/**
 * Round 23 — vrai si on est rate-limité (HTTP 429 / code RATE_LIMITED).
 * Le frontend peut afficher un message spécifique ("retry dans 15min")
 * plutôt que le générique réseau.
 */
export function isRateLimitedError(err: unknown): boolean {
  return err instanceof ZentaraApiError && err.code === 'RATE_LIMITED';
}

/**
 * Round 23 — combine isNetworkError + isRateLimitedError. À utiliser
 * quand on veut grouper toutes les erreurs "transientes retry-friendly".
 */
export function isTransientError(err: unknown): boolean {
  return isNetworkError(err) || isRateLimitedError(err);
}
