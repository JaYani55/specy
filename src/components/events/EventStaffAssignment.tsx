import { useEffect, useState } from 'react';
import { Save, Users } from 'lucide-react';
import { toast } from 'sonner';

import { StaffCombobox } from '@/components/events/StaffCombobox';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { Event } from '@/types/event';

interface EventStaffAssignmentProps {
  event: Event;
  isPastEvent: boolean;
  onSave: (staffIds: string[]) => Promise<void>;
}

export function EventStaffAssignment({ event, isPastEvent, onSave }: EventStaffAssignmentProps) {
  const { language } = useTheme();
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>(event.staff_members || []);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setSelectedStaffIds(event.staff_members || []);
  }, [event.staff_members]);

  const requiredStaffCount = event.required_staff_count || event.amount_requiredmentors || 1;
  const hasChanges = selectedStaffIds.join(',') !== (event.staff_members || []).join(',');

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(selectedStaffIds);
    } catch (error) {
      console.error('Error saving staff assignment:', error);
      toast.error(language === 'en' ? 'Could not save assigned staff' : 'Zugewiesene Mitarbeiter konnten nicht gespeichert werden');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Users className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div>
            <h3 className="text-xl font-semibold">
              {language === 'en' ? 'Assigned Staff' : 'Zugewiesene Mitarbeiter'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {language === 'en'
                ? `${selectedStaffIds.length} of ${requiredStaffCount} required staff positions filled`
                : `${selectedStaffIds.length} von ${requiredStaffCount} benötigten Stellen besetzt`}
            </p>
          </div>
        </div>

        <StaffCombobox
          value={selectedStaffIds}
          onChange={setSelectedStaffIds}
          disabled={isPastEvent || isSaving}
        />

        <div className="flex justify-end">
          <Button
            onClick={() => void handleSave()}
            disabled={isPastEvent || isSaving || !hasChanges}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isSaving
              ? (language === 'en' ? 'Saving...' : 'Speichern...')
              : (language === 'en' ? 'Save assigned staff' : 'Zugewiesene Mitarbeiter speichern')}
          </Button>
        </div>
      </div>
    </Card>
  );
}