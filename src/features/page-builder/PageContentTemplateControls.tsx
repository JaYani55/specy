import { useState } from 'react';
import { CopyPlus, FileStack, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  listPageContentTemplates,
  savePageContentTemplate,
  type PageContentTemplate,
} from '@/services/pageContentTemplateService';

interface PageContentTemplateControlsProps {
  schemaId: string;
  tenantId: string | null;
  pageName: string;
  content: Record<string, unknown>;
  language: string;
  onApply: (content: Record<string, unknown>) => void;
}

export function PageContentTemplateControls({
  schemaId,
  tenantId,
  pageName,
  content,
  language,
  onApply,
}: PageContentTemplateControlsProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templates, setTemplates] = useState<PageContentTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const english = language === 'en';

  const openLoadDialog = async () => {
    setLoadOpen(true);
    setIsLoadingTemplates(true);
    setLoadError(null);
    try {
      setTemplates(await listPageContentTemplates(schemaId, tenantId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not load templates.');
    } finally {
      setIsLoadingTemplates(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const template = await savePageContentTemplate({
        schemaId,
        tenantId,
        name: templateName,
        content,
      });
      toast.success(english ? `Template “${template.name}” saved.` : `Vorlage „${template.name}“ gespeichert.`);
      setSaveOpen(false);
      setTemplateName('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : english ? 'Could not save the template.' : 'Die Vorlage konnte nicht gespeichert werden.');
    } finally {
      setIsSaving(false);
    }
  };

  const applyTemplate = (template: PageContentTemplate) => {
    onApply(template.content);
    setLoadOpen(false);
    toast.success(english ? `Template “${template.name}” loaded.` : `Vorlage „${template.name}“ geladen.`);
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-5 py-4">
        <div className="space-y-1">
          <h2 className="font-semibold">{english ? 'Page content templates' : 'Inhaltsvorlagen'}</h2>
          <p className="text-sm text-muted-foreground">
            {english
              ? 'Reuse content from another page in this schema. Event dates, times, and scheduling details are not copied.'
              : 'Übernimm Inhalte einer anderen Seite dieses Schemas. Datum, Uhrzeit und weitere Termindaten werden nicht kopiert.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => { setTemplateName(''); setSaveOpen(true); }}>
            <CopyPlus className="mr-2 h-4 w-4" />
            {english ? 'Save as template' : 'Als Vorlage speichern'}
          </Button>
          <Button type="button" variant="outline" onClick={() => void openLoadDialog()}>
            <FileStack className="mr-2 h-4 w-4" />
            {english ? 'Load template' : 'Vorlage laden'}
          </Button>
        </div>
      </div>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{english ? 'Save page content as a template' : 'Seiteninhalt als Vorlage speichern'}</DialogTitle>
            <DialogDescription>
              {english
                ? 'The template is available to pages using this schema. It stores content fields only.'
                : 'Die Vorlage steht für Seiten dieses Schemas bereit und enthält nur die Inhaltsfelder.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="page-template-name" className="text-sm font-medium">
              {english ? 'Template name' : 'Name der Vorlage'}
            </label>
            <Input
              id="page-template-name"
              autoFocus
              maxLength={120}
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder={pageName || (english ? 'e.g. Standard workshop' : 'z. B. Standard-Workshop')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && templateName.trim() && !isSaving) void handleSave();
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveOpen(false)} disabled={isSaving}>
              {english ? 'Cancel' : 'Abbrechen'}
            </Button>
            <Button type="button" onClick={() => void handleSave()} disabled={!templateName.trim() || isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {english ? 'Save template' : 'Vorlage speichern'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{english ? 'Load a page template' : 'Inhaltsvorlage laden'}</DialogTitle>
            <DialogDescription>
              {english
                ? 'Choose a saved template for this schema. The current page title and event schedule stay unchanged.'
                : 'Wähle eine gespeicherte Vorlage für dieses Schema. Seitentitel und Veranstaltungstermin bleiben unverändert.'}
            </DialogDescription>
          </DialogHeader>
          {isLoadingTemplates ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {english ? 'Loading templates…' : 'Vorlagen werden geladen…'}
            </div>
          ) : loadError ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{loadError}</p>
          ) : templates.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {english ? 'No templates have been saved for this schema yet.' : 'Für dieses Schema wurden noch keine Vorlagen gespeichert.'}
            </p>
          ) : (
            <ScrollArea className="max-h-80 pr-3">
              <div className="space-y-2">
                {templates.map((template) => (
                  <Button
                    key={template.id}
                    type="button"
                    variant="outline"
                    className="h-auto w-full justify-start py-3 text-left"
                    onClick={() => applyTemplate(template)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{template.name}</span>
                      <span className="mt-1 block text-xs font-normal text-muted-foreground">
                        {new Intl.DateTimeFormat(english ? 'en' : 'de', { dateStyle: 'medium' }).format(new Date(template.updated_at))}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
