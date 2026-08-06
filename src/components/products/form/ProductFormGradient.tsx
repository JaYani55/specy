import React, { useEffect, useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import { ProductFormValues } from '../types';
import { useTheme } from '@/contexts/ThemeContext';
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { fetchProducts } from '@/services/events/productService';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { ProductColorGradientSelector } from './ProductColorGradientSelector';

interface ProductFormGradientProps {
  form: UseFormReturn<ProductFormValues>;
  productId?: number;
}

export function ProductFormGradient({ form, productId }: ProductFormGradientProps) {
  const { language } = useTheme();
  const { activeTenantId } = useActiveWorkspace();
  const [usedColors, setUsedColors] = useState<{ color: string; productName: string }[]>([]);
  
  useEffect(() => {
    const loadUsedColors = async () => {
      try {
        const products = await fetchProducts(activeTenantId);
        
        // Filter out the current product and collect colors that are already in use
        const colors = products
          .filter(p => p.id !== productId && p.gradient)
          .map(p => ({
            color: p.gradient as string,
            productName: p.name
          }));
        
        setUsedColors(colors);
        
        // If editing, set the current product's color in the form
        if (productId) {
          const currentProduct = products.find(p => p.id === productId);
          if (currentProduct?.gradient && !form.getValues('gradient')) {
            form.setValue('gradient', currentProduct.gradient);
          }
        }
      } catch (error) {
        console.error("Error loading used colors:", error);
      }
    };
    
    loadUsedColors();
  }, [activeTenantId, productId, form]);
  
  return (
    <FormField
      control={form.control}
      name="gradient"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-lg">
            {language === 'en' ? 'Product Card Color' : 'Produktkartenfarbe'}
          </FormLabel>
          <FormDescription className="text-base">
            {language === 'en' 
              ? 'Choose a solid color for your product card header' 
              : 'Wählen Sie eine Volltonfarbe für die Kopfzeile der Produktkarte'}
          </FormDescription>
          <FormControl>
            <ProductColorGradientSelector 
              value={field.value} 
              onChange={field.onChange}
              usedColors={usedColors}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}