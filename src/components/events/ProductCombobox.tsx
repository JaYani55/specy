import * as React from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchProducts, Product } from "../../services/events/productService";
import { useTheme } from "../../contexts/ThemeContext";
import { useActiveWorkspace } from '@/contexts/ActiveWorkspaceContext';
import { getIconByName } from '@/constants/pillaricons';
import { Badge } from "@/components/ui/badge";
import { useRef } from "react";

interface ProductComboboxProps {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  disabled?: boolean;
}

export function ProductCombobox({ value, onChange, disabled = false }: ProductComboboxProps) {
  const { language, theme } = useTheme();
  const { activeTenantId } = useActiveWorkspace();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [searchText, setSearchText] = React.useState("");
  const [Products, setProducts] = React.useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = React.useState<Product | null>(null);
  const [highlightedIndex, setHighlightedIndex] = React.useState<number>(-1);
  const itemsRef = useRef<(HTMLDivElement | null)[]>([]);

  const loadProducts = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchProducts(activeTenantId);
      setProducts(data);

      if (value !== undefined) {
        const selected = data.find((product) => product.id === value);
        if (selected) {
          setSelectedProduct(selected);
        }
      }
    } catch (err) {
      console.error("Exception loading Products:", err);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId, value]);

  // Format salary display
  const formatSalary = (Product: Product) => {
    if (!Product.salary_type || Product.salary_type === 'Standard') {
      return language === 'en' ? 'Standard' : 'Standard';
    }
    
    if (Product.salary_type === 'Fixpreis') {
      return `${Product.salary !== undefined ? `${Product.salary.toFixed(2)}€` : '-'} ${language === 'en' ? '(fixed)' : '(fix)'}`;
    }
    
    if (Product.salary_type === 'Stundensatz') {
      return `${Product.salary !== undefined ? `${Product.salary.toFixed(2)}€/h` : '-/h'}`;
    }
    
    return '-';
  };

  // Debug log for value changes
  React.useEffect(() => {
    console.log("ProductCombobox value changed:", value, typeof value);
    if (value === undefined) {
      setSelectedProduct(null);
      return;
    }

    const productInState = Products.find((product) => product.id === value);
    if (productInState) {
      setSelectedProduct(productInState);
      return;
    }

    void loadProducts();
  }, [value, Products, loadProducts]);

  React.useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    void loadProducts();
  }, [open, loadProducts]);
  
  // Filter Products based on search text
  const filteredProducts = React.useMemo(() => {
    if (!searchText) return Products;
    
    const text = searchText.toLowerCase().trim();
    return Products.filter(Product => 
      Product.name.toLowerCase().includes(text)
    );
  }, [Products, searchText]);
  
  // Handle Product selection
  const selectProduct = (Product: Product) => {
    onChange(Product.id);
    setSelectedProduct(Product);
    setOpen(false);
  };

  // Handle clearing the Product
  const clearProduct = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(undefined);
    setSelectedProduct(null);
  };

  // Reset highlight when opening or filtering
  React.useEffect(() => {
    setHighlightedIndex(filteredProducts.length > 0 ? 0 : -1);
  }, [open, searchText, filteredProducts.length]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredProducts.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredProducts.length - 1
      );
    } else if (e.key === "Enter" && highlightedIndex >= 0) {
      e.preventDefault();
      selectProduct(filteredProducts[highlightedIndex]);
    }
  };

  // Scroll to highlighted item
  React.useEffect(() => {
    if (highlightedIndex >= 0 && itemsRef.current[highlightedIndex]) {
      itemsRef.current[highlightedIndex]?.scrollIntoView({
        block: "nearest",
      });
    }
  }, [highlightedIndex]);

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            disabled={disabled}
            className="w-full justify-between h-14 text-lg px-6"
            onKeyDown={handleKeyDown}
            tabIndex={0}
          >
            {selectedProduct ? (
              <div className="flex items-center gap-3">
                {selectedProduct.icon_name && (
                  <span className="flex-shrink-0 w-7 h-7">
                    <img 
                      src={getIconByName(selectedProduct.icon_name, theme === 'dark')} 
                      alt={selectedProduct.name} 
                      className="h-6 w-6 object-contain"
                    />
                  </span>
                )}
                <span className="text-lg">{selectedProduct.name}</span>
              </div>
            ) : (
              <span className="text-lg">{language === "en" ? "Select a Product..." : "Wähle ein Produkt..."}</span>
            )}
            <ChevronsUpDown className="ml-2 h-6 w-6 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[440px] p-0" align="start">
          <div
            tabIndex={0}
            onKeyDown={handleKeyDown}
            className="outline-none"
            style={{ outline: "none" }}
          >
            <div className="flex items-center border-b p-3">
              <Search className="mr-2 h-5 w-5 shrink-0 opacity-70" />
              <Input
                placeholder={language === "en" ? "Search..." : "Suchen..."}
                className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-lg"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
            {loading ? (
              <div className="flex items-center justify-center p-6">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <p className="text-lg">{language === "en" ? "Loading..." : "Wird geladen..."}</p>
              </div>
            ) : (
              <ScrollArea className="h-80">
                <div className="p-2">
                  {value !== undefined && (
                    <div
                      className="flex items-center px-2 py-2 rounded-md text-lg cursor-pointer hover:bg-muted text-muted-foreground"
                      onClick={clearProduct}
                    >
                      <span className="ml-10">{language === "en" ? "Clear selection" : "Auswahl aufheben"}</span>
                    </div>
                  )}
                  {filteredProducts.length === 0 ? (
                    <div className="text-center p-6 text-lg text-muted-foreground">
                      {language === "en" ? "No Products found" : "Keine Produkte gefunden"}
                    </div>
                  ) : (
                    filteredProducts.map((Product, idx) => (
                      <div
                        key={Product.id}
                        ref={el => itemsRef.current[idx] = el}
                        className={`
                          flex items-center justify-between px-3 py-2 rounded-md text-lg cursor-pointer
                          ${value === Product.id ? 'bg-primary/10' : ''}
                          ${highlightedIndex === idx ? 'bg-muted' : ''}
                        `}
                        onClick={() => selectProduct(Product)}
                        onMouseEnter={() => setHighlightedIndex(idx)}
                      >
                        {/* Bigger gradient dot */}
                        {Product.gradient && (
                          <div 
                            className="w-7 h-7 rounded-full mr-3 flex-shrink-0"
                            style={{ background: Product.gradient }}
                          />
                        )}
                        <div className="flex items-center">
                          {value === Product.id && (
                            <Check className="mr-3 h-6 w-6 text-primary" />
                          )}
                          <div className={`flex items-center gap-3 ${value === Product.id ? "ml-8" : "ml-10"}`}>
                            {Product.icon_name && (
                              <span className="flex-shrink-0 w-7 h-7">
                                <img 
                                  src={getIconByName(Product.icon_name, theme === 'dark')} 
                                  alt={Product.name} 
                                  className="h-6 w-6 object-contain"
                                />
                              </span>
                            )}
                            <span className="text-lg">{Product.name}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}