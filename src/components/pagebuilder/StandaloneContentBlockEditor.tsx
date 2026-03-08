import React from 'react';
import { ContentBlock } from '@/types/pagebuilder';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ImageUploader } from './ImageUploader';
import { MarkdownEditor } from './MarkdownEditor';
import { Trash2, Plus, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

const BLOCK_LABELS: Record<string, string> = {
  text: 'Text Block',
  heading: 'Heading Block',
  image: 'Image Block',
  quote: 'Quote Block',
  list: 'List Block',
  video: 'Video Block',
};

const BLOCK_ICONS: Record<string, string> = {
  text: '📝',
  heading: '📋',
  image: '🖼️',
  quote: '💬',
  list: '📄',
  video: '🎥',
};

interface StandaloneContentBlockEditorProps {
  block: ContentBlock;
  onChange: (block: ContentBlock) => void;
  onRemove: () => void;
}

export const StandaloneContentBlockEditor: React.FC<StandaloneContentBlockEditorProps> = ({
  block,
  onChange,
  onRemove,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  // Typed patch helper — merges partial update onto current block
  const patch = (update: Record<string, unknown>) =>
    onChange({ ...block, ...update } as ContentBlock);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`p-4 space-y-4 bg-muted/30 relative transition-colors ${isDragging ? 'border-primary ring-2 ring-primary/20 bg-background' : ''}`}
    >
      <div className="flex justify-between items-center group">
        <Label className="text-base font-semibold flex items-center gap-2">
          {/* Drag Handle */}
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing p-1 -ml-1 hover:bg-muted rounded transition-colors"
          >
            <GripVertical className="h-5 w-5 text-muted-foreground" />
          </div>
          <span className="text-lg">{BLOCK_ICONS[block.type] ?? '📦'}</span>
          <span>{BLOCK_LABELS[block.type] ?? block.type}</span>
          <Badge variant="outline" className="text-[10px] uppercase font-mono">{block.type}</Badge>
        </Label>
        <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
          <Trash2 className="h-4 w-4 mr-1" />
          Entfernen
        </Button>
      </div>

      {/* ── text ─────────────────────────────────────────────── */}
      {block.type === 'text' && (
        <div>
          <Label className="text-sm mb-2 block">Content (Markdown)</Label>
          <MarkdownEditor
            content={block.content}
            onChange={(content) => patch({ content })}
            placeholder="Text mit Markdown-Formatierung eingeben..."
          />
        </div>
      )}

      {/* ── heading ──────────────────────────────────────────── */}
      {block.type === 'heading' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">Überschrift</Label>
            <Input
              value={block.content}
              onChange={(e) => patch({ content: e.target.value })}
              placeholder="Überschrift eingeben..."
            />
          </div>
          <div>
            <Label className="text-sm">Ebene</Label>
            <Select
              value={block.level}
              onValueChange={(level) => patch({ level })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6'] as const).map((l) => (
                  <SelectItem key={l} value={l}>{l.replace('heading', 'H')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* ── image ────────────────────────────────────────────── */}
      {block.type === 'image' && (
        <div className="space-y-3">
          <div>
            <Label className="text-sm mb-1.5 block">Bild</Label>
            <ImageUploader
              value={block.src}
              onChange={(src) => patch({ src })}
            />
          </div>

          {/* Preview + URL feedback */}
          {block.src && (
            <div className="rounded-lg border overflow-hidden bg-muted/30">
              <img
                src={block.src}
                alt={block.alt || 'Vorschau'}
                className="w-full max-h-48 object-contain"
              />
              <div className="px-3 py-2 flex items-center gap-2 border-t">
                <span className="text-xs text-muted-foreground truncate flex-1" title={block.src}>
                  {block.src}
                </span>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => { void navigator.clipboard.writeText(block.src); }}
                  title="URL kopieren"
                >
                  📋
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Alt-Text</Label>
              <Input
                value={block.alt}
                onChange={(e) => patch({ alt: e.target.value })}
                placeholder="Bildbeschreibung für Barrierefreiheit..."
              />
            </div>
            <div>
              <Label className="text-sm">Bildunterschrift</Label>
              <Input
                value={block.caption ?? ''}
                onChange={(e) => patch({ caption: e.target.value })}
                placeholder="Bildunterschrift (optional)"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Breite (px)</Label>
              <Input
                type="number"
                value={block.width ?? ''}
                onChange={(e) => patch({ width: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="800"
              />
            </div>
            <div>
              <Label className="text-sm">Höhe (px)</Label>
              <Input
                type="number"
                value={block.height ?? ''}
                onChange={(e) => patch({ height: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="600"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── quote ────────────────────────────────────────────── */}
      {block.type === 'quote' && (
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Zitat</Label>
            <Textarea
              value={block.text}
              onChange={(e) => patch({ text: e.target.value })}
              placeholder="Zitattext eingeben..."
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Autor</Label>
              <Input
                value={block.author ?? ''}
                onChange={(e) => patch({ author: e.target.value })}
                placeholder="Autor (optional)"
              />
            </div>
            <div>
              <Label className="text-sm">Quelle</Label>
              <Input
                value={block.source ?? ''}
                onChange={(e) => patch({ source: e.target.value })}
                placeholder="Quelle (optional)"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── list ─────────────────────────────────────────────── */}
      {block.type === 'list' && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Label className="text-sm shrink-0">Listentyp</Label>
            <Select
              value={block.style}
              onValueChange={(style) => patch({ style })}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unordered">Ungeordnet (• Bullets)</SelectItem>
                <SelectItem value="ordered">Geordnet (1. 2. 3.)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            {block.items.map((item, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={item}
                  onChange={(e) => {
                    const items = [...block.items];
                    items[i] = e.target.value;
                    patch({ items });
                  }}
                  placeholder={`Element ${i + 1}...`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => patch({ items: block.items.filter((_, idx) => idx !== i) })}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => patch({ items: [...block.items, ''] })}
            >
              <Plus className="h-4 w-4 mr-2" />
              Element hinzufügen
            </Button>
          </div>
        </div>
      )}

      {/* ── video ────────────────────────────────────────────── */}
      {block.type === 'video' && (
        <div className="space-y-3">
          <div>
            <Label className="text-sm">Video URL</Label>
            <Input
              value={block.src}
              onChange={(e) => patch({ src: e.target.value })}
              placeholder="https://youtube.com/watch?v=... oder Vimeo-URL..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Plattform</Label>
              <Select
                value={block.provider}
                onValueChange={(provider) => patch({ provider })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="vimeo">Vimeo</SelectItem>
                  <SelectItem value="other">Andere</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-sm">Bildunterschrift</Label>
              <Input
                value={block.caption ?? ''}
                onChange={(e) => patch({ caption: e.target.value })}
                placeholder="Bildunterschrift (optional)"
              />
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
