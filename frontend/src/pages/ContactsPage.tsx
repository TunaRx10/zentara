/**
 * ContactsPage — Round 24.
 *
 * - Remplace mockContacts par React Query (useContactsQuery).
 * - Boutons câblés : Add Contact → modal → POST /api/contacts · Edit → PUT
 *   · Delete → DELETE optimiste · Filters/Sort → toggles réels.
 */
import React from 'react';
import {
  Search,
  Plus,
  Mail,
  Phone,
  ExternalLink,
  Briefcase,
  MapPin,
  Trash2,
  Edit,
  X,
  Loader2,
  Building2,
  CheckCircle2,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, safeIncludes } from '@/lib/utils';
import {
  TierPill,
  ScoreCell,
  TierFilterChip,
  countByTier,
  getTier,
  type Tier,
} from '@/components/LeadTier';
import {
  useContactsQuery,
} from '@/hooks/useBackendData';
import {
  useCreateContactMutation,
  useUpdateContactMutation,
  useDeleteContactMutation,
} from '@/hooks/useEntityActions';
import { useShowMore } from '@/hooks/useShowMore';
import { useToast } from '@/contexts/ToastProvider';
import { LoadMoreButton } from '@/components/LoadMoreButton';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import type { Contact } from '@/types';

function initialsOf(c: { first_name?: string; last_name?: string }): string {
  return `${c.first_name?.[0] ?? '?'}${c.last_name?.[0] ?? ''}`.toUpperCase();
}

// =====================================================================
// Toast : Round 27 — délégué au ToastProvider global (useToast).
// =====================================================================

// =====================================================================
// AddContactModal
// =====================================================================
function AddContactModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (text: string) => void;
}): React.ReactElement | null {
  const createMut = useCreateContactMutation();
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [role, setRole] = React.useState('');
  const [companyId, setCompanyId] = React.useState('');
  const [linkedinUrl, setLinkedinUrl] = React.useState('');
  React.useEffect(() => {
    if (!open) {
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setRole('');
      setCompanyId('');
      setLinkedinUrl('');
    }
  }, [open]);
  if (!open) return null;
  const valid = firstName.trim().length > 0 && lastName.trim().length > 0;
  const submit = async () => {
    if (!valid) return;
    try {
      await createMut.mutateAsync({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        role: role.trim() || undefined,
        company_id: companyId.trim() || undefined,
        linkedin_url: linkedinUrl.trim() || undefined,
      });
      onCreated(`${firstName} ${lastName} ajouté.`);
      onClose();
    } catch (e) {
      void e;
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !createMut.isPending) onClose();
      }}
    >
      <div className="relative max-w-md w-[calc(100vw-32px)] rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10 p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-black tracking-tight">Nouveau contact</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={createMut.isPending}
            aria-label="Fermer"
            className="h-8 w-8 rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground flex items-center justify-center disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                Prénom *
              </span>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} autoFocus />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                Nom *
              </span>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </label>
          </div>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Rôle
            </span>
            <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Head of Sales" />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Email
            </span>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Téléphone
            </span>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              LinkedIn
            </span>
            <Input
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="linkedin.com/in/..."
            />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Company ID (optionnel)
            </span>
            <Input
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              placeholder="comp_xxxxx"
            />
          </label>
          {createMut.error && (
            <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded-md p-2">
              {(createMut.error as Error).message}
            </div>
          )}
          <div className="flex items-center gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={createMut.isPending} className="flex-1">
              Annuler
            </Button>
            <Button
              onClick={submit}
              disabled={!valid || createMut.isPending}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {createMut.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Plus size={14} className="mr-2" />}
              Ajouter
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// EditContactDialog — prompt() inline pour rester simple (round 24).
// =====================================================================
function EditContactDialog({
  contact,
  onClose,
  onSaved,
}: {
  contact: Contact;
  onClose: () => void;
  onSaved: (text: string) => void;
}): React.ReactElement {
  const [role, setRole] = React.useState(contact.role ?? '');
  const [phone, setPhone] = React.useState(contact.phone ?? '');
  const updateMut = useUpdateContactMutation();
  const submit = async () => {
    try {
      await updateMut.mutateAsync({ id: contact.id, patch: { role, phone } });
      onSaved(`${contact.first_name} ${contact.last_name} mis à jour.`);
      onClose();
    } catch (e) {
      void e;
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !updateMut.isPending) onClose();
      }}
    >
      <div className="relative max-w-md w-[calc(100vw-32px)] rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10 p-4 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-black tracking-tight flex items-center gap-2">
              <Pencil size={18} className="text-primary" /> Modifier le contact
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {contact.first_name} {contact.last_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={updateMut.isPending}
            aria-label="Fermer"
            className="h-8 w-8 rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground flex items-center justify-center disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3">
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Rôle
            </span>
            <Input value={role} onChange={(e) => setRole(e.target.value)} />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
              Téléphone
            </span>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </label>
          {updateMut.error && (
            <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded-md p-2">
              {(updateMut.error as Error).message}
            </div>
          )}
          <div className="flex items-center gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={updateMut.isPending} className="flex-1">
              Annuler
            </Button>
            <Button
              onClick={submit}
              disabled={updateMut.isPending}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {updateMut.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <CheckCircle2 size={14} className="mr-2" />}
              Sauver
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Page principale
// =====================================================================
type SortKey = 'name-asc' | 'name-desc' | 'company' | 'role';

const SORT_OPTIONS: Array<{ id: SortKey; label: string }> = [
  { id: 'name-asc', label: 'Nom A → Z' },
  { id: 'name-desc', label: 'Nom Z → A' },
  { id: 'company', label: 'Société' },
  { id: 'role', label: 'Rôle' },
];

// Score dérivé stratégique : combine rôle (CEO/CTO/Head) + company score.
const ROLE_WEIGHT: Record<string, number> = {
  ceo: 30,
  cto: 28,
  cfo: 25,
  coo: 24,
  vp: 22,
  head: 20,
  director: 18,
  manager: 14,
  lead: 12,
  default: 10,
};
function strategicScore(role: string | undefined, companyScore: number | undefined): number {
  const r = String(role ?? '').toLowerCase();
  let weight = ROLE_WEIGHT.default;
  for (const [k, w] of Object.entries(ROLE_WEIGHT)) {
    if (k !== 'default' && r.includes(String(k))) {
      weight = w;
      break;
    }
  }
  const base = Math.min(95, Math.max(20, weight + Math.round((companyScore ?? 50) * 0.5)));
  return base;
}

export function ContactsPage(): React.ReactElement {
  const queries = useContactsQuery();
  const deleteContact = useDeleteContactMutation();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [tierFilter, setTierFilter] = React.useState<Tier | 'all'>('all');
  const [sortKey, setSortKey] = React.useState<SortKey>('name-asc');
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  const [sortMenuOpen, setSortMenuOpen] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Contact | null>(null);
  const toast = useToast();

  // Synthetic score per row (le backend n'expose pas `score` sur contact).
  const scored: Array<Contact & { _score: number }> = React.useMemo(() => {
    return (queries.data ?? []).map((c) => ({
      ...c,
      _score: strategicScore(c.role, undefined), // 0..95
    }));
  }, [queries.data]);

  const filtered = React.useMemo(() => {
    const q = searchQuery.toLowerCase();
    return scored
      .filter((c) => {
        const matchesQ =
          !q ||
          safeIncludes(`${c.first_name ?? ''} ${c.last_name ?? ''}`, q) ||
          safeIncludes(c.role, q) ||
          safeIncludes(c.email, q);
        const matchesTier = tierFilter === 'all' || getTier(c._score) === tierFilter;
        return matchesQ && matchesTier;
      })
      .sort((a, b) => {
        switch (sortKey) {
          case 'name-asc':
            return `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`);
          case 'name-desc':
            return `${b.first_name} ${b.last_name}`.localeCompare(`${a.first_name} ${a.last_name}`);
          case 'company':
            return (a.company_id ?? '').localeCompare(b.company_id ?? '');
          case 'role':
            return (a.role ?? '').localeCompare(b.role ?? '');
          default:
            return 0;
        }
      });
  }, [scored, searchQuery, tierFilter, sortKey]);

  const counts = React.useMemo(() => countByTier(scored.map((c) => c._score)), [scored]);

  // Round 25 — pagination 5 par « page » via bouton Load more.
  // Reset auto quand searchQuery/tierFilter/sortKey changent.
  const PAGER_STEP = 5;
  const { visible: paged, hasMore, showMore, shown, total: filteredTotal } = useShowMore(
    filtered,
    PAGER_STEP,
  );

  const handleDelete = async (c: Contact) => {
    try {
      await deleteContact.mutateAsync(c.id);
      toast.success(`${c.first_name} ${c.last_name} supprimé.`);
    } catch (e) {
      toast.error(`Suppression impossible : ${(e as Error).message}`);
    }
  };

  // Round 60 — panier de confirmation (remplace les toasts directs).
  const [pendingDelete, setPendingDelete] = React.useState<Contact | null>(null);
  const requestDelete = React.useCallback(
    (c: Contact) => setPendingDelete(c),
    [],
  );
  const cancelDelete = React.useCallback(() => setPendingDelete(null), []);
  const confirmDelete = React.useCallback(async () => {
    if (!pendingDelete) return;
    const c = pendingDelete;
    setPendingDelete(null);
    await deleteContact.mutateAsync(c.id).catch((e: unknown) => { throw e; });
  }, [pendingDelete, deleteContact, toast]);

  return (
    <div className="space-y-5 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Lead Finder
            </span>
            <span className="text-[10px] text-muted-foreground/60">·</span>
            <span className="text-[10px] font-bold text-muted-foreground">
              {scored.length} contacts · {counts.hot} hot · {counts.warm} warm · {counts.cold} cold
            </span>
          </div>
          <h2 className="text-3xl font-black tracking-tight">Contacts</h2>
          <p className="text-muted-foreground">Network management and relationship tracking.</p>
        </div>
        <Button
          onClick={() => setAddOpen(true)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground"
        >
          <Plus className="mr-2 h-4 w-4" /> Add Contact
        </Button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap relative">
        <div className="relative flex-1 min-w-0 sm:min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            placeholder="Search by name, role, or email..."
            className="pl-10 bg-card/60 border-border/60"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          className={cn('border-border/60', (tierFilter !== 'all' || filtersOpen) && 'border-primary/40 text-primary')}
          onClick={() => {
            setFiltersOpen((v) => !v);
            setSortMenuOpen(false);
          }}
          aria-expanded={filtersOpen}
        >
          Filters
          {tierFilter !== 'all' && (
            <span className="ml-1 text-[9px] h-4 px-1 rounded border border-primary/40 text-primary font-bold">
              {tierFilter}
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          className={cn('border-border/60', sortMenuOpen && 'border-primary/40 text-primary')}
          onClick={() => {
            setSortMenuOpen((v) => !v);
            setFiltersOpen(false);
          }}
          aria-expanded={sortMenuOpen}
        >
          {SORT_OPTIONS.find((s) => s.id === sortKey)?.label ?? 'Sort'}
        </Button>
        {filtersOpen && (
          <div className="absolute right-2 top-12 z-40 min-w-[180px] max-w-[calc(100vw-32px)] sm:right-12 rounded-xl border border-border bg-card shadow-2xl shadow-primary/10 p-3 animate-in fade-in slide-in-from-top-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
              Filtre tier (calculé)
            </p>
            <div className="flex flex-col gap-1">
              {(['all', 'hot', 'warm', 'cold'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setTierFilter(id);
                    setFiltersOpen(false);
                  }}
                  className={cn(
                    'text-left text-xs px-2 py-1.5 rounded-md transition-colors capitalize',
                    tierFilter === id ? 'bg-primary/15 text-primary font-bold' : 'hover:bg-secondary/40',
                  )}
                >
                  {id === 'all' ? 'Tous' : id}
                </button>
              ))}
            </div>
          </div>
        )}
        {sortMenuOpen && (
          <div className="absolute right-2 top-12 z-40 min-w-[180px] max-w-[calc(100vw-32px)] sm:right-0 rounded-xl border border-border bg-card shadow-2xl shadow-primary/10 p-3 animate-in fade-in slide-in-from-top-2">
            <p className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground mb-2">
              Trier par
            </p>
            <div className="flex flex-col gap-1">
              {SORT_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSortKey(s.id);
                    setSortMenuOpen(false);
                  }}
                  className={cn(
                    'text-left text-xs px-2 py-1.5 rounded-md transition-colors',
                    sortKey === s.id ? 'bg-primary/15 text-primary font-bold' : 'hover:bg-secondary/40',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tier filter chips */}
      <div className="flex items-center gap-2 flex-wrap" role="group" aria-label="Filter contacts by tier">
        {[
          { id: 'all' as const, label: 'All', count: scored.length, tier: 'all' as const },
          { id: 'hot' as const, label: 'Hot', count: counts.hot, tier: 'hot' as const },
          { id: 'warm' as const, label: 'Warm', count: counts.warm, tier: 'warm' as const },
          { id: 'cold' as const, label: 'Cold', count: counts.cold, tier: 'cold' as const },
        ].map((chip) => (
          <TierFilterChip
            key={chip.id}
            id={chip.id}
            label={chip.label}
            count={chip.count}
            tier={chip.tier}
            active={tierFilter === chip.id}
            onSelect={setTierFilter}
          />
        ))}
      </div>

      {/* Lead Finder table */}
      <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
        {queries.isLoading ? (
          <div className="text-center py-20 text-muted-foreground">
            <Loader2 className="inline animate-spin mr-2" size={16} />
            Loading contacts...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground space-y-3">
            <p>No contacts match these filters. Try widening your search.</p>
            <Button onClick={() => setAddOpen(true)} variant="outline" className="border-primary/40">
              <Plus className="mr-2 h-4 w-4" /> Add the first contact
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-secondary/30 text-[10px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-bold">Contact</th>
                <th className="px-4 py-3 font-bold hidden md:table-cell">Role · Company ID</th>
                <th className="px-4 py-3 font-bold hidden lg:table-cell">Email · Phone</th>
                <th className="px-4 py-3 font-bold">Score</th>
                <th className="px-4 py-3 font-bold">Tier</th>
                <th className="px-4 py-3 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => {
                const t = getTier(c._score);
                return (
                  <tr
                    key={c.id}
                    className={cn('border-t border-border/40 transition-colors group hover:bg-secondary/20')}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            'w-9 h-9 rounded-full flex items-center justify-center text-xs font-black ring-1',
                            t === 'hot'
                              ? 'bg-emerald-500/15 text-emerald-500 ring-emerald-500/30'
                              : t === 'warm'
                                ? 'bg-amber-500/15 text-amber-500 ring-amber-500/30'
                                : 'bg-slate-500/15 text-slate-400 ring-slate-500/30',
                          )}
                        >
                          {initialsOf(c)}
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold truncate">
                            {c.first_name} {c.last_name}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                            {(c as { link?: string }).link ? (
                              <a
                                href={(c as { link?: string }).link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-[#0077b5] inline-flex items-center gap-1"
                              >
                                <ExternalLink size={10} />
                                LinkedIn
                              </a>
                            ) : c.linkedin_url ? (
                              <a
                                href={c.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:text-[#0077b5] inline-flex items-center gap-1"
                              >
                                <ExternalLink size={10} />
                                {c.linkedin_url.replace(/^https?:\/\//, '')}
                              </a>
                            ) : (
                              <span>—</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-1 text-xs font-medium">
                        <Briefcase size={12} className="text-muted-foreground" />
                        {c.role || '—'}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-primary">
                        <Building2 size={11} />
                        <code className="font-mono text-[10px]">{c.company_id ?? '—'}</code>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-1 text-xs">
                        <Mail size={11} className="text-muted-foreground" />
                        <span className="font-medium truncate max-w-[180px]">{c.email ?? '—'}</span>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Phone size={11} />
                        {c.phone ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <ScoreCell score={c._score} />
                    </td>
                    <td className="px-4 py-3">
                      <TierPill tier={t} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {c.email && (
                          <a
                            href={`mailto:${c.email}`}
                            title="Email"
                            aria-label={`Email ${c.first_name}`}
                            className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors"
                          >
                            <Mail size={14} />
                          </a>
                        )}
                        {c.phone && (
                          <a
                            href={`tel:${c.phone.replace(/\s/g, '')}`}
                            title="Call"
                            aria-label={`Call ${c.first_name}`}
                            className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors"
                          >
                            <Phone size={14} />
                          </a>
                        )}
                        {c.linkedin_url && (
                          <a
                            href={c.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open LinkedIn"
                            aria-label={`Open ${c.first_name} on LinkedIn`}
                            className="h-7 w-7 rounded-md text-muted-foreground hover:text-[#0077b5] hover:bg-[#0077b5]/10 flex items-center justify-center transition-colors"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        <button
                          type="button"
                          title="Edit"
                          aria-label={`Edit ${c.first_name}`}
                          onClick={() => setEditing(c)}
                          className="h-7 w-7 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 flex items-center justify-center transition-colors"
                        >
                          <Edit size={14} />
                        </button>
                        <button
                          type="button"
                          title="Delete"
                          aria-label={`Delete ${c.first_name}`}
                          onClick={() => requestDelete(c)}
                          className="h-7 w-7 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {filtered.length > 0 && (
        <div className="text-[11px] text-muted-foreground text-center pt-1">
          Showing {shown} of {filteredTotal} contacts · tri: {SORT_OPTIONS.find((s) => s.id === sortKey)?.label}
        </div>
      )}

      {/* Load more (Round 25) */}
      <div className="flex justify-center">
        <LoadMoreButton
          shown={shown}
          total={filteredTotal}
          step={PAGER_STEP}
          hasMore={hasMore}
          onClick={showMore}
          labelSingular="contact"
          labelPlural="contacts"
        />
      </div>

      {/* Modal & edit dialog */}
      <AddContactModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(text) => toast.success(text)}
      />
      {editing && (
        <EditContactDialog
          contact={editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => toast.success(text)}
        />
      )}
      {/* Round 27 — toast viewport global monté dans ToastProvider (App.tsx) */}

      {/* Round 60 — confirmation modale de suppression */}
      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) cancelDelete(); }}
        itemLabel={
          pendingDelete
            ? `${pendingDelete.first_name} ${pendingDelete.last_name}`.trim()
            : ''
        }
        entityLabel="contact"
        meta={
          pendingDelete
            ? `${pendingDelete.role ?? '—'}${
                pendingDelete.company_id ? ' · ' + pendingDelete.company_id : ''
              }${
                pendingDelete.email ? ' · ' + pendingDelete.email : ''
              }`
            : undefined
        }
        cascades={[
          'Notes internes et historiques rattachés restent en base',
          'Inscriptions aux campagnes seront orphelines (FK non cascadée)',
        ]}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
