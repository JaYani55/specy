import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { ProductFormValues } from '../types';
import { useTheme } from '@/contexts/ThemeContext';
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

export function ProductFormGradient({ form }: ProductFormGradientProps) {
  const { language } = useTheme();

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
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}
