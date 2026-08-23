/**
 * QuickAdd — bouton "+\" universel pour Zentara.
 *
 * Deux variantes visuelles :
 *  - 'compact'  → 44×44, utilisé dans la topbar (overview rapide)
 *  - 'dock'     → 60×60 élevé au-dessus de la bottom-nav flottante (mobile)
 *
 * Dans tous les cas, ouvre un Popover avec 5 actions de création rapide :
 *   - Nouveau Prospect     → /prospects    (la page liste a déjà son bouton New)
 *   - Nouvelle Entreprise  → /companies
 *   - Nouveau Contact      → /contacts
 *   - Nouvelle Campagne    → /campaigns
 *   - Nouvelle Note (RAG)  → /knowledge
 *
 * Plus tard : câbler chaque action sur un modal d'inline creation.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  UserPlus,
  Building2,
  Contact,
  Target,
  NotebookPen,
  Sparkles,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface QuickAction {
  icon: React.ReactNode;
  label: string;
  hint: string;
  path: string;
  accent: string;
}

const ACTIONS: QuickAction[] = [
  {
    icon: <UserPlus size={16} />,
    label: 'Nouveau Prospect',
    hint: 'Ajouter un contact stratégique',
    path: '/prospects',
    accent: 'from-lime-500/20 to-lime-400/20 text-lime-400',
  },
  {
    icon: <Building2 size={16} />,
    label: 'Nouvelle Entreprise',
    hint: 'Company account enrichi',
    path: '/companies',
    accent: 'from-violet-500/20 to-fuchsia-500/20 text-fuchsia-500',
  },
  {
    icon: <Contact size={16} />,
    label: 'Nouveau Contact',
    hint: 'Personne clé à pister',
    path: '/contacts',
    accent: 'from-amber-500/20 to-orange-500/20 text-amber-500',
  },
  {
    icon: <Target size={16} />,
    label: 'Nouvelle Campagne',
    hint: 'Séquence outbound / inbound',
    path: '/campaigns',
    accent: 'from-pink-500/20 to-rose-500/20 text-rose-500',
  },
  {
    icon: <NotebookPen size={16} />,
    label: 'Note Knowledge',
    hint: 'Ingestion dans le RAG local',
    path: '/knowledge',
    accent: 'from-emerald-500/20 to-teal-500/20 text-emerald-500',
  },
];

export type QuickAddVariant = 'compact' | 'dock';

export function QuickAdd({
  variant = 'compact',
  className,
}: {
  variant?: QuickAddVariant;
  className?: string;
}): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const navigate = useNavigate();

  const onSelect = (action: QuickAction) => {
    setOpen(false);
    navigate(action.path);
  };

  const isDock = variant === 'dock';

  // Dimensions : compact = à plat ; dock = bouton surélevé (FAB-like).
  const buttonSize = isDock ? 'h-14 w-14' : 'h-11 w-11';
  const iconSize = isDock ? 28 : 22;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Quick add"
          title="Création rapide"
          className={cn(
            // Mobile only — le desktop a déjà ses propres boutons New.
            'md:hidden',
            // Base.
            'relative rounded-full',
            'bg-gradient-to-br from-primary via-lime-400 to-accent',
            'text-primary-foreground',
            'flex items-center justify-center',
            buttonSize,
            // Animations.
            'transition-all duration-300 ease-out',
            'hover:scale-110 hover:shadow-2xl hover:shadow-primary/60',
            'active:scale-95',
            // Halo pulsant (ring gradient animé) pour faire ressortir le FAB.
            'before:absolute before:inset-[-6px] before:rounded-full',
            'before:bg-gradient-to-br before:from-primary/30 before:via-lime-400/30 before:to-accent/30',
            'before:blur-md before:opacity-60 before:animate-pulse before:pointer-events-none',
            // Outline ring when popover open.
            open && 'ring-4 ring-primary/50 ring-offset-2 ring-offset-card',
            // Le dock variant doit pouvoir dépasser au-dessus de la bottom-nav
            // (translateY négatif côté parent).
            className,
          )}
        >
          <Plus
            size={iconSize}
            strokeWidth={2.5}
            className={cn(
              'transition-transform duration-300',
              'group-hover:rotate-90',
              open && 'rotate-45',
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={isDock ? 18 : 12}
        className="w-72 overflow-hidden p-0 border-primary/20 shadow-2xl shadow-primary/20"
      >
        <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-br from-primary/5 to-accent/5">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-primary" />
            <span className="text-[10px] font-black uppercase tracking-widest text-primary">
              Création rapide
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Ajoute un élément en 1 clic.
          </p>
        </div>
        <div className="p-1.5 space-y-0.5">
          {ACTIONS.map((action) => (
            <button
              key={action.path}
              type="button"
              onClick={() => onSelect(action)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl',
                'transition-all duration-150',
                'hover:bg-secondary/60 active:scale-[0.98]',
                'group',
              )}
            >
              <div
                className={cn(
                  'h-9 w-9 rounded-xl flex items-center justify-center shrink-0',
                  'bg-gradient-to-br border border-white/5',
                  action.accent,
                )}
              >
                {action.icon}
              </div>
              <div className="flex-1 text-left min-w-0">
                <div className="text-sm font-bold tracking-tight group-hover:text-primary transition-colors">
                  {action.label}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {action.hint}
                </div>
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
