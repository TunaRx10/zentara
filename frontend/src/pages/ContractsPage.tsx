/**
 * ContractsPage — Round 49.
 *
 * Liste + manual generation + status update + download .md
 * pour les contrats AI-générés (NDA / QUOTE / TOS).
 *
 * Aligné sur backend/src/modules/contracts/* :
 *   - types UPPERCASE ('NDA' | 'QUOTE' | 'TOS')
 *   - status: 'draft' | 'pending_signature' | 'signed' | 'rejected' | 'superseded'
 *   - POST /api/contracts/generate  (cf. schema.generateContractSchema)
 *   - PATCH /api/contracts/:id/status
 *
 * Données 100% backend — aucun mock.
 */
import React from 'react';import { FileText,
  Plus,
  Loader2,
  Filter,
  Eye,
  Download,
  ShieldCheck,
  Briefcase,
  Scale,
  AlertCircle,
  Sparkles,
  Search,
  Check,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/contexts/ToastProvider';
import { DeleteConfirmDialog } from '@/components/DeleteConfirmDialog';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import { ZentaraApiError, getApiClient } from '@/services/api/client';
import { ENDPOINTS } from '@/services/api/endpoints';
import { useCompaniesQuery } from '@/hooks/useBackendData';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn, safeIncludes, safeString, toDateMs } from '@/lib/utils';

// =====================================================================
// Types — alignés sur backend/src/modules/contracts/types.ts
// =====================================================================

export type ContractType = 'NDA' | 'QUOTE' | 'TOS';
export type ContractStatus =
  | 'draft'
  | 'pending_signature'
  | 'signed'
  | 'rejected'
  | 'superseded';

interface ContractRecord {
  id: string;
  type: ContractType;
  status: ContractStatus;
  title: string;
  body: string;
  party_a_id: string | null;
  party_b_id: string | null;
  party_b_kind: 'company' | 'prospect' | null;
  party_b_name: string | null;
  party_b_email: string | null;
  product_ref: string | null;
  variables: Record<string, string | number | boolean | null> | null;
  created_via: 'manual' | 'auto-hot-signal' | string;
  source_task_id: string | null;
  source_signal_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
  signed_at: string | null;
}

interface ZentaraProduct {
  key: string;
  name: string;
  description: string;
  monthly_price_eur: number;
  commitment_months: number;
  included_modules: string[];
}

const TYPE_META: Record<ContractType, { label: string; icon: React.ReactNode; color: string }> = {
  NDA: {
    label: 'NDA',
    icon: <ShieldCheck size={12} />,
    color: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  },
  QUOTE: {
    label: 'Proposition commerciale',
    icon: <Briefcase size={12} />,
    color: 'bg-blue-500/15 text-blue-500 border-blue-500/30',
  },
  TOS: {
    label: "Conditions d'utilisation",
    icon: <Scale size={12} />,
    color: 'bg-purple-500/15 text-purple-500 border-purple-500/30',
  },
};

const STATUS_META: Record<ContractStatus, { label: string; color: string }> = {
  draft: { label: 'Brouillon', color: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30' },
  pending_signature: {
    label: 'En attente signature',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  signed: { label: 'Signé', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  rejected: { label: 'Refusé', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  superseded: { label: 'Remplacé', color: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30' },
};

// =====================================================================
// Helpers
// =====================================================================

function friendlyError(e: unknown): string {
  if (e instanceof ZentaraApiError) {
    if (e.code === 'NETWORK_UNAVAILABLE' || e.code === 'TIMEOUT') {
      return 'Backend injoignable — vérifie le service (port 4000).';
    }
    if (e.code === 'RATE_LIMITED') return 'Trop de requêtes — réessaie dans 30s.';
    return `[${e.code}] ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return 'Erreur inconnue.';
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = toDateMs(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

// =====================================================================
// Hooks
// =====================================================================

function useContractsQuery(type?: ContractType | 'all', status?: ContractStatus | 'all') {
  return useQuery<ContractRecord[], Error>({
    queryKey: ['contracts', 'list', type ?? 'all', status ?? 'all'],
    queryFn: async ({ signal }) => {
      const api = getApiClient();
      const query: Record<string, string> = {};
      if (type && type !== 'all') query['type'] = type;
      if (status && status !== 'all') query['status'] = status;
      const raw = await api.get<ContractRecord[] | { data: ContractRecord[] }>(
        ENDPOINTS.contractsList,
        { signal, query },
      );
      const data = 'data' in raw
        ? (raw as { data: ContractRecord[] }).data
        : (raw as ContractRecord[]);
      return Array.isArray(data) ? data : [];
    },
    staleTime: 15_000,
  });
}

function useCatalogQuery() {
  return useQuery<ZentaraProduct[], Error>({
    queryKey: ['contracts', 'catalog'],
    queryFn: async ({ signal }) => {
      const api = getApiClient();
      const raw = await api.get<ZentaraProduct[] | { data: ZentaraProduct[] }>(
        ENDPOINTS.contractsCatalog,
        { signal },
      );
      const data = 'data' in raw
        ? (raw as { data: ZentaraProduct[] }).data
        : (raw as ZentaraProduct[]);
      return Array.isArray(data) ? data : [];
    },
    staleTime: 5 * 60_000,
  });
}

function useUpdateContractStatusMutation() {
  const qc = useQueryClient();
  return useMutation<ContractRecord, Error, { id: string; status: ContractStatus; notes?: string }>({
    mutationFn: async ({ id, status, notes }) => {
      const api = getApiClient();
      const raw = await api.post<ContractRecord | { data: ContractRecord }>(
        ENDPOINTS.contractsUpdateStatus(id),
        { status, notes: notes ?? null },
      );
      return ('data' in raw ? raw.data : raw) as ContractRecord;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contracts'] });
    },
  });
}

// =====================================================================
// Page
// =====================================================================

export function ContractsPage() {
  const { isOnline } = useNetworkStatus();
  const toast = useToast();
  const [typeFilter, setTypeFilter] = React.useState<ContractType | 'all'>('all');
  const [statusFilter, setStatusFilter] = React.useState<ContractStatus | 'all'>('all');
  const [search, setSearch] = React.useState('');
  const [modalOpen, setModalOpen] = React.useState(false);
  const [viewing, setViewing] = React.useState<ContractRecord | null>(null);

  const { data: contracts = [], isLoading, refetch, error } = useContractsQuery(
    typeFilter,
    statusFilter,
  );

  const filtered = React.useMemo(() => {
    const q = safeString(search).trim();
    if (!q) return contracts;
    return contracts.filter((c) => {
      const hay = [c.title, c.party_b_name, c.body, c.type, c.status]
        .map(safeString)
        .join(' ')
        .toLowerCase();
      return safeIncludes(hay, q);
    });
  }, [contracts, search]);

  const updateStatus = useUpdateContractStatusMutation();
  const qc = useQueryClient();

  // Round 60 — suppression d'un contrat.
  const deleteContractMut = useMutation<{ id: string; deleted: boolean }, Error, string>({
    mutationFn: async (id: string) => {
      const api = getApiClient();
      await api.delete<unknown>(ENDPOINTS.contractById(id));
      return { id, deleted: true };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contracts'] });
    },
  });

  const [pendingDelete, setPendingDelete] = React.useState<ContractRecord | null>(null);
  const openReject = React.useCallback((c: ContractRecord) => setPendingDelete(c), []);
  const cancelReject = React.useCallback(() => setPendingDelete(null), []);
  const confirmRejectOrDelete = React.useCallback(async () => {
    if (!pendingDelete) return;
    const c = pendingDelete;
    setPendingDelete(null);
    await deleteContractMut.mutateAsync(c.id).catch((e: unknown) => {
      toast.error(friendlyError(e));
      throw e;
    });
  }, [pendingDelete, deleteContractMut, toast]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="text-amber-500" size={22} />
            Contracts
          </h1>
          <p className="text-sm text-zinc-500 mt-1">
            NDA, propositions commerciales signables, ToS Zentara. Générés par IA, versionnés, modifiables.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <Loader2 size={14} className={isLoading ? 'animate-spin mr-2' : 'mr-2'} />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => setModalOpen(true)}
            disabled={!isOnline}
            className="bg-amber-500 hover:bg-amber-600 text-black"
          >
            <Plus size={14} className="mr-2" /> Générer un contrat
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Filter size={12} /> Type
          </div>
          <div className="flex gap-1">
            {(['all', 'NDA', 'QUOTE', 'TOS'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={cn(
                  'px-3 py-1 rounded-md text-xs border transition',
                  typeFilter === t
                    ? 'bg-amber-500 text-black border-amber-500'
                    : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800',
                )}
              >
                {t === 'all' ? 'Tous' : TYPE_META[t as ContractType].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500 ml-4">
            <Filter size={12} /> Statut
          </div>
          <div className="flex gap-1">
            {(['all', 'draft', 'pending_signature', 'signed', 'rejected', 'superseded'] as const).map(
              (s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    'px-3 py-1 rounded-md text-xs border transition',
                    statusFilter === s
                      ? 'bg-amber-500 text-black border-amber-500'
                      : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:bg-zinc-800',
                  )}
                >
                  {s === 'all' ? 'Tous' : STATUS_META[s as ContractStatus].label}
                </button>
              ),
            )}
          </div>
          <div className="ml-auto relative max-w-xs">
            <Search
              size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500"
            />
            <Input
              placeholder="Filtrer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 text-xs pl-7 max-w-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* State messages */}
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          {friendlyError(error)}
        </div>
      )}

      {/* List */}
      {isLoading && contracts.length === 0 ? (
        <div className="text-center py-16 text-zinc-500 text-sm">
          <Loader2 className="animate-spin inline mr-2" size={14} />
          Chargement des contrats…
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-zinc-500">
            <FileText className="mx-auto mb-2 text-zinc-500" size={28} />
            Aucun contrat. Clique sur <span className="text-amber-500">"Générer un contrat"</span> pour
            en créer un nouveau.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((c) => (
            <ContractRow
              key={c.id}
              contract={c}
              onView={() => setViewing(c)}
              onMarkSent={async () => {
                try {
                  await updateStatus.mutateAsync({ id: c.id, status: 'pending_signature' });
                  toast.success('Statut → En attente signature');
                } catch (e) {
                  toast.error(friendlyError(e));
                }
              }}
              onMarkSigned={async () => {
                try {
                  await updateStatus.mutateAsync({ id: c.id, status: 'signed' });
                  toast.success('Statut → Signé');
                } catch (e) {
                  toast.error(friendlyError(e));
                }
              }}
              onReject={async () => {
                try {
                  await updateStatus.mutateAsync({ id: c.id, status: 'rejected' });
                  toast.success('Statut → Refusé');
                } catch (e) {
                  toast.error(friendlyError(e));
                }
              }}
              onRequestDelete={() => openReject(c)}
            />
          ))}
        </div>
      )}

      {/* Modal + viewer */}
      {modalOpen && (
        <GenerateContractModal
          onClose={() => setModalOpen(false)}
          onCreated={(r) => {
            setModalOpen(false);
            void refetch();
            setViewing(r);
          }}
          onError={(e) => toast.error(friendlyError(e))}
        />
      )}
      {viewing && <ContractViewer contract={viewing} onClose={() => setViewing(null)} />}

      <DeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => { if (!o) cancelReject(); }}
        itemLabel={pendingDelete?.title ?? ''}
        entityLabel="contrat"
        meta={
          pendingDelete
            ? `${pendingDelete.type} · ${pendingDelete.status}${
                pendingDelete.product_ref ? ' · ' + pendingDelete.product_ref : ''
              }`
            : undefined
        }
        cascades={[
          'Action irréversible — régénérer demandera un nouveau AI generate',
          'Liens depuis contacts / entreprises seront désynchronisés (FK orphelines)',
        ]}
        onConfirm={confirmRejectOrDelete}
      />
    </div>
  );
}

// =====================================================================
// Row
// =====================================================================

function ContractRow({
  contract,
  onView,
  onMarkSent,
  onMarkSigned,
  onReject,
  onRequestDelete,
}: {
  contract: ContractRecord;
  onView: () => void;
  onMarkSent: () => void;
  onMarkSigned: () => void;
  onReject: () => void;
  onRequestDelete: () => void;
}) {
  const tm = TYPE_META[contract.type] ?? TYPE_META.NDA;
  const sm = STATUS_META[contract.status] ?? STATUS_META.draft;
  return (
    <Card className="hover:border-amber-500/30 transition">
      <CardContent className="pt-4 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px]', tm.color)}>
              {tm.icon}
              <span className="ml-1">{tm.label}</span>
            </Badge>
            <Badge variant="outline" className={cn('text-[10px]', sm.color)}>
              {sm.label}
            </Badge>
            {contract.created_via === 'auto-hot-signal' && (
              <Badge
                variant="outline"
                className="text-[10px] bg-purple-500/10 text-purple-400 border-purple-500/30"
              >
                <Sparkles size={10} className="mr-1" /> Auto-draft
              </Badge>
            )}
            <h3 className="font-semibold text-sm truncate">{contract.title}</h3>
          </div>
          <div className="text-xs text-zinc-500 flex gap-3 flex-wrap">
            <span>
              Pour :{' '}
              <b className="text-zinc-300">
                {safeString(contract.party_b_name) || safeString(contract.party_b_id) || '—'}
              </b>
            </span>
            {contract.product_ref && (
              <span>
                Produit : <b className="text-zinc-300">{contract.product_ref}</b>
              </span>
            )}
            <span>Créé : {fmtDate(contract.created_at)}</span>
            <span>· Modifié : {fmtDate(contract.updated_at)}</span>
            {contract.signed_at && <span>· Signé : {fmtDate(contract.signed_at)}</span>}
          </div>
          <div className="text-[10px] text-zinc-400 mt-1 line-clamp-1">
            {safeString(contract.body).slice(0, 240)}…
          </div>
        </div>
        <div className="flex gap-1 shrink-0 flex-wrap justify-end">
          <Button size="sm" variant="outline" onClick={onView}>
            <Eye size={14} className="mr-1" /> Voir
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadContract(contract)}
            title="Télécharger en Markdown"
          >
            <Download size={14} />
          </Button>
          {contract.status === 'draft' && (
            <Button
              size="sm"
              variant="outline"
              onClick={onMarkSent}
              className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
            >
              <Sparkles size={14} className="mr-1" /> Envoyer
            </Button>
          )}
          {(contract.status === 'draft' || contract.status === 'pending_signature') && (
            <Button
              size="sm"
              variant="outline"
              onClick={onMarkSigned}
              className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
            >
              <Check size={14} className="mr-1" /> Signer
            </Button>
          )}
          {(contract.status === 'draft' || contract.status === 'pending_signature') && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRequestDelete}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
              title="Marquer comme refusé ou supprimer"
            >
              <Trash2 size={14} />
            </Button>
          )}
          {(contract.status === 'draft' || contract.status === 'pending_signature') && (
            <Button
              size="sm"
              variant="outline"
              onClick={onReject}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              ✕
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// =====================================================================
// Modal — Generate contract
// =====================================================================

function GenerateContractModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (r: ContractRecord) => void;
  onError: (e: unknown) => void;
}) {
  const { data: companies = [] } = useCompaniesQuery();
  const { data: products = [] } = useCatalogQuery();
  const [type, setType] = React.useState<ContractType>('NDA');
  const [partyBKind, setPartyBKind] = React.useState<'company' | 'prospect'>('prospect');
  const [partyBId, setPartyBId] = React.useState<string>('');
  const [partyBName, setPartyBName] = React.useState('');
  const [partyBEmail, setPartyBEmail] = React.useState('');
  const [productRef, setProductRef] = React.useState<string>('');
  const [context, setContext] = React.useState('');
  const [simulate, setSimulate] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (type === 'QUOTE' && products.length > 0 && !productRef) {
      setProductRef(products[0].key);
    }
  }, [type, products, productRef]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const api = getApiClient();
      const body: Record<string, unknown> = {
        type,
        party_b_kind: partyBKind,
        party_b_id: partyBId || undefined,
        party_b_name: safeString(partyBName).trim() || undefined,
        party_b_email: safeString(partyBEmail).trim() || undefined,
        product_ref: type === 'TOS' ? undefined : productRef || undefined,
        context: safeString(context).trim() || undefined,
        simulate,
        persist: true,
      };
      // Backend renvoie { success: true, data: { contract, ... }, meta }
      const resp = await api.post<{ data: { contract: ContractRecord } } | { contract: ContractRecord }>(
        ENDPOINTS.contractsGenerate,
        body,
        { timeoutMs: 60_000 },
      );
      const raw = resp as { data?: { contract?: ContractRecord } } & { contract?: ContractRecord };
      const item = (raw.data?.contract ?? raw.contract) as ContractRecord;
      onCreated(item);
    } catch (e) {
      onError(e);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl w-[calc(100vw-32px)] max-w-lg shadow-2xl max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="font-bold flex items-center gap-2">
            <Sparkles className="text-amber-500" size={18} />
            Générer un contrat (IA)
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">
            ✕
          </button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Type de contrat</label>
            <div className="grid grid-cols-3 gap-2">
              {(['NDA', 'QUOTE', 'TOS'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={cn(
                    'p-3 rounded-lg border text-xs',
                    type === t
                      ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700',
                  )}
                >
                  <div className="flex justify-center mb-1">{TYPE_META[t].icon}</div>
                  {TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Type de partie B</label>
            <div className="flex gap-2">
              {(['prospect', 'company'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setPartyBKind(k)}
                  className={cn(
                    'flex-1 p-2 rounded-md border text-xs',
                    partyBKind === k
                      ? 'bg-amber-500/20 border-amber-500 text-amber-400'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700',
                  )}
                >
                  {k === 'prospect' ? 'Prospect (lead)' : 'Company (compte)'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Destinataire</label>
            <div className="space-y-2">
              <select
                value={partyBId}
                onChange={(e) => setPartyBId(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs"
              >
                <option value="">— Aucun (saisie libre) —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  placeholder="Nom (si pas en base)"
                  value={partyBName}
                  onChange={(e) => setPartyBName(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  placeholder="Email (optionnel)"
                  type="email"
                  value={partyBEmail}
                  onChange={(e) => setPartyBEmail(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>
          {type === 'QUOTE' && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Produit Zentara</label>
              {products.length > 0 ? (
                <select
                  value={productRef}
                  onChange={(e) => setProductRef(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs"
                >
                  {products.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.name} ({p.monthly_price_eur}€/mois)
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  placeholder="Clé produit"
                  value={productRef}
                  onChange={(e) => setProductRef(e.target.value)}
                  className="h-8 text-xs"
                />
              )}
            </div>
          )}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Contexte (optionnel)</label>
            <textarea
              value={context}
              onChange={(e) => setContext(e.target.value)}
              rows={4}
              placeholder="Secteur, taille, deal en cours, urgence…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-md px-3 py-2 text-xs"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={simulate}
              onChange={(e) => setSimulate(e.target.checked)}
              className="accent-amber-500"
            />
            Mode démo (fallback template pur, sans LLM)
          </label>
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2 text-xs text-amber-400 flex gap-2">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span>
              Contrat <b>brouillon</b>. Tu pourras le télécharger en <code>.md</code>, l'envoyer
              (status → <b>pending_signature</b>) et le marquer <b>signé</b>.
            </span>
          </div>
        </div>
        <div className="p-4 border-t border-zinc-800 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={submitting}
            className="bg-amber-500 hover:bg-amber-600 text-black"
          >
            {submitting ? (
              <Loader2 size={14} className="animate-spin mr-2" />
            ) : (
              <Sparkles size={14} className="mr-2" />
            )}
            Générer
          </Button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Viewer
// =====================================================================

function ContractViewer({
  contract,
  onClose,
}: {
  contract: ContractRecord;
  onClose: () => void;
}) {
  const updateStatus = useUpdateContractStatusMutation();
  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-800 rounded-xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold">{contract.title}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {TYPE_META[contract.type]?.label} —{' '}
              <b
                className={cn(
                  STATUS_META[contract.status]?.color,
                  'px-1.5 rounded',
                )}
              >
                {STATUS_META[contract.status]?.label}
              </b>
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => downloadContract(contract)}>
              <Download size={14} className="mr-1" /> .md
            </Button>
            {contract.status === 'draft' && (
              <Button
                size="sm"
                variant="outline"
                disabled={updateStatus.isPending}
                onClick={async () => {
                  try {
                    await updateStatus.mutateAsync({
                      id: contract.id,
                      status: 'pending_signature',
                    });
                  } catch (_e) {
                    void _e;
                  }
                }}
              >
                <Sparkles size={14} className="mr-1" /> Envoyer
              </Button>
            )}
            {(contract.status === 'draft' || contract.status === 'pending_signature') && (
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                disabled={updateStatus.isPending}
                onClick={async () => {
                  try {
                    await updateStatus.mutateAsync({ id: contract.id, status: 'signed' });
                  } catch (_e) {
                    void _e;
                  }
                }}
              >
                <Check size={14} className="mr-1" /> Signer
              </Button>
            )}
            <button onClick={onClose} className="text-zinc-500 hover:text-white px-2">
              ✕
            </button>
          </div>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <pre className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-300 font-mono">
            {safeString(contract.body)}
          </pre>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Utils
// =====================================================================

function downloadContract(c: ContractRecord): void {
  const meta =
    `# ${c.title}\n\n` +
    `**Type:** ${c.type}  \n` +
    `**Statut:** ${c.status}  \n` +
    `**Pour:** ${safeString(c.party_b_name) || '—'}  \n` +
    `**Produit:** ${safeString(c.product_ref) || '—'}  \n` +
    `**Créé le:** ${safeString(c.created_at)}  \n\n` +
    `---\n\n`;
  const blob = new Blob([meta + safeString(c.body)], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${c.type.toLowerCase()}-${c.id.slice(0, 8)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
