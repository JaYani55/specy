import React from 'react';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const renderInlineMarkdown = (value: string): string => {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener" class="text-primary underline underline-offset-2">$1</a>')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
};

const markdownToHtml = (content: string): string => {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let index = 0;

  const flushParagraph = (paragraphLines: string[]) => {
    if (paragraphLines.length === 0) return;
    html.push(`<p class="leading-7">${renderInlineMarkdown(paragraphLines.join(' '))}</p>`);
  };

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level} class="font-semibold tracking-tight">${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^-\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^-\s+/, ''));
        index += 1;
      }
      html.push(`<ul class="list-disc space-y-1 pl-5">${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ''));
        index += 1;
      }
      html.push(`<ol class="list-decimal space-y-1 pl-5">${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</ol>`);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s+/.test(lines[index]) && !/^[-\d]+\.\s+/.test(lines[index]) && !/^\s*$/.test(lines[index])) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    flushParagraph(paragraphLines);
  }

  return html.join('');
};

export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, className = '' }) => {
  const html = markdownToHtml(content || '');

  if (!html) {
    return null;
  }

  return (
    <div
      className={`space-y-3 text-sm text-foreground ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};