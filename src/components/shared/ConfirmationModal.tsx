import React, { useState, useCallback, useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Loader2, SendHorizonal, X } from 'lucide-react';
import { Event } from '../../types/event';
import { useTheme } from '../../contexts/ThemeContext';

interface ConfirmationModalProps {
  event: Event | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  isLoading: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  event,
  open,
  onOpenChange,
  onConfirm,
  isLoading
}) => {
  const { language } = useTheme();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  // Reset success state when modal opens/closes or event changes
  useEffect(() => {
    if (!open) setIsSuccess(false);
  }, [open, event]);

  const handleOpenChange = (newOpen: boolean) => {
    if (isSubmitting && !newOpen) return;
    onOpenChange(newOpen);
  };

  const handleConfirm = useCallback(async () => {
    try {
      setIsSubmitting(true);
      await Promise.resolve(onConfirm());
      setIsSuccess(true);
    } catch (error) {
      setIsSuccess(false);
      // Optionally show error toast here
    } finally {
      setIsSubmitting(false);
    }
  }, [onConfirm]);

  if (!event) return null;

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex justify-between items-center">
            <AlertDialogTitle>
              {isSuccess
                ? (language === "en" ? "Thank you!" : "Danke!")
                : (language === "en" ? "Confirm Request" : "Anfrage bestätigen")
              }
            </AlertDialogTitle>
            <AlertDialogCancel asChild>
              <button
                className="ml-auto p-1 rounded hover:bg-muted"
                aria-label="Close"
                type="button"
              >
                <X className="h-5 w-5" />
              </button>
            </AlertDialogCancel>
          </div>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {isSuccess ? (
                <span className="text-lg block">
                  {language === "en"
                    ? "Your request has been received. Thank you for volunteering as a staff member!"
                    : "Deine Anfrage wurde erhalten. Danke, dass du dich als Mitarbeitende:r gemeldet hast!"}
                </span>
              ) : (
                <span className="text-lg block">
                  {language === "en"
                    ? `Are you sure you have time on ${event.date} at ${event.time} to take part as a staff member?`
                    : `Bist du sicher, dass du am ${event.date} um ${event.time} Zeit hast als Mitarbeitende:r dabei zu sein?`}
                </span>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!isSuccess && (
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>
              {language === "en" ? "Cancel" : "Abbrechen"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirm}
              className="bg-primary"
              disabled={isLoading || isSubmitting}
            >
              {(isLoading || isSubmitting) ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <SendHorizonal className="h-4 w-4 mr-2" />
              )}
              {language === "en" ? "Yes, I have time!" : "Ja, ich habe Zeit!"}
            </AlertDialogAction>
          </AlertDialogFooter>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default ConfirmationModal;