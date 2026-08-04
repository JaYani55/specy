# Blogpost Image URL Editor

Date: 2026-08-04

## Summary

The schema page editor now displays and edits externally hosted image URLs for hero images and content image blocks. API-created media objects are normalized to their URL before rendering.

## Files Added

- `specs/changes/2026-08-04-blogpost-image-url-editor.md`

## Files Changed

- `src/components/pagebuilder/ImageUploader.tsx`
- `src/components/pagebuilder/SchemaPageBuilderForm.tsx`

## Changes

- Added an editable `Bild-URL` field beside the media picker in the shared `ImageUploader` component. This supports direct HTTP(S) URLs such as Unsplash URLs.
- Preserved media-picker behavior and existing authenticated media URL resolution.
- Normalized schema media values supplied through the API when they are objects containing `src`, `url`, or `href`.
- Normalized content-block image `src` objects containing `src` or `url`.

## Impact Analysis

- **Database:** No migration. URL values are stored in the existing schema content JSON.
- **Runtime:** Hero media and content image blocks loaded from API-created JSON render as normal external images in the editor.
- **API surface:** No endpoint changes.
- **Security:** External URLs are rendered as supplied by the content author; the existing media picker and media URL resolution remain unchanged.

## Validation

- `npm run lint` passes.
- `npm run build` succeeds.
