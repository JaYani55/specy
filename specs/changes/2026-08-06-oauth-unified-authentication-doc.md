# 2026-08-06 — OAuth Unified Authentication Integration Guide

## Summary

Added `specs/agents/oauth-unified-authentication.md`, an agent-facing overview and
implementation guide for integrating **another microservice** with Specy's OAuth 2.1
authentication stack to achieve unified (single sign-on) authentication.

The document is derived entirely from the existing implementation
(`specs/auth/oauth-mcp-authentication.md`, `api/lib/auth.ts`,
`migrations/Auth/Access_hook_oauth_claims.sql`, `api/index.ts` discovery endpoints).
No new behavior is specified.

Contents:

- Architecture: Supabase Auth as the single Authorization Server; microservices as
  OAuth clients and/or resource servers validating the same JWKS-signed tokens
- Discovery chain from `/.well-known/oauth-protected-resource` (RFC 9728)
- Client implementation guide: DCR or manual registration, Authorization Code + PKCE,
  refresh handling, token hygiene rules
- Resource-server guide: JWT validation algorithm (`jwks_uri`, signature/exp/iss),
  RFC 9728 challenge behavior, known v1 `aud` limitation
- The unified claim contract (`sub`, `user_roles`, `is_agent`, `tenant_id`) and how to
  interpret it in downstream services
- Agent account provisioning and revocation runbook summary
- Implementation checklist

## Files Added

- `specs/agents/oauth-unified-authentication.md`

## Files Changed

- `specs/agents/README.md` — registered the new document
- `specs/README.md` — added quick-answer entry point for microservice auth

## Impact Analysis

- **Database:** none.
- **Runtime:** none — documentation only.
- **API surface:** none — documents existing endpoints only.
