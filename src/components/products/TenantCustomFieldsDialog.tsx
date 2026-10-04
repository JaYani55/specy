import { useState } from 'react';
import { Braces, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { useTheme } from '@/contexts/ThemeContext';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  getTenantCustomFieldDefinitions,
  saveTenantCustomFieldDefinitions,
  type TenantCustomFieldDefinition,
  type TenantCustomFieldDefinitions,
  type TenantCustomFieldEntity,
  type TenantCustomFieldType,
} from '@/services/tenantCustomFieldsService';

interface DraftField extends TenantCustomFieldDefinition {
  draftId: string;
  key: string;
}

type DraftFieldSets = Record<TenantCustomFieldEntity, DraftField[]>;

const newDraftField = (): DraftField => ({
  draftId: crypto.randomUUID(),
  key: '',
  label: '',
  type: 'string',
  required: false,
  is_public: false,
});

const fieldsToDefinitions = (fields: DraftField[]): TenantCustomFieldDefinitions =>
  Object.fromEntries(fields.map(({ key, draftId: _draftId, ...definition }) => [key.trim(), definition]));

const definitionsToFields = (definitions: TenantCustomFieldDefinitions): DraftField[] =>
  Object.entries(definitions).map(([key, definition]) => ({ ...definition, key, draftId: crypto.randomUUID() }));

export function TenantCustomFieldsDialog() {
  const { language } = useTheme();
  const { activeTenantId } = useActiveWorkspace();
  const english = language === 'en';
  const [open, setOpen] = useState(false);
  const [activeType, setActiveType] = useState<TenantCustomFieldEntity>('product');
  const [fields, setFields] = useState<DraftFieldSets>({ product: [], event: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const loadDefinitions = async () => {
    if (!activeTenantId) return;
    setIsLoading(true);
    try {
      const [product, event] = await Promise.all([
        getTenantCustomFieldDefinitions(activeTenantId, 'product'),
        getTenantCustomFieldDefinitions(activeTenantId, 'event'),
      ]);
      setFields({ product: definitionsToFields(product), event: definitionsToFields(event) });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : english ? 'Custom field definitions could not be loaded.' : 'Eigene Felder konnten nicht geladen werden.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) void loadDefinitions();
  };

  const updateField = (entity: TenantCustomFieldEntity, draftId: string, patch: Partial<DraftField>) => {
    setFields((current) => ({
      ...current,
      [entity]: current[entity].map((field) => field.draftId === draftId ? { ...field, ...patch } : field),
    }));
  };

  const removeField = (entity: TenantCustomFieldEntity, draftId: string) => {
    setFields((current) => ({ ...current, [entity]: current[entity].filter((field) => field.draftId !== draftId) }));
  };

  const handleSave = async () => {
    if (!activeTenantId) return;
    const currentFields = fields[activeType];
    const incomplete = currentFields.find((field) => !field.key.trim() || !field.label.trim());
    if (incomplete) {
      toast.error(english ? 'Every field needs a key and a label.' : 'Jedes Feld benötigt einen Schlüssel und eine Bezeichnung.');
      return;
    }
    const definitions = fieldsToDefinitions(currentFields);
    if (Object.keys(definitions).length !== currentFields.length) {
      toast.error(english ? 'Field keys must be unique.' : 'Feldschlüssel müssen eindeutig sein.');
      return;
    }

    setIsSaving(true);
    try {
      await saveTenantCustomFieldDefinitions({ tenantId: activeTenantId, entityType: activeType, definitions });
      toast.success(english
        ? `${activeType === 'product' ? 'Product' : 'Event'} fields saved.`
        : `${activeType === 'product' ? 'Produktfelder' : 'Eventfelder'} gespeichert.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : english ? 'Custom fields could not be saved.' : 'Eigene Felder konnten nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderFieldList = (entity: TenantCustomFieldEntity) => (
    <div className="space-y-3">
      {fields[entity].length === 0 && (
        <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
          {english ? 'No custom fields defined.' : 'Noch keine eigenen Felder definiert.'}
        </p>
      )}
      {fields[entity].map((field) => (
        <div key={field.draftId} className="rounded-lg border bg-background p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px_auto]">
            <div className="space-y-1.5">
              <Label>{english ? 'JSON key' : 'JSON-Schlüssel'}</Label>
              <Input value={field.key} placeholder="registration_status" onChange={(event) => updateField(entity, field.draftId, { key: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{english ? 'Label' : 'Bezeichnung'}</Label>
              <Input value={field.label} placeholder={english ? 'Registration status' : 'Anmeldestatus'} onChange={(event) => updateField(entity, field.draftId, { label: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{english ? 'Type' : 'Datentyp'}</Label>
              <Select value={field.type} onValueChange={(value) => updateField(entity, field.draftId, { type: value as TenantCustomFieldType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="string">Text</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="boolean">Boolean</SelectItem>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="url">URL</SelectItem>
                  <SelectItem value="email">E-Mail</SelectItem>
                  <SelectItem value="json">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="ghost" size="icon" className="self-end text-destructive" aria-label={english ? 'Remove field' : 'Feld entfernen'} onClick={() => removeField(entity, field.draftId)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <div className="space-y-1.5">
              <Label>{english ? 'Help text (optional)' : 'Hilfetext (optional)'}</Label>
              <Input value={field.description ?? ''} onChange={(event) => updateField(entity, field.draftId, { description: event.target.value })} />
            </div>
            <label className="flex items-center gap-2 self-end rounded-md px-2 py-2 text-sm">
              <Checkbox checked={Boolean(field.required)} onCheckedChange={(checked) => updateField(entity, field.draftId, { required: checked === true })} />
              {english ? 'Required' : 'Pflichtfeld'}
            </label>
            <label className="flex items-center gap-2 self-end rounded-md px-2 py-2 text-sm">
              <Checkbox checked={field.is_public === true} onCheckedChange={(checked) => updateField(entity, field.draftId, { is_public: checked === true })} />
              {english ? 'Include in public API' : 'In öffentlicher API ausgeben'}
            </label>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={() => setFields((current) => ({ ...current, [entity]: [...current[entity], newDraftField()] }))}>
        <Plus className="mr-2 h-4 w-4" />{english ? 'Add field' : 'Feld hinzufügen'}
      </Button>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={!activeTenantId}>
          <Braces className="mr-2 h-4 w-4" />{english ? 'Custom fields' : 'Eigene Felder'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{english ? 'Workspace custom fields' : 'Eigene Workspace-Felder'}</DialogTitle>
          <DialogDescription>
            {english
              ? 'Define JSON fields for products and events. Public fields are included in the dynamic product API.'
              : 'Definiere JSON-Felder für Produkte und Events. Öffentlich markierte Felder werden in der dynamischen Produkt-API ausgegeben.'}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10"><Loader2 className="h-5 w-5 animate-spin" />{english ? 'Loading fields…' : 'Felder werden geladen…'}</div>
        ) : (
          <Tabs value={activeType} onValueChange={(value) => setActiveType(value as TenantCustomFieldEntity)}>
            <TabsList>
              <TabsTrigger value="product">{english ? 'Products' : 'Produkte'}</TabsTrigger>
              <TabsTrigger value="event">Events</TabsTrigger>
            </TabsList>
            <TabsContent value="product">{renderFieldList('product')}</TabsContent>
            <TabsContent value="event">{renderFieldList('event')}</TabsContent>
          </Tabs>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>{english ? 'Close' : 'Schließen'}</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={!activeTenantId || isLoading || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {english ? `Save ${activeType} fields` : `${activeType === 'product' ? 'Produktfelder' : 'Eventfelder'} speichern`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
