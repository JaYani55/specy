import React from "react";
import { FormField, FormItem, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { CompanyCombobox } from "../CompanyCombobox";
import { MissingEntryTooltipLabel } from "./MissingEntryTooltipLabel";

export function CompanySection({ form, isLoading, language }) {
  const company = (form.watch("company") || '').trim();
  const missing = company.length === 0;

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="company_id"
        render={({ field }) => (
          <FormItem>
            <MissingEntryTooltipLabel
              label={language === "en" ? "Existing Company (optional)" : "Bestehendes Unternehmen (optional)"}
              missingText={missing
                ? language === "en"
                  ? "Optional: select an existing company or enter a company name below. You can also save the event without a company — unless it gets a public event page, which requires a company."
                  : "Optional: wähle ein bestehendes Unternehmen aus oder gib unten einen Unternehmensnamen ein. Du kannst die Veranstaltung auch ohne Unternehmen speichern — öffentliche Veranstaltungsseiten erfordern jedoch ein Unternehmen."
                : null}
            />
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
            <MissingEntryTooltipLabel
              label={language === "en" ? "Company Name (optional)" : "Unternehmensname (optional)"}
              missingText={missing
                ? language === "en"
                  ? "Optional: enter a company name if the event belongs to a company. A new CRM company record is created automatically when you save."
                  : "Optional: gib einen Unternehmensnamen ein, wenn die Veranstaltung zu einem Unternehmen gehört. Beim Speichern wird automatisch ein neuer CRM-Firmeneintrag angelegt."
                : null}
            />
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
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
