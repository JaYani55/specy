import React from "react";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { CompanyCombobox } from "../CompanyCombobox";

export function CompanySection({ form, isLoading, language }) {
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="company_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {language === "en" ? "Existing Company" : "Bestehendes Unternehmen"}
            </FormLabel>
            <FormControl>
              <CompanyCombobox
                value={field.value || ""}
                onChange={(id, name) => {
                  field.onChange(id);
                  form.setValue("company", name, { shouldDirty: true, shouldValidate: true });
                }}
                disabled={isLoading}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="company"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {language === "en" ? "Company Name" : "Unternehmensname"}
            </FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value || ""}
                placeholder={language === "en" ? "Type a company name" : "Unternehmensname eingeben"}
                disabled={isLoading}
                onChange={(event) => {
                  form.setValue("company_id", "", { shouldDirty: true, shouldValidate: true });
                  field.onChange(event.target.value);
                }}
              />
            </FormControl>
            <p className="text-sm text-muted-foreground">
              {language === "en"
                ? "Select an existing company or type a new one. A new CRM company record will be created automatically when you save."
                : "Wählen Sie ein bestehendes Unternehmen aus oder geben Sie ein neues ein. Beim Speichern wird automatisch ein neuer CRM-Firmeneintrag angelegt."}
            </p>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}