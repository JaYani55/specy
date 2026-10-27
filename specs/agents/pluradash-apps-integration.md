# PluraDash Apps Integration — Handoff Specification

> **Audience:** developers of **consuming applications** — external dashboards,
> agent runtimes (PluraPi), microservices or any client that wants to list a
> workspace's apps, display their deploy state, and trigger production deploys.
>
> This document is the complete integration contract for the **Apps** surface of
> the PluraDash plugin: authentication, every `/apps*` endpoint with
> request/response payloads, the data models, the deploy-state machine, and the
> recommended client workflows.
>
> Related backend references:
> [`../features/pluradash-github-app-integration.md`](../features/pluradash-github-app-integration.md) (admin/GitHub side),
> [`plurapi-file-sync-integration.md`](plurapi-file-sync-integration.md) (workspace file sync `/sync/*`),
> [`../changes/2026-10-26-pluradash-app-deploy-state.md`](../changes/2026-10-26-pluradash-app-deploy-state.md) (deploy-state feature record)

---

## 1. What the Apps surface offers

A GitHub organization repository assigned to a workspace is exposed as an
**app**. Consuming clients can:

| Capability | Endpoint | Notes |
|---|---|---|
| List assigned apps (with storage footprint + build status) | `GET /apps` | RLS-filtered listing |
| Get the per-app **deploy state** (changes to deploy? preview URL? build green?) | `GET /apps/info` | live GitHub comparison, dynamically resolved production branch |
| Initiate a workspace session for an app | `POST /apps/launch` | returns the branch entry point |
| Ship dev changes to production (merge `dev` → Standard-Branch) | `POST /apps/deploy` | **human only**, build-gated |

The underlying GitHub repository location is an infrastructure detail.
**Consuming clients must never surface GitHub URLs, repo paths or branch
topology to end users** — show app names, sizes, build states and the deploy
state instead. The deploy entrypoint itself (`launchUrl`) is a legitimate
agent/machine concern.

## 2. Prerequisites

1. **Assigned repository.** A super-admin (or workspace admin) has assigned a
   GitHub organization repository to the target workspace (admin panel
   `/admin/github-apps` → assign → automatic data provisioning). The mapping
   lives in `pluradash.workspace_repos`.
2. **Workspace identity.** The caller needs the workspace UUID
   (`workspaceId` — the tenant ID). Agent accounts carry their default
   workspace in the JWT `tenant_id` claim, so all workspace-scoped parameters
   are optional for them.
3. **Nothing else.** Listing and deploy-state reads do not consume storage
   quota; only the file-sync and deploy operations touch quota (see
   [`plurapi-file-sync-integration.md`](plurapi-file-sync-integration.md)).

## 3. Authentication

All endpoints use a Supabase access token:

```
Authorization: Bearer <supabase_access_token>
```

| Aspect | Contract |
|---|---|
| Token type | Supabase JWT (dashboard session **or** OAuth 2.1 agent token) |
| Accepted roles on `GET /apps`, `GET /apps/info`, `POST /apps/launch` | `user`, `staff`, `admin`, `support`, `super-admin`, `agent` |
| Accepted roles on `POST /apps/deploy` | **human only** — active tenant admin (`is_tenant_admin`) or `super-admin`. Agent tokens (`is_agent: true`) are rejected with `403` (strict branch isolation) |
| Missing/invalid token | `401` |
| Role not permitted | `403` |
| Tenant scoping | RLS on `pluradash.workspace_repos` — a caller only ever sees apps of workspaces they belong to. A token for the wrong workspace yields `404 {"error": "Repository not found or access denied for this workspace."}` |

Token acquisition for machine accounts (OAuth 2.1 Authorization Code + PKCE,
claim contract incl. `is_agent`, `tenant_id`):
[`oauth-unified-authentication.md`](oauth-unified-authentication.md).

## 4. Base URL & conventions

- Base URL: `{CMS_ORIGIN}/api/plugin/pluradash`
- All request bodies are JSON (`Content-Type: application/json`).
- Errors are `{"error": "<message>"}` with a meaningful HTTP status.
- Multi-tenant humans (support/super-admin) pass the target workspace
  explicitly (`?tenantId=` / `workspaceId`); single-workspace tokens (agents,
  tenant users) may omit it — the JWT `tenant_id` claim applies.

## 5. Data models

### 5.1 `WorkspaceRepo` — one assigned app (`GET /apps` item)

```ts
interface WorkspaceRepo {
  id: string;                  // mapping row UUID (pluradash.workspace_repos.id)
  workspace_id: string;        // tenant/workspace UUID
  github_repo_id: number;      // GitHub repository ID — the app's stable key
  github_repo_name: string;    // "owner/repo" — infrastructure detail, do NOT show to end users
  github_repo_url: string;     // HTML URL — same rule
  default_branch: string;      // stored "Standard-Branch" (production target), fallback value 'main'
  created_at: string;          // ISO timestamp
  updated_at: string;
  fileCount?: number;          // files stored in the workspace (R2 apps prefix)
  totalBytes?: number;         // stored bytes (R2 apps prefix)
  deployment?: RepoDeploymentStatus;        // headline status (dev first)
  deployments?: RepoDeploymentStatus[];     // latest build per branch (running first, then newest)
}

interface RepoDeploymentStatus {
  buildStatus: 'running' | 'succeeded' | 'failed';
  conclusion: string | null;      // raw check_run conclusion
  checkName: string | null;       // check run name
  branch: string | null;          // 'dev' | 'main' | …
  commitSha: string | null;       // commit the build ran on
  previewUrl: string | null;      // real preview URL (check_run feedback)
  previewAliasUrl: string | null; // alias URL variant
  buildUrl: string | null;        // build link from the check_run (details_url/html_url fallback)
  completedAt: string | null;     // ISO timestamp
}
```

### 5.2 `WorkspaceAppInfo` — deploy state (`GET /apps/info` item)

```ts
type AppDeployState =
  | 'up-to-date'         // dev fully merged into production — nothing to ship
  | 'changes-available'  // dev ahead AND latest dev build green on the current dev head
  | 'build-running'      // changes exist, latest dev build still running
  | 'build-failed'       // changes exist, latest dev build failed
  | 'no-build'           // changes exist, no dev build tracked yet (or dev branch missing)
  | 'stale-build'        // changes exist, build green but on an older dev head
  | 'unknown';           // GitHub comparison failed — fail-closed

interface WorkspaceAppInfo {
  repoId: number;               // GitHub repository ID (= workspace_repos.github_repo_id)
  repoName: string;             // "owner/repo"
  workspaceId: string;
  productionBranch: string;     // Standard-Branch, resolved DYNAMICALLY from GitHub
  productionBranchSource: 'github' | 'fallback'; // 'fallback' = repos.get failed, stored value used
  devBranchExists: boolean;     // false when the dev branch was never created (no pull/push yet)
  devHeadSha: string | null;
  productionHeadSha: string | null;
  aheadBy: number | null;       // commits dev has that production lacks
  behindBy: number | null;      // commits production has that dev lacks
  changesToDeploy: boolean | null; // true only when aheadBy > 0; null when the compare failed
  gitError: string | null;      // set when the live GitHub comparison failed
  devBuild: RepoDeploymentStatus | null; // latest dev-branch check_run build
  previewUrl: string | null;    // convenience copy of devBuild.previewUrl
  buildUrl: string | null;      // convenience copy of devBuild.buildUrl
  deployState: AppDeployState;
  canDeploy: boolean;           // true ONLY for 'changes-available'
}
```

**`deployState` decision table:**

| State | Git diff (`changesToDeploy`) | Dev build | Deploy allowed? |
|---|---|---|---|
| `up-to-date` | `false` | any | no — nothing to ship (build state is irrelevant) |
| `changes-available` | `true` | `succeeded` on current `devHeadSha` | **yes** (`canDeploy: true`) |
| `build-running` | `true` | `running` | no — wait for the build |
| `build-failed` | `true` | `failed` | no — fix and rebuild |
| `no-build` | `true` (or dev missing) | none/unusable | no — push to trigger a build |
| `stale-build` | `true` | `succeeded`, but `builtCommitSha !== devHeadSha` | no — newest change not built yet |
| `unknown` | `null` | any | no — fail-closed (also `gitError` set) |

Two subtleties worth locking in:

- **After a successful deploy the state folds back to `up-to-date`** even
  though the branch SHAs still differ — the merge commit exists only on the
  production branch, so the compare reports `ahead_by: 0`. Never compare
  SHAs yourself; always use `changesToDeploy`/`deployState`.
- **`canDeploy` mirrors the server-side deploy gate.** If `canDeploy` is
  `true`, `POST /apps/deploy` will not be rejected for gate reasons. The
  reverse does not hold across time — state can go stale between read and
  call; handle `409` (see §6.4).

### 5.3 `DeployAppResponse` — `POST /apps/deploy` response

```ts
interface DeployAppResponse {
  success: boolean;
  merged: boolean;               // true = new merge commit created; false = already identical ('clean')
  status: 'merged' | 'clean';
  mergeCommitSha: string | null; // set when merged
  productionBranch: string;      // resolved Standard-Branch
  repo: { id: number; fullName: string; url: string };
  gate: { allowed: true; builtCommitSha: string | null; devHeadSha: string | null };
}
```

## 6. Endpoint reference

### 6.1 `GET /apps` — list assigned apps

Roles: `user | staff | admin | support | super-admin | agent` (bearer).

| Query | Required | Description |
|---|---|---|
| `tenantId` | no | Workspace UUID; defaults to the JWT tenant claim |

Response `200`:

```jsonc
{
  "repos": [ /* WorkspaceRepo[] — see §5.1 */ ],
  "tenantId": "4d2f6e78-…"
}
```

Notes:

- `fileCount`/`totalBytes` are computed best-effort from the caller's R2 apps
  prefix; a storage-catalog failure degrades them to `0` without failing the
  request.
- `deployments` contains one entry per tracked branch — use the `branch: 'dev'`
  entry for build-state displays; `deployment` is the headline (dev first).
- This endpoint performs **no GitHub API calls** — safe to call on every page
  load.

### 6.2 `GET /apps/info` — per-app deploy state

Roles: same as `GET /apps` (agents included — read-only). Bearer required.

| Query | Required | Description |
|---|---|---|
| `workspaceId` | no | Workspace UUID (alias: `tenantId`); defaults to the JWT tenant claim |
| `repoId` | no | GitHub repository ID — query a single app |

Response `200`:

```jsonc
{
  "tenantId": "4d2f6e78-…",
  "apps": [
    {
      "repoId": 812345678,
      "repoName": "acme/website",
      "workspaceId": "4d2f6e78-…",
      "productionBranch": "main",
      "productionBranchSource": "github",
      "devBranchExists": true,
      "devHeadSha": "def456…",
      "productionHeadSha": "abc123…",
      "aheadBy": 2,
      "behindBy": 0,
      "changesToDeploy": true,
      "gitError": null,
      "devBuild": {
        "buildStatus": "succeeded",
        "conclusion": "success",
        "checkName": "Deploy",
        "branch": "dev",
        "commitSha": "def456…",
        "previewUrl": "https://dev.acme-website.workers.dev",
        "previewAliasUrl": null,
        "buildUrl": "https://github.com/acme/website/actions/runs/123",
        "completedAt": "2026-10-26T10:12:00.000Z"
      },
      "previewUrl": "https://dev.acme-website.workers.dev",
      "buildUrl": "https://github.com/acme/website/actions/runs/123",
      "deployState": "changes-available",
      "canDeploy": true
    }
  ]
}
```

Behavior contract:

- The **production branch is resolved dynamically** per request from the
  GitHub API (`repos.get → default_branch`). If that call fails the stored
  `workspace_repos.default_branch` is used and
  `productionBranchSource: 'fallback'` is reported — clients should not cache
  `productionBranch` across sessions.
- A failed branch-ref/compare call sets `changesToDeploy: null`,
  `gitError`, `deployState: 'unknown'`, `canDeploy: false` (fail-closed).
- Each repo costs up to ~4 GitHub API calls (`repos.get` + dev ref +
  production ref + compare). **Do not poll aggressively** — see §7.1.
- Read-only; intentionally **not** written to `sync_logs` (polling would
  flood the log).
- Documented in the endpoint catalog (`/admin/api`) as `pluradash-apps-info`.

### 6.3 `POST /apps/launch` — workspace session

Roles: same as `GET /apps` (agents included).

```json
{ "workspaceId": "4d2f6e78-…", "repoId": 812345678, "branch": "dev" }
```

| Field | Required | Description |
|---|---|---|
| `workspaceId` | yes | Workspace UUID |
| `repoId` | yes | GitHub repository ID |
| `branch` | no | Defaults to the stored default branch |

Response `200`:

```jsonc
{
  "success": true,
  "repo": { /* WorkspaceRepoRow without sizes */ },
  "branch": "dev",
  "launchUrl": "https://github.com/acme/website/tree/dev",
  "message": "Workspace-Session initialisiert."
}
```

Errors: `404` (not assigned / RLS), `500`. The call is logged to
`pluradash.sync_logs` as operation `app.launch`.

### 6.4 `POST /apps/deploy` — production release

Roles: **human only** — active tenant admin or super-admin. Agent tokens are
rejected with `403 {"error": "Nur Workspace-Administratoren können produktiv deployen."}`.

```json
{ "workspaceId": "4d2f6e78-…", "repoId": 812345678, "commitMessage": "Release v3" }
```

| Field | Required | Description |
|---|---|---|
| `workspaceId` | yes | Workspace UUID |
| `repoId` | yes | GitHub repository ID |
| `commitMessage` | no | Defaults to `Deploy {repo} dev → {productionBranch} (PluraDash)` |

Response `200`: `DeployAppResponse` (§5.3). `status: 'clean'` means dev was
already fully contained in the production branch — nothing was merged.

Errors:

| Status | Meaning |
|---|---|
| `403` | Agent token, or caller is not tenant-admin/super-admin |
| `404` | Repo not assigned to this workspace (RLS) |
| `409` | **Deploy gate closed** — latest dev build is `no-build` / `running` / `failed` / `stale-build` on the current dev head. German message, e.g. `"Deploy abgelehnt: Der neueste Dev-Build ist fehlgeschlagen. …"` |

Side effects (server-side, all handled by the CMS): merge commit on the
production branch, R2 snapshot of the merged tree (read-only
`<prodBranch>/HEAD/`), one `sync_logs` row (operation `deploy`), and a
PluraPi-Sessions build-target record for the merge commit (best-effort).

## 7. Recommended client workflows

### 7.1 Deploy-state UI (dashboard-like clients)

```
1. GET /apps                       → render app cards (name, size, file count, build tiles)
2. GET /apps/info                  → per card:
     deployState === 'changes-available'
       → show "changes ready to deploy" info state + ENABLE deploy button
     otherwise
       → hide the info state; DISABLE the button, tooltip = state lock reason
3. While any devBuild.buildStatus === 'running':
       poll GET /apps/info every ~30 s (the preview URL and deployState flip
       as soon as the check_run lands)
4. Deploy pressed → POST /apps/deploy → on success refetch /apps and /apps/info
```

Polling discipline: poll `/apps/info` only while a build is running (or on
user action). Each call costs GitHub API requests per assigned repo; idle
polling wastes installation-token rate limit (5 000 req/h per installation)
for zero information gain. A failed `/apps/info` call should degrade the UI
to `deployState: 'unknown'` semantics (button disabled), never break the app
listing.

### 7.2 Agent workflow (PluraPi)

```
1. GET /apps                       → discover assigned apps (workspace from JWT)
2. POST /apps/launch               → obtain the branch entry point for the session
3. File work: use the /sync/* endpoints (see plurapi-file-sync-integration.md)
4. Display state: GET /apps/info → previewUrl / deployState are read-only for
   agents too
5. Production deploy: NOT available to agents (403 by design) — hand off to a
   human workspace admin instead
```

### 7.3 Error-recovery rules

| Symptom | Recovery |
|---|---|
| `deployState: 'unknown'` / `gitError` set | Retry with backoff; the GitHub comparison is transient — do not enable deploy on `unknown` |
| `409` on deploy although `canDeploy` was `true` | State went stale between read and call — refetch `/apps/info` and re-evaluate |
| `devBranchExists: false` | Nobody pulled/pushed yet — run `POST /sync/pull` first (creates `dev` from the default branch) |
| `behindBy > 0` and `aheadBy > 0` (diverged) | Deploy still merges dev → production; surface the counts, don't block |

## 8. Related documentation

- Admin/GitHub App side (assignment, provisioning, webhooks): [`../features/pluradash-github-app-integration.md`](../features/pluradash-github-app-integration.md)
- File sync endpoints & agent workflows: [`plurapi-file-sync-integration.md`](plurapi-file-sync-integration.md)
- OAuth 2.1 token acquisition & claim contract: [`oauth-unified-authentication.md`](oauth-unified-authentication.md)
- Plugin-internal state machine: `plugins/pluradash/specs/app-deploy-state.md`
- Change records: [`../changes/2026-10-26-pluradash-app-deploy-state.md`](../changes/2026-10-26-pluradash-app-deploy-state.md)
