# 2026-09-02 — Local Feature Flags: Beta Features & Developer Mode

## Summary

Added a client-side feature-flag system persisted in the user's browser
(`localStorage`) with two flags, toggleable in `/settings`:

- **Beta-Funktionen / Beta Features** — **off by default**. Gates the
  PluraDash **Second Brain** page (`/plugins/pluradash/secondbrain`).
- **Entwicklermodus / Developer Mode** — **off by default**. Gates technical
  documentation in the frontend, currently the "Technical Documentation"
  dropdown on the Pages onboarding screen (`/pages`, no frontends connected):
  TLD explainer, REST/MCP API endpoints, and the example agent prompt.

Non-technical users now see a clean onboarding card by default; with
developer mode enabled the "Technical Documentation" collapsible and its
hint line appear exactly as before. Disabling beta features removes the
Second Brain sidebar entry, its route, and the plugin's in-page view selector
entry — direct navigation falls through to the 404 page.

Flags are device-local UI toggles only — never a security boundary
(role checks and API authorization are unchanged).

## Files Added

- `src/contexts/FeatureFlagsContext.tsx` — provider, `FEATURE_FLAGS` registry
  (`betaFeatures` default `true`, `devMode` default `false`), `useFeatureFlags()`
  hook, localStorage persistence under `specy.feature-flags.v1`.
- `specs/platform/feature-flags.md` — contract documentation.
- `specs/changes/2026-09-02-feature-flags-beta-dev-mode.md` (this file).

## Files Changed

- `src/types/plugin.ts` — new `PluginFeatureFlag` union; optional
  `featureFlag` field on `PluginRoute` and `PluginSidebarItem`.
- `src/plugins/loader.ts` — `getPluginRoutes`, `getPluginSidebarItems`,
  `getPluginSidebarTree` accept optional `PluginFeatureFlagState` and filter
  flag-gated contributions (fail-open when omitted).
- `src/App.tsx` — mounts `FeatureFlagsProvider`; passes live flag state to
  `getPluginRoutes`.
- `src/components/layout/AppSidebar.tsx`, `src/components/ui/Navbar.tsx` —
  pass live flag state to `getPluginSidebarTree`.
- `src/pages/Settings.tsx` — new "Feature Flags" card rendering the flag
  registry with `Switch` toggles (German/English labels, EN/DE descriptions,
  "off by default" badge for non-default flags).
- `src/pages/Pages.tsx` — onboarding screen: "Technical Documentation"
  collapsible (incl. separator and developer hint) rendered only when
  `devMode` is enabled.
- `plugins/pluradash/src/index.tsx` — `featureFlag: 'betaFeatures'` on the
  Second Brain route and sidebar item (plugin repo, gitignored).
- `plugins/pluradash/src/components/PluradashViewSelect.tsx` — hides the
  "Second Brain" view option when beta features are disabled (plugin repo).

## Impact Analysis

- **Database:** None — flags live in the browser only.
- **Runtime:** No API changes; `FeatureFlagsProvider` is a small React
  context. Toggling `devMode`/`betaFeatures` re-renders consumers immediately;
  no reload required (route changes take effect on next navigation).
- **API surface:** None. Worker API untouched; gating is presentation-only.
- **Plugin boundary:** Core provides the flag registry, context, settings UI
  and a generic declarative `featureFlag` field on plugin route/sidebar
  contributions. The plugin only declares which flag gates its items and
  imports `@/contexts/FeatureFlagsContext` (permitted interoperability import)
  for its internal view selector. No plugin logic in core files.

## Notes

- The Settings "Feature Flags" card renders from `FEATURE_FLAGS`, so future
  flags need no new Settings UI.
- See `specs/platform/feature-flags.md` for the full contract and the
  recipe for adding new flags.
