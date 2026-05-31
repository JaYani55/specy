import React from 'react';
import type { ContentBlock } from '@/types/pagebuilder';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MarkdownContent } from '@/components/forms/MarkdownContent';
import { buildFormSharePath } from '@/utils/sharePaths';

interface ObjectContentRendererProps {
  blocks: ContentBlock[];
  tenantSlug?: string | null;
}

const headingClassMap: Record<string, string> = {
  heading1: 'text-4xl font-semibold tracking-tight',
  heading2: 'text-3xl font-semibold tracking-tight',
  heading3: 'text-2xl font-semibold tracking-tight',
  heading4: 'text-xl font-semibold tracking-tight',
  heading5: 'text-lg font-semibold tracking-tight',
  heading6: 'text-base font-semibold tracking-tight',
};

export const ObjectContentRenderer: React.FC<ObjectContentRendererProps> = ({ blocks, tenantSlug }) => {
  return (
    <div className="space-y-6">
      {blocks.map((block) => {
        if (block.type === 'text') {
          return <MarkdownContent key={block.id} content={block.content} className="text-base" />;
        }

        if (block.type === 'heading') {
          const Tag = block.level === 'heading1' ? 'h1' : block.level === 'heading2' ? 'h2' : block.level === 'heading3' ? 'h3' : block.level === 'heading4' ? 'h4' : block.level === 'heading5' ? 'h5' : 'h6';
          return <Tag key={block.id} className={headingClassMap[block.level]}>{block.content}</Tag>;
        }

        if (block.type === 'image') {
          return (
            <figure key={block.id} className="space-y-3 overflow-hidden rounded-2xl border bg-muted/20">
              {block.src ? (
                <img src={block.src} alt={block.alt || block.caption || 'Document image'} className="h-auto w-full object-cover" />
              ) : null}
              {(block.caption || block.alt) ? (
                <figcaption className="px-4 pb-4 text-sm text-muted-foreground">{block.caption || block.alt}</figcaption>
              ) : null}
            </figure>
          );
        }

        if (block.type === 'quote') {
          return (
            <blockquote key={block.id} className="rounded-2xl border-l-4 border-primary/60 bg-muted/20 px-5 py-4 italic">
              <p className="text-lg leading-8">{block.text}</p>
              {(block.author || block.source) ? (
                <footer className="mt-3 text-sm not-italic text-muted-foreground">
                  {[block.author, block.source].filter(Boolean).join(' · ')}
                </footer>
              ) : null}
            </blockquote>
          );
        }

        if (block.type === 'list') {
          const ListTag = block.style === 'ordered' ? 'ol' : 'ul';
          return (
            <ListTag key={block.id} className={block.style === 'ordered' ? 'list-decimal space-y-2 pl-6' : 'list-disc space-y-2 pl-6'}>
              {block.items.map((item, index) => <li key={`${block.id}-${index}`}>{item}</li>)}
            </ListTag>
          );
        }

        if (block.type === 'video') {
          return (
            <Card key={block.id} className="space-y-3 p-4">
              <div className="text-sm font-medium">Video</div>
              <a href={block.src} target="_blank" rel="noreferrer" className="text-sm text-primary underline underline-offset-2">
                {block.src}
              </a>
              {block.caption ? <p className="text-sm text-muted-foreground">{block.caption}</p> : null}
            </Card>
          );
        }

        if (block.type === 'form') {
          const formHref = tenantSlug && block.share_slug ? buildFormSharePath(tenantSlug, block.share_slug) : null;
          return (
            <Card key={block.id} className="space-y-3 p-4">
              <div>
                <div className="text-base font-semibold">{block.form_name || 'Formular'}</div>
                <p className="text-sm text-muted-foreground">{block.requires_auth ? 'Anmeldung erforderlich' : 'Öffentlich verfügbar'}</p>
              </div>
              {formHref ? (
                <Button asChild variant="outline" size="sm">
                  <a href={formHref}>{block.requires_auth ? 'Formular öffnen' : 'Zum Formular'}</a>
                </Button>
              ) : null}
            </Card>
          );
        }

        return null;
      })}
    </div>
  );
};