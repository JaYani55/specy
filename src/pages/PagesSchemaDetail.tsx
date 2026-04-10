import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plus, Settings, ArrowLeft, Loader2, FileText, Globe,
  Pencil, Trash2, ExternalLink, Eye, MoreVertical, KeyRound, ShieldCheck, ShieldAlert
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  getSchema,
  getPagesBySchema,
  deletePage,
  updatePageStatus,
  checkDomainHealthDirect,
  startSchemaRegistration,
  triggerRevalidation,
  getRevalidationSecretStatus,
  setRevalidationSecret,
  deleteRevalidationSecret,
  type RevalidationSecretStatus,
} from '@/services/pageService';
import { SchemaWaitingScreen } from '@/components/pagebuilder/SchemaWaitingScreen';
import type { PageSchema, PageRecord } from '@/types/pagebuilder';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions';
import { toast } from 'sonner';

const statusBadgeVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'secondary',
  published: 'default',
  archived: 'destructive',
};

const PagesSchemaDetail: React.FC = () => {
  const { schemaSlug } = useParams<{ schemaSlug: string }>();
  const navigate = useNavigate();
  const { language } = useTheme();
  const permissions = usePermissions();
  const canManageRevalidationSecret = permissions.hasRole('admin');

  const [schema, setSchema] = useState<(PageSchema & { page_count: number }) | null>(null);
  const [pages, setPages] = useState<PageRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<'online' | 'offline' | 'checking' | null>(null);
  const [deletePageId, setDeletePageId] = useState<string | null>(null);
  const [isStartingRegistration, setIsStartingRegistration] = useState(false);
  const [revalidationSecretStatus, setRevalidationSecretStatus] = useState<RevalidationSecretStatus | null>(null);
  const [revalidationSecretInput, setRevalidationSecretInput] = useState('');
  const [isSavingRevalidationSecret, setIsSavingRevalidationSecret] = useState(false);
  const [isDeletingRevalidationSecret, setIsDeletingRevalidationSecret] = useState(false);

  const fetchData = useCallback(async () => {
    if (!schemaSlug) return;
    try {
      setIsLoading(true);
      const schemaData = await getSchema(schemaSlug);
      setSchema(schemaData);

      const pagesData = await getPagesBySchema(schemaData.id);
      setPages(pagesData);
      setRevalidationSecretStatus(null);

      // Check domain health for registered schemas
      if (schemaData.registration_status === 'registered' && schemaData.frontend_url) {
        setHealth('checking');
        checkDomainHealthDirect(schemaData.frontend_url).then(result => {
          setHealth(result.status);
        });

        if (canManageRevalidationSecret) {
          getRevalidationSecretStatus(schemaData.slug)
            .then((status) => setRevalidationSecretStatus(status))
            .catch(() => setRevalidationSecretStatus(null));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schema');
    } finally {
      setIsLoading(false);
    }
  }, [canManageRevalidationSecret, schemaSlug]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStartRegistration = async () => {
    if (!schema) return;
    setIsStartingRegistration(true);
    try {
      await startSchemaRegistration(schema.id);
      toast.success(language === 'en' ? 'Registration started — code generated' : 'Registrierung gestartet — Code generiert');
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start registration');
    } finally {
      setIsStartingRegistration(false);
    }
  };

  const handleDeletePage = async () => {
    if (!deletePageId) return;
    try {
      await deletePage(deletePageId);
      setPages(prev => prev.filter(p => p.id !== deletePageId));
      toast.success(language === 'en' ? 'Page deleted' : 'Seite gelöscht');
    } catch {
      toast.error(language === 'en' ? 'Failed to delete page' : 'Fehler beim Löschen');
    } finally {
      setDeletePageId(null);
    }
  };

  const handleStatusChange = async (pageId: string, status: 'draft' | 'published' | 'archived') => {
    const currentPage = pages.find((page) => page.id === pageId) ?? null;

    try {
      await updatePageStatus(pageId, status);
      setPages(prev => prev.map(p => p.id === pageId ? { ...p, status, is_draft: status === 'draft' } : p));
      toast.success(language === 'en' ? `Status changed to ${status}` : `Status geändert zu ${status}`);

      if (status === 'published' && currentPage?.slug && schema.registration_status === 'registered') {
        try {
        const rev = await triggerRevalidation(schema.slug, currentPage.slug);
        if (rev.success) {
          toast.success(language === 'en'
            ? `ISR triggered for /${currentPage.slug}`
            : `ISR für /${currentPage.slug} ausgelöst`);
        } else {
          toast.warning(language === 'en'
            ? `ISR revalidation failed: ${rev.message}`
            : `ISR-Revalidierung fehlgeschlagen: ${rev.message}`);
        }
        } catch {
          toast.warning(language === 'en'
            ? 'Page published, but ISR endpoint could not be reached'
            : 'Seite veröffentlicht, aber der ISR-Endpunkt konnte nicht erreicht werden');
        }
      }
    } catch {
      toast.error(language === 'en' ? 'Failed to update status' : 'Fehler beim Aktualisieren');
    }
  };

  const handleSaveRevalidationSecret = async () => {
    if (!schema) return;

    const secret = revalidationSecretInput.trim();
    if (!secret) {
      toast.error(language === 'en' ? 'Secret cannot be empty' : 'Secret darf nicht leer sein');
      return;
    }

    setIsSavingRevalidationSecret(true);
    try {
      await setRevalidationSecret(schema.slug, secret);
      setRevalidationSecretInput('');
      const status = await getRevalidationSecretStatus(schema.slug);
      setRevalidationSecretStatus(status);
      toast.success(language === 'en' ? 'Revalidation secret saved' : 'Revalidation-Secret gespeichert');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save revalidation secret');
    } finally {
      setIsSavingRevalidationSecret(false);
    }
  };

  const handleDeleteRevalidationSecret = async () => {
    if (!schema) return;

    setIsDeletingRevalidationSecret(true);
    try {
      await deleteRevalidationSecret(schema.slug);
      setRevalidationSecretStatus((current) => current ? { ...current, configured: false, secret_name: null, legacy_plaintext: false } : null);
      toast.success(language === 'en' ? 'Revalidation secret removed' : 'Revalidation-Secret entfernt');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete revalidation secret');
    } finally {
      setIsDeletingRevalidationSecret(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !schema) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-red-500">{error || 'Schema not found'}</div>
      </div>
    );
  }

  // Show waiting screen if schema is in waiting status
  if (schema.registration_status === 'waiting') {
    return (
      <div className="container mx-auto py-8 space-y-4">
        <Button variant="ghost" onClick={() => navigate('/pages')} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {language === 'en' ? 'Back to Pages' : 'Zurück zu Seiten'}
        </Button>
        <SchemaWaitingScreen schema={schema} onStatusChange={fetchData} />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/pages')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold">{schema.name}</h1>
            <Badge variant={schema.registration_status === 'registered' ? 'default' : 'secondary'}>
              {schema.registration_status}
            </Badge>
            {health && (
              <Badge variant={health === 'online' ? 'default' : health === 'checking' ? 'outline' : 'destructive'}>
                <Globe className="h-3 w-3 mr-1" />
                {health === 'checking' ? '...' : health.toUpperCase()}
              </Badge>
            )}
          </div>
          {schema.description && (
            <p className="text-muted-foreground mt-1">{schema.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(`/pages/schema/${schemaSlug}/settings`)}>
            <Settings className="h-4 w-4 mr-2" />
            {language === 'en' ? 'Schema Settings' : 'Schema-Einstellungen'}
          </Button>
          <Button onClick={() => navigate(`/pages/schema/${schemaSlug}/new`)}>
            <Plus className="h-4 w-4 mr-2" />
            {language === 'en' ? 'New Page' : 'Neue Seite'}
          </Button>
        </div>
      </div>

      {/* Registration CTA for pending schemas */}
      {schema.registration_status === 'pending' && (
        <Card className="border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h3 className="font-semibold text-amber-900 dark:text-amber-200">
                  {language === 'en' ? 'No frontend connected' : 'Kein Frontend verbunden'}
                </h3>
                <p className="text-sm text-amber-800/70 dark:text-amber-300/60">
                  {language === 'en'
                    ? 'Start registration to generate a code and spec URL for an AI agent or developer to build and connect a frontend.'
                    : 'Starte die Registrierung, um einen Code und eine Spec-URL zu generieren, mit der ein KI-Agent oder Entwickler ein Frontend bauen und verbinden kann.'}
                </p>
              </div>
              <Button
                onClick={handleStartRegistration}
                disabled={isStartingRegistration}
                className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 ml-4"
              >
                {isStartingRegistration && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {language === 'en' ? 'Start Registration' : 'Registrierung starten'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Domain Info Panel */}
      {schema.registration_status === 'registered' && schema.frontend_url && canManageRevalidationSecret && (
        <Card>
          <CardContent className="py-4 space-y-4">
            <div className="flex items-center gap-6 text-sm flex-wrap">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Domain:</span>
                <a
                  href={schema.frontend_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline flex items-center gap-1"
                >
                  {schema.frontend_url}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <Separator orientation="vertical" className="h-4" />
              <div>
                <span className="font-medium">{language === 'en' ? 'Slug Pattern' : 'Slug-Muster'}:</span>{' '}
                <code className="bg-muted px-1 rounded text-xs">{schema.slug_structure}</code>
              </div>
              {schema.revalidation_endpoint && (
                <>
                  <Separator orientation="vertical" className="h-4" />
                  <div>
                    <span className="font-medium">ISR:</span>{' '}
                    <code className="bg-muted px-1 rounded text-xs">{schema.revalidation_endpoint}</code>
                  </div>
                </>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      {language === 'en' ? 'Revalidation Secret' : 'Revalidation-Secret'}
                    </span>
                    {revalidationSecretStatus?.configured ? (
                      <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        {language === 'en' ? 'Configured' : 'Konfiguriert'}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 gap-1">
                        <ShieldAlert className="h-3 w-3" />
                        {language === 'en' ? 'Missing' : 'Fehlt'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {language === 'en'
                      ? 'Stored server-side and sent as Authorization: Bearer during revalidation. The value is write-only.'
                      : 'Wird serverseitig gespeichert und bei der Revalidation als Authorization: Bearer gesendet. Der Wert ist nur schreibbar.'}
                  </p>
                  {revalidationSecretStatus?.warning && (
                    <p className="text-xs text-amber-700 mt-1">
                      {revalidationSecretStatus.warning}
                    </p>
                  )}
                  {revalidationSecretStatus?.secret_name && (
                    <p className="text-xs text-muted-foreground mt-1 font-mono">
                      {revalidationSecretStatus.secret_name}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="revalidation-secret-input">
                    {revalidationSecretStatus?.configured
                      ? (language === 'en' ? 'Replace secret' : 'Secret ersetzen')
                      : (language === 'en' ? 'Set secret' : 'Secret setzen')}
                  </Label>
                  <Input
                    id="revalidation-secret-input"
                    type="password"
                    value={revalidationSecretInput}
                    onChange={(event) => setRevalidationSecretInput(event.target.value)}
                    placeholder={language === 'en' ? 'Enter a shared secret' : 'Gemeinsames Secret eingeben'}
                    autoComplete="off"
                    disabled={revalidationSecretStatus?.management_available === false}
                  />
                </div>
                <Button
                  onClick={handleSaveRevalidationSecret}
                  disabled={isSavingRevalidationSecret || revalidationSecretStatus?.management_available === false}
                >
                  {isSavingRevalidationSecret && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {revalidationSecretStatus?.configured
                    ? (language === 'en' ? 'Rotate Secret' : 'Secret rotieren')
                    : (language === 'en' ? 'Save Secret' : 'Secret speichern')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !revalidationSecretStatus?.configured ||
                    isDeletingRevalidationSecret ||
                    revalidationSecretStatus?.management_available === false
                  }
                  onClick={handleDeleteRevalidationSecret}
                >
                  {isDeletingRevalidationSecret && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {language === 'en' ? 'Clear' : 'Löschen'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pages List */}
      <div>
        <h2 className="text-xl font-semibold mb-4">
          {language === 'en' ? 'Pages' : 'Seiten'} ({pages.length})
        </h2>

        {pages.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                {language === 'en' ? 'No pages yet' : 'Noch keine Seiten'}
              </h3>
              <p className="text-muted-foreground text-center mb-4">
                {language === 'en'
                  ? 'Create your first page using this schema.'
                  : 'Erstelle deine erste Seite mit diesem Schema.'}
              </p>
              <Button onClick={() => navigate(`/pages/schema/${schemaSlug}/new`)}>
                <Plus className="h-4 w-4 mr-2" />
                {language === 'en' ? 'Create Page' : 'Seite erstellen'}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {pages.map((page) => (
              <Card key={page.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <h3 className="font-medium truncate">{page.name}</h3>
                        <p className="text-sm text-muted-foreground truncate">
                          /{page.slug}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <Badge variant={statusBadgeVariant[page.status] || 'secondary'}>
                        {page.status}
                      </Badge>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(page.updated_at).toLocaleDateString(language === 'en' ? 'en-US' : 'de-DE')}
                      </span>

                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/pages/schema/${schemaSlug}/edit/${page.id}`)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {schema.frontend_url && page.status === 'published' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            asChild
                          >
                            <a
                              href={`${schema.frontend_url}${schema.slug_structure.replace(':slug', page.slug)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Eye className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {page.status !== 'published' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(page.id, 'published')}>
                                {language === 'en' ? 'Publish' : 'Veröffentlichen'}
                              </DropdownMenuItem>
                            )}
                            {page.status !== 'draft' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(page.id, 'draft')}>
                                {language === 'en' ? 'Unpublish' : 'Zurückziehen'}
                              </DropdownMenuItem>
                            )}
                            {page.status !== 'archived' && (
                              <DropdownMenuItem onClick={() => handleStatusChange(page.id, 'archived')}>
                                {language === 'en' ? 'Archive' : 'Archivieren'}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => setDeletePageId(page.id)}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              {language === 'en' ? 'Delete' : 'Löschen'}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deletePageId} onOpenChange={() => setDeletePageId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {language === 'en' ? 'Delete Page?' : 'Seite löschen?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {language === 'en'
                ? 'This action cannot be undone. The page and all its content will be permanently deleted.'
                : 'Diese Aktion kann nicht rückgängig gemacht werden. Die Seite und alle Inhalte werden dauerhaft gelöscht.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {language === 'en' ? 'Cancel' : 'Abbrechen'}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePage} className="bg-destructive text-destructive-foreground">
              {language === 'en' ? 'Delete' : 'Löschen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PagesSchemaDetail;
