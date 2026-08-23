/**
 * SettingsPage — centre de configuration Zentara (Round 23).
 *
 * Sections :
 *   1. Profile    — info user courant depuis AuthContext (lecture seule).
 *   2. Security   — PIN length, toggle biométrie (si dispo sur web).
 *   3. Appearance — bascule dark/light persistée en localStorage.
 *   4. Data       — Export table CSV via /api/admin/export, restore JSON
 *                    dump depuis file picker, Wipe All avec confirm modal.
 *   5. AI         — status provider (lecture seule depuis /api/admin/health).
 *   6. Integrations — état Google + Maps depuis /api/admin/health.
 *
 * Chaque section est wrappée dans son propre card (les 3 cartes du
 * milieu sont celles avec des actions).
 */
import React from 'react';
import {
  User as UserIcon,
  Shield,
  Palette,
  Database,
  Zap,
  Link as LinkIcon,
  Info,
  Download,
  Upload,
  Trash2,
  Moon,
  Sun,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Settings as SettingsIcon,
  Lock,
  Sparkles,
  ExternalLink,
  BookOpen,
  Sheet,
  CloudUpload,
  Plug,
  Save,
  Calendar,
  MailPlus,
  KeyRound,
  Users,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { getApiClient, getApiBase, probeBackend, setApiBase } from '@/services/api/client';
import { useAuth } from '@/services/auth/auth.context';

type SectionId = 'profile' | 'security' | 'appearance' | 'data' | 'ai' | 'integrations' | 'apiKeys' | 'linkedin' | 'sheets' | 'outreach' | 'backend';

const VALID_SECTIONS: ReadonlySet<SectionId> = new Set<SectionId>([
  'profile', 'security', 'appearance', 'data', 'ai', 'integrations',
  'apiKeys', 'linkedin', 'sheets', 'outreach', 'backend',
]);

// =====================================================================
// Side nav (sticky à gauche sur desktop, en haut sur mobile)
// =====================================================================

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ReactNode; desc: string }> = [
  { id: 'profile', label: 'Profile', icon: <UserIcon size={16} />, desc: 'Ton profil d\'utilisateur.' },
  { id: 'security', label: 'Security', icon: <Shield size={16} />, desc: 'PIN, biométrie, verrou.' },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} />, desc: 'Thème et densité visuelle.' },
  { id: 'data', label: 'Data', icon: <Database size={16} />, desc: 'Export / import / wipe local.' },
  { id: 'ai', label: 'AI', icon: <Zap size={16} />, desc: 'Provider & modèles.' },
  { id: 'integrations', label: 'Integrations', icon: <LinkIcon size={16} />, desc: 'Google, Maps, providers externes.' },
  { id: 'apiKeys', label: 'API Keys', icon: <KeyRound size={16} />, desc: 'Clés AI + OpenCorporates, Google Maps, SerpAPI.' },
  { id: 'linkedin', label: 'LinkedIn', icon: <Users size={16} />, desc: 'Identifiants de scraping (StaffSpy).' },
  { id: 'sheets', label: 'Sheets Sync', icon: <Sheet size={16} />, desc: 'Push Zentara vers Google Sheets via Apps Script.' },
  { id: 'outreach', label: 'Emails & CTA', icon: <MailPlus size={16} />, desc: 'Calendrier de rendez-vous par défaut dans les emails.' },
  { id: 'backend', label: 'Backend', icon: <Plug size={16} />, desc: 'URL de l\'API (tunnel Cloudflare).' },
];

// Round 101 — tables qu'on peut pousser dans Google Sheets.
// (Réplique backend/ src/modules/integrations/routes.ts → SYNCABLE)
const SYNCABLE_TABLES: Array<{ key: string; label: string; accent: string }> = [
  { key: 'prospects', label: 'Prospects', accent: 'emerald' },
  { key: 'companies', label: 'Companies', accent: 'cyan' },
  { key: 'contacts', label: 'Contacts', accent: 'lime' },
  { key: 'campaigns', label: 'Campaigns', accent: 'amber' },
  { key: 'intelligence', label: 'Intelligence', accent: 'purple' },
  { key: 'monitoring', label: 'Monitoring', accent: 'red' },
];

// =====================================================================
// Wipe confirmation modal
// =====================================================================

function WipeConfirmModal({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}): React.ReactElement | null {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="relative max-w-md w-full rounded-2xl border border-red-500/40 bg-card shadow-2xl shadow-red-500/20 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-500">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight text-red-500">Confirmer le wipe</h2>
            <p className="text-xs text-muted-foreground">Action irréversible.</p>
          </div>
        </div>
        <ul className="space-y-1.5 text-sm text-muted-foreground mb-5">
          <li>• Le compte utilisateur (`demo@zentara.local`, etc.) sera <strong className="text-foreground">définitivement supprimé</strong> côté backend.</li>
          <li>• Toutes les sessions Bearer seront <strong className="text-foreground">révoquées</strong>.</li>
          <li>• Le local Storage sera <strong className="text-foreground">purgé</strong> (jetons de session locaux, etc.).</li>
          <li>• Tu reviendras à l'écran <strong className="text-foreground">"Premier lancement"</strong>.</li>
        </ul>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 border-border"
          >
            Annuler
          </Button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 h-10 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white text-sm font-black uppercase tracking-widest disabled:opacity-50 hover:scale-[1.02] transition-all shadow-lg shadow-red-500/30 inline-flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Wiping…
              </>
            ) : (
              <>
                <Trash2 size={14} />
                Wipe All Data
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Page principale
// =====================================================================

export function SettingsPage(): React.ReactElement {
  const { state, reset, enableBiometric } = useAuth();
  const [searchParams] = useSearchParams();
  // Round 138 — autorise un deep-link ?section=xxx (ex: depuis le bandeau
  // "Backend injoignable" de AppLayout).
  const initialSection = (() => {
    const raw = (searchParams.get('section') || '').toLowerCase();
    return VALID_SECTIONS.has(raw as SectionId) ? (raw as SectionId) : 'data';
  })();
  const [activeSection, setActiveSection] = React.useState<SectionId>(initialSection);
  React.useEffect(() => {
    const raw = (searchParams.get('section') || '').toLowerCase();
    if (VALID_SECTIONS.has(raw as SectionId)) setActiveSection(raw as SectionId);
  }, [searchParams]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [wipeOpen, setWipeOpen] = React.useState(false);
  const [wipeBusy, setWipeBusy] = React.useState(false);
  const [aiHealth, setAiHealth] = React.useState<{
    ok: boolean;
    provider: string | null;
    maps: string | null;
    google: string | null;
  }>({ ok: false, provider: null, maps: null, google: null });
  const [importPick, setImportPick] = React.useState<HTMLInputElement | null>(null);

  // Round 101 — état pour la section "Sheets Sync".
  type SheetsConfig = {
    key: string;
    apps_script_url: string | null;
    enabled: boolean;
    sync_targets: string[];
    last_sync_at: string | null;
    last_sync_status: string | null;
    last_sync_log: string | null;
  };
  const [sheetsCfg, setSheetsCfg] = React.useState<SheetsConfig | null>(null);
  const [sheetsDraftUrl, setSheetsDraftUrl] = React.useState<string>('');
  const [sheetsDraftEnabled, setSheetsDraftEnabled] = React.useState<boolean>(false);
  const [sheetsDraftTargets, setSheetsDraftTargets] = React.useState<string[]>([]);
  const [sheetsDirty, setSheetsDirty] = React.useState<boolean>(false);
  const [sheetsLastResult, setSheetsLastResult] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Round 118 — section "Emails & CTA" : calendrier + sender par défaut.
  type OutreachConfig = {
    key: string;
    cta_calendar_url: string | null;
    sender_name: string | null;
    sender_email: string | null;
    reply_to: string | null;
  };
  const [outreachCfg, setOutreachCfg] = React.useState<OutreachConfig | null>(null);
  const [outreachDraftUrl, setOutreachDraftUrl] = React.useState<string>('');
  const [outreachSenderName, setOutreachSenderName] = React.useState<string>('');
  const [outreachSenderEmail, setOutreachSenderEmail] = React.useState<string>('');
  const [outreachReplyTo, setOutreachReplyTo] = React.useState<string>('');
  const [outreachDirty, setOutreachDirty] = React.useState<boolean>(false);
  const [outreachResult, setOutreachResult] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Round 134 — section "API Keys" : clés tierces configurables au runtime.
  type ApiKeyItem = {
    key: string;
    label: string;
    configured: boolean;
    masked: string | null;
    has_env: boolean;
  };
  const [apiKeys, setApiKeys] = React.useState<ApiKeyItem[] | null>(null);
  const [apiKeyDrafts, setApiKeyDrafts] = React.useState<Record<string, string>>({});
  const [apiKeysResult, setApiKeysResult] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadApiKeys = React.useCallback(async () => {
    try {
      const api = getApiClient();
      const data = await api.get<{ keys: ApiKeyItem[] }>('/settings/api-keys');
      setApiKeys(data.keys);
      setApiKeyDrafts({});
      setApiKeysResult(null);
    } catch (e) {
      setApiKeysResult({ kind: 'err', text: `Chargement des clés échoué : ${(e as Error).message}` });
    }
  }, []);

  React.useEffect(() => {
    if (activeSection === 'apiKeys') void loadApiKeys();
  }, [activeSection, loadApiKeys]);

  const handleApiKeySave = async (key: string) => {
    setBusy(`apikey-${key}`);
    setApiKeysResult(null);
    try {
      const api = getApiClient();
      const value = (apiKeyDrafts[key] ?? '').trim();
      await api.put<{ keys: ApiKeyItem[] }>(`/settings/api-keys/${key}`, { value });
      setApiKeyDrafts((d) => ({ ...d, [key]: '' }));
      await loadApiKeys();
      setApiKeysResult({ kind: 'ok', text: `Clé ${key} enregistrée — utilisée immédiatement.` });
    } catch (e) {
      setApiKeysResult({ kind: 'err', text: `Sauvegarde échouée : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const handleApiKeyReset = async (key: string) => {
    setBusy(`apikey-${key}`);
    setApiKeysResult(null);
    try {
      const api = getApiClient();
      await api.delete<{ keys: ApiKeyItem[] }>(`/settings/api-keys/${key}`);
      setApiKeyDrafts((d) => ({ ...d, [key]: '' }));
      await loadApiKeys();
      setApiKeysResult({ kind: 'ok', text: `Clé ${key} effacée.` });
    } catch (e) {
      setApiKeysResult({ kind: 'err', text: `Reset KO : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  // Round — section "LinkedIn" : identifiants StaffSpy (scraping LinkedIn).
  type LinkedInConfig = {
    username: string;
    password_set: boolean;
    session_file: string;
    has_env_username: boolean;
    has_env_password: boolean;
  };
  const [linkedinCfg, setLinkedinCfg] = React.useState<LinkedInConfig | null>(null);
  const [linkedinDraftUser, setLinkedinDraftUser] = React.useState('');
  const [linkedinDraftPass, setLinkedinDraftPass] = React.useState('');
  const [linkedinResult, setLinkedinResult] = React.useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const loadLinkedinConfig = React.useCallback(async () => {
    try {
      const api = getApiClient();
      const data = await api.get<LinkedInConfig>('/settings/linkedin');
      setLinkedinCfg(data);
      setLinkedinDraftUser(data.username || '');
      setLinkedinDraftPass('');
      setLinkedinResult(null);
    } catch (e) {
      setLinkedinResult({ kind: 'err', text: `Chargement LinkedIn échoué : ${(e as Error).message}` });
    }
  }, []);

  React.useEffect(() => {
    if (activeSection === 'linkedin') void loadLinkedinConfig();
  }, [activeSection, loadLinkedinConfig]);

  const handleLinkedinSave = async () => {
    setBusy('linkedin');
    setLinkedinResult(null);
    try {
      const api = getApiClient();
      const body: Record<string, string> = {};
      if (linkedinDraftUser.trim()) body.username = linkedinDraftUser.trim();
      if (linkedinDraftPass) body.password = linkedinDraftPass;
      const data = await api.put<LinkedInConfig>('/settings/linkedin', body);
      setLinkedinCfg(data);
      setLinkedinDraftPass('');
      setLinkedinResult({ kind: 'ok', text: 'Identifiants LinkedIn enregistrés — utilisés immédiatement par StaffSpy.' });
    } catch (e) {
      setLinkedinResult({ kind: 'err', text: `Sauvegarde LinkedIn échouée : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const handleLinkedinClear = async () => {
    setBusy('linkedin');
    setLinkedinResult(null);
    try {
      const api = getApiClient();
      await api.delete<LinkedInConfig>('/settings/linkedin');
      setLinkedinCfg({ username: '', password_set: false, session_file: '', has_env_username: false, has_env_password: false });
      setLinkedinDraftUser('');
      setLinkedinDraftPass('');
      setLinkedinResult({ kind: 'ok', text: 'Identifiants LinkedIn effacés.' });
    } catch (e) {
      setLinkedinResult({ kind: 'err', text: `Reset LinkedIn KO : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  // Backend (API) URL override — persiste en localStorage, éditable sans rebuild.
  const [backendUrl, setBackendUrl] = React.useState<string>(() => getApiBase());
  const [backendSaved, setBackendSaved] = React.useState<boolean>(false);
  const [backendTest, setBackendTest] = React.useState<
    { status: 'idle' } | { status: 'testing' } | { status: 'ok'; ms: number } | { status: 'err'; msg: string }
  >({ status: 'idle' });
  const handleSaveBackend = () => {
    setApiBase(backendUrl);
    setBackendSaved(true);
    window.setTimeout(() => setBackendSaved(false), 2500);
    setMessage({ kind: 'ok', text: 'URL backend enregistrée — appliquée au prochain appel API.' });
  };
  const handleResetBackend = () => {
    setApiBase('');
    setBackendUrl((import.meta.env?.VITE_API_BASE_URL as string | undefined) || '/api');
    setBackendTest({ status: 'idle' });
    setMessage({ kind: 'ok', text: 'URL backend réinitialisée au défaut du build.' });
  };
  const handleTestBackend = async () => {
    setBackendTest({ status: 'testing' });
    // Teste l'URL tapée (et non celle déjà enregistrée) pour qu'on puisse
    // valider une nouvelle URL AVANT d'enregistrer.
    const t0 = Date.now();
    const ok = await probeBackend(backendUrl || '/api');
    if (ok) setBackendTest({ status: 'ok', ms: Date.now() - t0 });
    else setBackendTest({ status: 'err', msg: 'Aucune réponse 2xx sur /health' });
  };

  // Theme persisted in localStorage
  const [isDark, setIsDark] = React.useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    const stored = window.localStorage.getItem('zentara.theme');
    if (stored === 'light') return false;
    if (stored === 'dark') return true;
    // Default by class on html.
    return document.documentElement.classList.contains('dark');
  });

  // PIN length persisted (cf. secureStorage.setItem PIN_LENGTH)
  const [pinLength, setPinLength] = React.useState<4 | 6>(4);

  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', isDark);
    window.localStorage.setItem('zentara.theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  // Fetch /api/admin/health on mount pour les sections AI + Integrations.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = getApiClient();
        const data = await api.get<{
          ai_provider: string;
          ai_configured: boolean;
          google_status: string;
          maps_status: string;
        }>('/admin/health');
        if (cancelled) return;
        setAiHealth({
          ok: true,
          provider: data.ai_provider ?? null,
          maps: data.maps_status ?? null,
          google: data.google_status ?? null,
        });
      } catch (_e) {
        if (!cancelled) setAiHealth({ ok: false, provider: null, maps: null, google: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Welcome message reset 4s after.
  React.useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 5000);
    return () => window.clearTimeout(t);
  }, [message]);

  // ===================================================================
  // Handlers = actions concrètes
  // ===================================================================

  /**
   * Export une table en CSV/JSON et déclenche le download local via
   * un Blob + lien temporaire. Aucune dépendance tierce.
   */
  const EXPORT_MIME: Record<string, string> = {
    json: 'application/json',
    csv: 'text/csv;charset=utf-8',
    vcard: 'text/vcard;charset=utf-8',
    yaml: 'application/yaml',
    xml: 'application/xml',
    md: 'text/markdown;charset=utf-8',
  };

  const handleExport = async (
    table: string,
    format: 'csv' | 'json' | 'vcard' | 'yaml' | 'xml' | 'md' = 'csv',
  ) => {
    setBusy(`export-${table}-${format}`);
    setMessage(null);
    try {
      const api = getApiClient();
      const content = await api.get<string>(`/admin/export?table=${table}&format=${format}`, {
        // On force la réponse texte brute plutôt que JSON envelope.
        headers: { Accept: EXPORT_MIME[format] ?? 'application/octet-stream' },
      });
      const blob = new Blob([content], { type: EXPORT_MIME[format] ?? 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'vcard' ? 'vcf' : format;
      a.download = `zentara-${table}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage({ kind: 'ok', text: `Export ${table}.${ext} téléchargé.` });
    } catch (e) {
      setMessage({ kind: 'err', text: `Erreur export : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  /**
   * Restore : ouvre le file picker, parse le JSON en BackupDump, POST sur
   * `/api/admin/restore`. Le backend remplace les tables par le contenu du
   * dump (interprétation ; voir backend/services/backup/backup.service.ts).
   */
  const handleImportClick = () => {
    importPick?.click();
  };

  const handleImportFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy('import');
    setMessage(null);
    try {
      const text = await file.text();
      const dump = JSON.parse(text);
      // Sanity check de base.
      if (!dump || typeof dump !== 'object' || !dump.tables) {
        throw new Error('Le fichier ne ressemble pas à un dump Zentara valide');
      }
      const api = getApiClient();
      const r = await api.post<{ inserted: Record<string, number> }>('/admin/restore', { dump });
      const total = Object.values(r.inserted ?? {}).reduce((s, n) => s + Number(n), 0);
      setMessage({
        kind: 'ok',
        text: `Restore OK — ${total} lignes ré-importées dans ${Object.keys(r.inserted ?? {}).length} tables.`,
      });
    } catch (err) {
      setMessage({ kind: 'err', text: `Erreur import : ${(err as Error).message}` });
    } finally {
      setBusy(null);
      // Reset input value pour permettre de re-sélectionner le même fichier.
      if (importPick) importPick.value = '';
    }
  };

  /**
   * Wipe = DELETE /api/auth/me (via AuthContext.reset) + wipe secureStorage
   * local + retour forcé vers `state.kind === 'setup'`.
   */
  const handleWipeConfirm = async () => {
    setWipeBusy(true);
    setMessage(null);
    try {
      await reset();
      setMessage({ kind: 'ok', text: 'Compte et données locales effacés. Repasse au setup.' });
    } catch (err) {
      setMessage({ kind: 'err', text: `Wipe partiel : ${(err as Error).message}` });
    } finally {
      setWipeBusy(false);
      setWipeOpen(false);
      // After wipe, AuthGate bascule sur SetupPanel. Mais Settings peut encore
      // être visible (unmountétrange). On force un reload propre pour réinitialiser TOUT.
      window.setTimeout(() => window.location.reload(), 600);
    }
  };

  const handleEnableBiometric = async () => {
    setBusy('bio');
    setMessage(null);
    try {
      await enableBiometric();
      setMessage({ kind: 'ok', text: 'Biométrie activée sur cette session.' });
    } catch (err) {
      setMessage({ kind: 'err', text: `Impossible : ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const handleTogglePinLength = async (next: 4 | 6) => {
    setPinLength(next);
    try {
      await (await import('@/services/auth/secure-storage')).secureStorage.setItem(
        (await import('@/services/auth/secure-storage')).STORAGE_KEYS.PIN_LENGTH,
        String(next),
      );
      setMessage({ kind: 'ok', text: `Longueur PIN sauvegardée (${next} chiffres).` });
    } catch (_e) {
      /* mémoire suffit */
    }
  };

  // ===================================================================
  // Round 101 — Sheets Sync handlers
  // ===================================================================

  /** Charge la config sheets depuis le backend, hydrate les champs draft. */
  const loadSheetsConfig = React.useCallback(async () => {
    try {
      const api = getApiClient();
      const data = await api.get<{ integrations: SheetsConfig[]; syncable_tables: string[] }>(
        '/integrations',
      );
      const cfg = data.integrations.find((i) => i.key === 'sheets') ?? null;
      setSheetsCfg(cfg);
      setSheetsDraftUrl(cfg?.apps_script_url ?? '');
      setSheetsDraftEnabled(!!cfg?.enabled);
      setSheetsDraftTargets(cfg?.sync_targets ?? []);
      setSheetsDirty(false);
    } catch (e) {
      setSheetsLastResult({ kind: 'err', text: `Chargement config échoué : ${(e as Error).message}` });
    }
  }, []);

  React.useEffect(() => {
    void loadSheetsConfig();
  }, [loadSheetsConfig, activeSection]);

  const toggleSheetsTarget = (key: string) => {
    setSheetsDraftTargets((prev) => {
      const has = prev.includes(key);
      const next = has ? prev.filter((k) => k !== key) : [...prev, key];
      setSheetsDirty(true);
      return next;
    });
  };

  const handleSheetsSave = async () => {
    setBusy('sheets-save');
    setSheetsLastResult(null);
    try {
      const api = getApiClient();
      const url = sheetsDraftUrl.trim();
      const data = await api.put<SheetsConfig>('/integrations/sheets', {
        apps_script_url: url === '' ? null : url,
        enabled: sheetsDraftEnabled,
        sync_targets: sheetsDraftTargets,
      });
      setSheetsCfg(data);
      setSheetsDirty(false);
      setSheetsLastResult({ kind: 'ok', text: 'Configuration Sheets sauvegardée côté backend.' });
    } catch (e) {
      setSheetsLastResult({ kind: 'err', text: `Sauvegarde échouée : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const handleSheetsTest = async () => {
    setBusy('sheets-test');
    setSheetsLastResult(null);
    try {
      const api = getApiClient();
      const r = await api.post<{
        ok: boolean;
        http_status: number | null;
        response_excerpt: string | null;
        error: string | null;
      }>('/integrations/sheets/test');
      if (r.ok) {
        setSheetsLastResult({
          kind: 'ok',
          text: `Apps Script OK (HTTP ${r.http_status}). Réponse tronquée : ${(r.response_excerpt ?? '').slice(0, 80) || '<vide>'}`,
        });
      } else {
        setSheetsLastResult({
          kind: 'err',
          text: `Apps Script refusé (HTTP ${r.http_status ?? '?'}). ${r.error ?? (r.response_excerpt ?? '<vide>').slice(0, 100)}`,
        });
      }
      await loadSheetsConfig();
    } catch (e) {
      setSheetsLastResult({ kind: 'err', text: `Test KO : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const handleSheetsSync = async () => {
    setBusy('sheets-sync');
    setSheetsLastResult(null);
    try {
      const api = getApiClient();
      const r = await api.post<{
        ok: boolean;
        rows: number;
        tables: string[];
        http_status: number | null;
        error: string | null;
      }>('/integrations/sheets/sync');
      if (r.ok) {
        setSheetsLastResult({
          kind: 'ok',
          text: `Sync OK — ${r.rows} lignes poussé vers ${r.tables.length} table(s).`,
        });
      } else {
        setSheetsLastResult({
          kind: 'err',
          text: `Sync KO (HTTP ${r.http_status ?? '?'}). ${r.error ?? 'Apps Script a refusé la requête.'}`,
        });
      }
      await loadSheetsConfig();
    } catch (e) {
      setSheetsLastResult({ kind: 'err', text: `Sync KO : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  /** Charge la config outreach (CTA calendrier) depuis le backend. */
  const loadOutreachConfig = React.useCallback(async () => {
    try {
      const api = getApiClient();
      const cfg = await api.get<OutreachConfig>('/integrations/outreach');
      setOutreachCfg(cfg);
      setOutreachDraftUrl(cfg?.cta_calendar_url ?? '');
      setOutreachSenderName(cfg?.sender_name ?? '');
      setOutreachSenderEmail(cfg?.sender_email ?? '');
      setOutreachReplyTo(cfg?.reply_to ?? '');
      setOutreachDirty(false);
    } catch (e) {
      setOutreachResult({ kind: 'err', text: `Chargement config échoué : ${(e as Error).message}` });
    }
  }, []);

  React.useEffect(() => {
    void loadOutreachConfig();
  }, [loadOutreachConfig, activeSection]);

  const handleOutreachSave = async () => {
    setBusy('outreach-save');
    setOutreachResult(null);
    try {
      const api = getApiClient();
      const url = outreachDraftUrl.trim();
      const data = await api.put<OutreachConfig>('/integrations/outreach', {
        cta_calendar_url: url === '' ? null : url,
        sender_name: outreachSenderName.trim() === '' ? null : outreachSenderName.trim(),
        sender_email: outreachSenderEmail.trim() === '' ? null : outreachSenderEmail.trim(),
        reply_to: outreachReplyTo.trim() === '' ? null : outreachReplyTo.trim(),
      });
      setOutreachCfg(data);
      setOutreachDirty(false);
      setOutreachResult({
        kind: 'ok',
        text: 'Calendrier de rendez-vous enregistré — utilisé par défaut comme CTA des emails.',
      });
    } catch (e) {
      setOutreachResult({ kind: 'err', text: `Sauvegarde échouée : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const handleOutreachReset = async () => {
    setBusy('outreach-reset');
    setOutreachResult(null);
    try {
      const api = getApiClient();
      await api.delete('/integrations/outreach');
      setOutreachDraftUrl('');
      setOutreachDirty(false);
      await loadOutreachConfig();
      setOutreachResult({ kind: 'ok', text: 'CTA par défaut effacé — plus de bouton calendrier dans les emails.' });
    } catch (e) {
      setOutreachResult({ kind: 'err', text: `Reset KO : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const handleSheetsReset = async () => {
    setBusy('sheets-reset');
    setSheetsLastResult(null);
    try {
      const api = getApiClient();
      await api.delete('/integrations/sheets');
      setSheetsDraftUrl('');
      setSheetsDraftEnabled(false);
      setSheetsDraftTargets([]);
      setSheetsDirty(false);
      await loadSheetsConfig();
      setSheetsLastResult({ kind: 'ok', text: 'Configuration Sheets effacée.' });
    } catch (e) {
      setSheetsLastResult({ kind: 'err', text: `Reset KO : ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  // ===================================================================
  // Section content
  // ===================================================================

  const renderSection = () => {
    switch (activeSection) {
      case 'profile':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserIcon className="text-primary" size={20} /> Profil
              </CardTitle>
              <CardDescription>
                Ton compte Zentara (profil local — pas de SaaS distant).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {state.kind === 'authenticated' ? (
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Nom" value={state.user.name} />
                  <FieldRow label="Email" value={state.user.email} />
                  <FieldRow label="Rôle" value={state.user.role} />
                  <FieldRow label="Session" value={`Bearer ${state.token.slice(0, 12)}…`} />
                </div>
              ) : (
                <div className="rounded-xl bg-secondary/20 border border-border p-4 text-sm text-muted-foreground">
                  Aucune session active. Verrouille ou connecte-toi pour afficher ton profil.
                </div>
              )}
            </CardContent>
          </Card>
        );

      case 'security':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="text-primary" size={20} /> Sécurité
              </CardTitle>
              <CardDescription>
                PIN local (hashé bcrypt côté backend), biométrie native facultative.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/20 border border-border">
                <div className="space-y-1">
                  <p className="text-sm font-semibold">Longueur du PIN</p>
                  <p className="text-xs text-muted-foreground">
                    4 chiffres = accessibilité · 6 chiffres = sécurité accrue.
                  </p>
                </div>
                <div className="flex rounded-xl bg-secondary/30 border border-border p-1">
                  {[4, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => handleTogglePinLength(n as 4 | 6)}
                      className={cn(
                        'h-9 px-3 rounded-lg text-xs font-black uppercase tracking-widest transition-all',
                        pinLength === n
                          ? 'bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-md'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/20 border border-border">
                <div className="space-y-1">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Sparkles size={14} className="text-primary" />
                    Biométrie (Face ID / empreinte)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Active la biométrie sur cette session (prompt natif requis côté Android).
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-border"
                  disabled={busy === 'bio' || state.kind !== 'authenticated'}
                  onClick={handleEnableBiometric}
                >
                  {busy === 'bio' ? (
                    <>
                      <Loader2 size={14} className="mr-2 animate-spin" /> Activation…
                    </>
                  ) : (
                    <>Activer</>
                  )}
                </Button>
              </div>

            </CardContent>
          </Card>
        );

      case 'appearance':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="text-primary" size={20} /> Apparence
              </CardTitle>
              <CardDescription>Le thème est persisté dans localStorage.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {([
                  { v: 'dark', label: 'Sombre', desc: 'Défaut · dark premium', icon: <Moon size={18} /> },
                  { v: 'light', label: 'Clair', desc: 'À venir', icon: <Sun size={18} /> },
                ] as const).map((opt) => {
                  const selected = (opt.v === 'dark' && isDark) || (opt.v === 'light' && !isDark);
                  return (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setIsDark(opt.v === 'dark')}
                      className={cn(
                        'p-4 rounded-xl border text-left transition-all hover:scale-[1.01] active:scale-[0.99]',
                        selected
                          ? 'border-primary bg-primary/10 shadow-lg shadow-primary/10'
                          : 'border-border bg-secondary/20 hover:border-primary/40',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={cn(selected ? 'text-primary' : 'text-muted-foreground')}>
                          {opt.icon}
                        </span>
                        <span className="text-sm font-bold">{opt.label}</span>
                        {selected && (
                          <CheckCircle2 size={14} className="ml-auto text-primary" />
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );

      case 'data':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="text-primary" size={20} /> Données locales
              </CardTitle>
              <CardDescription>
                Export multi-format (CSV · JSON · vCard · XML · YAML · Markdown) via{' '}
                <span className="font-mono text-foreground">/api/admin/export</span> · Restore via{' '}
                <span className="font-mono text-foreground">/api/admin/restore</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Row 1 : deux boutons Export rapides */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { table: 'prospects', label: 'Prospects', accent: 'emerald' },
                  { table: 'companies', label: 'Companies', accent: 'cyan' },
                  { table: 'contacts', label: 'Contacts', accent: 'lime' },
                  { table: 'campaigns', label: 'Campaigns', accent: 'amber' },
                  { table: 'monitoring', label: 'Monitoring', accent: 'red' },
                  { table: 'intelligence', label: 'Intelligence', accent: 'purple' },
                ].map((row) => (
                  <div
                    key={row.table}
                    className="flex items-center justify-between p-3 rounded-xl bg-secondary/20 border border-border hover:border-primary/30 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-semibold">{row.label}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">table={row.table}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => handleExport(row.table, 'csv')}
                        disabled={busy !== null}
                        className="h-8 px-2 rounded-lg border border-border bg-card hover:border-primary/40 hover:text-primary text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <Download size={11} /> CSV
                      </button>
                      <button
                        type="button"
                        onClick={() => handleExport(row.table, 'json')}
                        disabled={busy !== null}
                        className="h-8 px-2 rounded-lg border border-border bg-card hover:border-primary/40 hover:text-primary text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <Download size={11} /> JSON
                      </button>
                      {(row.table === 'contacts' || row.table === 'prospects') && (
                        <button
                          type="button"
                          onClick={() => handleExport(row.table, 'vcard')}
                          disabled={busy !== null}
                          title="vCard — importable dans le téléphone / Google Contacts"
                          className="h-8 px-2 rounded-lg border border-emerald-500/40 bg-card hover:border-emerald-400 hover:text-emerald-400 text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          <Download size={11} /> VCF
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleExport(row.table, 'md')}
                        disabled={busy !== null}
                        title="Markdown — lisible dans GitHub / Notion / Obsidian"
                        className="h-8 px-2 rounded-lg border border-border bg-card hover:border-primary/40 hover:text-primary text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <Download size={11} /> MD
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <Separator className="bg-border/50" />

              {/* Row 2 : Import + Wipe */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/20 border border-border">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <Upload size={14} className="text-cyan-400" />
                      Restore depuis dump JSON
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Sélectionne un fichier <span className="font-mono text-foreground">zentara-backup-*.json</span> produit par
                      <span className="font-mono text-foreground"> /api/admin/backup</span>.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={handleImportClick}
                    className="border-border h-9"
                  >
                    {busy === 'import' ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Upload size={14} className="mr-2" />}
                    Importer
                  </Button>
                  <input
                    ref={(el) => setImportPick(el)}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleImportFile}
                  />
                </div>

                <div className="flex items-center justify-between p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-red-500 flex items-center gap-2">
                      <Trash2 size={14} />
                      Wipe All Local Data
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Supprime le user backend + secureStorage local. Repasse en setup.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setWipeOpen(true)}
                    disabled={busy !== null}
                    className="bg-red-500 hover:bg-red-600 text-white h-9"
                  >
                    <Trash2 size={14} className="mr-2" />
                    Wipe…
                  </Button>
                </div>
              </div>

              {/* Feedback inline */}
              {message && activeSection === 'data' && (
                <div
                  className={cn(
                    'rounded-xl p-3 text-xs flex items-start gap-2 animate-in fade-in slide-in-from-top-2',
                    message.kind === 'ok'
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-500'
                      : 'bg-red-500/10 border border-red-500/30 text-red-500',
                  )}
                >
                  {message.kind === 'ok' ? <CheckCircle2 size={14} className="mt-0.5" /> : <AlertTriangle size={14} className="mt-0.5" />}
                  <div className="font-mono">{message.text}</div>
                </div>
              )}
            </CardContent>
          </Card>
        );

      case 'backend':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plug className="text-cyan-500" size={20} /> Backend (API)
              </CardTitle>
              <CardDescription>
                URL de l'API Zentara. Change-la ici quand le tunnel Cloudflare change — aucun rebuild d'APK nécessaire.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl bg-secondary/20 border border-border p-4 text-sm text-muted-foreground">
                URL actuelle : <span className="font-mono text-foreground">{getApiBase()}</span>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-muted-foreground">
                  URL de base (doit inclure <span className="font-mono">/api</span>)
                </label>
                <input
                  value={backendUrl}
                  onChange={(e) => setBackendUrl(e.target.value)}
                  placeholder="https://xxx.trycloudflare.com/api"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={handleSaveBackend} className="gap-2">
                    <Save size={14} /> Enregistrer
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleTestBackend} disabled={backendTest.status === 'testing'} className="gap-2">
                    {backendTest.status === 'testing' ? 'Test en cours…' : 'Tester la connexion'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleResetBackend}>
                    Réinitialiser au défaut
                  </Button>
                </div>
                {backendTest.status === 'ok' && (
                  <div className="text-xs text-green-500 font-mono">
                    ✓ Connexion OK ({backendTest.ms} ms) — l'URL répond en 2xx.
                  </div>
                )}
                {backendTest.status === 'err' && (
                  <div className="text-xs text-red-500 font-mono">✗ Échec : {backendTest.msg}</div>
                )}
                {backendSaved && (
                  <div className="text-xs text-emerald-500">URL enregistrée — un refresh du client l'appliquera.</div>
                )}
              </div>
            </CardContent>
          </Card>
        );

      case 'ai':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="text-amber-500" size={20} /> Moteur IA
              </CardTitle>
              <CardDescription>
                État du provider AI courant (lu sur{' '}
                <span className="font-mono text-foreground">/api/admin/health</span>).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!aiHealth.ok ? (
                <div className="text-sm text-muted-foreground">Chargement…</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <HealthPill
                    label="Provider"
                    value={aiHealth.provider ?? 'inconnu'}
                    status="ok"
                  />
                  <HealthPill
                    label="API Key"
                    value={aiHealth.ok && aiHealth.provider ? 'configurée' : 'manquante'}
                    status={aiHealth.ok ? 'warn' : 'err'}
                  />
                  <HealthPill
                    label="Stub fallback"
                    value="Actif si pas d'API key"
                    status="ok"
                  />
                  <HealthPill
                    label="Modèle"
                    value="env AI_MODEL"
                    status="ok"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );

      case 'integrations':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LinkIcon className="text-primary" size={20} /> Intégrations externes
              </CardTitle>
              <CardDescription>État stub vs live des providers tiers.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <IntegrationPill
                  label="Google Places"
                  status={aiHealth.google === 'ok' ? 'ok' : 'warn'}
                  value={
                    aiHealth.google === 'ok' ? 'Connecté' : 'Stub mode (pas de credentials)'
                  }
                  doc={{ label: 'Google Places API docs', href: 'https://developers.google.com/maps/documentation/places/web-service/op-overview' }}
                  to={null}
                />
                <IntegrationPill
                  label="Google Maps"
                  status={aiHealth.maps === 'ok' ? 'ok' : 'warn'}
                  value={aiHealth.maps === 'ok' ? 'Connecté' : 'Stub mode'}
                  doc={{ label: 'Google Maps Platform', href: 'https://developers.google.com/maps' }}
                  to={null}
                />
                <IntegrationPill
                  label="Knowledge RAG"
                  status="ok"
                  value="Local embeddings (256 dims, sha-256-based)"
                  doc={{ label: 'Knowledge module', href: null }}
                  to={{ label: 'Open Knowledge →', path: '/knowledge' }}
                />
                <IntegrationPill
                  label="Monitoring"
                  status="ok"
                  value="Stub (RSS/curl-ready)"
                  doc={{ label: 'Monitoring center', href: null }}
                  to={{ label: 'Open Monitoring →', path: '/monitoring' }}
                />
              </div>

              {/* Liens utiles vers docs externes (référence depuis /admin/health). */}
              <div className="pt-3 border-t border-border/40 space-y-2">
                <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1.5">
                  <BookOpen size={11} /> Documentation utile
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <ExternalLinkButton
                    href="https://platform.openai.com/docs/api-reference"
                    label="OpenAI API Reference"
                  />
                  <ExternalLinkButton
                    href="https://ai.google.dev/gemini-api/docs/text-generation"
                    label="Google Gemini API"
                  />
                  <ExternalLinkButton
                    href="https://platform.deepseek.com/api-docs/"
                    label="DeepSeek API"
                  />
                  <ExternalLinkButton
                    href="https://sql.js.org/"
                    label="SQLite in browser (sql.js)"
                  />
                  <ExternalLinkButton
                    href="https://github.com/asg017/sqlite-vss"
                    label="sqlite-vss (vector search)"
                  />
                  <ExternalLinkButton
                    href="https://github.com/WiseLibs/better-sqlite3"
                    label="better-sqlite3 (Zentara backend)"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      case 'apiKeys':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="text-primary" size={20} /> Clés API
              </CardTitle>
              <CardDescription>
                Colle ici tes clés tierces pour activer les sources payantes sans toucher au{' '}
                <span className="font-mono text-foreground">.env</span> ni redémarrer. Priorité : clé
                saisie ici &gt; variable d'env. Les valeurs sont masquées.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {apiKeysResult && (
                <div
                  className={`text-sm rounded-lg px-3 py-2 border ${
                    apiKeysResult.kind === 'ok'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-red-500/30 bg-red-500/10 text-red-300'
                  }`}
                >
                  {apiKeysResult.text}
                </div>
              )}

              {apiKeys === null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Chargement des clés…
                </div>
              ) : (
                <div className="space-y-3">
                  {apiKeys.map((k) => {
                    const draft = apiKeyDrafts[k.key] ?? '';
                    const busyKey = busy === `apikey-${k.key}`;
                    return (
                      <div key={k.key} className="p-4 rounded-xl bg-secondary/20 border border-border space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{k.label}</p>
                          <div className="flex items-center gap-1.5">
                            {k.has_env && (
                              <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                env
                              </Badge>
                            )}
                            <Badge
                              className={
                                k.configured
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-muted text-muted-foreground border border-border'
                              }
                            >
                              {k.configured ? 'Configurée' : 'Non configurée'}
                            </Badge>
                          </div>
                        </div>
                        {k.masked && (
                          <p className="text-xs text-muted-foreground font-mono">Active : {k.masked}</p>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="password"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={
                              k.configured ? 'Coller une nouvelle clé pour la remplacer…' : 'Coller la clé…'
                            }
                            value={draft}
                            onChange={(e) =>
                              setApiKeyDrafts((d) => ({ ...d, [k.key]: e.target.value }))
                            }
                            className="flex-1 h-10 px-3 rounded-lg bg-card border border-border focus:border-primary/40 focus:outline-none font-mono text-xs"
                          />
                          <Button
                            size="sm"
                            disabled={busy !== null || draft.trim() === ''}
                            onClick={() => handleApiKeySave(k.key)}
                            className="bg-gradient-to-r from-primary to-accent hover:scale-[1.02] text-primary-foreground h-10 shadow-md transition-all"
                          >
                            {busyKey ? (
                              <Loader2 size={14} className="mr-2 animate-spin" />
                            ) : (
                              <Save size={14} className="mr-2" />
                            )}
                            Enregistrer
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy !== null || !k.configured}
                            onClick={() => handleApiKeyReset(k.key)}
                            className="border-red-500/40 text-red-500 hover:bg-red-500/10 h-10"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );

      case 'linkedin':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="text-primary" size={20} /> LinkedIn
              </CardTitle>
              <CardDescription>
                Identifiants de ton compte LinkedIn pour le scraping StaffSpy (recherche de personnes / emplois).
                Stockés localement, priorité sur les variables d'env. Le mot de passe n'est jamais renvoyé en clair.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {linkedinResult && (
                <div
                  className={`text-sm rounded-lg px-3 py-2 border ${
                    linkedinResult.kind === 'ok'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-red-500/30 bg-red-500/10 text-red-300'
                  }`}
                >
                  {linkedinResult.text}
                </div>
              )}

              {linkedinCfg === null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Chargement…
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-1.5">
                    {linkedinCfg.password_set || linkedinCfg.has_env_password ? (
                      <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        Identifiants configurés
                      </Badge>
                    ) : (
                      <Badge className="bg-muted text-muted-foreground border border-border">Non configuré</Badge>
                    )}
                    {linkedinCfg.has_env_username && (
                      <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30">env</Badge>
                    )}
                  </div>

                  <label className="block space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">Email LinkedIn (username)</p>
                    <input
                      value={linkedinDraftUser}
                      onChange={(e) => setLinkedinDraftUser(e.target.value)}
                      placeholder="ex : vous@entreprise.com"
                      autoComplete="off"
                      className="w-full h-10 px-3 rounded-lg bg-card border border-border focus:border-primary/40 focus:outline-none text-sm"
                    />
                  </label>

                  <label className="block space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">Mot de passe</p>
                    <input
                      type="password"
                      autoComplete="off"
                      value={linkedinDraftPass}
                      onChange={(e) => setLinkedinDraftPass(e.target.value)}
                      placeholder={linkedinCfg.password_set ? '•••••• (laisser vide pour conserver)' : 'Mot de passe LinkedIn…'}
                      className="w-full h-10 px-3 rounded-lg bg-card border border-border focus:border-primary/40 focus:outline-none font-mono text-sm"
                    />
                  </label>

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy !== null}
                      onClick={handleLinkedinSave}
                      className="bg-gradient-to-r from-primary to-accent hover:scale-[1.02] text-primary-foreground h-10 shadow-md transition-all"
                    >
                      {busy === 'linkedin' ? (
                        <Loader2 size={14} className="mr-2 animate-spin" />
                      ) : (
                        <Save size={14} className="mr-2" />
                      )}
                      Enregistrer
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null || (!linkedinCfg.password_set && !linkedinCfg.username)}
                      onClick={handleLinkedinClear}
                      className="border-red-500/40 text-red-500 hover:bg-red-500/10 h-10"
                    >
                      <Trash2 size={14} className="mr-1" /> Effacer
                    </Button>
                  </div>

                  <p className="text-[11px] text-muted-foreground leading-snug">
                    ⚠️ Un compte avec <strong>2FA</strong> ne passera pas via ces identifiants (StaffSpy gère le captcha, pas le code 2FA).
                    Alternative sans mot de passe : génère un <code className="font-mono">session.pkl</code> sur ta machine puis dépose-le dans{' '}
                    <code className="font-mono">backend/linkedin/session.pkl</code> (auto-détecté).
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        );

      case 'sheets':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sheet className="text-primary" size={20} /> Sheets Sync
              </CardTitle>
              <CardDescription>
                Branche un Google Apps Script deploye (<span className="font-mono text-foreground">doPost(e)</span>)
                pour pousser automatiquement tes donnees Zentara vers un Google Sheet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Row 1 — URL + activé */}
              <div className="space-y-3 p-4 rounded-xl bg-secondary/20 border border-border">
                <div className="flex items-center justify-between gap-2">
                  <div className="space-y-1 flex-1 min-w-0">
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <Plug size={14} className="text-primary" />
                      URL du Apps Script
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Format : <span className="font-mono text-foreground">https://script.google.com/macros/s/&lt;ID&gt;/exec</span>
                    </p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <span className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Sync auto</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={sheetsDraftEnabled}
                      onClick={() => { setSheetsDraftEnabled((v) => !v); setSheetsDirty(true); }}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        sheetsDraftEnabled ? 'bg-primary' : 'bg-secondary/50 border border-border',
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 rounded-full bg-white shadow-md transition-transform',
                          sheetsDraftEnabled ? 'translate-x-6' : 'translate-x-1',
                        )}
                      />
                    </button>
                  </label>
                </div>
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://script.google.com/macros/s/AKfycbz.../exec"
                  value={sheetsDraftUrl}
                  onChange={(e) => { setSheetsDraftUrl(e.target.value); setSheetsDirty(true); }}
                  className="w-full h-10 px-3 rounded-lg bg-card border border-border focus:border-primary/40 focus:outline-none font-mono text-xs"
                />
              </div>

              <Separator className="bg-border/50" />

              {/* Row 2 — Tables à pousser */}
              <div className="space-y-3 p-4 rounded-xl bg-secondary/20 border border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <Database size={14} className="text-cyan-400" />
                      Tables à synchroniser
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Choisis quelles tables Zentara pousser vers ton Google Sheet.
                    </p>
                  </div>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {sheetsDraftTargets.length}/{SYNCABLE_TABLES.length}
                  </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {SYNCABLE_TABLES.map((t) => {
                    const checked = sheetsDraftTargets.includes(t.key);
                    return (
                      <label
                        key={t.key}
                        className={cn(
                          'flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all text-xs',
                          checked
                            ? 'bg-primary/10 border-primary/40 text-foreground'
                            : 'bg-card border-border text-muted-foreground hover:border-primary/30',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSheetsTarget(t.key)}
                          className="h-4 w-4 accent-primary"
                        />
                        <span className="font-medium">{t.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Row 3 — Actions : Test + Sync now + Save + Reset */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !sheetsDraftUrl.trim()}
                  onClick={handleSheetsTest}
                  className="border-border h-10"
                >
                  {busy === 'sheets-test' ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Plug size={14} className="mr-2" />
                  )}
                  Test
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !sheetsDraftUrl.trim() || sheetsDirty}
                  onClick={handleSheetsSync}
                  className="border-border h-10"
                >
                  {busy === 'sheets-sync' ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <CloudUpload size={14} className="mr-2" />
                  )}
                  Sync now
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null || !sheetsDirty}
                  onClick={handleSheetsSave}
                  className="bg-gradient-to-r from-primary to-accent hover:scale-[1.02] text-primary-foreground h-10 shadow-md transition-all"
                >
                  {busy === 'sheets-save' ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Save size={14} className="mr-2" />
                  )}
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !sheetsCfg?.apps_script_url}
                  onClick={handleSheetsReset}
                  className="border-red-500/40 text-red-500 hover:bg-red-500/10 h-10"
                >
                  {busy === 'sheets-reset' ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Trash2 size={14} className="mr-2" />
                  )}
                  Reset
                </Button>
              </div>

              {/* Row 4 — Documentation pour le Apps Script */}
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-cyan-400">
                  <BookOpen size={12} /> Apps Script — squelette minimal a deployer
                </div>
                <pre className="text-[10px] font-mono leading-4 text-muted-foreground whitespace-pre-wrap break-all">
{`// Code.gs — deploye comme Web App (Execute as: Me, Access: Anyone)
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    // 1) Envoi d'un email personnalise depuis ton compte Gmail
    if (data.kind === 'send_email') {
      MailApp.sendEmail({
        to: data.to,
        subject: data.subject,
        htmlBody: data.html
      });
      return json({ ok: true, kind: 'send_email', sent_to: data.to });
    }

    // 2) Sync des tables Zentara vers Google Sheets
    var ss = SpreadsheetApp.getActive();
    Object.keys(data.tables || {}).forEach(function(name){
      var sh = ss.getSheetByName('z_' + name) || ss.insertSheet('z_' + name);
      var rows = data.tables[name];
      sh.clearContents();
      if (rows.length === 0) return;
      var keys = Object.keys(rows[0]);
      sh.getRange(1, 1, 1, keys.length).setValues([keys]);
      sh.getRange(2, 1, rows.length, keys.length).setValues(
        rows.map(function(r){ return keys.map(function(k){ return r[k]; }); })
      );
    });
    return json({ ok: true, synced_at: data.synced_at });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`}
                </pre>
                <ExternalLinkButton
                  href="https://developers.google.com/apps-script/guides/web"
                  label="Apps Script Web Apps docs"
                />
              </div>

              {/* Last sync status */}
              {sheetsCfg?.last_sync_at && (
                <div className="text-[10px] font-mono text-muted-foreground border-t border-border/40 pt-2">
                  Last sync :{' '}
                  <span className="text-foreground">
                    {new Date(sheetsCfg.last_sync_at).toLocaleString()}
                  </span>
                  {' · '}
                  <span
                    className={cn(
                      'uppercase tracking-widest',
                      sheetsCfg.last_sync_status === 'ok' ? 'text-emerald-500' : 'text-red-500',
                    )}
                  >
                    {sheetsCfg.last_sync_status ?? 'unknown'}
                  </span>
                  {sheetsCfg.last_sync_log && (
                    <span className="block mt-0.5">→ {sheetsCfg.last_sync_log}</span>
                  )}
                </div>
              )}

              {/* Feedback inline */}
              {sheetsLastResult && (
                <div
                  className={cn(
                    'rounded-xl p-3 text-xs flex items-start gap-2 animate-in fade-in slide-in-from-top-2',
                    sheetsLastResult.kind === 'ok'
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-500'
                      : 'bg-red-500/10 border border-red-500/30 text-red-500',
                  )}
                >
                  {sheetsLastResult.kind === 'ok' ? (
                    <CheckCircle2 size={14} className="mt-0.5" />
                  ) : (
                    <AlertTriangle size={14} className="mt-0.5" />
                  )}
                  <div className="font-mono break-words">{sheetsLastResult.text}</div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      case 'outreach':
        return (
          <Card className="bg-card/50 border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="text-primary" size={20} /> Emails & CTA
              </CardTitle>
              <CardDescription>
                Le lien de ton calendrier de rendez-vous (Calendly, Cal.com, Google Calendar…) est
                utilisé par <strong className="text-foreground">défaut</strong> comme bouton CTA
                « Planifier un échange » dans tous les emails générés (Leadflow, Companies, fiche
                prospect). Modifiable à la volée dans chaque composer.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3 p-4 rounded-xl bg-secondary/20 border border-border">
                <div className="space-y-1">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <MailPlus size={14} className="text-primary" />
                    Lien calendrier de rendez-vous
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Exemples :{' '}
                    <span className="font-mono text-foreground">https://calendly.com/tunation/30min</span>{' '}
                    · <span className="font-mono text-foreground">https://cal.com/…</span> ·{' '}
                    <span className="font-mono text-foreground">https://calendar.app.google/…</span>
                  </p>
                </div>
                <input
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://calendly.com/votre-nom/30min"
                  value={outreachDraftUrl}
                  onChange={(e) => {
                    setOutreachDraftUrl(e.target.value);
                    setOutreachDirty(true);
                  }}
                  className="w-full h-10 px-3 rounded-lg bg-card border border-border focus:border-primary/40 focus:outline-none font-mono text-xs"
                />
              </div>

              {/* Sender (expéditeur) — Round 132 */}
              <div className="space-y-3 p-4 rounded-xl bg-secondary/20 border border-border">
                <div className="space-y-1">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <MailPlus size={14} className="text-emerald-400" />
                    Expéditeur des emails
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Nom affiché + adresse de réponse utilisés par l'Apps Script (Gmail) à l'envoi.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                      Nom affiché
                    </label>
                    <input
                      value={outreachSenderName}
                      onChange={(e) => {
                        setOutreachSenderName(e.target.value);
                        setOutreachDirty(true);
                      }}
                      placeholder="Tuna — Zentara"
                      className="w-full h-10 px-3 rounded-lg bg-card border border-border focus:border-primary/40 focus:outline-none text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                      Email expéditeur
                    </label>
                    <input
                      type="email"
                      value={outreachSenderEmail}
                      onChange={(e) => {
                        setOutreachSenderEmail(e.target.value);
                        setOutreachDirty(true);
                      }}
                      placeholder="tuna@zentara.app"
                      className="w-full h-10 px-3 rounded-lg bg-card border border-border focus:border-primary/40 focus:outline-none font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                      Reply-to
                    </label>
                    <input
                      type="email"
                      value={outreachReplyTo}
                      onChange={(e) => {
                        setOutreachReplyTo(e.target.value);
                        setOutreachDirty(true);
                      }}
                      placeholder="replies@zentara.app"
                      className="w-full h-10 px-3 rounded-lg bg-card border border-border focus:border-primary/40 focus:outline-none font-mono text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <Button
                  size="sm"
                  disabled={busy !== null || !outreachDirty}
                  onClick={handleOutreachSave}
                  className="bg-gradient-to-r from-primary to-accent hover:scale-[1.02] text-primary-foreground h-10 shadow-md transition-all"
                >
                  {busy === 'outreach-save' ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Save size={14} className="mr-2" />
                  )}
                  Enregistrer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null || !outreachCfg?.cta_calendar_url}
                  onClick={handleOutreachReset}
                  className="border-red-500/40 text-red-500 hover:bg-red-500/10 h-10"
                >
                  {busy === 'outreach-reset' ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Trash2 size={14} className="mr-2" />
                  )}
                  Effacer
                </Button>
              </div>

              {outreachCfg?.cta_calendar_url && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground border border-emerald-500/30 bg-emerald-500/10 rounded-xl p-3">
                  <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                  <span className="min-w-0">
                    CTA actif — les emails générés pointeront vers{' '}
                    <span className="font-mono text-emerald-500 break-all">
                      {outreachCfg.cta_calendar_url}
                    </span>
                  </span>
                </div>
              )}

              {/* Feedback inline */}
              {outreachResult && (
                <div
                  className={cn(
                    'rounded-xl p-3 text-xs flex items-start gap-2 animate-in fade-in slide-in-from-top-2',
                    outreachResult.kind === 'ok'
                      ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-500'
                      : 'bg-red-500/10 border border-red-500/30 text-red-500',
                  )}
                >
                  {outreachResult.kind === 'ok' ? (
                    <CheckCircle2 size={14} className="mt-0.5" />
                  ) : (
                    <AlertTriangle size={14} className="mt-0.5" />
                  )}
                  <div className="font-mono break-words">{outreachResult.text}</div>
                </div>
              )}
            </CardContent>
          </Card>
        );
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      {/* Header */}
      <header>
        <div className="flex items-center gap-2">
          <SettingsIcon size={16} className="text-primary" />
          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary">
            Settings
          </span>
        </div>
        <h1 className="text-3xl font-black tracking-tight mt-1">Centre de configuration</h1>
        <p className="text-sm text-muted-foreground">
          Profil, sécurité, données, IA et intégrations. Chaque section est autonome.
        </p>
      </header>

      {/* Layout 12-col : side nav (md:3) + content (md:9) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Side nav : horizontal pills sur mobile, vertical sur desktop */}
        <nav
          aria-label="Settings sections"
          className="md:col-span-3 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible"
        >
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                setActiveSection(s.id);
                setMessage(null);
              }}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left whitespace-nowrap md:whitespace-normal transition-all shrink-0',
                activeSection === s.id
                  ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                  : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
              )}
            >
              <span className={cn(activeSection === s.id ? 'text-white' : 'text-primary')}>
                {s.icon}
              </span>
              <span className="flex-1">
                <span className="text-sm font-semibold block leading-tight">{s.label}</span>
                <span
                  className={cn(
                    'text-[10px] hidden md:block',
                    activeSection === s.id ? 'opacity-80' : 'opacity-50',
                  )}
                >
                  {s.desc}
                </span>
              </span>
              <ChevronRight
                size={14}
                className={cn(activeSection === s.id ? 'opacity-100' : 'opacity-0')}
              />
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="md:col-span-9 space-y-4">
          {renderSection()}

          {/* Footer : version */}
          <footer className="flex items-center justify-center gap-2 text-[10px] text-muted-foreground uppercase tracking-[0.3em] pt-4 font-bold">
            <Info size={10} /> ZENTARA STRATEGIC · v1.0.0-BETA · Round 23
          </footer>
        </div>
      </div>

      {/* Toast global si message existe sur une autre section */}
      {message && activeSection !== 'data' && (
        <div
          className={cn(
            'fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl border text-xs font-medium backdrop-blur-md',
            message.kind === 'ok'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-500'
              : 'bg-red-500/15 border-red-500/40 text-red-500',
          )}
        >
          {message.text}
        </div>
      )}

      {/* Wipe confirmation modal */}
      <WipeConfirmModal
        open={wipeOpen}
        busy={wipeBusy}
        onCancel={() => setWipeOpen(false)}
        onConfirm={handleWipeConfirm}
      />
    </div>
  );
}

// =====================================================================
// Sub-components internes
// =====================================================================

function FieldRow({ label, value }: { label: string; value: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-xl bg-secondary/20 border border-border p-3">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="text-sm font-semibold mt-0.5 break-all">{value}</p>
    </div>
  );
}

function HealthPill({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: 'ok' | 'warn' | 'err';
}): React.ReactElement {
  const styles =
    status === 'ok'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500'
      : status === 'warn'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
        : 'border-red-500/30 bg-red-500/10 text-red-500';
  const dot =
    status === 'ok' ? 'bg-emerald-500' : status === 'warn' ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className={cn('flex items-center justify-between rounded-xl border px-4 py-3', styles)}>
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest opacity-80">{label}</p>
        <p className="text-sm font-semibold mt-0.5">{value}</p>
      </div>
      <span className={cn('w-2.5 h-2.5 rounded-full animate-pulse', dot)} aria-hidden />
    </div>
  );
}

/**
 * Round 24 — IntegrationPill : HealthPill amélioré avec un lien
 * (doc externe OU route interne) que l'user peut consulter.
 */
function IntegrationPill({
  label,
  value,
  status,
  doc,
  to,
}: {
  label: string;
  value: string;
  status: 'ok' | 'warn' | 'err';
  doc: { label: string; href: string | null } | null;
  to: { label: string; path: string } | null;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-border bg-secondary/10 px-4 py-3 hover:border-primary/30 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            {label}
          </p>
          <p className="text-sm font-semibold mt-0.5 truncate">{value}</p>
        </div>
        <span
          className={cn(
            'w-2.5 h-2.5 rounded-full shrink-0',
            status === 'ok'
              ? 'bg-emerald-500 shadow-lg shadow-emerald-500/40 animate-pulse'
              : status === 'warn'
                ? 'bg-amber-500'
                : 'bg-red-500',
          )}
          aria-hidden
        />
      </div>
      {(doc?.href || to) && (
        <div className="mt-1.5 pt-1.5 border-t border-border/30 flex items-center gap-3 text-[11px]">
          {doc?.href && (
            <a
              href={doc.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
            >
              <BookOpen size={10} />
              {doc.label}
              <ExternalLink size={9} />
            </a>
          )}
          {to && (
            <Link
              to={to.path}
              className="inline-flex items-center gap-1 text-primary hover:text-primary/80 font-bold ml-auto"
            >
              {to.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Round 24 — Petit bouton-lien externe (target=_blank, rel=noopener).
 */
function ExternalLinkButton({
  href,
  label,
}: {
  href: string;
  label: string;
}): React.ReactElement {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground bg-secondary/30 hover:bg-secondary/60 hover:text-foreground border border-border/40 transition-colors"
    >
      <ExternalLink size={11} />
      {label}
    </a>
  );
}

// Re-export unsecure keep linter silencieux sur les imports conditionnels
export const __keepSettings = { Lock };
