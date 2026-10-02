# Product form error feedback

## Summary

Added explicit error toasts for product form validation failures and unexpected submission errors. Invalid form states now report through the same feedback channel even when React Hook Form prevents the submit handler from running; existing inline field messages remain available. Also removed duplicate submission wiring from the form-header update button so one click produces one form submission.

## Files Added

- None.

## Files Changed

- `src/components/events/ProductForm.tsx` — added localized toast feedback for resolver validation errors and caught submission errors.
- `src/components/events/ProductManagementModal.tsx` — added a toast for unexpected errors from the modal's submission path.
- `src/components/products/form/ProductFormHeader.tsx` — routes update through the containing form's submit handler exactly once.
- `specs/features/service-products.md` — documented the legacy product form's error feedback.

## Impact analysis

### Database

No database changes or migrations.

### Runtime

Invalid or failed product updates now display an error toast instead of failing silently. Header and footer update actions each submit through the form once. API errors continue to use the existing product-management hook behavior.

### API surface

No API or MCP changes.

## Verification

- `npm run typecheck` — passed.
- `npm test` — passed (358 tests).
- `npm run build` — passed; existing plugin dynamic-import and bundle-size warnings remain.
- Vite served the app shell and transformed the form, modal, and header submission paths. An authenticated browser interaction was not available in this environment.
