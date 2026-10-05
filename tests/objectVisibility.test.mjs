import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicObjectReadable } from '../api/lib/objectVisibility.ts';
import { readFileSync } from 'node:fs';

const mcpRoute = readFileSync(new URL('../api/routes/mcp.ts', import.meta.url), 'utf8');
const objectRoute = readFileSync(new URL('../api/routes/objects.ts', import.meta.url), 'utf8');

describe('Object anonymous detail URL visibility contract', () => {
  it('marks an Object public only when all REST visibility gates permit anonymous reads', () => {
    assert.equal(isPublicObjectReadable({ status: 'published', api_enabled: true, requires_auth: false }), true);
    assert.equal(isPublicObjectReadable({ status: 'archived', api_enabled: true, requires_auth: false }), false);
    assert.equal(isPublicObjectReadable({ status: 'published', api_enabled: false, requires_auth: false }), false);
    assert.equal(isPublicObjectReadable({ status: 'published', api_enabled: true, requires_auth: true }), false);
    assert.equal(isPublicObjectReadable({ status: 'published', api_enabled: null, requires_auth: false }), false);
  });

  it('does not advertise a dead anonymous detail URL for protected/disabled Objects', () => {
    assert.match(objectRoute, /\.eq\('status', 'published'\)[\s\S]*\.eq\('api_enabled', true\)[\s\S]*\.eq\('requires_auth', false\)/);
    assert.match(mcpRoute, /const publiclyReadable = isPublicObjectReadable\(o\)/);
    assert.match(mcpRoute, /\.\.\.\(publiclyReadable \? \{ detail_url:/);
    assert.match(mcpRoute, /publicly_readable: publiclyReadable/);
  });
});
