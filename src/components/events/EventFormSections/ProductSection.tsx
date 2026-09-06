import React from "react";
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import type { Control, FieldValues, Path } from "react-hook-form";
import { ProductCombobox } from "../ProductCombobox";
import { Sparkles, Sparkle } from "lucide-react"; // Sparkle for trait separator
import { Product } from '@/components/products/types';

// Helper to format compensation
function formatCompensation(product: Product, language: string) {
  if (!product.salary_type || product.salary_type === "Standard") {
    return language === "en" ? "Standard" : "Standard";
  }
  if (product.salary_type === "Fixpreis") {
    return `${product.salary !== undefined ? `${product.salary.toFixed(2)}€` : "-"} ${language === "en" ? "(fixed)" : "(fix)"}`;
  }
  if (product.salary_type === "Stundensatz") {
    return `${product.salary !== undefined ? `${product.salary.toFixed(2)}€/h` : "-/h"}`;
  }
  return "-";
}

interface ProductSectionProps<TFieldValues extends FieldValues = FieldValues> {
  form: {
    control: Control<TFieldValues>;
  };
  selectedProduct: Product | null;
  groupNames: Record<string, string>;
  isLoading: boolean;
  language: string;
}

export function ProductSection<TFieldValues extends FieldValues = FieldValues>({
  form,
  selectedProduct,
  groupNames,
  isLoading,
  language,
}: ProductSectionProps<TFieldValues>) {
  return (
    <div className="mb-10">
      {/* Section Title with Icon */}
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="h-6 w-6 text-primary" />
        <span className="font-semibold text-xl">
          {language === "en" ? "Product" : "Produkt"}
        </span>
      </div>
      <FormField
        control={form.control}
        name={"product_id" as Path<TFieldValues>}
        render={({ field }) => (
          <FormItem>
            <FormControl>
              <div className="mt-2">
                <ProductCombobox
                  value={field.value}
                  onChange={field.onChange}
                  disabled={isLoading}
                />
              </div>
            </FormControl>
            <FormMessage className="text-base" />
            {selectedProduct && (
              <div className="flex flex-col gap-4 mt-6">
                {/* Beschreibung */}
                {selectedProduct.description_de && (
                  <div>
                    <div className="text-base font-semibold">
                      {language === "en" ? "Description" : "Beschreibung"}
                    </div>
                    <div className="text-base">{selectedProduct.description_de}</div>
                  </div>
                )}
                {/* Aufwandsbeschreibung */}
                {selectedProduct.description_effort && (
                  <div>
                    <div className="text-base font-semibold">
                      {language === "en" ? "Effort Description" : "Aufwandsbeschreibung"}
                    </div>
                    <div className="text-base">{selectedProduct.description_effort}</div>
                  </div>
                )}
                {/* Vergütung */}
                {selectedProduct.salary_type && (
                  <div>
                    <div className="text-base font-semibold">
                      {language === "en" ? "Compensation" : "Vergütung"}
                    </div>
                    <div className="text-base font-bold text-amber-700 dark:text-amber-300">
                      {formatCompensation(selectedProduct, language)}
                    </div>
                  </div>
                )}
                {/* Zugewiesene Gruppen */}
                {selectedProduct.assigned_groups && selectedProduct.assigned_groups.length > 0 && (
                  <div>
                    <div className="text-base font-semibold">
                      {language === "en" ? "Required Traits" : "Erforderliche Eigenschaften"}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-base text-black dark:text-white font-normal">
                      {selectedProduct.assigned_groups.map((groupId, idx, arr) => (
                        <React.Fragment key={groupId}>
                          <span>{groupNames[groupId] || groupId}</span>
                          {idx < arr.length - 1 && (
                            <Sparkle className="inline-block w-4 h-4 mx-1 text-black dark:text-white opacity-70" />
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </FormItem>
        )}
      />
    </div>
  );
}