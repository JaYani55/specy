import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Loader2, Package, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { usePermissions } from '@/hooks/usePermissions';
import { deleteProduct, fetchProducts, type Product as LegacyProduct } from '@/services/events/productService';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { TenantCustomFieldsDialog } from '@/components/products/TenantCustomFieldsDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ProductCatalogue() {
  const navigate = useNavigate();
  const { activeTenantId } = useActiveWorkspace();
  const permissions = usePermissions();
  const [products, setProducts] = useState<LegacyProduct[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    if (!activeTenantId) {
      setProducts([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setProducts(await fetchProducts(activeTenantId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Produkte konnten nicht geladen werden.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => { void load(); }, [load]);

  const normalizedQuery = query.trim().toLocaleLowerCase('de');
  const visibleProducts = useMemo(() => products.filter((product) =>
    product.name.toLocaleLowerCase('de').includes(normalizedQuery)), [products, normalizedQuery]);

  const removeProduct = async (product: LegacyProduct) => {
    if (!activeTenantId || !window.confirm(`„${product.name}“ und alle zugehörigen Veranstaltungen sowie Archivdaten dauerhaft löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
    try {
      await deleteProduct(product.id, activeTenantId);
      toast.success('Produkt und zugehörige Veranstaltungen wurden gelöscht.');
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Produkt konnte nicht gelöscht werden.');
    }
  };

  return (
    <AdminPageLayout
      title="Produkte"
      description="Lege Produkte an, verbinde sie mit einem Schema und plane zugehörige Veranstaltungen mit eigenen Veranstaltungsseiten."
      icon={Package}
      actions={permissions.canManageProducts ? (
        <div className="flex flex-wrap items-center gap-2">
          <TenantCustomFieldsDialog legacyEventOnly />
          <Button variant="ghost" onClick={() => navigate('/products/manage/legacy')}>
            Weitere Verwaltung
          </Button>
          <Button onClick={() => navigate('/products/manage/new')}>
            <Plus className="mr-2 h-4 w-4" />Produkt anlegen
          </Button>
        </div>
      ) : undefined}
    >
      {!activeTenantId ? (
        <AdminCard className="py-10 text-center text-muted-foreground">Wähle einen Workspace aus, um Produkte zu sehen.</AdminCard>
      ) : (
        <div className="space-y-6">
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Produkte suchen…" />
          </div>
          {isLoading ? (
            <AdminCard className="flex min-h-48 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin" /></AdminCard>
          ) : visibleProducts.length ? (
            <div className="divide-y rounded-lg border">
              {visibleProducts.map((product) => (
                <div key={product.id} className="flex items-center gap-3 p-4 hover:bg-muted/40">
                  <button type="button" className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left" onClick={() => navigate(`/products/manage/${product.id}`)}>
                    <span className="min-w-0"><span className="block truncate font-medium">{product.name}</span><span className="block truncate text-sm text-muted-foreground">{product.description_de || 'Keine Kurzbeschreibung'}</span></span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                  {permissions.canManageProducts && (
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void removeProduct(product)} aria-label={`„${product.name}“ dauerhaft löschen`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <AdminCard className="border-dashed p-6 text-sm text-muted-foreground">Keine Produkte gefunden.</AdminCard>
          )}
        </div>
      )}
    </AdminPageLayout>
  );
}
