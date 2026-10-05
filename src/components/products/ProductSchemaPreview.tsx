import { useMemo } from 'react';
import { ExternalLink, Eye } from 'lucide-react';
import type { PageSchema } from '@/types/pagebuilder';
import { getProductSchemaDesign, type ProductSchemaDesignField } from '@/utils/productSchemaDesign';
import { useTheme } from '@/contexts/ThemeContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface ProductSchemaPreviewProps {
  schema: PageSchema;
  triggerLabel?: string;
  compact?: boolean;
}

function DesignField({ field, depth = 0, language }: {
  field: ProductSchemaDesignField;
  depth?: number;
  language: 'de' | 'en';
}) {
  return (
    <div className="space-y-2">
      <div className="rounded-md border p-3" style={{ marginLeft: `${depth * 16}px` }}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{field.name}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{field.type}</code>
          {field.required && <Badge variant="outline">{language === 'en' ? 'Required' : 'Pflichtfeld'}</Badge>}
        </div>
        {field.description && <p className="mt-1 text-sm text-muted-foreground">{field.description}</p>}
        {field.enumValues.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {language === 'en' ? 'Options' : 'Auswahl'}: {field.enumValues.join(', ')}
          </p>
        )}
      </div>
      {field.children.map((child) => (
        <DesignField key={`${field.name}.${child.name}`} field={child} depth={depth + 1} language={language} />
      ))}
    </div>
  );
}

export function ProductSchemaPreview({ schema, triggerLabel, compact = false }: ProductSchemaPreviewProps) {
  const { language } = useTheme();
  const fields = useMemo(() => getProductSchemaDesign(schema.schema ?? {}), [schema.schema]);
  const targets = (schema.frontend_targets ?? []).filter((target) => target.enabled);
  const frontendUrl = schema.frontend_url || schema.integration_requirements?.canonical_frontend_url;
  const isEnglish = language === 'en';

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant={compact ? 'ghost' : 'outline'} size="sm">
          <Eye className="mr-1.5 h-4 w-4" />
          {triggerLabel ?? (isEnglish ? 'View schema' : 'Schema ansehen')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{schema.name}</DialogTitle>
          <DialogDescription>
            {schema.description || (isEnglish ? 'Product page content schema.' : 'Inhaltsschema für Produktseiten.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-2 rounded-lg border p-4">
            <h3 className="font-medium">{isEnglish ? 'Website integration' : 'Website-Integration'}</h3>
            {frontendUrl ? (
              <a className="inline-flex items-center gap-1 text-sm text-primary hover:underline" href={frontendUrl} target="_blank" rel="noopener noreferrer">
                {frontendUrl}<ExternalLink className="h-3.5 w-3.5" />
              </a>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isEnglish ? 'No website address is connected yet.' : 'Es ist noch keine Website-Adresse verbunden.'}
              </p>
            )}
            {targets.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {targets.map((target) => (
                  <li key={target.id}>
                    {target.kind === 'detail-page'
                      ? (isEnglish ? 'Product page' : 'Produktseite')
                      : (isEnglish ? 'Catalogue placement' : 'Katalogplatzierung')}
                    {target.target_key ? ` · ${target.target_key}` : ''}: {target.host_path}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="font-medium">{isEnglish ? 'Product page structure' : 'Aufbau der Produktseite'}</h3>
              <p className="text-sm text-muted-foreground">
                {isEnglish
                  ? 'These fields define the product content. The connected website determines its visual appearance.'
                  : 'Diese Felder legen die Produktinhalte fest. Das visuelle Erscheinungsbild wird von der verbundenen Website bestimmt.'}
              </p>
            </div>
            {fields.length > 0 ? (
              <div className="space-y-2">
                {fields.map((field) => <DesignField key={field.name} field={field} language={isEnglish ? 'en' : 'de'} />)}
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                {isEnglish ? 'This schema does not define any content fields yet.' : 'Dieses Schema enthält noch keine Inhaltsfelder.'}
              </p>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
