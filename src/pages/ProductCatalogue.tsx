import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArrowUpRight, Loader2, Package, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { usePermissions } from '@/hooks/usePermissions';
import { getSchemas } from '@/services/pageService';
import { archiveServiceProduct, deleteServiceProduct, listServiceProducts, type ServiceProduct } from '@/services/productService';
import { deleteProduct, fetchProducts, type Product as LegacyProduct } from '@/services/events/productService';
import type { PageSchema } from '@/types/pagebuilder';
import { getSchemaConsolePath } from '@/utils/schemaPaths';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { TenantCustomFieldsDialog } from '@/components/products/TenantCustomFieldsDialog';
import { ProductSchemaPreview } from '@/components/products/ProductSchemaPreview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const statusText = (status: string | undefined) => status === 'published' ? 'Veröffentlicht' : status === 'archived' ? 'Archiviert' : 'Entwurf';

export default function ProductCatalogue() {
  const navigate = useNavigate();
  const { activeTenantId } = useActiveWorkspace();
  const permissions = usePermissions();
  const [serviceProducts, setServiceProducts] = useState<ServiceProduct[]>([]);
  const [legacyProducts, setLegacyProducts] = useState<LegacyProduct[]>([]);
  const [schemas, setSchemas] = useState<PageSchema[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeTenantId) {
      setServiceProducts([]);
      setLegacyProducts([]);
      setSchemas([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [nextServiceProducts, nextLegacyProducts, nextSchemas] = await Promise.all([
        listServiceProducts(activeTenantId),
        fetchProducts(activeTenantId),
        getSchemas(activeTenantId),
      ]);
      setServiceProducts(nextServiceProducts);
      setLegacyProducts(nextLegacyProducts);
      setSchemas(nextSchemas.filter((schema) =>
        schema.tenant_id === activeTenantId
        && schema.entity_kind === 'service-product'
        && schema.content_scope === 'page-collection'
      ));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Produkte konnten nicht geladen werden.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => { void load(); }, [load]);

  const normalizedQuery = query.trim().toLocaleLowerCase('de');
  const visibleServiceProducts = useMemo(() => serviceProducts.filter((product) =>
    product.name.toLocaleLowerCase('de').includes(normalizedQuery)), [serviceProducts, normalizedQuery]);
  const visibleLegacyProducts = useMemo(() => legacyProducts.filter((product) =>
    product.name.toLocaleLowerCase('de').includes(normalizedQuery)), [legacyProducts, normalizedQuery]);
  const schemaById = useMemo(() => new Map(schemas.map((schema) => [schema.id, schema])), [schemas]);

  const removeServiceProduct = async (product: ServiceProduct) => {
    if (!activeTenantId || !window.confirm(`„${product.name}“ und alle zugehörigen Veranstaltungen, Veranstaltungsseiten und Archivdaten dauerhaft löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
    try {
      await deleteServiceProduct({ id: product.id, tenant_id: activeTenantId, expected_version: product.version });
      toast.success('Produkt und zugehörige Veranstaltungen wurden gelöscht.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Produkt konnte nicht gelöscht werden.');
    }
  };

  const removeLegacyProduct = async (product: LegacyProduct) => {
    if (!activeTenantId || !window.confirm(`„${product.name}“ und alle zugehörigen Veranstaltungen sowie Archivdaten dauerhaft löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
    try {
      await deleteProduct(product.id, activeTenantId);
      toast.success('Produkt und zugehörige Veranstaltungen wurden gelöscht.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Produkt konnte nicht gelöscht werden.');
    }
  };

  const archive = async (product: ServiceProduct) => {
    if (!activeTenantId || !window.confirm(`„${product.name}“ archivieren? Die öffentliche Seite wird zurückgezogen.`)) return;
    try {
      await archiveServiceProduct({ id: product.id, tenant_id: activeTenantId, expected_version: product.version });
      toast.success('Produkt archiviert.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Produkt konnte nicht archiviert werden.');
    }
  };

  return (
    <AdminPageLayout
      title="Produkte"
      description="Verwalte Produkte und die dazugehörigen Website-Inhalte an einem Ort."
      icon={Package}
      actions={permissions.canManageProducts ? (
        <div className="flex flex-wrap gap-2">
          <TenantCustomFieldsDialog legacyEventOnly />
          <Button variant="outline" onClick={() => navigate('/products/manage/new')}>
            <Plus className="mr-2 h-4 w-4" />Veranstaltungsprodukt anlegen
          </Button>
          <Button onClick={() => navigate('/products/schemas?create=1')} disabled={!activeTenantId}>
            <Plus className="mr-2 h-4 w-4" />Website-Produkt anlegen
          </Button>
        </div>
      ) : undefined}
    >
      {!activeTenantId ? (
        <AdminCard className="py-10 text-center text-muted-foreground">Wähle einen Workspace aus, um Produkte zu sehen.</AdminCard>
      ) : (
        <div className="space-y-8">
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Produkte suchen…" />
          </div>
          {isLoading ? (
            <AdminCard className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></AdminCard>
          ) : (
            <>
              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-semibold">Website-Produkte</h2>
                    <p className="text-sm text-muted-foreground">Produkte mit redaktionellen Seiten und aktuellen Angaben.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{visibleServiceProducts.length}</Badge>
                    <Button variant="outline" size="sm" onClick={() => navigate('/products/schemas')}>
                      <ArrowUpRight className="mr-1.5 h-4 w-4" />Website-Schemata
                    </Button>
                  </div>
                </div>
                {visibleServiceProducts.length ? (
                  <div className="divide-y rounded-lg border">
                    {visibleServiceProducts.map((product) => {
                      const schema = schemaById.get(product.schema_id ?? product.page?.schema_id ?? '');
                      const state = product.status ?? product.page?.status;
                      return (
                        <div key={product.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{product.name}</p>
                            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                              <span>{schema?.name ?? 'Website-Katalog'}</span>
                              {schema && <ProductSchemaPreview schema={schema} triggerLabel="Aufbau ansehen" compact />}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={state === 'published' ? 'default' : 'secondary'}>{statusText(state)}</Badge>
                            <Button variant="outline" size="sm" onClick={() => schema && navigate(`${getSchemaConsolePath(schema)}/edit/${product.page_id}`)} disabled={!schema}>
                              <ArrowUpRight className="mr-1.5 h-4 w-4" />Bearbeiten
                            </Button>
                            {permissions.canManageProducts && (
                              <>
                                <Button variant="ghost" size="sm" onClick={() => void archive(product)} aria-label={`„${product.name}“ archivieren`}>
                                  <Archive className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void removeServiceProduct(product)} aria-label={`„${product.name}“ dauerhaft löschen`}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <AdminCard className="border-dashed p-6 text-sm text-muted-foreground">
                    {schemas.length === 0 ? 'Für diesen Workspace ist noch kein Website-Katalog eingerichtet.' : 'Keine passenden Website-Produkte gefunden.'}
                    {schemas.length === 0 && permissions.canManageProducts && (
                      <Button variant="link" className="ml-1 h-auto p-0" onClick={() => navigate('/pages/schema/new')}>Katalog einrichten</Button>
                    )}
                  </AdminCard>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h2 className="text-xl font-semibold">Veranstaltungsprodukte</h2>
                    <p className="text-sm text-muted-foreground">Bestehende Angebote, die in der Terminplanung verwendet werden.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{visibleLegacyProducts.length}</Badge>
                    {permissions.canManageProducts && (
                      <Button variant="ghost" size="sm" onClick={() => navigate('/products/manage/legacy')}>Weitere Verwaltung</Button>
                    )}
                  </div>
                </div>
                {visibleLegacyProducts.length ? (
                  <div className="divide-y rounded-lg border">
                    {visibleLegacyProducts.map((product) => (
                      <div key={product.id} className="flex items-center gap-3 p-4 hover:bg-muted/40">
                        <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left" onClick={() => navigate(`/products/manage/${product.id}`)}>
                          <span className="min-w-0"><span className="block truncate font-medium">{product.name}</span><span className="block truncate text-sm text-muted-foreground">{product.description_de || 'Keine Kurzbeschreibung'}</span></span>
                          <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                        {permissions.canManageProducts && (
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void removeLegacyProduct(product)} aria-label={`„${product.name}“ dauerhaft löschen`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <AdminCard className="border-dashed p-6 text-sm text-muted-foreground">Keine passenden Veranstaltungsprodukte gefunden.</AdminCard>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </AdminPageLayout>
  );
}
