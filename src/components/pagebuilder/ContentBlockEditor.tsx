import React from 'react';
import type { UseFormReturn, FieldValues } from 'react-hook-form';
import { ContentBlock } from '@/types/pagebuilder';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ImageUploader } from './ImageUploader';
import { MarkdownEditor } from './MarkdownEditor';
import { Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface ContentBlockEditorProps {
  block: ContentBlock;
  path: string;
  onRemove: () => void;
  form: UseFormReturn<FieldValues>;
}

export const ContentBlockEditor: React.FC<ContentBlockEditorProps> = ({
  block,
  path,
  onRemove,
  form,
}) => {
  return (
    <Card className="p-4 space-y-4 bg-muted/30">
      <div className="flex justify-between items-center">
        <Label className="text-base font-semibold flex items-center space-x-2">
          <span className="text-muted-foreground">
            {block.type === 'text' && '📝'}
            {block.type === 'heading' && '📋'}
            {block.type === 'image' && '🖼️'}
            {block.type === 'quote' && '💬'}
            {block.type === 'list' && '📋'}
            {block.type === 'video' && '🎥'}
          </span>
          <span>
            {block.type === 'text' && 'Text Block'}
            {block.type === 'heading' && 'Heading Block'}
            {block.type === 'image' && 'Image Block'}
            {block.type === 'quote' && 'Quote Block'}
            {block.type === 'list' && 'List Block'}
            {block.type === 'video' && 'Video Block'}
          </span>
        </Label>
        <Button type="button" variant="destructive" size="sm" onClick={onRemove}>
          <Trash2 className="h-4 w-4 mr-1" />
          Entfernen
        </Button>
      </div>

      {block.type === 'text' && (
        <div>
          <Label className="text-sm mb-2 block">Content (Markdown-Formatierung)</Label>
          <MarkdownEditor
            content={form.watch(`${path}.content`) || ''}
            onChange={(content) => form.setValue(`${path}.content`, content)}
            placeholder="Text mit Markdown-Formatierung eingeben..."
          />
          <p className="text-xs text-muted-foreground mt-2">
            Verwenden Sie **fett**, *kursiv*, # Überschrift 1, ## Überschrift 2, ### Überschrift 3
          </p>
        </div>
      )}

      {block.type === 'heading' && (
        <>
          <div>
            <Label className="text-sm">Überschrift</Label>
            <Input
              {...form.register(`${path}.content`)}
              placeholder="Überschrift eingeben..."
            />
          </div>
          <div>
            <Label className="text-sm">Überschrift-Ebene</Label>
            <Select
              value={form.watch(`${path}.level`) || 'heading2'}
              onValueChange={(value) => form.setValue(`${path}.level`, value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="heading1">Überschrift 1 (H1)</SelectItem>
                <SelectItem value="heading2">Überschrift 2 (H2)</SelectItem>
                <SelectItem value="heading3">Überschrift 3 (H3)</SelectItem>
                <SelectItem value="heading4">Überschrift 4 (H4)</SelectItem>
                <SelectItem value="heading5">Überschrift 5 (H5)</SelectItem>
                <SelectItem value="heading6">Überschrift 6 (H6)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {block.type === 'image' && (
        <>
          <div className="space-y-4">
            {/* Image URL Input with Uploader */}
            <div>
              <Label className="text-sm">Bild-URL</Label>
              <ImageUploader
                value={form.watch(`${path}.src`)}
                onChange={(url) => form.setValue(`${path}.src`, url, { shouldDirty: true, shouldTouch: true })}
                bucket="booking_media"
                folder="product-images"
              />
            </div>

            {/* URL + preview feedback */}
            {form.watch(`${path}.src`) && (
              <div className="rounded-lg border overflow-hidden bg-muted/30">
                <img
                  src={form.watch(`${path}.src`)}
                  alt={form.watch(`${path}.alt`) || 'Vorschau'}
                  className="w-full max-h-48 object-contain"
                />
                <div className="px-3 py-2 flex items-center gap-2 border-t">
                  <span className="text-xs text-muted-foreground truncate flex-1" title={form.watch(`${path}.src`)}>
                    {form.watch(`${path}.src`)}
                  </span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => { void navigator.clipboard.writeText(form.watch(`${path}.src`)); }}
                    title="URL kopieren"
                  >
                    📋
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <Label className="text-sm">Alt-Text</Label>
            <Input {...form.register(`${path}.alt`)} placeholder="Beschreibung für Barrierefreiheit" />
          </div>
          <div>
            <Label className="text-sm">Bildunterschrift (Optional)</Label>
            <Input {...form.register(`${path}.caption`)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-sm">Breite (Optional)</Label>
              <Input
                type="number"
                {...form.register(`${path}.width`, { valueAsNumber: true })}
                placeholder="px"
              />
            </div>
            <div>
              <Label className="text-sm">Höhe (Optional)</Label>
              <Input
                type="number"
                {...form.register(`${path}.height`, { valueAsNumber: true })}
                placeholder="px"
              />
            </div>
          </div>
        </>
      )}

      {block.type === 'quote' && (
        <>
          <div>
            <Label className="text-sm">Quote Text</Label>
            <Textarea {...form.register(`${path}.text`)} rows={3} />
          </div>
          <div>
            <Label className="text-sm">Author (Optional)</Label>
            <Input {...form.register(`${path}.author`)} />
          </div>
          <div>
            <Label className="text-sm">Source (Optional)</Label>
            <Input {...form.register(`${path}.source`)} />
          </div>
        </>
      )}

      {block.type === 'list' && (
        <>
          <div>
            <Label className="text-sm">List Style</Label>
            <Select
              value={form.watch(`${path}.style`) || 'unordered'}
              onValueChange={(value) => form.setValue(`${path}.style`, value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ordered">Ordered (1, 2, 3...)</SelectItem>
                <SelectItem value="unordered">Unordered (bullets)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">List Items (one per line)</Label>
            <Textarea
              {...form.register(`${path}.items`)}
              rows={5}
              placeholder="Item 1&#10;Item 2&#10;Item 3"
              onChange={(e) => {
                const items = e.target.value.split('\n').filter((item) => item.trim());
                form.setValue(`${path}.items`, items);
              }}
            />
          </div>
        </>
      )}

      {block.type === 'video' && (
        <>
          <div>
            <Label className="text-sm">Video URL</Label>
            <Input {...form.register(`${path}.src`)} placeholder="YouTube or Vimeo embed URL" />
          </div>
          <div>
            <Label className="text-sm">Provider</Label>
            <Select
              value={form.watch(`${path}.provider`) || 'youtube'}
              onValueChange={(value) => form.setValue(`${path}.provider`, value)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="youtube">YouTube</SelectItem>
                <SelectItem value="vimeo">Vimeo</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Caption (Optional)</Label>
            <Input {...form.register(`${path}.caption`)} />
          </div>
        </>
      )}
    </Card>
  );
};
