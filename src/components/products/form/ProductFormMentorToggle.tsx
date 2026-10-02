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
import { Checkbox } from '@/components/ui/checkbox';

interface ProductFormMentorToggleProps {
  form: UseFormReturn<ProductFormValues>;
}

export function ProductFormMentorToggle({ form }: ProductFormMentorToggleProps) {
  const { language } = useTheme();
  
  return (
    <fieldset className="bg-muted/30 p-6 rounded-lg border border-border/50">
      <legend className="sr-only">
        <span lang={language === 'en' ? 'en' : 'de'}>
          {language === 'en' ? 'Staff Requirements Configuration' : 'Konfiguration des Personalbedarfs'}
        </span>
      </legend>
      
      <FormField
        control={form.control}
        name="is_mentor_product"
        render={({ field }) => (
          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
            <FormControl>
              <Checkbox
                id="is_mentor_product"
                checked={field.value || false}
                onCheckedChange={(checked) => {
                  field.onChange(checked);
                  // Clear mentor-related fields when unchecked
                  if (!checked) {
                    form.setValue('assigned_groups', []);
                    form.setValue('min_amount_mentors', undefined);
                    form.setValue('max_amount_mentors', undefined);
                    form.setValue('approved', []);
                  } else {
                    // Set default values when checked
                    form.setValue('min_amount_mentors', 1);
                  }
                }}
                className="mt-1"
                aria-describedby="mentor-toggle-description"
              />
            </FormControl>
            <div className="space-y-1 leading-none">
              <FormLabel 
                htmlFor="is_mentor_product"
                className="text-lg font-medium cursor-pointer"
              >
                <span lang={language === 'en' ? 'en' : 'de'}>
                  {language === 'en' ? 'Staff required' : 'Mitarbeitende erforderlich'}
                </span>
              </FormLabel>
              <FormDescription id="mentor-toggle-description" className="text-base">
                <span lang={language === 'en' ? 'en' : 'de'}>
                  {language === 'en' 
                    ? 'Check this if the product requires staff to participate in events'
                    : 'Aktivieren Sie diese Option, wenn für das Produkt Mitarbeitende an Veranstaltungen benötigt werden.'}
                </span>
              </FormDescription>
            </div>
          </FormItem>
        )}
      />
    </fieldset>
  );
}