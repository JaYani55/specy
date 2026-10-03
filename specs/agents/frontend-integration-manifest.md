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
    "slug": "d41c...",
    "schema_slug": "public-events",
    "api_slug": "d41c...",
    "content_scope": "page-collection",
    "entity_kind": "event"
  },
  "frontend": {
    "url": "https://frontend.example.com",
    "registration_status": "registered"
  },
  "data": {
    "available": true,
    "collection_url": "https://cms.example.com/api/schemas/d41c.../pages",
    "detail_url_template": "https://cms.example.com/api/schemas/d41c.../pages/:slug",
    "authentication": "public-registered-schema",
    "published_only": true,
    "supported_includes": ["entity", "event", "product"]
  },
  "targets": [
    {
      "target_key": "events.detail",
      "kind": "detail-page",
      "host_path": "/events/:slug",
      "supports_preview": true
    }
  ],
  "revalidation": {
    "enabled": true,
    "endpoint": "/api/revalidate",
    "authorization": "bearer",
    "requests_per_target": true,
    "supports_new_routes": null
  },
  "legacy": {
    "slug_structure": "/events/:slug"
  }
}
```

## Rules

- The manifest never contains a revalidation secret.
- `schema_slug` is tenant-local and suitable for CMS display. `api_slug` is the stable API identifier used in schema endpoint URLs; existing schemas retain their former slug as their `api_slug`.
- `frontend.url` is the normalized registered origin; canonical requirements and historical preview URLs are separate metadata.
- `targets` are authoritative for route construction. `legacy.slug_structure` is compatibility metadata only.
- `schema.entity_kind` identifies `page`, `service-product`, or `event`. Registered ordinary pages and service-product pages have public delivery; a focused event-page collection/detail projection is also available.
- `data.supported_includes` is allow-listed by entity kind: service products support `entity`; event pages support `entity`, `event`, and `product`; ordinary pages support none.
- `data.available` is false and collection/detail URLs are null only when an entity-specific public delivery contract is unavailable.
- Public collection and detail endpoints expose only registered schemas and pages with `status = 'published'`.
- `published_at` represents the latest transition into `published` and is returned by public page delivery.
- Revalidation is a CMS/operator-triggered request. The CMS sends one request per enabled target with `path` and the bare page `slug` query parameters plus `Authorization: Bearer <secret>`.
- `revalidation.supports_new_routes` is currently `null` (unknown), not a promise. Registration/health checks do not prove that a static frontend can generate new routes. An acknowledgement-only endpoint is not equivalent to ISR.

## Endpoint contract

```text
GET /api/schemas/:slug/pages[?include=entity,event,product]
GET /api/schemas/:slug/pages/:pageSlug[?include=entity,event,product]
```

Both responses use the same schema slug and target contract. Page records include `id`, `slug`, `name`, `status`, `content`, `domain_url`, `updated_at`, and `published_at`. Event schemas return only published pages linked to same-tenant event rows with a valid IANA timezone. `include=event` adds the allow-listed schedule projection; `include=product` adds a product reference only when its product page is published and registered. These relation envelopes do not modify `content` and never expose company, meeting URL, staff/account, approval, compensation, or internal scheduling fields.

The revalidation handler receives one request per target:

```text
POST /api/revalidate?path=/blog/example&slug=example
Authorization: Bearer <registered-secret>
```

## Backward compatibility

Existing clients may continue using `slug_structure`, registration payloads, and schema specs. New agents should use the normalized manifest and target registry.
