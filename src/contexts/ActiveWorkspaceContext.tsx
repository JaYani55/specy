import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './AuthContext';
import { getTenantOptions, pickInitialTenantId, type TenantOption } from '@/services/tenantService';

interface ActiveWorkspaceContextValue {
  options: TenantOption[];
  activeTenantId: string;
  activeTenant: TenantOption | null;
  loading: boolean;
  setActiveTenantId: (tenantId: string) => void;
  refresh: () => Promise<void>;
}

const ActiveWorkspaceContext = createContext<ActiveWorkspaceContextValue | undefined>(undefined);

const storageKey = (userId: string) => `specy.active-workspace.${userId}`;

export function ActiveWorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [options, setOptions] = useState<TenantOption[]>([]);
  const [activeTenantId, setActiveTenantIdState] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user?.id) {
      setOptions([]);
      setActiveTenantIdState('');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const nextOptions = await getTenantOptions();
      setOptions(nextOptions);
      const stored = window.localStorage.getItem(storageKey(user.id));
      const nextTenantId = pickInitialTenantId(nextOptions, stored);
      setActiveTenantIdState(nextTenantId);
      if (nextTenantId) {
        window.localStorage.setItem(storageKey(user.id), nextTenantId);
      }
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setActiveTenantId = useCallback((tenantId: string) => {
    if (!options.some((option) => option.id === tenantId)) return;
    setActiveTenantIdState(tenantId);
    if (user?.id) window.localStorage.setItem(storageKey(user.id), tenantId);
    void queryClient.invalidateQueries();
  }, [options, queryClient, user?.id]);

  const value = useMemo<ActiveWorkspaceContextValue>(() => ({
    options,
    activeTenantId,
    activeTenant: options.find((option) => option.id === activeTenantId) ?? null,
    loading,
    setActiveTenantId,
    refresh,
  }), [activeTenantId, loading, options, refresh, setActiveTenantId]);

  return <ActiveWorkspaceContext.Provider value={value}>{children}</ActiveWorkspaceContext.Provider>;
}

export function useActiveWorkspace(): ActiveWorkspaceContextValue {
  const context = useContext(ActiveWorkspaceContext);
  if (!context) throw new Error('useActiveWorkspace must be used within ActiveWorkspaceProvider');
  return context;
}
