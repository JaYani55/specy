import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box, ExternalLink, FilePlus2, Loader2, Lock, Pencil, Trash2, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/contexts/ThemeContext';
import { deleteObject, getObjects } from '@/services/objectService';
import { getVisibleTenantInfoMap } from '@/services/tenantService';
import type { ObjectRecord } from '@/types/objects';
import { buildObjectSharePath } from '@/utils/sharePaths';

const statusVariant: Record<ObjectRecord['status'], 'default' | 'secondary' | 'destructive'> = {
  published: 'default',
  archived: 'destructive',
};

const Objects = () => {
  const navigate = useNavigate();
  const { language } = useTheme();
  const [items, setItems] = useState<ObjectRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tenantInfo, setTenantInfo] = useState<Record<string, { name: string; slug: string }>>({});

  const loadObjects = useCallback(async () => {
    try {
      setIsLoading(true);
      const records = await getObjects();
      setItems(records);
      setTenantInfo(await getVisibleTenantInfoMap(records.map((item) => item.tenant_id)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load objects.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadObjects();
  }, [loadObjects]);

  const handleArchive = async (id: string) => {
    const confirmed = window.confirm(
      language === 'en' ? 'Archive this object?' : 'Dieses Objekt archivieren?',
    );
    if (!confirmed) return;

    try {
      await deleteObject(id);
      toast.success(language === 'en' ? 'Object archived.' : 'Objekt archiviert.');
      await loadObjects();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to archive object.');
    }
  };

  const emptyState = (
    <AdminCard className="border-dashed">
      <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 text-center">
        <Box className="h-12 w-12 text-muted-foreground" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">
            {language === 'en' ? 'No objects yet' : 'Noch keine Objekte'}
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            {language === 'en'
              ? 'Define structured JSON objects and shareable markdown documents, then expose them via API or public share pages.'
              : 'Definiere strukturierte JSON-Objekte und teilbare Markdown-Dokumente und stelle sie über API oder Share-Seiten bereit.'}
          </p>
        </div>
        <Button onClick={() => navigate('/objects/new')}>
          <FilePlus2 className="mr-2 h-4 w-4" />
          {language === 'en' ? 'Create object' : 'Objekt erstellen'}
        </Button>
      </div>
    </AdminCard>
  );

  return (
    <AdminPageLayout
      title={language === 'en' ? 'Objects' : 'Objekte'}
      description={
        language === 'en'
          ? 'Define schema-validated data objects and serve them through the API endpoint.'
          : 'Definiere schema-validierte Datenobjekte und stelle sie über den API-Endpunkt bereit.'
      }
      icon={Box}
      actions={(
        <Button onClick={() => navigate('/objects/new')}>
          <FilePlus2 className="mr-2 h-4 w-4" />
          {language === 'en' ? 'New Object' : 'Neues Objekt'}
        </Button>
      )}
    >
      {isLoading ? (
        <AdminCard className="flex min-h-[280px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </AdminCard>
      ) : items.length === 0 ? (
        emptyState
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {items.map((obj) => (
            <AdminCard
              key={obj.id}
              title={obj.name}
              description={obj.description ?? undefined}
              actions={(
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/objects/${obj.id}`)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    {language === 'en' ? 'Edit' : 'Bearbeiten'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void handleArchive(obj.id)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {language === 'en' ? 'Archive' : 'Archivieren'}
                  </Button>
                  {obj.share_enabled && obj.share_slug && obj.tenant_id && tenantInfo[obj.tenant_id] && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(buildObjectSharePath(tenantInfo[obj.tenant_id].slug, obj.share_slug))}
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      {language === 'en' ? 'Share' : 'Teilen'}
                    </Button>
                  )}
                </div>
              )}
            >
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Badge variant={statusVariant[obj.status]}>
                  {obj.status}
                </Badge>
                <Badge variant="secondary" className="text-xs uppercase">
                  {obj.object_type}
                </Badge>
                <Badge variant="secondary" className="font-mono text-xs">
                  /{obj.slug}
                </Badge>
                {obj.tenant_id && tenantInfo[obj.tenant_id] && (
                  <Badge variant="outline" className="text-xs">
                    {tenantInfo[obj.tenant_id].name}
                  </Badge>
                )}
                {obj.requires_auth ? (
                  <Badge variant="outline" className="gap-1 text-xs">
                    <Lock className="h-3 w-3" />
                    {language === 'en' ? 'Auth required' : 'Auth erforderlich'}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-xs">
                    <Unlock className="h-3 w-3" />
                    {language === 'en' ? 'Public' : 'Öffentlich'}
                  </Badge>
                )}
                {!obj.api_enabled && (
                  <Badge variant="secondary" className="text-xs">
                    {language === 'en' ? 'API disabled' : 'API deaktiviert'}
                  </Badge>
                )}
                {obj.share_enabled && (
                  <Badge variant="outline" className="text-xs">
                    {language === 'en' ? 'Share enabled' : 'Share aktiv'}
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {language === 'en' ? 'Updated' : 'Aktualisiert'}:{' '}
                {new Date(obj.updated_at).toLocaleDateString(language === 'en' ? 'en-GB' : 'de-DE')}
              </p>
            </AdminCard>
          ))}
        </div>
      )}
    </AdminPageLayout>
  );
};

export default Objects;
