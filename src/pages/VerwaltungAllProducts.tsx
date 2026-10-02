import React, { useState, useEffect } from 'react';
import { useTheme } from "@/contexts/ThemeContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useNavigate } from "react-router-dom";
import { Package, Grid, List, ChevronDown, ChevronRight, Pencil, Trash2, ArrowUpRight, Grid3X3 } from 'lucide-react';

// Import consistent admin components
import { AdminPageLayout, AdminCard, AdminLoading } from '@/components/admin/ui';
import { AddButton, EditButton, DeleteButton } from '@/components/admin/ui';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { fetchProducts, deleteProduct, fetchMentors, Mentor } from "../services/events/productService";
import { fetchMentorGroups, MentorGroup } from "../services/mentorGroupService";
import ProductManagementModal from "@/components/events/ProductManagementModal";
import { Product } from "../services/events/productService";
import { getIconByName } from "@/constants/pillaricons";
import { DeleteProductDialog } from "@/components/events/DeleteProductDialog";
import { Badge } from "@/components/ui/badge";
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { toast } from 'sonner';

const VerwaltungManageProducts = () => {
  const { language, theme } = useTheme();
  const permissions = usePermissions();
  const navigate = useNavigate();
  const { activeTenantId } = useActiveWorkspace();
  
  const [products, setProducts] = useState<Product[]>([]);
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [mentorGroups, setMentorGroups] = useState<MentorGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showProductForm, setShowProductForm] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // Add permission check
  useEffect(() => {
    if (!permissions.canManageProducts) {
      navigate('/admin');
    }
  }, [permissions.canManageProducts, navigate]);

  useEffect(() => {
    const loadData = async () => {
      // Only load data if user has permission
      if (!permissions.canManageProducts) return;
      
      setIsLoading(true);
      try {
        // Load all data in parallel
        const [fetchedProducts, fetchedMentors, fetchedGroups] = await Promise.all([
          fetchProducts(),
          fetchMentors(),
          fetchMentorGroups()
        ]);
        
        setProducts(fetchedProducts);
        setMentors(fetchedMentors);
        setMentorGroups(fetchedGroups);
      } catch (error) {
        console.error("Error loading data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [permissions.canManageProducts]);

  // Add loading state while checking permissions
  if (!permissions.canManageProducts) {
    return null;
  }

  // Helper function to convert group IDs to names
  const getGroupNames = (groupIds?: number[]) => {
    if (!groupIds || !groupIds.length) return [];
    
    return groupIds.map(id => {
      const group = mentorGroups.find(g => g.id === id);
      return group ? group.name : `Unknown (${id})`;
    });
  };

  const handleEdit = (product: Product) => {
    console.log("VerwaltungManageProducts: Editing product:", product);
    const productCopy = JSON.parse(JSON.stringify(product));
    setSelectedProduct(productCopy);
    setShowProductForm(true);
  };

  const handleNewProduct = () => {
    // Navigate to create product with state indicating we came from all-products
    navigate('/admin/create-product', { state: { from: '/admin/all-products' } });
  };

  const handleProductsChange = () => {
    const loadProducts = async () => {
      setIsLoading(true);
      const fetchedProducts = await fetchProducts();
      setProducts(fetchedProducts);
      setIsLoading(false);
    };
    loadProducts();
    setShowProductForm(false);
  };

  const handleDeleteClick = (product: Product) => {
    setProductToDelete(product);
    setDeleteDialogOpen(true);
  };

  // Format salary for display
  const formatSalary = (product: Product) => {
    if (!product.salary_type || product.salary_type === 'Standard') {
      return language === 'en' ? 'Standard' : 'Standard';
    }
    
    if (product.salary_type === 'Fixpreis') {
      return `${product.salary !== undefined ? `${product.salary.toFixed(2)}€` : '-'} ${language === 'en' ? '(fixed)' : '(fix)'}`;
    }
    
    if (product.salary_type === 'Stundensatz') {
      return `${product.salary !== undefined ? `${product.salary.toFixed(2)}€/h` : '-/h'}`;
    }
    
    return '-';
  };

  const toggleRowExpansion = (productId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(productId)) {
      newExpanded.delete(productId);
    } else {
      newExpanded.add(productId);
    }
    setExpandedRows(newExpanded);
  };

  const renderGridView = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {products.map((product) => (
        <AdminCard
          key={product.id}
          className="relative overflow-hidden cursor-pointer group"
          clickable
          onClick={() => navigate(`/admin/product/${product.id}`)}
        >
          <div 
            className="h-28 rounded-t-lg flex items-center justify-center relative overflow-hidden"
            style={{ 
              background: product.gradient || 'linear-gradient(to right bottom, #3b82f6, #60a5fa, #93c5fd)' 
            }}
          >
            <img
              src={getIconByName(product.icon_name || "balloon", theme === "dark")}
              alt={product.name}
              className="w-12 h-12 transition-transform duration-200 group-hover:scale-110"
            />
            <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 transition-colors duration-200"></div>
          </div>
          
          <div className="p-5 flex flex-col flex-1">
            <div className="mb-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold mb-1 text-foreground group-hover:text-primary transition-colors duration-200">
                  {product.name}
                </h3>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
              {product.description_de && (
                <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                  {product.description_de}
                </p>
              )}
            </div>

            <div className="space-y-3 flex-1">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0 group-hover:bg-green-600 transition-colors duration-200"></div>
                <span className="text-sm font-medium text-muted-foreground">
                  {language === "en" ? "Compensation:" : "Vergütung:"}
                </span>
                <span className="text-sm text-foreground">
                  {formatSalary(product)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-purple-500 rounded-full flex-shrink-0 group-hover:bg-purple-600 transition-colors duration-200"></div>
                <span className="text-sm font-medium text-muted-foreground">
                  {language === "en" ? "Mentors:" : "Mentoren:"}
                </span>
                <span className="text-sm text-foreground">
                  {product.min_amount_mentors ?? 1}
                  {product.max_amount_mentors && ` - ${product.max_amount_mentors}`}
                </span>
              </div>

              {product.description_effort && (
                <div className="flex items-start gap-2">
                  <div className="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0 mt-1 group-hover:bg-orange-600 transition-colors duration-200"></div>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-muted-foreground">
                      {language === "en" ? "Effort:" : "Aufwand:"}
                    </span>
                    <div className="text-sm text-foreground mt-1">
                      {product.description_effort.length > 80 ? (
                        <>
                          {product.description_effort.substring(0, 80)}...
                          <span className="text-muted-foreground text-xs ml-1">
                            {language === "en" ? "more" : "mehr"}
                          </span>
                        </>
                      ) : (
                        product.description_effort
                      )}
                    </div>
                  </div>
                </div>
              )}

              {product.assigned_groups && product.assigned_groups.length > 0 && (
                <div className="flex items-start gap-2">
                  <div className="w-2 h-2 bg-red-500 rounded-full flex-shrink-0 mt-1 group-hover:bg-red-600 transition-colors duration-200"></div>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-muted-foreground">
                      {language === "en" ? "Required traits:" : "Erforderliche Eigenschaften:"}
                    </span>
                    <div className="text-sm text-foreground mt-1">
                      {getGroupNames(product.assigned_groups).join(", ")}
                    </div>
                  </div>
                </div>
              )}

              {product.approved && product.approved.length > 0 && (
                <div className="flex items-start gap-2">
                  <div className="w-2 h-2 bg-teal-500 rounded-full flex-shrink-0 mt-1 group-hover:bg-teal-600 transition-colors duration-200"></div>
                  <div className="flex-1">
                    <span className="text-sm font-medium text-muted-foreground">
                      {language === "en" ? "Approved mentors:" : "Freigegebene Mentoren:"}
                    </span>
                    <div className="text-sm text-foreground mt-1">
                      {product.approved
                        .map(uuid => {
                          const mentor = mentors.find(m => m.id === uuid);
                          return mentor ? mentor.name : "Unbekannt";
                        })
                        .slice(0, 3)
                        .join(", ")}
                      {product.approved.length > 3 && (
                        <span className="text-muted-foreground"> (+{product.approved.length - 3} more)</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex gap-2">
                <EditButton
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit(product);
                  }}
                  className="flex-1"
                >
                  {language === "en" ? "Edit" : "Bearbeiten"}
                </EditButton>
                <DeleteButton
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick(product);
                  }}
                  className="px-3"
                >
                  <span className="sr-only">
                    {language === "en" ? "Delete Product" : "Produkt löschen"}
                  </span>
                </DeleteButton>
              </div>
            </div>

            <div className="text-xs text-muted-foreground/60 text-center mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
              {language === "en" ? "Click to view details" : "Klicken für Details"}
            </div>
          </div>
        </AdminCard>
      ))}
    </div>
  );

  const renderListView = () => (
    <AdminCard>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12"></TableHead>
            <TableHead className="w-[250px] text-base font-semibold">{language === "en" ? "Name" : "Name"}</TableHead>
            <TableHead className="w-36 text-base font-semibold">{language === "en" ? "Compensation" : "Vergütung"}</TableHead>
            <TableHead className="w-24 text-base font-semibold">{language === "en" ? "Mentors" : "Mentoren"}</TableHead>
            <TableHead className="w-24 text-right text-base font-semibold">{language === "en" ? "Actions" : "Aktionen"}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center py-8 text-base">
                {language === "en" ? "No products found" : "Keine Produkte gefunden"}
              </TableCell>
            </TableRow>
          ) : (
            products.map((product) => (
              <React.Fragment key={product.id}>
                <TableRow 
                  className="cursor-pointer hover:bg-muted/50 group"
                  onClick={() => navigate(`/admin/product/${product.id}`)}
                >
                  <TableCell>
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => toggleRowExpansion(product.id, e)}
                        className="h-6 w-6 p-0 hover:bg-accent"
                      >
                        {expandedRows.has(product.id) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                      <div 
                        className="w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ 
                          background: product.gradient || 'linear-gradient(to right bottom, #3b82f6, #60a5fa, #93c5fd)' 
                        }}
                      >
                        <img
                          src={getIconByName(product.icon_name || "balloon", theme === "dark")}
                          alt={product.name}
                          className="w-4 h-4"
                        />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="w-[250px]">
                      <div className="font-semibold text-base truncate">{product.name}</div>
                      {product.description_de && (
                        <div className="text-sm text-muted-foreground truncate">
                          {product.description_de.length > 60 
                            ? `${product.description_de.substring(0, 60)}...` 
                            : product.description_de
                          }
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-base">
                      {formatSalary(product)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="text-base">
                      <span className="font-medium">{product.min_amount_mentors ?? 1}</span>
                      {product.max_amount_mentors && (
                        <span className="text-muted-foreground"> - {product.max_amount_mentors}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-2 justify-end">
                      <EditButton
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(product);
                        }}
                        className="h-9 w-9 p-0"
                      >
                        <Pencil className="h-4 w-4" />
                        <span className="sr-only">
                          {language === "en" ? "Edit" : "Bearbeiten"}
                        </span>
                      </EditButton>
                      <DeleteButton
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteClick(product);
                        }}
                        className="h-9 w-9 p-0"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">
                          {language === "en" ? "Delete" : "Löschen"}
                        </span>
                      </DeleteButton>
                    </div>
                  </TableCell>
                </TableRow>
                
                {expandedRows.has(product.id) && (
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={5} className="py-4">
                      <div className="pl-4 space-y-4">
                        <div>
                          <h4 className="font-semibold text-sm text-muted-foreground mb-2">
                            {language === "en" ? "All Required Traits:" : "Alle erforderlichen Eigenschaften:"}
                          </h4>
                          {product.assigned_groups && product.assigned_groups.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {getGroupNames(product.assigned_groups).map((groupName, index) => (
                                <Badge key={index} variant="secondary" className="text-xs">
                                  {groupName}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">
                              {language === "en" ? "No specific traits required" : "Keine spezifischen Eigenschaften erforderlich"}
                            </span>
                          )}
                        </div>

                        <div>
                          <h4 className="font-semibold text-sm text-muted-foreground mb-2">
                            {language === "en" ? "Approved Mentors:" : "Freigegebene Mentoren:"}
                          </h4>
                          {product.approved && product.approved.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {product.approved
                                .map(uuid => {
                                  const mentor = mentors.find(m => m.id === uuid);
                                  return mentor ? mentor.name : "Unbekannt";
                                })
                                .map((mentorName, index) => (
                                  <Badge key={index} variant="outline" className="text-xs">
                                    {mentorName}
                                  </Badge>
                                ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">
                              {language === "en" ? "No specific mentors approved - all eligible mentors can be assigned" : "Keine spezifischen Mentoren freigegeben - alle geeigneten Mentoren können zugewiesen werden"}
                            </span>
                          )}
                        </div>

                        {product.description_effort && (
                          <div>
                            <h4 className="font-semibold text-sm text-muted-foreground mb-2">
                              {language === "en" ? "Effort Description:" : "Aufwandsbeschreibung:"}
                            </h4>
                            <p className="text-sm text-foreground">
                              {product.description_effort}
                            </p>
                          </div>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </AdminCard>
  );

  if (isLoading) {
    return (
      <AdminPageLayout
        title={language === "en" ? "Product Management" : "Produktverwaltung"}
        icon={Package}
      >
        <AdminLoading language={language} />
      </AdminPageLayout>
    );
  }

  return (
    <AdminPageLayout
      title={language === "en" ? "Product Management" : "Produktverwaltung"}
      description={language === "en" 
        ? "Manage and configure all products and services" 
        : "Alle Produkte und Dienstleistungen verwalten und konfigurieren"}
      icon={Package}
      actions={
        // Only show the view toggle and new product button when NOT in form mode
        !showProductForm ? (
          <div className="flex items-center gap-3">
            {/* View toggle buttons */}
            <ToggleGroup 
              type="single" 
              value={viewMode} 
              onValueChange={(value) => setViewMode(value as 'grid' | 'list')}
            >
              <ToggleGroupItem value="grid" aria-label="Grid view">
                <Grid className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view">
                <List className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>
            <AddButton onClick={handleNewProduct}>
              {language === "en" ? "New Product" : "Neues Produkt"}
            </AddButton>
          </div>
        ) : null
      }
    >
      {showProductForm ? (
        <AdminCard>
          <ProductManagementModal
            embedded={true}
            initialProduct={selectedProduct}
            onProductsChange={handleProductsChange}
            onCancel={() => setShowProductForm(false)}
          />
        </AdminCard>
      ) : (
        <>
          {products.length === 0 ? (
            <AdminCard>
              <div className="text-center py-12">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {language === "en" ? "No products found" : "Keine Produkte gefunden"}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {language === "en" 
                    ? "Create your first product to get started." 
                    : "Erstellen Sie Ihr erstes Produkt, um zu beginnen."}
                </p>
                <AddButton onClick={handleNewProduct}>
                  {language === "en" ? "Create Product" : "Produkt erstellen"}
                </AddButton>
              </div>
            </AdminCard>
          ) : (
            <>
              {viewMode === 'grid' ? renderGridView() : renderListView()}
            </>
          )}
        </>
      )}

      {/* Delete dialog remains the same */}
      {productToDelete && (
        <DeleteProductDialog
          open={deleteDialogOpen}
          onOpenChange={(open) => {
            setDeleteDialogOpen(open);
            if (!open) setProductToDelete(null);
          }}
          onDelete={async () => {
            setIsDeleting(true);
            try {
              await deleteProduct(productToDelete.id, activeTenantId);
              setProducts(products.filter((p) => p.id !== productToDelete.id));
              setDeleteDialogOpen(false);
              setProductToDelete(null);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Produkt konnte nicht gelöscht werden.');
            } finally {
              setIsDeleting(false);
            }
          }}
          isDeleting={isDeleting}
          ProductName={productToDelete.name}
        />
      )}
    </AdminPageLayout>
  );
};

export default VerwaltungManageProducts;