import React from 'react';
import { UseFormReturn } from 'react-hook-form';
import { ProductFormValues, ExtendedMentor } from '../types';
import { useTheme } from '@/contexts/ThemeContext';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2 } from 'lucide-react';
import { Lightbulb } from 'lucide-react';

interface ProductFormApprovedMentorsProps {
  form: UseFormReturn<ProductFormValues>;
  mentors: ExtendedMentor[];
  loadingMentors: boolean;
}

export function ProductFormApprovedMentors({ 
  form, 
  mentors, 
  loadingMentors 
}: ProductFormApprovedMentorsProps) {
  const { language } = useTheme();
  
  return (
    <FormField
      control={form.control}
      name="approved"
      render={({ field }) => (
        <FormItem className="bg-muted/30 p-6 rounded-lg border border-border/50">
          <div className="mb-4">
            <FormLabel className="text-xl font-medium text-black block border-b pb-2">
              {language === 'en' ? 'Staff approved for this product' : 'Für das Produkt freigegebene Mitarbeitende'}
            </FormLabel>
            <FormDescription
              className="relative flex items-center gap-3 text-base mt-2 font-medium rounded-lg px-5 py-3 bg-yellow-50 text-black dark:bg-yellow-900 dark:text-black shadow-sm"
            >
              <span className="absolute -left-6 top-1/2 -translate-y-1/2">
                <span className="inline-flex items-center justify-center rounded-full bg-yellow-400 text-white shadow-lg h-10 w-10 border-2 border-yellow-300">
                  <Lightbulb className="h-6 w-6" />
                </span>
              </span>
              <span className="pl-8">
                {language === 'en'
                  ? <>
                      Select staff members that are generally approved for this product.<br />
                      Which staff members can see an event is determined <b>when creating an event</b>.
                    </>
                  : <>
                      Wählen Sie Mitarbeitende aus, die für dieses Produkt grundsätzlich freigegeben sind.<br />
                      Welche der hier freigegebenen Mitarbeitenden eine Veranstaltung <b>sehen</b> können, legen Sie <b>beim Erstellen einer Veranstaltung</b> fest.
                    </>
                }
              </span>
            </FormDescription>
          </div>

          {loadingMentors ? (
            <div className="flex items-center space-x-3 py-6 justify-center">
              <Loader2 className="h-7 w-7 animate-spin" />
              <span className="text-lg">{language === 'en' ? 'Loading staff...' : 'Lade Mitarbeitende...'}</span>
            </div>
          ) : mentors.length === 0 ? (
            <div className="text-center text-muted-foreground py-6 border rounded-md p-6 bg-background/60">
              <p className="mb-3 text-lg">{language === 'en' ? 'No staff available.' : 'Keine Mitarbeitenden verfügbar.'}</p>
              <p className="text-base text-muted-foreground">
                {language === 'en' 
                  ? 'Make sure staff members are available in this workspace.'
                  : 'Stellen Sie sicher, dass Mitarbeitende in diesem Workspace verfügbar sind.'}
              </p>
            </div>
          ) : (
            <div className="border rounded-md overflow-hidden bg-background">
              <div className="bg-muted/70 px-5 py-4 border-b flex justify-between items-center">
                <span className="text-lg font-medium">
                  {language === 'en' ? 'Staff members' : 'Mitarbeitende'}
                </span>
                <span className="text-base">
                  {field.value?.length || 0} {language === 'en' ? 'selected' : 'ausgewählt'}
                </span>
              </div>
              <div className="overflow-y-auto max-h-[400px]">
                {mentors.map((mentor) => (
                  <div 
                    key={mentor.id} 
                    className="flex items-center justify-between py-4 px-5 hover:bg-muted/30 border-b last:border-0"
                  >
                    <div className="flex items-center">
                      <Checkbox 
                        id={`mentor-${mentor.id}`}
                        className="h-6 w-6"
                        checked={field.value?.includes(mentor.id)}
                        onCheckedChange={(checked) => {
                          const newValue = checked
                            ? [...(field.value || []), mentor.id]
                            : (field.value || []).filter((id) => id !== mentor.id);
                          field.onChange(newValue);
                        }}
                      />
                      <label 
                        htmlFor={`mentor-${mentor.id}`}
                        className="text-lg ml-4 cursor-pointer"
                      >
                        {mentor.name}
                        {mentor.traits && mentor.traits.length > 0 && (
                          <span className="ml-3 text-blue-700 dark:text-blue-400 text-base font-medium">
                            [ {mentor.traits.join(' | ')} ]
                          </span>
                        )}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <FormMessage className="text-base" />
        </FormItem>
      )}
    />
  );
}