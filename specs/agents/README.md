# Agent Experience

Everything an AI agent or external microservice needs to integrate with Specy.

| Document | Purpose |
|---|---|
| [`mcp-exposition.md`](mcp-exposition.md) | MCP server, spec/tool registry, and exposure model |
| [`agent-system-prompt.md`](agent-system-prompt.md) | The Specy agent system prompt |
| [`oauth-unified-authentication.md`](oauth-unified-authentication.md) | Implementing OAuth in another microservice for unified authentication (client + resource-server guide, claim contract) |
| [`frontend-integration-manifest.md`](frontend-integration-manifest.md) | Manifest contract for frontend integrations |
| [`frontend-prompt-specs.md`](frontend-prompt-specs.md) | Prompt specs served via `/api/specs` for frontends |
| [`r2-file-storage.md`](r2-file-storage.md) | Unified R2 file & media storage: API vs. binding decision, auth, DB schema, key conventions |
| [`database-integration.md`](database-integration.md) | Database layer overview (Supabase client, core tables) and the dedicated-schema rule for plugin databases |

Related: token acquisition is covered in
[`../auth/oauth-mcp-authentication.md`](../auth/oauth-mcp-authentication.md).
