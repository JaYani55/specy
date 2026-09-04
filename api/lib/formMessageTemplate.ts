/**
 * Sanitizing renderer for per-form notification message templates.
 *
 * Templates are authored in the dashboard with a Tiptap editor and stored as
 * HTML. Dynamic content is embedded as token spans:
 *
 *   <span data-token="submissions">$submissions</span>
 *   <span data-token="field:first_name">$first_name</span>
 *
 * `sanitizeTemplateHtml` reduces editor output to a strict allowlist of tags
 * and attributes (the output only ever travels into e-mail bodies rendered by
 * us, so unknown markup is dropped). `renderTemplateMessage` walks the
 * sanitized markup once and produces both the final inline-styled HTML body
 * and a plain-text fallback for the mail job payload.
 */

export interface TemplateTokenValue {
  html: string;
  text: string;
}

type TemplateTokenMap = Record<string, TemplateTokenValue>;

const BLOCK_STYLE: Record<string, string> = {
  p: 'margin:0 0 12px 0;',
  h1: 'font-size:20px;font-weight:700;margin:0 0 12px 0;',
  h2: 'font-size:17px;font-weight:700;margin:0 0 10px 0;',
  h3: 'font-size:15px;font-weight:700;margin:0 0 8px 0;',
  ul: 'margin:0 0 12px 0;padding-left:20px;',
  ol: 'margin:0 0 12px 0;padding-left:20px;',
  li: 'margin:0 0 4px 0;',
  blockquote: 'margin:0 0 12px 0;padding-left:12px;border-left:3px solid #d9d9d9;',
};

const ALLOWED_BLOCK_TAGS = new Set(Object.keys(BLOCK_STYLE));
const ALLOWED_INLINE_TAGS = new Set(['strong', 'em', 'u', 'code']);

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const decodeEntities = (value: string): string => value
  .replaceAll('&nbsp;', ' ')
  .replaceAll('&quot;', '"')
  .replaceAll('&#39;', "'")
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
  .replaceAll('&uuml;', 'ü')
  .replaceAll('&Uuml;', 'Ü')
  .replaceAll('&ouml;', 'ö')
  .replaceAll('&Ouml;', 'Ö')
  .replaceAll('&auml;', 'ä')
  .replaceAll('&Auml;', 'Ä')
  .replaceAll('&szlig;', 'ß')
  .replaceAll('&amp;', '&');

// Token form: a system token (`submissions`, `metadata`, ...) or a field token
// (`field:<name>`). Field names are user-defined schema keys, so the field part
// stays permissive except for characters that could break out of the attribute.
const TOKEN_PATTERN = /^[a-z0-9_]+(?::[^"'\s<>]+)?$/i;

interface ParsedTag {
  closing: boolean;
  name: string;
  attrs: Record<string, string>;
}

const parseTag = (raw: string): ParsedTag | null => {
  const match = /^<\/?\s*([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\/?>$/.exec(raw);
  if (!match) return null;

  const closing = raw.startsWith('</');
  const name = match[1].toLowerCase();
  const attrs: Record<string, string> = {};

  if (!closing) {
    const attrPattern = /([a-zA-Z-]+)\s*=\s*"([^"]*)"/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrPattern.exec(match[2])) !== null) {
      attrs[attrMatch[1].toLowerCase()] = attrMatch[2];
    }
  }

  return { closing, name, attrs };
};

const isSafeHref = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return true;
  try {
    const parsed = new URL(trimmed);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const isSafeImgSrc = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('/')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

interface SanitizedSegment {
  kind: 'text' | 'open' | 'close';
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

/**
 * Reduces arbitrary editor HTML to the allowlisted segment stream used by the
 * renderer. Unknown tags/attributes are dropped; text is entity-normalized.
 */
const sanitizeToSegments = (rawHtml: string): SanitizedSegment[] => {
  const segments: SanitizedSegment[] = [];
  const openStack: string[] = [];
  let insideTokenSpan = false;
  const tagPattern = /<[^>]+>/g;

  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushText = (rawText: string): void => {
    if (insideTokenSpan) return;
    const text = decodeEntities(rawText);
    if (!text) return;
    segments.push({ kind: 'text', tag: '', attrs: {}, text });
  };

  while ((match = tagPattern.exec(rawHtml)) !== null) {
    pushText(rawHtml.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const parsed = parseTag(match[0]);
    if (!parsed) continue;

    if (insideTokenSpan) {
      // Token spans are atomic: drop their label content entirely — the
      // renderer replaces the whole span with the resolved token value.
      if (parsed.name === 'span' && parsed.closing) {
        insideTokenSpan = false;
        segments.push({ kind: 'close', tag: openStack.pop() as string, attrs: {}, text: '' });
      }
      continue;
    }

    if (parsed.closing) {
      // Only close tags that are actually open — drops stray/mismatched closes.
      const stackIndex = openStack.lastIndexOf(parsed.name);
      if (stackIndex !== -1) {
        // Close any tags left open inside it (defensive, well-formed input
        // from Tiptap never hits this).
        while (openStack.length > stackIndex) {
          segments.push({ kind: 'close', tag: openStack.pop() as string, attrs: {}, text: '' });
        }
      }
      continue;
    }

    if (parsed.name === 'br') {
      segments.push({ kind: 'open', tag: 'br', attrs: {}, text: '' });
      segments.push({ kind: 'close', tag: 'br', attrs: {}, text: '' });
      continue;
    }

    if (ALLOWED_BLOCK_TAGS.has(parsed.name) || ALLOWED_INLINE_TAGS.has(parsed.name)) {
      openStack.push(parsed.name);
      segments.push({ kind: 'open', tag: parsed.name, attrs: {}, text: '' });
      continue;
    }

    if (parsed.name === 'span') {
      const token = (parsed.attrs['data-token'] ?? '').trim();
      if (TOKEN_PATTERN.test(token)) {
        openStack.push('span');
        insideTokenSpan = true;
        segments.push({ kind: 'open', tag: 'span', attrs: { 'data-token': token }, text: '' });
      }
      continue;
    }

    if (parsed.name === 'a') {
      const href = parsed.attrs.href ?? '';
      if (isSafeHref(href)) {
        openStack.push('a');
        segments.push({ kind: 'open', tag: 'a', attrs: { href: href.trim() }, text: '' });
      }
      continue;
    }

    if (parsed.name === 'img') {
      const src = parsed.attrs.src ?? '';
      if (isSafeImgSrc(src)) {
        segments.push({ kind: 'open', tag: 'img', attrs: { src: src.trim(), alt: parsed.attrs.alt ?? '' }, text: '' });
        segments.push({ kind: 'close', tag: 'img', attrs: {}, text: '' });
      }
      continue;
    }

    // Unknown tag: drop the tag, keep the inner text.
  }

  pushText(rawHtml.slice(cursor));

  while (openStack.length > 0) {
    segments.push({ kind: 'close', tag: openStack.pop() as string, attrs: {}, text: '' });
  }

  return segments;
};

/**
 * Renders a sanitized template into an inline-styled HTML e-mail body and a
 * plain-text fallback. Tokens missing from the map render as "-".
 */
export const renderTemplateMessage = (
  rawTemplateHtml: string,
  tokens: TemplateTokenMap,
): { html: string; text: string } => {
  const segments = sanitizeToSegments(rawTemplateHtml);

  let html = '';
  let text = '';

  const emitToken = (token: string): void => {
    const value = tokens[token] ?? { html: '-', text: '-' };
    html += value.html;
    text += value.text;
  };

  for (const segment of segments) {
    if (segment.kind === 'text') {
      html += escapeHtml(segment.text);
      text += segment.text;
      continue;
    }

    if (segment.kind === 'open') {
      switch (segment.tag) {
        case 'span':
          emitToken(segment.attrs['data-token']);
          break;
        case 'img':
          html += `<img src="${escapeHtml(segment.attrs.src)}" alt="${escapeHtml(segment.attrs.alt)}" style="max-width:100%;height:auto;border-radius:4px;" />`;
          break;
        case 'a':
          html += `<a href="${escapeHtml(segment.attrs.href)}" style="color:#2563eb;" target="_blank" rel="noreferrer">`;
          break;
        case 'br':
          html += '<br />';
          text += '\n';
          break;
        case 'li':
          html += `<li style="${BLOCK_STYLE.li}">`;
          text += '- ';
          break;
        default:
          if (ALLOWED_BLOCK_TAGS.has(segment.tag)) {
            html += `<${segment.tag} style="${BLOCK_STYLE[segment.tag]}">`;
          } else {
            html += `<${segment.tag}>`;
          }
      }
      continue;
    }

    // close
    switch (segment.tag) {
      case 'span':
        break;
      case 'img':
        break;
      case 'p':
      case 'h1':
      case 'h2':
      case 'h3':
      case 'li':
        html += `</${segment.tag}>`;
        text += '\n';
        break;
      case 'blockquote':
        html += '</blockquote>';
        text += '\n';
        break;
      case 'br':
        break;
      default:
        html += `</${segment.tag}>`;
    }
  }

  const normalizedText = text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    html: `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2937;">${html}</div>`,
    text: normalizedText,
  };
};

/**
 * True when a stored template should be used (non-empty after sanitizing).
 */
export const hasUsableTemplate = (rawTemplateHtml: string | null | undefined): boolean => {
  if (typeof rawTemplateHtml !== 'string' || !rawTemplateHtml.trim()) return false;
  return sanitizeToSegments(rawTemplateHtml).some((segment) => (
    (segment.kind === 'open' && segment.tag === 'span')
    || (segment.kind === 'text' && segment.text.trim().length > 0)
    || (segment.kind === 'open' && segment.tag === 'img')
  ));
};
