import React, { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Loader2, Brain } from 'lucide-react';

interface EntityActionsRowProps {
  entityType: 'page' | 'form' | 'object' | 'event';
  entityId: string;
  tenantId?: string | null;
}

interface KBAction {
  key: string;
  label: string;
  icon?: string;
  onInvoke: () => Promise<void>;
}

export default function EntityActionsRow({ entityType, entityId, tenantId }: EntityActionsRowProps) {
  const { user } = useAuth();
  const [actions, setActions] = useState<KBAction[]>([]);
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;

    async function loadHookActions() {
      if (!user?.roles || !entityId) return;

      try {
        const { getPluginHooks } = await import('@/plugins/loader');
        const hooks = getPluginHooks('knowledgeBase.entity.actions', user.roles);

        let context = {
          entityType,
          entityId,
          tenantId: tenantId ?? null,
          userRoles: user.roles,
          actions: [] as KBAction[],
        };

        for (const hook of hooks) {
          try {
            context = await hook.handler(context) as typeof context;
          } catch (err) {
            console.error(`Error executing entity actions hook:`, err);
          }
        }

        if (active) {
          setActions(context.actions || []);
        }
      } catch (err) {
        console.error('Failed to resolve plugin action hooks:', err);
      }
    }

    void loadHookActions();

    return () => {
      active = false;
    };
  }, [entityType, entityId, tenantId, user?.roles]);

  if (actions.length === 0) {
    return null;
  }

  const handleActionClick = async (action: KBAction) => {
    if (loadingMap[action.key]) return;

    setLoadingMap((prev) => ({ ...prev, [action.key]: true }));
    const loadingToast = toast.loading(`Synchronisiere "${action.label}"...`);

    try {
      await action.onInvoke();
      toast.success('Erfolgreich synchronisiert!', { id: loadingToast });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Fehler beim Synchronisieren.';
      toast.error(msg, { id: loadingToast });
    } finally {
      setLoadingMap((prev) => ({ ...prev, [action.key]: false }));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 py-2 border-t border-slate-100 dark:border-slate-800/60 mt-3 pt-4">
      {actions.map((action) => {
        const isLoading = loadingMap[action.key];
        return (
          <Button
            key={action.key}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleActionClick(action)}
            disabled={isLoading}
            className="gap-2 text-xs border-violet-200/50 hover:border-violet-300 hover:bg-violet-50/20 text-violet-700 hover:text-violet-800 dark:border-violet-900/35 dark:text-violet-400 dark:hover:bg-violet-950/25"
          >
            {isLoading ? (
              <Loader2 className="h-3 w-3 animate-spin text-violet-500" />
            ) : (
              <Brain className="h-3 w-3 text-violet-500 dark:text-violet-400" />
            )}
            {action.label}
          </Button>
        );
      })}
    </div>
  );
}
