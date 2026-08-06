import { useState, useCallback, useEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { Product, fetchProducts, deleteProduct, updateProduct, createProduct } from '@/services/events/productService';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';

type EventSummary = {
  id: string;
  company: string;
};

const mapToEventSummaries = (rows: unknown[] | null | undefined): EventSummary[] => {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap<EventSummary>((row) => {
    if (!row || typeof row !== 'object') {
      return [];
    }

    const { id, company } = row as { id?: unknown; company?: unknown };

    if (typeof id !== 'string') {
      return [];
    }

    return [{
      id,
      company: typeof company === 'string' ? company : ''
    }];
  });
};

export function useProductManagement(onProductsChange?: () => void) {
  const { language } = useTheme();
  const { activeTenantId } = useActiveWorkspace();
  const [Products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [ProductToDelete, setProductToDelete] = useState<Product | null>(null);
  const [ProductToEdit, setProductToEdit] = useState<Product | null>(null);
  const [eventsUsingProduct, setEventsUsingProduct] = useState<{id: string; company: string}[]>([]);
  const [eventsUsingProductForEdit, setEventsUsingProductForEdit] = useState<{id: string; company: string}[]>([]);
  
  // Dialog states
  const [deleteProductDialogOpen, setDeleteProductDialogOpen] = useState(false);
  const [ProductInUseDialogOpen, setProductInUseDialogOpen] = useState(false);
  const [ProductEditWarningOpen, setProductEditWarningOpen] = useState(false);

  // Load Products data
  const loadProducts = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchProducts(activeTenantId);
      setProducts(data);
    } catch (error) {
      console.error('Error loading Products:', error);
      toast.error(language === 'en' ? 'Error loading Products' : 'Fehler beim Laden der Produkte');
    } finally {
      setIsLoading(false);
    }
  }, [activeTenantId, language]);

  // Create or update Product
  const createOrUpdateProduct = useCallback(async (ProductData: Omit<Product, "id">) => {
    setIsLoading(true);
    try {
      console.log("In createOrUpdateProduct, editing product:", editingProduct);
      
      // Make sure approved field is properly formatted as an array
      const preparedData: Omit<Product, "id"> = {
        ...ProductData,
        approved: ProductData.approved || [],
        is_mentor_product: ProductData.is_mentor_product || false
        // Remove any potential id field that might have been accidentally included
      };
      
      if (editingProduct) {
        console.log(`Updating product ID ${editingProduct.id}`, preparedData);
        const updatedProduct = await updateProduct(editingProduct.id, preparedData, activeTenantId);
        console.log("Update result:", updatedProduct);
        
        if (!updatedProduct) {
          throw new Error("Failed to update product");
        }
        
        toast.success(language === 'en' ? 'Product updated successfully' : 'Produkt erfolgreich aktualisiert');
      } else {
        console.log("Creating new product:", preparedData);
        await createProduct(preparedData, activeTenantId);
        toast.success(language === 'en' ? 'Product created successfully' : 'Produkt erfolgreich erstellt');
      }
      
      await loadProducts();
      setEditingProduct(null);
      
      if (onProductsChange) onProductsChange();
      return true;
    } catch (error) {
      console.error('Error saving Product:', error);
      toast.error(
        language === 'en' 
          ? `Error saving Product: ${error instanceof Error ? error.message : 'Unknown error'}` 
          : `Fehler beim Speichern des Produkts: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [activeTenantId, editingProduct, language, loadProducts, onProductsChange]);

  // Check if Product is in use and prepare for deletion
  const checkProductUsageForDelete = useCallback(async (product: Product) => {
    try {
      // First, get a sample row to check the column names
      const { data: columnData, error: columnError } = await supabase
        .from('mentorbooking_events')
        .select('*')
        .limit(1);
      
      if (columnError) {
        console.error('Error fetching column names:', columnError);
        // If we can't read the table, just allow the delete to proceed
        console.warn('Could not check event relationships, proceeding with delete anyway');
        setProductToDelete(product);
        setDeleteProductDialogOpen(true);
        return true;
      }
      
      // Check what columns exist in the events table
      const sampleRow = columnData?.[0] || {};
      const columnNames = Object.keys(sampleRow);
      console.log('Available columns in events table:', columnNames);
      
      // Find the correct product-related column
      let productColumnName: string | undefined;
      
      // Try some common naming patterns
      const possibleColumnNames = ['product_id', 'product_id', 'productid', 'ProductId', 'product_id', 'product_id'];
      for (const column of columnNames) {
        if (column.toLowerCase().includes('product') || possibleColumnNames.includes(column)) {
          productColumnName = column;
          break;
        }
      }
      
      if (!productColumnName) {
        console.warn('No product-related column found in mentorbooking_events, proceeding with delete anyway');
        setProductToDelete(product);
        setDeleteProductDialogOpen(true);
        return true;
      }
      
      console.log(`Using column '${productColumnName}' to check product references`);
      
      // Now query with the correct column name
      const { data: rawEvents, error: checkError } = await supabase
        .from('mentorbooking_events')
        .select('id, company')
        .eq(productColumnName, product.id);

      if (checkError) {
        console.warn(`Error checking relationships: ${checkError.message}, proceeding with delete`);
        setProductToDelete(product);
        setDeleteProductDialogOpen(true);
        return true;
      }

      const events = mapToEventSummaries(rawEvents);

      setProductToDelete(product);
      
      if (events.length > 0) {
        setEventsUsingProduct(events);
        setProductInUseDialogOpen(true);
        return false;
      } else {
        setDeleteProductDialogOpen(true);
        return true;
      }
    } catch (error) {
      console.error('Error checking Product usage:', error);
      // In case of any error, allow deletion to proceed with warning
      console.warn('Encountered error during relationship check, proceeding with delete dialog');
      setProductToDelete(product);
      setDeleteProductDialogOpen(true);
      
      toast.error(
        language === 'en' 
          ? `Warning: Could not verify product usage: ${error instanceof Error ? error.message : 'Unknown error'}`
          : `Warnung: Produktnutzung konnte nicht überprüft werden: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
      );
      
      return true;
    }
  }, [language]);

  // Delete Product
  const deleteProductById = useCallback(async () => {
    if (!ProductToDelete) return false;
    
    setIsDeleting(true);
    try {
      await deleteProduct(ProductToDelete.id, activeTenantId);
      toast.success(language === 'en' ? 'Product deleted successfully' : 'Produkt erfolgreich gelöscht');
      
      await loadProducts();
      if (onProductsChange) onProductsChange();
      return true;
    } catch (error) {
      console.error('Error deleting Product:', error);
      toast.error(
        language === 'en' 
          ? `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
          : `Fehler: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
      );
      return false;
    } finally {
      setIsDeleting(false);
      setProductToDelete(null);
      setDeleteProductDialogOpen(false);
    }
  }, [ProductToDelete, activeTenantId, language, loadProducts, onProductsChange]);

  // Check if Product is in use and prepare for editing
  const checkProductUsageForEdit = useCallback(async (product: Product) => {
    try {
      console.log(`useProductManagement: Checking usage for product ${product.id} before edit`);
      
      // Always set the editing product regardless of usage
      // But sanitize it first
      if (product) {
        console.log("useProductManagement: Setting editing product:", product);
        
        // Make sure all required fields have default values with proper typing
        const sanitizedProduct: Product = {
          ...product,
          name: product.name || '',
          description_de: product.description_de || '',
          description_effort: product.description_effort || '',
          // delivery_mode: product.delivery_mode || 'online', // REMOVED
          icon_name: product.icon_name || 'balloon',
          assigned_groups: product.assigned_groups || [],
          approved: product.approved || []
        };
        console.log("useProductManagement: Setting sanitized editing product:", sanitizedProduct);
        setEditingProduct(sanitizedProduct);
      } else {
        setEditingProduct(null);
      }
      
      // Continue with the rest of the function...
      // First, get a sample row to check the column names
      const { data: columnData, error: columnError } = await supabase
        .from('mentorbooking_events')
        .select('*')
        .limit(1);
      
      if (columnError) {
        console.error('Error fetching column names:', columnError);
        // If we can't read the table, just allow the edit to proceed
        console.warn('Could not check event relationships, proceeding with edit anyway');
        return true;
      }
      
      // Check what columns exist in the events table
      const sampleRow = columnData?.[0] || {};
      const columnNames = Object.keys(sampleRow);
      console.log('Available columns in events table:', columnNames);
      
      // Find the correct product-related column
      let productColumnName: string | undefined;
      
      // Try some common naming patterns
      const possibleColumnNames = ['product_id', 'product_id', 'productid', 'ProductId', 'product_id', 'product_id'];
      for (const column of columnNames) {
        if (column.toLowerCase().includes('product') || possibleColumnNames.includes(column)) {
          productColumnName = column;
          break;
        }
      }
      
      if (!productColumnName) {
        console.warn('No product-related column found in mentorbooking_events, proceeding with edit anyway');
        return true;
      }
      
      // Now query with the correct column name
      const { data: rawEvents, error: checkError } = await supabase
        .from('mentorbooking_events')
        .select('id, company')
        .eq(productColumnName, product.id);

      if (checkError) {
        console.warn(`Error checking relationships: ${checkError.message}, proceeding with edit`);
        return true;
      }

      const events = mapToEventSummaries(rawEvents);

      if (events.length > 0) {
        setEventsUsingProductForEdit(events);
        setProductToEdit(product);
        setProductEditWarningOpen(true);
        return false;
      } else {
        // No need to set editing product again, we did it at the start
        return true;
      }
    } catch (error) {
      console.error('Error checking Product usage for edit:', error);
      
      // In case of any error, allow editing to proceed
      console.warn('Encountered error during relationship check, proceeding with edit');
      
      // Sanitize and set the editing product
      if (product) {
        const sanitizedProduct: Product = {
          ...product,
          name: product.name || '',
          description_de: product.description_de || '',
          description_effort: product.description_effort || '',
          // delivery_mode: product.delivery_mode || 'online', // REMOVED
          icon_name: product.icon_name || 'balloon',
          assigned_groups: product.assigned_groups || [],
          approved: product.approved || []
        };
        setEditingProduct(sanitizedProduct);
      } else {
        setEditingProduct(null);
      }
      
      toast.error(
        language === 'en' 
          ? `Warning: Could not verify product usage: ${error instanceof Error ? error.message : 'Unknown error'}`
          : `Warnung: Produktnutzung konnte nicht überprüft werden: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
      );
      
      return true;
    }
  }, [language]);

  const confirmEdit = useCallback(() => {
    if (ProductToEdit) {
      console.log("useProductManagement: Confirming edit for product:", ProductToEdit);
      
      // Sanitize product before setting with proper typing
      const sanitizedProduct: Product = {
        ...ProductToEdit,
        name: ProductToEdit.name || '',
        description_de: ProductToEdit.description_de || '',
        description_effort: ProductToEdit.description_effort || '',
        // delivery_mode: ProductToEdit.delivery_mode || 'online', // REMOVED
        icon_name: ProductToEdit.icon_name || 'balloon',
        assigned_groups: ProductToEdit.assigned_groups || [],
        approved: ProductToEdit.approved || []
      };
      
      setEditingProduct(sanitizedProduct);
      setProductToEdit(null);
      return true;
    }
    return false;
  }, [ProductToEdit]);

  // Create a helper function to sanitize products before setting them
  const sanitizeAndSetEditingProduct = useCallback((product: Product | null) => {
    if (product) {
      console.log("useProductManagement: Original product for editing:", product);
      
      // Directly set the editing product with proper sanitization inline
      const sanitizedProduct: Product = {
        ...product,
        id: product.id,
        name: product.name || '',
        description_de: product.description_de || '',
        description_effort: product.description_effort || '',
        // delivery_mode: product.delivery_mode || 'online', // REMOVED
        icon_name: product.icon_name || 'balloon',
        assigned_groups: Array.isArray(product.assigned_groups) ? product.assigned_groups : [],
        salary_type: product.salary_type,
        salary: typeof product.salary === 'number' ? product.salary : undefined,
        min_amount_mentors: product.min_amount_mentors || undefined,
        max_amount_mentors: product.max_amount_mentors,
        approved: Array.isArray(product.approved) ? product.approved : [],
        is_mentor_product: product.is_mentor_product || false
      };
      setEditingProduct(sanitizedProduct);
      console.log("useProductManagement: Set editingProduct successfully");
    } else {
      setEditingProduct(null);
      console.log("useProductManagement: Cleared editingProduct");
    }
  }, []);

  // Add the missing getUsedIcons function
  const getUsedIcons = useCallback(() => {
    return Products.map(product => product.icon_name).filter(Boolean);
  }, [Products]);

  return {
    Products,
    isLoading,
    editingProduct,
    isDeleting,
    ProductToDelete,
    ProductToEdit,
    eventsUsingProduct,
    eventsUsingProductForEdit,
    deleteProductDialogOpen,
    ProductInUseDialogOpen,
    ProductEditWarningOpen,
    loadProducts,
    createOrUpdateProduct,
    checkProductUsageForDelete,
    deleteProductById,
    checkProductUsageForEdit,
    confirmEdit,
    getUsedIcons, // Make sure this is included in the return
    // Use the original setter but with helper function
    setEditingProduct: sanitizeAndSetEditingProduct,
    setDeleteProductDialogOpen,
    setProductInUseDialogOpen,
    setProductEditWarningOpen
  };
}