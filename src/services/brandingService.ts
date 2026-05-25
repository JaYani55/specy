import { API_URL } from '@/lib/apiUrl';
import { supabase } from '@/lib/supabase';

export type BrandingLogoMode = 'default' | 'custom';

export interface BrandingSettings {
  logoMode: BrandingLogoMode;
  customLogoUrl: string;
  logoScale: number;
}

export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  logoMode: 'default',
  customLogoUrl: '',
  logoScale: 100,
};

const BRANDING_CACHE_KEY = 'servicecms.branding';

interface ErrorResponse {
  error?: string;
}

async function createAuthenticatedHeaders(extraHeaders?: HeadersInit): Promise<Headers> {
  const headers = new Headers(extraHeaders);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return headers;
}

function normalizeBrandingSettings(branding: Partial<BrandingSettings>): BrandingSettings {
  const customLogoUrl = branding.customLogoUrl ?? '';
  const derivedMode: BrandingLogoMode = customLogoUrl ? 'custom' : 'default';

  return {
    logoMode: branding.logoMode === 'custom' || branding.logoMode === 'default'
      ? branding.logoMode
      : derivedMode,
    customLogoUrl,
    logoScale: typeof branding.logoScale === 'number' && Number.isFinite(branding.logoScale)
      ? Math.min(180, Math.max(50, Math.round(branding.logoScale)))
      : DEFAULT_BRANDING_SETTINGS.logoScale,
  };
}

function readCachedBrandingSettings(): BrandingSettings | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(BRANDING_CACHE_KEY);
    if (!raw) {
      return undefined;
    }

    return normalizeBrandingSettings(JSON.parse(raw) as Partial<BrandingSettings>);
  } catch {
    return undefined;
  }
}

function cacheBrandingSettings(settings: BrandingSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(BRANDING_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures.
  }
}

export function getCachedBrandingSettings(): BrandingSettings | undefined {
  return readCachedBrandingSettings();
}

export async function getBrandingSettings(): Promise<BrandingSettings> {
  const res = await fetch(`${API_URL}/api/config/branding`, {
    headers: await createAuthenticatedHeaders({ Accept: 'application/json' }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as { branding: Partial<BrandingSettings> };
  const normalized = normalizeBrandingSettings(data.branding ?? {});
  cacheBrandingSettings(normalized);
  return normalized;
}

export async function updateBrandingSettings(input: BrandingSettings): Promise<BrandingSettings> {
  const res = await fetch(`${API_URL}/api/config/branding`, {
    method: 'PUT',
    headers: await createAuthenticatedHeaders({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' })) as ErrorResponse;
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as { branding: Partial<BrandingSettings> };
  const normalized = normalizeBrandingSettings(data.branding ?? {});
  cacheBrandingSettings(normalized);
  return normalized;
}

export const BRANDING_QUERY_KEY = ['branding'] as const;