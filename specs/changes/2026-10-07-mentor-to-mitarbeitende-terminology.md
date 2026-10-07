# 2026-10-07 — Rename user-facing "Mentor" terminology to "Mitarbeitende"/"Staff"

## Summary

Consolidated the staff terminology across the dashboard. The product area had
already been migrated ("Mitarbeiter"/"Staff"), but many older event, profile,
and admin screens still displayed "Mentor", "Mentoren", "MentorInnen", and
"Mentoring-Management". All user-facing display strings were renamed:

- German: "Mentor/Mentoren/MentorInnen" → "Mitarbeiter/Mitarbeitende"
  (plural contexts), compounds like "Mentorenanforderungen" →
  "Mitarbeiteranforderungen", "MentorInnen-Verwaltung" →
  "Mitarbeiter-Verwaltung", "Mentoring-Management" → "Mitarbeiter-Management".
- English: "Mentor(s)" → "Staff"/"Staff member(s)", "Mentoring Management" →
  "Staff Management".

**Deliberately unchanged** (technical identifiers, no user-visible impact):

- Role keys and role checks (`'mentor'`, `isMentor`, `canManageMentors`,
  `canViewMentorProfiles`, `MentorStatusBadge`, …).
- Database/service identifiers (`mentorbooking_events`, `mentorbooking_products`,
  `mentor_groups`, `mentorService`, `mentorGroupService`, `fetchMentors`,
  RPC names like `process_mentor_actions`).
- Route paths (`/admin/all-mentors`, `/admin/add-mentor`,
  `/admin/traitsmentorassign`) — labels already display "Mitarbeiter".
- SeaTable field mappings (`Mentor_ID`, `Mentor_seit`, `MentorInVereinbarung`,
  `newmentor` form URL) — external system field names.
- Component/file names and variables (`MentorSelector`, `MentorRequestsModal`,
  `requestingMentors`, …).

## Files Changed (28)

Display-string only changes in:

- `src/components/Info/Roleinfo.tsx` — role descriptions
- `src/components/admin/GroupTabs.tsx` — drag/drop hints
- `src/components/events/MentorSelector.tsx`, `MentorStatusTabs.tsx`,
  `MentorRequestsModal.tsx`, `ManualMentorApproval.tsx`,
  `ProductApprovedMentorSelector.tsx`,
  `EventFormSections/ProductApprovedMentorSelectSection.tsx`,
  `EventDescriptionCard.tsx`
- `src/components/lists/ListFilters.tsx`, `ListTable.tsx`
- `src/components/mentors/MentorStatusBadge.tsx`, `seatablementorform.tsx`
- `src/components/profile/AccessDenied.tsx`, `EditableUsername.tsx`,
  `ProfileImageUpload.tsx`, `RegistrationInProcess.tsx`,
  `SeaTableDataUnavailable.tsx`
- `src/components/shared/ConfirmationModal.tsx`
- `src/components/ui/RequestButton.tsx`, `RoleIndicator.tsx`
- `src/hooks/useEventActions.tsx` — assignment toasts
- `src/pages/Verwaltung.tsx`, `VerwaltungAllProducts.tsx`, `ProductDetail.tsx`,
  `Plugins.tsx`
- `src/utils/roleUtils.ts`
- `src/services/events/mentorService.ts` — fallback error messages

## Impact Analysis

- **Database:** none.
- **Runtime:** display text and toast/error message wording only. No logic,
  keys, permissions, or data flow changed.
- **API surface:** none.