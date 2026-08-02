# Schema Frontend Target Compatibility Tests

## Summary

Adds focused compatibility fixtures and Node tests for the schema frontend-target model. The tests cover root collection slots, fragment rejection, dynamic-route separation, and preservation of arbitrary Blog schema content keys.

## Files Added

- `tests/schemaRouting.test.mjs`
- `tests/fixtures/legacy-blog-schema.json`
- `tests/fixtures/legacy-blog-content.json`
- `specs/changes/2026-08-02-schema-frontend-target-tests.md`

## Files Changed

- `package.json` — adds `npm test` using Node’s built-in test runner.

## Impact

The fixtures are test-only and do not modify database schema or production content. The rich Blog fixture explicitly covers `Content`, `Code Block`, `author-name`, `media`, nested `ContentBlock[]`, nested `CodeBlock[]`, legacy `string[]`, and all major legacy sections.

The tests establish that collection placement at `/` is distinct from a `:slug` detail route and that `#posts` remains a frontend-only fragment.

## Compatibility invariant

The supplied Blog schema is treated as an opaque persisted contract. Target migration, target registration, target updates, MCP specs, and public page delivery must not rename or filter `Content`, `Code Block`, `author-name`, `author-picture`, `media`, nested blocks, legacy `string[]`, or unknown content extension keys.
