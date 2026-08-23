/**
 * PreloadSplash — splash animé pendant le chargement initial.
 *
 * Round 9 — design polish :
 *  - Logo "ZENTARA" avec gradient animé → animation infinie.
 *  - Indicateur de progression simulé (animation CSS).
 *  - Backdrop blurred avec radial gradients (cyan/blue).
 *  - State messages ("Initialisation sécurisée", "Connexion backend", etc.).
 */
import React from 'react';
import { Sparkles, Lock, Database, Wifi } from 'lucide-react';

const PHASES = [
  { icon: Lock, label: 'Initialisation sécurisée' },
  { icon: Database, label: 'Chargement base locale' },
  { icon: Wifi, label: 'Connexion backend' },
  { icon: Sparkles, label: 'IA prête' },
];

export interface PreloadSplashProps {
  /** Phase courante (0..3). Si undefined, on cycle toutes les 700ms. */
  phase?: number;
  /** Message optionnel affiché sous les phases. */
  message?: string;
}

export function PreloadSplash({ phase, message }: PreloadSplashProps): React.ReactElement {
  const [auto, setAuto] = React.useState(0);
  React.useEffect(() => {
    if (phase !== undefined) return;
    const t = setInterval(() => setAuto((p) => (p + 1) % PHASES.length), 700);
    return () => clearInterval(t);
  }, [phase]);
  const active = phase ?? auto;

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-background">
      {/* Rund 88 — halo bleu radial (cyan remplacé), reste subtil car le fond
         est déjà très sombre — pas de flash blanc au boot. */}
      <div className="pointer-events-none absolute -top-32 -left-32 h-[500px] w-[500px] rounded-full bg-blue-600/15 blur-[140px] animate-pulse" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-[600px] w-[600px] rounded-full bg-lime-500/10 blur-[160px] animate-pulse [animation-delay:1s]" />

      {/* Brand */}
      <div className="relative z-10 flex flex-col items-center gap-8">
        <div className="relative">
          <div className="absolute inset-0 rounded-3xl bg-primary/35 blur-3xl animate-pulse" />
          {/* Rund 88 — l'icône centrale passe d'un gradient cyan-pâle
             (qui rendait l'icône quasi-blanche) à un bleu plein,
             bordé de ring/40. Le sparkles icon est en blanc pour le
             contraste maximal. */}
          <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-accent ring-1 ring-primary/50 shadow-2xl shadow-primary/30">
            <Sparkles size={36} className="text-primary-foreground drop-shadow-md" />
          </div>
        </div>

        <div className="text-center">
          {/* Rund 88 — gradient du wordmark passe de cyan→cyan à
             blue-600→blue-400→blue-600, plus posé, plus "outil pro". */}
          <h1 className="text-5xl md:text-6xl font-black tracking-tighter bg-gradient-to-r from-primary via-accent to-primary bg-[length:200%_auto] animate-gradient bg-clip-text text-transparent">
            ZENTARA
          </h1>
          <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground mt-2 font-bold">
            Strategic Intelligence
          </p>
        </div>

        {/* Progress bar */}
        <div className="w-72 h-1 bg-secondary/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-accent rounded-full transition-all duration-500 ease-out"
            style={{ width: `${((active + 1) / PHASES.length) * 100}%` }}
          />
        </div>

        {/* Phases */}
        <div className="flex items-center gap-3 text-xs uppercase tracking-widest font-bold">
          {PHASES.map((p, i) => {
            const Icon = p.icon;
            const isActive = i === active;
            const isDone = i < active;
            return (
              <div key={p.label} className="flex items-center gap-2">
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-500 ${
                    isActive
                      ? 'border-primary bg-primary/20 text-primary shadow-lg shadow-primary/30 scale-110'
                      : isDone
                        ? 'border-green-500/40 bg-green-500/10 text-green-500'
                        : 'border-border/40 text-muted-foreground/40'
                  }`}
                >
                  <Icon size={12} />
                </div>
                {i < PHASES.length - 1 && (
                  <div
                    className={`h-px w-4 transition-colors ${
                      isDone ? 'bg-green-500/40' : 'bg-border/30'
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <p className="text-sm text-muted-foreground font-medium tracking-wide min-h-[20px]">
          {message ?? PHASES[active].label}
        </p>
      </div>
    </div>
  );
}
