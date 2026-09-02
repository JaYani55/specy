# 2026-09-02 — Pages Onboarding: Technical Documentation behind a Collapsible

## Summary

On the **Pages** page (`src/pages/Pages.tsx`), the empty-state onboarding card
(shown when no frontend is connected yet) previously displayed all technical
documentation inline, overwhelming non-technical users. The technical sections
are now hidden behind a collapsible **"Technical Documentation" /
"Technische Dokumentation"** dropdown, collapsed by default:

- "How Domains (TLDs) Work" explanation
- "Your API Endpoints" (REST + MCP endpoints)
- "Example Agent Prompt" (incl. framework toggle)

Still visible by default (non-technical friendly):

- Status badge ("No frontends connected yet")
- Main instruction ("Connect a Frontend to Get Started")
- A short hint guiding technical users to the dropdown
- The 4-step "How to Connect" guide
- "Available Schemas" cards

## Files Added

- `specs/changes/2026-09-02-pages-onboarding-collapsible-technical-docs.md` (this file)

## Files Changed

- `src/pages/Pages.tsx`
  - Added `showTechnical` state (default `false`) to `OnboardingScreen`.
  - Moved the TLD explanation, API endpoints and example agent prompt sections
    inside a shadcn/ui `Collapsible` (components were already imported).
  - Added a full-width `CollapsibleTrigger` button with a rotating chevron and
    the subtitle "— for developers & AI agents".
  - Added a hint line under the main instruction pointing technical users to
    the dropdown.

## Impact Analysis

- **Database:** None.
- **Runtime:** None (pure UI state change; collapse state is not persisted).
- **API surface:** None.

## Notes

- All user-facing text remains in German per project convention (with English
  variants where the file already used the `language` toggle).
- No core/plugin boundary changes; this is a core UI improvement.
