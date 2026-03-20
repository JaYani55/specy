import { supabase } from '@/lib/supabase';
import type {
  PluginConfigFieldDefinition,
  PluginRegistration,
  PluginRegistrationInsert,
} from '@/types/plugin';

export function isSecretPluginField(field: PluginConfigFieldDefinition): boolean {
  return field.type === 'secret';
}

export function buildPluginSecretName(pluginSlug: string, fieldKey: string): string {
  return `PLUGIN_${pluginSlug}_${fieldKey}`
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function sanitizePluginConfigSchema(schema: unknown): PluginConfigFieldDefinition[] {
  if (!Array.isArray(schema)) {
    return [];
  }

  return schema
    .filter((field): field is Partial<PluginConfigFieldDefinition> & { key: string; label: string } => {
      return Boolean(
        field
        && typeof field === 'object'
        && typeof (field as { key?: unknown }).key === 'string'
        && typeof (field as { label?: unknown }).label === 'string'
      );
    })
    .map((field) => {
      const type = field.type === 'textarea' || field.type === 'url' || field.type === 'secret'
        ? field.type
        : 'text';

      return {
        key: field.key.trim(),
        label: field.label.trim(),
        description: typeof field.description === 'string' ? field.description : undefined,
        type,
        required: Boolean(field.required),
        placeholder: typeof field.placeholder === 'string' ? field.placeholder : undefined,
        expose_to_frontend: Boolean(field.expose_to_frontend),
      } satisfies PluginConfigFieldDefinition;
    })
    .filter((field) => field.key.length > 0 && field.label.length > 0);
}

export function filterPluginConfigValues(
  config: Record<string, string>,
  configSchema: PluginConfigFieldDefinition[] = []
): Record<string, string> {
  if (configSchema.length === 0) {
    return config;
  }

  const allowedKeys = new Set(
    configSchema.filter((field) => !isSecretPluginField(field)).map((field) => field.key)
  );

  return Object.fromEntries(
    Object.entries(config).filter(([key]) => allowedKeys.has(key))
  );
}

/** Fetch all plugin records from the database. */
export async function fetchPlugins(): Promise<PluginRegistration[]> {
  const { data, error } = await supabase
    .from('plugins')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('[pluginService] fetchPlugins error:', error);
    throw error;
  }
  return (data ?? []) as PluginRegistration[];
}

/** Register a new plugin entry in the database. */
export async function registerPlugin(
  input: PluginRegistrationInsert
): Promise<PluginRegistration> {
  const payload = {
    ...input,
    config_schema: sanitizePluginConfigSchema(input.config_schema ?? []),
  };

  const { data, error } = await supabase
    .from('plugins')
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error('[pluginService] registerPlugin error:', error);
    throw error;
  }
  return data as PluginRegistration;
}

/**
 * Update a plugin's config (key-value pairs stored as JSONB).
 * @param id     Plugin UUID.
 * @param config New config object (replaces existing config).
 */
export async function updatePluginConfig(
  id: string,
  config: Record<string, string>,
  configSchema: PluginConfigFieldDefinition[] = []
): Promise<void> {
  const nextConfig = filterPluginConfigValues(config, configSchema);

  const { error } = await supabase
    .from('plugins')
    .update({ config: nextConfig })
    .eq('id', id);

  if (error) {
    console.error('[pluginService] updatePluginConfig error:', error);
    throw error;
  }
}

export async function updatePluginConfigSchema(
  id: string,
  configSchema: PluginConfigFieldDefinition[]
): Promise<void> {
  const { error } = await supabase
    .from('plugins')
    .update({ config_schema: sanitizePluginConfigSchema(configSchema) })
    .eq('id', id);

  if (error) {
    console.error('[pluginService] updatePluginConfigSchema error:', error);
    throw error;
  }
}

/** Update a plugin's status field. */
export async function updatePluginStatus(
  id: string,
  status: PluginRegistration['status']
): Promise<void> {
  const { error } = await supabase
    .from('plugins')
    .update({ status })
    .eq('id', id);

  if (error) {
    console.error('[pluginService] updatePluginStatus error:', error);
    throw error;
  }
}

/** Delete a plugin registration record. Does not remove installed files. */
export async function deletePlugin(id: string): Promise<void> {
  const { error } = await supabase.from('plugins').delete().eq('id', id);

  if (error) {
    console.error('[pluginService] deletePlugin error:', error);
    throw error;
  }
}
