/**
 * AddProspectModal — Modal de création de prospect avec auto-fill contacts.
 *
 * Round X — auto-fill :
 *   - Recherche de contacts existants par nom/email pendant la saisie
 *   - Suggestion de contacts déjà en base pour éviter les doublons
 *   - Pré-remplissage automatique email/téléphone/role si contact trouvé
 *   - Secteur intelligent basé sur le nom de l'entreprise
 *   - Détection de doublons potentiels
 */
import React from 'react';
import { X, Loader2, Plus, UserPlus, AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCreateProspectMutation } from '@/hooks/useEntityActions';
import { useToast } from '@/contexts/ToastProvider';
import { useContactsQuery } from '@/hooks/useBackendData';
import { cn } from '@/lib/utils';
import type { Contact } from '@/types';

interface AddProspectModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Secteurs suggérés automatiquement selon le nom de l'entreprise.
 * Détection par mots-clés simples (heuristique locale).
 */
function guessSector(company: string): string | null {
  if (!company.trim()) return null;
  const c = company.toLowerCase();
  if (c.includes('tech') || c.includes('software') || c.includes('digital') || c.includes('cloud') || c.includes('data')) return 'SaaS / Tech';
  if (c.includes('finance') || c.includes('bank') || c.includes('assur') || c.includes('capital')) return 'Finance / Assurance';
  if (c.includes('health') || c.includes('med') || c.includes('pharma') || c.includes('santé')) return 'Santé / Pharma';
  if (c.includes('immo') || c.includes('property') || c.includes('construction') || c.includes('batiment')) return 'Immobilier / Construction';
  if (c.includes('market') || c.includes('pub') || c.includes('agency') || c.includes('agence')) return 'Marketing / Communication';
  if (c.includes('legal') || c.includes('law') || c.includes('avocat') || c.includes('cabinet')) return 'Juridique / Conseil';
  if (c.includes('retail') || c.includes('shop') || c.includes('store') || c.includes('vente')) return 'Retail / E-commerce';
  if (c.includes('educ') || c.includes('school') || c.includes('formation') || c.includes('univers')) return 'Éducation / Formation';
  if (c.includes('industr') || c.includes('manufact') || c.includes('fabr') || c.includes('usine')) return 'Industrie / Manufacturing';
  if (c.includes('consult') || c.includes('conseil') || c.includes('strategy')) return 'Conseil / Stratéie';
  return null;
}

export function AddProspectModal({ open, onClose, onCreated }: AddProspectModalProps): React.ReactElement | null {
  const createMut = useCreateProspectMutation();
  const { data: contacts = [] } = useContactsQuery();
  const toast = useToast();
  
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [sector, setSector] = React.useState('');
  const [city, setCity] = React.useState('');
  const [country, setCountry] = React.useState('');
  const [companyName, setCompanyName] = React.useState('');
  const [role, setRole] = React.useState('');
  
  // Auto-fill state
  const [suggestions, setSuggestions] = React.useState<Contact[]>([]);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [duplicateWarning, setDuplicateWarning] = React.useState<string | null>(null);
  const [autoFilled, setAutoFilled] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    if (!open) {
      setFirstName('');
      setLastName('');
      setEmail('');
      setPhone('');
      setSector('');
      setCity('');
      setCountry('');
      setCompanyName('');
      setRole('');
      setSuggestions([]);
      setShowSuggestions(false);
      setDuplicateWarning(null);
      setAutoFilled({});
    }
  }, [open]);

  if (!open) return null;

  const valid = firstName.trim().length > 0 && lastName.trim().length > 0;

  // Recherche de contacts similaires (auto-fill)
  const searchContacts = React.useCallback(
    (fn: string, ln: string) => {
      if (fn.trim().length < 2 && ln.trim().length < 2) {
        setSuggestions([]);
        setShowSuggestions(false);
        setDuplicateWarning(null);
        return;
      }
      const fnLower = fn.toLowerCase();
      const lnLower = ln.toLowerCase();
      
      const matches = contacts.filter((c) => {
        const cFn = (c.first_name ?? '').toLowerCase();
        const cLn = (c.last_name ?? '').toLowerCase();
        return (
          (fnLower && cFn.includes(fnLower)) ||
          (lnLower && cLn.includes(lnLower)) ||
          (fnLower && lnLower && (cFn + ' ' + cLn).includes(fnLower + ' ' + lnLower))
        );
      });

      setSuggestions(matches);
      setShowSuggestions(matches.length > 0);

      // Détection de doublon exact
      const exactDuplicate = matches.find(
        (c) => c.first_name.toLowerCase() === fnLower && c.last_name.toLowerCase() === lnLower
      );
      if (exactDuplicate) {
        setDuplicateWarning(`Un contact existe déjà : ${exactDuplicate.first_name} ${exactDuplicate.last_name}${exactDuplicate.role ? ` (${exactDuplicate.role})` : ''}`);
      } else {
        setDuplicateWarning(null);
      }
    },
    [contacts]
  );

  // Suggestion de secteur basée sur l'entreprise
  React.useEffect(() => {
    const guessed = guessSector(companyName);
    if (guessed && !sector) {
      setSector(guessed);
      setAutoFilled((prev) => ({ ...prev, sector: true }));
    }
  }, [companyName, sector]);

  const handleFirstNameChange = (v: string) => {
    setFirstName(v);
    searchContacts(v, lastName);
  };

  const handleLastNameChange = (v: string) => {
    setLastName(v);
    searchContacts(firstName, v);
  };

  // Appliquer un contact suggéré (auto-fill)
  const applyContact = (contact: Contact) => {
    if (contact.email && !email) {
      setEmail(contact.email);
      setAutoFilled((prev) => ({ ...prev, email: true }));
    }
    if (contact.phone && !phone) {
      setPhone(contact.phone);
      setAutoFilled((prev) => ({ ...prev, phone: true }));
    }
    if (contact.role && !role) {
      setRole(contact.role);
      setAutoFilled((prev) => ({ ...prev, role: true }));
    }
    if (contact.company_id && !companyName) {
      setCompanyName(contact.company_id);
      setAutoFilled((prev) => ({ ...prev, companyName: true }));
    }
    setShowSuggestions(false);
    setSuggestions([]);
    toast.success(`Informations pré-remplies depuis ${contact.first_name} ${contact.last_name}`);
  };

  const handleSubmit = async () => {
    if (!valid) return;
    try {
      await createMut.mutateAsync({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        sector: sector.trim() || undefined,
        city: city.trim() || undefined,
        country: country.trim() || undefined,
        company_name: companyName.trim() || undefined,
        role: role.trim() || undefined,
        status: 'new',
      });
      onCreated();
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
          <div>
            <h2 className="text-xl font-black tracking-tight">Nouveau prospect</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Renseignes le minimum. Les champs marqués ⚡ sont auto-remplis.
            </p>
          </div>
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
        
        {/* Alerte doublon */}
        {duplicateWarning && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-400">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{duplicateWarning}</span>
          </div>
        )}
        
        <div className="space-y-3">
          {/* Nom + Prénom avec auto-fill */}
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                Prénom *
              </span>
              <Input
                value={firstName}
                onChange={(e) => handleFirstNameChange(e.target.value)}
                placeholder="Jean"
                autoFocus
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                Nom *
              </span>
              <Input
                value={lastName}
                onChange={(e) => handleLastNameChange(e.target.value)}
                placeholder="Dupont"
              />
            </label>
          </div>

          {/* Suggestions de contacts (auto-fill) */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="rounded-lg border border-border bg-card/60 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/50 bg-secondary/20">
                <Search size={12} className="text-muted-foreground" />
                <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                  Contact(s) trouvé(s) — clique pour pré-remplir
                </span>
              </div>
              <div className="max-h-32 overflow-y-auto">
                {suggestions.slice(0, 5).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => applyContact(c)}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-primary/5 transition-colors border-b border-border/30 last:border-b-0"
                  >
                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">
                      {`${c.first_name?.[0] ?? '?'}${c.last_name?.[0] ?? ''}`.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold truncate">
                        {c.first_name} {c.last_name}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {c.role && <span>{c.role} · </span>}
                        {c.email && <span>{c.email}</span>}
                        {!c.email && !c.role && <span>Pas d'email</span>}
                      </div>
                    </div>
                    <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Email et Téléphone (auto-fill) */}
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1">
              Email
              {autoFilled.email && <span className="text-emerald-500 normal-case tracking-normal">⚡ auto</span>}
            </span>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jean@acme.com"
            />
          </label>
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1">
              Téléphone
              {autoFilled.phone && <span className="text-emerald-500 normal-case tracking-normal">⚡ auto</span>}
            </span>
            <Input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+33 6 12 34 56 78"
            />
          </label>

          {/* Rôle et Entreprise */}
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1">
                Rôle
                {autoFilled.role && <span className="text-emerald-500 normal-case tracking-normal">⚡ auto</span>}
              </span>
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="CEO" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1">
                Entreprise
                {autoFilled.companyName && <span className="text-emerald-500 normal-case tracking-normal">⚡ auto</span>}
              </span>
              <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Corp" />
            </label>
          </div>

          {/* Secteur (auto-détecté) */}
          <label className="space-y-1 block">
            <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1">
              Secteur
              {autoFilled.sector && <span className="text-emerald-500 normal-case tracking-normal">⚡ auto-détecté</span>}
            </span>
            <Input value={sector} onChange={(e) => setSector(e.target.value)} placeholder="SaaS B2B" />
          </label>

          {/* Ville et Pays */}
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                Ville
              </span>
              <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Paris" />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                Pays
              </span>
              <Input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="France" />
            </label>
          </div>

          {createMut.error && (
            <div className="text-xs text-red-500 bg-red-500/10 border border-red-500/30 rounded-md p-2">
              {(createMut.error as Error).message}
            </div>
          )}
          
          <div className="flex items-center gap-2 pt-2">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={createMut.isPending}
              className="flex-1 border-border"
            >
              Annuler
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!valid || createMut.isPending}
              className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {createMut.isPending ? (
                <>
                  <Loader2 size={14} className="mr-2 animate-spin" />
                  Création…
                </>
              ) : (
                <>
                  <Plus size={14} className="mr-2" />
                  Ajouter
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
