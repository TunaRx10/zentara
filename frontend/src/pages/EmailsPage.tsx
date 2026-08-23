/**
 * EmailsPage — Round 132.
 *
 * Vue centralisée des emails d'outreach (table `outreach_emails`) :
 *   - liste + filtre par statut
 *   - édition du sujet / corps / statut (PATCH /api/outreach/emails/:id)
 *   - suppression (DELETE)
 *   - envoi HTML via l'Apps Script configuré (Gmail) avec aperçu
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail, RefreshCw, Pencil, Trash2, Send, Eye, X, Loader2, CheckCircle2, Inbox, Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getApiClient } from '@/services/api/client';
import { useToast } from '@/contexts/ToastProvider';
import { buildEmailHtml } from '@/lib/email-template';
import { cn } from '@/lib/utils';

interface OutreachEmailRow {
  id: string;
  prospect_id: string;
  company_id: string | null;
  tone: string;
  subject: string;
  body: string;
  status: string;
  sent_at: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
  metadata: string | null;
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Brouillon', cls: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30' },
  scheduled: { label: 'Programmé', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  sent: { label: 'Envoyé', cls: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  opened: { label: 'Ouvert', cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  replied: { label: 'Répondu', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  bounced: { label: 'Bounced', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
  failed: { label: 'Échoué', cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
};

const FILTERS = ['all', 'draft', 'sent', 'replied', 'bounced', 'failed'] as const;

export function EmailsPage(): React.ReactElement {
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = React.useState<OutreachEmailRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>('all');
  const [editing, setEditing] = React.useState<OutreachEmailRow | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const api = getApiClient();
      const data = await api.get<OutreachEmailRow[]>('/outreach/inbox', { query: { limit: 200 } });
      setRows(data ?? []);
    } catch (e) {
      toast.error(`Chargement des emails : ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const visible = filter === 'all' ? rows : rows.filter((r) => r.status === filter);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-20">
      <header className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-primary" />
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-primary">Outreach</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight mt-1">Emails</h1>
          <p className="text-sm text-muted-foreground">
            Voir, modifier et supprimer les emails d'outreach générés par l'IA.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => load()} disabled={loading} className="border-border">
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} /> Actualiser
        </Button>
      </header>

      {/* Filtres statut */}
      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => {
          const count = f === 'all' ? rows.length : rows.filter((r) => r.status === f).length;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'h-8 px-3 rounded-lg border text-[10px] uppercase font-black tracking-widest transition-all',
                filter === f
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border bg-background/60 text-muted-foreground hover:bg-primary/10',
              )}
            >
              {f} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> Chargement…
        </div>
      ) : visible.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-border rounded-2xl text-muted-foreground">
          <Inbox size={28} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">Aucun email {filter !== 'all' ? `avec le statut « ${filter} »` : ''}.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border overflow-hidden">
          {visible.map((r) => {
            const sm = STATUS_META[r.status] ?? STATUS_META.draft;
            return (
              <div
                key={r.id}
                className="flex items-center gap-3 px-4 py-3 border-t border-border/40 first:border-t-0 hover:bg-secondary/20 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  className="flex-1 min-w-0 text-left group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                      {r.subject || '(sans sujet)'}
                    </span>
                    <span className={cn('shrink-0 text-[9px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full border', sm.cls)}>
                      {sm.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {r.tone} · {r.prospect_id} · {new Date(r.updated_at).toLocaleString()}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(r)}
                  className="h-8 w-8 rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground flex items-center justify-center"
                >
                  <Pencil size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {editing && <EmailEditModal email={editing} onClose={() => setEditing(null)} onChanged={load} onOpenProspect={() => navigate(`/prospects/${editing.prospect_id}`)} />}
    </div>
  );
}

function EmailEditModal({
  email,
  onClose,
  onChanged,
  onOpenProspect,
}: {
  email: OutreachEmailRow;
  onClose: () => void;
  onChanged: () => void;
  onOpenProspect: () => void;
}): React.ReactElement {
  const toast = useToast();
  const [subject, setSubject] = React.useState(email.subject ?? '');
  const [body, setBody] = React.useState(email.body ?? '');
  const [status, setStatus] = React.useState(email.status ?? 'draft');
  const [to, setTo] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  // Round 133 — réécriture IA (instruction + format HTML/CSS ou texte).
  const [instruction, setInstruction] = React.useState('');
  const [format, setFormat] = React.useState<'html' | 'text'>('html');
  const [rewriting, setRewriting] = React.useState(false);

  // Récupère l'email du prospect pour l'envoi.
  React.useEffect(() => {
    (async () => {
      try {
        const api = getApiClient();
        const p = await api.get<{ email?: string | null; first_name?: string | null; last_name?: string | null }>(
          `/prospects/${email.prospect_id}`,
        );
        if (p?.email) setTo(p.email);
      } catch {
        /* silencieux */
      }
    })();
  }, [email.prospect_id]);

  const { html } = React.useMemo(
    () =>
      buildEmailHtml({
        companyName: email.prospect_id,
        body,
        recipientName: null,
        signature: 'L’équipe Zentara — Enterprise Intelligence',
      }),
    [email.prospect_id, body],
  );

  const handleSave = async () => {
    setBusy(true);
    try {
      const api = getApiClient();
      await api.patch<OutreachEmailRow>(`/outreach/emails/${email.id}`, {
        subject: subject.trim(),
        body,
        status,
      });
      toast.success('Email mis à jour.');
      onChanged();
      onClose();
    } catch (e) {
      toast.error(`Mise à jour impossible : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Supprimer définitivement cet email ?')) return;
    setBusy(true);
    try {
      const api = getApiClient();
      await api.delete<{ deleted: boolean }>(`/outreach/emails/${email.id}`);
      toast.success('Email supprimé.');
      onChanged();
      onClose();
    } catch (e) {
      toast.error(`Suppression impossible : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRewrite = async () => {
    if (!instruction.trim()) {
      toast.error('Décris la modification souhaitée.');
      return;
    }
    setRewriting(true);
    try {
      const api = getApiClient();
      const r = await api.post<{
        subject: string;
        body: string;
        format: string;
        provider?: string;
        model?: string;
        fallback?: boolean;
      }>(`/outreach/emails/${email.id}/rewrite`, {
        instruction: instruction.trim(),
        format,
      });
      setSubject(r.subject);
      setBody(r.body);
      toast.success(`Email réécrit par l'IA${r.fallback ? ' (via fallback)' : ''}.`);
    } catch (e) {
      toast.error(`Réécriture impossible : ${(e as Error).message}`);
    } finally {
      setRewriting(false);
    }
  };

  const handleSend = async () => {
    if (!to) {
      toast.error('Aucun destinataire — renseigne un email.');
      return;
    }
    setBusy(true);
    try {
      const api = getApiClient();
      const r = await api.post<{ ok: boolean; error?: string | null }>('/integrations/sheets/send-email', {
        to,
        subject: subject.trim(),
        html,
        prospect_id: email.prospect_id,
      });
      if (r.ok) {
        toast.success(`Envoyé à ${to} via Apps Script (Gmail).`);
      } else {
        toast.error(`Envoi refusé : ${r.error ?? 'vérifie l\'URL Apps Script dans Réglages → Sheets Sync.'}`);
      }
    } catch (e) {
      toast.error(`Envoi impossible : ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="w-[calc(100vw-32px)] max-w-2xl rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-border/60 bg-secondary/20">
          <div className="min-w-0">
            <h3 className="text-sm font-black tracking-tight flex items-center gap-2">
              <Pencil size={15} className="text-primary" /> Modifier l'email
            </h3>
            <button type="button" onClick={onOpenProspect} className="text-[11px] text-primary hover:underline">
              {email.prospect_id}
            </button>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Destinataire</label>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="email@entreprise.com" className="w-full h-10 px-3 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm font-mono" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Statut</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm">
                {Object.entries(STATUS_META).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Sujet</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full h-10 px-3 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm" />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground">Message</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full px-3 py-2 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm resize-none" />
          </div>

          {/* Round 133 — réécriture IA (HTML/CSS ou texte) */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-widest font-black text-primary flex items-center gap-1.5">
                <Sparkles size={11} /> Réécrire par l'IA
              </span>
              <div className="flex gap-1">
                {(['html', 'text'] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFormat(f)}
                    className={cn(
                      'h-7 px-2.5 rounded-md text-[10px] font-black uppercase tracking-wider border transition-colors',
                      format === f
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border/60 text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {f === 'html' ? 'HTML/CSS' : 'Texte'}
                  </button>
                ))}
              </div>
            </div>
            <input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleRewrite(); }}
              placeholder="Ex : raccourcis-le, rends-le plus percutant, ton plus formel, traduis en anglais…"
              className="w-full h-10 px-3 rounded-lg bg-background border border-border focus:border-primary/40 focus:outline-none text-sm"
            />
            <button
              type="button"
              onClick={handleRewrite}
              disabled={rewriting || !instruction.trim()}
              className="w-full h-9 rounded-lg bg-primary text-primary-foreground text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50 transition-opacity"
            >
              {rewriting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {rewriting ? 'Réécriture…' : 'Appliquer la modification'}
            </button>
          </div>

          <div className="space-y-1">
            <button type="button" onClick={() => setShowPreview((v) => !v)} className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground flex items-center gap-1.5 hover:text-primary transition-colors">
              <Eye size={11} /> {showPreview ? 'Masquer' : 'Aperçu HTML'} — rendu final
            </button>
            {showPreview && (
              <iframe title="Aperçu" srcDoc={html} className="w-full rounded-lg border border-border bg-white" style={{ height: 360 }} sandbox="" />
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={handleDelete} disabled={busy} className="border-red-500/40 text-red-500 hover:bg-red-500/10">
              <Trash2 size={14} className="mr-1" /> Supprimer
            </Button>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>Annuler</Button>
              <Button size="sm" onClick={handleSend} disabled={busy || !to || !subject.trim() || !body.trim()} className="gap-1">
                <Send size={13} /> Envoyer via Gmail
              </Button>
              <Button size="sm" onClick={handleSave} disabled={busy || !subject.trim() || !body.trim()} className="gap-1">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Enregistrer
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
