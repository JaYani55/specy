/**
 * /api/media — Storage provider abstraction layer
 *
 * Supports multiple providers:
 *   • "supabase" (default primary) — proxies to Supabase Storage
 *   • "r2"                         — uses the native MEDIA_BUCKET R2 binding
 *   • "s3"                         — S3-compatible extra sources (aws4fetch)
 *
 * Endpoints:
 *   GET  /config            → { provider, bucket, configured, publicUrlConfigured? }
 *   GET  /sources           → { sources: MediaSourceInfo[] }
 *   GET  /list?path=&source=        → { items: MediaItem[] }
 *   POST /upload?source=            → { url, path }   (multipart/form-data: file, path?)
 *   DELETE /file?path=&source=      → { success: true }
 */

import { AwsClient } from 'aws4fetch';
import { Hono } from 'hono';
import { requireAppRole } from '../lib/auth';
import { buildMediaMountUrl, ensureSupabaseStorageBucket, resolveAllMediaSourceMounts, resolvePrimaryMediaConfig, type ResolvedMediaSourceMount } from '../lib/mediaStorage';
import { buildS3SecretName, getManagedSecretValue } from '../lib/managedSecrets';
import { Env, createSupabaseClient, createSupabaseAdminClient } from '../lib/supabase';
import { getMediaSourceMounts, type ExtraMediaSource, type MediaSourceMount } from '../lib/systemConfig';

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

export type MediaSourceInfo = {
  id: string;
  label: string;
  type: 'supabase' | 'r2' | 's3';
  configured: boolean;
  isDefault: boolean;
};

function getBearerToken(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

async function resolveMountSecret(env: Env, sourceId: string): Promise<string | null> {
  const secretName = buildS3SecretName(sourceId);
  return getManagedSecretValue(env, secretName);
}

async function resolveMediaMount(
  env: Env,
  requestUrl: string,
  sourceId: string | null | undefined,
): Promise<ResolvedMediaSourceMount | null> {
  const mounts = await resolveAllMediaSourceMounts(env, requestUrl);
  if (!sourceId || sourceId === 'primary') {
    return mounts.find((mount) => mount.isDefault) ?? mounts[0] ?? null;
  }

  return mounts.find((mount) => mount.id === sourceId) ?? null;
}

function toExtraMediaSource(mount: MediaSourceMount): ExtraMediaSource {
  return {
    id: mount.id,
    label: mount.label,
    type: 's3',
    endpoint: mount.endpoint ?? '',
    bucket: mount.bucket,
    region: mount.region ?? '',
    publicUrl: mount.publicUrl ?? '',
    accessKeyId: mount.accessKeyId ?? '',
  };
}

// ── S3 helpers (aws4fetch) ────────────────────────────────────────────────

/**
 * Parse the XML response from the S3 ListObjectsV2 API into MediaItem[].
 */
function parseS3ListXml(xml: string, prefix: string, publicUrl: string): MediaItem[] {
  const items: MediaItem[] = [];

  // Common prefixes → folders
  const cpRegex = /<CommonPrefixes>\s*<Prefix>([^<]+)<\/Prefix>\s*<\/CommonPrefixes>/g;
  let cpMatch: RegExpExecArray | null;
  while ((cpMatch = cpRegex.exec(xml)) !== null) {
    const folderPath = cpMatch[1];
    const name = folderPath.replace(prefix, '').replace(/\/$/, '');
    if (name) {
      items.push({ name, path: folderPath, url: '', isFolder: true });
    }
  }

  // Contents → files
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let contentsMatch: RegExpExecArray | null;
  while ((contentsMatch = contentsRegex.exec(xml)) !== null) {
    const block = contentsMatch[1];
    const keyMatch = /<Key>([^<]+)<\/Key>/.exec(block);
    const sizeMatch = /<Size>(\d+)<\/Size>/.exec(block);
    const dateMatch = /<LastModified>([^<]+)<\/LastModified>/.exec(block);
    if (!keyMatch) continue;
    const key = keyMatch[1];
    // Skip the folder placeholder itself and .placeholder files
    if (key === prefix || key.endsWith('/.placeholder') || key === '.placeholder') continue;
    const name = key.replace(prefix, '');
    if (!name) continue;
    const cleanPublicUrl = publicUrl.replace(/\/$/, '');
    items.push({
      name,
      path: key,
      url: `${cleanPublicUrl}/${key}`,
      isFolder: false,
      size: sizeMatch ? Number(sizeMatch[1]) : undefined,
      createdAt: dateMatch ? dateMatch[1] : undefined,
    });
  }

  return items;
}

async function s3List(
  source: ExtraMediaSource,
  secretAccessKey: string,
  path: string,
): Promise<MediaItem[]> {
  const prefix = path ? (path.endsWith('/') ? path : `${path}/`) : '';
  const endpoint = source.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/${source.bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}&delimiter=%2F`;

  const client = new AwsClient({
    accessKeyId: source.accessKeyId,
    secretAccessKey,
    region: source.region || 'us-east-1',
    service: 's3',
  });

  const res = await client.fetch(url, { method: 'GET' });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`S3 list failed (${res.status}): ${errText}`);
  }
  const xml = await res.text();
  return parseS3ListXml(xml, prefix, source.publicUrl);
}

async function s3Upload(
  source: ExtraMediaSource,
  secretAccessKey: string,
  key: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<string> {
  const endpoint = source.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/${source.bucket}/${key}`;

  const client = new AwsClient({
    accessKeyId: source.accessKeyId,
    secretAccessKey,
    region: source.region || 'us-east-1',
    service: 's3',
  });

  const res = await client.fetch(url, {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`S3 upload failed (${res.status}): ${errText}`);
  }
  const cleanPublicUrl = source.publicUrl.replace(/\/$/, '');
  return `${cleanPublicUrl}/${key}`;
}

async function s3Delete(
  source: ExtraMediaSource,
  secretAccessKey: string,
  key: string,
): Promise<void> {
  const endpoint = source.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/${source.bucket}/${key}`;

  const client = new AwsClient({
    accessKeyId: source.accessKeyId,
    secretAccessKey,
    region: source.region || 'us-east-1',
    service: 's3',
  });

  const res = await client.fetch(url, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) {
    const errText = await res.text().catch(() => '');
    throw new Error(`S3 delete failed (${res.status}): ${errText}`);
  }
}

// ── router ────────────────────────────────────────────────────────────────
const media = new Hono<{ Bindings: Env }>();

// GET /api/media/config
media.get('/config', async (c) => {
  const cfg = await resolvePrimaryMediaConfig(c.env, c.req.url);
  const { r2PublicUrl: _omit, ...response } = cfg;
  return c.json(response);
});

// GET /api/media/sources — returns all configured sources for the media picker
media.get('/sources', async (c) => {
  const sources = (await resolveAllMediaSourceMounts(c.env, c.req.url))
    .filter((mount) => mount.type !== 'unconfigured')
    .map((mount) => ({
      id: mount.id,
      label: mount.label,
      type: mount.type as 'supabase' | 'r2' | 's3',
      configured: mount.configured,
      isDefault: mount.isDefault,
    }));

  return c.json({ sources });
});

// GET /api/media/list?path=&source=
media.get('/list', async (c) => {
  const path = c.req.query('path') ?? '';
  const sourceParam = c.req.query('source');
  const token = getBearerToken(c.req.header('Authorization'));

  const cfg = await resolveMediaMount(c.env, c.req.url, sourceParam);

  if (!cfg || !cfg.configured || cfg.provider === 'unconfigured') {
    return c.json({ error: 'Storage not configured' }, 503);
  }

  try {
    if (cfg.provider === 's3') {
      const secretAccessKey = await resolveMountSecret(c.env, cfg.id);
      if (!secretAccessKey) {
        return c.json({ error: `Source "${cfg.id}" is missing its secret access key` }, 503);
      }

      const items = await s3List(toExtraMediaSource(cfg), secretAccessKey, path);
      return c.json({ items });
    }

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
          url: buildMediaMountUrl(cfg, c.req.url, o.key),
          isFolder: false,
          size: o.size,
          createdAt: o.uploaded?.toISOString(),
        }));

      return c.json({ items: [...folders, ...files] });
    } else {
      // ── Supabase Storage ────────────────────────────────────────────────
      const supabase = await createStorageClient(c.env, token);
      const bucketName = cfg.bucket!;

      // Auto-create bucket if missing — requires admin client (service key).
      // Silently skipped when SS_SUPABASE_SECRET_KEY is not bound (e.g. local dev
      // without a secret key configured).
      await ensureSupabaseStorageBucket(c.env, bucketName);

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

// POST /api/media/upload  (multipart/form-data: file, path?, source?)
media.post('/upload', async (c) => {
  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'Invalid multipart body' }, 400);
  }

  const file = formData.get('file') as File | null;
  if (!file) return c.json({ error: 'No file provided' }, 400);

  const folder = (formData.get('path') as string | null) ?? '';
  const sourceParam = (formData.get('source') as string | null) ?? c.req.query('source');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = folder ? `${folder.replace(/\/$/, '')}/${safeName}` : safeName;

  const cfg = await resolveMediaMount(c.env, c.req.url, sourceParam);
  if (!cfg || !cfg.configured || cfg.provider === 'unconfigured') {
    return c.json({ error: 'Storage not configured' }, 503);
  }
  const token = auth.token;

  try {
    if (cfg.provider === 's3') {
      const secretAccessKey = await resolveMountSecret(c.env, cfg.id);
      if (!secretAccessKey) {
        return c.json({ error: `Source "${cfg.id}" is missing its secret access key` }, 503);
      }

      const buf = await file.arrayBuffer();
      const url = await s3Upload(toExtraMediaSource(cfg), secretAccessKey, key, buf, file.type || 'application/octet-stream');
      return c.json({ url, path: key });
    }

    if (cfg.provider === 'r2') {
      // ── R2 ──────────────────────────────────────────────────────────────
      const bucket = c.env.MEDIA_BUCKET!;
      const buf = await file.arrayBuffer();
      await bucket.put(key, buf, { httpMetadata: { contentType: file.type } });
      const url = buildMediaMountUrl(cfg, c.req.url, key);
      return c.json({ url, path: key });
    } else {
      // ── Supabase Storage ────────────────────────────────────────────────
      const supabase = await createStorageClient(c.env, token);
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

  const auth = await requireAppRole(c, 'user');
  if (auth instanceof Response) return auth;

  const sourceParam = c.req.query('source');
  const cfg = await resolveMediaMount(c.env, c.req.url, sourceParam);
  if (!cfg || !cfg.configured || cfg.provider === 'unconfigured') {
    return c.json({ error: 'Storage not configured' }, 503);
  }
  const token = auth.token;

  try {
    if (cfg.provider === 's3') {
      const secretAccessKey = await resolveMountSecret(c.env, cfg.id);
      if (!secretAccessKey) {
        return c.json({ error: `Source "${cfg.id}" is missing its secret access key` }, 503);
      }

      await s3Delete(toExtraMediaSource(cfg), secretAccessKey, path);
    } else if (cfg.provider === 'r2') {
      await c.env.MEDIA_BUCKET!.delete(path);
    } else {
      const supabase = await createStorageClient(c.env, token);
      const { error } = await supabase.storage.from(cfg.bucket!).remove([path]);
      if (error) return c.json({ error: error.message }, 500);
    }
    return c.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

media.get('/file', async (c) => {
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path query param required' }, 400);

  const sourceParam = c.req.query('source');
  const cfg = await resolveMediaMount(c.env, c.req.url, sourceParam);
  if (!cfg || !cfg.configured || cfg.provider === 'unconfigured') {
    return c.json({ error: 'Storage not configured' }, 503);
  }

  if (cfg.provider === 'supabase') {
    const supabase = await createStorageClient(c.env);
    const { data } = supabase.storage.from(cfg.bucket!).getPublicUrl(path);
    if (!data?.publicUrl) {
      return c.json({ error: 'File not found' }, 404);
    }
    return c.redirect(data.publicUrl, 302);
  }

  if (cfg.provider === 's3') {
    const url = buildMediaMountUrl(cfg, c.req.url, path);
    if (!url) {
      return c.json({ error: 'File delivery URL is not configured for this source' }, 503);
    }
    return c.redirect(url, 302);
  }

  const object = await c.env.MEDIA_BUCKET!.get(path);
  if (!object) {
    return c.json({ error: 'File not found' }, 404);
  }

  const headers = new Headers();
  if (object.httpMetadata?.contentType) {
    headers.set('Content-Type', object.httpMetadata.contentType);
  }
  headers.set('Cache-Control', 'public, max-age=300');

  return new Response(object.body, { headers });
});

export default media;
