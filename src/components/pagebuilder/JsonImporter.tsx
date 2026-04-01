import React, { useState, useCallback, useRef } from 'react';
import { FileJson, AlertTriangle, CheckCircle2, Info, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SchemaFieldDefinition } from '@/types/pagebuilder';

// ─── Validation Logic ─────────────────────────────────────────────────────────

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  parsed: Record<string, unknown> | null;
}

function validateJsonAgainstSchema(
  raw: string,
  fields: SchemaFieldDefinition[],
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      valid: false,
      errors: [(e as SyntaxError).message],
      warnings: [],
      parsed: null,
    };
  }

  // 2. Must be a plain object
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      valid: false,
      errors: ['JSON muss ein Objekt sein (kein Array, kein primitiver Wert).'],
      warnings: [],
      parsed: null,
    };
  }

  const obj = parsed as Record<string, unknown>;
  const knownKeys = new Set(fields.map((f) => f.name));

  // 3. Warn about unknown keys
  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      warnings.push(`Unbekanntes Feld "${key}" — wird ignoriert.`);
    }
  }

  // 4. Type checks for each schema field
  for (const field of fields) {
    if (!(field.name in obj)) {
      if (field.required) {
        errors.push(`Pflichtfeld "${field.name}" fehlt.`);
      }
      continue;
    }
    const val = obj[field.name];
    checkFieldType(field, val, field.name, errors, warnings);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    parsed: errors.length === 0 ? obj : null,
  };
}

function checkFieldType(
  field: SchemaFieldDefinition,
  val: unknown,
  path: string,
  errors: string[],
  warnings: string[],
) {
  if (val === null || val === undefined) return; // let empty values through

  switch (field.type) {
    case 'string':
    case 'media':
      if (typeof val !== 'string') {
        errors.push(`"${path}" erwartet einen String, erhalten: ${typeof val}.`);
      }
      if (field.enum && typeof val === 'string' && !field.enum.includes(val)) {
        errors.push(
          `"${path}" muss einer der Werte sein: ${field.enum.map((e) => `"${e}"`).join(', ')}. Erhalten: "${val}".`,
        );
      }
      break;

    case 'number':
      if (typeof val !== 'number') {
        errors.push(`"${path}" erwartet eine Zahl, erhalten: ${typeof val}.`);
      }
      break;

    case 'boolean':
      if (typeof val !== 'boolean') {
        errors.push(`"${path}" erwartet true/false, erhalten: ${typeof val}.`);
      }
      break;

    case 'array':
      if (!Array.isArray(val)) {
        errors.push(`"${path}" erwartet ein Array, erhalten: ${typeof val}.`);
      } else if (field.items) {
        (val as unknown[]).forEach((item, idx) => {
          checkFieldType(field.items!, item, `${path}[${idx}]`, errors, warnings);
        });
      }
      break;

    case 'ContentBlock[]':
      if (!Array.isArray(val)) {
        errors.push(`"${path}" erwartet ein Array (ContentBlock[]), erhalten: ${typeof val}.`);
      } else {
        const validTypes = ['text', 'heading', 'image', 'quote', 'list', 'video'];
        (val as unknown[]).forEach((block, idx) => {
          if (typeof block !== 'object' || block === null || Array.isArray(block)) {
            errors.push(`"${path}[${idx}]" muss ein Objekt sein.`);
            return;
          }
          const b = block as Record<string, unknown>;
          if (!b.id || typeof b.id !== 'string') {
            warnings.push(
              `"${path}[${idx}]" hat kein gültiges "id"-Feld — wird beim Import automatisch gesetzt.`,
            );
          }
          if (!b.type || !validTypes.includes(b.type as string)) {
            errors.push(
              `"${path}[${idx}].type" muss einer sein von: ${validTypes.join(', ')}. Erhalten: "${b.type}".`,
            );
          }
        });
      }
      break;

    case 'CodeBlock[]':
      if (!Array.isArray(val)) {
        errors.push(`"${path}" erwartet ein Array (CodeBlock[]), erhalten: ${typeof val}.`);
      } else {
        (val as unknown[]).forEach((block, idx) => {
          if (typeof block !== 'object' || block === null || Array.isArray(block)) {
            errors.push(`"${path}[${idx}]" muss ein Objekt sein.`);
            return;
          }
          const codeBlock = block as Record<string, unknown>;
          if (!codeBlock.id || typeof codeBlock.id !== 'string') {
            warnings.push(
              `"${path}[${idx}]" hat kein gültiges "id"-Feld — wird beim Import automatisch gesetzt.`,
            );
          }
          if ('language' in codeBlock && typeof codeBlock.language !== 'string') {
            errors.push(`"${path}[${idx}].language" erwartet einen String.`);
          }
          if ('code' in codeBlock && typeof codeBlock.code !== 'string') {
            errors.push(`"${path}[${idx}].code" erwartet einen String.`);
          }
          if ('frameworks' in codeBlock && !Array.isArray(codeBlock.frameworks)) {
            errors.push(`"${path}[${idx}].frameworks" erwartet ein Array von Strings.`);
          }
          if (Array.isArray(codeBlock.frameworks)) {
            codeBlock.frameworks.forEach((framework, frameworkIndex) => {
              if (typeof framework !== 'string') {
                errors.push(
                  `"${path}[${idx}].frameworks[${frameworkIndex}]" erwartet einen String.`,
                );
              }
            });
          }
          if (field.items?.properties) {
            for (const property of field.items.properties) {
              if (property.name in codeBlock) {
                checkFieldType(
                  property,
                  codeBlock[property.name],
                  `${path}[${idx}].${property.name}`,
                  errors,
                  warnings,
                );
              } else if (property.required) {
                errors.push(`Pflichtfeld "${path}[${idx}].${property.name}" fehlt.`);
              }
            }
          }
        });
      }
      break;

    case 'object':
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        errors.push(`"${path}" erwartet ein Objekt, erhalten: ${typeof val}.`);
      } else if (field.properties) {
        const nested = val as Record<string, unknown>;
        for (const prop of field.properties) {
          if (prop.name in nested) {
            checkFieldType(prop, nested[prop.name], `${path}.${prop.name}`, errors, warnings);
          } else if (prop.required) {
            errors.push(`Pflichtfeld "${path}.${prop.name}" fehlt.`);
          }
        }
      }
      break;
  }
}

/** Ensure every ContentBlock has a valid `id`. Mutates in place and returns the same array. */
function ensureBlockIds(obj: Record<string, unknown>, fields: SchemaFieldDefinition[]) {
  for (const field of fields) {
    if (field.type === 'ContentBlock[]' && Array.isArray(obj[field.name])) {
      obj[field.name] = (obj[field.name] as Record<string, unknown>[]).map((block) => ({
        ...block,
        id:
          block.id ||
          `${field.name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      }));
    }
    if (field.type === 'CodeBlock[]' && Array.isArray(obj[field.name])) {
      obj[field.name] = (obj[field.name] as Record<string, unknown>[]).map((block) => ({
        ...block,
        id:
          block.id ||
          `${field.name}-code-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      }));
    }
    if (field.type === 'object' && field.properties && typeof obj[field.name] === 'object') {
      ensureBlockIds(obj[field.name] as Record<string, unknown>, field.properties);
    }
    if (field.type === 'array' && Array.isArray(obj[field.name]) && field.items?.type === 'object' && field.items.properties) {
      obj[field.name] = (obj[field.name] as Record<string, unknown>[]).map((item) => {
        ensureBlockIds(item, field.items!.properties!);
        return item;
      });
    }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

interface JsonImporterProps {
  fields: SchemaFieldDefinition[];
  onImport: (data: Record<string, unknown>) => void;
}

const PLACEHOLDER = `{
  "title": "Mein Blogeintrag",
  "content": [
    { "id": "block-1", "type": "text", "content": "Einführungstext..." }
  ]
}`;

export const JsonImporter: React.FC<JsonImporterProps> = ({ fields, onImport }) => {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState('');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = useCallback(
    (value: string) => {
      setRaw(value);
      if (value.trim() === '') {
        setResult(null);
        return;
      }
      setResult(validateJsonAgainstSchema(value, fields));
    },
    [fields],
  );

  const handleImport = () => {
    if (!result?.parsed) return;
    const data = structuredClone(result.parsed);
    ensureBlockIds(data, fields);
    onImport(data);
    setOpen(false);
    setRaw('');
    setResult(null);
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) {
      setRaw('');
      setResult(null);
    }
  };

  const statusColor =
    raw.trim() === ''
      ? 'border-input'
      : result?.valid
        ? 'border-green-400 dark:border-green-600'
        : 'border-destructive';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground gap-2"
        >
          <FileJson className="h-4 w-4" />
          Import via JSON
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5" />
            Import via JSON
          </DialogTitle>
          <DialogDescription>
            Füge valides JSON ein, das dem Schema entspricht. Die Felder werden in den Editor geladen — du kannst sie danach noch bearbeiten.
          </DialogDescription>
        </DialogHeader>

        {/* Textarea */}
        <div className="space-y-2">
          <Textarea
            ref={textareaRef}
            value={raw}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={PLACEHOLDER}
            className={`font-mono text-sm h-64 resize-none transition-colors ${statusColor}`}
            spellCheck={false}
          />

          {/* Live status badge */}
          <div className="flex items-center gap-2 min-h-[1.5rem]">
            {raw.trim() === '' && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                Warte auf Eingabe…
              </span>
            )}
            {raw.trim() !== '' && result?.valid && (
              <Badge variant="outline" className="text-green-700 border-green-400 dark:text-green-400 gap-1 text-xs">
                <CheckCircle2 className="h-3 w-3" />
                Gültiges JSON · Schema-konform
              </Badge>
            )}
            {raw.trim() !== '' && !result?.valid && (
              <Badge variant="destructive" className="gap-1 text-xs">
                <AlertTriangle className="h-3 w-3" />
                {result?.errors.length === 1 ? '1 Fehler' : `${result?.errors.length ?? 0} Fehler`}
              </Badge>
            )}
          </div>
        </div>

        {/* Errors & Warnings */}
        {result && (result.errors.length > 0 || result.warnings.length > 0) && (
          <ScrollArea className="max-h-40 rounded-md border bg-muted/30 px-3 py-2">
            <div className="space-y-1">
              {result.errors.map((err, i) => (
                <p key={`e-${i}`} className="text-xs text-destructive flex items-start gap-1.5">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  {err}
                </p>
              ))}
              {result.warnings.map((warn, i) => (
                <p key={`w-${i}`} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                  <Info className="h-3 w-3 mt-0.5 shrink-0" />
                  {warn}
                </p>
              ))}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Abbrechen
          </Button>
          <Button
            type="button"
            onClick={handleImport}
            disabled={!result?.valid}
            className="gap-2"
          >
            <Upload className="h-4 w-4" />
            In Editor laden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
