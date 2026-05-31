export interface DefaultLandingOption {
  value: string;
  label: {
    en: string;
    de: string;
  };
}

export interface DefaultLandingOptionsHookContext {
  options: DefaultLandingOption[];
  userRoles: string[];
}

export interface DefaultLandingResolveHookContext {
  storedView: string;
  resolvedView: string;
  fallbackView: string;
  availableValues: string[];
  userRoles: string[];
}

export interface DefaultLandingPathHookContext {
  view: string;
  resolvedPath: string;
  userRoles: string[];
}

export const DEFAULT_LANDING_OPTIONS_HOOK = 'settings.defaultLanding.options';
export const DEFAULT_LANDING_RESOLVE_HOOK = 'settings.defaultLanding.resolve';
export const DEFAULT_LANDING_PATH_HOOK = 'settings.defaultLanding.path';

const STORAGE_KEY_PREFIX = 'mentor_app_settings_';

const BASE_OPTIONS: DefaultLandingOption[] = [
  {
    value: 'events',
    label: { en: 'Events', de: 'Veranstaltungen' },
  },
  {
    value: 'calendar',
    label: { en: 'Calendar', de: 'Kalender' },
  },
  {
    value: 'list',
    label: { en: 'List', de: 'Liste' },
  },
];

function sortHooks<TContext>(hooks: Array<{ order?: number; handler: (context: TContext) => TContext | Promise<TContext> }>) {
  return [...hooks].sort((left, right) => (left.order ?? 100) - (right.order ?? 100));
}

async function loadPluginHooks<TContext>(target: string, userRoles: string[]) {
  const { getPluginHooks } = await import('@/plugins/loader');
  return getPluginHooks(target, userRoles) as Array<{ order?: number; handler: (context: TContext) => TContext | Promise<TContext> }>;
}

function normalizeOptions(options: DefaultLandingOption[]): DefaultLandingOption[] {
  const seen = new Set<string>();

  return options.filter((option) => {
    if (seen.has(option.value)) {
      return false;
    }

    seen.add(option.value);
    return true;
  });
}

export function getUserSettingStorageKey(userId: string, setting: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}_${setting}`;
}

export function getStoredSetting<T>(userId: string, setting: string, defaultValue: T): T {
  try {
    const key = getUserSettingStorageKey(userId, setting);
    const stored = localStorage.getItem(key);

    if (!stored) {
      return defaultValue;
    }

    return JSON.parse(stored) as T;
  } catch (error) {
    console.warn(`Failed to load setting ${setting}:`, error);
    return defaultValue;
  }
}

export function storeSetting<T>(userId: string, setting: string, value: T): boolean {
  try {
    const key = getUserSettingStorageKey(userId, setting);
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Failed to store setting ${setting}:`, error);
    return false;
  }
}

export async function getDefaultLandingOptions(userRoles: string[]): Promise<DefaultLandingOption[]> {
  let context: DefaultLandingOptionsHookContext = {
    options: [...BASE_OPTIONS],
    userRoles,
  };

  const hooks = sortHooks(await loadPluginHooks<DefaultLandingOptionsHookContext>(DEFAULT_LANDING_OPTIONS_HOOK, userRoles));

  for (const hook of hooks) {
    context = await hook.handler(context) as DefaultLandingOptionsHookContext;
  }

  return normalizeOptions(context.options);
}

export async function resolveDefaultLandingView(
  storedView: string,
  userRoles: string[],
  fallbackView = 'events',
): Promise<string> {
  const options = await getDefaultLandingOptions(userRoles);
  const availableValues = options.map((option) => option.value);
  const normalizedStoredView = availableValues.includes(storedView) ? storedView : '';

  let context: DefaultLandingResolveHookContext = {
    storedView: normalizedStoredView,
    resolvedView: normalizedStoredView || fallbackView,
    fallbackView,
    availableValues,
    userRoles,
  };

  const hooks = sortHooks(await loadPluginHooks<DefaultLandingResolveHookContext>(DEFAULT_LANDING_RESOLVE_HOOK, userRoles));

  for (const hook of hooks) {
    context = await hook.handler(context) as DefaultLandingResolveHookContext;
  }

  if (!availableValues.includes(context.resolvedView)) {
    return fallbackView;
  }

  return context.resolvedView;
}

export async function getDefaultLandingPath(view: string, userRoles: string[]): Promise<string> {
  let context: DefaultLandingPathHookContext = {
    view,
    resolvedPath: `/${view}`,
    userRoles,
  };

  const hooks = sortHooks(await loadPluginHooks<DefaultLandingPathHookContext>(DEFAULT_LANDING_PATH_HOOK, userRoles));

  for (const hook of hooks) {
    context = await hook.handler(context) as DefaultLandingPathHookContext;
  }

  return context.resolvedPath;
}