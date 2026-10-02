import React from 'react';
import { useFieldArray, type UseFormReturn, type FieldValues } from 'react-hook-form';
import { ContentBlock } from '@/types/pagebuilder';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, LayoutGrid, CheckCircle } from 'lucide-react';
import { MarkdownEditor } from '@/components/pagebuilder/MarkdownEditor';
import { IconPicker } from './IconPicker';

interface CardsFormProps {
  form: UseFormReturn<FieldValues>;
}

export const CardsForm: React.FC<CardsFormProps> = ({ form }) => {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'cards',
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <span>🎴</span>
          <span>Cards Section</span>
        </CardTitle>
        <CardDescription>
          Präsentieren Sie Informationen in übersichtlichen Karten
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => append({ 
              icon: 'Clock', 
              color: 'primary', 
              content: [], 
              title: '', 
              description: '' 
            })}
          >
            <Plus className="h-4 w-4 mr-2" />
            Karte hinzufügen
          </Button>
        </div>

        <Accordion type="multiple" className="w-full">
          {fields.map((field, index) => (
            <AccordionItem key={field.id} value={`card-${index}`} className="border rounded-lg mb-2 px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center space-x-2 text-left">
                  <LayoutGrid className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium">
                    {form.watch(`cards.${index}.title`) || `Karte ${index + 1}`}
                  </span>
                  <Badge variant="secondary">{form.watch(`cards.${index}.color`)}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="font-semibold">Titel</Label>
                      <Input
                        {...form.register(`cards.${index}.title`)}
                        placeholder="Kartentitel"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="font-semibold">Beschreibung</Label>
                      <Input
                        {...form.register(`cards.${index}.description`)}
                        placeholder="Kurzbeschreibung"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <IconPicker
                      value={form.watch(`cards.${index}.icon`)}
                      onChange={(iconName) => form.setValue(`cards.${index}.icon`, iconName)}
                    />
                    <div className="space-y-2">
                      <Label className="font-semibold">Farbe</Label>
                      <Input
                        {...form.register(`cards.${index}.color`)}
                        placeholder="z.B. primary, secondary"
                      />
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label className="font-semibold">Karteninhalt</Label>
                    <CardContentBlocks cardIndex={index} form={form} />
                  </div>

                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(index)}
                    className="w-full"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Karte entfernen
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {fields.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <LayoutGrid className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Noch keine Karten hinzugefügt</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const CardContentBlocks: React.FC<{ cardIndex: number; form: UseFormReturn<FieldValues> }> = ({
  cardIndex,
  form,
}) => {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: `cards.${cardIndex}.content`,
  });

  const generateBlockId = (prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  return (
    <div className="space-y-3">
      {fields.map((field, blockIndex) => {
        const block = form.watch(`cards.${cardIndex}.content.${blockIndex}`);
        return (
          <Card key={field.id} className="border-dashed">
            <CardContent className="pt-4 space-y-3">
              <div className="flex justify-between items-start">
                <Badge variant="outline">{block.type}</Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(blockIndex)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>

              {block.type === 'bullet-point' && (
                <div className="flex items-start gap-2">
                  <CheckCircle className="h-5 w-5 text-primary mt-2 flex-shrink-0" />
                  <Input
                    {...form.register(`cards.${cardIndex}.content.${blockIndex}.text`)}
                    placeholder="Bullet point text..."
                  />
                </div>
              )}

              {block.type === 'text' && (
                <div>
                  <MarkdownEditor
                    content={form.watch(`cards.${cardIndex}.content.${blockIndex}.content`) || ''}
                    onChange={(content) =>
                      form.setValue(`cards.${cardIndex}.content.${blockIndex}.content`, content)
                    }
                    placeholder="Text mit Markdown-Formatierung..."
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    **fett**, *kursiv*
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            append({
              id: generateBlockId(`card${cardIndex}-bullet`),
              type: 'bullet-point',
              text: '',
            })
          }
          className="flex-1"
        >
          <CheckCircle className="h-4 w-4 mr-2" />
          Bullet Point hinzufügen
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            append({
              id: generateBlockId(`card${cardIndex}-text`),
              type: 'text',
              content: '',
            } as ContentBlock)
          }
          className="flex-1"
        >
          <Plus className="h-4 w-4 mr-2" />
          Text-Block hinzufügen
        </Button>
      </div>
    </div>
  );
};
