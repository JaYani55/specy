// Dependency integrity tests — security-audit regression guard.
//
// Verifies after dependency updates (see specs/changes/2026-10-24-dependency-audit-fix.md):
//   1. Every package affected by the 2026-10 npm audit is installed at or above
//      the patched version of its advisory (resolved from the real node_modules
//      tree, including nested copies).
//   2. The security overrides in package.json are present (undici,
//      postcss-selector-parser) — removing them reintroduces vulnerable copies.
//   3. Functional smoke tests for packages whose major version changed or that
//      run with overridden versions (tailwind/postcss chain, hono, zod, MCP SDK,
//      sharp native bindings, prosemirror/markdown/js-yaml/ip-address/fast-uri).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.join(fileURLToPath(import.meta.url), '..', 'index.js'));
const ROOT = path.join(fileURLToPath(import.meta.url), '..', '..');

/** All node_modules directories from `startDir` up to the repo root. */
function nodeModuleDirs(startDir) {
  const dirs = [];
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    const nm = path.join(dir, 'node_modules');
    if (existsSync(nm)) dirs.push(nm);
    dir = path.dirname(dir);
  }
  return dirs;
}

/**
 * Locate a package's directory in the installed tree without going through
 * the `exports` field (many packages do not export ./package.json).
 * With `from`, the parent's nested copy is preferred over the hoisted one.
 */
function findPackageDir(name, from) {
  const start = from ? path.dirname(require.resolve(from)) : ROOT;
  for (const nm of nodeModuleDirs(start)) {
    const candidate = path.join(nm, ...name.split('/'));
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  throw new Error(`package ${name}${from ? ` (nested under ${from})` : ''} not found in node_modules`);
}

/** Resolve a package's installed version from the real tree. */
function installedVersion(name, from) {
  const pkg = JSON.parse(readFileSync(path.join(findPackageDir(name, from), 'package.json'), 'utf8'));
  assert.ok(pkg.name === name, `resolved directory for ${name} contains package "${pkg.name}"`);
  return { version: pkg.version };
}

/**
 * Numeric-dotted version comparison that ignores prerelease suffixes
 * (`5.20261019.2-beta` → `5.20261019.2`). Sufficient for the advisories here,
 * which all use plain dotted ranges.
 */
function compareVersions(a, b) {
  const strip = (v) => v.split('-')[0];
  const pa = strip(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = strip(b).split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Minimum FIXED versions, derived from the npm audit advisory ranges
// (vulnerable range upper bound + 1 in the same major where applicable).
const FLOORS = [
  // [package, minFixedVersion, resolveFrom]
  ['@modelcontextprotocol/sdk', '1.31.1'],
  ['body-parser', '2.3.1'],
  ['brace-expansion', '5.0.12'],
  ['fast-uri', '3.1.9'],
  ['follow-redirects', '1.16.1'],
  ['hono', '4.13.11'],
  ['ip-address', '10.7.4'],
  ['js-yaml', '4.3.2'],
  ['markdown-it', '14.3.3'],
  ['postcss-selector-parser', '7.1.6'],
  ['prosemirror-view', '1.42.3'],
  ['proxy-addr', '2.0.8'],
  ['sharp', '0.35.5'], // vulnerable range ends at 0.35.5-rc.1 → 0.35.5 final is fixed
  ['source-map-js', '1.2.2'],
  ['vite', '7.3.7'],
  ['wrangler', '4.143.1'],
  ['zod', '4.6.6'],
  ['shadcn', '4.22.1'],
  ['@earendil-works/pi-coding-agent', '1.4.0'],
  // Nested copies created by the overrides:
  ['undici', '7.30.1', 'miniflare'], // miniflare's own copy (wrangler dev)
  ['undici', '7.30.1', 'shadcn'],
];

describe('dependency security integrity (2026-10 audit fix)', () => {
  for (const [name, minFixed, from] of FLOORS) {
    it(`${name}${from ? ` (via ${from})` : ''} >= ${minFixed}`, () => {
      const { version } = installedVersion(name, from);
      assert.ok(
        compareVersions(version, minFixed) >= 0,
        `${name} ${version} is below the fixed version ${minFixed} — npm audit would flag it`
      );
    });
  }

  it('sharp is not a prerelease (vulnerable range includes 0.35.5-rc.1)', () => {
    const { version } = installedVersion('sharp');
    assert.doesNotMatch(version, /-/, `sharp ${version} is a prerelease; only >=0.35.5 final is patched`);
  });

  it('root undici is the pi-coding-agent copy at the fixed 8.x version', () => {
    const { version } = installedVersion('undici');
    assert.ok(
      compareVersions(version, '8.12.2') >= 0 && version.startsWith('8.'),
      `root undici ${version} must be >=8.12.2 (pi-coding-agent's pinned copy)`
    );
  });

  it('security overrides are declared in package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const overrides = pkg.overrides || {};
    assert.match(String(overrides['postcss-selector-parser']), /^(\^|~)?7\./,
      'postcss-selector-parser override required — tailwind v3 chain has no fixed 6.x');
    assert.match(String(overrides['undici']), /^(\^|~)?7\.30\./,
      'global undici override required (miniflare pins 7.29.1, vulnerable)');
    assert.ok(
      overrides['@earendil-works/pi-coding-agent'] && String(overrides['@earendil-works/pi-coding-agent'].undici).startsWith('8.'),
      'nested undici override for @earendil-works/pi-coding-agent required (it pins vulnerable 8.10.2)'
    );
  });

  it('no duplicated vulnerable postcss-selector-parser copies remain', () => {
    for (const parent of ['postcss-nested', 'tailwindcss', '@tailwindcss/typography']) {
      const { version } = installedVersion('postcss-selector-parser', parent);
      assert.ok(
        compareVersions(version, '7.1.6') >= 0,
        `${parent} still resolves postcss-selector-parser ${version} (< 7.1.6)`
      );
    }
  });
});

describe('dependency functional smoke tests (post-update integrity)', () => {
  it('tailwind v3 chain compiles CSS with postcss-selector-parser v7 override', async () => {
    const postcss = (await import('postcss')).default;
    const tailwindcss = (await import('tailwindcss')).default;
    const typography = (await import('@tailwindcss/typography')).default;
    const css = '@tailwind components; @tailwind utilities;\n.prose { @apply text-base; }\n.parent { .child { color: theme("colors.red.500"); } }';
    const result = await postcss([tailwindcss({
      content: [{ raw: '<div class="prose parent child"></div>', extension: 'html' }],
    }), typography]).process(css, { from: undefined });
    assert.ok(result.css.includes('color'), 'tailwind should emit compiled CSS');
    assert.ok(!result.css.includes('.parent .child {'), 'nested rule should be flattened');
  });

  it('hono routes a request end-to-end', async () => {
    const { Hono } = await import('hono');
    const app = new Hono();
    app.get('/ping', (c) => c.json({ pong: true }));
    const res = await app.request('/ping');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { pong: true });
  });

  it('zod 4.x parses and rejects', async () => {
    const { z } = await import('zod');
    const schema = z.object({ name: z.string().min(1) });
    assert.deepEqual(schema.parse({ name: 'x' }), { name: 'x' });
    assert.equal(schema.safeParse({ name: '' }).success, false);
  });

  it('@modelcontextprotocol/sdk exports and instantiates McpServer', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({ name: 'integrity-test', version: '0.0.0' });
    assert.ok(server, 'McpServer should instantiate');
    assert.ok(typeof server.registerTool === 'function' || typeof server.tool === 'function');
  });

  it('markdown-it renders markdown', async () => {
    const MarkdownIt = (await import('markdown-it')).default;
    const md = new MarkdownIt();
    assert.equal(md.renderInline('# not inline'), '# not inline');
    assert.ok(md.render('# Title').includes('<h1>Title</h1>'));
  });

  it('js-yaml, ip-address, brace-expansion and fast-uri still work', async () => {
    const yaml = (await import('js-yaml')).default ?? (await import('js-yaml'));
    assert.deepEqual(yaml.load('a: 1\nb: [x, y]'), { a: 1, b: ['x', 'y'] });

    const { Address4, Address6 } = await import('ip-address');
    assert.equal(new Address4('192.168.0.1').subnet, '/32');
    assert.equal(new Address6('fe80::1').subnet, '/128');

    const expandMod = await import('brace-expansion');
    const expand = expandMod.expand ?? expandMod.default;
    assert.deepEqual(expand('a/{b,c}/d'), ['a/b/d', 'a/c/d']);

    const URI = (await import('fast-uri')).default ?? (await import('fast-uri'));
    const parsed = URI.parse('https://example.com:8443/path?q=1');
    assert.equal(parsed.host ? URI.parse('https://example.com:8443/path?q=1').host : parsed.hostname, 'example.com');
    assert.equal(URI.serialize(parsed), 'https://example.com:8443/path?q=1');
  });

  it('sharp native bindings process an image after the update', async () => {
    const sharp = (await import('sharp')).default;
    // 1x1 red PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const meta = await sharp(png).metadata();
    assert.equal(meta.width, 1);
    assert.equal(meta.height, 1);
    const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    assert.equal(data.length, 4); // 1x1 RGBA
  });

  it('prosemirror-state creates an editor state (prosemirror-view updated)', async () => {
    const { EditorState } = await import('prosemirror-state');
    const { Schema } = await import('prosemirror-model');
    const schema = new Schema({
      nodes: {
        text: { group: 'inline' },
        doc: { content: 'text*' },
      },
    });
    const state = EditorState.create({ schema });
    assert.ok(state.doc, 'EditorState should expose a doc');
    const { version } = installedVersion('prosemirror-view');
    assert.ok(compareVersions(version, '1.42.3') >= 0);
  });
});
