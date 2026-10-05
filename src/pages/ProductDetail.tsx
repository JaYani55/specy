import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions'; // Add this import
import { fetchProductById, fetchMentors, Mentor, Product } from '@/services/events/productService';
import { fetchMentorGroups, MentorGroup } from '@/services/mentorGroupService'; // Add this import
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, Pencil, CheckCircle2, ExternalLink } from 'lucide-react';
import { getIconByName } from '@/constants/pillaricons';
import ProductManagementModal from '@/components/events/ProductManagementModal';
import { CustomFieldsDisplay } from '@/components/products/CustomFieldsDisplay';
import { ProductEventsPanel } from '@/components/products/ProductEventsPanel';
import { ProductCustomFieldSchemaDialog } from '@/components/products/ProductCustomFieldSchemaDialog';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { API_URL } from '@/lib/apiUrl';
import { getSchema, triggerRevalidation, type RevalidationResult } from '@/services/pageService';
import { RevalidationFeedback } from '@/components/revalidation/RevalidationFeedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { getSchemaConsolePath } from '@/utils/schemaPaths';
import { isCatalogueSchema } from '@/utils/schemaKinds';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';

const ProductDetail = () => {
  const { productId } = useParams<{ productId: string }>();
  const { language, theme } = useTheme();
  const permissions = usePermissions(); // Add this hook
  const { activeTenantId } = useActiveWorkspace();
  const activeTenantRef = useRef(activeTenantId);
  activeTenantRef.current = activeTenantId;
  const navigate = useNavigate();
  const [product, setProduct] = useState<Product | null>(null);
  const [mentors, setMentors] = useState<Mentor[]>([]);
  const [mentorGroups, setMentorGroups] = useState<MentorGroup[]>([]); // Add this state
  const [isLoading, setIsLoading] = useState(true);
  const [showEditForm, setShowEditForm] = useState(false);
  const [publicDataUrl, setPublicDataUrl] = useState<string | null>(null);
  const [productPageEditorPath, setProductPageEditorPath] = useState<string | null>(null);
  const [revalidationResult, setRevalidationResult] = useState<RevalidationResult | null>(null);


  // Add permission check
  useEffect(() => {
    if (!permissions.canViewAdminData && !permissions.canManageProducts) {
      navigate('/');
    }
  }, [permissions.canViewAdminData, permissions.canManageProducts, navigate]);

  useEffect(() => {
    setProduct(null);
    setShowEditForm(false);
  }, [activeTenantId]);

  useEffect(() => {
    document.title = product ? `${product.name} | Product Details` : 'Product Details';
  }, [product]);

  useEffect(() => {
    let cancelled = false;
    setPublicDataUrl(null);
    setProductPageEditorPath(null);
    const resolvePageLinks = async () => {
      if (!product || !activeTenantId || !product.product_page_id) return;
      try {
        const { data: page, error: pageError } = await supabase.from('pages')
          .select('slug, schema_id, status, id')
          .eq('id', product.product_page_id)
          .eq('tenant_id', activeTenantId)
          .maybeSingle();
        if (pageError) throw pageError;
        if (!page) return;
        const schema = await getSchema(page.schema_id);
        if (!isCatalogueSchema(schema.entity_kind) || schema.tenant_id !== activeTenantId) return;
        if (!cancelled) setProductPageEditorPath(`${getSchemaConsolePath(schema)}/edit/${page.id}`);
        if (page.status !== 'published' || schema.registration_status !== 'registered') return;
        const { data: tenant, error: tenantError } = await supabase.from('tenants').select('slug').eq('id', activeTenantId).maybeSingle();
        if (tenantError) throw tenantError;
        if (tenant?.slug && !cancelled) {
          setPublicDataUrl(`${API_URL}/api/products/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(page.slug)}`);
        }
      } catch (error) {
        console.error('Could not resolve product page links:', error);
      }
    };
    void resolvePageLinks();
    return () => { cancelled = true; };
  }, [activeTenantId, product]);

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      // Only load if user has permission
      if (!permissions.canViewAdminData && !permissions.canManageProducts) return;
      if (!activeTenantId) {
        setProduct(null);
        setIsLoading(false);
        return;
      }
      setProduct(null);
      setIsLoading(true);
      
      // Parse productId as a number since that's what the API expects
      const id = parseInt(productId || '0', 10);
      if (!id) {
        setIsLoading(false);
        return;
      }

      try {
        const [productData, mentorsData, groupsData] = await Promise.all([
          fetchProductById(id, activeTenantId),
          fetchMentors(),
          fetchMentorGroups(activeTenantId)
        ]);
        
        if (cancelled || activeTenantRef.current !== activeTenantId) return;
        setProduct(productData);
        setMentors(mentorsData);
        setMentorGroups(groupsData);
      } catch (error) {
        console.error('Error loading product details:', error);
      }
      
      if (!cancelled && activeTenantRef.current === activeTenantId) setIsLoading(false);
    };

    void loadData();
    return () => { cancelled = true; };
  }, [activeTenantId, permissions.canManageProducts, permissions.canViewAdminData, productId]);

  // Add loading state while checking permissions
  if (!permissions.canViewAdminData && !permissions.canManageProducts) {
    return null;
  }

  // Helper function to get group name from id
  const getGroupName = (id: number) => {
    const group = mentorGroups.find(g => g.id === id);
    return group ? group.name : `Unknown (${id})`;  // Changed from group_name to name
  };

  const handleProductsChange = () => {
    setRevalidationResult(null);
    if (productId) {
      const loadProduct = async () => {
        const id = parseInt(productId, 10);
        const requestedTenantId = activeTenantId;
        if (!requestedTenantId) return;
        const updatedProduct = await fetchProductById(id, requestedTenantId);
        if (activeTenantRef.current !== requestedTenantId) return;
        setProduct(updatedProduct);
        try {
          if (updatedProduct?.product_page_id) {
            const { data: page, error: pageError } = await supabase.from('pages')
              .select('slug, schema_id, status')
              .eq('id', updatedProduct.product_page_id)
              .eq('tenant_id', requestedTenantId)
              .maybeSingle();
            if (pageError) throw pageError;
            if (page?.status === 'published') {
              const schema = await getSchema(page.schema_id);
              if (schema.tenant_id === requestedTenantId && isCatalogueSchema(schema.entity_kind) && schema.registration_status === 'registered') {
                const result = await triggerRevalidation(schema.api_slug, page.slug);
                setRevalidationResult(result);
                if (!result.success) toast.warning('Produkt gespeichert, aber die Website konnte nicht aktualisiert werden.');
              }
            }
          }
        } catch (error) {
          console.error('Product was saved, but website refresh could not be checked:', error);
          setRevalidationResult({
            success: false,
            message: 'Produkt gespeichert; die Website-Aktualisierung konnte nicht geprüft werden.',
            diagnostics: { error: error instanceof Error ? error.message : 'Unbekannter Fehler.' },
          });
          toast.warning('Produkt gespeichert, aber die Website konnte nicht aktualisiert werden.');
        }
      };
      void loadProduct().catch((error) => toast.error(error instanceof Error ? error.message : 'Produkt konnte nicht geladen werden.'));
    }
    setShowEditForm(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-6xl mx-auto p-8 text-center">
        <h2 className="text-3xl font-semibold mb-6">
          {language === 'en' ? 'Product not found' : 'Produkt nicht gefunden'}
        </h2>
        <Button 
          onClick={() => navigate('/products/manage')}
          size="lg"
          className="text-lg px-6 py-6 h-auto"
        >
          {language === 'en' ? 'Back to Products' : 'Zurück zu Produkten'}
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-8 pb-24">
      {/* Navigation and edit controls */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="lg" 
            onClick={() => navigate('/products/manage')}
            className="text-base"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            {language === 'en' ? 'Back to Products' : 'Zurück zu Produkten'}
          </Button>
        </div>
        
        {/* Only show edit button if user can manage products */}
        <div className="flex flex-wrap justify-end gap-2">
          {productPageEditorPath && permissions.canManageProducts && (
            <Button variant="outline" onClick={() => navigate(productPageEditorPath)}>
              <ExternalLink className="mr-2 h-4 w-4" />Seiteninhalt bearbeiten
            </Button>
          )}
          {permissions.canManageProducts && product.integration_id && activeTenantId && (
            <ProductCustomFieldSchemaDialog
              productId={product.integration_id}
              tenantId={activeTenantId}
              version={product.version ?? 1}
              productName={product.name}
              onSaved={(schema, version) => setProduct((current) => current ? { ...current, custom_field_schema: schema, version } : current)}
            />
          )}
          {permissions.canManageProducts && (
            <Button onClick={() => setShowEditForm(true)} size="lg" className="text-base px-6">
              <Pencil className="h-5 w-5 mr-2" />
              {language === 'en' ? 'Edit Product' : 'Produkt bearbeiten'}
            </Button>
          )}
        </div>
      </div>

      {showEditForm ? (
        <div className="mb-12">
          <ProductManagementModal
            embedded={true}
            initialProduct={product}
            onProductsChange={handleProductsChange}
            onCancel={() => setShowEditForm(false)}
          />
        </div>
      ) : (
        <>
          {permissions.canManageAccounts && publicDataUrl && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{language === 'en' ? 'Dynamic product data' : 'Dynamische Produktdaten'}</p>
                <code className="block truncate text-xs text-muted-foreground">{publicDataUrl}</code>
              </div>
              <Button asChild size="sm" variant="outline">
                <a href={publicDataUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {language === 'en' ? 'Open JSON' : 'JSON öffnen'}
                </a>
              </Button>
            </div>
          )}
          {revalidationResult && !revalidationResult.success && (
            <Alert className="mb-5 border-amber-500 bg-amber-50 dark:bg-amber-950">
              <AlertTitle>Produkt gespeichert; Website-Aktualisierung fehlgeschlagen</AlertTitle>
              <AlertDescription><RevalidationFeedback result={revalidationResult} language={language} /></AlertDescription>
            </Alert>
          )}
          {/* Page title */}
          <h1 className="text-3xl md:text-4xl font-bold mb-8">
            {product.name}
          </h1>
          
          {/* Product header with gradient and icon */}
          <div 
            className="h-80 rounded-xl flex items-center justify-center mb-12 relative overflow-hidden shadow-lg"
            style={{ 
              background: product.gradient || 'linear-gradient(to right bottom, #3b82f6, #60a5fa, #93c5fd)' 
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-white/20 backdrop-blur-md rounded-full p-12 shadow-inner">
                <img
                  src={getIconByName(product.icon_name || "balloon", theme === "dark")}
                  alt={product.name}
                  className="w-32 h-32"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {/* Left column - Basic info */}
            <Card className="p-8 md:col-span-2 shadow-md">
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-semibold mb-6 pb-2 border-b">
                    {language === 'en' ? 'Description' : 'Beschreibung'}
                  </h2>
                  <p className="text-lg text-muted-foreground mb-6 whitespace-pre-wrap leading-relaxed">
                    {product.description_de || (language === 'en' ? 'No description available.' : 'Keine Beschreibung verfügbar.')}
                  </p>
                </div>
                
                {product.description_effort && (
                  <div>
                    <h2 className="text-2xl font-semibold mb-4">
                      {language === 'en' ? 'Effort Description' : 'Aufwandsbeschreibung'}
                    </h2>
                    <p className="text-lg text-muted-foreground whitespace-pre-wrap leading-relaxed">
                      {product.description_effort}
                    </p>
                  </div>
                )}
              </div>
            </Card>

            {/* Right column - Specifics */}
            <Card className="p-8 shadow-md">
              <div className="space-y-8">
                <div>
                  <h2 className="text-2xl font-semibold mb-6 pb-2 border-b">
                    {language === 'en' ? 'Compensation & Requirements' : 'Vergütung & Anforderungen'}
                  </h2>
                  
                  <div className="space-y-6">
                    {/* Removed Delivery Mode section */}
                    
                    <div className="flex flex-col gap-2">
                      <span className="text-lg font-medium">
                        {language === 'en' ? 'Compensation Type' : 'Vergütungsart'}
                      </span>
                      <Badge variant="outline" className="w-fit text-base py-1 px-3">
                        {product.salary_type || 'Standard'}
                        {product.salary_type !== 'Standard' && product.salary != null && (
                          <>: {product.salary_type === "Fixpreis"
                            ? `${product.salary.toFixed(2)}€`
                            : `${product.salary.toFixed(2)}€/h`}
                          </>
                        )}
                      </Badge>
                    </div>
                    
                    <div className="flex flex-col gap-2">
                      <span className="text-lg font-medium">
                        {language === 'en' ? 'Mentor Requirements' : 'Mentorenanforderungen'}
                      </span>
                      <div className="flex gap-3">
                        <Badge variant="outline" className="text-base py-1 px-3">
                          {language === 'en' ? 'Min:' : 'Min:'} {product.min_amount_mentors || 1}
                        </Badge>
                        {product.max_amount_mentors && (
                          <Badge variant="outline" className="text-base py-1 px-3">
                            {language === 'en' ? 'Max:' : 'Max:'} {product.max_amount_mentors}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                {product.assigned_groups && product.assigned_groups.length > 0 && (
                  <div>
                    <h2 className="text-2xl font-semibold mb-4 pb-2 border-b">
                      {language === 'en' ? 'Required Traits' : 'Erforderliche Eigenschaften'}
                    </h2>
                    <div className="flex flex-wrap gap-2 mt-4">
                      {product.assigned_groups.map((groupId, index) => (
                        <Badge key={index} variant="secondary" className="text-base py-1 px-3">
                          {getGroupName(groupId)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
                
                {product.approved && product.approved.length > 0 && (
                  <div>
                    <h2 className="text-2xl font-semibold mb-4 pb-2 border-b">
                      {language === 'en' ? 'Approved Mentors' : 'Freigegebene Mentoren'}
                    </h2>
                    <ul className="space-y-3 mt-4">
                      {product.approved.map((uuid, index) => {
                        const mentor = mentors.find(m => m.id === uuid);
                        return (
                          <li key={index} className="text-base flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-500" />
                            {mentor ? mentor.name : "Unknown"}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </Card>
          </div>
          <div className="mt-8">
            <CustomFieldsDisplay definitions={product.custom_field_schema?.product ?? {}} values={product.custom_fields} language={language} />
          </div>
          {activeTenantId && (
            <div className="mt-8">
              <ProductEventsPanel tenantId={activeTenantId} legacyProductId={product.id} />
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ProductDetail;