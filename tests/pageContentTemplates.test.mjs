import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../migrations/202610040002_page_content_templates.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/pageContentTemplateService.ts', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../src/features/page-builder/PageContentTemplateControls.tsx', import.meta.url), 'utf8');
const editor = readFileSync(new URL('../src/features/page-builder/SchemaContentEditor.tsx', import.meta.url), 'utf8');

describe('schema-scoped page content templates', () => {
  it('stores content templates against a schema with tenant isolation and owner policies', () => {
    assert.match(migration, /schema_id uuid not null references public\.page_schemas\(id\)[\s\S]*tenant_id uuid null references public\.tenants\(id\)/);
    assert.match(migration, /unique \(schema_id, name\)/i);
    assert.match(migration, /jsonb_typeof\(content\) = 'object'[\s\S]*octet_length\(content::text\) <= 1048576/);
    assert.match(migration, /validate_page_content_template_schema_scope/);
    assert.match(migration, /public\.is_tenant_member\(tenant_id\)/);
    assert.match(migration, /public\.can_access_owned_row\(tenant_id, owner_user_id\)/);
  });

  it('loads and saves templates for exactly one schema and workspace', () => {
    assert.match(service, /\.eq\('schema_id', schemaId\)/);
    assert.match(service, /\.eq\('tenant_id', tenantId\)/);
    assert.match(service, /\.is\('tenant_id', null\)/);
    assert.match(service, /schema_id: input\.schemaId/);
    assert.match(service, /content: input\.content/);
  });

  it('loads only content fields, leaving the page title and operational event schedule unchanged', () => {
    assert.match(controls, /onApply\(template\.content\)/);
    assert.match(controls, /event schedule stay unchanged|Termindaten werden nicht kopiert/);
    assert.match(editor, /setBaseContent\(templateContent\)/);
    assert.match(editor, /setPageName\(/);
    assert.match(editor, /PageContentTemplateControls/);
  });
});
