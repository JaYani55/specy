import React, { useState, useEffect } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PenTool, Plus } from "lucide-react"; // Add Plus import
import { ProductForm } from './ProductForm';
import { DeleteProductDialog } from './DeleteProductDialog';
import { ProductInUseDialog } from './ProductInUseDialog';
import { ProductEditWarningDialog } from './ProductEditWarningDialog';
import { ProductFormValues } from '@/components/products/types';
import { useProductManagement } from '../../hooks/useProductManagement';
import { Product } from '../../services/events/productService';

interface ProductManagementModalProps {
  onProductsChange?: () => void;
  embedded?: boolean;
  initialProduct?: Product | null;
  onCancel?: () => void; // <-- add this
}

const ProductManagementModal: React.FC<ProductManagementModalProps> = ({ 
  onProductsChange,
  embedded = false,
  initialProduct = null,
  onCancel // <-- receive prop
}) => {
  const { language } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(embedded && initialProduct !== null);
  
  // Use our custom hook for Product management
  const ProductManager = useProductManagement(onProductsChange);
  const { loadProducts, setEditingProduct } = ProductManager;
  
  useEffect(() => {
    if (isOpen || embedded) {
      void loadProducts();
    }
  }, [embedded, isOpen, loadProducts]);

  // Set initial product when in embedded mode
  useEffect(() => {
    if (embedded && initialProduct) {
      console.log("ProductManagementModal: Setting initial product for embedded mode:", initialProduct);
      
      // Delay the setting to avoid race conditions
      setTimeout(() => {
        // Create a fresh deep copy with proper JSON conversion
        const productCopy = JSON.parse(JSON.stringify(initialProduct));
        console.log("ProductManagementModal: Created product copy:", productCopy);
        
        // Ensure all fields are present
        productCopy.name = productCopy.name || '';
        productCopy.description_de = productCopy.description_de || '';
        productCopy.description_effort = productCopy.description_effort || '';
        // productCopy.delivery_mode = productCopy.delivery_mode || 'online'; // REMOVED
        productCopy.icon_name = productCopy.icon_name || 'balloon';
        productCopy.assigned_groups = productCopy.assigned_groups || [];
        productCopy.approved = productCopy.approved || [];
        
        setEditingProduct(productCopy);
        setShowCreateForm(true);
      }, 100);
    } else if (embedded) {
      setEditingProduct(null);
      setShowCreateForm(true);
    }
  }, [embedded, initialProduct, setEditingProduct]);

  // Ensure logging doesn't include product IDs
  useEffect(() => {
    if (initialProduct) {
      const productForLogs = { ...initialProduct };
      delete productForLogs.id;
      console.log("ProductManagementModal - Received initial product:", productForLogs);
    }
  }, [initialProduct]);

  // Handle form submission
  const handleSubmit = async (values: ProductFormValues) => {
    console.log("ProductManagementModal: handling form submission", values);
    
    try {
      const ProductData: Omit<Product, "id"> = {
        name: values.name,
        description_de: values.description_de || '',
        description_effort: values.description_effort || '',
        // delivery_mode: values.delivery_mode || 'online', // REMOVED
        icon_name: values.icon_name || 'balloon',
        assigned_groups: Array.isArray(values.assigned_groups) 
          ? values.assigned_groups 
          : (values.assigned_groups ? [values.assigned_groups] : []), // Ensure it's always an array
        salary_type: values.salary_type,
        salary: values.salary,
        min_amount_mentors: values.min_amount_mentors,
        max_amount_mentors: values.max_amount_mentors,
        approved: Array.isArray(values.approved) 
          ? values.approved 
          : (values.approved ? [values.approved] : []), // Ensure it's always an array
        gradient: values.gradient,
        is_mentor_product: values.is_mentor_product || false
      };
      
      console.log("Calling createOrUpdateProduct with:", ProductData);
      console.log("assigned_groups type:", typeof ProductData.assigned_groups, "value:", ProductData.assigned_groups);
      console.log("approved type:", typeof ProductData.approved, "value:", ProductData.approved);
      console.log(`Approved mentors: ${ProductData.approved?.length || 0} mentors will be stored in database`);
      
      const success = await ProductManager.createOrUpdateProduct(ProductData);
      console.log("createOrUpdateProduct result:", success);
      
      if (success) {
        setShowCreateForm(false);
      }
    } catch (error) {
      console.error("Error in form submission handler:", error);
    }
  };

  // Handler for cancel button on form
  const handleCancel = () => {
    ProductManager.setEditingProduct(null);
    setShowCreateForm(false);
    if (onCancel) onCancel(); // <-- call parent handler
  };

  // The actual content of the modal
  const ModalContent = () => (
    <div>
      <div className="space-y-4">
        {/* Only show navigation buttons when NOT in embedded mode AND not showing any form */}
        {!embedded && !showCreateForm && !ProductManager.editingProduct && (
          <div className="flex items-center justify-between">
            <div className="flex space-x-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => {
                  console.log("New Product button clicked"); // Debug log
                  ProductManager.setEditingProduct(null);
                  setShowCreateForm(true);
                  console.log("showCreateForm set to true"); // Debug log
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                {language === 'en' ? 'New Product' : 'Neues Produkt'}
              </Button>
            </div>
            
            {/* View toggle buttons would only appear here when NOT in embedded mode */}
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Form section - Show when creating OR editing */}
          {(showCreateForm || ProductManager.editingProduct) && (
            <div className="md:col-span-2">
              <ProductForm
                editingProduct={ProductManager.editingProduct}
                isLoading={ProductManager.isLoading}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                getUsedIcons={ProductManager.getUsedIcons}
              />
            </div>
          )}
          
          {/* Debug info - temporary */}
          {process.env.NODE_ENV === 'development' && (
            <div className="md:col-span-2 text-xs text-muted-foreground border p-2 rounded">
              Debug: showCreateForm={String(showCreateForm)}, editingProduct={ProductManager.editingProduct ? 'exists' : 'null'}, embedded={String(embedded)}
            </div>
          )}
          
          {/* Products list/grid - only show when NOT in embedded mode and NOT showing form */}
          {!embedded && !showCreateForm && !ProductManager.editingProduct && (
            <div className="md:col-span-2">
              {/* This is where your products list/grid component would go */}
              {/* And where the view toggle buttons would make sense */}
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  {language === 'en' 
                    ? 'Click "New Product" to create a product or select an existing one to edit.'
                    : 'Klicken Sie auf "Neues Produkt", um ein Produkt zu erstellen, oder wählen Sie ein vorhandenes zum Bearbeiten aus.'
                  }
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Product Dialog */}
      {ProductManager.ProductToDelete && (
        <DeleteProductDialog
          open={ProductManager.deleteProductDialogOpen}
          onOpenChange={ProductManager.setDeleteProductDialogOpen}
          onDelete={async () => {
            await ProductManager.deleteProductById();
          }}
          isDeleting={ProductManager.isDeleting}
          ProductName={ProductManager.ProductToDelete.name}
        />
      )}

      {/* Product In Use Dialog */}
      {ProductManager.ProductToDelete && (
        <ProductInUseDialog
          open={ProductManager.ProductInUseDialogOpen}
          onOpenChange={ProductManager.setProductInUseDialogOpen}
          ProductName={ProductManager.ProductToDelete.name}
          eventsUsingProduct={ProductManager.eventsUsingProduct}
        />
      )}

      {/* Product Edit Warning Dialog */}
      {ProductManager.ProductToEdit && (
        <ProductEditWarningDialog
          open={ProductManager.ProductEditWarningOpen}
          onOpenChange={ProductManager.setProductEditWarningOpen}
          ProductName={ProductManager.ProductToEdit.name}
          eventsUsingProduct={ProductManager.eventsUsingProductForEdit}
          onContinueEdit={() => {
            ProductManager.confirmEdit();
            setShowCreateForm(true);
            ProductManager.setProductEditWarningOpen(false);
          }}
        />
      )}
    </div>
  );

  // If embedded mode is active, return content directly
  if (embedded) {
    return <ModalContent />;
  }

  // Otherwise return as a modal dialog
  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild className="Product-modal-trigger">
        <Button variant="outline" size="sm">
          <PenTool className="h-4 w-4 mr-2" />
          {language === 'en' ? 'Manage Products' : 'Produkte verwalten'}
        </Button>
      </DialogTrigger>
      
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {language === 'en' ? 'Manage Products' : 'Produkte verwalten'}
          </DialogTitle>
          <DialogDescription>
            {language === 'en' 
              ? 'Create, edit or delete Products used for categorizing events.'
              : 'Erstelle, bearbeite oder lösche Produkte zur Kategorisierung von Veranstaltungen.'
            }
          </DialogDescription>
        </DialogHeader>
        
        <ModalContent />
      </DialogContent>
    </Dialog>
  );
};

export default ProductManagementModal;