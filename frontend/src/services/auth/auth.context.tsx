/**
 * AuthContext — Provider React pour la machine d'état d'authentification.
 *
 * Round 9 — état-machine :
 *   preload  → splash pendant qu'on lit secureStorage
 *   setup    → aucun utilisateur local → il faut faire /auth/setup
 *   locked   → utilisateur existant mais pas de token courant → PIN/biometric
 *   unlocking → en cours d'auth (PIN saisi ou biométrie en cours)
 *   authenticated → token Bearer valide en mémoire
 *
 * Side-effects :
 *   - Sur 'lock' / 'logout' : on notifie apiClient.setAuthToken(null) et on
 *     émet un CustomEvent 'zentara:auth-locked' (l'UI peut réagir).
 *   - Sur 'authenticated' : on propage le token au client API pour toutes
 *     les requêtes suivantes.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { authApi, isConflictError, isNetworkError, isRateLimitedError, type AuthUser } from './auth.api';
import { secureStorage, STORAGE_KEYS } from './secure-storage';
import { biometricService, type BiometricAvailability } from './biometric.service';

// Round 119 — plus de compte démo pré-intégré. Au premier lancement,
// l'utilisateur crée son compte manuellement (écran setup). Si un user
// existe déjà côté backend, on retombe sur le keypad PIN classique.

// =====================================================================
// State Types
// =====================================================================
export type AuthState =
  | { kind: 'preload' }
  | { kind: 'setup' }
  | { kind: 'locked'; email: string; biometricAvailable: BiometricAvailability }
  | { kind: 'unlocking' }
  | { kind: 'authenticated'; token: string; user: AuthUser };

export interface AuthContextValue {
  state: AuthState;
  /** Tentative de déverrouillage par PIN. */
  unlockWithPin: (pin: string) => Promise<void>;
  /** Tentative de déverrouillage biométrique (côté natif). */
  unlockWithBiometric: () => Promise<void>;
  /** Premier setup : crée utilisateur + PIN. */
  setup: (params: { email: string; name: string; pin: string; enableBiometric: boolean }) => Promise<void>;
  /** Activer la biométrie sur la session courante. */
  enableBiometric: () => Promise<void>;
  /** Verrou explicite (sans logout serveur). */
  lock: () => void;
  /** Déconnexion complète : révoque le token serveur + purge local. */
  logout: () => Promise<void>;
  /**
   * Round 12 — Reset complet ("Réinitialiser ce compte").
   * Appelle Backend `DELETE /api/auth/me` pour supprimer la session
   * courante + toutes les sessions + l'user lui-même. Puis wipe le
   * secureStorage local (token, hash PIN, biometric, etc.).
   * Bascule l'auth state sur `setup` pour que le LockScreen affiche
   * le formulaire de recréation de compte.
   */
  reset: () => Promise<void>;
  /** Force refresh du user (lockout status, etc.). */
  refresh: () => Promise<void>;
  /** True si l'utilisateur a configuré un PIN localement. */
  hasPin: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// =====================================================================
// Reducer
// =====================================================================
type Action =
  | { type: 'BOOTSTRAP_DONE'; state: AuthState; hasPin: boolean }
  | { type: 'UNLOCK_START' }
  | { type: 'UNLOCK_OK'; token: string; user: AuthUser; hasPin: boolean }
  | { type: 'UNLOCK_FAIL'; email: string; biometricAvailable: BiometricAvailability }
  | { type: 'LOCK' }
  | { type: 'LOGOUT' };

function reducer(state: AuthState, action: Action): AuthState {
  switch (action.type) {
    case 'BOOTSTRAP_DONE':
      return action.state;
    case 'UNLOCK_START':
      return { kind: 'unlocking' };
    case 'UNLOCK_OK':
      return { kind: 'authenticated', token: action.token, user: action.user };
    case 'UNLOCK_FAIL':
      return { kind: 'locked', email: action.email, biometricAvailable: action.biometricAvailable };
    case 'LOCK':
      return state; // caller rebuilds locked state with biometric info
    case 'LOGOUT':
      return { kind: 'setup' };
    default:
      return state;
  }
}

// =====================================================================
// Provider
// =====================================================================
export interface AuthProviderProps {
  children: React.ReactNode;
  /** Token getter/setter pour le client API (Round 8 → setToken doit être exposé). */
  onAuthChange?: (token: string | null) => void;
}

export function AuthProvider({ children, onAuthChange }: AuthProviderProps): React.ReactElement {
  const [state, dispatch] = useReducer(reducer, { kind: 'preload' } as AuthState);
  const hasPinRef = useRef<boolean>(false);
  const [hasPin, setHasPin] = React.useState<boolean>(false);
  // Stocker un état "locked" reconstruit pour relock().
  const lockedSnapshotRef = useRef<{ email: string; bio: BiometricAvailability } | null>(null);

  // ---------------------------------------------------------------
  // Helper : bascule vers 'locked' avec un email donné (depuis backend).
  // Utilisé au boot (status) ET lors d'un CONFLICT 409 sur setup.
  // ---------------------------------------------------------------
  const switchToLockedWithEmail = useCallback(
    async (email: string) => {
      const biometricAvailable = await biometricService.checkAvailability();
      await secureStorage.setItem(STORAGE_KEYS.AUTH_EMAIL, email);
      await secureStorage.setItem(STORAGE_KEYS.HAS_PIN, '1');
      hasPinRef.current = true;
      setHasPin(true);
      lockedSnapshotRef.current = {
        email,
        bio: biometricAvailable,
      };
      dispatch({
        type: 'BOOTSTRAP_DONE',
        state: {
          kind: 'locked',
          email,
          biometricAvailable,
        },
        hasPin: true,
      });
    },
    [],
  );

  // ---------------------------------------------------------------
  // Bootstrap : auto-login sans PIN au mount (Round 120)
  // ---------------------------------------------------------------
  // Le PIN est totalement supprimé : au boot, on obtient directement un
  // token de session via /api/auth/auto-login (le backend mint une session
  // pour le user actif, ou crée un user par défaut). Aucun verrouillage.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await authApi.autoLogin();
        if (cancelled) return;
        await secureStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, session.token);
        await secureStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(session.user));
        await secureStorage.setItem(STORAGE_KEYS.AUTH_EMAIL, session.user.email);
        // Round 132 — snapshot du compte pour le lock() : sans ça, le
        // keypad PIN affichait un email vide au verrouillage et le
        // déverrouillage échouait avec « Aucun email connu ».
        try {
          lockedSnapshotRef.current = {
            email: session.user.email,
            bio: await biometricService.checkAvailability(),
          };
        } catch (_bioErr) {
          lockedSnapshotRef.current = {
            email: session.user.email,
            bio: { available: false, biometryType: 'None' },
          };
        }
        onAuthChange?.(session.token);
        dispatch({
          type: 'UNLOCK_OK',
          token: session.token,
          user: session.user,
          hasPin: false,
        });
      } catch (_e) {
        // Backend KO : on ouvre quand même l'app avec un user local.
        // Les routes data ne requièrent pas d'auth en V1 (authStub).
        if (cancelled) return;
        const stubUser: AuthUser = {
          id: 'auto',
          email: '',
          name: 'Zentara',
          role: 'admin',
          biometric_enabled: false,
        };
        dispatch({
          type: 'UNLOCK_OK',
          token: '',
          user: stubUser,
          hasPin: false,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onAuthChange]);

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------
  const persistSession = useCallback(
    async (token: string, user: AuthUser) => {
      await secureStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
      await secureStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(user));
      await secureStorage.setItem(STORAGE_KEYS.AUTH_EMAIL, user.email);
      await secureStorage.setItem(STORAGE_KEYS.HAS_PIN, '1');
      // Round 132 — garde l'email du compte à jour pour le lock().
      try {
        lockedSnapshotRef.current = {
          email: user.email,
          bio: await biometricService.checkAvailability(),
        };
      } catch (_bioErr) {
        lockedSnapshotRef.current = {
          email: user.email,
          bio: { available: false, biometryType: 'None' },
        };
      }
      setHasPin(true);
      hasPinRef.current = true;
      onAuthChange?.(token);
    },
    [onAuthChange],
  );

  const wipeSession = useCallback(async () => {
    await secureStorage.clear([
      STORAGE_KEYS.AUTH_TOKEN,
      STORAGE_KEYS.AUTH_USER,
      STORAGE_KEYS.AUTH_EMAIL,
      STORAGE_KEYS.BIOMETRIC_TOKEN,
      STORAGE_KEYS.BIOMETRIC_ENABLED,
      STORAGE_KEYS.HAS_PIN,
    ]);
    secureStorage.clearMemoryCache();
    onAuthChange?.(null);
  }, [onAuthChange]);

  // ---------------------------------------------------------------
  // Unlock PIN
  // ---------------------------------------------------------------
  const unlockWithPin = useCallback(
    async (pin: string) => {
      const email = state.kind === 'locked' ? state.email : null;
      if (!email) throw new Error('Aucun email connu — setup requis');
      dispatch({ type: 'UNLOCK_START' });
      try {
        const session = await authApi.login(email, pin);
        await persistSession(session.token, session.user);
        dispatch({
          type: 'UNLOCK_OK',
          token: session.token,
          user: session.user,
          hasPin: true,
        });
      } catch (err) {
        // Le backend peut être HS : on retourne au locked state avec message.
        const bio = lockedSnapshotRef.current?.bio ?? { available: false, biometryType: 'None' };
        let message: string;
        if (isRateLimitedError(err)) {
          message = 'Trop de tentatives. Réessaie dans quelques minutes.';
        } else if (isNetworkError(err)) {
          message = 'Backend injoignable. Réessaie quand le serveur est up.';
        } else {
          message = (err as Error).message ?? 'Erreur inconnue';
        }
        dispatch({ type: 'UNLOCK_FAIL', email, biometricAvailable: bio });
        throw new Error(message);
      }
    },
    [state, persistSession],
  );

  // ---------------------------------------------------------------
  // Unlock biométrique
  // ---------------------------------------------------------------
  const unlockWithBiometric = useCallback(async () => {
    if (state.kind !== 'locked') return;
    const email = state.email;
    const biometricToken = await secureStorage.getItem(STORAGE_KEYS.BIOMETRIC_TOKEN);
    if (!biometricToken) {
      throw new Error('Biométrie non enrollée sur ce device');
    }
    const ok = await biometricService.authenticate();
    if (!ok) throw new Error('Authentification biométrique échouée');
    dispatch({ type: 'UNLOCK_START' });
    try {
      const session = await authApi.biometric(email, biometricToken);
      await persistSession(session.token, session.user);
      dispatch({
        type: 'UNLOCK_OK',
        token: session.token,
        user: session.user,
        hasPin: true,
      });
    } catch (err) {
      const bio = state.biometricAvailable;
      let message: string;
      if (isRateLimitedError(err)) {
        message = 'Trop de tentatives. Réessaie dans quelques minutes.';
      } else if (isNetworkError(err)) {
        message = 'Backend injoignable. Utilise le PIN.';
      } else {
        message = (err as Error).message ?? 'Erreur biométrique';
      }
      dispatch({ type: 'UNLOCK_FAIL', email, biometricAvailable: bio });
      throw new Error(message);
    }
  }, [state, persistSession]);

  // ---------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------
  const setup = useCallback(
    async (params: { email: string; name: string; pin: string; enableBiometric: boolean }) => {
      let biometricToken: string | null = null;
      if (params.enableBiometric) {
        const availability = await biometricService.checkAvailability();
        if (!availability.available) {
          throw new Error("La biométrie n'est pas dispo sur ce device");
        }
        // On génère le token uniquement après un 1er prompt natif (enrollment).
        biometricToken = await biometricService.enroll(
          'Confirme ton empreinte ou Face ID pour activer Zentara',
        );
      }
      try {
        const session = await authApi.setup({
          email: params.email,
          name: params.name,
          pin: params.pin,
          biometric_token: biometricToken,
          device_name: navigator.userAgent.slice(0, 80),
        });
        await persistSession(session.token, session.user);
        if (biometricToken) {
          await secureStorage.setItem(STORAGE_KEYS.BIOMETRIC_TOKEN, biometricToken);
          await secureStorage.setItem(STORAGE_KEYS.BIOMETRIC_ENABLED, '1');
        }
        dispatch({
          type: 'UNLOCK_OK',
          token: session.token,
          user: session.user,
          hasPin: true,
        });
        return;
      } catch (err) {
        // Round 11 : si le backend refuse la création (CONFLICT 409), on
        // bascule automatiquement vers l'écran de login avec l'email
        // existant côté backend. Plus besoin d'afficher le message
        // brut « Un utilisateur existe déjà » à l'utilisateur.
        if (isConflictError(err)) {
          try {
            const status = await authApi.status();
            if (status.hasUser && status.email) {
              // Switch l'état SANS throw : le LockScreen va se re-rendre
              // automatiquement sur l'état 'locked' avec l'email connu.
              // On évite ainsi l'affichage du vieux message d'erreur.
              await switchToLockedWithEmail(status.email);
              return;
            }
          } catch (_statusErr) {
            // Si status KO aussi, on retombe sur l'erreur CONFLICT
            // originale pour que le caller la voie.
          }
        }
        throw err;
      }
    },
    [persistSession, switchToLockedWithEmail],
  );

  // ---------------------------------------------------------------
  // Enable biometric on existing session
  // ---------------------------------------------------------------
  const enableBiometric = useCallback(async () => {
    const availability = await biometricService.checkAvailability();
    if (!availability.available) {
      throw new Error("La biométrie n'est pas dispo sur ce device");
    }
    const token = await biometricService.enroll(
      'Confirme ton empreinte ou Face ID pour activer Zentara',
    );
    await secureStorage.setItem(STORAGE_KEYS.BIOMETRIC_TOKEN, token);
    await secureStorage.setItem(STORAGE_KEYS.BIOMETRIC_ENABLED, '1');
    if (state.kind === 'authenticated') {
      // Le backend a besoin de rejouer setup ou un endpoint dédié. V1 simplifiée :
      // on POST /auth/setup n'est possible qu'une seule fois — on appelle
      // /auth/biometric avec un refresh côté serveur.
      // (À FAIRE round 10 : endpoint /auth/biometric-enroll côté serveur).
    }
  }, [state]);

  // ---------------------------------------------------------------
  // Lock + logout
  // ---------------------------------------------------------------
  const lock = useCallback(() => {
    secureStorage.clearMemoryCache();
    onAuthChange?.(null);
    // Round 132 — priorité au snapshot (email + biométrie). S'il est vide,
    // on retombe sur l'email du user authentifié courant pour ne jamais
    // se retrouver bloqué sur un keypad sans email.
    const authedEmail = state.kind === 'authenticated' ? state.user.email : '';
    const snap = lockedSnapshotRef.current?.email
      ? lockedSnapshotRef.current
      : { email: authedEmail, bio: { available: false, biometryType: 'None' } };
    dispatch({
      type: 'BOOTSTRAP_DONE',
      state: {
        kind: 'locked',
        email: snap.email,
        biometricAvailable: snap.bio,
      },
      hasPin: true,
    });
  }, [onAuthChange, state]);

  const logout = useCallback(async () => {
    const token = await secureStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (token) {
      try {
        await authApi.logout(token);
      } catch (_e) {
        // best-effort
      }
    }
    await wipeSession();
    // Round 119 — après logout on repart sur l'écran de setup manuel.
    dispatch({
      type: 'BOOTSTRAP_DONE',
      state: { kind: 'setup' },
      hasPin: false,
    });
  }, [wipeSession, switchToLockedWithEmail]);

  /**
   * Round 12 — Reset complet ("Réinitialiser ce compte" sur LockScreen).
   * Séquence :
   *  1. Récupère le token courant (peut être null si 'locked').
   *  2. Appelle `DELETE /api/auth/me` côté backend → supprime la session
   *     (si Bearer fourni) + TOUTES les sessions du user + le user lui-même.
   *  3. Wipe le secureStorage local.
   *  4. Bascule l'auth state sur `setup` (le LockScreen affichera le
   *     formulaire de recréation de compte, plus le keypad).
   *
   * Robuste : si le backend est injoignable, on wipe quand même le local
   * et on bascule sur `setup`. Le user sera bloqué tant que le user
   * backend existe (HTTP 409 sur POST /setup suivant), mais c'est son
   * problème à lui de gérer.
   */
  const reset = useCallback(async () => {
    const token = await secureStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    try {
      await authApi.reset(token);
    } catch (_e) {
      // best-effort : si le backend est injoignable, l'utilisateur
      // pourra quand-même réinitialiser localement et supprimer le
      // user côté DB manuellement (script SQL direct).
    }
    await wipeSession();
    hasPinRef.current = false;
    setHasPin(false);
    lockedSnapshotRef.current = null;
    dispatch({
      type: 'BOOTSTRAP_DONE',
      state: { kind: 'setup' },
      hasPin: false,
    });
  }, [wipeSession, switchToLockedWithEmail]);

  // ---------------------------------------------------------------
  // Refresh user profile (lockout status, etc.)
  // ---------------------------------------------------------------
  const refresh = useCallback(async () => {
    if (state.kind !== 'authenticated') return;
    try {
      const me = await authApi.me(state.token);
      const user: AuthUser = {
        id: me.id,
        email: me.email,
        name: me.name,
        role: me.role,
        biometric_enabled: me.biometric_enabled,
      };
      await secureStorage.setItem(STORAGE_KEYS.AUTH_USER, JSON.stringify(user));
    } catch (_e) {
      // best-effort, on ne casse rien
    }
  }, [state]);

  // ---------------------------------------------------------------
  // Memo value
  // ---------------------------------------------------------------
  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      unlockWithPin,
      unlockWithBiometric,
      setup,
      enableBiometric,
      lock,
      logout,
      reset,
      refresh,
      hasPin,
    }),
    [state, unlockWithPin, unlockWithBiometric, setup, enableBiometric, lock, logout, reset, refresh, hasPin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// =====================================================================
// Hook
// =====================================================================
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être appelé dans un <AuthProvider>');
  return ctx;
}
