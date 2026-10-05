# Backfill typed Event registration and participant capacity

## Summary

Added an idempotent forward migration to populate the operational Event fields `registration_status`, `participant_min`, and `participant_max` from explicit legacy Event custom-field or linked Page-content values. Recognized German/English status labels are mapped to the stable enum. Unknown labels, malformed capacities, and conflicting minimum/maximum values are not guessed; they remain unset for review. Existing structured values are never overwritten. Existing Product Object projection triggers refresh linked Object streams as Event rows are backfilled.

## Files Added

- `migrations/202610050001_backfill_event_registration_capacity.sql` — safe legacy-value normalization and backfill.
- `tests/eventRegistrationCapacityBackfill.test.mjs` — contract checks for mappings, precedence, and rerun safety.

## Files Changed

- `scripts/lib/migration-order.mjs`, `specs/platform/unified-setup-tui.md` — register the migration in dependency order and deployment taxonomy.
- `specs/features/event-catalogue.md`, `specs/features/service-products.md`, `specs/architecture/system-overview.md` — document backfill semantics and migration rollout boundary.

## Impact analysis

### Database

Backfills only null structured fields. `registration_status` recognizes stable enum values and explicit localized equivalents such as `Anmeldung offen`; participant capacity reads typed numeric values from `custom_fields` (`participant_min`/`participant_max`, including legacy camelCase keys) and linked `pages.content`. Values must be positive integers and satisfy the minimum/maximum range constraint. The operation is idempotent and leaves ambiguous data untouched.

### Runtime

Existing Event writes already persist these typed fields, and the generated Product Object projection already reads them. Event-row updates synchronously refresh generated Product Objects through the existing database trigger. No frontend inference from free text is introduced.

### API surface

No endpoint shape changes. Public Event Pages snapshots and Product Objects continue to expose the typed fields; they will contain migrated values where valid legacy source data exists.

## Rollout

Apply after the deployed typed-field migration `202610040006_product_event_dynamic_data_contract.sql`. Verify the reported four Events after migration: recognized status/capacity values should be populated from stored sources; any row still null should be reviewed as having no recognized, non-conflicting source value. The migration itself was not applied to the configured database during this change.
