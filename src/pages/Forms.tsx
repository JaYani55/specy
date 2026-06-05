import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, ExternalLink, FilePlus2, Loader2, MessageSquare, Pencil, Trash2, BarChart4 } from 'lucide-react';
import { toast } from 'sonner';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/contexts/ThemeContext';
import { deleteForm, getForms } from '@/services/formService';
import { getVisibleTenantInfoMap } from '@/services/tenantService';
import type { FormRecord } from '@/types/forms';
import { buildFormSharePath } from '@/utils/sharePaths';

const statusVariant: Record<FormRecord['status'], 'default' | 'secondary' | 'destructive'> = {
  published: 'default',
  archived: 'destructive',
};

const Forms = () => {
  const navigate = useNavigate();
  const { language } = useTheme();
  const [forms, setForms] = useState<FormRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tenantInfo, setTenantInfo] = useState<Record<string, { name: string; slug: string }>>({});

  const loadForms = useCallback(async () => {
    try {
      setIsLoading(true);
      const records = await getForms();
      setForms(records);
      setTenantInfo(await getVisibleTenantInfoMap(records.map((form) => form.tenant_id)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load forms.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  const handleArchive = async (formId: string) => {
    const confirmed = window.confirm(
      language === 'en' ? 'Archive this form?' : 'Dieses Formular archivieren?'
    );
    if (!confirmed) return;

    try {
      await deleteForm(formId);
      toast.success(language === 'en' ? 'Form archived.' : 'Formular archiviert.');
      await loadForms();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to archive form.');
    }
  };

  const emptyState = (
    <AdminCard className="border-dashed">
      <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 text-center">
        <ClipboardList className="h-12 w-12 text-muted-foreground" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">
            {language === 'en' ? 'No forms yet' : 'Noch keine Formulare'}
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            {language === 'en'
              ? 'Create the first form, define its JSON schema, and publish it for page embeds, share links, or agent APIs.'
              : 'Erstelle das erste Formular, definiere das JSON-Schema und veröffentliche es für Seiten-Einbettungen, Share-Links oder Agent-APIs.'}
          </p>
        </div>
        <Button onClick={() => navigate('/forms/new')}>
          <FilePlus2 className="mr-2 h-4 w-4" />
          {language === 'en' ? 'Create form' : 'Formular erstellen'}
        </Button>
        <Button variant="outline" onClick={() => navigate('/forms/new?type=poll')}>
          <FilePlus2 className="mr-2 h-4 w-4" />
          {language === 'en' ? 'Create poll' : 'Umfrage erstellen'}
        </Button>
      </div>
    </AdminCard>
  );

  return (
    <AdminPageLayout
      title={language === 'en' ? 'Forms' : 'Formulare'}
      description={language === 'en'
        ? 'Author reusable forms, publish direct share links, and review submitted answers.'
        : 'Erstelle wiederverwendbare Formulare, veröffentliche direkte Share-Links und prüfe eingegangene Antworten.'}
      icon={ClipboardList}
      actions={(
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate('/forms/new?type=poll')}>
            <FilePlus2 className="mr-2 h-4 w-4" />
            {language === 'en' ? 'New Poll' : 'Neue Umfrage'}
          </Button>
          <Button onClick={() => navigate('/forms/new')}>
            <FilePlus2 className="mr-2 h-4 w-4" />
            {language === 'en' ? 'New Form' : 'Neues Formular'}
          </Button>
        </div>
      )}
    >
      {isLoading ? (
        <AdminCard className="flex min-h-[280px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </AdminCard>
      ) : forms.length === 0 ? (
        emptyState
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {forms.map((form) => {
            const currentTenantInfo = form.tenant_id ? tenantInfo[form.tenant_id] : undefined;
            const sharePath = form.share_enabled && form.share_slug && currentTenantInfo
              ? buildFormSharePath(currentTenantInfo.slug, form.share_slug)
              : null;
            
            const resultsPath = sharePath ? `${sharePath}/results` : null;

            return (
              <AdminCard
                key={form.id}
                title={form.name}
                icon={form.type === 'poll' ? BarChart4 : ClipboardList}
                iconColor={form.type === 'poll' ? "from-blue-500 to-cyan-600" : "from-emerald-500 to-teal-600"}
                actions={(
                  <Badge variant={statusVariant[form.status]}>{form.status}</Badge>
                )}
              >
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {form.description || (language === 'en' ? 'No description yet.' : 'Noch keine Beschreibung.')}
                  </p>

                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">/{form.slug}</Badge>
                    {form.tenant_id && currentTenantInfo && (
                      <Badge variant="outline">{currentTenantInfo.name}</Badge>
                    )}
                    <Badge variant="outline">API {form.api_enabled ? 'on' : 'off'}</Badge>
                    <Badge variant="outline">{form.requires_auth ? (language === 'en' ? 'Auth required' : 'Mit Anmeldung') : (language === 'en' ? 'Public' : 'Öffentlich')}</Badge>
                    {form.type === 'poll' && (
                      <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-100 dark:bg-blue-950 dark:text-blue-300">
                        {language === 'en' ? 'Poll' : 'Umfrage'}
                      </Badge>
                    )}
                    {sharePath && (
                      <Badge variant="outline">{sharePath}</Badge>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/forms/${form.id}`}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {language === 'en' ? 'Edit' : 'Bearbeiten'}
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link to={`/forms/${form.id}/answers`}>
                        <MessageSquare className="mr-2 h-4 w-4" />
                        {language === 'en' ? 'Answers' : 'Antworten'}
                      </Link>
                    </Button>
                    {resultsPath && form.type === 'poll' && (
                      <Button asChild variant="outline" size="sm">
                        <a href={resultsPath} target="_blank" rel="noopener noreferrer">
                          <BarChart4 className="mr-2 h-4 w-4" />
                          {language === 'en' ? 'Results' : 'Ergebnisse'}
                        </a>
                      </Button>
                    )}
                    {sharePath && (
                      <Button asChild variant="outline" size="sm">
                        <a href={sharePath} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="mr-2 h-4 w-4" />
                          {language === 'en' ? 'Open' : 'Öffnen'}
                        </a>
                      </Button>
                    )}
                    <Button variant="destructive" size="sm" onClick={() => void handleArchive(form.id)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      {language === 'en' ? 'Archive' : 'Archivieren'}
                    </Button>
                  </div>
                </div>
              </AdminCard>
            );
          })}
        </div>
      )}
    </AdminPageLayout>
  );
};

export default Forms;