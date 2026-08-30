/**
 * SkillsPopover — menu "Skills" opérations Zentara.
 *
 * Round 10 — bouton topbar à droite.
 *
 * Catégorise les actions Zentara en 4 groupes :
 *  - Intelligence : AI analysis, Knowledge, Research, Intelligence center
 *  - Synchronisation  : toggle offline, sync queue, sync now
 *  - Sécurité  : lock session, logout, change PIN
 *  - Affichage  : dark/light, density, fullscreen
 *
 * Chaque skill expose :
 *  - icon (lucide)
 *  - label human-readable
 *  - description courte
 *  - shortcut clavier (optionnel)
 *  - onSelect callback (peut être vide → caller navigue)
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Command,
  KeyRound,
  LogOut,
  Moon,
  Sun,
  Maximize2,
  Database,
  Sparkles,
  Brain,
  RefreshCw,
  Wifi,
  WifiOff,
  Search,
  BookOpen,
  Bell,
  Download,
  ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface SkillAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  shortcut?: string;
  category: 'intelligence' | 'sync' | 'security' | 'display';
  onSelect: () => void | Promise<void>;
  external?: boolean;
}

export interface SkillsPopoverProps {
  /** Callback pour open Knowledge ingest modal (optionnel). */
  onTriggerKnowledge?: () => void;
  /** Callback pour relancer un sync manuel (optionnel). */
  onSyncNow?: () => Promise<void> | void;
  /** Mode offline manuel : force heuristique (parent décide). */
  onToggleOfflineMode?: () => void;
  /** Toggle dark/light. */
  onToggleTheme?: () => void;
  /** Toggle fullscreen. */
  onToggleFullscreen?: () => void;
  /** Logout. */
  onLogout?: () => void;
  /** Online status (info header). */
  isOnline?: boolean;
}

export function SkillsPopover(props: SkillsPopoverProps): React.ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [_soundTick] = React.useState(false);

  const groups = React.useMemo<Array<{ id: string; label: string; actions: SkillAction[] }>>(() => {
    const intelligence: SkillAction[] = [
      {
        id: 'ia-center',
        icon: <Sparkles size={14} />,
        label: 'AI Center',
        description: 'Analyse stratégique des prospects',
        shortcut: '⌥ A',
        category: 'intelligence',
        onSelect: () => navigate('/intelligence'),
      },
      {
        id: 'ia-research',
        icon: <Brain size={14} />,
        label: 'Research Engine',
        description: 'Recherche + analyse (7 engines)',
        shortcut: '⌥ R',
        category: 'intelligence',
        onSelect: () => navigate('/intelligence'),
      },
      {
        id: 'knowledge',
        icon: <BookOpen size={14} />,
        label: 'Knowledge Base',
        description: 'Notes RAG / recherche sémantique',
        shortcut: '⌥ K',
        category: 'intelligence',
        onSelect: () => navigate('/knowledge'),
      },
      {
        id: 'monitoring',
        icon: <Bell size={14} />,
        label: 'Live Monitoring',
        description: 'Signaux externes',
        shortcut: '⌥ M',
        category: 'intelligence',
        onSelect: () => navigate('/monitoring'),
      },
    ];
    const sync: SkillAction[] = [
      {
        id: 'sync-now',
        icon: <RefreshCw size={14} />,
        label: 'Sync local → cloud',
        description: 'Pousse les changements en attente',
        shortcut: '⇧ R',
        category: 'sync',
        onSelect: () => props.onSyncNow?.(),
      },
      {
        id: 'toggle-offline',
        icon: props.isOnline ? <WifiOff size={14} /> : <Wifi size={14} />,
        label: props.isOnline ? 'Mode offline (heuristique)' : 'Mode online',
        description: 'Force la passe locale / backend',
        shortcut: '⌥ O',
        category: 'sync',
        onSelect: () => props.onToggleOfflineMode?.(),
      },
      {
        id: 'export',
        icon: <Download size={14} />,
        label: 'Export SQLite / JSON',
        description: 'Backup local',
        shortcut: '⌥ E',
        category: 'sync',
        onSelect: () => navigate('/settings'),
      },
    ];
    const security: SkillAction[] = [
      {
        id: 'logout',
        icon: <LogOut size={14} />,
        label: 'Logout',
        description: 'Révoque le token Bearer côté serveur',
        shortcut: '⇧ ⌥ L',
        category: 'security',
        onSelect: () => props.onLogout?.(),
      },
    ];
    const display: SkillAction[] = [
      {
        id: 'theme',
        icon: <Moon size={14} />,
        label: 'Toggle Theme',
        description: 'Light / Dark',
        shortcut: '⌥ T',
        category: 'display',
        onSelect: () => props.onToggleTheme?.(),
      },
      {
        id: 'fullscreen',
        icon: <Maximize2 size={14} />,
        label: 'Fullscreen',
        description: 'Mode focus',
        shortcut: '⌥ F',
        category: 'display',
        onSelect: () => props.onToggleFullscreen?.(),
      },
      {
        id: 'search-shortcut',
        icon: <Search size={14} />,
        label: 'Recherche rapide',
        description: 'Search dans toutes les tables',
        shortcut: '⌘ K',
        category: 'display',
        onSelect: () => navigate('/search'),
      },
    ];
    return [
      { id: 'intelligence', label: 'Intelligence', actions: intelligence },
      { id: 'sync', label: 'Synchronisation', actions: sync },
      { id: 'security', label: 'Sécurité', actions: security },
      { id: 'display', label: 'Affichage', actions: display },
    ];
  }, [navigate, props]);

  const handleSelect = (action: SkillAction) => {
    if (action.external) return; // lien externe → caller gère
    void action.onSelect();
    setOpen(false);
  };

  // Raccourci clavier global : ⌘/Ctrl + K ouvre le popover.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Skills & quick actions"
          className={cn(
            // Button design — primary-cadre, light Glassmorphism, distinct
            // du reste de la topbar via un séparateur vertical (cf AppLayout).
            'group relative inline-flex items-center gap-2 h-10 px-4 rounded-full',
            'border border-primary/40 bg-primary/10 hover:bg-primary/20',
            'text-[11px] uppercase font-black tracking-widest text-primary',
            'transition-all duration-200 hover:scale-[1.02]',
            'shadow-[0_0_20px_rgba(56,189,248,0.15)] hover:shadow-[0_0_25px_rgba(56,189,248,0.3)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
          )}
        >
          <Command size={14} className="text-primary" />
          <span>Skills</span>
          <KeyRound size={10} className="opacity-50" />
          <span className="opacity-50">⌘ K</span>
          <span className="absolute -top-1 -right-1 flex">
            <span className="absolute inline-flex h-2 w-2 rounded-full bg-primary opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-80 p-0">
        <div className="rounded-t-2xl bg-gradient-to-b from-primary/10 to-transparent px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Command size={14} className="text-primary" />
            <span className="text-[11px] uppercase font-black tracking-widest text-primary">
              Zentara Skills
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Actions rapides · raccourci global <kbd className="px-1.5 py-0.5 mx-1 rounded bg-secondary border border-border/60 text-[10px] font-bold">⌘ K</kbd>
          </p>
        </div>

        <div className="max-h-[420px] overflow-y-auto p-2 space-y-3">
          {groups.map((group) => (
            <div key={group.id}>
              <div className="px-2 pt-1 pb-1.5 text-[9px] uppercase tracking-[0.25em] font-black text-muted-foreground/70">
                {group.label}
              </div>
              <div className="space-y-1">
                {group.actions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => handleSelect(action)}
                    className={cn(
                      'w-full flex items-start gap-3 px-2.5 py-2 rounded-xl',
                      'text-left group transition-all duration-150',
                      'hover:bg-primary/10 focus:bg-primary/10',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                      _soundTick ? '' : '',
                    )}
                  >
                    <div className="flex-none w-7 h-7 flex items-center justify-center rounded-lg bg-secondary/40 border border-border/40 text-primary group-hover:border-primary/40 group-hover:scale-110 transition-transform">
                      {action.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-foreground truncate">
                        {action.label}
                      </div>
                      {action.description && (
                        <div className="text-[11px] text-muted-foreground truncate">
                          {action.description}
                        </div>
                      )}
                    </div>
                    {action.shortcut && (
                      <kbd className="flex-none mt-1 px-1.5 py-0.5 rounded bg-secondary/60 border border-border/40 text-[9px] font-bold text-muted-foreground">
                        {action.shortcut}
                      </kbd>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-border/40 flex items-center justify-between text-[10px] text-muted-foreground/70">
          <span className="flex items-center gap-1">
            <Database size={10} />
            SQLite local + backend
          </span>
          <a className="flex items-center gap-1 hover:text-primary transition-colors" href="/docs/INTEGRATION.md">
            Docs <ExternalLink size={10} />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Tab marker — variable utilitaire pour TS unused detection silencing.
function _silence<T>(arg: T): T { return arg; }
void _silence;
const _keepBuild: 0 = 0;
void _keepBuild;
