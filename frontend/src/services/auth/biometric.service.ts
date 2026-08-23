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
import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { Capacitor } from '@capacitor/core';

// =====================================================================
// Helpers
// =====================================================================
function isNative(): boolean {
  // Capacitor expose une API platform detection côté web et natif.
  try {
    return Capacitor.isNativePlatform();
  } catch (_e) {
    if (typeof window === 'undefined') return false;
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return cap?.isNativePlatform?.() ?? false;
  }
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
    if (!isNative()) {
      return { available: false, biometryType: 'None' };
    }
    try {
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
    if (!isNative()) return false;
    try {
      // L'API native v10 expose cette méthode sur Android uniquement.
      const platform = Capacitor.getPlatform();
      if (platform !== 'android') return true;
      const fn = (BiometricAuth as unknown as { getStrongBiometryIsAvailable?: () => Promise<{ isAvailable?: boolean; value?: boolean }> }).getStrongBiometryIsAvailable;
      if (typeof fn !== 'function') return false;
      const r = await fn.call(BiometricAuth);
      // Selon la version du plugin, l'un ou l'autre des champs est utilisé.
      return Boolean(r?.isAvailable ?? r?.value);
    } catch (_e) {
      return false;
    }
  },

  /**
   * Enroll : déclenche le prompt natif (qui valide la présence utilisateur)
   * puis retourne un token aléatoire généré côté device (32 bytes base64url).
   * Le token sera envoyé au backend au setup pour stocker dans
   * users.biometric_token.
   */
  async enroll(reason = 'Confirme ton empreinte ou Face ID pour activer Zentara'): Promise<string> {
    if (!isNative()) {
      throw new Error('Biométrie non disponible sur ce device');
    }
    await BiometricAuth.authenticate({ reason, allowDeviceCredential: false });
    return randomBase64UrlToken();
  },

  /**
   * Authenticate : déclenche le prompt natif. Retourne `true` en cas de
   * succès. N'échoue PAS throws (simplifie le flow côté UI).
   */
  async authenticate(reason = 'Déverrouille Zentara'): Promise<boolean> {
    if (!isNative()) {
      throw new Error('Biométrie non disponible sur ce device');
    }
    try {
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
