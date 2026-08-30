/**
 * QuickActions — Panneau d'actions rapides contextuelles.
 * 
 * Propose des actions intelligentes basées sur :
 * - Prospects chauds sans activité récente
 * - Emails en attente de suivi
 * - Tâches prioritaires
 * - Rappels automatiques
 */
import React, { useState } from 'react';
import {
  Zap,
  Mail,
  Phone,
  Calendar,
  UserPlus,
  FileText,
  Clock,
  CheckCircle2,
  ArrowRight,
  Bell,
  Target,
  MoreHorizontal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface QuickAction {
  id: string;
  type: 'email' | 'call' | 'meeting' | 'task' | 'followup';
  title: string;
  description: string;
  entity: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  dueIn?: string;
  onExecute: () => void;
  onDismiss: () => void;
}

interface QuickActionsProps {
  actions: QuickAction[];
  onViewAll?: () => void;
  className?: string;
}

const typeConfig = {
  email: { icon: Mail, color: 'text-blue-400', bg: 'bg-blue-500/15' },
  call: { icon: Phone, color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
  meeting: { icon: Calendar, color: 'text-purple-400', bg: 'bg-purple-500/15' },
  task: { icon: FileText, color: 'text-amber-400', bg: 'bg-amber-500/15' },
  followup: { icon: Clock, color: 'text-red-400', bg: 'bg-red-500/15' },
};

const priorityConfig = {
  urgent: { label: 'Urgent', color: 'text-red-400', border: 'border-red-500/40' },
  high: { label: 'Haute', color: 'text-amber-400', border: 'border-amber-500/40' },
  medium: { label: 'Moyenne', color: 'text-blue-400', border: 'border-blue-500/40' },
  low: { label: 'Basse', color: 'text-muted-foreground', border: 'border-border/40' },
};

export function QuickActions({ actions, onViewAll, className }: QuickActionsProps): React.ReactElement {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [executing, setExecuting] = useState<Set<string>>(new Set());

  const visibleActions = actions.filter(a => !dismissed.has(a.id));

  const handleExecute = async (action: QuickAction) => {
    setExecuting(prev => new Set(prev).add(action.id));
    await action.onExecute();
    setExecuting(prev => { const n = new Set(prev); n.delete(action.id); return n; });
  };

  const handleDismiss = (action: QuickAction) => {
    action.onDismiss();
    setDismissed(prev => new Set(prev).add(action.id));
  };

  if (visibleActions.length === 0) {
    return (
      <div className={cn('rounded-2xl border border-border/60 bg-card/40 p-6 text-center', className)}>
        <CheckCircle2 size={32} className="mx-auto text-emerald-400 mb-2" />
        <p className="text-sm font-bold text-emerald-400">Tout est à jour !</p>
        <p className="text-xs text-muted-foreground mt-1">Aucune action urgente</p>
      </div>
    );
  }

  return (
    <div className={cn('rounded-2xl border border-border/60 bg-card/40 overflow-hidden', className)}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/40 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
              <Zap size={16} />
            </div>
            <div>
              <h3 className="text-sm font-black tracking-tight">Actions rapides</h3>
              <p className="text-[10px] text-muted-foreground">{visibleActions.length} actions prioritaires</p>
            </div>
          </div>
          {onViewAll && (
            <button
              onClick={onViewAll}
              className="text-[10px] font-bold text-primary hover:text-primary/80 flex items-center gap-1"
            >
              Voir tout <ArrowRight size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Actions list */}
      <div className="p-2 space-y-1.5 max-h-[400px] overflow-y-auto">
        {visibleActions.map((action) => {
          const type = typeConfig[action.type];
          const priority = priorityConfig[action.priority];
          const Icon = type.icon;
          const isExecuting = executing.has(action.id);

          return (
            <div
              key={action.id}
              className={cn(
                'group relative rounded-xl border p-3 transition-all duration-200 hover:scale-[1.01]',
                priority.border,
                'bg-card/60 hover:bg-card/80',
              )}
            >
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', type.bg)}>
                  {isExecuting ? (
                    <Clock size={16} className={cn(type.color, 'animate-spin')} />
                  ) : (
                    <Icon size={16} className={type.color} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h4 className="text-xs font-bold truncate">{action.title}</h4>
                    <span className={cn('text-[9px] font-bold uppercase', priority.color)}>
                      {priority.label}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate">{action.description}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-foreground font-medium">{action.entity}</span>
                    {action.dueIn && (
                      <span className="text-[10px] text-amber-400 flex items-center gap-0.5">
                        <Clock size={9} /> {action.dueIn}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleExecute(action)}
                    disabled={isExecuting}
                    className="w-7 h-7 rounded-lg bg-primary/15 text-primary hover:bg-primary/25 flex items-center justify-center transition-colors"
                    title="Exécuter"
                  >
                    <CheckCircle2 size={14} />
                  </button>
                  <button
                    onClick={() => handleDismiss(action)}
                    className="w-7 h-7 rounded-lg bg-secondary/50 hover:bg-secondary text-muted-foreground flex items-center justify-center transition-colors"
                    title="Ignorer"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default QuickActions;
