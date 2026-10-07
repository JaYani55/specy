import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

interface RequestButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
  isLoading?: boolean;
}

export const RequestButton = ({
  label,
  isLoading = false,
  disabled,
  className = "",
  ...props
}: RequestButtonProps) => {
  const { language } = useTheme();

  // Responsive labels (optional)
  const shortLabel = language === "en" ? "Request" : "Anfrage";
  const longLabel = language === "en" ? "Request to be a staff member" : "Anfrage als Mitarbeitende:r";

  return (
    <Button
      type="button"
      variant="request"
      size="xl"
      disabled={disabled || isLoading}
      isLoading={isLoading}
      className={`flex items-center justify-center ${className}`}
      {...props}
    >
      <Send className="h-4 w-4 mr-3 flex-shrink-0" />
      <span>
        <span className="block md:hidden">{shortLabel}</span>
        <span className="hidden md:block">{label ?? longLabel}</span>
      </span>
    </Button>
  );
};