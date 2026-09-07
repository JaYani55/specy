# 2026-09-07 — Agent-API Card Shows Dynamic Answer Endpoint URL

## Summary

The Agent-API card in the form editor (*Formular-Editor → Agent-API*, directly
above the notification settings card) now displays the dynamic REST answer
endpoint of the form: `POST {API_URL}/api/forms/{slug}/answers` — the endpoint
through which any external frontend can submit answers.

- URL is resolved from the Worker API base (`VITE_API_URL` / deployment
  origin, via `src/lib/apiUrl.ts`) and the form slug (loaded slug; for unsaved
  new forms a preview derived from the name with a hint that the slug is
  finalized on save).
- Read-only mono input with focus-select-all and a copy button (clipboard +
  toast, transient check-icon feedback).
- Contextual hints: when *Authentifizierung erforderlich* is enabled, a note
  states that an `Authorization: Bearer` token is required; the payload shape
  `{ "answers": { … } }` is shown in the description.
- Rendered only when the Agent-API switch (`api_enabled`) is on.

## Files Changed

- `src/pages/FormEditor.tsx` — `formSlug`/`endpointCopied` state (slug set on
  form load), `answerEndpointUrl` computation, `copyAnswerEndpoint` handler,
  endpoint display block inside the Agent-API card.
- `specs/changes/2026-09-07-agent-api-answer-endpoint-url.md` (this document).

## Database / API impact

None. Pure frontend display change — the endpoint
`POST /api/forms/:identifier/answers` itself is unchanged.

## Verification

- `npm run typecheck` / `npm run build` — clean.
- Not verified in-browser here: open a saved form, confirm the URL shows
  `{origin}/api/forms/{slug}/answers`, copy works, and the hint appears when
  authentication is enabled.
