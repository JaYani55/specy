/**
 * Feature Flags Context
 *
 * Client-side, per-browser feature flags persisted to localStorage.
 * Flags are device-local by design: they only toggle UI surface areas
 * (beta pages, technical documentation) and never gate security.
 *
 * Core provides the flag registry and the toggle slot in /settings.
 * Plugins and pages can declare consumption via the documented
 * `featureFlag` field on plugin routes/sidebar items, or by reading
 * the context directly. See specs/platform/feature-flags.md.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type FeatureFlagId = 'betaFeatures' | 'devMode';

export interface FeatureFlagDefinition {
  id: FeatureFlagId;
  label: { en: string; de: string };
  description: { en: string; de: string };
  defaultValue: boolean;
}

/** Registry of all known feature flags and their defaults. */
export const FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    id: 'betaFeatures',
    label: { en: 'Beta Features', de: 'Beta-Funktionen' },
    description: {
      en: 'Show features that are still in beta, e.g. the Second Brain page.',
      de: 'Zeigt Funktionen, die sich noch im Beta-Stadium befinden, z. B. die Second-Brain-Seite.',
    },
    defaultValue: false,
  },
  {
    id: 'devMode',
    label: { en: 'Developer Mode', de: 'Entwicklermodus' },
    description: {
      en: 'Show technical documentation such as API endpoints and agent prompts.',
      de: 'Zeigt technische Dokumentation wie API-Endpunkte und Agenten-Prompts.',
    },
    defaultValue: false,
  },
];

export type FeatureFlagState = Record<FeatureFlagId, boolean>;

const STORAGE_KEY = 'specy.feature-flags.v1';

function readStoredFlags(): FeatureFlagState {
  const defaults = Object.fromEntries(
    FEATURE_FLAGS.map((flag) => [flag.id, flag.defaultValue]),
  ) as FeatureFlagState;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return defaults;

    const merged = { ...defaults };
    for (const flag of FEATURE_FLAGS) {
      if (typeof parsed[flag.id] === 'boolean') {
        merged[flag.id] = parsed[flag.id];
      }
    }
    return merged;
  } catch {
    return defaults;
  }
}

function persistFlags(flags: FeatureFlagState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(flags));
  } catch {
    // Storage may be unavailable (private mode, quota) — flags stay in-memory.
  }
}

interface FeatureFlagsContextValue {
  flags: FeatureFlagState;
  /** Whether a single flag is currently enabled for this browser. */
  isFeatureFlagEnabled: (id: FeatureFlagId) => boolean;
  /** Enable/disable a flag and persist the choice in localStorage. */
  setFeatureFlag: (id: FeatureFlagId, value: boolean) => void;
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue | undefined>(undefined);

export const FeatureFlagsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [flags, setFlags] = useState<FeatureFlagState>(readStoredFlags);

  const setFeatureFlag = useCallback((id: FeatureFlagId, value: boolean) => {
    setFlags((prev) => {
      const next = { ...prev, [id]: value };
      persistFlags(next);
      return next;
    });
  }, []);

  const isFeatureFlagEnabled = useCallback(
    (id: FeatureFlagId) => flags[id],
    [flags],
  );

  const value = useMemo(
    () => ({ flags, isFeatureFlagEnabled, setFeatureFlag }),
    [flags, isFeatureFlagEnabled, setFeatureFlag],
  );

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export function useFeatureFlags(): FeatureFlagsContextValue {
  const context = useContext(FeatureFlagsContext);
  if (!context) {
    throw new Error('useFeatureFlags must be used within a FeatureFlagsProvider');
  }
  return context;
}
