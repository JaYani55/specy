# Plugins

Everything about the plugin system. Plugins are **separate git repositories** under
`plugins/{slug}/` (gitignored) and communicate with core only through documented hooks
and APIs.

| Document | Purpose |
|---|---|
| [`development.md`](development.md) | Complete plugin development guide (manifest, routes, sidebar, migrations, hooks) |
| [`installation.md`](installation.md) | Plugin lifecycle: register, install, configure, update, remove |
| [`eupl-compliance.md`](eupl-compliance.md) | EUPL licensing rules — why plugins are separate works |

Licensing summary: the CMS core is EUPL-1.2; plugins only depend on the *shape* of core
interfaces and may be licensed independently.
