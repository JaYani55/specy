#!/usr/bin/env node
/**
 * ensure-registry.mjs
 *
 * Rebuilds generated plugin registry artifacts from workspace plugins in /plugins,
 * then reinstalls any plugin npm packages listed in plugin-deps.json.
 *
 * Run automatically as predev and prebuild so a fresh clone is immediately
 * buildable without having to run install-plugins.mjs first.
 */

import { existsSync, readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { rebuildWorkspacePluginArtifacts } from './lib/plugin-workspace.mjs';

const __dirname          = dirname(fileURLToPath(import.meta.url));
const ROOT               = resolve(__dirname, '..');
const PLUGIN_DEPS_FILE   = join(ROOT, 'plugin-deps.json');

rebuildWorkspacePluginArtifacts();
console.log('i  Rebuilt plugin registry artifacts from /plugins');

// ─── Reinstall plugin npm packages (from gitignored plugin-deps.json) ─────────
if (existsSync(PLUGIN_DEPS_FILE)) {
  let deps;
  try { deps = JSON.parse(readFileSync(PLUGIN_DEPS_FILE, 'utf8')); } catch { deps = {}; }

  // Merge all per-plugin deps; last version for a given package wins
  const merged = {};
  for (const pkgMap of Object.values(deps)) {
    for (const [name, version] of Object.entries(pkgMap)) merged[name] = version;
  }
  const pkgs = Object.entries(merged).map(([n, v]) => `${n}@${v}`);

  if (pkgs.length > 0) {
    console.log(`i  Reinstalling ${pkgs.length} plugin package(s) from plugin-deps.json…`);
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    // --no-package-lock: resolve fresh from registry so the CMS lockfile doesn't
    // force conservative (minimum-version) resolution for plugin-managed packages.
    const result = spawnSync(npmCmd, ['install', '--no-save', '--legacy-peer-deps', '--no-package-lock', ...pkgs], { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) {
      console.warn('!  Plugin package install failed. Run manually:');
      console.warn(`   npm install --no-save --legacy-peer-deps --no-package-lock ${pkgs.join(' ')}`);
    } else {
      console.log('i  Plugin packages ready.');
    }
  }
}
