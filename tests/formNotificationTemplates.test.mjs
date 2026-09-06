import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_CONFIRMATION_SUBJECT,
  DEFAULT_CONFIRMATION_TEMPLATE_HTML,
  DEFAULT_NOTIFICATION_SUBJECT,
  DEFAULT_NOTIFICATION_TEMPLATE_HTML,
  SYSTEM_TOKENS,
  tokenDisplayLabel,
} from '../src/utils/formNotificationTemplates.ts';

const TOKEN_SPAN_PATTERN = /<span data-token="([^"]+)">/g;

const tokensUsedIn = (html) => [...html.matchAll(TOKEN_SPAN_PATTERN)].map((match) => match[1]);

// ─── System token descriptors ───────────────────────────────────────────────

test('every system token has a unique token key and non-empty labels', () => {
  const seen = new Set();
  for (const descriptor of SYSTEM_TOKENS) {
    assert.ok(descriptor.token.length > 0, 'token key must not be empty');
    assert.ok(!seen.has(descriptor.token), `duplicate token key: ${descriptor.token}`);
    seen.add(descriptor.token);
    assert.ok(descriptor.label.startsWith('$'), `label must start with $: ${descriptor.label}`);
    assert.ok(descriptor.description.length > 0, `description required for ${descriptor.token}`);
  }
  assert.ok(SYSTEM_TOKENS.includes(SYSTEM_TOKENS.find((d) => d.token === 'form_name')));
});

test('tokenDisplayLabel renders field tokens as $name', () => {
  assert.equal(tokenDisplayLabel('field:first_name'), '$first_name');
  assert.equal(tokenDisplayLabel('form_name'), '$form_name');
});

// ─── Default templates reference only known tokens ──────────────────────────

test('default notification body references only known tokens', () => {
  const used = tokensUsedIn(DEFAULT_NOTIFICATION_TEMPLATE_HTML);
  assert.ok(used.length > 0, 'default template must use tokens');
  for (const token of used) {
    assert.ok(
      SYSTEM_TOKENS.some((descriptor) => descriptor.token === token),
      `unknown token in default notification body: ${token}`,
    );
  }
});

test('default confirmation body references only known tokens and omits recipient_name', () => {
  const used = tokensUsedIn(DEFAULT_CONFIRMATION_TEMPLATE_HTML);
  for (const token of used) {
    assert.ok(
      SYSTEM_TOKENS.some((descriptor) => descriptor.token === token),
      `unknown token in default confirmation body: ${token}`,
    );
  }
  // The confirmation copy has no recipient — recipient_name is staff-only.
  assert.ok(!used.includes('recipient_name'), 'confirmation body must not use recipient_name');
});

// ─── Default subjects ───────────────────────────────────────────────────────

test('default notification subject uses the form_name token', () => {
  assert.match(DEFAULT_NOTIFICATION_SUBJECT, /^\$form_name| \$form_name$/);
  assert.ok(DEFAULT_NOTIFICATION_SUBJECT.includes('$form_name'));
});

test('default confirmation subject uses the workspace_name token', () => {
  assert.ok(DEFAULT_CONFIRMATION_SUBJECT.includes('$workspace_name'));
});

test('default subjects use only tokens known to the system', () => {
  for (const subject of [DEFAULT_NOTIFICATION_SUBJECT, DEFAULT_CONFIRMATION_SUBJECT]) {
    for (const match of subject.matchAll(/\$([a-zA-Z0-9_]+)/g)) {
      assert.ok(
        SYSTEM_TOKENS.some((descriptor) => descriptor.token === match[1]),
        `unknown token in default subject: $${match[1]}`,
      );
    }
  }
});

test('block-level tokens are excluded from subjects via the editor, not by absence', () => {
  // submissions/metadata remain valid body tokens — the subject UI filters
  // them out; the token registry itself must still describe them.
  assert.ok(SYSTEM_TOKENS.some((d) => d.token === 'submissions'));
  assert.ok(SYSTEM_TOKENS.some((d) => d.token === 'metadata'));
});
