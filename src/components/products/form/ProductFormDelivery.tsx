import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { ProductFormValues } from '../types';
import { useTheme } from '@/contexts/ThemeContext';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Product_ICONS, getIconByName } from '@/constants/pillaricons';

interface ProductFormDeliveryProps {
  form: UseFormReturn<ProductFormValues>;
  getUsedIcons: () => (string | null | undefined)[];
}

export function ProductFormDelivery({ form, getUsedIcons }: ProductFormDeliveryProps) {
  const { language, theme } = useTheme();
  void getUsedIcons;
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <FormField
        control={form.control}
        name="icon_name"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="text-lg">
              <span lang={language === 'en' ? 'en' : 'de'}>
                {language === 'en' ? 'Icon' : 'Symbol'}
              </span>
              <span className="text-red-500" aria-label={language === 'en' ? 'required' : 'erforderlich'}>*</span>
            </FormLabel>
            <Select 
              onValueChange={field.onChange} 
              value={field.value || 'balloon'} 
              defaultValue={field.value}
            >
              <FormControl>
                <SelectTrigger 
                  className="text-lg h-12"
                  aria-label={language === 'en' ? 'Select an icon for this product' : 'Symbol für dieses Produkt auswählen'}
                >
                  <SelectValue placeholder={
                    <span lang={language === 'en' ? 'en' : 'de'}>
                      {language === 'en' ? 'Select an icon' : 'Symbol auswählen'}
                    </span>
                  } />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {Product_ICONS.map((icon) => (
                  <SelectItem 
                    key={icon.name} 
                    value={icon.name} 
                    className="text-base"
                  >
                    <div className="flex items-center gap-2">
                      <img 
                        src={getIconByName(icon.name, theme === 'dark')} 
                        alt={`${icon.label} icon`}
                        className="h-7 w-7 object-contain"
                      />
                      <span>{icon.label}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage className="text-base" />
          </FormItem>
        )}
      />
    </div>
  );
}