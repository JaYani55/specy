/**
 * Default notification message templates for form e-mails, expressed with
 * template tokens (see `NotificationMessageEditor`). These mirror the built-in
 * default layouts rendered server-side when no custom message is saved
 * (`message_html` column NULL → hardcoded default path in the API).
 */

export const DEFAULT_NOTIFICATION_TEMPLATE_HTML = [
  '<p>Hallo <span data-token="recipient_name">$recipient_name</span>,</p>',
  '<p>für das Formular <span data-token="form_name">$form_name</span> wurde eine neue Antwort gespeichert.</p>',
  '<p><span data-token="submissions">$submissions</span></p>',
  '<p><span data-token="metadata">$metadata</span></p>',
].join('');

export const DEFAULT_CONFIRMATION_TEMPLATE_HTML = [
  '<p>Hallo,</p>',
  '<p>hier ist eine Zusammenfassung Ihrer Nachricht.</p>',
  '<p><span data-token="submissions">$submissions</span></p>',
  '<p><span data-token="metadata">$metadata</span></p>',
].join('');

export interface TemplateTokenDescriptor {
  token: string;
  label: string;
  description: string;
}

export const SYSTEM_TOKENS: TemplateTokenDescriptor[] = [
  { token: 'submissions', label: '$submissions', description: 'Tabelle mit allen Formularantworten (inkl. Datei-Downloads)' },
  { token: 'metadata', label: '$metadata', description: 'Metadaten-Block (Antwort-ID, Formular-Slug, Kanal, Quelle)' },
  { token: 'form_name', label: '$form_name', description: 'Name des Formulars' },
  { token: 'recipient_name', label: '$recipient_name', description: 'Name des Empfängers der E-Mail' },
];

export const tokenDisplayLabel = (token: string): string => {
  if (token.startsWith('field:')) return `$${token.slice('field:'.length)}`;
  return `$${token}`;
};
