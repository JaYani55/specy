# Blogpost Editor Content Normalization

Date: 2026-08-04

## Summary

Fixes a runtime `TypeError: e.split is not a function` that could occur when editing a blogpost containing legacy or malformed JSON values. Schema content loaded from `pages.content` is now normalized before it reaches media and rich-text editors, with additional component-level guards.

## Files Added

- `specs/changes/2026-08-04-blogpost-editor-content-normalization.md`

## Files Changed

- `src/components/pagebuilder/SchemaPageBuilderForm.tsx`
- `src/components/pagebuilder/ImageUploader.tsx`
- `src/components/pagebuilder/MarkdownEditor.tsx`

## Root Cause

The schema editor trusted JSON values from the database through TypeScript casts. A non-string media value could reach `ImageUploader`, where the avatar preview called `.split('/')`. Similarly, malformed text-block content could reach `MarkdownEditor`, whose parser calls `.split('\n')`.

## Fix

- Normalize schema fields recursively during initial form setup and JSON import.
- Convert invalid string and media values to empty strings.
- Ensure arrays, objects, content blocks, lists, booleans, and numbers have safe editor-compatible shapes.
- Guard `ImageUploader` and `MarkdownEditor` at their component boundaries so they only process strings.

## Impact Analysis

- **Database:** No migration and no data mutation. Existing malformed values are repaired in the editor state and are only persisted in normalized form when the page is saved.
- **Runtime:** Blogpost editing no longer crashes when a media field or markdown content value is an object, array, or other non-string JSON value.
- **API surface:** No API or endpoint changes.
- **Compatibility:** Valid existing content is preserved; invalid values display as empty editable fields rather than throwing.

## Validation

- `npm run build` completed successfully.
- Existing Pylance/TypeScript diagnostic in `MarkdownEditor.tsx` around the link attribute helper remains unrelated to this change; Vite production compilation succeeds.
