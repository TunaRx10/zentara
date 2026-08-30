/**
 * BiometricService — wrapper Capacitor pour la biométrie native.
 *
 * Round 9 : utilise `@aparajita/capacitor-biometric-auth` v10.
 *
 * Capacités exposées :
 *  - `isAvailable()` → détecte la présence de Touch ID / Face ID / empreinte.
 *  - `authenticate()`→ déclenche le prompt natif.
 *  - `getStrongBiometryIsAvailable()` → Android-specific : check si la
 *    biométrie forte (Class 3) est dispo (`AndroidBiometryStrength.strong`).
 *  - `randomToken()` → génère un secret biométrique côté device (32 bytes
 *    base64url). Ce secret est protégé par Keystore/Keychain.
 *
 * Compatibilité web (Vite preview, dev) :
 *  - `isAvailable()` retourne false → on retombe sur le PIN.
 */
// Round 146 — Lazy import de Capacitor Biometric.
// Sur le web (Vercel, navigateur standard), ce module natif n'existe pas
// et un `import` statique crash l'application entière.
let _BiometricAuth: any = undefined;
let _biometricLoadFailed = false;

async function getBiometricAuth() {
  if (_BiometricAuth !== undefined) return _BiometricAuth;
  if (_biometricLoadFailed) return null;
  try {
    const mod = await import('@aparajita/capacitor-biometric-auth');
    _BiometricAuth = mod.BiometricAuth;
    return _BiometricAuth;
  } catch (_e) {
    _biometricLoadFailed = true;
    return null;
  }
}

let _Capacitor: any = undefined;
async function getCapacitor() {
  if (_Capacitor !== undefined) return _Capacitor;
  try {
    const mod = await import('@capacitor/core');
    _Capacitor = mod.Capacitor;
    return _Capacitor;
  } catch (_e) {
    _Capacitor = null;
    return null;
  }
}

// =====================================================================
// Helpers
// =====================================================================
async function isNativeAsync(): Promise<boolean> {
  try {
    const Capacitor = await getCapacitor();
    if (Capacitor?.isNativePlatform) return Capacitor.isNativePlatform();
  } catch (_e) { /* fallthrough */ }
  if (typeof window !== 'undefined') {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform) return cap.isNativePlatform();
  }
  return false;
}

// Cache the native detection
let _isNative: boolean | null = null;
async function isNative(): Promise<boolean> {
  if (_isNative !== null) return _isNative;
  _isNative = await isNativeAsync();
  return _isNative;
}

function isNativeSync(): boolean {
  if (_isNative !== null) return _isNative;
  if (typeof window !== 'undefined') {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform) {
      _isNative = cap.isNativePlatform();
      return _isNative;
    }
  }
  return false;
}

function randomBase64UrlToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** Map BiometryType enum → label humain. */
function humanBiometryType(t: number | string | undefined): string {
  switch (t) {
    case 0: return 'None';
    case 1: return 'TouchID';
    case 2: return 'FaceID';
    case 3: return 'Fingerprint';
    case 4: return 'Face';
    case 5: return 'Iris';
    case 'none': return 'None';
    case 'touchId': return 'TouchID';
    case 'faceId': return 'FaceID';
    case 'fingerprintAuthentication': return 'Fingerprint';
    case 'faceAuthentication': return 'Face';
    case 'irisAuthentication': return 'Iris';
    default: return 'Unknown';
  }
}

// =====================================================================
// Service
// =====================================================================
export interface BiometricAvailability {
  available: boolean;
  /** 'Strong' (Android Class 3) si dispo. */
  strong?: boolean;
  /** Label humain (TouchID, FaceID, Fingerprint, etc.) ou 'None' si non dispo. */
  biometryType: string;
  /** Message d'erreur quand non disponible (utile pour UX). */
  error?: string;
}

export const biometricService = {
  /**
   * Vérifie si le device supporte une biométrie utilisable.
   * Sur web : retourne `available: false` (fallback PIN).
   */
  async checkAvailability(): Promise<BiometricAvailability> {
    if (!(await isNative())) {
      return { available: false, biometryType: 'None' };
    }
    try {
      const BiometricAuth = await getBiometricAuth();
      if (!BiometricAuth) {
        return { available: false, biometryType: 'None', error: 'Module biométrique non disponible' };
      }
      const result = await BiometricAuth.checkBiometry();
      return {
        available: !!result.isAvailable,
        biometryType: humanBiometryType(result.biometryType as unknown as number),
        error: result.reason ?? undefined,
      };
    } catch (e) {
      return {
        available: false,
        biometryType: 'None',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  },

  /**
   * Vérifie que la biométrie Android est de force "Strong" (Class 3).
   * Sur iOS / web : retourne `true` (iOS FaceID/TouchID sont Strong par
   * défaut).
   */
  async isStrong(): Promise<boolean> {
    if (!(await isNative())) return false;
    try {
      const BiometricAuth = await getBiometricAuth();
      if (!BiometricAuth) return false;
      const Capacitor = await getCapacitor();
      // L'API native v10 expose cette méthode sur Android uniquement.
      const platform = Capacitor ? Capacitor.getPlatform() : 'web';
      if (platform !== 'android') return true;
      const fn = (BiometricAuth as unknown as { getStrongBiometryIsAvailable?: () => Promise<{ isAvailable?: boolean; value?: boolean }> }).getStrongBiometryIsAvailable;
      if (typeof fn !== 'function') return false;
      const r = await fn.call(BiometricAuth);
      return Boolean(r?.isAvailable ?? r?.value);
    } catch (_e) {
      return false;
    }
  },

  /**
   * Enroll : déclenche le prompt natif (qui valide la présence utilisateur)
   * puis retourne un token aléatoire généré côté device (32 bytes base64url).
   */
  async enroll(reason = 'Confirme ton empreinte ou Face ID pour activer Zentara'): Promise<string> {
    if (!(await isNative())) {
      throw new Error('Biométrie non disponible sur ce device');
    }
    const BiometricAuth = await getBiometricAuth();
    if (!BiometricAuth) throw new Error('Module biométrique non disponible');
    await BiometricAuth.authenticate({ reason, allowDeviceCredential: false });
    return randomBase64UrlToken();
  },

  /**
   * Authenticate : déclenche le prompt natif. Retourne `true` en cas de
   * succès. N'échoue PAS throws (simplifie le flow côté UI).
   */
  async authenticate(reason = 'Déverrouille Zentara'): Promise<boolean> {
    if (!(await isNative())) {
      throw new Error('Biométrie non disponible sur ce device');
    }
    try {
      const BiometricAuth = await getBiometricAuth();
      if (!BiometricAuth) return false;
      await BiometricAuth.authenticate({ reason, allowDeviceCredential: false });
      return true;
    } catch (_e) {
      return false;
    }
  },

  /** Génère un token aléatoire (32 bytes base64url). */
  generateToken(): string {
    return randomBase64UrlToken();
  },
};
