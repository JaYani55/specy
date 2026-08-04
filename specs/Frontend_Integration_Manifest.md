# Frontend Integration Manifest

## Status

Version 1 is the normalized, secret-free contract for a frontend consuming a registered Specy schema.

The manifest is derived from the authoritative `page_schemas` row and enabled `schema_frontend_targets`. Existing schema fields and registration payloads remain supported for compatibility.

## Required fields

```json
{
  "manifest_version": "1",
  "schema": {
    "id": "uuid",
    "slug": "field-notes-journal",
    "content_scope": "page-collection"
  },
  "frontend": {
    "url": "https://frontend.example.com",
    "registration_status": "registered"
  },
  "data": {
    "collection_url": "https://cms.example.com/api/schemas/field-notes-journal/pages",
    "detail_url_template": "https://cms.example.com/api/schemas/field-notes-journal/pages/:slug",
    "authentication": "public-registered-schema",
    "published_only": true
  },
  "targets": [
    {
      "target_key": "field-notes.detail",
      "kind": "detail-page",
      "host_path": "/blog/:slug",
      "supports_preview": true
    }
  ],
  "revalidation": {
    "enabled": true,
    "endpoint": "/api/revalidate",
    "authorization": "bearer",
    "requests_per_target": true,
    "supports_new_routes": true
  },
  "legacy": {
    "slug_structure": "/:slug"
  }
}
```

## Rules

- The manifest never contains a revalidation secret.
- `frontend.url` is the normalized registered origin; canonical requirements and historical preview URLs are separate metadata.
- `targets` are authoritative for route construction. `legacy.slug_structure` is compatibility metadata only.
- Public collection and detail endpoints expose only registered schemas and pages with `status = 'published'`.
- `published_at` represents the latest transition into `published` and is returned by public page delivery.
- Revalidation is a CMS/operator-triggered request. The CMS sends one request per enabled target with `path` and the bare page `slug` query parameters plus `Authorization: Bearer <secret>`.
- A frontend that cannot create or discover new routes at runtime must declare that limitation; an acknowledgement-only endpoint is not equivalent to ISR.

## Endpoint contract

```text
GET /api/schemas/:slug/pages
GET /api/schemas/:slug/pages/:pageSlug
```

Both responses use the same schema slug and target contract. Page records include `id`, `slug`, `name`, `status`, `content`, `domain_url`, `updated_at`, and `published_at`.

The revalidation handler receives one request per target:

```text
POST /api/revalidate?path=/blog/example&slug=example
Authorization: Bearer <registered-secret>
```

## Backward compatibility

Existing clients may continue using `slug_structure`, registration payloads, and schema specs. New agents should use the normalized manifest and target registry.
