import { Hono } from 'hono';
import { createSupabaseClient, type Env } from '../lib/supabase';

const plugins = new Hono<{ Bindings: Env }>();

interface PluginRow {
  slug: string;
  name: string;
  version: string;
  description: string | null;
  author_name: string | null;
  author_url: string | null;
  license: string | null;
  repo_url: string;
  status: string;
  installed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GET /api/plugins
 * Returns the list of registered plugins (public, read-only).
 * Useful for external dashboards and status monitoring.
 */
plugins.get('/', async (c) => {
  const supabase = await createSupabaseClient(c.env);

  const { data, error } = await supabase
    .from('plugins')
    .select(
      'slug, name, version, description, author_name, author_url, license, repo_url, status, installed_at, created_at, updated_at'
    )
    .order('name', { ascending: true });

  if (error) {
    return c.json({ error: 'Failed to fetch plugins' }, 500);
  }

  const baseUrl = new URL(c.req.url).origin;

  return c.json({
    service: 'specy-api',
    description: 'Registered plugins for this CMS instance.',
    install_docs: `${baseUrl}/docs/Plugin_Development.md`,
    plugins: ((data ?? []) as PluginRow[]).map((p) => ({
      slug: p.slug,
      name: p.name,
      version: p.version,
      description: p.description,
      author_name: p.author_name,
      author_url: p.author_url,
      license: p.license,
      repo_url: p.repo_url,
      status: p.status,
      installed_at: p.installed_at,
      created_at: p.created_at,
      updated_at: p.updated_at,
    })),
  });
});

export default plugins;
