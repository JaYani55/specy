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
            {language === 'en' ? 'Menu card color (optional)' : 'Farbe der Produktkarte (optional)'}
          </FormLabel>
          <FormDescription className="text-base">
            {language === 'en'
              ? 'This is purely visual and only changes how the product appears in menu cards. Leave it blank to use the default menu style; it does not affect price or staff requirements.'
              : 'Diese Farbe ist rein optisch und ändert nur die Darstellung des Produkts in Menükarten. Leer lassen verwendet den Menü-Standard; Preis und Personalbedarf bleiben unverändert.'}
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