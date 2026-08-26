# R2 File Storage — Unified Media & File Storage

> **Audience:** AI agents and developers of external microservices that need to store,
> list, or serve files through Specy's central storage system.
>
> **Related:** [`../auth/oauth-mcp-authentication.md`](../auth/oauth-mcp-authentication.md)
> (how programmatic clients obtain tokens) ·
> [`../platform/supabase-cloudflare-setup.md`](../platform/supabase-cloudflare-setup.md)
> (infrastructure setup) ·
> [§8](#8-frontend-media-picker--consistency-guide) for the dashboard-side
> media picker contract

---

## 1. Which integration path applies to you?

There are exactly two ways to interact with the unified file storage. Pick based on
where your code runs:

| Your code runs… | Path | Auth mechanism |
|---|---|---|
| **Outside the Worker** (another microservice, CI job, agent runtime, frontend) | **HTTP API** `/api/media/*` | Supabase JWT (`Authorization: Bearer <token>`), optionally obtained via OAuth 2.1 |
| **Inside this Worker** (a core route or a plugin API route mounted under `/api/plugin/{slug}/`) | **Native `MEDIA_BUCKET` R2 binding** | None needed — binding is process-local; you MUST still register objects in the database |

Rules of thumb:

1. **External consumers never touch R2 directly.** The bucket is private. There are no
   S3 credentials issued to external services. All access flows through the Worker API.
2. **In-Worker code never talks to the storage HTTP API.** Use the binding directly —
   it is faster (no HTTP hop) and already authenticated by deployment.
3. **Every stored object must have a database row.** Quota accounting, listing, and
   authorized delivery all depend on `tenant_storage_objects`. Writing bytes to the
   bucket without registering the object creates an orphan that is invisible to the
   platform and breaks usage reconciliation.

---

## 2. Authentication

All mutating and tenant-scoped read endpoints require a valid auth session. The Worker
accepts any Supabase-issued access token (see
[`../auth/authentication-authorization.md`](../auth/authentication-authorization.md)):

```
Authorization: Bearer <supabase_access_token>
```

Token acquisition paths:

- **Dashboard users:** email/password grant against Supabase Auth.
- **Programmatic clients / agents:** OAuth 2.1 Authorization Code + PKCE against
  Supabase's authorization server — see
  [`oauth-mcp-authentication.md`](../auth/oauth-mcp-authentication.md).

The token determines **tenant membership** and therefore which storage sources and
objects you may access. All data access is additionally protected by Postgres RLS
(§4), so a stolen or misused token cannot cross tenant boundaries.

The one endpoint that works *without* authentication is `GET /api/media/file` — but only
with a valid HMAC signature (`sig` parameter, §3.4).

---

## 3. HTTP API reference

Base path: `/api/media` on your Specy deployment.

### 3.1 `GET /config`

Returns the resolved primary storage configuration:

```json
{
  "id": "primary", "label": "Primary", "type": "r2", "provider": "r2",
  "bucket": "pluraconr2", "isDefault": true, "configured": true,
  "bindingConfigured": true, "bindingName": "MEDIA_BUCKET",
  "publicUrlConfigured": false, "assetBaseUrl": "https://cms.example.com/api/media/file"
}
```

Useful as a capability check before uploading.

### 3.2 `GET /sources`

Lists all configured storage mounts (Supabase Storage, native R2, extra S3 sources),
filtered to those available to the authenticated account. The mount marked
`"isDefault": true` is used when no `source` parameter is given.

### 3.3 `GET /list?path=&source=&scope=`

Lists items under a folder prefix. Requires authentication when the resolved source is
the native R2 mount. `scope` selects which storage scope is browsed (`media` or
`files`, default `media`) — a listing must never mix scopes. Response:

```json
{ "items": [ { "name": "photo.jpg", "path": "tenant/…/media/photo.jpg", "url": "https://…", "isFolder": false, "size": 81234, "createdAt": "…" } ], "storage": { … } }
```

### 3.4 `POST /upload` *(authenticated)*

Multipart form upload:

```
POST /api/media/upload
Content-Type: multipart/form-data

file=@report.pdf          (required)
path=invoices/2026        (optional folder prefix)
source=<mount-id>         (optional, defaults to default mount)
scope=<media|files>       (optional, defaults to `media`; invalid values → 400)
```

The `scope` value decides the intent recorded for the object (§5, §8.1): rendered
assets use `media`, downloadable documents use `files`. It becomes the scope segment
of the object key and the catalog row's scope.

Response:

```json
{ "url": "https://cms.example.com/api/media/file?path=tenant%2F…&source=…&sig=…", "path": "tenant/<tenantId>/user/<userId>/media/invoices/<uuid>-report.pdf" }
```

Behavior on the R2 path:

1. Quota summary is loaded and the upload size checked **before** writing.
2. The object key is built server-side (§5) — clients cannot choose arbitrary keys.
3. Bytes are written to R2, then registered in `tenant_storage_objects`.
4. If registration fails, the R2 object is deleted again (no orphans).
5. The returned URL is a **signed delivery URL**: HMAC-SHA256 over the path, keyed with
   the worker's `SECRETS_ENCRYPTION_KEY`.

### 3.5 `DELETE /file?path=&source=` *(authenticated)*

Deletes the R2 object and its database row (quota is decremented automatically by the
database trigger). Ownership/tenant checks apply.

### 3.6 `GET /file?path=&source=[&sig=]` *(delivery)*

Serves file bytes with `Content-Type` from the stored http metadata and
`Cache-Control: public, max-age=300`. Access rules:

| Caller state | Managed `media` object | Managed `files` object | Unknown path |
|---|---|---|---|
| Valid `sig` | ✅ served | ✅ served | ✅ 404 |
| Authenticated | ✅ served (own tenant) | ✅ served (own tenant) | ❌ 404 |
| Anonymous, no `sig` | ✅ served¹ | ❌ 401 | ❌ 401² |

¹ `media`-scope assets must render on published pages that are fetched without a
session, so they are publicly deliverable through this endpoint.
² Unsigned requests never receive a 404, so callers cannot probe for path existence;
a valid signature on an unknown path yields the 404.

If an operator has configured `R2_PUBLIC_URL` (custom asset domain), delivery bypasses
this endpoint entirely and files are served from Cloudflare's edge directly — the
fastest option for public assets.

---

## 4. Database schema

Two tables in the `public` schema (migration
`migrations/202605250001_tenant_storage_management.sql`) form the catalog and quota
layer on top of raw R2 bytes.

### `tenant_storage_objects` — the file catalog

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID FK → `tenants(id)` | Tenant isolation boundary |
| `user_id` | UUID FK → `user_profile(user_id)` | Owning user |
| `scope` | TEXT | `'media'` or `'files'` (CHECK enforced) |
| `source_mount_id` | TEXT | Which configured mount holds the bytes |
| `folder_path` | TEXT | Logical folder within the scope |
| `object_key` | TEXT UNIQUE | Full R2 key — join key between DB and bucket |
| `filename` | TEXT | Sanitized original filename |
| `content_type` | TEXT | MIME type |
| `size_bytes` | BIGINT | Drives quota accounting |
| `metadata` | JSONB | Free-form extension point |
| `created_by`, `created_at`, `updated_at` | | |

RLS policies restrict SELECT/INSERT/DELETE to the owning user within their tenant;
tenant admins and super admins get broader access. **A service-role/admin client must
be used when registering objects on behalf of users in in-Worker code paths that don't
carry the user's token** — the platform helper `registerTenantStorageObject()` handles
this correctly.

### `tenant_storage_allocations` — quotas

Composite PK `(tenant_id, user_id)` with `quota_bytes`, `used_bytes_cached` (denormalized),
and `status` (`active` / `suspended`). An AFTER INSERT/UPDATE/DELETE trigger on
`tenant_storage_objects` keeps `used_bytes_cached` in sync — you never update it manually.

### Indexes

- `idx_tenant_storage_objects_tenant_user_scope (tenant_id, user_id, scope, created_at DESC)`
- `idx_tenant_storage_objects_object_key (object_key)` — fast lookup during delivery

---

## 5. Object key convention

Keys are deterministic and tenant-scoped. Never construct them client-side — the upload
endpoint builds them:

```
tenant/{tenantId}/user/{userId}/{scope}[/{folderPath}]/{uuid}-{sanitizedFilename}
```

Example:

```
tenant/7c9e…/user/a1b2…/media/blog/3f2a8c90-7d41-4e2f-b1aa-9c0d1234abCD-hero.jpg
```

Properties:

- **Tenant prefix first** — enables cheap prefix-based access reviews and lifecycle rules.
- **UUID prefix** on filenames guarantees uniqueness even for repeated uploads of the
  same file name.
- **Sanitization** — filenames are reduced to `[a-zA-Z0-9._-]`; everything else becomes `_`.
- The `scope` segment separates end-user-visible media (`media`) from generic documents
  (`files`).

---

## 6. R2 binding (in-Worker integrations only)

Declared once, centrally, in `wrangler.jsonc`:

```jsonc
"r2_buckets": [
  { "binding": "MEDIA_BUCKET", "bucket_name": "pluraconr2" }
]
```

Key facts:

- Binding name: **`MEDIA_BUCKET`**, typed as `R2Bucket` in `Env`
  (`api/lib/supabase.ts`).
- `r2_buckets` is **core-owned** — plugins and external services must not declare their
  own buckets. Plugins consume the shared binding through their mounted API routes.
- Delivery options, in order of preference:
  1. **`R2_PUBLIC_URL` var / `storage.r2_public_url` config** → custom asset domain
     (customary Cloudflare cached domain). Fastest, publicly readable — use only for
     non-sensitive assets.
  2. **Signed worker URLs** via `buildSignedWorkerMediaFileUrl()`: HMAC-SHA256 over
     `media:{path}`, base64url-encoded, keyed by `SECRETS_ENCRYPTION_KEY`. Works for
     private assets without extra infrastructure.
- Standard operations: `MEDIA_BUCKET.put(key, body, { httpMetadata: { contentType } })`,
  `.get(key)`, `.delete(key)`.

### If you write objects with the binding directly (plugins!)

Always mirror the platform flow:

```ts
// 1. Enforce quota + build key via helpers (api/lib/tenantStorageMgt.ts)
const summary = await ensureTenantStorageSummary(env, auth, { scope: 'media' });
assertTenantStorageAccess(summary);
assertTenantStorageQuota(summary, buf.byteLength);
const scoped = buildTenantStorageObjectKey({ tenantId, userId, scope: 'media', folderPath, filename });

// 2. Write bytes
await env.MEDIA_BUCKET.put(scoped.objectKey, buf, { httpMetadata: { contentType } });

// 3. Register the catalog row (rolls back the R2 write on failure)
await registerTenantStorageObject(env, auth, { /* … */ });
```

Skipping step 3 produces untracked bytes: invisible listings, uncounted quota, and
delivery authorization failures.

---

## 7. Recommended integration pattern

For the simplest, most secure, and most performant integration from an external
microservice or agent:

1. **Obtain a token once** (OAuth 2.1 + PKCE for agents; see
   [`oauth-mcp-authentication.md`](../auth/oauth-mcp-authentication.md)) and reuse it
   until refresh is required. Do not embed long-lived service keys anywhere.
2. **Upload through `POST /api/media/upload`** and persist the returned `path` (object
   key) plus `url` in *your own* service tables. Treat the CMS as the single source of
   truth for bytes; treat your table as the reference ("which file belongs to which
   record").
3. **Serve via signed URLs for private assets**, or ask the operator to set
   `R2_PUBLIC_URL` if the assets are public — then use the direct CDN URLs and skip the
   worker round-trip entirely.
4. **Never delete bytes yourself.** Call `DELETE /api/media/file` so the catalog row and
   quota stay consistent.
5. **Do not poll `/list`** for changes; query `tenant_storage_objects` (via an allowed
   authenticated context) or subscribe to your own reference table instead. Listing is
   a UI convenience endpoint, not an event stream.

This gives you: one authenticated ingress (no scattered credentials), tenant isolation
enforced twice (API + RLS), automatic quota enforcement, and edge-cached delivery.

---

## 8. Frontend media picker — consistency guide

The reference implementation is `src/components/pagebuilder/ImageUploader.tsx`
(reference picker used by the page builder and content editors). Any frontend surface
that lets users pick, upload, or delete stored objects MUST follow this section so the
experience stays uniform across core pages and plugins.

### 8.1 File storage vs. media storage — same pipeline, different presentation

The database supports exactly two values for `tenant_storage_objects.scope`:
`'media'` and `'files'`. They share one infrastructure (tables, quotas, key convention,
delivery endpoint, RLS) and differ only in **intent and presentation**:

| | **Media** (`scope: 'media'`) | **Files** (`scope: 'files'`) |
|---|---|---|
| Intent | Assets **rendered inline** on pages: images, audio, video, SVG | Generic documents **downloaded**: PDFs, invoices, exports, data files |
| Referenced by | URL embedded in content (schema JSON, rich text, block fields) | Path stored in your own records; delivered as a download link |
| Delivery | Signed worker URL or public CDN URL (`R2_PUBLIC_URL`) — cacheable, hot-linked | Signed worker URL with `Content-Disposition: attachment` semantics expected by the client |
| Picker UI | Thumbnail **grid**, visual selection, drag-and-drop upload tab | **List rows** with filename, size, date; explicit "Datei auswählen" action |
| Preview | Rendered thumbnail (see `AuthenticatedImage` pattern below) | No inline preview; icon + filename only |
| Folder conventions | Organized by feature/purpose: `blog/`, `products/`, `events/` | Organized by process/time: `invoices/2026`, `exports/` |
| MIME filtering | `accept: { 'image/*': [...] }` etc., enforced in the dropzone | Permissive; rely on server-side quota and sanitization |
| Deletion UX | Warn that the asset may be **embedded in published pages** | Warn about loss of the document only |

Structuring rules for a consistent experience:

1. **One pipeline, one picker family.** Both scopes go through `/api/media/*` and both
   are surfaced through the same dialog chrome (drive selector → tabs → footer buttons).
   Only the item renderer and MIME filter change.
2. **Scope is chosen at upload time, not browse time.** The upload call decides the
   scope segment of the object key (pass `scope=files` on `/upload` for documents);
   the browse view selects its scope via `?scope=` on `/list` and must never mix
   scopes in one listing.
3. **Persist the returned `url` (signed delivery URL), not just the `path`.** The URL
   is what content schemas embed; the `path` is what you need for later DELETE calls.
   Store both when your feature manages its own lifecycle.
4. **Never hand-build object keys or signed URLs client-side.** Upload returns both;
   reuse them verbatim.

### 8.2 Canonical component contract

Every picker variant exposes the same props so callers can swap them freely:

```tsx
interface MediaPickerProps {
  /** Committed value: the signed delivery URL returned by POST /upload (or an external URL). */
  value?: string;
  onChange: (url: string) => void;
  /** 'banner' = landscape strip (hero/cover), 'avatar' = circle (profile pictures). */
  previewVariant?: 'banner' | 'avatar';
}
```

Behavioral invariants (all already implemented in `ImageUploader.tsx`):

- **Component boundary is string-only.** Persisted schema values may contain legacy
  metadata objects — coerce to `''` before passing down so URL resolvers never receive
  unsafe values.
- **Upload = select.** A successful drop auto-commits the returned URL via `onChange`
  and closes the dialog. Users never press "Auswählen" right after uploading.
- **Deleting the committed value** is done from the hover overlay on the preview
  (X button), not by opening the picker.
- **All user-facing strings are German.**

### 8.3 Reference snippets

#### Auth headers helper (shared by every storage call)

```ts
const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return {};
  return { Authorization: `Bearer ${accessToken}` };
}, []);
```

#### Rendering stored media inside an authenticated SPA

Worker-delivered media requires the bearer token, so `<img src>` alone fails. Fetch
as blob once and hand the object URL to the `<img>` element:

```tsx
const AuthenticatedImage = ({ src, alt, className, getAuthHeaders }) => {
  const [resolvedSrc, setResolvedSrc] = useState(src);
  useEffect(() => {
    let revokedUrl: string | null = null;
    let disposed = false;
    void (async () => {
      try {
        const response = await fetch(src, { headers: await getAuthHeaders() });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const objectUrl = URL.createObjectURL(await response.blob());
        revokedUrl = objectUrl;
        if (!disposed) setResolvedSrc(objectUrl);
      } catch {
        if (!disposed) setResolvedSrc(src); // fall back (e.g. external/public URLs)
      }
    })();
    return () => {
      disposed = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [src, getAuthHeaders]);
  return <img src={resolvedSrc} alt={alt} className={className} />;
};
```

For committed values displayed outside dialogs, run them through
`resolveMediaUrl()` / `useResolvedMediaUrl()` (`src/utils/mediaUrl.ts`). That resolver
also invokes the documented plugin hook target **`media.url.resolve`** — plugins may
rewrite URLs there instead of patching components.

#### Storage API helpers (one place, reused everywhere)

```ts
export const mediaApi = {
  async sources() {
    const res = await fetch(`${API_URL}/api/media/sources`, { headers: await getAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { sources: MediaSourceInfo[] }).sources ?? [];
  },

  async list(path: string, source?: string, scope: 'media' | 'files' = 'media'): Promise<MediaItem[]> {
    const params = new URLSearchParams({ path, scope });
    if (source) params.set('source', source);
    const res = await fetch(`${API_URL}/api/media/list?${params}`, { headers: await getAuthHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ((await res.json()) as { items: MediaItem[] }).items ?? [];
  },

  async upload(file: File, opts: { path?: string; source?: string; scope?: 'media' | 'files' } = {}) {
    const formData = new FormData();
    formData.append('file', file);
    if (opts.path) formData.append('path', opts.path);
    if (opts.source) formData.append('source', opts.source);
    if (opts.scope) formData.append('scope', opts.scope); // 'media' (default) | 'files'
    const res = await fetch(`${API_URL}/api/media/upload`, {
      method: 'POST', body: formData, headers: await getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { url: string; path: string }; // persist BOTH
  },

  async remove(path: string, source?: string) {
    const params = new URLSearchParams({ path });
    if (source) params.set('source', source);
    const res = await fetch(`${API_URL}/api/media/file?${params}`, {
      method: 'DELETE', headers: await getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  },
};
```

#### Picker dialog skeleton

Fixed anatomy — drive selector (only when >1 source), tabs, grid/dropzone, footer:

```tsx
<Dialog open={isOpen} onOpenChange={handleOpenChange}>
  <DialogContent className="max-w-4xl max-h-[80vh]">
    <DialogHeader>
      <DialogTitle>Bild auswählen oder hochladen</DialogTitle>
    </DialogHeader>

    {/* Drive selector — render ONLY when availableSources.length > 1 */}
    {availableSources.length > 1 && (
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {availableSources.map((src) => (
          <button key={src.id} type="button"
            onClick={() => handleSourceChange(src.id)}
            className={cn('rounded-xl border p-3 text-left transition-colors',
              activeSourceId === src.id
                ? 'border-primary bg-primary/5 shadow-sm'
                : 'border-border bg-background hover:bg-muted/60')}>
            <span className="truncate text-sm font-medium">{src.label}</span>
            {src.isDefault && <Badge variant="secondary">Default</Badge>}
          </button>
        ))}
      </div>
    )}

    <Tabs defaultValue="library" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="library">Medien</TabsTrigger>
        <TabsTrigger value="upload">Vom Computer hochladen</TabsTrigger>
      </TabsList>

      {/* Library: breadcrumb row + scrollable thumbnail grid */}
      <TabsContent value="library" className="space-y-4">
        <div className="flex items-center justify-between">{/* Zurück + /path | Neuer Ordner */}</div>
        <ScrollArea className="h-[400px] w-full rounded-md border p-4">
          <div className="grid grid-cols-3 gap-4">
            {mediaItems.map((item) => item.isFolder ? <FolderTile …/> : <ImageTile …/>)}
          </div>
        </ScrollArea>
      </TabsContent>

      {/* Upload: dropzone; success auto-commits via onChange(url) and closes */}
      <TabsContent value="upload" className="space-y-4">
        <div {...getRootProps()} className={cn(
          'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50')}>
          <input {...getInputProps()} />
          {/* Uploader-Zustand: Loader2-Spinner + „Wird hochgeladen…“ */}
        </div>
      </TabsContent>
    </Tabs>

    <div className="flex justify-end space-x-2 mt-4">
      <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Abbrechen</Button>
      <Button type="button" onClick={() => { void handleConfirm(); }} disabled={!selectedImage}>Auswählen</Button>
    </div>
  </DialogContent>
</Dialog>
```

#### File-scope picker variant

Reuse the identical skeleton with these deltas:

- Replace the thumbnail grid with a **row list**: filename, human-readable size,
  `createdAt`, download/open action; selection via radio-style highlight.
- Dropzone accepts documents (`application/pdf`, office types…) without image filters.
- Footer primary button reads „Datei auswählen“; empty state reads „Keine Dateien
  gefunden“.
- Delete confirmation copy drops the "may be embedded in published pages" warning.

### 8.4 Consistency checklist

Before shipping any surface that touches stored objects, verify:

- [ ] Uses `mediaApi`-style helpers — no ad-hoc fetch calls with hand-built URLs.
- [ ] Renders remote media through the `AuthenticatedImage` blob pattern (or a
      resolved public URL), never a bare `<img src="/api/media/file…">`.
- [ ] Drive selector appears only with multiple sources; default source preselected.
- [ ] Successful upload auto-commits and closes; errors surface as German sonner
      toasts with the server-provided message.
- [ ] Deletes go through `DELETE /api/media/file` behind an `AlertDialog` — never
      silent deletes, never direct bucket access.
- [ ] Scope matches intent: rendered assets → `'media'`; downloadable documents →
      `'files'`.
- [ ] Stores both `url` and `path` where the feature owns lifecycle; stores `url`
      only when embedding into content schemas.

