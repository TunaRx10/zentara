import React from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  Building2,
  Contact,
  Zap,
  Target,
  Eye,
  BarChart3,
  Settings,
  Bell,
  Wifi,
  WifiOff,
  User,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronsLeftRight,
  PanelLeft,
  ExternalLink,
  ChevronDown,
  Mail,
  BookOpen,
  FileText,
  Palette,
  Rocket,
  MoreHorizontal,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import NotificationsPanel from '@/components/NotificationsPanel';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

/**
 * Round 138 — BrandMark
 *   Petit monogramme "Z" centré sur fond noir premium, avec dégradé argent.
 *   Reproduit exactement le favicon (ratio 1:1) — se décline en 20/28/40 px.
 *   `withBg={false}` : pas de fond arrondi (utilisé en avatar/petit badge).
 */
type BrandMarkProps = { size?: number; withBg?: boolean; className?: string };
function BrandMark({ size = 28, withBg = true, className }: BrandMarkProps): React.ReactElement {
  const s = size;
  return (
    <svg
      role="img"
      aria-label="Zentara"
      width={s}
      height={s}
      viewBox="0 0 512 512"
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient id="bmSilver" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor="#D6DAE2" />
          <stop offset="100%" stopColor="#7E8693" />
        </linearGradient>
      </defs>
      {withBg && (
        <>
          <rect width="512" height="512" rx="116" fill="#14141B" />
          <rect
            x="1.5"
            y="1.5"
            width="509"
            height="509"
            rx="114.5"
            fill="none"
            stroke="#FFFFFF"
            strokeOpacity="0.08"
            strokeWidth="1.5"
          />
        </>
      )}
      <path
        d="M 160 168 H 360 L 160 344 H 360"
        fill="none"
        stroke="url(#bmSilver)"
        strokeWidth="48"
        strokeLinecap="round"
        strokeLinejoin="miter"
        strokeMiterlimit="6"
      />
      <rect x="378" y="378" width="34" height="34" rx="6" fill="#E8ECF2" fillOpacity="0.92" />
    </svg>
  );
}
import { useAuth } from '@/services/auth/auth.context';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { useTaskCountsQuery } from '@/hooks/useBackendData';
import { SkillsPopover } from '@/components/SkillsPopover';
import { QuickAdd } from '@/components/QuickAdd';
import { autoHealApiBase, getApiBase, setApiBase as setRuntimeApiBase } from '@/services/api/client';
import { useToast } from '@/contexts/ToastProvider';

/**
 * Round 35 — The "AI Center" entry is a SECTION with sub-routes
 * (Single Prospect · Strategic Prospecting · Outreach Centre).
 * Round 65 — Renamed from "Intelligence" → "AI Center", icon → Sparkles,
 * moved right after Dashboard so the AI core value-prop is the #2 entry,
 * and nav from collapsed header uses `navigate()` (no full reload).
 */
type NavItem = {
  icon: typeof LayoutDashboard;
  label: string;
  path: string;
};
type NavSection = {
  icon: typeof LayoutDashboard;
  label: string;
  /** Path considered "open" for auto-expand (matches current pathname). */
  matchPrefix: string;
  subItems: NavItem[];
};

// Round 142 — TOUT le moteur en UNE page : l'ancien AI Center, Leadflow,
// Zentara One, Search et Maps sont fusionnés dans « Moteur » (/one).
const flatNavItems: NavItem[] = [
  { icon: LayoutDashboard, label: 'Overview', path: '/' },
  { icon: Rocket, label: 'Moteur', path: '/one' },
  { icon: Users, label: 'Prospects', path: '/prospects' },
  { icon: Building2, label: 'Companies', path: '/companies' },
  { icon: Contact, label: 'Contacts', path: '/contacts' },
  { icon: Target, label: 'Campaigns', path: '/campaigns' },
  { icon: MessageSquare, label: 'Chat', path: '/chat' },
];

/**
 * Section « Plus » — outils secondaires regroupés pour garder la sidebar
 * minimale. `matchPrefix` est un sentinel qui ne matche aucun chemin réel,
 * donc le groupe ne s'ouvre qu'au clic (pas d'auto-expand).
 */
const moreSection: NavSection = {
  icon: MoreHorizontal,
  label: 'Plus',
  matchPrefix: '/(never-match)',
  subItems: [
    { icon: Mail,      label: 'Emails',                  path: '/emails' },
    { icon: BookOpen,  label: 'Knowledge',               path: '/knowledge' },
    { icon: Eye,       label: 'Monitoring',              path: '/monitoring' },
    { icon: BarChart3, label: 'Analytics',               path: '/analytics' },
    { icon: FileText,  label: 'Contracts',               path: '/contracts' },
    { icon: Palette,   label: 'Design Audit',            path: '/design-audit' },
    { icon: Settings,  label: 'Settings',                path: '/settings' },
  ],
};

/**
 * Sidebar minimale : les 7 entrées core + une section « Plus » repliable.
 */
const navItems: Array<NavItem | { section: NavSection }> = [
  ...flatNavItems,
  { section: moreSection },
];

/** Walk the structured list and emit the matching nav entry for a path. */
function findNavEntry(path: string): { kind: 'flat' | 'section'; label: string; section?: NavSection; item?: NavItem } {
  for (const entry of navItems) {
    if ('section' in entry) {
      // Inside a sub-item?
      for (const sub of entry.section.subItems) {
        // Compare pathname BEFORE the query string
        const subPathBare = sub.path.split('?')[0];
        if (path === subPathBare || path === sub.path || subPathBare === path) {
          return { kind: 'flat', label: sub.label, section: entry.section, item: sub };
        }
      }
      // Otherwise treat as section header when at the section base.
      if (path === entry.section.matchPrefix) {
        return { kind: 'section', label: entry.section.label, section: entry.section };
      }
    } else {
      if (path === entry.path) {
        return { kind: 'flat', label: entry.label, item: entry };
      }
    }
  }
  return { kind: 'flat', label: 'Zentara' };
}

/**
 * Bouton flottant à droite de la sidebar (desktop). Cache ou expand la
 * sidebar. Visible `md+`.
 */
function SidebarToggle({
  isCollapsed,
  onToggle,
}: {
  isCollapsed: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className={cn(
        'absolute top-1/2 -translate-y-1/2 z-50',
        'flex items-center justify-center',
        'right-0 translate-x-1/2 w-9 h-9 rounded-2xl',
        'border border-border bg-card text-muted-foreground',
        'shadow-xl shadow-primary/10',
        'transition-all duration-200',
        'hover:scale-110 hover:text-primary hover:border-primary/60',
        'active:scale-95',
        'hidden md:flex',
      )}
    >
      {isCollapsed ? (
        <PanelLeftOpen size={16} className="transition-transform duration-300" />
      ) : (
        <PanelLeftClose size={16} className="transition-transform duration-300" />
      )}
    </button>
  );
}

/**
 * Bouton sidebar MOBILE — dans le topbar, à gauche. Ouvre le drawer Sheet
 * réutilisant la SidebarContent.
 */
function MobileSidebarButton({
  onClick,
}: {
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label="Open sidebar"
      title="Ouvrir la navigation latérale"
      onClick={onClick}
      className={cn(
        // Mobile only.
        'md:hidden',
        'group relative h-11 w-11 rounded-2xl',
        'border border-border/60 bg-card/60 backdrop-blur',
        'flex items-center justify-center',
        'hover:bg-primary/10 hover:border-primary/40 hover:text-primary',
        'active:scale-95 transition-all duration-200',
      )}
    >
      {/* Halo subtil quand hover. */}
      <span
        className={cn(
          'absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300',
          'bg-gradient-to-br from-primary/10 to-accent/10 blur-sm',
        )}
      />
      <PanelLeft
        size={20}
        className="relative z-10 transition-transform duration-200 group-hover:scale-110"
      />
    </button>
  );
}

/**
 * Bouton QuickAdd intégré à la bottom-nav flottante (mobile).
 * Surélevé au-dessus de la barre pour ressembler à un FAB iOS/Material.
 */
function BottomNavQuickAdd(): React.ReactElement {
  return (
    // translate upward so the round button pops above the dock surface.
    <div className="-translate-y-6 transition-transform duration-300">
      <QuickAdd variant="dock" />
    </div>
  );
}

/**
 * Round 35 — Section collapsible avec sous-items dans la sidebar.
 * Auto-expand si `isInSection` (la pathname courante matche matchPrefix).
 */
// =====================================================================
// Round 36 — Petit badge de compteur sur l'icône Bell du topbar
// =====================================================================

function NotificationBadge({ unseen }: { unseen: number }): React.ReactElement | null {
  if (!unseen || unseen <= 0) return null;
  const label = unseen > 99 ? '99+' : String(unseen);
  const big = unseen >= 10;
  return (
    <span
      className={cn(
        'absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full',
        'flex items-center justify-center text-[9px] font-black text-white',
        'bg-gradient-to-br from-red-500 to-pink-600 shadow shadow-red-500/40',
        'border-2 border-card animate-bounce',
        big && 'min-w-5',
      )}
      aria-label={`${unseen} notifications non lues`}
    >
      {label}
    </span>
  );
}

function NavSectionGroup(props: {
  section: NavSection;
  isInSection: boolean;
  activeSubTab: string | null;
  isCollapsed: boolean;
  mode: 'desktop' | 'drawer';
  onItemClick: () => void;
}): React.ReactElement {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState<boolean>(props.isInSection);
  React.useEffect(() => { if (props.isInSection) setOpen(true); }, [props.isInSection]);

  // Round 65 — Header is active whenever the user is anywhere inside the
  // section (whether `?tab=` is set or not). This handles `/intelligence`
  // with no query string.
  const headerIsActive = props.isInSection;
  const showLabel = !props.isCollapsed || props.mode === 'drawer';

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => {
          // En mode collapsed desktop, naviguer vers le 1er sub-item
          // via React Router (PAS de window.location.href → évite le full
          // page reload + preserve React state + animations).
          // En mode expanded/drawer, juste toggler l'expansion.
          if (props.isCollapsed && props.mode === 'desktop') {
            props.onItemClick();
            navigate(props.section.subItems[0].path);
            return;
          }
          setOpen((v) => !v);
        }}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative overflow-hidden text-left',
          headerIsActive
            ? 'bg-white/10 text-foreground'
            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
        )}
        aria-expanded={open}
      >
        <props.section.icon
          size={20}
          className={cn(
            'shrink-0 transition-transform duration-200 group-hover:scale-110',
            headerIsActive ? 'text-white' : 'group-hover:text-primary',
          )}
        />
        {showLabel && (
          <>
            <span className="font-semibold text-sm tracking-tight flex-1">{props.section.label}</span>
            <ChevronDown
              size={14}
              className={cn('transition-transform duration-300', open && 'rotate-180', headerIsActive ? 'opacity-80' : 'opacity-50')}
            />
          </>
        )}
        {headerIsActive && showLabel && (
          <div className="absolute right-0 w-1 h-6 bg-white/20 rounded-l-full" />
        )}
      </button>
      {open && showLabel && (
        <ul className="pl-4 space-y-0.5 mt-0.5">
          {props.section.subItems.map((sub, subIdx) => {
            const tabKey = sub.path.split('?')[1]?.split('=')[1] ?? null;
            // Round 65 — A subItem is highlighted if its `?tab=` matches
            // the current one, OR if we're on the bare section path AND
            // it's the FIRST sub-item (default route).
            const isBareSection = props.isInSection && props.activeSubTab == null;
            const isActive =
              (tabKey != null && props.activeSubTab === tabKey) ||
              (isBareSection && subIdx === 0);
            return (
              <li key={sub.path}>
                <Link
                  to={sub.path}
                  onClick={props.onItemClick}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-xs transition-all duration-200 group',
                  isActive
                    ? 'bg-white/10 text-foreground font-bold'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground',
                )}
                >
                  <span className={cn(
                    'w-1 h-1 rounded-full shrink-0',
                    isActive ? 'bg-primary' : 'bg-muted-foreground/40',
                  )} />
                  <sub.icon
                    size={14}
                    className={cn('shrink-0', isActive && 'text-primary')}
                  />
                  <span className="font-medium">{sub.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function AppLayout(): React.ReactElement {
  // Persistance locale du collapse (desktop) → meilleure UX.
  const [isSidebarOpen, setIsSidebarOpen] = React.useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('zentara.layout.sidebarOpen');
    return stored === null ? true : stored === '1';
  });

  // Mobile drawer state (Sheet).
  const [mobileDrawerOpen, setMobileDrawerOpen] = React.useState(false);

  const [notificationsOpen, setNotificationsOpen] = React.useState(false);
  const { isOnline } = useNetworkStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const { state: authState, logout } = useAuth();
  // Round 36 — compteurs de notifications (badge de l'icône Bell).
  const { data: counts } = useTaskCountsQuery();

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('zentara.layout.sidebarOpen', isSidebarOpen ? '1' : '0');
  }, [isSidebarOpen]);

  // Auto-ferme le drawer mobile sur navigation.
  React.useEffect(() => {
    setMobileDrawerOpen(false);
  }, [location.pathname]);

  // Round 138 — bandeau « Backend joignable / rétabli »
  //   A) au boot, probe la base courante;
  //   B) si KO, tente l'auto-heal (URL stockée → env → `/api`);
  //   C) si l'auto-heal trouve une URL qui répond, on l'active silencieusement
  //      et on affiche un toast "Backend rétabli";
  //   D) sinon, on affiche un bandeau persistant avec un bouton "Réinitialiser
  //      l'URL backend" qui efface la surcharge localeStorage.
  const toast = useToast();
  const [backendBanner, setBackendBanner] = React.useState<{
    state: 'ok' | 'recovered' | 'down';
    activeUrl: string;
    oldUrl: string;
  } | null>(null);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      const oldUrl = getApiBase();
      const recovered = await autoHealApiBase((working) => {
        if (cancelled) return;
        if (working) {
          if (working !== oldUrl) {
            setBackendBanner({ state: 'recovered', activeUrl: working, oldUrl });
            setTimeout(() => setBackendBanner((cur) => (cur?.state === 'recovered' ? null : cur)), 8000);
          } else {
            // déjà joignable, rien à dire
            setBackendBanner(null);
          }
        } else {
          setBackendBanner({ state: 'down', activeUrl: oldUrl, oldUrl });
        }
      });
      if (!cancelled && recovered && recovered !== oldUrl) {
        toast.successDetailed('Backend rétabli', `URL auto-réparée → ${recovered}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleResetBackendUrl = React.useCallback(() => {
    setRuntimeApiBase('');
    setBackendBanner(null);
    toast.infoDetailed(
      'URL backend réinitialisée',
      "Recharge l'onglet (ou clique “Re-tester”) pour appliquer le défaut /api.",
    );
  }, [toast]);

  const handleToggleTheme = React.useCallback(() => {
    document.documentElement.classList.toggle('dark');
  }, []);
  const handleToggleFullscreen = React.useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  }, []);
  const handleSyncNow = React.useCallback(() => {
    navigate('/settings');
  }, [navigate]);
  const handleToggleOfflineMode = React.useCallback(() => {
    window.dispatchEvent(new CustomEvent('zentara:toggle-offline-mode'));
  }, []);

  // SidebarContent = même composant visuel pour desktop + drawer mobile.
  const SidebarContent = ({
    isCollapsed = false,
    onItemClick = () => undefined,
    mode = 'desktop',
  }: {
    isCollapsed?: boolean;
    onItemClick?: () => void;
    mode?: 'desktop' | 'drawer';
  }) => (
    <div className="flex flex-col h-full py-4">
      <div className={cn('px-6 mb-8 flex items-center justify-between', isCollapsed && mode === 'desktop' && 'px-0 justify-center')}>
        {(!isCollapsed || mode === 'drawer') && (
          <div className="flex items-center gap-2.5 select-none">
            <BrandMark size={28} />
            <span className="text-xl font-black tracking-tight text-foreground">
              Zentara
            </span>
          </div>
        )}
        {isCollapsed && mode === 'desktop' && (
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg ring-1 ring-white/10 bg-gradient-to-br from-[#14141B] to-[#08080C]">
            <BrandMark size={28} withBg={false} />
          </div>
        )}
      </div>

      {/* CTA vers la recherche de prospects (Moteur /one) — bien visible au sommet de la sidebar. */}
      {(!isCollapsed || mode === 'drawer') ? (
        <div className="px-4 pb-3">
          <button
            type="button"
            onClick={() => {
              onItemClick();
              navigate('/one');
            }}
            className="w-full h-11 px-4 rounded-2xl bg-gradient-to-r from-primary to-violet-600 text-white text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 shadow-lg shadow-primary/20 transition-all hover:brightness-110 active:scale-95"
          >
            <Rocket size={15} /> Rechercher des prospects
          </button>
        </div>
      ) : (
        <div className="px-2 pb-3 flex justify-center">
          <button
            type="button"
            onClick={() => {
              onItemClick();
              navigate('/one');
            }}
            title="Rechercher des prospects"
            className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-violet-600 text-white flex items-center justify-center shadow-lg shadow-primary/20 transition-all hover:brightness-110 active:scale-95"
          >
            <Rocket size={16} />
          </button>
        </div>
      )}

      <ScrollArea className="flex-1 px-4">
        <nav className="space-y-1">
          {navItems.map((entry, idx) => {
            // Section (collapsible group with sub-items).
            if ('section' in entry) {
              const section = entry.section;
              const isInSection = location.pathname.startsWith(section.matchPrefix);
              // Detect active subTab from the URL (?tab=)
              const usp = new URLSearchParams(location.search);
              const activeSubTab = isInSection ? (usp.get('tab') as string | null) : null;
              return (
                <NavSectionGroup
                  key={`sec-${idx}`}
                  section={section}
                  isInSection={isInSection}
                  activeSubTab={activeSubTab}
                  isCollapsed={isCollapsed}
                  mode={mode}
                  onItemClick={onItemClick}
                />
              );
            }
            // Flat item.
            const item = entry;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={onItemClick}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative overflow-hidden',
                  isActive
                    ? 'bg-white/10 text-foreground'
                    : 'text-muted-foreground hover:bg-white/5 hover:text-foreground'
                )}
              >
                <item.icon
                  size={20}
                  className={cn(
                    'shrink-0 transition-transform duration-200 group-hover:scale-110',
                    isActive ? 'text-white' : 'group-hover:text-primary',
                  )}
                />
                {(!isCollapsed || mode === 'drawer') && (
                  <span className="font-semibold text-sm tracking-tight">{item.label}</span>
                )}
                {isActive && (!isCollapsed || mode === 'drawer') && (
                  <div className="absolute right-0 w-1 h-6 bg-white/20 rounded-l-full" />
                )}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>

      <div className="mt-auto px-4 pt-4 border-t border-border/50 space-y-2">
        <div
          className={cn(
            'flex items-center gap-3 p-2 rounded-2xl bg-secondary/30 border border-border/50 backdrop-blur-sm',
            isCollapsed && mode === 'desktop' ? 'justify-center' : 'px-3',
          )}
        >
          <Avatar className="w-8 h-8 ring-2 ring-primary/20">
            <AvatarImage src="https://avatar.vercel.sh/zentara-admin.png" />
            <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
              <User size={14} />
            </AvatarFallback>
          </Avatar>
          {(!isCollapsed || mode === 'drawer') && (
            <div className="flex flex-col overflow-hidden">
              <span className="text-xs font-bold truncate">
                {authState.kind === 'authenticated' ? authState.user.name : 'Strategic Lead'}
              </span>
              <span className="text-[10px] text-muted-foreground truncate opacity-70 uppercase tracking-widest font-black">
                {authState.kind === 'authenticated' ? authState.user.role : 'Admin Access'}
              </span>
            </div>
          )}
        </div>
        {(!isCollapsed || mode === 'drawer') && authState.kind === 'authenticated' && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                logout();
                onItemClick();
              }}
              className="flex-1 h-8 px-3 rounded-xl bg-secondary/30 border border-border/40 text-[10px] uppercase tracking-widest font-black text-muted-foreground hover:text-red-500 hover:border-red-500/40 transition-colors flex items-center justify-center gap-1"
              title="Déconnexion complète (révoque le token serveur)"
            >
              <LogOut size={11} /> Logout
            </button>
          </div>
        )}

        {/* Lien vers la landing marketing — visible quand la sidebar n'est
            pas colapsée (desktop expanded) ou systématiquement dans le drawer
            mobile (où il n'est jamais collapsed). Le click navigue vers
            /landing ET appelle onItemClick() pour fermer le drawer mobile
            via l'effect sur location.pathname. */}
        {(!isCollapsed || mode === 'drawer') && (
          <button
            type="button"
            title="Voir la landing publique"
            aria-label="Voir la landing publique"
            onClick={() => {
              onItemClick();
              navigate('/landing');
            }}
            className={cn(
              'w-full h-9 px-3 rounded-xl border border-border/40',
              'inline-flex items-center justify-center gap-1.5',
              'text-[10px] font-black uppercase tracking-widest',
              'text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5',
              'bg-secondary/20 transition-all active:scale-95',
            )}
          >
            <ExternalLink size={12} />
            Voir la landing
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden font-sans selection:bg-primary/30">
      {/* ===== Desktop Sidebar (md+) ===== */}
      <aside
        className={cn(
          'hidden md:flex relative bg-card/80 backdrop-blur-xl border-r border-border',
          'transition-[width,margin] duration-500 ease-in-out z-40 group/sidebar',
          isSidebarOpen ? 'w-72' : 'w-20',
        )}
      >
        <SidebarToggle isCollapsed={!isSidebarOpen} onToggle={() => setIsSidebarOpen((v) => !v)} />
        <div className="flex flex-col w-full relative overflow-hidden">
          <SidebarContent isCollapsed={!isSidebarOpen} mode="desktop" />
        </div>
      </aside>

      {/* ===== Mobile Sidebar Drawer (Sheet) — visible <md ===== */}
      <Sheet open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
        <SheetContent
          side="left"
          className="w-72 p-0 bg-card/95 backdrop-blur-2xl border-r border-primary/20"
        >
          <SidebarContent isCollapsed={false} mode="drawer" />
        </SheetContent>
      </Sheet>

      {/* ===== Main Content Area ===== */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Animated Background Gradients */}
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-lime-500/10 blur-[140px] rounded-full -translate-y-1/2 translate-x-1/3 pointer-events-none animate-pulse" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-blue-600/5 blur-[140px] rounded-full translate-y-1/3 -translate-x-1/3 pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(56,189,248,0.04),transparent_50%)] pointer-events-none" />

        {/* ===== Topbar ===== */}
        <header className="h-20 border-b border-border bg-background/40 backdrop-blur-2xl flex items-center justify-between gap-2 px-4 md:px-10 z-30 shrink-0">
          {/* Gauche : bouton sidebar (mobile) + titre */}
          <div className="flex items-center gap-3 min-w-0">
            <MobileSidebarButton onClick={() => setMobileDrawerOpen(true)} />

            <div className="flex flex-col min-w-0">
              <h1 className="text-lg md:text-2xl font-black tracking-tight flex items-center gap-3">
                <span className="truncate max-w-[140px] sm:max-w-[200px]">
                  {findNavEntry(location.pathname).label}
                </span>
                <Separator orientation="vertical" className="h-5 hidden md:block" />
                <span className="text-xs font-medium text-muted-foreground hidden md:block opacity-50 uppercase tracking-[0.2em]">
                  Strategic Environment
                </span>
              </h1>
            </div>
          </div>

          {/* Droite (desktop only — Skills + état) */}
          <div className="hidden md:flex items-center gap-3 md:gap-5 ml-auto">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  'flex items-center gap-2 px-4 py-1.5 rounded-full text-[10px] font-black tracking-widest border transition-all duration-500',
                  isOnline
                    ? 'bg-green-500/10 text-green-500 border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.1)]'
                    : 'bg-red-500/10 text-red-500 border-red-500/20',
                )}
                aria-live="polite"
              >
                <div className={cn('w-1.5 h-1.5 rounded-full animate-pulse', isOnline ? 'bg-green-500' : 'bg-red-500')} />
                {isOnline ? 'OPERATIONAL' : 'DISCONNECTED'}
              </div>
              <div className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative group hover:bg-primary/10 transition-colors"
                  onClick={() => setNotificationsOpen((v) => !v)}
                  aria-label="Notifications"
                  aria-expanded={notificationsOpen}
                  aria-haspopup="dialog"
                >
                  <Bell size={20} className="group-hover:text-primary transition-colors" />
                  <NotificationBadge unseen={counts?.unseen ?? 0} />
                </Button>
                <NotificationsPanel
                  open={notificationsOpen}
                  onClose={() => setNotificationsOpen(false)}
                />
              </div>
            </div>

            <Separator orientation="vertical" className="h-7 mx-2 bg-gradient-to-b from-transparent via-border/60 to-transparent" />

            {/* Lien vers la landing marketing — visible uniquement quand authentifié. */}
            <button
              type="button"
              title="Voir la landing publique"
              aria-label="Voir la landing publique"
              onClick={() => navigate('/landing')}
              className={cn(
                'h-9 px-3 rounded-xl border border-border/60 bg-card/60 backdrop-blur',
                'inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest',
                'text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5',
                'transition-all active:scale-95',
              )}
            >
              <ExternalLink size={13} />
              Landing
            </button>

            <SkillsPopover
              isOnline={isOnline}
              onToggleTheme={handleToggleTheme}
              onToggleFullscreen={handleToggleFullscreen}
              onSyncNow={handleSyncNow}
              onToggleOfflineMode={handleToggleOfflineMode}
              onLogout={() => logout()}
              onTriggerKnowledge={() => navigate('/knowledge')}
            />
          </div>
        </header>

        {/* ===== Bandeau réseau (Round 138) ===== */}
        {backendBanner?.state === 'down' && (
          <div
            role="alert"
            className={cn(
              'mx-4 md:mx-10 mt-3 p-3 md:p-4 rounded-2xl border',
              'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300',
              'flex flex-col md:flex-row md:items-center gap-3',
              'animate-in slide-in-from-top-2 duration-300',
            )}
          >
            <WifiOff size={18} className="shrink-0 animate-pulse" />
            <div className="flex-1 text-xs md:text-sm">
              <strong className="font-black uppercase tracking-wider">Backend injoignable</strong>
              <span className="ml-2 opacity-80">
                URL stockée&nbsp;: <code className="font-mono">{backendBanner.activeUrl}</code>
              </span>
              <div className="text-[11px] opacity-70 mt-0.5">
                Va dans <button
                  type="button"
                  className="underline font-semibold"
                  onClick={() => navigate('/settings?section=backend')}
                >
                  Réglages → Backend
                </button>
                &nbsp;pour la corriger, ou clique « Réinitialiser » pour retomber sur le défaut <code className="font-mono">/api</code>.
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetBackendUrl}
              className="text-[10px] font-black uppercase tracking-widest h-8 px-3"
            >
              Réinitialiser l'URL
            </Button>
          </div>
        )}
        {backendBanner?.state === 'recovered' && (
          <div
            role="status"
            className={cn(
              'mx-4 md:mx-10 mt-3 p-3 rounded-2xl border',
              'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-300',
              'flex items-center gap-3',
              'animate-in slide-in-from-top-2 duration-300',
            )}
          >
            <Wifi size={18} />
            <div className="flex-1 text-xs">
              <strong className="font-black uppercase tracking-wider">Backend rétabli</strong>
              <span className="ml-2 opacity-80">
                -&nbsp;<code className="font-mono">{backendBanner.oldUrl}</code>
                &nbsp;→&nbsp;<code className="font-mono">{backendBanner.activeUrl}</code>
              </span>
            </div>
          </div>
        )}

        {/* ===== Main Outlet ===== */}
        <main className="flex-1 overflow-y-auto p-4 md:p-10 z-20 scroll-smooth pb-32 md:pb-10">
          <div className="max-w-[1400px] mx-auto animate-in fade-in duration-1000">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ===== Mobile Bottom Nav — Floating Dock (visible <md) ===== */}
      {/*
        Floating dock pattern Round 23 — disposition "2 / + / 2" :
          - 2 nav items à gauche   : Overview (Home) + Leadflow
          - 1 FAB QuickAdd au centre (élevé au-dessus du dock)
          - 2 nav items à droite  : Prospects + Chat
          → 5 cellules au total (grid-cols-5).
          Le bouton sidebar (= ouvre le drawer) reste dans le TOPBAR mobile
          (MobileSidebarButton) pour ne pas surcharger le dock.
      */}
      <div
        className="md:hidden fixed inset-x-0 bottom-6 z-50 px-6 pointer-events-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <nav
          className={cn(
            'pointer-events-auto',
            'relative h-14 px-1 mx-auto max-w-sm',
            'rounded-[2rem]',
            'bg-black/40 backdrop-blur-3xl saturate-200',
            'border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)]',
            'ring-1 ring-inset ring-white/5',
            'flex items-center justify-around',
          )}
        >
          {/* Slot 1 : Home */}
          {(() => {
            const item = flatNavItems.find((i) => i.path === '/')!;
            const isActive = location.pathname === item.path;
            return (
              <Link
                to={item.path}
                className={cn(
                  'flex items-center justify-center w-12 h-12 rounded-full relative transition-all duration-300',
                  isActive ? 'text-white' : 'text-white/40 hover:text-white/60',
                )}
              >
                {isActive && (
                  <span className="absolute inset-0 bg-white/10 rounded-full animate-in fade-in zoom-in-75 duration-300" />
                )}
                <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} className="relative z-10" />
              </Link>
            );
          })()}

          {/* Slot 2 : One */}
          {(() => {
            const item = flatNavItems.find((i) => i.path === '/one')!;
            const isActive = location.pathname === item.path;
            return (
              <Link
                to={item.path}
                className={cn(
                  'flex items-center justify-center w-12 h-12 rounded-full relative transition-all duration-300',
                  isActive ? 'text-white' : 'text-white/40 hover:text-white/60',
                )}
              >
                {isActive && (
                  <span className="absolute inset-0 bg-white/10 rounded-full animate-in fade-in zoom-in-75 duration-300" />
                )}
                <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} className="relative z-10" />
              </Link>
            );
          })()}

          {/* Slot 3 : QuickAdd FAB */}
          <div className="flex items-center justify-center -translate-y-4">
            <QuickAdd variant="dock" />
          </div>

          {/* Slot 4 : Prospects */}
          {(() => {
            const item = flatNavItems.find((i) => i.path === '/prospects')!;
            const isActive = location.pathname === item.path;
            return (
              <Link
                to={item.path}
                className={cn(
                  'flex items-center justify-center w-12 h-12 rounded-full relative transition-all duration-300',
                  isActive ? 'text-white' : 'text-white/40 hover:text-white/60',
                )}
              >
                {isActive && (
                  <span className="absolute inset-0 bg-white/10 rounded-full animate-in fade-in zoom-in-75 duration-300" />
                )}
                <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} className="relative z-10" />
              </Link>
            );
          })()}

          {/* Slot 5 : Chat */}
          {(() => {
            const item = flatNavItems.find((i) => i.path === '/chat')!;
            const isActive = location.pathname === item.path;
            return (
              <Link
                to={item.path}
                className={cn(
                  'flex items-center justify-center w-12 h-12 rounded-full relative transition-all duration-300',
                  isActive ? 'text-white' : 'text-white/40 hover:text-white/60',
                )}
              >
                {isActive && (
                  <span className="absolute inset-0 bg-white/10 rounded-full animate-in fade-in zoom-in-75 duration-300" />
                )}
                <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} className="relative z-10" />
              </Link>
            );
          })()}
        </nav>
      </div>
    </div>
  );
}
