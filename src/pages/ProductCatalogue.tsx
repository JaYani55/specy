import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Loader2, Package, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions';
import { deleteProduct, fetchProducts, type Product as LegacyProduct } from '@/services/events/productService';
import { fetchMentorGroups, type MentorGroup } from '@/services/mentorGroupService';
import { AdminCard, AdminPageLayout, EditButton, DeleteButton } from '@/components/admin/ui';
import { getIconByName } from '@/constants/pillaricons';
import { Badge } from '@/components/ui/badge';
import { DeleteProductDialog } from '@/components/events/DeleteProductDialog';
import { TenantCustomFieldsDialog } from '@/components/products/TenantCustomFieldsDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ProductCatalogue() {
  const navigate = useNavigate();
  const { language, theme } = useTheme();
  const { activeTenantId } = useActiveWorkspace();
  const permissions = usePermissions();
  const [products, setProducts] = useState<LegacyProduct[]>([]);
  const [mentorGroups, setMentorGroups] = useState<MentorGroup[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<LegacyProduct | null>(null);
  const activeTenantRef = useRef(activeTenantId);
  activeTenantRef.current = activeTenantId;

  const load = useCallback(async () => {
    if (!activeTenantId) {
      setProducts([]);
      setMentorGroups([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [fetchedProducts, fetchedGroups] = await Promise.all([
        fetchProducts(activeTenantId),
        fetchMentorGroups(activeTenantId),
      ]);
      if (activeTenantRef.current !== activeTenantId) return;
      setProducts(fetchedProducts);
      setMentorGroups(fetchedGroups);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Produkte konnten nicht geladen werden.');
    } finally {
      if (activeTenantRef.current === activeTenantId) setIsLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => { void load(); }, [load]);

  const normalizedQuery = query.trim().toLocaleLowerCase('de');
  const visibleProducts = useMemo(() => products.filter((product) =>
    product.name.toLocaleLowerCase('de').includes(normalizedQuery)), [products, normalizedQuery]);

  const getGroupNames = (groupIds?: number[]) => {
    if (!groupIds?.length) return [];
    return groupIds.map((id) => {
      const group = mentorGroups.find((entry) => entry.id === id);
      return group ? group.name : `Unbekannt (${id})`;
    });
  };

  const formatSalary = (product: LegacyProduct) => {
    if (!product.salary_type || product.salary_type === 'Standard') return 'Standard';
    if (product.salary_type === 'Fixpreis') {
      return `${product.salary !== undefined ? `${product.salary.toFixed(2)}€` : '-'} ${language === 'en' ? '(fixed)' : '(fix)'}`;
    }
    if (product.salary_type === 'Stundensatz') {
      return `${product.salary !== undefined ? `${product.salary.toFixed(2)}€/h` : '-/h'}`;
    }
    return '-';
  };

  const confirmDeleteProduct = (product: LegacyProduct) => {
    setProductToDelete(product);
    setDeleteDialogOpen(true);
  };

  const handleDeleteProduct = async () => {
    const product = productToDelete;
    if (!product || !activeTenantId) return;
    setIsDeleting(true);
    try {
      await deleteProduct(product.id, activeTenantId);
      toast.success('Produkt und zugehörige Veranstaltungen wurden gelöscht.');
      setDeleteDialogOpen(false);
      setProductToDelete(null);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Produkt konnte nicht gelöscht werden.');
    } finally {
      setIsDeleting(false);
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {visibleProducts.map((product) => (
                <AdminCard
                  key={product.id}
                  className="relative overflow-hidden cursor-pointer group"
                  clickable
                  onClick={() => navigate(`/products/manage/${product.id}`)}
                >
                  <div
                    className="h-28 rounded-t-lg flex items-center justify-center relative overflow-hidden"
                    style={{ background: product.gradient || 'linear-gradient(to right bottom, #3b82f6, #60a5fa, #93c5fd)' }}
                  >
                    <img
                      src={getIconByName(product.icon_name || 'balloon', theme === 'dark')}
                      alt={product.name}
                      className="w-12 h-12 transition-transform duration-200 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-200" />
                  </div>

                  <div className="p-5 flex flex-col flex-1">
                    <div className="mb-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-lg font-semibold mb-1 text-foreground group-hover:text-primary transition-colors duration-200">
                          {product.name}
                        </h3>
                        <ArrowUpRight className="h-4 w-4 mt-1 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                        {product.description_de || (language === 'en' ? 'No short description' : 'Keine Kurzbeschreibung')}
                      </p>
                    </div>

                    <div className="space-y-2.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={product.product_page_id ? 'secondary' : 'outline'} className="text-xs">
                          {product.product_page_id
                            ? (language === 'en' ? 'Product page connected' : 'Produktseite verbunden')
                            : (language === 'en' ? 'No product page' : 'Keine Produktseite')}
                        </Badge>
                        {product.is_mentor_product && (
                          <Badge variant="secondary" className="text-xs">
                            {language === 'en' ? 'Staff product' : 'Mitarbeiter-Produkt'}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-green-500 rounded-full shrink-0" />
                        <span className="text-sm font-medium text-muted-foreground">
                          {language === 'en' ? 'Compensation:' : 'Vergütung:'}
                        </span>
                        <span className="text-sm text-foreground">{formatSalary(product)}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 bg-purple-500 rounded-full shrink-0" />
                        <span className="text-sm font-medium text-muted-foreground">
                          {language === 'en' ? 'Staff:' : 'Mitarbeiter:'}
                        </span>
                        <span className="text-sm text-foreground">
                          {product.min_amount_mentors ?? 1}
                          {product.max_amount_mentors ? ` - ${product.max_amount_mentors}` : ''}
                        </span>
                      </div>

                      {product.description_effort && (
                        <div className="flex items-start gap-2">
                          <span className="w-2 h-2 bg-orange-500 rounded-full shrink-0 mt-1.5" />
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-muted-foreground">
                              {language === 'en' ? 'Effort:' : 'Aufwand:'}
                            </span>
                            <p className="text-sm text-foreground line-clamp-2">{product.description_effort}</p>
                          </div>
                        </div>
                      )}

                      <div className="flex items-start gap-2">
                        <span className="w-2 h-2 bg-red-500 rounded-full shrink-0 mt-1.5" />
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-muted-foreground">
                            {language === 'en' ? 'Required traits:' : 'Erforderliche Eigenschaften:'}
                          </span>
                          <p className="text-sm text-foreground truncate">
                            {product.assigned_groups?.length
                              ? getGroupNames(product.assigned_groups).join(', ')
                              : (language === 'en' ? 'None' : 'Keine')}
                          </p>
                        </div>
                      </div>
                    </div>

                    {permissions.canManageProducts && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <div className="flex gap-2">
                          <EditButton
                            size="sm"
                            className="flex-1"
                            onClick={() => navigate(`/products/manage/${product.id}`)}
                          >
                            {language === 'en' ? 'Edit' : 'Bearbeiten'}
                          </EditButton>
                          <DeleteButton
                            size="sm"
                            className="px-3"
                            onClick={() => confirmDeleteProduct(product)}
                          >
                            <span className="sr-only">
                              {language === 'en'
                                ? `Delete ${product.name} and all related events permanently`
                                : `„${product.name}“ und alle zugehörigen Veranstaltungen dauerhaft löschen`}
                            </span>
                          </DeleteButton>
                        </div>
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground/60 text-center mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                      {language === 'en' ? 'Click to view details' : 'Klicken für Details'}
                    </div>
                  </div>
                </AdminCard>
              ))}
            </div>
          ) : (
            <AdminCard className="border-dashed p-6 text-sm text-muted-foreground">Keine Produkte gefunden.</AdminCard>
          )}
        </div>
      )}

      <DeleteProductDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onDelete={handleDeleteProduct}
        isDeleting={isDeleting}
        ProductName={productToDelete?.name ?? ''}
      />
    </AdminPageLayout>
  );
}
