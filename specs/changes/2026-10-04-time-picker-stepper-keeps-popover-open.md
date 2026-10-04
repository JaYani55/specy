# Time picker stepper keeps the picker open

## Summary

Fixed the `/create-event` start-time picker so clicking the hour or minute up/down controls updates the time without closing the picker. Choosing a preset or a value from the hour/minute lists continues to close it as before.

## Files Added

- `tests/timePicker.test.mjs` — regression check that step adjustments opt out of picker dismissal.

## Files Changed

- `src/components/events/time-picker.tsx` — made picker dismissal optional for time selection and keep the popover open for repeated stepper adjustments.

## Impact analysis

- **Database:** none.
- **Runtime:** operators can click repeatedly to set multiple hours/minutes without reopening the picker after each step. The existing visual design and selection behavior remain unchanged for presets and list selections.
- **API surface:** none.
