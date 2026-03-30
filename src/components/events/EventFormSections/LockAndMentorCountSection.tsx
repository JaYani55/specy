import React, { useState, useEffect } from "react";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchStaffTraits, StaffTraitDefinition } from "@/services/staffRegistryService";

export function LockAndMentorCountSection({ form, selectedProduct, language, isLoading }) {
  const minMentors = selectedProduct?.min_amount_mentors ?? 1;
  const maxQuick = 8;
  const value = Number(form.watch("required_staff_count") ?? minMentors);
  const [availableTraits, setAvailableTraits] = useState<StaffTraitDefinition[]>([]);

  // Dynamically show custom if value is outside quick range
  const isQuickValue = value >= minMentors && value < minMentors + maxQuick;
  const [showCustom, setShowCustom] = useState(!isQuickValue);

  useEffect(() => {
    setShowCustom(!(value >= minMentors && value < minMentors + maxQuick));
  }, [value, minMentors]);

  useEffect(() => {
    const loadTraits = async () => {
      const traits = await fetchStaffTraits();
      setAvailableTraits(traits.filter((trait) => trait.isActive));
    };

    void loadTraits();
  }, []);

  const handleQuickSelect = (num: number) => {
    setShowCustom(false);
    form.setValue("required_staff_count", num, { shouldDirty: true, shouldValidate: true });
  };

  const handleMoreToggle = (checked: boolean) => {
    setShowCustom(checked);
    if (!checked && value >= minMentors + maxQuick) {
      form.setValue("required_staff_count", minMentors + maxQuick - 1, { shouldDirty: true, shouldValidate: true });
    }
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const num = Math.max(minMentors, Number(e.target.value) || minMentors);
    form.setValue("required_staff_count", num, { shouldDirty: true, shouldValidate: true });
  };

  return (
    <div className="space-y-6">
      <FormField
        control={form.control}
        name="required_staff_count"
        render={() => (
          <FormItem>
            <FormLabel>
              {language === "en" ? "Required Staff Count" : "Benötigte Mitarbeiteranzahl"}
            </FormLabel>
            <div className="flex flex-wrap gap-2 items-center">
              {!showCustom && (
                <>
                  {[...Array(maxQuick)].map((_, i) => {
                    const num = i + minMentors;
                    return (
                      <Button
                        key={num}
                        type="button"
                        onClick={() => handleQuickSelect(num)}
                        disabled={isLoading}
                        className={`w-8 h-8 p-0 nav-button mentor-count-btn${value === num ? " nav-button-active" : ""}`}
                      >
                        {num}
                      </Button>
                    );
                  })}
                </>
              )}
              <div className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={showCustom}
                  onChange={e => handleMoreToggle(e.target.checked)}
                  disabled={isLoading}
                  id="more-checkbox"
                  className="mr-1"
                />
                <label htmlFor="more-checkbox" className="text-sm cursor-pointer">
                  {language === "en" ? "More" : "Mehr"}
                </label>
              </div>
              {showCustom && (
                <Input
                  type="number"
                  min={minMentors}
                  value={value}
                  onChange={handleCustomChange}
                  disabled={isLoading}
                  className="w-20"
                />
              )}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="required_trait_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>
              {language === "en" ? "Required Trait (Optional)" : "Erforderliche Eigenschaft (optional)"}
            </FormLabel>
            <FormControl>
              <Select
                value={field.value == null ? "none" : String(field.value)}
                onValueChange={(nextValue) => {
                  field.onChange(nextValue === "none" ? null : Number(nextValue));
                }}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={language === "en" ? "Choose a trait" : "Eigenschaft auswählen"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {language === "en" ? "No trait requirement" : "Keine Eigenschaft erforderlich"}
                  </SelectItem>
                  {availableTraits.map((trait) => (
                    <SelectItem key={trait.id} value={String(trait.id)}>
                      {trait.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}