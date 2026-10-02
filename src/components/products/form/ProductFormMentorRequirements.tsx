import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { ProductFormValues } from '../types';
import { useTheme } from '@/contexts/ThemeContext';
import { MentorGroup } from '@/services/mentorGroupService';
import { Loader2, Info } from 'lucide-react';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ProductFormMentorRequirementsProps {
  form: UseFormReturn<ProductFormValues>;
  mentorGroups: MentorGroup[];
  loadingGroups: boolean;
}

export function ProductFormMentorRequirements({ 
  form, 
  mentorGroups, 
  loadingGroups 
}: ProductFormMentorRequirementsProps) {
  const { language } = useTheme();
  
  return (
    <div className="bg-muted/30 p-6 rounded-lg border border-border/50 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <FormField
          control={form.control}
          name="min_amount_mentors"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-lg">
                {language === 'en' ? 'Minimum Staff' : 'Mindestanzahl Mitarbeitende'}
              </FormLabel>
              <FormControl>
                <input
                  type="number"
                  min={1}
                  max={50}
                  className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-lg ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="1"
                  value={field.value || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                    field.onChange(value);
                  }}
                />
              </FormControl>
              <FormMessage className="text-base" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="max_amount_mentors"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-lg">
                {language === 'en' ? 'Maximum Staff' : 'Höchstanzahl Mitarbeitende'}
              </FormLabel>
              <FormControl>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-lg ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={language === 'en' ? 'No limit' : 'Keine Begrenzung'}
                  value={field.value || ''}
                  onChange={(e) => {
                    const value = e.target.value === '' ? undefined : parseInt(e.target.value, 10);
                    field.onChange(value);
                  }}
                />
              </FormControl>
              <FormDescription className="text-base">
                {language === 'en' ? 'Leave empty for no limit' : 'Leer lassen für keine Begrenzung'}
              </FormDescription>
              <FormMessage className="text-base" />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="assigned_groups"
        render={() => (
          <FormItem>
            <div className="mb-6">
              <FormLabel className="text-lg">
                {language === 'en' ? 'Required Criteria (Informational)' : 'Erforderliche Kriterien (Informativ)'}
              </FormLabel>
              <FormDescription className="text-base mt-2">
                {language === 'en' 
                  ? 'Select staff traits that would be beneficial for this product. These are informational only and do not automatically filter staff.'
                  : 'Wählen Sie Eigenschaften von Mitarbeitenden aus, die für dieses Produkt hilfreich sein können. Die Auswahl dient nur zur Information und filtert Mitarbeitende nicht automatisch.'
                }
              </FormDescription>
            </div>
            
            {loadingGroups ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="ml-2 text-lg">
                  {language === 'en' ? 'Loading criteria...' : 'Lade Kriterien...'}
                </span>
              </div>
            ) : mentorGroups.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground">
                <p className="text-lg">
                  {language === 'en' ? 'No criteria available' : 'Keine Kriterien verfügbar'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mentorGroups.map((group) => (
                  <FormField
                    key={group.id}
                    control={form.control}
                    name="assigned_groups"
                    render={({ field }) => {
                      return (
                        <FormItem
                          key={group.id}
                          className="flex flex-row items-start space-x-3 space-y-0"
                        >
                          <FormControl>
                            <Checkbox
                              checked={field.value?.includes(group.id)}
                              onCheckedChange={(checked) => {
                                const currentValues = field.value || [];
                                if (checked) {
                                  field.onChange([...currentValues, group.id]);
                                } else {
                                  field.onChange(currentValues.filter((value) => value !== group.id));
                                }
                              }}
                            />
                          </FormControl>
                          <FormLabel className="text-base font-normal cursor-pointer">
                            {group.name}
                          </FormLabel>
                        </FormItem>
                      );
                    }}
                  />
                ))}
              </div>
            )}
            
            
            <FormMessage className="text-base" />
          </FormItem>
        )}
      />
    </div>
  );
}