# 2026-10-15 — Product menu color picker

## Summary

The product creation/edit form's **Farbe der Produktkarte (optional)** control no longer offers a fixed palette of base colors and shades. It now uses a standard color picker element: a native `<input type="color">` swatch next to a hex value text input (accepts `#RGB`/`#RRGGBB`, normalized on commit with inline validation feedback). The existing **Menü-Standard verwenden** action remains and clears the optional color so the menu's default styling applies.

- The stored data model is unchanged: `gradient` remains an optional presentational string. Existing products keep their stored hex values, which the picker displays and edits; non-hex legacy values (e.g. CSS gradients) are left untouched until the operator picks a new color.
- The unused `usedColors` workspace lookup (fetching other products' colors) was removed along with the swatch grid and the admin-only base-color step (`canChangeAnimalIcons` no longer gates the control).

## Files Added

- `specs/changes/2026-10-15-product-menu-color-picker.md` — this document.

## Files Changed

- `src/components/products/form/ProductColorGradientSelector.tsx` — rewritten from palette swatches to a standard color picker (native color input + hex entry + validation).
- `src/components/products/form/ProductFormGradient.tsx` — dropped the `usedColors` fetching and prop wiring.
- `specs/features/service-products.md` — documented the standard color picker for the optional menu color.

## Impact analysis

### Database

- No migration. `mentorbooking_products.gradient` keeps its meaning and format for all existing rows.

### Runtime

- Frontend-only change; the color value is still stored as a plain string and rendered wherever `product.gradient` is used (menu cards, product cards, event detail banner).

### API surface

- No REST/MCP changes.
