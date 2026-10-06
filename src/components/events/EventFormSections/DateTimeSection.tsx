import React from "react";
import { FormField, FormItem, FormControl, FormMessage } from "@/components/ui/form";
import { TimePicker } from "../time-picker";
import { DurationPicker } from "../duration-picker";
import { MissingEntryTooltipLabel } from "./MissingEntryTooltipLabel";

export function DateTimeSection({ form, endTime, language, isLoading = false }) {
  const date = form.watch("date");
  const time = form.watch("time");
  const duration = form.watch("duration_minutes");

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <FormField
        control={form.control}
        name="date"
        render={({ field }) => (
          <FormItem>
            <MissingEntryTooltipLabel
              label={language === "en" ? "Date" : "Datum"}
              missingText={!date
                ? language === "en"
                  ? "The event date is missing. Please choose the date on which the event takes place."
                  : "Das Datum der Veranstaltung fehlt. Bitte wähle das Datum, an dem die Veranstaltung stattfindet."
                : null}
            />
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
            <MissingEntryTooltipLabel
              label={language === "en" ? "Start Time" : "Startzeit"}
              missingText={!time
                ? language === "en"
                  ? "The start time is missing. Please choose when the event starts."
                  : "Die Startzeit fehlt. Bitte wähle, wann die Veranstaltung beginnt."
                : null}
            />
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
            <MissingEntryTooltipLabel
              label={language === "en" ? "Duration (min)" : "Dauer (Minuten)"}
              missingText={!duration
                ? language === "en"
                  ? "The duration is missing. Please specify how long the event lasts in minutes."
                  : "Die Dauer fehlt. Bitte gib an, wie lange die Veranstaltung in Minuten dauert."
                : null}
            />
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
