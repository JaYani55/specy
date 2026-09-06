import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasUsableSubject,
  hasUsableTemplate,
  renderTemplateMessage,
  renderTemplateSubject,
} from '../api/lib/formMessageTemplate.ts';

// ─── renderTemplateSubject ──────────────────────────────────────────────────

test('renderTemplateSubject resolves system tokens to their text value', () => {
  const subject = renderTemplateSubject('Neue Formularantwort: $form_name', {
    form_name: { html: '<b>Kontakt</b>', text: 'Kontakt' },
  });
  assert.equal(subject, 'Neue Formularantwort: Kontakt');
});

test('renderTemplateSubject resolves field tokens ($field:name)', () => {
  const subject = renderTemplateSubject('Anfrage von $field:first_name', {
    'field:first_name': { html: 'Ada', text: 'Ada' },
  });
  assert.equal(subject, 'Anfrage von Ada');
});

test('renderTemplateSubject renders unknown tokens as "-"', () => {
  const subject = renderTemplateSubject('Hello $does_not_exist', {});
  assert.equal(subject, 'Hello -');
});

test('renderTemplateSubject renders empty token text as "-"', () => {
  const subject = renderTemplateSubject('Hi $recipient_name', {
    recipient_name: { html: '', text: '' },
  });
  assert.equal(subject, 'Hi -');
});

test('renderTemplateSubject collapses whitespace and trims', () => {
  const subject = renderTemplateSubject('  A   \t B  \n C  ', {});
  assert.equal(subject, 'A B C');
});

test('renderTemplateSubject caps the result at 500 characters', () => {
  const longTokenText = 'x'.repeat(600);
  const subject = renderTemplateSubject('$form_name', {
    form_name: { html: longTokenText, text: longTokenText },
  });
  assert.equal(subject.length, 500);
});

test('renderTemplateSubject leaves plain subjects untouched', () => {
  assert.equal(renderTemplateSubject('Nur ein Betreff', {}), 'Nur ein Betreff');
});

// ─── hasUsableSubject ───────────────────────────────────────────────────────

test('hasUsableSubject accepts non-empty strings and rejects empty/null', () => {
  assert.equal(hasUsableSubject('Betreff'), true);
  assert.equal(hasUsableSubject('   '), false);
  assert.equal(hasUsableSubject(''), false);
  assert.equal(hasUsableSubject(null), false);
  assert.equal(hasUsableSubject(undefined), false);
});

// ─── renderTemplateMessage ──────────────────────────────────────────────────

test('renderTemplateMessage replaces token spans with the token value', () => {
  const { html, text } = renderTemplateMessage(
    '<p>Hallo <span data-token="recipient_name">$recipient_name</span>,</p>',
    { recipient_name: { html: '<strong>Ada</strong>', text: 'Ada' } },
  );
  assert.match(html, /<strong>Ada<\/strong>/);
  assert.equal(text, 'Hallo Ada,');
});

test('renderTemplateMessage renders missing tokens as "-"', () => {
  const { text } = renderTemplateMessage('<p>Hi <span data-token="nope">$nope</span></p>', {});
  assert.equal(text, 'Hi -');
});

test('renderTemplateMessage escapes plain text (XSS protection)', () => {
  const { html } = renderTemplateMessage('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>', {});
  assert.doesNotMatch(html, /<script>/);
});

test('renderTemplateMessage drops unknown tags and attributes', () => {
  const { html } = renderTemplateMessage('<p onclick="evil()">Text</p><iframe src="x"></iframe>', {});
  assert.doesNotMatch(html, /onclick|iframe/);
  assert.match(html, /Text/);
});

test('renderTemplateMessage strips token span label content (span is atomic)', () => {
  // The label inside the span ($form_name) is editor display text and must be
  // dropped entirely — only the resolved token value may appear.
  const { text } = renderTemplateMessage(
    '<p><span data-token="form_name">$form_name</span></p>',
    { form_name: { html: 'X', text: 'X' } },
  );
  assert.equal(text, 'X');
});

test('renderTemplateMessage derives a plain-text fallback with line breaks', () => {
  const { text } = renderTemplateMessage('<p>Eins</p><p>Zwei</p>', {});
  assert.equal(text, 'Eins\nZwei');
});

// ─── hasUsableTemplate ──────────────────────────────────────────────────────

test('hasUsableTemplate accepts text and token-only templates', () => {
  assert.equal(hasUsableTemplate('<p>Hallo</p>'), true);
  assert.equal(hasUsableTemplate('<span data-token="form_name">$form_name</span>'), true);
});

test('hasUsableTemplate rejects empty, whitespace and markup-only templates', () => {
  assert.equal(hasUsableTemplate(null), false);
  assert.equal(hasUsableTemplate('   '), false);
  assert.equal(hasUsableTemplate('<p></p>'), false);
  assert.equal(hasUsableTemplate('<b></b><i> </i>'), false);
});
