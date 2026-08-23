import * as React from "react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Loader2, Trash2, AlertTriangle } from "lucide-react";
import { useToast } from "@/contexts/ToastProvider";

export interface DeleteConfirmDialogProps {
  /** visible state — controlled */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** title of the item to delete (prospect name, company, etc.) */
  itemLabel: string;
  /** human entity type label (prospect, company, contact, etc.) */
  entityLabel?: string;
  /** extra detail to show in the dialog (e.g. "Score: 92 · 3 conversations actives") */
  meta?: string;
  /** what will be deleted along with it (children, relations…) */
  cascades?: string[];
  /** if true, show a "tapez SUPPRIMER pour confirmer" hard-confirm input */
  requireTypedConfirm?: boolean;
  /** the exact string the user must type (only if requireTypedConfirm=true) */
  confirmText?: string;
  /** async delete action; on success toast is fired automatically + this is called */
  onConfirm: () => Promise<void> | void;
  /** Optional custom success toast */
  successToast?: (
    label: string,
  ) =>
    | string
    | void
    | { title: string; description?: string };
  /** Optional custom failure toast */
  failureToastPrefix?: string;
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  itemLabel,
  entityLabel = "élément",
  meta,
  cascades = [],
  requireTypedConfirm = false,
  confirmText = "SUPPRIMER",
  onConfirm,
  successToast,
  failureToastPrefix = "Suppression impossible",
}: DeleteConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const typedOk = !requireTypedConfirm || typed.trim().toUpperCase() === confirmText.toUpperCase();

  const handleConfirm = async () => {
    if (loading || !typedOk) return;
    setLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
      const entityCapitalized =
        entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);
      if (successToast) {
        const result = successToast(itemLabel);
        // successToast peut retourner soit un string simple (toast 1 ligne)
        // soit `{ title, description }` pour un toast structuré.
        if (typeof result === 'string' && result) {
          toast.success(result);
        } else if (result && typeof result === 'object') {
          toast.successDetailed(result.title, result.description);
        } else {
          toast.successDetailed(`${entityCapitalized} supprimé`, itemLabel);
        }
      } else {
        toast.successDetailed(`${entityCapitalized} supprimé`, itemLabel);
      }
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        err?.message ||
        "Erreur inconnue — réessayez.";
      toast.errorDetailed(failureToastPrefix, message);
    } finally {
      setLoading(false);
      setTyped("");
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (loading) return; // empêche de fermer pendant le delete
    if (!next) setTyped("");
    onOpenChange(next);
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent size="md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/15 ring-1 ring-destructive/30">
              <Trash2 className="h-5 w-5 text-destructive" />
            </div>
            <div className="flex-1 min-w-0">
              <AlertDialogTitle>
                Supprimer {entityLabel} ?
              </AlertDialogTitle>
              {meta && (
                <div className="text-xs text-muted-foreground mt-0.5 truncate">
                  {meta}
                </div>
              )}
            </div>
          </div>
          <AlertDialogDescription>
            <div className="space-y-2 mt-2">
              <div className="text-sm">
                Vous allez supprimer définitivement{" "}
                <span className="font-semibold text-foreground break-all">
                  {itemLabel}
                </span>
                . Cette action est irréversible.
              </div>
              {cascades.length > 0 && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  <div className="flex items-center gap-1.5 mb-1 font-medium">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Éléments liés qui seront aussi supprimés :
                  </div>
                  <ul className="space-y-0.5 ml-5 list-disc">
                    {cascades.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {requireTypedConfirm && (
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-medium text-foreground">
                    Pour confirmer, tapez{" "}
                    <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">
                      {confirmText}
                    </span>{" "}
                    ci-dessous :
                  </label>
                  <input
                    type="text"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    autoFocus
                    spellCheck={false}
                    disabled={loading}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                  />
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Annuler</AlertDialogCancel>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={loading || !typedOk}
            className={buttonVariants({ variant: "destructive" }) + " min-w-[120px]"}
            data-testid="delete-confirm"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Suppression…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                Supprimer
              </>
            )}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
