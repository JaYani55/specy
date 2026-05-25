#!/usr/bin/env node

import { rebuildWorkspacePluginArtifacts } from './lib/plugin-workspace.mjs';

const plugins = rebuildWorkspacePluginArtifacts();
console.log(`i  Registered ${plugins.length} workspace plugin(s) from /plugins`);