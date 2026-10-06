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
  type RevalidationResult,
} from '@/services/pageService';
import { getSchemaSpecBundle } from '@/services/specService';
import { RevalidationFeedback } from '@/components/revalidation/RevalidationFeedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { archiveServiceProduct, deleteServiceProduct, getServiceProductByPage, setServiceProductPublication } from '@/services/productService';
import { supabase } from '@/lib/supabase';
import { isCatalogueSchema } from '@/utils/schemaKinds';
import { getEventPageAggregateByPage, setEventPagePublication } from '@/services/events/eventPageService';
import { getVisibleTenantNameMap } from '@/services/tenantService';
import { SchemaWaitingScreen } from '@/components/pagebuilder/SchemaWaitingScreen';
import type { PageSchema, PageRecord } from '@/types/pagebuilder';
import type { SchemaSpecBundle } from '@/types/specs';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions';
import { toast } from 'sonner';
import { buildSchemaPageUrl, getDetailPageTarget, getExpectedSlugStructure, getExplicitPreviewSlugStructure, isPreviewConfigured, normalizeSchemaIntegrationRequirements } from '@/utils/schemaRouting';
import { getSchemaConsolePath } from '@/utils/schemaPaths';

const statusBadgeVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'secondary',
  published: 'default',
  archived: 'destructive',
};

const PagesSchemaDetail: React.FC = () => {
  const { schemaSlug, tenantSlug } = useParams<{ schemaSlug: string; tenantSlug?: string }>();
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
  const [revalidationNotice, setRevalidationNotice] = useState<{ pageSlug: string; result: RevalidationResult } | null>(null);
  const [revalidationSecretInput, setRevalidationSecretInput] = useState('');
  const [isSavingRevalidationSecret, setIsSavingRevalidationSecret] = useState(false);
  const [isDeletingRevalidationSecret, setIsDeletingRevalidationSecret] = useState(false);
  const [schemaSpecBundle, setSchemaSpecBundle] = useState<SchemaSpecBundle | null>(null);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    if (!schemaSlug) return;
    try {
      setIsLoading(true);
      const schemaData = await getSchema(schemaSlug, tenantSlug);
      setSchema(schemaData);

      const [pagesData, specBundle] = await Promise.all([
        getPagesBySchema(schemaData.id, schemaData.tenant_id ?? null),
        getSchemaSpecBundle(schemaData.api_slug).catch(() => null),
      ]);
      setPages(pagesData);
      setSchemaSpecBundle(specBundle);
      setTenantNames(await getVisibleTenantNameMap([
        schemaData.tenant_id,
        ...pagesData.map((page) => page.tenant_id),
      ]));
      setRevalidationSecretStatus(null);

      // Check domain health for registered schemas
      if (schemaData.registration_status === 'registered' && schemaData.frontend_url) {
        setHealth('checking');
        checkDomainHealthDirect(schemaData.frontend_url).then(result => {
          setHealth(result.status);
        });

        if (canManageRevalidationSecret) {
          getRevalidationSecretStatus(schemaData.api_slug)
            .then((status) => setRevalidationSecretStatus(status))
            .catch(() => setRevalidationSecretStatus(null));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schema');
    } finally {
      setIsLoading(false);
    }
  }, [canManageRevalidationSecret, schemaSlug, tenantSlug]);

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
      if (schema.entity_kind === 'service-product') {
        if (!schema.tenant_id) throw new Error('Produktschema ohne Workspace-Zuordnung.');
        // A linked product owns this page as its canonical page; deleting the page
        // therefore deletes the product aggregate (product, events, page, mirror).
        const { data: linkedProduct, error: linkedProductError } = await supabase
          .from('mentorbooking_products')
          .select('integration_id, version')
          .eq('product_page_id', deletePageId)
          .eq('tenant_id', schema.tenant_id)
          .is('retired_at', null)
          .maybeSingle();
        if (linkedProductError) throw new Error(linkedProductError.message);
        if (linkedProduct) {
          if (!permissions.canManageProducts) throw new Error(language === 'en' ? 'You are not allowed to delete products.' : 'Du darfst keine Produkte löschen.');
          await deleteServiceProduct({
            id: linkedProduct.integration_id as string,
            tenant_id: schema.tenant_id,
            expected_version: Number(linkedProduct.version ?? 1),
          });
        } else {
          await deletePage(deletePageId);
        }
      } else if (schema.entity_kind === 'event') {
        if (!schema.tenant_id) throw new Error('Veranstaltungsschema ohne Workspace-Zuordnung.');
        // A page linked to an event is RESTRICTed in the database; deleting the
        // page therefore deletes the linked event first.
        const { data: linkedEvent, error: linkedEventError } = await supabase
          .from('mentorbooking_events')
          .select('id')
          .eq('page_id', deletePageId)
          .eq('tenant_id', schema.tenant_id)
          .maybeSingle();
        if (linkedEventError) throw new Error(linkedEventError.message);
        if (linkedEvent) {
          if (!permissions.canDeleteEvents) throw new Error(language === 'en' ? 'You are not allowed to delete events.' : 'Du darfst keine Veranstaltungen löschen.');
          const { error: eventDeleteError } = await supabase
            .from('mentorbooking_events')
            .delete()
            .eq('id', linkedEvent.id as string)
            .eq('tenant_id', schema.tenant_id);
          if (eventDeleteError) throw new Error(eventDeleteError.message);
        }
        await deletePage(deletePageId);
      } else {
        await deletePage(deletePageId);
      }
      setPages(prev => prev.filter(p => p.id !== deletePageId));
      toast.success(language === 'en' ? 'Page deleted' : 'Seite gelöscht');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (language === 'en' ? 'Failed to delete page' : 'Fehler beim Löschen'));
    } finally {
      setDeletePageId(null);
    }
  };

  const handleStatusChange = async (pageId: string, status: 'draft' | 'published' | 'archived') => {
    const currentPage = pages.find((page) => page.id === pageId) ?? null;

    try {
      if (schema.entity_kind === 'service-product') {
        if (!schema.tenant_id) throw new Error('Produktschema ohne Workspace-Zuordnung.');
        const product = await getServiceProductByPage(pageId, schema.tenant_id);
        if (status === 'archived') {
          await archiveServiceProduct({ id: product.id, tenant_id: schema.tenant_id, expected_version: product.version });
        } else {
          await setServiceProductPublication({ id: product.id, tenant_id: schema.tenant_id, expected_version: product.version, expected_definition_revision: schema.definition_revision ?? 1, status });
        }
      } else if (isCatalogueSchema(schema.entity_kind)) {
        if (!schema.tenant_id || !currentPage) throw new Error('Katalogseite ohne Workspace oder Seitenrevision.');
        // Catalogue pages are classified by their linked aggregate: event first,
        // then the product that owns the page.
        const { data: linkedEvent, error: linkedEventError } = await supabase
          .from('mentorbooking_events')
          .select('id')
          .eq('page_id', pageId)
          .eq('tenant_id', schema.tenant_id)
          .maybeSingle();
        if (linkedEventError) throw new Error(linkedEventError.message);
        if (linkedEvent) {
          await setEventPagePublication({
            event_id: linkedEvent.id as string,
            tenant_id: schema.tenant_id,
            expected_definition_revision: schema.definition_revision ?? 1,
            expected_page_updated_at: currentPage.updated_at,
            status,
          });
        } else {
          const product = await getServiceProductByPage(pageId, schema.tenant_id);
          if (status === 'archived') {
            await archiveServiceProduct({ id: product.id, tenant_id: schema.tenant_id, expected_version: product.version });
          } else {
            await setServiceProductPublication({ id: product.id, tenant_id: schema.tenant_id, expected_version: product.version, expected_definition_revision: schema.definition_revision ?? 1, status });
          }
        }
      } else {
        await updatePageStatus(pageId, status);
      }
      setPages(prev => prev.map(p => p.id === pageId ? { ...p, status, is_draft: status === 'draft' } : p));
      toast.success(language === 'en' ? `Status changed to ${status}` : `Status geändert zu ${status}`);

      if (currentPage?.slug && schema.registration_status === 'registered'
        && (status === 'published' || currentPage.status === 'published')) {
        try {
          const result = await triggerRevalidation(schema.api_slug, currentPage.slug);
          if (result.success) {
            setRevalidationNotice(null);
            toast.success(language === 'en'
              ? `Frontend updated for /${currentPage.slug}`
              : `Frontend für /${currentPage.slug} aktualisiert`);
          } else {
            setRevalidationNotice({ pageSlug: currentPage.slug, result });
            toast.warning(language === 'en'
              ? 'Page status saved, but the frontend could not be updated.'
              : 'Seitenstatus gespeichert, aber das Frontend konnte nicht aktualisiert werden.');
          }
        } catch (error) {
          const result: RevalidationResult = {
            success: false,
            message: language === 'en' ? 'Could not reach the revalidation service.' : 'Der Aktualisierungsdienst war nicht erreichbar.',
            diagnostics: { error: error instanceof Error ? error.message : 'Unknown network error.' },
          };
          setRevalidationNotice({ pageSlug: currentPage.slug, result });
          toast.warning(language === 'en'
            ? 'Page status saved, but the frontend could not be updated.'
            : 'Seitenstatus gespeichert, aber das Frontend konnte nicht aktualisiert werden.');
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
      await setRevalidationSecret(schema.api_slug, secret);
      setRevalidationSecretInput('');
      const status = await getRevalidationSecretStatus(schema.api_slug);
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
      await deleteRevalidationSecret(schema.api_slug);
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

  const integrationRequirements = normalizeSchemaIntegrationRequirements(schema.integration_requirements);

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
            {schema.tenant_id && tenantNames[schema.tenant_id] && (
              <Badge variant="outline">{tenantNames[schema.tenant_id]}</Badge>
            )}
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
          <Button variant="outline" onClick={() => navigate(`${getSchemaConsolePath(schema)}/settings`)}>
            <Settings className="h-4 w-4 mr-2" />
            {language === 'en' ? 'Schema Settings' : 'Schema-Einstellungen'}
          </Button>
          {schema.entity_kind === 'service-product' ? (
            <Button onClick={() => navigate('/products/manage')}>
              {language === 'en' ? 'Open products' : 'Produkte öffnen'}
            </Button>
          ) : schema.entity_kind === 'event' ? (
            <Button onClick={() => navigate('/create-event')}>
              <Plus className="h-4 w-4 mr-2" />
              {language === 'en' ? 'Create Event' : 'Veranstaltung erstellen'}
            </Button>
          ) : (
            <Button onClick={() => navigate(`${getSchemaConsolePath(schema)}/new`)}>
              <Plus className="h-4 w-4 mr-2" />
              {language === 'en' ? 'New Page' : 'Neue Seite'}
            </Button>
          )}
        </div>
      </div>

      {revalidationNotice && (
        <Alert className="border-amber-500 bg-amber-50 dark:bg-amber-950">
          <AlertTitle>
            {language === 'en'
              ? `Page /${revalidationNotice.pageSlug} was saved, but the frontend update failed`
              : `Seite /${revalidationNotice.pageSlug} gespeichert, aber das Frontend konnte nicht aktualisiert werden`}
          </AlertTitle>
          <AlertDescription>
            <RevalidationFeedback result={revalidationNotice.result} language={language} />
          </AlertDescription>
        </Alert>
      )}

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
                <span className="font-medium">{language === 'en' ? 'Frontend targets' : 'Frontend-Ziele'}:</span>{' '}
                <code className="bg-muted px-1 rounded text-xs">{schema.frontend_targets?.length || 0}</code>
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
                      {language === 'en' ? 'Frontend Revalidation Token' : 'Frontend-Revalidierungs-Token'}
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
                      ? 'Shared with your frontend revalidation endpoint; Specy sends it as a Bearer token when content changes. Set the same value in both places. Write-only.'
                      : 'Gemeinsamer Token für Specy und den Revalidierungs-Endpunkt deines Frontends. Specy sendet ihn bei Inhaltsänderungen als Bearer-Token. In beiden Systemen denselben Wert verwenden. Nur schreibbar.'}
                  </p>
                  {revalidationSecretStatus?.management_available === false && (
                    <p className="text-xs text-amber-700 mt-1">
                      {revalidationSecretStatus.warning_code === 'supabase_admin_credential'
                        ? (language === 'en' ? 'Missing: Supabase admin credential (SS_SUPABASE_SECRET_KEY binding or SUPABASE_SECRET_KEY fallback).' : 'Fehlt: Supabase-Admin-Zugang (SS_SUPABASE_SECRET_KEY-Bindung oder SUPABASE_SECRET_KEY-Fallback).')
                        : revalidationSecretStatus.warning_code === 'secrets_encryption_key'
                          ? (language === 'en' ? 'Missing Worker secret: SECRETS_ENCRYPTION_KEY.' : 'Fehlt: Worker-Secret SECRETS_ENCRYPTION_KEY.')
                          : revalidationSecretStatus.warning_code === 'both_worker_keys'
                            ? (language === 'en' ? 'Missing: Supabase admin credential and Worker secret SECRETS_ENCRYPTION_KEY.' : 'Fehlen: Supabase-Admin-Zugang und Worker-Secret SECRETS_ENCRYPTION_KEY.')
                            : (language === 'en' ? 'Managed-secret access failed; check the Worker bindings and Secrets Store.' : 'Zugriff auf verwaltete Secrets fehlgeschlagen; Worker-Bindungen und Secrets Store prüfen.')}
                    </p>
                  )}
                  {revalidationSecretStatus?.secret_name && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {language === 'en' ? 'Internal managed-secret name (not the token value):' : 'Interner Speichername (nicht der Token-Wert):'}{' '}
                      <code className="font-mono">{revalidationSecretStatus.secret_name}</code>
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-[1fr_auto_auto] md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="revalidation-secret-input">
                    {revalidationSecretStatus?.configured
                      ? (language === 'en' ? 'Replace token' : 'Token ersetzen')
                      : (language === 'en' ? 'Set token' : 'Token setzen')}
                  </Label>
                  <Input
                    id="revalidation-secret-input"
                    type="password"
                    value={revalidationSecretInput}
                    onChange={(event) => setRevalidationSecretInput(event.target.value)}
                    placeholder={language === 'en' ? 'Same value as frontend' : 'Derselbe Wert wie im Frontend'}
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

      <Card>
        <CardHeader>
          <CardTitle>{language === 'en' ? 'MCP & Tool Exposure' : 'MCP & Tool-Freigabe'}</CardTitle>
          <CardDescription>
            {language === 'en'
              ? 'These MCP entries are currently attached to this schema and will be surfaced to agents through REST discovery and MCP when the schema is registered.'
              : 'Diese MCP-Einträge sind aktuell an dieses Schema angehängt und werden Agenten über REST-Discovery und MCP bereitgestellt, sobald das Schema registriert ist.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {schemaSpecBundle?.main_spec ? (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge>{language === 'en' ? 'Main Spec' : 'Haupt-Spec'}</Badge>
                <Badge variant="outline">{schemaSpecBundle.main_spec.status}</Badge>
                <Badge variant="outline">{schemaSpecBundle.main_spec.is_public ? 'Public' : 'Private'}</Badge>
              </div>
              <div>
                <p className="font-medium">{schemaSpecBundle.main_spec.name}</p>
                <p className="text-xs text-muted-foreground">{schemaSpecBundle.main_spec.slug}</p>
              </div>
              {schemaSpecBundle.main_spec.description && (
                <p className="text-sm text-muted-foreground">{schemaSpecBundle.main_spec.description}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {language === 'en' ? 'No main MCP attached yet.' : 'Noch kein Haupt-MCP angehängt.'}
            </p>
          )}

          {(schemaSpecBundle?.attached_specs.filter((spec) => !spec.is_main).length ?? 0) > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {schemaSpecBundle?.attached_specs.filter((spec) => !spec.is_main).map((spec) => (
                <div key={spec.id} className="rounded-lg border p-4 bg-muted/10 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{spec.name}</p>
                    <Badge variant="outline">{spec.status}</Badge>
                    <Badge variant="outline">{spec.is_public ? 'Public' : 'Private'}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{spec.slug}</p>
                  {spec.description && (
                    <p className="text-sm text-muted-foreground">{spec.description}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {language === 'en' ? 'No additional MCP entries are attached.' : 'Keine zusätzlichen MCP-Einträge angehängt.'}
            </p>
          )}

          <div className="flex items-center justify-end">
            <Button variant="outline" onClick={() => navigate(`${getSchemaConsolePath(schema)}/settings`)}>
              <Settings className="h-4 w-4 mr-2" />
              {language === 'en' ? 'Manage Tool Exposure' : 'Tool-Freigabe verwalten'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{language === 'en' ? 'Frontend Contract' : 'Frontend-Vertrag'}</CardTitle>
          <CardDescription>
            {language === 'en'
              ? 'These constraints are shown to frontend builders and enforced during registration.'
              : 'Diese Vorgaben werden Frontend-Builders angezeigt und während der Registrierung erzwungen.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 text-sm">
          <div>
            <span className="font-medium">{language === 'en' ? 'Canonical URL' : 'Kanonische URL'}:</span>{' '}
            <span className="text-muted-foreground">{integrationRequirements.canonical_frontend_url || 'Not fixed'}</span>
          </div>
          <div className="md:col-span-2">
            <span className="font-medium">{language === 'en' ? 'Target routes' : 'Zielrouten'}:</span>{' '}
            <span className="text-muted-foreground">
              {schema.frontend_targets?.length
                ? schema.frontend_targets.map((target) => `${target.target_key}: ${target.host_path}`).join(' · ')
                : getExpectedSlugStructure(schema)}
            </span>
          </div>
          <div>
            <span className="font-medium">{language === 'en' ? 'Preview' : 'Vorschau'}:</span>{' '}
            <span className="text-muted-foreground">
              {isPreviewConfigured(schema)
                ? `${language === 'en' ? 'Set' : 'Gesetzt'} — ${getExplicitPreviewSlugStructure(schema)}`
                : language === 'en'
                  ? 'Not set — no preview slug structure configured; add a detail-page target with a host path containing ":slug".'
                  : 'Nicht gesetzt — keine Vorschau-Slug-Struktur konfiguriert; hinterlege ein Detailseiten-Ziel mit „:slug“ im Host-Pfad.'}
            </span>
          </div>
          <div>
            <span className="font-medium">{language === 'en' ? 'Route base path' : 'Routen-Basispfad'}:</span>{' '}
            <span className="text-muted-foreground">{integrationRequirements.route_base_path || '/'}</span>
          </div>
          <div>
            <span className="font-medium">{language === 'en' ? 'Required route shape' : 'Erforderliche Routenform'}:</span>{' '}
            <span className="text-muted-foreground">{integrationRequirements.required_slug_structure || getExpectedSlugStructure(schema)}</span>
          </div>
          <div>
            <span className="font-medium">{language === 'en' ? 'Route ownership' : 'Routen-Verantwortung'}:</span>{' '}
            <span className="text-muted-foreground">{integrationRequirements.route_ownership}</span>
          </div>
          <div>
            <span className="font-medium">{language === 'en' ? 'Temporary domains' : 'Temporäre Domains'}:</span>{' '}
            <span className="text-muted-foreground">{integrationRequirements.allow_temporary_frontend_urls ? 'Allowed' : 'Blocked'}</span>
          </div>
          <div>
            <span className="font-medium">{language === 'en' ? 'Page discovery' : 'Seitenermittlung'}:</span>{' '}
            <span className="text-muted-foreground">{integrationRequirements.page_discovery_mode}</span>
          </div>
          {integrationRequirements.schema_identification_hint && (
            <div className="md:col-span-2">
              <span className="font-medium">{language === 'en' ? 'Schema hint' : 'Schema-Hinweis'}:</span>{' '}
              <span className="text-muted-foreground">{integrationRequirements.schema_identification_hint}</span>
            </div>
          )}
          {integrationRequirements.registration_notes && (
            <div className="md:col-span-2">
              <span className="font-medium">{language === 'en' ? 'Registration notes' : 'Registrierungsnotizen'}:</span>{' '}
              <span className="text-muted-foreground">{integrationRequirements.registration_notes}</span>
            </div>
          )}
        </CardContent>
      </Card>

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
                {schema.entity_kind === 'event'
                  ? language === 'en' ? 'Create an event and select this event catalogue to add its public page.' : 'Erstelle eine Veranstaltung und wähle diesen Katalog für ihre öffentliche Seite.'
                  : language === 'en' ? 'Create your first page using this schema.' : 'Erstelle deine erste Seite mit diesem Schema.'}
              </p>
              {schema.entity_kind === 'event' ? (
                <Button onClick={() => navigate('/create-event')}>
                  <Plus className="h-4 w-4 mr-2" />
                  {language === 'en' ? 'Create Event' : 'Veranstaltung erstellen'}
                </Button>
              ) : (
                <Button onClick={() => navigate(`${getSchemaConsolePath(schema)}/new`)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {language === 'en' ? 'Create Page' : 'Seite erstellen'}
                </Button>
              )}
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
                      {page.tenant_id && tenantNames[page.tenant_id] && (
                        <Badge variant="outline">{tenantNames[page.tenant_id]}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(page.updated_at).toLocaleDateString(language === 'en' ? 'en-US' : 'de-DE')}
                      </span>

                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`${getSchemaConsolePath(schema)}/edit/${page.id}`)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {isPreviewConfigured(schema) && page.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            asChild
                            title={language === 'en' ? 'Open preview' : 'Vorschau öffnen'}
                          >
                            <a
                              href={buildSchemaPageUrl(schema.frontend_url, getExplicitPreviewSlugStructure(schema)!, page.slug)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Eye className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                        {page.status === 'published' && getDetailPageTarget(schema)?.host_path && schema.frontend_url && (
                          <Button
                            variant="ghost"
                            size="icon"
                            asChild
                            title={language === 'en' ? 'Open published page' : 'Veröffentlichte Seite öffnen'}
                          >
                            <a
                              href={buildSchemaPageUrl(schema.frontend_url, getDetailPageTarget(schema)!.host_path, page.slug)}
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
              {schema.entity_kind === 'service-product'
                ? language === 'en'
                  ? 'This action cannot be undone. If the page is the canonical page of a product, the product with its events, archive history and the page are deleted.'
                  : 'Diese Aktion kann nicht rückgängig gemacht werden. Ist die Seite die kanonische Seite eines Produkts, werden das Produkt mit seinen Veranstaltungen, Archivdaten und die Seite gelöscht.'
                : schema.entity_kind === 'event'
                  ? language === 'en'
                    ? 'This action cannot be undone. If the page is linked to an event, that event is deleted together with the page. Unlinked pages are removed on their own.'
                    : 'Diese Aktion kann nicht rückgängig gemacht werden. Ist die Seite mit einer Veranstaltung verknüpft, wird auch diese gelöscht. Verwaiste Seiten werden einzeln entfernt.'
                  : language === 'en'
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
