import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Braces } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { TenantCustomFieldDefinitions } from '@/services/tenantCustomFieldsService';

interface TenantCustomFieldsEditorProps {
  definitions: TenantCustomFieldDefinitions;
  values: Record<string, unknown>;
  language: string;
  onChange: (values: Record<string, unknown>) => void;
  onValidityChange?: (valid: boolean) => void;
}

const jsonDraft = (value: unknown): string => value === undefined ? '{}' : JSON.stringify(value, null, 2);

export function TenantCustomFieldsEditor({
  definitions,
  values,
  language,
  onChange,
  onValidityChange,
}: TenantCustomFieldsEditorProps) {
  const english = language === 'en';
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(definitions).filter(([, definition]) => definition.type === 'json')
      .map(([key]) => [key, jsonDraft(values[key])]),
  ));
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  const validityCallback = useRef(onValidityChange);
  validityCallback.current = onValidityChange;

  useEffect(() => {
    validityCallback.current?.(Object.keys(jsonErrors).length === 0);
  }, [jsonErrors]);

  const setValue = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  if (Object.keys(definitions).length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Braces className="h-5 w-5" />
          {english ? 'Custom fields' : 'Eigene Felder'}
        </CardTitle>
        <CardDescription>
          {english ? 'Additional workspace-defined product and event data.' : 'Zusätzliche, für diesen Workspace definierte Produkt- und Eventdaten.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {Object.entries(definitions).map(([key, definition]) => {
          const id = `custom-field-${key}`;
          const label = definition.label || key;
          if (definition.type === 'boolean') {
            return (
              <div key={key} className="flex items-center gap-3 rounded-md border p-3">
                <Checkbox id={id} checked={values[key] === true} onCheckedChange={(checked) => setValue(key, checked === true)} />
                <Label htmlFor={id} className="cursor-pointer">
                  {label}{definition.required && <span className="ml-1 text-destructive">*</span>}
                  {definition.description && <span className="mt-1 block text-xs font-normal text-muted-foreground">{definition.description}</span>}
                </Label>
              </div>
            );
          }

          if (definition.type === 'json') {
            return (
              <div key={key} className="space-y-2 sm:col-span-2">
                <Label htmlFor={id}>{label}{definition.required && <span className="ml-1 text-destructive">*</span>}</Label>
                {definition.description && <p className="text-xs text-muted-foreground">{definition.description}</p>}
                <Textarea
                  id={id}
                  value={jsonDrafts[key] ?? jsonDraft(values[key])}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setJsonDrafts((current) => ({ ...current, [key]: raw }));
                    try {
                      const parsed = JSON.parse(raw) as unknown;
                      setValue(key, parsed);
                      setJsonErrors((current) => { const next = { ...current }; delete next[key]; return next; });
                    } catch {
                      setJsonErrors((current) => ({ ...current, [key]: english ? 'Enter valid JSON.' : 'Gib gültiges JSON ein.' }));
                    }
                  }}
                  className="font-mono text-sm"
                  rows={5}
                />
                {jsonErrors[key] && <p className="flex items-center gap-1 text-xs text-destructive"><AlertCircle className="h-3 w-3" />{jsonErrors[key]}</p>}
              </div>
            );
          }

          const inputType = definition.type === 'number' ? 'number'
            : definition.type === 'date' ? 'date'
              : definition.type === 'email' ? 'email'
                : definition.type === 'url' ? 'url' : 'text';
          return (
            <div key={key} className="space-y-2">
              <Label htmlFor={id}>{label}{definition.required && <span className="ml-1 text-destructive">*</span>}</Label>
              {definition.description && <p className="text-xs text-muted-foreground">{definition.description}</p>}
              <Input
                id={id}
                type={inputType}
                value={values[key] == null ? '' : String(values[key])}
                onChange={(event) => setValue(key, definition.type === 'number'
                  ? event.target.value === '' ? undefined : Number(event.target.value)
                  : event.target.value)}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
