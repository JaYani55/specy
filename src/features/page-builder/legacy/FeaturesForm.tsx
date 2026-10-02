import React from 'react';
import { useFieldArray, type UseFormReturn, type FieldValues } from 'react-hook-form';
import { PageBuilderData, ContentBlock } from '@/types/pagebuilder';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, Star } from 'lucide-react';
import { MarkdownEditor } from '@/components/pagebuilder/MarkdownEditor';
import { ContentBlockEditor } from './ContentBlockEditor';
import { AddContentBlock } from './AddContentBlock';

interface FeaturesFormProps {
  form: UseFormReturn<FieldValues>;
}

export const FeaturesForm: React.FC<FeaturesFormProps> = ({ form }) => {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'features',
  });

  const generateBlockId = (prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <span>⭐</span>
          <span>Features Section</span>
        </CardTitle>
        <CardDescription>
          Heben Sie die wichtigsten Produktmerkmale hervor
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() =>
              append({
                title: '',
                description: [
                  {
                    id: generateBlockId('feature-desc'),
                    type: 'text',
                    content: '',
                  } as ContentBlock,
                ],
                reverse: false,
                alignment: 'center',
              })
            }
          >
            <Plus className="h-4 w-4 mr-2" />
            Feature hinzufügen
          </Button>
        </div>

        <Accordion type="multiple" className="w-full">
          {fields.map((field, index) => (
            <AccordionItem key={field.id} value={`feature-${index}`} className="border rounded-lg mb-2 px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center space-x-2 text-left flex-1">
                  <Star className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium flex-1">
                    {form.watch(`features.${index}.title`) || `Feature ${index + 1}`}
                  </span>
                  {form.watch(`features.${index}.alignment`) && (
                    <Badge variant="secondary" className="text-xs">
                      {form.watch(`features.${index}.alignment`)}
                    </Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label className="font-semibold">Feature Titel</Label>
                    <Input
                      {...form.register(`features.${index}.title`)}
                      placeholder="z.B. Begegnung auf Augenhöhe"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="font-semibold">Textausrichtung</Label>
                    <Select
                      value={form.watch(`features.${index}.alignment`) || 'center'}
                      onValueChange={(value) =>
                        form.setValue(`features.${index}.alignment`, value as 'left' | 'center' | 'right')
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">Links</SelectItem>
                        <SelectItem value="center">Zentriert</SelectItem>
                        <SelectItem value="right">Rechts</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label className="font-semibold">Beschreibung</Label>
                    <FeatureDescriptionBlocks featureIndex={index} form={form} />
                  </div>

                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(index)}
                    className="w-full"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Feature entfernen
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {fields.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Star className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Noch keine Features hinzugefügt</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const FeatureDescriptionBlocks: React.FC<{ featureIndex: number; form: UseFormReturn<FieldValues> }> = ({
  featureIndex,
  form,
}) => {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: `features.${featureIndex}.description`,
  });

  const generateBlockId = (prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const handleAddBlock = (block: ContentBlock) => {
    append(block);
  };

  return (
    <div className="space-y-3">
      {fields.map((field, blockIndex) => {
        const block = form.watch(`features.${featureIndex}.description.${blockIndex}`) as ContentBlock;

        return (
          <ContentBlockEditor
            key={field.id}
            block={block}
            path={`features.${featureIndex}.description.${blockIndex}`}
            onRemove={() => remove(blockIndex)}
            form={form}
          />
        );
      })}
      <AddContentBlock
        onAdd={handleAddBlock}
        prefix={`feature${featureIndex}-desc`}
      />
    </div>
  );
};
