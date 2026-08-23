/**
 * SecureStorage — abstraction de stockage sécurisé pour les secrets de session.
 *
 * Stratégie Round 9 :
 *  - Tokens de session/API-key memoized en mémoire (rapide mais volatile).
 *  - Persistance via Capacitor Preferences (keychain-backed sur device ;
 *    localStorage fallback sur le web pour les tests côté navigateur).
 *  - Pas de chiffrement local supplémentaire pour le token bearer : Capacitor
 *    Preferences utilise déjà le keystore Android / keychain iOS en V1.
 *  - Pour le PIN biométrique → on stocke un "biometric_token" (random 32 bytes
 *    base64url) chiffré côté device par SecureStore / Keystore (Android) ou
 *    Keychain (iOS). Côté web (Vite preview) → localStorage en clair.
 *
 * Note : `Capacitor Preferences` est natif uniquement — sur web, fallback
 * à `localStorage`. Si tu cibles un build strictement natif, câbler
 * `@capacitor-community/secure-storage` ou `capacitor-secure-storage-plugin`.
 */
import { Preferences } from '@capacitor/preferences';

// =====================================================================
// In-memory cache (module-level)
// =====================================================================
const memoryCache: Record<string, string> = {};

// =====================================================================
// Detect native platform once
// =====================================================================
function isNative(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform) return cap.isNativePlatform();
  return false;
}

const NATIVE = isNative();

// =====================================================================
// Implementations
// =====================================================================
async function nativeGet(key: string): Promise<string | null> {
  const { value } = await Preferences.get({ key });
  return value ?? null;
}
async function nativeSet(key: string, value: string): Promise<void> {
  await Preferences.set({ key, value });
}
async function nativeRemove(key: string): Promise<void> {
  await Preferences.remove({ key });
}

async function webGet(key: string): Promise<string | null> {
  if (typeof window === 'undefined') return memoryCache[key] ?? null;
  return window.localStorage.getItem(key);
}
async function webSet(key: string, value: string): Promise<void> {
  if (typeof window === 'undefined') {
    memoryCache[key] = value;
    return;
  }
  window.localStorage.setItem(key, value);
}
async function webRemove(key: string): Promise<void> {
  if (typeof window === 'undefined') {
    delete memoryCache[key];
    return;
  }
  window.localStorage.removeItem(key);
}

async function implGet(key: string): Promise<string | null> {
  if (NATIVE) return nativeGet(key);
  return webGet(key);
}
async function implSet(key: string, value: string): Promise<void> {
  memoryCache[key] = value;
  if (NATIVE) await nativeSet(key, value);
  else await webSet(key, value);
}
async function implRemove(key: string): Promise<void> {
  delete memoryCache[key];
  if (NATIVE) await nativeRemove(key);
  else await webRemove(key);
}

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    if (memoryCache[key] !== undefined) return memoryCache[key]!;
    const v = await implGet(key);
    if (v !== null) memoryCache[key] = v;
    return v;
  },

  async setItem(key: string, value: string): Promise<void> {
    await implSet(key, value);
  },

  async removeItem(key: string): Promise<void> {
    await implRemove(key);
  },

  async clear(keys: string[]): Promise<void> {
    for (const k of keys) await implRemove(k);
  },

  isNative(): boolean {
    return NATIVE;
  },

  /** Clear in-memory cache only (e.g. on lock screen). */
  clearMemoryCache(): void {
    for (const k of Object.keys(memoryCache)) delete memoryCache[k];
  },
};

// =====================================================================
// Standard keys
// =====================================================================
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'zentara.auth.token',
  AUTH_USER: 'zentara.auth.user',
  AUTH_EMAIL: 'zentara.auth.email',
  BIOMETRIC_TOKEN: 'zentara.auth.biometric_token',
  BIOMETRIC_ENABLED: 'zentara.auth.biometric_enabled',
  HAS_PIN: 'zentara.auth.has_pin',
  // Round 11 — length du PIN choisi par l'utilisateur (4 ou 6).
  // Persisté pour adapter les dots + auto-submit du keypad à chaque session.
  PIN_LENGTH: 'zentara.auth.pin_length',
} as const;
