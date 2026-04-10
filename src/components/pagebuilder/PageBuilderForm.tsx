import React, { useState } from 'react';
import { useForm, type UseFormReturn, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Form } from '@/components/ui/form';
import { PageBuilderData, PageSchema } from '@/types/pagebuilder';
import { CtaForm } from './CtaForm';
import { FaqForm } from './FaqForm';
import { HeroForm } from './HeroForm';
import { CardsForm } from './CardsForm';
import { FeaturesForm } from './FeaturesForm';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { saveProductPage } from '@/services/productPageService';
import { toast } from 'sonner';
import { Save, Eye, Loader2, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { SchemaPageBuilderForm } from './SchemaPageBuilderForm';

const ContentBlockSchema = z.union([
  z.object({
    id: z.string(),
    type: z.literal('text'),
    content: z.string(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('heading'),
    content: z.string(),
    level: z.enum(['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6']),
  }),
  z.object({
    id: z.string(),
    type: z.literal('image'),
    src: z.string(),
    alt: z.string(),
    caption: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('quote'),
    text: z.string(),
    author: z.string().optional(),
    source: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('list'),
    style: z.enum(['ordered', 'unordered']),
    items: z.array(z.string()),
  }),
  z.object({
    id: z.string(),
    type: z.literal('video'),
    src: z.string(),
    provider: z.enum(['youtube', 'vimeo', 'other']),
    caption: z.string().optional(),
  }),
  z.object({
    id: z.string(),
    type: z.literal('form'),
    form_id: z.string(),
    form_slug: z.string(),
    form_name: z.string(),
    share_slug: z.string().optional(),
    requires_auth: z.boolean().optional(),
  }),
]);

const PageBuilderSchema = z.object({
  cta: z.object({
    title: z.string(),
    description: z.string(),
    primaryButton: z.string(),
  }),
  faq: z.array(z.object({
    question: z.string(),
    answer: z.array(ContentBlockSchema),
  })),
  hero: z.object({
    image: z.string(),
    stats: z.array(z.object({
      label: z.string(),
      value: z.string(),
    })),
    title: z.string(),
    description: z.array(ContentBlockSchema),
  }),
  cards: z.array(z.object({
    icon: z.string(),
    color: z.string(),
    items: z.array(z.string()).optional(),
    content: z.array(z.union([
      ContentBlockSchema,
      z.object({
        type: z.literal('bullet-point'),
        id: z.string(),
        text: z.string(),
      }),
    ])).optional(),
    title: z.string(),
    description: z.string(),
  })),
  features: z.array(z.object({
    title: z.string(),
    description: z.array(ContentBlockSchema),
    reverse: z.boolean().optional(),
    alignment: z.enum(['left', 'center', 'right']).optional(),
  })),
  subtitle: z.string().optional(),
  'trainer-module': z.boolean().optional(),
});

interface PageBuilderFormProps {
  initialData?: PageBuilderData | null;
  productId?: string;
  productName?: string;
  productSlug?: string;
  productStatus?: 'draft' | 'published' | 'archived';
  schema?: PageSchema;
  schemaSlug?: string;
}

export const PageBuilderForm: React.FC<PageBuilderFormProps> = ({ initialData, productId, productName, productSlug, productStatus, schema, schemaSlug }) => {
  // All hooks must be declared unconditionally (Rules of Hooks).
  // Schema-driven rendering delegates to SchemaPageBuilderForm below.
  const [isSaving, setIsSaving] = useState(false);
  const [savedSlug, setSavedSlug] = useState<string | null>(null);
  const [pageName, setPageName] = useState(productName || '');

  const form = useForm<PageBuilderData>({
    resolver: zodResolver(PageBuilderSchema),
    defaultValues: initialData || {
      cta: { title: '', description: '', primaryButton: '' },
      faq: [],
      hero: { image: '', stats: [], title: '', description: [] },
      cards: [],
      features: [],
      subtitle: '',
      'trainer-module': false,
    },
  });

  // ── Schema-driven mode: delegate entirely to SchemaPageBuilderForm ──────────
  if (schema && schemaSlug) {
    return (
      <SchemaPageBuilderForm
        schema={schema}
        schemaSlug={schemaSlug}
        pageId={productId}
        initialData={initialData as unknown as Record<string, unknown> | null}
        initialName={productName}
        initialSlug={productSlug}
        initialStatus={productStatus}
      />
    );
  }

  // ── Legacy mode only below this line ──────────────────────────────────────
  const onSubmit = async (data: PageBuilderData) => {
    setIsSaving(true);
    try {
      if (!productId || !productName) {
        toast.error('Product ID or name is missing.');
        return;
      }
      const result = await saveProductPage(productId, data, productName);
      setSavedSlug(result.slug);
      toast.success('Product page saved successfully!');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler beim Speichern.';
      toast.error(`Failed to save: ${message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 max-w-5xl mx-auto pb-20">

        {/* Hero Section */}
        <HeroForm form={form} />

        {/* Features Section */}
        <FeaturesForm form={form as unknown as UseFormReturn<FieldValues>} />

        {/* Cards Section */}
        <CardsForm form={form as unknown as UseFormReturn<FieldValues>} />

        {/* FAQ Section */}
        <FaqForm form={form as unknown as UseFormReturn<FieldValues>} />

        {/* CTA Section */}
        <CtaForm form={form} />

        {/* General Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <span>⚙️</span>
              <span>Allgemeine Einstellungen</span>
            </CardTitle>
            <CardDescription>
              Zusätzliche Informationen und Optionen
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="subtitle" className="text-base font-semibold">
                Untertitel
              </Label>
              <Input
                id="subtitle"
                {...form.register('subtitle')}
                placeholder="Zusätzliche Beschreibung oder Tagline"
              />
            </div>

            <Separator />

            <div className="flex items-center space-x-2 p-3 border rounded-lg bg-muted/30">
              <Checkbox
                id="trainer-module"
                checked={form.watch('trainer-module') || false}
                onCheckedChange={(checked) =>
                  form.setValue('trainer-module', checked as boolean)
                }
              />
              <Label htmlFor="trainer-module" className="cursor-pointer">
                Trainer-Modul aktivieren
              </Label>
            </div>
          </CardContent>
        </Card>

        {/* Preview Link Alert */}
        {savedSlug && (
          <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
            <Eye className="h-4 w-4 text-green-600" />
            <AlertDescription className="flex items-center justify-between">
              <span className="text-green-800 dark:text-green-200">
                Produktseite erfolgreich gespeichert!
              </span>
              <Button variant="outline" size="sm" asChild className="ml-4">
                <a href={`/${savedSlug}`} target="_blank" rel="noopener noreferrer" className="flex items-center">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Vorschau ansehen
                </a>
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Submit Button - Fixed at bottom */}
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-t z-50">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Produkt: <span className="font-semibold">{productName}</span>
            </p>
            <Button type="submit" size="lg" disabled={isSaving} className="min-w-[200px]">
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Wird gespeichert...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Speichern & Vorschau
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  );
};
