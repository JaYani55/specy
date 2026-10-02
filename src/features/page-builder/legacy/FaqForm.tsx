import React from 'react';
import { useFieldArray, type UseFormReturn, type FieldValues } from 'react-hook-form';
import { ContentBlock } from '@/types/pagebuilder';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Trash2, HelpCircle } from 'lucide-react';
import { MarkdownEditor } from '@/components/pagebuilder/MarkdownEditor';

interface FaqFormProps {
  form: UseFormReturn<FieldValues>;
}

export const FaqForm: React.FC<FaqFormProps> = ({ form }) => {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'faq',
  });

  const generateBlockId = (prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <span>❓</span>
          <span>FAQ Section</span>
        </CardTitle>
        <CardDescription>
          Beantworten Sie häufig gestellte Fragen Ihrer Kunden
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() =>
              append({
                question: '',
                answer: [
                  {
                    id: generateBlockId('faq-answer'),
                    type: 'text',
                    content: '',
                  } as ContentBlock,
                ],
              })
            }
          >
            <Plus className="h-4 w-4 mr-2" />
            FAQ hinzufügen
          </Button>
        </div>

        <Accordion type="multiple" className="w-full">
          {fields.map((field, index) => (
            <AccordionItem key={field.id} value={`faq-${index}`} className="border rounded-lg mb-2 px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center space-x-2 text-left">
                  <HelpCircle className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium">
                    {form.watch(`faq.${index}.question`) || `FAQ ${index + 1}`}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label className="font-semibold">Frage</Label>
                    <Input
                      {...form.register(`faq.${index}.question`)}
                      placeholder="Frage eingeben..."
                    />
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <Label className="font-semibold">Antwort</Label>
                    <FaqAnswerBlocks faqIndex={index} form={form} />
                  </div>

                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(index)}
                    className="w-full"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    FAQ entfernen
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {fields.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <HelpCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
            <p>Noch keine FAQs hinzugefügt</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const FaqAnswerBlocks: React.FC<{ faqIndex: number; form: UseFormReturn<FieldValues> }> = ({ faqIndex, form }) => {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: `faq.${faqIndex}.answer`,
  });

  const generateBlockId = (prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  return (
    <div className="space-y-3">
      {fields.map((field, blockIndex) => {
        const block = form.watch(`faq.${faqIndex}.answer.${blockIndex}`) as ContentBlock;
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

              {block.type === 'text' && (
                <div>
                  <MarkdownEditor
                    content={form.watch(`faq.${faqIndex}.answer.${blockIndex}.content`) || ''}
                    onChange={(content) =>
                      form.setValue(`faq.${faqIndex}.answer.${blockIndex}.content`, content)
                    }
                    placeholder="Antworttext mit Markdown-Formatierung..."
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
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          append({
            id: generateBlockId(`faq${faqIndex}-block`),
            type: 'text',
            content: '',
          } as ContentBlock)
        }
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Antwort-Block hinzufügen
      </Button>
    </div>
  );
};
