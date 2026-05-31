import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Typography from '@tiptap/extension-typography';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import { TextSelection } from '@tiptap/pm/state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Bold as BoldIcon, Italic as ItalicIcon, Heading1, Heading2, Heading3, Link as LinkIcon, List, ListOrdered, Unlink } from 'lucide-react';

interface TiptapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface TiptapNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: TiptapMark[];
  content?: TiptapNode[];
}

const escapeMarkdownText = (text: string): string => text;

const areMarksEqual = (left?: TiptapMark[], right?: TiptapMark[]): boolean => {
  if ((left?.length || 0) !== (right?.length || 0)) {
    return false;
  }

  return (left || []).every((mark, index) => {
    const rightMark = right?.[index];
    return mark.type === rightMark?.type && JSON.stringify(mark.attrs || {}) === JSON.stringify(rightMark?.attrs || {});
  });
};

const appendTextNode = (nodes: TiptapNode[], text: string, marks?: TiptapMark[]): void => {
  if (!text) {
    return;
  }

  const previousNode = nodes[nodes.length - 1];
  if (previousNode?.type === 'text' && areMarksEqual(previousNode.marks, marks)) {
    previousNode.text = `${previousNode.text || ''}${text}`;
    return;
  }

  nodes.push(createTextNode(text, marks));
};

const getLinkHref = (marks?: TiptapMark[]): string | null => {
  const linkMark = marks?.find((mark) => mark.type === 'link');
  const href = typeof linkMark?.attrs?.href === 'string' ? linkMark.attrs.href.trim() : '';
  return href || null;
};

const createLinkAttributes = (href: string): Record<string, string> => ({
  href,
  title: href,
});

const applyMarks = (text: string, marks?: TiptapMark[]): string => {
  if (!marks || marks.length === 0) {
    return text;
  }

  const nonLinkMarks = marks.filter((mark) => mark.type !== 'link');
  const hasBold = nonLinkMarks.some((mark) => mark.type === 'bold');
  const hasItalic = nonLinkMarks.some((mark) => mark.type === 'italic');
  const href = getLinkHref(marks);
  let formatted = text;

  if (hasBold && hasItalic) {
    formatted = `***${formatted}***`;
  } else if (hasBold) {
    formatted = `**${formatted}**`;
  } else if (hasItalic) {
    formatted = `*${formatted}*`;
  }

  if (href) {
    formatted = `[${formatted}](${href})`;
  }

  return formatted;
};

const findClosingToken = (value: string, token: string, startIndex: number): number => {
  let searchIndex = startIndex;

  while (searchIndex < value.length) {
    const foundIndex = value.indexOf(token, searchIndex);
    if (foundIndex === -1) {
      return -1;
    }

    if (foundIndex > startIndex) {
      return foundIndex;
    }

    searchIndex = foundIndex + token.length;
  }

  return -1;
};

const findMatchingLinkClose = (value: string, startIndex: number): { labelEnd: number; urlEnd: number } | null => {
  let labelDepth = 1;

  for (let index = startIndex + 1; index < value.length; index += 1) {
    const char = value[index];

    if (char === '[') {
      labelDepth += 1;
      continue;
    }

    if (char === ']') {
      labelDepth -= 1;

      if (labelDepth === 0) {
        if (value[index + 1] !== '(') {
          return null;
        }

        const urlEnd = value.indexOf(')', index + 2);
        if (urlEnd === -1) {
          return null;
        }

        return { labelEnd: index, urlEnd };
      }
    }
  }

  return null;
};

const parseInlineSegment = (input: string, inheritedMarks: TiptapMark[] = []): TiptapNode[] => {
  const nodes: TiptapNode[] = [];
  let cursor = 0;

  while (cursor < input.length) {
    const currentSlice = input.slice(cursor);

    if (currentSlice.startsWith('***')) {
      const closingIndex = findClosingToken(input, '***', cursor + 3);
      if (closingIndex !== -1) {
        const inner = input.slice(cursor + 3, closingIndex);
        nodes.push(...parseInlineSegment(inner, [...inheritedMarks, { type: 'bold' }, { type: 'italic' }]));
        cursor = closingIndex + 3;
        continue;
      }
    }

    if (currentSlice.startsWith('**')) {
      const closingIndex = findClosingToken(input, '**', cursor + 2);
      if (closingIndex !== -1) {
        const inner = input.slice(cursor + 2, closingIndex);
        nodes.push(...parseInlineSegment(inner, [...inheritedMarks, { type: 'bold' }]));
        cursor = closingIndex + 2;
        continue;
      }
    }

    if (currentSlice.startsWith('*')) {
      const closingIndex = findClosingToken(input, '*', cursor + 1);
      if (closingIndex !== -1) {
        const inner = input.slice(cursor + 1, closingIndex);
        nodes.push(...parseInlineSegment(inner, [...inheritedMarks, { type: 'italic' }]));
        cursor = closingIndex + 1;
        continue;
      }
    }

    if (currentSlice.startsWith('[')) {
      const linkRange = findMatchingLinkClose(input, cursor);
      if (linkRange) {
        const label = input.slice(cursor + 1, linkRange.labelEnd);
        const href = input.slice(linkRange.labelEnd + 2, linkRange.urlEnd).trim();
        if (href) {
          nodes.push(...parseInlineSegment(label, [...inheritedMarks, { type: 'link', attrs: createLinkAttributes(href) }]));
          cursor = linkRange.urlEnd + 1;
          continue;
        }
      }
    }

    const nextSpecialIndex = (() => {
      const candidates = ['***', '**', '*', '[']
        .map((token) => input.indexOf(token, cursor + 1))
        .filter((index) => index !== -1);

      return candidates.length > 0 ? Math.min(...candidates) : input.length;
    })();

    appendTextNode(nodes, input.slice(cursor, nextSpecialIndex), inheritedMarks);
    cursor = nextSpecialIndex;
  }

  return nodes;
};

const serializeInlineContent = (nodes?: TiptapNode[]): string => {
  if (!nodes || nodes.length === 0) {
    return '';
  }

  return nodes
    .map((node) => {
      if (node.type === 'text') {
        return applyMarks(escapeMarkdownText(node.text || ''), node.marks);
      }

      if (node.type === 'hardBreak') {
        return '\n';
      }

      return serializeInlineContent(node.content);
    })
    .join('');
};

const serializeBlockNode = (node: TiptapNode, orderedListIndex = 0): string => {
  if (node.type === 'heading') {
    const level = Math.min(Math.max(Number(node.attrs?.level || 1), 1), 3);
    return `${'#'.repeat(level)} ${serializeInlineContent(node.content)}`.trimEnd();
  }

  if (node.type === 'paragraph') {
    return serializeInlineContent(node.content);
  }

  if (node.type === 'bulletList') {
    return (node.content || [])
      .map((item) => `- ${serializeListItem(item)}`.trimEnd())
      .join('\n');
  }

  if (node.type === 'orderedList') {
    return (node.content || [])
      .map((item, index) => `${orderedListIndex + index + 1}. ${serializeListItem(item)}`.trimEnd())
      .join('\n');
  }

  if (node.type === 'listItem') {
    return serializeListItem(node);
  }

  return serializeInlineContent(node.content);
};

const serializeListItem = (node: TiptapNode): string => {
  const blocks = node.content || [];
  const segments = blocks
    .map((child) => {
      if (child.type === 'paragraph') {
        return serializeInlineContent(child.content);
      }
      return serializeBlockNode(child);
    })
    .filter(Boolean);

  return segments.join('\n');
};

const serializeDocumentToMarkdown = (doc?: TiptapNode): string => {
  const content = doc?.content || [];
  const blocks = content
    .map((node) => serializeBlockNode(node))
    .filter((block) => block.trim().length > 0);

  return blocks.join('\n\n').trim();
};

const createTextNode = (text: string, marks?: TiptapMark[]): TiptapNode => ({
  type: 'text',
  text,
  ...(marks && marks.length > 0 ? { marks } : {}),
});

const parseInlineMarkdown = (input: string): TiptapNode[] => {
  const nodes: TiptapNode[] = [];
  const segments = input.split('\n');

  segments.forEach((segment, segmentIndex) => {
    nodes.push(...parseInlineSegment(segment));

    if (segmentIndex < segments.length - 1) {
      nodes.push({ type: 'hardBreak' });
    }
  });

  return nodes;
};

const parseParagraph = (markdown: string): TiptapNode => ({
  type: 'paragraph',
  content: parseInlineMarkdown(markdown),
});

const parseList = (lines: string[], ordered: boolean): TiptapNode => ({
  type: ordered ? 'orderedList' : 'bulletList',
  content: lines.map((line) => ({
    type: 'listItem',
    content: [
      parseParagraph(line.replace(ordered ? /^\d+\.\s+/ : /^-\s+/, '')),
    ],
  })),
});

const parseMarkdownToDocument = (markdown: string): TiptapNode => {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };
  }

  const lines = normalized.split('\n');
  const content: TiptapNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      content.push({
        type: 'heading',
        attrs: { level: headingMatch[1].length },
        content: parseInlineMarkdown(headingMatch[2]),
      });
      index += 1;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^-\s+/.test(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      content.push(parseList(listLines, false));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const listLines: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
      }
      content.push(parseList(listLines, true));
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !/^-\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }

    content.push(parseParagraph(paragraphLines.join('\n')));
  }

  return { type: 'doc', content };
};

interface MarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  className?: string;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  content,
  onChange,
  placeholder = 'Text eingeben...',
  className = '',
}) => {
  const isUpdatingFromPropRef = useRef(false);
  const lastContentRef = useRef(content);
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [hasLinkTarget, setHasLinkTarget] = useState(false);

  const normalizeLinkUrl = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith('/') || trimmed.startsWith('#')) {
      return trimmed;
    }

    if (trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
      return trimmed;
    }

    const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
        return null;
      }
      return candidate;
    } catch {
      return null;
    }
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bold: false,
        heading: {
          levels: [1, 2, 3],
        },
        italic: false,
        link: false,
      }),
      Typography,
      Bold,
      Italic,
      Link.configure({
        openOnClick: false,
        autolink: false,
        defaultProtocol: 'https',
        HTMLAttributes: {
          class: 'text-blue-600 underline underline-offset-2 decoration-blue-500/70 hover:text-blue-700 dark:text-blue-400 dark:decoration-blue-300/70 dark:hover:text-blue-300 cursor-pointer transition-colors',
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
    ],
    content: parseMarkdownToDocument(content || ''),
    onUpdate: ({ editor }) => {
      // Prevent update loops - don't trigger onChange if we're updating from props
      if (isUpdatingFromPropRef.current) {
        return;
      }

      const markdown = serializeDocumentToMarkdown(editor.getJSON() as TiptapNode);

      // Update the last content reference
      lastContentRef.current = markdown;
      
      // Call onChange immediately without debounce
      onChange(markdown);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to, empty } = editor.state.selection;
      if (!empty || editor.isActive('link')) {
        savedSelectionRef.current = { from, to };
      }
      setHasLinkTarget(!empty || editor.isActive('link'));
    },
    immediatelyRender: false,
  });

  // Update editor content when prop changes
  useEffect(() => {
    if (editor && content !== undefined) {
      // Skip update if content hasn't actually changed (avoids loops)
      if (content === lastContentRef.current) {
        return;
      }

      const nextDoc = parseMarkdownToDocument(content);
      const currentMarkdown = serializeDocumentToMarkdown(editor.getJSON() as TiptapNode);

      if (currentMarkdown !== content) {
        // Set flag to prevent onUpdate from firing
        isUpdatingFromPropRef.current = true;
        editor.commands.setContent(nextDoc, { emitUpdate: false });
        // Reset the flag immediately since emitUpdate is false
        isUpdatingFromPropRef.current = false;
        // Update last content reference
        lastContentRef.current = content;
      }
    }
  }, [content, editor]);

  if (!editor) {
    return null;
  }

  const openLinkEditor = (): void => {
    const { from, to, empty } = editor.state.selection;
    if (!empty || editor.isActive('link')) {
      savedSelectionRef.current = { from, to };
    }

    setLinkUrl(typeof editor.getAttributes('link').href === 'string' ? editor.getAttributes('link').href : '');
    setLinkPopoverOpen(true);
  };

  const applyLink = (): void => {
    const normalizedUrl = normalizeLinkUrl(linkUrl);
    if (!normalizedUrl) {
      return;
    }

    editor.chain().focus().run();

    const savedSelection = savedSelectionRef.current;
    if (savedSelection) {
      const resolvedSelection = TextSelection.create(
        editor.state.doc,
        savedSelection.from,
        savedSelection.to,
      );
      editor.view.dispatch(editor.view.state.tr.setSelection(resolvedSelection));
    }

    editor.chain().focus().extendMarkRange('link').setLink(createLinkAttributes(normalizedUrl)).run();

    setLinkPopoverOpen(false);
  };

  const removeLink = (): void => {
    const savedSelection = savedSelectionRef.current;
    if (savedSelection) {
      const resolvedSelection = TextSelection.create(
        editor.state.doc,
        savedSelection.from,
        savedSelection.to,
      );
      editor.view.dispatch(editor.view.state.tr.setSelection(resolvedSelection));
    }

    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkPopoverOpen(false);
    setLinkUrl('');
  };

  const preserveEditorSelection = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
  };

  const canEditLink = hasLinkTarget;

  return (
    <div className={`border rounded-lg overflow-hidden ${className}`}>
      {/* Toolbar */}
      <div className="bg-muted/50 border-b p-2 flex gap-1 flex-wrap">
        <Button
          type="button"
          variant={editor.isActive('bold') ? 'default' : 'ghost'}
          size="sm"
          onMouseDown={preserveEditorSelection}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className="h-8 w-8 p-0"
        >
          <BoldIcon className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={editor.isActive('italic') ? 'default' : 'ghost'}
          size="sm"
          onMouseDown={preserveEditorSelection}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className="h-8 w-8 p-0"
        >
          <ItalicIcon className="h-4 w-4" />
        </Button>
        <div className="w-px h-8 bg-border mx-1" />
        <Button
          type="button"
          variant={editor.isActive('heading', { level: 1 }) ? 'default' : 'ghost'}
          size="sm"
          onMouseDown={preserveEditorSelection}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          className="h-8 w-8 p-0"
        >
          <Heading1 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={editor.isActive('heading', { level: 2 }) ? 'default' : 'ghost'}
          size="sm"
          onMouseDown={preserveEditorSelection}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          className="h-8 w-8 p-0"
        >
          <Heading2 className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={editor.isActive('heading', { level: 3 }) ? 'default' : 'ghost'}
          size="sm"
          onMouseDown={preserveEditorSelection}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          className="h-8 w-8 p-0"
        >
          <Heading3 className="h-4 w-4" />
        </Button>
        <div className="w-px h-8 bg-border mx-1" />
        <Button
          type="button"
          variant={editor.isActive('bulletList') ? 'default' : 'ghost'}
          size="sm"
          onMouseDown={preserveEditorSelection}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          className="h-8 w-8 p-0"
        >
          <List className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant={editor.isActive('orderedList') ? 'default' : 'ghost'}
          size="sm"
          onMouseDown={preserveEditorSelection}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          className="h-8 w-8 p-0"
        >
          <ListOrdered className="h-4 w-4" />
        </Button>
        <div className="w-px h-8 bg-border mx-1" />
        <Popover
          open={linkPopoverOpen}
          onOpenChange={(open) => {
            setLinkPopoverOpen(open);
            if (!open) {
              setLinkUrl('');
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant={editor.isActive('link') ? 'default' : 'ghost'}
              size="sm"
              onMouseDown={preserveEditorSelection}
              onClick={openLinkEditor}
              className="h-8 w-8 p-0"
              disabled={!canEditLink}
            >
              <LinkIcon className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Link setzen</p>
              <p className="text-xs text-muted-foreground">
                Text markieren, URL einfuegen und anwenden.
              </p>
            </div>
            <Input
              value={linkUrl}
              onChange={(event) => setLinkUrl(event.target.value)}
              placeholder="https://example.com"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  applyLink();
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={removeLink}
                disabled={!editor.isActive('link')}
              >
                <Unlink className="h-4 w-4 mr-1" />
                Entfernen
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={applyLink}
                disabled={!normalizeLinkUrl(linkUrl)}
              >
                Link uebernehmen
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Editor */}
      <EditorContent 
        editor={editor} 
        className="prose prose-sm max-w-none p-4 min-h-[120px] focus:outline-none"
        placeholder={placeholder}
      />
    </div>
  );
};
