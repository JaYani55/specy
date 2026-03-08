/**
 * /api/media — Storage provider abstraction layer
 *
 * Supports two providers, selected at runtime via the STORAGE_PROVIDER var:
 *   • "supabase" (default) — proxies to Supabase Storage using SS_STORAGE_BUCKET
 *   • "r2"                 — uses the native MEDIA_BUCKET R2 binding
 *
 * Endpoints:
 *   GET  /config            → { provider, bucket, configured, publicUrlConfigured? }
 *   GET  /list?path=        → { items: MediaItem[] }
 *   POST /upload            → { url, path }   (multipart/form-data: file, path?)
 *   DELETE /file?path=      → { success: true }
 */

import { Hono } from 'hono';
import { Env, createSupabaseClient, createSupabaseAdminClient } from '../lib/supabase';

// File operations (list files, upload, delete) use the publishable key — bucket
// policies govern access so no service key is needed for those.
// Bucket management (listBuckets / createBucket) is admin-only and requires the
// service key via createSupabaseAdminClient.
const createStorageClient = createSupabaseClient;

export type MediaItem = {
  name: string;
  path: string;
  url: string;
  isFolder: boolean;
  size?: number;
  createdAt?: string;
};

type MediaConfig = {
  provider: 'supabase' | 'r2' | 'unconfigured';
  bucket: string | null;
  configured: boolean;
  publicUrlConfigured?: boolean;
};

// ── helper: resolve the active storage config ──────────────────────────────
async function resolveMediaConfig(env: Env): Promise<MediaConfig & { r2PublicUrl: string | null }> {
  const provider = (env.STORAGE_PROVIDER || '') as 'supabase' | 'r2' | '';
  const bucket   = env.STORAGE_BUCKET   || '';
  const r2PublicUrl = env.R2_PUBLIC_URL || '';

  if (!provider || !bucket) {
    return { provider: 'unconfigured', bucket: null, configured: false, r2PublicUrl: null };
  }

  if (provider === 'r2') {
    return {
      provider: 'r2',
      bucket: bucket || null,
      configured: !!env.MEDIA_BUCKET,
      publicUrlConfigured: !!r2PublicUrl,
      r2PublicUrl: r2PublicUrl || null,
    };
  }

  return {
    provider: 'supabase',
    bucket: bucket || null,
    configured: true,
    r2PublicUrl: null,
  };
}

// ── router ────────────────────────────────────────────────────────────────
const media = new Hono<{ Bindings: Env }>();

// GET /api/media/config
media.get('/config', async (c) => {
  const cfg = await resolveMediaConfig(c.env);
  const { r2PublicUrl: _omit, ...response } = cfg;
  return c.json(response);
});

// GET /api/media/list?path=
media.get('/list', async (c) => {
  const path = c.req.query('path') ?? '';
  const cfg = await resolveMediaConfig(c.env);

  if (!cfg.configured || cfg.provider === 'unconfigured') {
    return c.json({ error: 'Storage not configured' }, 503);
  }

  try {
    if (cfg.provider === 'r2') {
      // ── R2 ──────────────────────────────────────────────────────────────
      const bucket = c.env.MEDIA_BUCKET!;
      const prefix = path ? (path.endsWith('/') ? path : `${path}/`) : '';
      const result = await bucket.list({ prefix, delimiter: '/' });

      const folders: MediaItem[] = result.delimitedPrefixes.map((p) => ({
        name: p.replace(prefix, '').replace(/\/$/, ''),
        path: p,
        url: '',
        isFolder: true,
      }));

      const files: MediaItem[] = result.objects
        .filter((o) => o.key !== prefix)
        .map((o) => ({
          name: o.key.replace(prefix, ''),
          path: o.key,
          url: `${cfg.r2PublicUrl}/${o.key}`,
          isFolder: false,
          size: o.size,
          createdAt: o.uploaded?.toISOString(),
        }));

      return c.json({ items: [...folders, ...files] });
    } else {
      // ── Supabase Storage ────────────────────────────────────────────────
      const supabase = await createStorageClient(c.env);
      const bucketName = cfg.bucket!;

      // Auto-create bucket if missing — requires admin client (service key).
      // Silently skipped when SS_SUPABASE_SECRET_KEY is not bound (e.g. local dev
      // without a secret key configured).
      if (c.env.SS_SUPABASE_SECRET_KEY) {
        try {
          const admin = await createSupabaseAdminClient(c.env);
          const { data: buckets, error: listError } = await admin.storage.listBuckets();
          if (!listError && !buckets?.find(b => b.name === bucketName)) {
            console.log(`[Media] Creating missing bucket: ${bucketName}`);
            const { error: createError } = await admin.storage.createBucket(bucketName, {
              public: true,
              fileSizeLimit: 52428800, // 50MB
            });
            if (createError) {
              console.error(`[Media] Failed to create bucket: ${createError.message}`);
            }
          }
        } catch (err) {
          console.error('[Media] Bucket auto-create failed:', err instanceof Error ? err.message : err);
        }
      }

      const { data, error } = await supabase.storage.from(bucketName).list(path || undefined, {
        limit: 200,
        sortBy: { column: 'created_at', order: 'desc' },
      });

      if (error) return c.json({ error: error.message }, 500);

      const items: MediaItem[] = (data ?? []).map((entry) => {
        const isFolder = !entry.id;
        const entryPath = path ? `${path}/${entry.name}` : entry.name;
        let url = '';
        if (!isFolder) {
          const { data: pub } = supabase.storage.from(cfg.bucket!).getPublicUrl(entryPath);
          url = pub?.publicUrl ?? '';
        }
        return {
          name: entry.name,
          path: entryPath,
          url,
          isFolder,
          size: entry.metadata?.size,
          createdAt: entry.created_at,
        };
      });

      return c.json({ items });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

// POST /api/media/upload  (multipart/form-data: file, path?)
media.post('/upload', async (c) => {
  const cfg = await resolveMediaConfig(c.env);
  if (!cfg.configured || cfg.provider === 'unconfigured') {
    return c.json({ error: 'Storage not configured' }, 503);
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'Invalid multipart body' }, 400);
  }

  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  const folder = (formData.get('path') as string | null) ?? '';
  const safeName = file.name.replace(/[^a-zA-Z0-9._\-]/g, '_');
  const key = folder ? `${folder.replace(/\/$/, '')}/${safeName}` : safeName;

  try {
    if (cfg.provider === 'r2') {
      // ── R2 ──────────────────────────────────────────────────────────────
      const bucket = c.env.MEDIA_BUCKET!;
      const buf = await file.arrayBuffer();
      await bucket.put(key, buf, { httpMetadata: { contentType: file.type } });
      const url = `${cfg.r2PublicUrl}/${key}`;
      return c.json({ url, path: key });
    } else {
      // ── Supabase Storage ────────────────────────────────────────────────
      // Use admin client so the server-side worker bypasses RLS on storage.objects.
      const supabase = await createSupabaseAdminClient(c.env);
      const buf = await file.arrayBuffer();
      const { error } = await supabase.storage
        .from(cfg.bucket!)
        .upload(key, buf, { contentType: file.type, upsert: true });
      if (error) return c.json({ error: error.message }, 500);

      const { data: pub } = supabase.storage.from(cfg.bucket!).getPublicUrl(key);
      return c.json({ url: pub?.publicUrl ?? '', path: key });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

// DELETE /api/media/file?path=
media.delete('/file', async (c) => {
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path query param required' }, 400);

  const cfg = await resolveMediaConfig(c.env);
  if (!cfg.configured || cfg.provider === 'unconfigured') {
    return c.json({ error: 'Storage not configured' }, 503);
  }

  try {
    if (cfg.provider === 'r2') {
      await c.env.MEDIA_BUCKET!.delete(path);
    } else {
      // Use admin client to bypass RLS for server-side deletes.
      const supabase = await createSupabaseAdminClient(c.env);
      const { error } = await supabase.storage.from(cfg.bucket!).remove([path]);
      if (error) return c.json({ error: error.message }, 500);
    }
    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export default media;
