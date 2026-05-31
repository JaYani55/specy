import React from 'react';
import { useFormContext, useFieldArray } from 'react-hook-form';
import { PageBuilderData, ContentBlock } from '@/types/pagebuilder';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ImageUploader } from './ImageUploader';
import { MarkdownEditor } from './MarkdownEditor';
import { useResolvedMediaUrl } from '@/utils/mediaUrl';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface HeroFormProps {
  form: ReturnType<typeof useFormContext<PageBuilderData>>;
}

export const HeroForm: React.FC<HeroFormProps> = ({ form }) => {
  const resolvedHeroImage = useResolvedMediaUrl(form.watch('hero.image'));
  const { fields: statsFields, append: appendStat, remove: removeStat } = useFieldArray({
    control: form.control,
    name: 'hero.stats',
  });

  const { fields: descFields, append: appendDesc, remove: removeDesc } = useFieldArray({
    control: form.control,
    name: 'hero.description',
  });

  const generateBlockId = (prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <span>🦸</span>
          <span>Hero Section</span>
        </CardTitle>
        <CardDescription>
          Der erste Eindruck zählt - gestalten Sie den Hero-Bereich Ihrer Produktseite
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Title */}
        <div className="space-y-2">
          <Label htmlFor="hero-title" className="text-base font-semibold">
            Titel
          </Label>
          <Input
            id="hero-title"
            {...form.register('hero.title')}
            placeholder="z.B. Disability Awareness Session"
            className="text-lg"
          />
        </div>

        <Separator />

        {/* Image */}
        <div className="space-y-2">
          <Label className="text-base font-semibold">Hero Bild</Label>
          <ImageUploader
            value={form.watch('hero.image')}
            onChange={(url) => form.setValue('hero.image', url)}
          />
          {form.watch('hero.image') && (
            <div className="mt-2 rounded-lg border overflow-hidden">
              <img
                src={resolvedHeroImage}
                alt="Hero preview"
                className="w-full h-48 object-cover"
              />
            </div>
          )}
        </div>

        <Separator />

        {/* Description Blocks */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Beschreibung</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                appendDesc({
                  id: generateBlockId('hero-desc'),
                  type: 'text',
                  content: '',
                  format: 'paragraph',
                } as ContentBlock)
              }
            >
              <Plus className="h-4 w-4 mr-2" />
              Block hinzufügen
            </Button>
          </div>

          <div className="space-y-3">
            {descFields.map((field, index) => {
              const block = form.watch(`hero.description.${index}`) as ContentBlock;
              return (
                <Card key={field.id} className="border-l-4 border-l-primary">
                  <CardContent className="pt-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2">
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                        <Badge variant="secondary">{block.type}</Badge>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeDesc(index)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    {block.type === 'text' && (
                      <div>
                        <MarkdownEditor
                          content={form.watch(`hero.description.${index}.content`) || ''}
                          onChange={(content) =>
                            form.setValue(`hero.description.${index}.content`, content)
                          }
                          placeholder="Beschreibungstext mit Markdown-Formatierung..."
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Verwenden Sie **fett**, *kursiv*, # für Überschriften
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <Separator />

        {/* Stats */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Statistiken</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => appendStat({ label: '', value: '' })}
            >
              <Plus className="h-4 w-4 mr-2" />
              Statistik hinzufügen
            </Button>
          </div>

          <div className="grid gap-3">
            {statsFields.map((field, index) => (
              <Card key={field.id} className="border-dashed">
                <CardContent className="pt-4">
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <div>
                      <Label className="text-xs text-muted-foreground">Wert</Label>
                      <Input
                        {...form.register(`hero.stats.${index}.value`)}
                        placeholder="z.B. 4 STUNDEN"
                        className="font-semibold"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Label</Label>
                      <Input
                        {...form.register(`hero.stats.${index}.label`)}
                        placeholder="z.B. INKL. PAUSEN"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeStat(index)}
                      className="mt-5"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
