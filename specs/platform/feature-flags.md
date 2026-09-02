# Feature Flags (Beta Features & Developer Mode)

Client-side, per-browser feature flags that toggle UI surface areas on and off.
They are **device-local by design**: they only hide or show interface elements
and never provide security gating — role checks and the API remain the
authoritative access layer.

## Contract

- Storage: `localStorage` key `specy.feature-flags.v1` (JSON object keyed by
  flag id). Written on every toggle; merged over defaults on read. If storage
  is unavailable, flags degrade to in-memory defaults.
- Context: `src/contexts/FeatureFlagsContext.tsx`
  - `<FeatureFlagsProvider>` is mounted in `App.tsx` (inside `ThemeProvider`).
  - `useFeatureFlags()` returns `{ flags, isFeatureFlagEnabled, setFeatureFlag }`.
- Flag registry: `FEATURE_FLAGS` in the same file. Each entry has an id,
  EN/DE label, EN/DE description and a `defaultValue`.
- Settings UI: the "Feature Flags" card in `/settings` renders the registry
  automatically — adding a flag there requires no UI change.

## Available Flags

| Flag | Default | Purpose |
|---|---|---|
| `betaFeatures` | off | Surfaces beta features, e.g. the PluraDash **Second Brain** page (`/plugins/pluradash/secondbrain`). |
| `devMode` | off | Surfaces technical documentation in the UI, e.g. the "Technical Documentation" dropdown on the Pages onboarding screen (API endpoints, TLD explainer, agent prompt). |

## Plugin Integration (documented hook/API surface)

Plugins declare flag-gated UI declaratively — they never import the React
context for gating routes/sidebar items:

- `src/types/plugin.ts` exports `PluginFeatureFlag = 'betaFeatures' | 'devMode'`.
- `PluginRoute` and `PluginSidebarItem` accept an optional
  `featureFlag?: PluginFeatureFlag` field.
- `src/plugins/loader.ts` (`getPluginRoutes`, `getPluginSidebarItems`,
  `getPluginSidebarTree`) accepts an optional `PluginFeatureFlagState` object
  and filters out contributions whose flag is disabled. When the state is
  omitted, all flags are treated as enabled (fail-open) for non-flag-aware
  callers.
- Core call sites passing live flag state:
  - `App.tsx` — plugin route registration.
  - `src/components/layout/AppSidebar.tsx` and
    `src/components/ui/Navbar.tsx` — plugin sidebar trees.

Example (plugin `src/index.tsx`):

```ts
routes: [
  {
    path: '/plugins/my-plugin/labs',
    component: LabsPage,
    featureFlag: 'betaFeatures',
  },
],
sidebarItems: [
  {
    key: 'my-plugin-labs',
    path: '/plugins/my-plugin/labs',
    label: 'Labs',
    icon: FlaskConical,
    group: 'main',
    featureFlag: 'betaFeatures',
  },
],
```

Plugins may also import `useFeatureFlags` from `@/contexts/FeatureFlagsContext`
directly inside their components (permitted core import for interoperability),
e.g. to hide in-page links to flag-gated destinations.

## Adding a New Flag

1. Add the definition to `FEATURE_FLAGS` in
   `src/contexts/FeatureFlagsContext.tsx` (id, labels, description, default).
2. If plugins should consume it, add the id to the `PluginFeatureFlag` union
   in `src/types/plugin.ts`.
3. Document it in the table above and in `/specs/changes/`.
