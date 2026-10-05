import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateSchemaSystemDataPatch } from '../api/lib/schemaSystemData.ts';
import { parseSchemaDefinitionPatch } from '../api/lib/schemaDefinition.ts';
import { normalizeSchemaPageSlug } from '../api/lib/schemaPages.ts';

test('schema system data accepts a corrected frontend origin and canonicalizes its path', () => {
  const result = validateSchemaSystemDataPatch({ frontend_url: 'https://www.example.com/some/path?preview=1' });

  assert.equal(result.ok, true);
  assert.deepEqual(result.patch, { frontend_url: 'https://www.example.com' });
});

test('schema system data enforces canonical frontend requirements', () => {
  const result = validateSchemaSystemDataPatch(
    { frontend_url: 'https://wrong.example.com' },
    { canonical_frontend_url: 'https://right.example.com', allow_temporary_frontend_urls: false },
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /must match the canonical frontend origin/);
});

test('schema system data rejects unsafe URLs and secret fields', () => {
  assert.equal(validateSchemaSystemDataPatch({ frontend_url: 'http://127.0.0.1' }).ok, false);
  const secretAttempt = validateSchemaSystemDataPatch({ revalidation_secret: 'do-not-accept' });
  assert.equal(secretAttempt.ok, false);
  assert.match(secretAttempt.error, /not editable/);
});

test('schema system data validates route and revalidation paths', () => {
  const result = validateSchemaSystemDataPatch({
    slug_structure: '/articles/:slug',
    revalidation_endpoint: '/api/revalidate',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.patch, {
    slug_structure: '/articles/:slug',
    revalidation_endpoint: '/api/revalidate',
  });

  assert.equal(validateSchemaSystemDataPatch({ revalidation_endpoint: 'https://evil.example/revalidate' }).ok, false);
  assert.equal(validateSchemaSystemDataPatch({ slug_structure: '/articles' }).ok, false);
});

test('schema page slugs retain the dashboard normalization behavior', () => {
  assert.equal(normalizeSchemaPageSlug('Über die Größe'), 'ueber-die-groesse');
  assert.equal(normalizeSchemaPageSlug('themenwerkstatt_22102026'), 'themenwerkstatt-22102026');
  assert.equal(normalizeSchemaPageSlug('!!!'), 'page');
});

test('MCP page tools expose the specy-pages > schemas hierarchy and management actions', () => {
  const mcpSource = readFileSync(new URL('../api/routes/mcp.ts', import.meta.url), 'utf8');
  for (const toolName of [
    'specy_pages_schemas_list',
    'specy_pages_schemas_get',
    'specy_pages_schemas_list_pages',
    'specy_pages_schemas_get_page',
    'specy_pages_schemas_create_page',
    'specy_pages_schemas_update_page',
    'specy_pages_schemas_update_system_data',
    'specy_pages_schemas_update_definition',
    'specy_pages_schemas_replace_frontend_targets',
    'specy_products_list',
    'specy_products_create',
    'specy_products_get',
    'specy_products_update',
    'specy_products_publish',
    'specy_products_archive',
    'specy_products_delete',
  ]) {
    assert.match(mcpSource, new RegExp(`'${toolName}'`));
  }
  assert.match(mcpSource, /include_content: z\.boolean\(\)\.optional\(\)/);
  assert.match(mcpSource, /List Page records only: editorial content, publication and Page system fields/);
  assert.match(mcpSource, /Get the current dynamic Object data and schema/);
  assert.match(mcpSource, /Objects are the dynamic API stream, separate from Pages/);
  assert.match(mcpSource, /updateSchemaDefinition\(supabase, schema_slug, parsed\.patch\)/);
  assert.doesNotMatch(mcpSource, /fetch\(`\$\{baseUrl\}\/api\/schemas\/\$\{encodeURIComponent\(schema_slug\)\}\/definition`/);
});

test('REST schema system data repair is authenticated and restricted to non-secret integration fields', () => {
  const routeSource = readFileSync(new URL('../api/routes/schemas.ts', import.meta.url), 'utf8');
  const validationSource = readFileSync(new URL('../api/lib/schemaSystemData.ts', import.meta.url), 'utf8');
  assert.match(routeSource, /schemas\.patch\('\/:slug\/system-data'/);
  assert.match(routeSource, /const auth = await requireAuthSession\(c\)/);
  assert.match(validationSource, /ALLOWED_KEYS = new Set\(\['frontend_url', 'slug_structure', 'revalidation_endpoint'\]\)/);
});

test('schema definition patch parser enforces revisioned classification metadata', () => {
  const schema = { 'Hero Title': { type: 'string', custom_extension: { keep: true } } };
  const result = parseSchemaDefinitionPatch({
    expected_revision: 8,
    schema,
    entity_kind: 'service-product',
    editor_config: { widgets: { 'Hero Title': 'textarea' } },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.patch.expected_revision, 8);
    assert.deepEqual(result.patch.schema, schema);
    assert.equal(result.patch.entity_kind, 'service-product');
  }
  assert.equal(parseSchemaDefinitionPatch({ expected_revision: 0, schema: {} }).ok, false);
  assert.equal(parseSchemaDefinitionPatch({ expected_revision: 1, entity_kind: 'product' }).ok, false);
});

test('new schema creation carries the required route into the legacy slug structure', () => {
  const creationSource = readFileSync(new URL('../api/lib/schemaCreation.ts', import.meta.url), 'utf8');
  const pageServiceSource = readFileSync(new URL('../src/services/pageService.ts', import.meta.url), 'utf8');
  assert.match(creationSource, /slug_structure: integrationRequirements\.required_slug_structure \?\? '\/:slug'/);
  assert.match(pageServiceSource, /slug_structure: integrationRequirements\.required_slug_structure \?\? '\/:slug'/);
});
