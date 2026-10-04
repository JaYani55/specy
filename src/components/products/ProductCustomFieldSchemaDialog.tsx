import { useState } from 'react';
import { Braces, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getTenantCustomFieldDefinitions, type TenantCustomFieldDefinition, type TenantCustomFieldDefinitions } from '@/services/tenantCustomFieldsService';
import { getProductCustomFieldSchema, saveProductCustomFieldSchema, validateProductCustomFieldSchema, type ProductCustomFieldSchema } from '@/services/productCustomFieldSchemaService';
import { supabase } from '@/lib/supabase';
import { getSchema, triggerRevalidation, type RevalidationResult } from '@/services/pageService';
import { RevalidationFeedback } from '@/components/revalidation/RevalidationFeedback';

type FieldArea = 'product' | 'event';
interface DraftField extends TenantCustomFieldDefinition {
  draftId: string;
  key: string;
  autoKey?: boolean;
}
type DraftFields = Record<FieldArea, DraftField[]>;

const slugKey = (value: string) => value.toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'feld';

const newField = (): DraftField => ({
  draftId: crypto.randomUUID(), key: '', label: '', type: 'string', required: false, is_public: false, autoKey: true,
});

const toDraftFields = (definitions: TenantCustomFieldDefinitions): DraftField[] =>
  Object.entries(definitions).map(([key, definition]) => ({ ...definition, key, draftId: crypto.randomUUID() }));

const toDefinitions = (fields: DraftField[]): TenantCustomFieldDefinitions => {
  const result: TenantCustomFieldDefinitions = {};
  for (const field of fields) {
    let key = field.autoKey ? slugKey(field.label) : field.key;
    const base = key;
    let suffix = 2;
    while (Object.prototype.hasOwnProperty.call(result, key)) key = `${base.slice(0, 60)}_${suffix++}`;
    result[key] = {
      label: field.label.trim(), type: field.type, required: Boolean(field.required), is_public: Boolean(field.is_public),
      ...(field.description?.trim() ? { description: field.description.trim() } : {}),
    };
  }
  return result;
};

interface ProductCustomFieldSchemaDialogProps {
  productId: string;
  tenantId: string;
  version: number;
  productName?: string;
  onSaved?: (schema: ProductCustomFieldSchema, version: number) => void;
}

export function ProductCustomFieldSchemaDialog({ productId, tenantId, version, productName, onSaved }: ProductCustomFieldSchemaDialogProps) {
  const [open, setOpen] = useState(false);
  const [activeArea, setActiveArea] = useState<FieldArea>('product');
  const [fields, setFields] = useState<DraftFields>({ product: [], event: [] });
  const [schema, setSchema] = useState<ProductCustomFieldSchema>({ product: {}, event: {} });
  const [workspaceFields, setWorkspaceFields] = useState<DraftFields>({ product: [], event: [] });
  const [currentVersion, setCurrentVersion] = useState(version);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [revalidationResult, setRevalidationResult] = useState<RevalidationResult | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const [productSchema, legacyProductFields, legacyEventFields] = await Promise.all([
        getProductCustomFieldSchema(productId, tenantId),
        getTenantCustomFieldDefinitions(tenantId, 'product'),
        getTenantCustomFieldDefinitions(tenantId, 'event'),
      ]);
      setSchema(productSchema.schema);
      setCurrentVersion(productSchema.version);
      setFields({ product: toDraftFields(productSchema.schema.product), event: toDraftFields(productSchema.schema.event) });
      setWorkspaceFields({ product: toDraftFields(legacyProductFields), event: toDraftFields(legacyEventFields) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Felddaten konnten nicht geladen werden.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) void load();
  };

  const updateField = (area: FieldArea, draftId: string, patch: Partial<DraftField>) => {
    setFields((current) => ({
      ...current,
      [area]: current[area].map((field) => field.draftId === draftId
        ? { ...field, ...patch, ...(field.autoKey && patch.label !== undefined ? { key: slugKey(patch.label) } : {}) }
        : field),
    }));
  };

  const importWorkspaceFields = (area: FieldArea) => {
    setFields((current) => {
      const existingKeys = new Set(current[area].map((field) => field.key));
      const imported = workspaceFields[area]
        .filter((field) => !existingKeys.has(field.key))
        .map((field) => ({ ...field, draftId: crypto.randomUUID(), autoKey: false }));
      if (!imported.length) toast.info('Es gibt keine zusätzlichen Workspace-Felder zum Übernehmen.');
      else toast.success(`${imported.length} Felder zur Produktdefinition hinzugefügt.`);
      return { ...current, [area]: [...current[area], ...imported] };
    });
  };

  const handleSave = async () => {
    const current = fields[activeArea];
    if (current.some((field) => !field.label.trim())) {
      toast.error('Jedes Feld braucht eine Bezeichnung.');
      return;
    }
    const nextSchema = { ...schema, [activeArea]: toDefinitions(current) };
    if (validateProductCustomFieldSchema(nextSchema)) {
      toast.error('Die Felddefinitionen sind ungültig. Prüfe die Bezeichnungen und Datentypen.');
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveProductCustomFieldSchema({ productId, tenantId, expectedVersion: currentVersion, schema: nextSchema });
      setSchema(result.schema);
      setCurrentVersion(result.version);
      setFields({ product: toDraftFields(result.schema.product), event: toDraftFields(result.schema.event) });
      onSaved?.(result.schema, result.version);
      toast.success(activeArea === 'product' ? 'Produktangaben gespeichert.' : 'Veranstaltungsangaben gespeichert.');
      setRevalidationResult(null);
      try {
        const { data: product, error: productError } = await supabase.from('mentorbooking_products')
          .select('product_page_id')
          .eq('integration_id', productId)
          .eq('tenant_id', tenantId)
          .maybeSingle();
        if (productError) throw productError;
        if (product?.product_page_id) {
          const { data: page, error: pageError } = await supabase.from('pages')
            .select('slug, schema_id, status')
            .eq('id', product.product_page_id)
            .eq('tenant_id', tenantId)
            .maybeSingle();
          if (pageError) throw pageError;
          if (page?.status === 'published') {
            const pageSchema = await getSchema(page.schema_id);
            if (pageSchema.tenant_id === tenantId && pageSchema.entity_kind === 'service-product' && pageSchema.registration_status === 'registered') {
              const revalidation = await triggerRevalidation(pageSchema.api_slug, page.slug);
              setRevalidationResult(revalidation);
              if (!revalidation.success) toast.warning('Angaben gespeichert, aber die Website konnte nicht aktualisiert werden.');
            }
          }
        }
      } catch (error) {
        console.error('Product field schema saved but website revalidation could not be checked:', error);
        const result: RevalidationResult = {
          success: false,
          message: 'Angaben gespeichert; die Website-Aktualisierung konnte nicht geprüft werden.',
          diagnostics: { error: error instanceof Error ? error.message : 'Unbekannter Fehler.' },
        };
        setRevalidationResult(result);
        toast.warning(result.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Die Angaben konnten nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderFields = (area: FieldArea) => (
    <div className="space-y-3">
      {fields[area].length === 0 && (
        <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
          {area === 'product' ? 'Für dieses Produkt gibt es noch keine eigenen Produktangaben.' : 'Für Veranstaltungen dieses Produkts gibt es noch keine zusätzlichen Angaben.'}
        </p>
      )}
      {fields[area].map((field) => (
        <div key={field.draftId} className="rounded-lg border bg-background p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
            <div className="space-y-1.5">
              <Label>Bezeichnung</Label>
              <Input value={field.label} placeholder={area === 'product' ? 'z. B. Zielgruppe' : 'z. B. Anmeldung'} onChange={(event) => updateField(area, field.draftId, { label: event.target.value })} />
              {field.autoKey && field.label.trim() && <p className="text-xs text-muted-foreground">Wird als „{slugKey(field.label)}“ gespeichert.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Datentyp</Label>
              <Select value={field.type} onValueChange={(value) => updateField(area, field.draftId, { type: value as TenantCustomFieldDefinition['type'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">Text</SelectItem>
                  <SelectItem value="number">Zahl</SelectItem>
                  <SelectItem value="boolean">Ja / Nein</SelectItem>
                  <SelectItem value="date">Datum</SelectItem>
                  <SelectItem value="price">Preis</SelectItem>
                  <SelectItem value="url">Webadresse</SelectItem>
                  <SelectItem value="email">E-Mail-Adresse</SelectItem>
                  <SelectItem value="json">Erweiterte Daten</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="ghost" size="icon" className="self-end text-destructive" aria-label="Feld entfernen" onClick={() => setFields((current) => ({ ...current, [area]: current[area].filter((item) => item.draftId !== field.draftId) }))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <div className="space-y-1.5">
              <Label>Hilfetext (optional)</Label>
              <Input value={field.description ?? ''} onChange={(event) => updateField(area, field.draftId, { description: event.target.value })} />
            </div>
            <label className="flex items-center gap-2 self-end rounded-md px-2 py-2 text-sm">
              <Checkbox checked={Boolean(field.required)} onCheckedChange={(checked) => updateField(area, field.draftId, { required: checked === true })} />
              Pflichtfeld
            </label>
            <label className="flex items-center gap-2 self-end rounded-md px-2 py-2 text-sm">
              <Checkbox checked={field.is_public === true} onCheckedChange={(checked) => updateField(area, field.draftId, { is_public: checked === true })} />
              <span>Öffentlich anzeigen <span className="block text-xs text-muted-foreground">Auf veröffentlichten Seiten sichtbar.</span></span>
            </label>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setFields((current) => ({ ...current, [area]: [...current[area], newField()] }))}>
          <Plus className="mr-2 h-4 w-4" />Feld hinzufügen
        </Button>
        {workspaceFields[area].length > 0 && (
          <Button type="button" variant="ghost" onClick={() => importWorkspaceFields(area)}>Workspace-Felder übernehmen…</Button>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Braces className="mr-2 h-4 w-4" />Eigene Angaben verwalten
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Angaben für „{productName || 'dieses Produkt'}“</DialogTitle>
          <DialogDescription>Lege fest, welche zusätzlichen Angaben zu diesem Produkt und seinen Veranstaltungen gehören. Öffentlich angezeigte Angaben können auf der Website erscheinen.</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10"><Loader2 className="h-5 w-5 animate-spin" />Angaben werden geladen…</div>
        ) : (
          <Tabs value={activeArea} onValueChange={(value) => setActiveArea(value as FieldArea)}>
            <TabsList><TabsTrigger value="product">Produkt</TabsTrigger><TabsTrigger value="event">Veranstaltungen</TabsTrigger></TabsList>
            <TabsContent value="product">{renderFields('product')}</TabsContent>
            <TabsContent value="event">{renderFields('event')}</TabsContent>
          </Tabs>
        )}
        {revalidationResult && !revalidationResult.success && (
          <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950">
            <AlertTitle>Angaben gespeichert; Website-Aktualisierung fehlgeschlagen</AlertTitle>
            <AlertDescription><RevalidationFeedback result={revalidationResult} language="de" /></AlertDescription>
          </Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>Schließen</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isLoading || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {activeArea === 'product' ? 'Produktangaben speichern' : 'Veranstaltungsangaben speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
