import { useTheme } from '@/contexts/ThemeContext';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

interface DeleteProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => Promise<void>;
  isDeleting: boolean;
  ProductName: string;
}

export const DeleteProductDialog = ({
  open,
  onOpenChange,
  onDelete,
  isDeleting,
  ProductName
}: DeleteProductDialogProps) => {
  const { language } = useTheme();
  
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {language === "en" ? "Delete Product" : "Produkt löschen"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {language === "en"
              ? `Delete "${ProductName}" permanently? All linked Events, their public Event Pages, and archived Event history will also be deleted. This cannot be undone.`
              : `„${ProductName}“ dauerhaft löschen? Alle zugehörigen Veranstaltungen, öffentlichen Veranstaltungsseiten und archivierten Veranstaltungsdaten werden ebenfalls gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {language === "en" ? "Cancel" : "Abbrechen"}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onDelete();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={isDeleting}
          >
            {isDeleting ? (
              <div className="flex items-center gap-2">
                <div className="animate-spin h-4 w-4 border-2 border-white border-opacity-50 border-t-white rounded-full"></div>
                {language === "en" ? "Deleting..." : "Löschen..."}
              </div>
            ) : (
              language === "en" ? "Delete" : "Löschen"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};