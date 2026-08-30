/**
 * LockScreen — saisie du PIN + bouton biométrique pour déverrouillage.
 *
 * Rund 88 — simplification après le factory reset :
 *  - Le bouton « Réinitialiser ce compte » est SUPPRIMÉ (le user a
 *    explicitement demandé à enlever ce contournement — un user qui
 *    oublie son PIN doit faire un wipe manuel côté serveur, doc dans
 *    /tmp/zh_restart_svc.sh).
 *  - Le panneau « Compte inaccessible » (lockedEmailMissing) est aussi
 *    supprimé — si l'état local est inconsistant (email perdu), le user
 *    voit un message d'erreur clair dans le panneau rouge, pas un reset.
 *  - Longueur de PIN dynamique (4 ou 6 chiffres) conservée — c'est une
 *    préférence utilisateur, pas un contournement.
 *
 * UX : Glassmorphism, animation 'shake' sur erreur, gradient bleu radial.
 */
import React from 'react';
import {
  Delete,
  AlertTriangle,
  Server,
} from 'lucide-react';
import { useAuth } from '@/services/auth/auth.context';
import { secureStorage, STORAGE_KEYS } from '@/services/auth/secure-storage';
import { getApiBase, setApiBase } from '@/services/api/client';
import { cn } from '@/lib/utils';

/**
 * Logo Zentara — petite icône Z + wordmark. Compact (h-9 ~ 36px),
 * utilisé en haut du LockScreen. Pas de gradient, pas de halo, pas de
 * wordmark géant : on veut juste signaler "c'est Zentara" sans
 * reproduire le splash du boot.
 */
function ZentaraMark({ size = 32 }: { size?: number }): React.ReactElement {
  return (
    <div className="inline-flex items-center gap-2">
      <div
        className="rounded-md bg-foreground text-background flex items-center justify-center font-black tracking-tighter"
        style={{ height: size, width: size, fontSize: size * 0.55 }}
        aria-hidden
      >
        Z
      </div>
      <span
        className="font-black tracking-tight text-foreground"
        style={{ fontSize: size * 0.5 }}
      >
        ZENTARA
      </span>
    </div>
  );
}

/**
 * BrandedHeader — bandeau compact en haut du LockScreen.
 * Logo Zentara (icône Z + wordmark `text-base` / ~16px). Le tout tient
 * sur ~96px de haut, à peine plus que le pill « Verrouillé » actuel.
 */
function BrandedHeader(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center mb-6 select-none">
      <ZentaraMark size={32} />
    </div>
  );
}


// Round 11 — longueur de PIN configurable (4 ou 6 chiffres).
// On garde 4 par défaut pour rester accessible, mais un toggle setup
// permet de switcher à 6 pour plus de sécurité. La valeur est
// persistée dans secureStorage(STORAGE_KEYS.PIN_LENGTH) afin que
// la LockScreen s'adapte d'un lancement à l'autre.
const DEFAULT_PIN_LENGTH = 4;
const SUPPORTED_PIN_LENGTHS = [4, 6] as const;
type PinLength = (typeof SUPPORTED_PIN_LENGTHS)[number];

function isValidPinLength(n: number): n is PinLength {
  return n === 4 || n === 6;
}

async function readPinLength(): Promise<PinLength> {
  try {
    const raw = await secureStorage.getItem(STORAGE_KEYS.PIN_LENGTH);
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return isValidPinLength(parsed) ? parsed : DEFAULT_PIN_LENGTH;
  } catch {
    return DEFAULT_PIN_LENGTH;
  }
}

async function persistPinLength(n: PinLength): Promise<void> {
  await secureStorage.setItem(STORAGE_KEYS.PIN_LENGTH, String(n));
}
// Note : persistPinLength n'est plus appelé (Round 107 — la longueur
// du PIN reste à 4 chiffres, fixée au mount). Conservé en cas de
// besoin futur (réglages long-term).

// -----------------------------------------------------------------------

/**
 * SetupForm — création de compte manuelle au premier lancement.
 *
 * Round 119 — réintroduction du formulaire de setup (email + nom + PIN).
 * Le compte démo pré-intégré a été retiré : au premier lancement, s'il
 * n'existe aucun user côté backend, cet écran s'affiche pour créer le
 * compte. En cas de 409 (compte existant), setup() rebascule sur le PIN.
 */
function SetupForm(): React.ReactElement {
  const { setup } = useAuth();
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [pin, setPin] = React.useState('');
  const [confirmPin, setConfirmPin] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const e = email.trim().toLowerCase();
    const n = name.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setError('Adresse email invalide.');
      return;
    }
    if (!n) {
      setError('Le nom est requis.');
      return;
    }
    if (!/^\d{4,6}$/.test(pin)) {
      setError('Le PIN doit contenir 4 à 6 chiffres.');
      return;
    }
    if (pin !== confirmPin) {
      setError('Les deux PIN ne correspondent pas.');
      return;
    }
    setBusy(true);
    try {
      await setup({ email: e, name: n, pin, enableBiometric: false });
      // succès → state.kind === 'authenticated'
    } catch (err) {
      setError((err as Error).message ?? 'Création impossible.');
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-border/40 bg-background/50 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary placeholder:text-muted-foreground/50';

  return (
    <div className="space-y-3">
      <div className="text-center space-y-1">
        <p className="text-sm font-black">Créer ton compte</p>
        <p className="text-xs text-muted-foreground">
          Première utilisation — choisis ton email, ton nom et un PIN.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
          Nom
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tuna"
          autoComplete="name"
          className={inputCls}
        />
      </div>

      <div>
        <label className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
          Email
        </label>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tunation.fr@gmail.com"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="email"
          className={inputCls}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            PIN (4-6)
          </label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••"
            inputMode="numeric"
            autoComplete="one-time-code"
            className={`${inputCls} font-mono tracking-[0.4em]`}
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            Confirme
          </label>
          <input
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="••••"
            inputMode="numeric"
            autoComplete="one-time-code"
            className={`${inputCls} font-mono tracking-[0.4em]`}
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-500">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-black text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        {busy ? 'Création…' : 'Créer mon compte'}
      </button>
    </div>
  );
}

/**
 * LockScreen : 3 modes pilotés par l'auth state :
 *  - 'setup'  → formulaire de création (email, name).
 *  - 'locked' → keypad PIN (fallback uniquement — plus de biométrie).
 *  - 'unlocking' → spinner transparent (l'auth.context gère déjà).
 */
export function LockScreen(): React.ReactElement {
  const { state, unlockWithPin } = useAuth();
  const [shake, setShake] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Round 118 — éditeur d'URL backend accessible depuis le lock screen,
  // pour re-pointer vers un nouveau tunnel sans rebuild de l'APK.
  const [showServer, setShowServer] = React.useState(false);
  const [serverUrl, setServerUrl] = React.useState<string>(() => getApiBase());

  // UI du keypad — un seul buffer pour le PIN en cours de saisie.
  const [pin, setPin] = React.useState('');

  // Round 107 — UI simplifiée : la création de compte se fait côté
  // backend (scripts/seed-data.ts) — plus de formulaire d'inscription
  // dans l'UI. On garde uniquement les états utiles au keypad.

  // Locked state — dynamic pin length (read from secureStorage).
  const [pinLength, setPinLength] = React.useState<PinLength>(DEFAULT_PIN_LENGTH);

  // Read pin length on mount (and re-read when state changes from unlock to setup).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const n = await readPinLength();
      if (!cancelled) setPinLength(n);
    })();
    return () => {
      cancelled = true;
    };
  }, [state.kind]);

  // Round 11 : clear stale errors when the auth state transitions.
  // (e.g. CONFLICT 409 from setup() silently switches to locked — on
  // re-render the LockScreen, we don't want the previous setup error
  // message to bleed into the keypad view.)
  React.useEffect(() => {
    setError(null);
    setShake(0);
  }, [state.kind]);

  // Round 44 — effect hoisté AVANT les early returns : un hook ne doit
  // jamais être appelé après un return conditionnel (react/rules-of-hooks,
  // bug React #310). Le guard interne `if (state.kind !== 'locked')` rend
  // l'appel inconditionnel sûr.
  if (state.kind === 'preload') {
    return <></>; // PreloadSplash rendu par App
  }
  if (state.kind === 'authenticated') {
    return <></>; // App principale
  }

  // ------------------------- PIN KEYPAD -------------------------------
  const onKeyTap = async (digit: string) => {
    if (state.kind !== 'locked' || busy) return;
    if (pin.length >= pinLength) return;
    const next = pin + digit;
    setShake(0);
    setPin(next);
    setError(null);
    if (next.length === pinLength) {
      await tryUnlock(next);
    }
  };

  const tryUnlock = async (candidate: string) => {
    setBusy(true);
    try {
      await unlockWithPin(candidate);
      // success → state.kind === 'authenticated'
    } catch (err) {
      const msg = (err as Error).message ?? 'PIN incorrect';
      setError(msg);
      setShake((n) => n + 1);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  // ------------------------- SETUP FORM -------------------------------
  // Round 107 — toute la logique setup() est retirée. Si le backend
  // renvoie `state.kind === 'setup'` (par ex. après un wipe complet de
  // la base users), on affiche un message d'erreur clair plutôt qu'un
  // formulaire — la création se fait côté serveur (scripts/seed-data.ts).

  // ------------------------- RENDER ----------------------------------
  const renderPinDots = (length: number, filled: number) => (
    <div className="flex items-center justify-center gap-3 mb-6">
      {Array.from({ length }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-4 w-4 rounded-full border-2 transition-all duration-300',
            i < filled
              ? 'bg-primary border-primary shadow-lg shadow-primary/40 scale-110'
              : 'border-border/60 bg-background/30',
          )}
        />
      ))}
    </div>
  );

  const keypadKeys: { label: string; digit: string; icon?: React.ReactNode }[] = [
    { label: '1', digit: '1' },
    { label: '2', digit: '2' },
    { label: '3', digit: '3' },
    { label: '4', digit: '4' },
    { label: '5', digit: '5' },
    { label: '6', digit: '6' },
    { label: '7', digit: '7' },
    { label: '8', digit: '8' },
    { label: '9', digit: '9' },
    { label: '0', digit: '0' },
    { label: 'Effacer', digit: '*back*', icon: <Delete size={18} /> },
  ];

  // Round 11 : si state.email est vide malgré un état 'locked', on affiche
  // un panneau d'erreur avec un bouton de reset.
  const lockedEmailMissing = state.kind === 'locked' && (!state.email || state.email.length === 0);

  return (
    <div
      className={cn(
        'fixed inset-0 z-40 flex items-center justify-center overflow-hidden',
        'bg-background',
      )}
    >
      {/* Round 101 — neutral black background, no violet/blue orbs (per user feedback) */}

      <div
        className={cn(
          'relative z-10 w-full max-w-md p-2 transition-transform',
          shake > 0 && 'animate-shake',
        )}
        key={shake /* re-trigger animation */}
      >
        <div className="relative overflow-hidden rounded-3xl border border-border/40 bg-card/40 backdrop-blur-2xl shadow-2xl shadow-primary/10 px-8 py-10">
          {/* Top accent */}
          <div className="absolute -top-px left-1/2 -translate-x-1/2 w-32 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />

          <BrandedHeader />

          {state.kind === 'locked' ? (
            <>
              <div className="text-center mb-6 space-y-1">
                <p className="text-sm text-muted-foreground">
                  Saisis ton PIN pour reprendre la main.
                </p>
                <p className="text-[11px] text-primary/80 font-mono break-all">{state.email}</p>
                <p className="text-[10px] text-muted-foreground/60 uppercase tracking-[0.25em]">
                  {pinLength} chiffres
                </p>
              </div>

              {renderPinDots(pinLength, pin.length)}

              {error && (
                <div className="mt-3 mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 text-xs flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  {error}
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 mt-4">
                {keypadKeys.map((k) => {
                  if (k.digit === '*back*') {
                    return (
                      <button
                        key="back"
                        type="button"
                        disabled={busy}
                        onClick={() => setPin((p) => p.slice(0, -1))}
                        className="h-16 rounded-2xl border border-border/40 bg-card/30 flex items-center justify-center transition-all active:scale-95 hover:bg-secondary/30 text-muted-foreground"
                      >
                        {k.icon}
                      </button>
                    );
                  }
                  return (
                    <button
                      key={k.digit}
                      type="button"
                      disabled={busy || pin.length >= pinLength}
                      onClick={() => onKeyTap(k.digit)}
                      className={cn(
                        'h-16 rounded-2xl border border-border/40 bg-card/30 backdrop-blur',
                        'text-2xl font-black text-foreground',
                        'transition-all active:scale-95 hover:bg-secondary/30',
                        'hover:border-primary/40',
                      )}
                    >
                      {k.label}
                    </button>
                  );
                })}
              </div>

              {/* Rund 88 — l'ancien bloc « Oubli ? Réinitialise » est viré.
                  Pour sortir d'un état verrouillé sans le PIN, il faut passer
                  par le recovery serveur (./scripts/reset-pin.sh côté infra).
                  Côté UI la seule sortie est désormais : bon PIN → retour app,
                  ou wipe complet du secureStorage local depuis DevTools. */}
            </>
          ) : state.kind === 'setup' ? (
            <SetupForm />
          ) : (
            <div className="text-center text-sm text-muted-foreground">Déverrouillage…</div>
          )}
        </div>
        {/* Round 118 — éditeur d'URL backend (tunnel) accessible depuis le
            lock screen : si le tunnel change, l'utilisateur re-pointe l'app
            sans rebuild APK ni accès aux Settings. */}
        <div className="mt-3">
          <button
            type="button"
            onClick={() => {
              setServerUrl(getApiBase());
              setShowServer((v) => !v);
            }}
            className="mx-auto flex items-center gap-2 rounded-full border border-border/40 bg-card/30 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <Server size={12} />
            Serveur
            <span className="text-[9px]">{showServer ? '▲' : '▼'}</span>
          </button>

          {showServer && (
            <div className="mt-2 rounded-xl border border-border/40 bg-card/40 p-3 backdrop-blur space-y-2">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
                URL backend (tunnel Cloudflare)
              </p>
              <input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://xxx.trycloudflare.com/api"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="w-full rounded-lg border border-border/40 bg-background/50 px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-primary"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setApiBase(serverUrl);
                    setShowServer(false);
                    setError(null);
                  }}
                  className="flex-1 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground transition-transform active:scale-95"
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApiBase('');
                    setServerUrl((import.meta.env?.VITE_API_BASE_URL as string | undefined) || '/api');
                  }}
                  className="rounded-lg border border-border/40 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Défaut
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-muted-foreground/50 uppercase tracking-[0.25em] mt-4">
          PIN local · bcrypt
        </p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------------
// Round 107 — SetupPanel, SetupField et leurs interfaces ont été
// retirés. La création de compte se fait via backend/scripts/seed-data.ts.
// -------------------------------------------------------------------------
