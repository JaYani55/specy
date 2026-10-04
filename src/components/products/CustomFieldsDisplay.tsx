import { Braces } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TenantCustomFieldDefinitions } from '@/services/tenantCustomFieldsService';

export function CustomFieldsDisplay({
  definitions,
  values,
  language,
}: {
  definitions: TenantCustomFieldDefinitions;
  values: Record<string, unknown> | null | undefined;
  language: string;
}) {
  const entries = Object.entries(definitions).filter(([key]) =>
    values && Object.prototype.hasOwnProperty.call(values, key));
  if (!entries.length) return null;
  const english = language === 'en';

  return (
    <Card className="p-5">
      <CardHeader className="p-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Braces className="h-4 w-4" />{english ? 'Custom fields' : 'Eigene Felder'}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 p-0 sm:grid-cols-2">
        {entries.map(([key, definition]) => {
          const value = values?.[key];
          const text = value !== null && typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : value === null ? 'null' : String(value);
          return (
            <div key={key} className="min-w-0 space-y-1">
              <p className="text-sm font-medium">{definition.label || key}</p>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">{text}</pre>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
