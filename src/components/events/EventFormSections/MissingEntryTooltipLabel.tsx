import React from "react";
import { HelpCircle } from "lucide-react";
import { FormLabel } from "@/components/ui/form";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MissingEntryTooltipLabelProps {
  label: string;
  /**
   * Text of the tooltip shown while the field entry is missing.
   * When null/undefined, no tooltip trigger is rendered.
   */
  missingText?: string | null;
}

/**
 * Form label with a help indicator whose tooltip appears while the
 * corresponding field entry is missing. The tooltip explains what
 * entry is expected so the operator can fix the field directly.
 */
export function MissingEntryTooltipLabel({ label, missingText }: MissingEntryTooltipLabelProps) {
  return (
    <FormLabel className="flex items-center gap-1.5">
      <span>{label}</span>
      {missingText ? (
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                role="note"
                aria-label={missingText}
                className="inline-flex cursor-help rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <HelpCircle className="h-3.5 w-3.5 text-amber-500" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" align="start" className="max-w-64">
              {missingText}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </FormLabel>
  );
}
