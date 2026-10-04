import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, ArrowLeft, Loader2, Package, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { useTheme } from '@/contexts/ThemeContext';
import { getSchemas } from '@/services/pageService';
import { archiveServiceProduct, createServiceProduct, listServiceProducts, type ServiceProduct } from '@/services/productService';
import type { PageSchema } from '@/types/pagebuilder';
import { getSchemaConsolePath } from '@/utils/schemaPaths';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const Products: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useTheme();
  const { activeTenantId } = useActiveWorkspace();
  const [products, setProducts] = useState<ServiceProduct[]>([]);
  const [schemas, setSchemas] = useState<PageSchema[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [productName, setProductName] = useState('');
  const [selectedSchemaId, setSelectedSchemaId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const productSchemas = useMemo(() => schemas.filter((schema) =>
    schema.entity_kind === 'service-product' && schema.tenant_id === activeTenantId && schema.content_scope === 'page-collection'
  ), [schemas, activeTenantId]);

  const load = useCallback(async () => {
    if (!activeTenantId) {
      setProducts([]);
      setSchemas([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [nextProducts, nextSchemas] = await Promise.all([
        listServiceProducts(activeTenantId),
        getSchemas(activeTenantId),
      ]);
      setProducts(nextProducts);
      setSchemas(nextSchemas);
      setSelectedSchemaId((current) => current || nextSchemas.find((schema) => schema.entity_kind === 'service-product' && schema.tenant_id === activeTenantId)?.id || '');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (language === 'en' ? 'Products could not be loaded.' : 'Produkte konnten nicht geladen werden.'));
    } finally {
      setIsLoading(false);
    }
  }, [activeTenantId, language]);

  useEffect(() => { void load(); }, [load]);

  const filteredProducts = products.filter((product) => {
    const matchesText = product.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    const status = product.status ?? product.page?.status ?? 'draft';
    return matchesText && (statusFilter === 'all' || status === statusFilter);
  });

  const openCreate = () => {
    setProductName('');
    setSelectedSchemaId(productSchemas.length === 1 ? productSchemas[0].id : '');
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!activeTenantId || !selectedSchemaId || !productName.trim()) {
      toast.error(language === 'en' ? 'Choose a catalogue and enter a product name.' : 'Wähle einen Katalog und gib einen Produktnamen ein.');
      return;
    }
    const schema = productSchemas.find((item) => item.id === selectedSchemaId);
    if (!schema) {
      toast.error(language === 'en' ? 'The selected catalogue is not available in this workspace.' : 'Der ausgewählte Katalog ist in diesem Workspace nicht verfügbar.');
      return;
    }
    setIsCreating(true);
    try {
      const product = await createServiceProduct({
        tenant_id: activeTenantId,
        schema_id: schema.id,
        expected_definition_revision: schema.definition_revision ?? 1,
        name: productName.trim(),
        content: {},
      });
      setCreateOpen(false);
      navigate(`${getSchemaConsolePath(schema)}/edit/${product.page_id}`);
      toast.success(language === 'en' ? 'Draft product created.' : 'Produktentwurf erstellt.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (language === 'en' ? 'Product could not be created.' : 'Produkt konnte nicht erstellt werden.'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleArchive = async (product: ServiceProduct) => {
    if (!activeTenantId) return;
    const confirmText = language === 'en'
      ? `Archive “${product.name}”? Its public page will be unpublished.`
      : `„${product.name}“ archivieren? Die öffentliche Seite wird zurückgezogen.`;
    if (!window.confirm(confirmText)) return;
    setArchivingId(product.id);
    try {
      await archiveServiceProduct({ id: product.id, tenant_id: activeTenantId, expected_version: product.version });
      await load();
      toast.success(language === 'en' ? 'Product archived.' : 'Produkt archiviert.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (language === 'en' ? 'Product could not be archived.' : 'Produkt konnte nicht archiviert werden.'));
    } finally {
      setArchivingId(null);
    }
  };

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></div>;

  return (
    <div className="container mx-auto max-w-6xl space-y-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <Button variant="ghost" className="-ml-3" onClick={() => navigate('/products/manage')}>
            <ArrowLeft className="mr-2 h-4 w-4" />Zur Produktübersicht
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Website-Produkte</h1>
            <p className="mt-1 text-muted-foreground">Produkte mit eigenen Website-Seiten und aktuellen Produktangaben.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={openCreate} disabled={!activeTenantId || productSchemas.length === 0}>
            <Plus className="mr-2 h-4 w-4" />Neues Website-Produkt
          </Button>
        </div>
      </div>

      {!activeTenantId ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">{language === 'en' ? 'Select a workspace to manage products.' : 'Wähle einen Workspace, um Produkte zu verwalten.'}</CardContent></Card>
      ) : productSchemas.length === 0 ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" />{language === 'en' ? 'No product catalogue yet' : 'Noch kein Produktkatalog vorhanden'}</CardTitle>
            <CardDescription>{language === 'en' ? 'Set up a page schema for service products to start your catalogue.' : 'Richte ein Seitenschema für Serviceprodukte ein, um deinen Katalog zu starten.'}</CardDescription>
          </CardHeader>
          <CardContent><Button onClick={() => navigate('/pages/schema/new')}>{language === 'en' ? 'Set up catalogue' : 'Katalog einrichten'}</Button></CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[220px] flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={language === 'en' ? 'Search products' : 'Produkte suchen'} /></div>
            <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{language === 'en' ? 'All statuses' : 'Alle Status'}</SelectItem><SelectItem value="draft">{language === 'en' ? 'Draft' : 'Entwurf'}</SelectItem><SelectItem value="published">{language === 'en' ? 'Published' : 'Veröffentlicht'}</SelectItem><SelectItem value="archived">{language === 'en' ? 'Archived' : 'Archiviert'}</SelectItem></SelectContent></Select>
          </div>
          {filteredProducts.length === 0 ? <Card><CardContent className="py-10 text-center text-muted-foreground">{language === 'en' ? 'No products found.' : 'Keine Produkte gefunden.'}</CardContent></Card> : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50"><tr><th className="p-3 text-left font-medium">{language === 'en' ? 'Name' : 'Name'}</th><th className="p-3 text-left font-medium">{language === 'en' ? 'Catalogue' : 'Katalog'}</th><th className="p-3 text-left font-medium">{language === 'en' ? 'Publication' : 'Veröffentlichung'}</th><th className="p-3 text-left font-medium">{language === 'en' ? 'Updated' : 'Aktualisiert'}</th><th className="p-3 text-right font-medium">{language === 'en' ? 'Actions' : 'Aktionen'}</th></tr></thead>
                <tbody>
                  {filteredProducts.map((product) => {
                    const schema = productSchemas.find((entry) => entry.id === product.schema_id || entry.id === product.page?.schema_id);
                    const status = product.status ?? product.page?.status ?? 'draft';
                    return <tr key={product.id} className="border-t hover:bg-muted/20">
                      <td className="p-3"><button className="text-left font-medium hover:underline" onClick={() => schema && navigate(`${getSchemaConsolePath(schema)}/edit/${product.page_id}`)}>{product.name}</button></td>
                      <td className="p-3 text-muted-foreground">{schema?.name ?? '—'}</td>
                      <td className="p-3"><Badge variant={status === 'published' ? 'default' : status === 'archived' ? 'destructive' : 'secondary'}>{status === 'published' ? (language === 'en' ? 'Published' : 'Veröffentlicht') : status === 'archived' ? (language === 'en' ? 'Archived' : 'Archiviert') : (language === 'en' ? 'Draft' : 'Entwurf')}</Badge></td>
                      <td className="p-3 text-muted-foreground">{new Date(product.updated_at).toLocaleDateString(language === 'en' ? 'en' : 'de')}</td>
                      <td className="p-3 text-right"><Button variant="ghost" size="sm" disabled={archivingId === product.id} onClick={() => void handleArchive(product)}><Archive className="mr-1 h-4 w-4" />{language === 'en' ? 'Archive' : 'Archivieren'}</Button></td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{language === 'en' ? 'New service product' : 'Neues Serviceprodukt'}</DialogTitle><DialogDescription>{language === 'en' ? 'Create a draft product with one page in the selected catalogue.' : 'Erstelle einen Produktentwurf mit einer Seite im ausgewählten Katalog.'}</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>{language === 'en' ? 'Product name' : 'Produktname'}</Label><Input value={productName} onChange={(event) => setProductName(event.target.value)} autoFocus /></div>
            {productSchemas.length > 1 && <div className="space-y-2"><Label>{language === 'en' ? 'Catalogue' : 'Katalog'}</Label><Select value={selectedSchemaId} onValueChange={setSelectedSchemaId}><SelectTrigger><SelectValue placeholder={language === 'en' ? 'Choose catalogue' : 'Katalog auswählen'} /></SelectTrigger><SelectContent>{productSchemas.map((schema) => <SelectItem key={schema.id} value={schema.id}>{schema.name}</SelectItem>)}</SelectContent></Select></div>}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>{language === 'en' ? 'Cancel' : 'Abbrechen'}</Button><Button disabled={isCreating || !productName.trim() || !selectedSchemaId} onClick={() => void handleCreate()}>{isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{language === 'en' ? 'Create draft' : 'Entwurf erstellen'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Products;
