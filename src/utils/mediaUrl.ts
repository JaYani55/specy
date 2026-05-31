import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import type { PluginHookContribution } from '@/types/plugin';

export interface PublicStorageUrlReference {
  bucket: string;
  objectKey: string;
  variant: 'public' | 'render';
}

export interface MediaUrlResolveHookContext {
  originalUrl: string;
  resolvedUrl: string;
  publicBucket: string | null;
  storageObjectKey: string | null;
  userRoles: string[];
}

export const MEDIA_URL_RESOLVE_HOOK = 'media.url.resolve';

const DEFAULT_HOOK_ORDER = 100;

function sortHooks<TContext>(
  hooks: Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>>,
): Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>> {
  return [...hooks].sort((left, right) => (left.order ?? DEFAULT_HOOK_ORDER) - (right.order ?? DEFAULT_HOOK_ORDER));
}

async function loadPluginHooks<TContext>(target: string, userRoles: string[]): Promise<Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>>> {
  const { getPluginHooks } = await import('@/plugins/loader');
  return getPluginHooks(target, userRoles) as Array<Pick<PluginHookContribution<TContext>, 'order' | 'handler'>>;
}

function getBaseOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'http://localhost:8787';
}

export function extractPublicStorageUrlReference(url: string | null | undefined): PublicStorageUrlReference | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url, getBaseOrigin());
    const publicPrefix = '/storage/v1/object/public/';
    const renderPrefix = '/storage/v1/render/image/public/';

    let storagePath: string | null = null;
    let variant: 'public' | 'render' = 'public';

    if (parsed.pathname.includes(publicPrefix)) {
      storagePath = parsed.pathname.split(publicPrefix)[1] ?? null;
      variant = 'public';
    } else if (parsed.pathname.includes(renderPrefix)) {
      storagePath = parsed.pathname.split(renderPrefix)[1] ?? null;
      variant = 'render';
    }

    if (!storagePath) {
      return null;
    }

    const firstSlash = storagePath.indexOf('/');
    if (firstSlash <= 0) {
      return null;
    }

    return {
      bucket: storagePath.slice(0, firstSlash),
      objectKey: storagePath.slice(firstSlash + 1),
      variant,
    };
  } catch {
    return null;
  }
}

export async function resolveMediaUrl(url: string | null | undefined, userRoles: string[] = []): Promise<string> {
  if (!url) {
    return '';
  }

  const reference = extractPublicStorageUrlReference(url);

  let context: MediaUrlResolveHookContext = {
    originalUrl: url,
    resolvedUrl: url,
    publicBucket: reference?.bucket ?? null,
    storageObjectKey: reference?.objectKey ?? null,
    userRoles,
  };

  const hooks = sortHooks(await loadPluginHooks<MediaUrlResolveHookContext>(MEDIA_URL_RESOLVE_HOOK, userRoles));
  for (const hook of hooks) {
    context = await hook.handler(context) as MediaUrlResolveHookContext;
  }

  return context.resolvedUrl || url;
}

export function useResolvedMediaUrl(url: string | null | undefined): string {
  const { roles } = useAuth();
  const [resolvedUrl, setResolvedUrl] = useState(url ?? '');
  const rolesKey = useMemo(() => [...roles].sort().join('|'), [roles]);

  useEffect(() => {
    let active = true;
    const fallbackUrl = url ?? '';

    setResolvedUrl(fallbackUrl);

    void resolveMediaUrl(url, roles)
      .then((nextUrl) => {
        if (active) {
          setResolvedUrl(nextUrl);
        }
      })
      .catch(() => {
        if (active) {
          setResolvedUrl(fallbackUrl);
        }
      });

    return () => {
      active = false;
    };
  }, [url, roles, rolesKey]);

  return resolvedUrl;
}
