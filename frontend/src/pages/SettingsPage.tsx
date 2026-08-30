/**
 * SettingsPage — Page de configuration Zentara.
 * 
 * Sections :
 * - Profil utilisateur
 * - Préférences d'analyse
 * - Configuration email (signature, templates par défaut)
 * - Intégrations (Calendly, CRM)
 * - Notifications
 * - API keys
 * - Export/Import données
 */
import React, { useState } from 'react';
import {
  User,
  Mail,
  Bell,
  Key,
  Link2,
  Download,
  Upload,
  Save,
  Shield,
  Palette,
  Globe,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Settings,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── API Key Field Component ────────────────────────────────────────────────
interface ApiKeyFieldProps {
  label: string;
  description: string;
  defaultValue: string;
  onChange: (value: string) => void;
  status: 'configured' | 'required' | 'optional';
  link?: string;
}

function ApiKeyField({ label, description, defaultValue, onChange, status, link }: ApiKeyFieldProps): React.ReactElement {
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState(defaultValue);

  const handleChange = (v: string) => {
    setValue(v);
    onChange(v);
  };

  const statusConfig = {
    configured: { label: 'Configuré', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30' },
    required: { label: 'Requis', color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30' },
    optional: { label: 'Optionnel', color: 'text-muted-foreground', bg: 'bg-secondary/30 border-border/40' },
  };

  const statusStyle = statusConfig[status];

  return (
    <div className="rounded-xl border border-border/40 bg-card/60 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold">{label}</span>
          <span className={cn('text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border', statusStyle.bg, statusStyle.color)}>
            {statusStyle.label}
          </span>
        </div>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-primary hover:text-primary/80">
            Obtenir <ExternalLink size={9} />
          </a>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mb-2">{description}</p>
      <div className="flex items-center gap-2">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={`Entrez votre clé ${label}`}
          className="flex-1 px-3 py-1.5 rounded-lg border border-border/50 bg-secondary/30 text-sm font-mono focus:outline-none focus:border-primary/50"
        />
        <button
          onClick={() => setVisible(!visible)}
          className="w-8 h-8 rounded-lg bg-secondary/50 hover:bg-secondary flex items-center justify-center text-muted-foreground transition-colors"
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
        {value && status === 'configured' && (
          <CheckCircle2 size={16} className="text-emerald-400" />
        )}
      </div>
    </div>
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────
interface SettingsSection {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
}

const settingsSections: SettingsSection[] = [
  { id: 'profile', name: 'Profil', icon: <User size={16} />, description: 'Informations personnelles et entreprise' },
  { id: 'analysis', name: 'Analyse', icon: <Settings size={16} />, description: 'Critères et seuils de scoring' },
  { id: 'email', name: 'Email', icon: <Mail size={16} />, description: 'Signature, templates, configuration SMTP' },
  { id: 'integrations', name: 'Intégrations', icon: <Link2 size={16} />, description: 'Calendly, CRM, outils tiers' },
  { id: 'notifications', name: 'Notifications', icon: <Bell size={16} />, description: 'Alertes et rappels' },
  { id: 'api', name: 'API & Clés', icon: <Key size={16} />, description: 'Clés API et webhooks' },
  { id: 'data', name: 'Données', icon: <Database size={16} />, description: 'Export, import, rétention' },
  { id: 'appearance', name: 'Apparence', icon: <Palette size={16} />, description: 'Thème et préférences visuelles' },
];

export function SettingsPage(): React.ReactElement {
  const [activeSection, setActiveSection] = useState('profile');
  const [saved, setSaved] = useState(false);

  // API Keys state
  const [apiKeys, setApiKeys] = useState({
    nvidia: '',
    gemini: '',
    openrouter: '',
    mistral: '',
    googleMaps: '',
    serpapi: '',
    outscraper: '',
    linkedinUsername: '',
    linkedinPassword: '',
    twoCaptcha: '',
    linkedinProxy: '',
    opencorporates: '',
  });

  const setApiKey = (key: string, value: string) => {
    setApiKeys((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = () => {
    // TODO: Save to backend API (/settings/api-keys)
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="space-y-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight">Paramètres</h1>
          <p className="text-sm text-muted-foreground">Configuration de votre espace Zentara</p>
        </div>
        <button
          onClick={handleSave}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all',
            saved
              ? 'bg-emerald-500 text-white'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
          {saved ? 'Sauvegardé !' : 'Sauvegarder'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Sidebar */}
        <div className="rounded-2xl border border-border/60 bg-card/40 overflow-hidden h-fit">
          <div className="p-2 space-y-0.5">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'w-full flex items-center gap-3 rounded-xl p-3 text-left transition-all duration-200',
                  activeSection === section.id
                    ? 'bg-primary/15 text-primary'
                    : 'hover:bg-secondary/30 text-muted-foreground',
                )}
              >
                <div className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center',
                  activeSection === section.id ? 'bg-primary/20' : 'bg-secondary/30',
                )}>
                  {section.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold">{section.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{section.description}</p>
                </div>
                <ChevronRight size={12} className={cn(
                  'transition-transform',
                  activeSection === section.id && 'rotate-90',
                )} />
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-3 space-y-4">
          {/* Profile section */}
          {activeSection === 'profile' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <h3 className="text-sm font-black mb-4">Informations personnelles</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Prénom</label>
                    <input
                      type="text"
                      defaultValue="Jean"
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Nom</label>
                    <input
                      type="text"
                      defaultValue="Dupont"
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Email</label>
                    <input
                      type="email"
                      defaultValue="jean@zentara.app"
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Poste</label>
                    <input
                      type="text"
                      defaultValue="Sales Director"
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <h3 className="text-sm font-black mb-4">Entreprise</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Nom</label>
                    <input
                      type="text"
                      defaultValue="Zentara"
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Site web</label>
                    <input
                      type="url"
                      defaultValue="https://zentara.app"
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Email section */}
          {activeSection === 'email' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <h3 className="text-sm font-black mb-4">Signature email</h3>
                <textarea
                  defaultValue={`Jean Dupont\nSales Director | Zentara\n📧 jean@zentara.app\n🌐 zentara.app`}
                  rows={5}
                  className="w-full px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm focus:outline-none focus:border-primary/50 resize-none"
                />
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <h3 className="text-sm font-black mb-4">Template par défaut</h3>
                <div className="space-y-2">
                  {['Premier contact premium', 'Relance douce', 'Proposition de valeur chiffrée'].map((t, i) => (
                    <div key={i} className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/60 p-3">
                      <input type="radio" name="defaultTemplate" defaultChecked={i === 0} className="accent-primary" />
                      <div>
                        <p className="text-xs font-bold">{t}</p>
                        <p className="text-[10px] text-muted-foreground">Utilisé pour les nouvelles campagnes</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-center gap-2">
                  <AlertCircle size={14} className="text-amber-400" />
                  <p className="text-xs font-bold text-amber-400">Configuration SMTP requise</p>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Configurez votre serveur SMTP pour envoyer des emails directement depuis Zentara.
                </p>
                <button className="mt-3 px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-400 text-xs font-bold hover:bg-amber-500/25 transition-colors">
                  Configurer SMTP
                </button>
              </div>
            </div>
          )}

          {/* Integrations section */}
          {activeSection === 'integrations' && (
            <div className="space-y-3">
              {[
                { name: 'Calendly', desc: 'Planification de RDV', connected: true, icon: '📅' },
                { name: 'HubSpot', desc: 'Synchronisation CRM', connected: false, icon: '🔶' },
                { name: 'Salesforce', desc: 'Synchronisation CRM', connected: false, icon: '☁️' },
                { name: 'Slack', desc: 'Notifications équipe', connected: true, icon: '💬' },
                { name: 'Google Workspace', desc: 'Emails et Calendar', connected: true, icon: '📧' },
              ].map((int, i) => (
                <div key={i} className="flex items-center gap-4 rounded-2xl border border-border/60 bg-card/40 p-4">
                  <div className="w-10 h-10 rounded-xl bg-secondary/30 flex items-center justify-center text-xl">
                    {int.icon}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold">{int.name}</p>
                    <p className="text-[10px] text-muted-foreground">{int.desc}</p>
                  </div>
                  <button className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-bold transition-colors',
                    int.connected
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-secondary/50 text-muted-foreground hover:text-foreground border border-border/50',
                  )}>
                    {int.connected ? 'Connecté' : 'Connecter'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Notifications section */}
          {activeSection === 'notifications' && (
            <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
              <h3 className="text-sm font-black mb-4">Préférences de notification</h3>
              <div className="space-y-3">
                {[
                  { label: 'Prospect chaud détecté', desc: 'Quand un prospect passe en statut chaud', enabled: true },
                  { label: 'Email ouvert', desc: 'Quand un destinataire ouvre votre email', enabled: true },
                  { label: 'Réponse reçue', desc: 'Quand un prospect répond à un email', enabled: true },
                  { label: 'Résumé quotidien', desc: 'Résumé des activités chaque matin', enabled: false },
                  { label: 'Rappel de suivi', desc: 'Prospects sans activité depuis 5 jours', enabled: true },
                  { label: 'Nouvelle analyse terminée', desc: 'Quand une analyse scoring est complète', enabled: true },
                ].map((notif, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/60 p-3">
                    <button className={cn(
                      'w-10 h-5 rounded-full transition-colors relative',
                      notif.enabled ? 'bg-primary' : 'bg-secondary/50',
                    )}>
                      <div className={cn(
                        'absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                        notif.enabled ? 'left-5' : 'left-0.5',
                      )} />
                    </button>
                    <div className="flex-1">
                      <p className="text-xs font-bold">{notif.label}</p>
                      <p className="text-[10px] text-muted-foreground">{notif.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data section */}
          {activeSection === 'data' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <h3 className="text-sm font-black mb-4">Export des données</h3>
                <div className="grid grid-cols-2 gap-3">
                  <button className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 p-3 hover:bg-card/80 transition-colors">
                    <Download size={14} className="text-primary" />
                    <div className="text-left">
                      <p className="text-xs font-bold">Prospects (CSV)</p>
                      <p className="text-[10px] text-muted-foreground">247 entrées</p>
                    </div>
                  </button>
                  <button className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 p-3 hover:bg-card/80 transition-colors">
                    <Download size={14} className="text-primary" />
                    <div className="text-left">
                      <p className="text-xs font-bold">Companies (CSV)</p>
                      <p className="text-[10px] text-muted-foreground">68 entrées</p>
                    </div>
                  </button>
                  <button className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 p-3 hover:bg-card/80 transition-colors">
                    <Download size={14} className="text-primary" />
                    <div className="text-left">
                      <p className="text-xs font-bold">Analyses (JSON)</p>
                      <p className="text-[10px] text-muted-foreground">156 entrées</p>
                    </div>
                  </button>
                  <button className="flex items-center gap-2 rounded-xl border border-border/40 bg-card/60 p-3 hover:bg-card/80 transition-colors">
                    <Download size={14} className="text-primary" />
                    <div className="text-left">
                      <p className="text-xs font-bold">Rapport complet</p>
                      <p className="text-[10px] text-muted-foreground">PDF + données</p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <h3 className="text-sm font-black mb-4">Import</h3>
                <div className="rounded-xl border-2 border-dashed border-border/50 p-8 text-center">
                  <Upload size={32} className="mx-auto text-muted-foreground/30 mb-3" />
                  <p className="text-sm font-bold text-muted-foreground">Glissez vos fichiers ici</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">CSV, XLSX, JSON (max 10MB)</p>
                  <button className="mt-3 px-4 py-2 rounded-xl bg-primary/15 text-primary text-xs font-bold hover:bg-primary/25 transition-colors">
                    Parcourir
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Analysis section */}
          {activeSection === 'analysis' && (
            <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
              <h3 className="text-sm font-black mb-4">Configuration du scoring</h3>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                    Seuil prospect chaud
                  </label>
                  <div className="flex items-center gap-3 mt-1">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      defaultValue="70"
                      className="flex-1 accent-primary"
                    />
                    <span className="text-sm font-black w-12 text-right">70</span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                    Seuil prospect tiède
                  </label>
                  <div className="flex items-center gap-3 mt-1">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      defaultValue="40"
                      className="flex-1 accent-primary"
                    />
                    <span className="text-sm font-black w-12 text-right">40</span>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">
                    Période d'inactivité (jours)
                  </label>
                  <input
                    type="number"
                    defaultValue="5"
                    className="w-full mt-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm focus:outline-none focus:border-primary/50"
                  />
                </div>
              </div>
            </div>
          )}

          {/* API section — Clés API complètes */}
          {activeSection === 'api' && (
            <div className="space-y-4">
              {/* Status indicator */}
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-emerald-400" />
                  <p className="text-xs font-bold text-emerald-400">Backend connecté</p>
                  <span className="text-[10px] text-muted-foreground ml-auto">http://localhost:4000/api</span>
                </div>
              </div>

              {/* AI Providers */}
              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Key size={14} className="text-primary" />
                  <h3 className="text-sm font-black">AI Providers</h3>
                  <span className="text-[10px] text-muted-foreground ml-auto">Configurez au moins un provider</span>
                </div>
                <div className="space-y-4">
                  {/* NVIDIA */}
                  <ApiKeyField
                    label="NVIDIA NIM"
                    description="Principal — https://build.nvidia.com"
                    defaultValue={apiKeys.nvidia}
                    onChange={(v) => setApiKey('nvidia', v)}
                    status={apiKeys.nvidia ? 'configured' : 'required'}
                    link="https://build.nvidia.com/explore/discover"
                  />
                  {/* Gemini */}
                  <ApiKeyField
                    label="Google Gemini"
                    description="Fallback — https://aistudio.google.com"
                    defaultValue={apiKeys.gemini}
                    onChange={(v) => setApiKey('gemini', v)}
                    status={apiKeys.gemini ? 'configured' : 'optional'}
                    link="https://aistudio.google.com/apikey"
                  />
                  {/* OpenRouter */}
                  <ApiKeyField
                    label="OpenRouter"
                    description="Fallback — https://openrouter.ai"
                    defaultValue={apiKeys.openrouter}
                    onChange={(v) => setApiKey('openrouter', v)}
                    status={apiKeys.openrouter ? 'configured' : 'optional'}
                    link="https://openrouter.ai/keys"
                  />
                  {/* Mistral */}
                  <ApiKeyField
                    label="Mistral AI"
                    description="Fallback — https://console.mistral.ai"
                    defaultValue={apiKeys.mistral}
                    onChange={(v) => setApiKey('mistral', v)}
                    status={apiKeys.mistral ? 'configured' : 'optional'}
                    link="https://console.mistral.ai/api-keys"
                  />
                </div>
              </div>

              {/* Maps & Search */}
              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Globe size={14} className="text-blue-400" />
                  <h3 className="text-sm font-black">Maps & Search</h3>
                  <span className="text-[10px] text-muted-foreground ml-auto">Enrichissement géolocalisé</span>
                </div>
                <div className="space-y-4">
                  <ApiKeyField
                    label="Google Maps API"
                    description="Places API — https://console.cloud.google.com"
                    defaultValue={apiKeys.googleMaps}
                    onChange={(v) => setApiKey('googleMaps', v)}
                    status={apiKeys.googleMaps ? 'configured' : 'optional'}
                    link="https://console.cloud.google.com/apis/credentials"
                  />
                  <ApiKeyField
                    label="SerpAPI"
                    description="Alternative maps — https://serpapi.com"
                    defaultValue={apiKeys.serpapi}
                    onChange={(v) => setApiKey('serpapi', v)}
                    status={apiKeys.serpapi ? 'configured' : 'optional'}
                    link="https://serpapi.com/dashboard"
                  />
                  <ApiKeyField
                    label="Outscraper"
                    description="Alternative maps — https://outscraper.com"
                    defaultValue={apiKeys.outscraper}
                    onChange={(v) => setApiKey('outscraper', v)}
                    status={apiKeys.outscraper ? 'configured' : 'optional'}
                    link="https://outscraper.com/api-dashboard"
                  />
                </div>
              </div>

              {/* LinkedIn */}
              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Shield size={14} className="text-purple-400" />
                  <h3 className="text-sm font-black">LinkedIn (StaffSpy)</h3>
                  <span className="text-[10px] text-muted-foreground ml-auto">Scraping de profils</span>
                </div>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Email</label>
                      <input
                        type="email"
                        defaultValue={apiKeys.linkedinUsername}
                        onChange={(e) => setApiKey('linkedinUsername', e.target.value)}
                        placeholder="votre@email.com"
                        className="w-full mt-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm focus:outline-none focus:border-primary/50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Mot de passe</label>
                      <input
                        type="password"
                        defaultValue={apiKeys.linkedinPassword}
                        onChange={(e) => setApiKey('linkedinPassword', e.target.value)}
                        placeholder="••••••••"
                        className="w-full mt-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm focus:outline-none focus:border-primary/50"
                      />
                    </div>
                  </div>
                  <ApiKeyField
                    label="2Captcha"
                    description="Bypass anti-bot — https://2captcha.com"
                    defaultValue={apiKeys.twoCaptcha}
                    onChange={(v) => setApiKey('twoCaptcha', v)}
                    status={apiKeys.twoCaptcha ? 'configured' : 'optional'}
                    link="https://2captcha.com/enterpage"
                  />
                  <div>
                    <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Proxy résidentiel</label>
                    <input
                      type="text"
                      defaultValue={apiKeys.linkedinProxy}
                      onChange={(e) => setApiKey('linkedinProxy', e.target.value)}
                      placeholder="http://user:pass@host:port"
                      className="w-full mt-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm font-mono focus:outline-none focus:border-primary/50"
                    />
                  </div>
                </div>
              </div>

              {/* OpenCorporates */}
              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Database size={14} className="text-amber-400" />
                  <h3 className="text-sm font-black">OpenCorporates</h3>
                  <span className="text-[10px] text-muted-foreground ml-auto">Base de données entreprises</span>
                </div>
                <ApiKeyField
                  label="OpenCorporates API"
                  description="Enrichissement entreprises — https://opencorporates.com"
                  defaultValue={apiKeys.opencorporates}
                  onChange={(v) => setApiKey('opencorporates', v)}
                  status={apiKeys.opencorporates ? 'configured' : 'optional'}
                  link="https://opencorporates.com/api_accounts/new"
                />
              </div>

              {/* Zentara API Key */}
              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <h3 className="text-sm font-black mb-4">Clé API Zentara</h3>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    defaultValue="zk_live_xxxxxxxxxxxxxxxx"
                    className="flex-1 px-3 py-2 rounded-xl border border-border/50 bg-card/50 text-sm font-mono focus:outline-none focus:border-primary/50"
                    readOnly
                  />
                  <button className="px-3 py-2 rounded-xl bg-secondary/50 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors">
                    Copier
                  </button>
                  <button className="px-3 py-2 rounded-xl bg-red-500/15 text-red-400 text-xs font-bold hover:bg-red-500/25 transition-colors">
                    Régénérer
                  </button>
                </div>
              </div>

              {/* Webhooks */}
              <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
                <h3 className="text-sm font-black mb-4">Webhooks</h3>
                <div className="rounded-xl border border-border/40 bg-card/60 p-3">
                  <p className="text-xs font-mono text-muted-foreground">https://zentara.app/api/webhooks/{'{id}'}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Recevez des notifications en temps réel</p>
                </div>
              </div>
            </div>
          )}

          {/* Appearance section */}
          {activeSection === 'appearance' && (
            <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
              <h3 className="text-sm font-black mb-4">Thème</h3>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { name: 'Sombre', active: true, colors: ['#0a0a0a', '#22c55e', '#1e293b'] },
                  { name: 'Clair', active: false, colors: ['#ffffff', '#22c55e', '#f1f5f9'] },
                  { name: 'Système', active: false, colors: ['#0f172a', '#10b981', '#334155'] },
                ].map((theme, i) => (
                  <button
                    key={i}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-all',
                      theme.active
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border/40 bg-card/60 hover:bg-card/80',
                    )}
                  >
                    <div className="flex items-center gap-1 mb-2">
                      {theme.colors.map((c, j) => (
                        <div key={j} className="w-4 h-4 rounded-full border border-border/30" style={{ background: c }} />
                      ))}
                    </div>
                    <p className="text-xs font-bold">{theme.name}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
