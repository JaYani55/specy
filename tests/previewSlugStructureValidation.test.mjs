import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateSchemaFrontendTargetInputs } from '../api/lib/schemaRegistration.ts';
import { parseSchemaDefinitionPatch } from '../api/lib/schemaDefinition.ts';
import { readFileSync } from 'node:fs';

const requirements = {
  required_slug_structure: '/veranstaltungen/:slug',
  preview_slug_structure: '/preview/:slug',
  route_base_path: '/veranstaltungen',
};

const dualTargets = [
  { target_key: 'home-events', kind: 'collection-slot', host_path: '/', placement_key: 'home.events', is_primary: true },
  { target_key: 'event-detail', kind: 'detail-page', host_path: '/veranstaltungen/:slug', supports_preview: false },
  { target_key: 'event-preview', kind: 'detail-page', host_path: '/preview/:slug', supports_preview: true },
];

describe('separate preview slug structure', () => {
  it('accepts a public detail route and a separate preview route together', () => {
    const result = validateSchemaFrontendTargetInputs(dualTargets, requirements);
    assert.equal(result.ok, true);
    if (result.ok) {
      const detail = result.targets.find((t) => t.target_key === 'event-detail');
      const preview = result.targets.find((t) => t.target_key === 'event-preview');
      assert.equal(detail.supports_preview, false);
      assert.equal(preview.supports_preview, true);
      assert.equal(preview.host_path, '/preview/:slug');
    }
  });

  it('validates preview targets against preview_slug_structure, exempt from route_base_path', () => {
    // /preview is outside route_base_path /veranstaltungen — must still pass.
    const result = validateSchemaFrontendTargetInputs(
      [{ target_key: 'event-preview', kind: 'detail-page', host_path: '/preview/:slug', supports_preview: true, is_primary: true }],
      requirements,
    );
    assert.equal(result.ok, true, result.ok ? '' : result.error);
  });

  it('still validates public detail targets against required_slug_structure and the base path', () => {
    const mismatch = validateSchemaFrontendTargetInputs(
      [{ target_key: 'event-detail', kind: 'detail-page', host_path: '/preview/:slug', supports_preview: false }],
      requirements,
    );
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.error, /target "event-detail"/);
    assert.match(mismatch.error, /required_slug_structure/);

    const outsideBase = validateSchemaFrontendTargetInputs(
      [{ target_key: 'event-detail', kind: 'detail-page', host_path: '/other/:slug', supports_preview: false }],
      requirements,
    );
    assert.equal(outsideBase.ok, false);
    assert.match(outsideBase.error, /base path/);
  });

  it('rejects a preview target when preview_slug_structure is not configured (legacy rule)', () => {
    const result = validateSchemaFrontendTargetInputs(
      [{ target_key: 'event-preview', kind: 'detail-page', host_path: '/preview/:slug', supports_preview: true }],
      { required_slug_structure: '/veranstaltungen/:slug' },
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /target "event-preview"/);
  });

  it('rejects a malformed preview_slug_structure before evaluating targets', () => {
    const result = validateSchemaFrontendTargetInputs(dualTargets, {
      ...requirements,
      preview_slug_structure: '/preview',
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /preview_slug_structure must include :slug exactly once/);
  });

  it('rejects duplicate enabled detail-page host_paths and names both targets', () => {
    const result = validateSchemaFrontendTargetInputs(
      [
        { target_key: 'event-detail', kind: 'detail-page', host_path: '/veranstaltungen/:slug', is_primary: true },
        { target_key: 'event-preview', kind: 'detail-page', host_path: '/veranstaltungen/:slug', supports_preview: true },
      ],
      { required_slug_structure: '/veranstaltungen/:slug' },
    );
    assert.equal(result.ok, false);
    assert.match(result.error, /duplicate enabled detail-page host_path/);
  });

  it('aggregates all mismatches in one response with an errors list', () => {
    const result = validateSchemaFrontendTargetInputs(
      [
        { target_key: 'event-detail', kind: 'detail-page', host_path: '/wrong/:slug' },
        { target_key: 'event-preview', kind: 'detail-page', host_path: '/also-wrong/:slug', supports_preview: true },
      ],
      requirements,
    );
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /"event-detail"/);
    assert.match(result.errors[1], /"event-preview"/);
  });

  it('update_definition validates the preview_slug_structure template', () => {
    const bad = parseSchemaDefinitionPatch({
      expected_revision: 1,
      integration_requirements: { preview_slug_structure: '/preview' },
    });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /preview_slug_structure must include :slug exactly once/);

    const good = parseSchemaDefinitionPatch({
      expected_revision: 1,
      integration_requirements: { preview_slug_structure: '/preview/:slug' },
    });
    assert.equal(good.ok, true);
  });
});

describe('preview slug structure migration contract', () => {
  const migration = readFileSync(new URL('../migrations/202610060002_separate_preview_slug_structure.sql', import.meta.url), 'utf8');

  it('relaxes the single-detail-target rule to unique host_paths and bumps revision on integration_requirements', () => {
    assert.match(migration, /drop index if exists schema_frontend_targets_detail_unique/);
    assert.match(migration, /schema_frontend_targets_detail_host_unique[\s\S]*\(schema_id, host_path\)[\s\S]*where enabled and kind = 'detail-page'/);
    assert.match(migration, /new\.integration_requirements is distinct from old\.integration_requirements/);
    assert.match(migration, /definition_revision := old\.definition_revision \+ 1/);
  });
});
