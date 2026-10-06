import React from "react";
import { FormField, FormItem, FormControl, FormMessage } from "@/components/ui/form";
import { StaffCombobox } from "../StaffCombobox";
import { MissingEntryTooltipLabel } from "./MissingEntryTooltipLabel";

export function StaffSection({ form, isLoading, language }) {
  const staffMembers = form.watch("staff_members") || [];
  const missing = staffMembers.length === 0;

  return (
    <FormField
      control={form.control}
      name="staff_members"
      render={({ field }) => (
        <FormItem>
          <MissingEntryTooltipLabel
            label={language === "en" ? "Staff members" : "Mitarbeiter"}
            missingText={missing
              ? language === "en"
                ? "No staff member is selected yet. Choose at least one staff member for this event."
                : "Es ist noch kein Mitarbeiter ausgewählt. Wähle mindestens einen Mitarbeiter für diese Veranstaltung."
              : null}
          />
          <FormControl>
            <StaffCombobox
              value={field.value || []}
              onChange={field.onChange}
              disabled={isLoading}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
