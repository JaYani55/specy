import { supabase } from '@/lib/supabase';
import type { PluginRegistration, PluginRegistrationInsert } from '@/types/plugin';

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
  const { data, error } = await supabase
    .from('plugins')
    .insert(input)
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
  config: Record<string, string>
): Promise<void> {
  const { error } = await supabase
    .from('plugins')
    .update({ config })
    .eq('id', id);

  if (error) {
    console.error('[pluginService] updatePluginConfig error:', error);
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
