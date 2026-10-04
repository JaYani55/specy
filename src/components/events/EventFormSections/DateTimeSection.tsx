import React from "react";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { TimePicker } from "../time-picker";
import { DurationPicker } from "../duration-picker";

export function DateTimeSection({ form, endTime, language, isLoading = false }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <FormField
        control={form.control}
        name="date"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{language === "en" ? "Date" : "Datum"}</FormLabel>
            <FormControl>
              <input
                type="date"
                {...field}
                className="input input-bordered w-full"
                disabled={isLoading}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="time"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{language === "en" ? "Start Time" : "Startzeit"}</FormLabel>
            <FormControl>
              <TimePicker value={field.value} onChange={field.onChange} disabled={isLoading} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="duration_minutes"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{language === "en" ? "Duration (min)" : "Dauer (Minuten)"}</FormLabel>
            <FormControl>
              <DurationPicker value={field.value} onChange={field.onChange} disabled={isLoading} />
            </FormControl>
            <FormMessage />
            {endTime && (
              <div className="text-xs text-muted-foreground mt-1">
                {language === "en" ? "End time:" : "Endzeit:"} {endTime}
              </div>
            )}
          </FormItem>
        )}
      />
    </div>
  );
}