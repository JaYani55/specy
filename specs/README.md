# Specy Knowledge Base

This directory is the project's internal knowledge base, organized as **topical folders**
rather than a flat file list. Each folder has a `README.md` indexing its documents.

**Navigation rules for agents:**

1. Start at this file. Pick the topical folder that matches your task.
2. Read the folder's `README.md` before diving into individual documents.
3. Cross-references between documents are relative links — follow them as needed.
4. Historical change records live in [`changes/`](changes/) and are append-only;
   older entries may reference pre-restructure paths.
5. New documentation goes into the matching topical folder with a kebab-case filename,
   and must be registered in the folder's `README.md`.

## Folder map

| Folder | Contents |
|---|---|
| [`architecture/`](architecture/) | System overview, page builder internals, end-to-end workflows |
| [`auth/`](auth/) | Authentication & authorization model, OAuth 2.1 for MCP agents |
| [`platform/`](platform/) | Infrastructure setup, multi-tenancy & RLS, core extensions (audio blocks, queues, secrets) |
| [`features/`](features/) | Feature-level subsystems: forms, rich text editing |
| [`plugins/`](plugins/) | Plugin development guide, installation lifecycle, EUPL licensing |
| [`agents/`](agents/) | Everything agent-facing: MCP exposition, agent system prompt, frontend integration manifest, prompt specs, R2 file storage integration |
| [`plans/`](plans/) | Forward-looking plans and drafts (not yet implemented specs) |
| [`changes/`](changes/) | Date-prefixed change records (`YYYY-MM-DD-<description>.md`) — mandatory for every change |

## Quick answers

- *"How do I add a plugin?"* → [`plugins/development.md`](plugins/development.md), then [`plugins/installation.md`](plugins/installation.md)
- *"How does auth work?"* → [`auth/authentication-authorization.md`](auth/authentication-authorization.md)
- *"How do I authenticate another microservice against Specy?"* → [`agents/oauth-unified-authentication.md`](agents/oauth-unified-authentication.md)
- *"How does multi-tenancy/RLS work?"* → [`platform/multi-tenancy.md`](platform/multi-tenancy.md)
- *"How do I store files?"* → [`agents/r2-file-storage.md`](agents/r2-file-storage.md)
- *"How does my plugin use the database?"* → [`agents/database-integration.md`](agents/database-integration.md)
- *"What must I document after a change?"* → [`changes/`](changes/) (see AGENTS.md §3)
