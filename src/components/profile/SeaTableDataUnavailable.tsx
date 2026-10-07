import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from 'lucide-react';

interface SeaTableDataUnavailableProps {
  language: 'en' | 'de';
  userId?: string;
  onRetry?: () => void;
}

export const SeaTableDataUnavailable: React.FC<SeaTableDataUnavailableProps> = ({
  language
}) => {
  return (
    <Card className="p-6 shadow-sm border-dashed">
      <CardHeader className="px-0 pt-0 text-center">
        <div className="bg-muted rounded-full p-3 mx-auto mb-4 w-fit">
          <Construction className="h-6 w-6 text-muted-foreground" />
        </div>
        <CardTitle className="flex justify-center items-center gap-2">
          {language === 'en' ? 'Profile Management Under Construction' : 'Profilverwaltung in Bearbeitung'}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0 text-center">
        <p className="text-muted-foreground">
          {language === 'en' 
            ? "The profile management system is currently being migrated to our new internal infrastructure. Access to detailed staff information will be available soon." 
            : "Das Profilverwaltungssystem wird derzeit auf unsere neue interne Infrastruktur migriert. Der Zugriff auf detaillierte Mitarbeiterinformationen wird in Kürze verfügbar sein."}
        </p>
      </CardContent>
    </Card>
  );
};