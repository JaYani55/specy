# Core Extension Points — AudioBlock, Queues & Plugin Secrets

Documents the core infrastructure changes introduced to support plugin-managed
Cloudflare Queues, plugin secrets store injection, the new `AudioBlock` content
type, and programmatic object creation.

---

## Table of Contents

1. [AudioBlock Content Type](#1-audioblock-content-type)
2. [Cloudflare Queues Integration](#2-cloudflare-queues-integration)
3. [Plugin Secrets Store Injection](#3-plugin-secrets-store-injection)
4. [Programmatic Object Creation](#4-programmatic-object-creation)
5. [EUPL Compliance Notes](#5-eupl-compliance-notes)

---

## 1. AudioBlock Content Type

### Type Definition

**File:** `src/types/pagebuilder.ts`

```typescript
export interface AudioBlock extends BaseBlock {
  type: 'audio';
  src: string;
  caption?: string;
  contentType?: string;
}

// Added to ContentBlock union:
export type ContentBlock = TextBlock | HeadingBlock | ImageBlock | QuoteBlock
  | ListBlock | VideoBlock | FormBlock | AudioBlock;
```

### Rendering

**File:** `src/components/objects/ObjectContentRenderer.tsx`

Audio blocks render as an `<audio>` element with native browser controls inside
a styled `<figure>` wrapper:

```tsx
<figure className="space-y-3 overflow-hidden rounded-2xl border bg-muted/20 p-4">
  <audio controls preload="metadata" className="w-full" src={block.src}>
    Ihr Browser unterstützt kein Audio-Playback.
  </audio>
  {block.caption && <figcaption>{block.caption}</figcaption>}
</figure>
```

The `src` is a direct signed URL — the same pattern used in the IsibotPage
voicefile playback table. No blob URL conversion is performed.

### Editing

| Editor | File | Notes |
|--------|------|-------|
| Standalone (dnd-kit) | `src/components/pagebuilder/StandaloneContentBlockEditor.tsx` | ImageUploader for file selection, audio preview, caption input |
| Object content blocks | `src/components/objects/ObjectContentBlocksEditor.tsx` | `audio` added to block type dropdown + `createDefaultBlock()` |
| Page builder forms | `src/components/pagebuilder/ContentBlockEditor.tsx` | Inherits from Standalone variant via ObjectContentBlocksEditor |
| Add block dropdown | `src/components/pagebuilder/AddContentBlock.tsx` | 🎵 Audio menu item |

### Usage

Audio blocks can be embedded in:
- **Object share pages** (markdown objects via ObjectEditor)
- **Product pages** (page builder, via ContentBlockEditor)
- **Programmatic creation** (via `createObjectInternal()` — used by the SMS notification service)

---

## 2. Cloudflare Queues Integration

### Overview

The core now supports Cloudflare Queues through three mechanisms:

1. **Plugin-declared queue bindings** in `plugin.json` → auto-injected into `wrangler.jsonc`
2. **Generic `queue()` handler** in the Worker default export → dispatches to plugin hooks
3. **`queue.message` hook contract** → plugins register handlers for queue processing

### Binding Injection

**File:** `scripts/lib/plugin-workspace.mjs`

`queues` was added to `PLUGIN_OWNED_BINDING_TYPES`. Plugins declare bindings as:

```json
{
  "wrangler_bindings": {
    "queues": {
      "producers": [
        { "queue": "<queue-name>", "binding": "<JS_BINDING>" }
      ],
      "consumers": [
        {
          "queue": "<queue-name>",
          "max_batch_size": 10,
          "max_batch_timeout": 5
        }
      ]
    }
  }
}
```

The merge script:
- Collects `queues.producers[]` and `queues.consumers[]` from all plugins
- Deduplicates by queue name within each category
- Generates the `"queues": { "producers": [...], "consumers": [...] }` JSONC block
- Injects it into the auto-generated PLUGIN BINDINGS section of `wrangler.jsonc`

### Queue Handler

**File:** `api/index.ts`

The Worker default export now includes a `queue()` method:

```typescript
export default {
  fetch: app.fetch,
  async scheduled(_event, env, ctx) { /* existing */ },
  async queue(batch, env, ctx): Promise<void> {
    const hooks = getRegisteredApiPluginHooks()
      .filter((h) => h.target === QUEUE_MESSAGE_HOOK);
    for (const message of batch.messages) {
      for (const hook of hooks) {
        const context = { message: message.body, env, ctx };
        ctx.waitUntil(Promise.resolve(hook.handler(context)) as Promise<void>);
      }
    }
  },
};
```

The handler:
1. Filters registered plugin hooks for `target === 'queue.message'`
2. Iterates all messages in the batch
3. Calls each matching hook handler with `{ message, env, ctx }`
4. Wraps each handler call in `ctx.waitUntil()` for proper lifecycle management

### Hook Contract

**File:** `api/lib/queueHooks.ts`

```typescript
export const QUEUE_MESSAGE_HOOK = 'queue.message';

export interface QueueMessageHookContext {
  message: unknown;
  env: Env;
  ctx: ExecutionContext;
}
```

Plugins import `QUEUE_MESSAGE_HOOK` and `QueueMessageHookContext` to register
queue message handlers in their hook files.

### Queue Type

**File:** `api/lib/supabase.ts`

A minimal `Queue` interface is defined to avoid hard dependencies on
`@cloudflare/workers-types`:

```typescript
export interface Queue<Body = unknown> {
  send(body: Body, options?: {
    contentType?: 'text' | 'bytes' | 'json' | 'v8';
    delaySeconds?: number;
  }): Promise<void>;
  sendBatch(messages: Iterable<{
    body: Body;
    contentType?: 'text' | 'bytes' | 'json' | 'v8';
    delaySeconds?: number;
  }>): Promise<void>;
}
```

---

## 3. Plugin Secrets Store Injection

### Overview

Previously, `secrets_store_secrets` was a core-owned binding type — plugins
could declare it in `plugin.json` but the merge script emitted a warning and
ignored it. This has been changed to allow plugin-contributed secrets.

### Injection Mechanism

**File:** `scripts/lib/plugin-workspace.mjs`

The `collectPluginWranglerBindings()` function now collects
`bindings.secrets_store_secrets[]` from plugin manifests and stores them in
the `collected` Map under the `'secrets_store_secrets'` key.

The `rebuildWranglerPluginBindings()` function:
1. Finds the `"secrets_store_secrets"` array in the core section (before PLUGIN BINDINGS)
2. Removes any previously injected plugin secrets (identified by `// <pluginId>` comments)
3. Inserts new plugin secrets before the closing `]` bracket
4. Deduplicates by `binding` name across plugins (conflicts cause `process.exit(1)`)

### Plugin Declaration

```json
{
  "wrangler_bindings": {
    "secrets_store_secrets": [
      {
        "binding": "SS_TWILIO_ACCOUNT_SID",
        "store_id": "<secrets-store-uuid>",
        "secret_name": "TWILIO_ACCOUNT_SID"
      }
    ]
  }
}
```

### Type Definition

**File:** `src/types/plugin.ts`

`PluginWranglerSecretsStoreBinding` already existed in the type system.
The `PluginWranglerBindings` interface already included `secrets_store_secrets`
— no type changes were needed. Only the injection machinery was updated.

---

## 4. Programmatic Object Creation

### Overview

The core objects API now exports a `createObjectInternal()` function that allows
plugins, queue consumers, and hooks to create objects without going through the
HTTP API layer.

### Export

**File:** `api/routes/objects.ts`

```typescript
export interface CreateObjectInternalInput {
  name: string;
  slug: string;
  description?: string | null;
  agent_description?: string | null;
  object_type?: 'json' | 'markdown';
  schema?: Record<string, unknown>;
  data?: Record<string, unknown> | unknown[];
  status?: 'published' | 'archived';
  requires_auth?: boolean;
  api_enabled?: boolean;
  share_enabled?: boolean;
  share_slug?: string | null;
  tenant_id?: string | null;
}

export async function createObjectInternal(
  env: Env,
  input: CreateObjectInternalInput,
): Promise<ObjectRow> {
  const admin = await createSupabaseAdminClient(env);
  const { data, error } = await admin
    .from('objects')
    .insert({ /* ... */ })
    .select()
    .single();

  if (error) throw new Error(`Failed to create object: ${error.message}`);
  return data as ObjectRow;
}
```

### Usage Pattern

Plugins import the function directly:

```typescript
import { createObjectInternal } from '../../../api/routes/objects';

const obj = await createObjectInternal(env, {
  name: 'My Object',
  slug: 'my-object-slug',
  object_type: 'markdown',
  data: { metadata: { ... }, content: [ ... ] },
  requires_auth: true,
  share_enabled: true,
  tenant_id: tenantId,
});
```

### Authorization

`createObjectInternal()` uses the **admin client** (bypasses RLS). Callers are
responsible for their own authorization checks. This is appropriate for:
- Queue consumers (already authenticated via connector secret)
- Plugin hooks (running in the trusted backend context)
- Scheduled tasks

---

## 5. EUPL Compliance Notes

### Extension Points (Core)

| File | Change | EUPL Classification |
|------|--------|---------------------|
| `src/types/pagebuilder.ts` | `AudioBlock` interface + union member | Interface extension (safe) |
| `src/types/plugin.ts` | `PluginWranglerQueuesBinding` + sub-types | Interface extension (safe) |
| `api/lib/supabase.ts` | `Queue` minimal interface | Functional requirement (safe) |
| `api/lib/queueHooks.ts` | Queue message hook contract | Interface definition (safe) |
| `api/index.ts` | `queue()` handler | Provider infrastructure (safe) |
| `api/routes/objects.ts` | `createObjectInternal()` export | Provider API (safe) |
| `scripts/lib/plugin-workspace.mjs` | Queues + secrets injection | Build-time merge (safe) |

### Rendering & Editing (Core)

| File | Change | EUPL Classification |
|------|--------|---------------------|
| `src/components/objects/ObjectContentRenderer.tsx` | Audio block rendering | UI component extension (safe) |
| `src/components/pagebuilder/StandaloneContentBlockEditor.tsx` | Audio block editing | UI component extension (safe) |
| `src/components/pagebuilder/AddContentBlock.tsx` | Audio menu item | UI component extension (safe) |
| `src/components/objects/ObjectContentBlocksEditor.tsx` | Audio in dropdown + factory | UI component extension (safe) |

All changes follow the Hook-and-Provider pattern: core provides extension points
(interfaces, hooks, exports), plugins provide implementations. No plugin logic
leaks into the core, and no core internals are modified to support a specific
plugin's business logic.