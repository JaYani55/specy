import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, AlertCircle } from 'lucide-react';

interface RegistrationInProcessProps {
  language: 'en' | 'de';
}

export const RegistrationInProcess: React.FC<RegistrationInProcessProps> = ({
  language
}) => {
  return (
    <Card className="p-6 shadow-md border border-amber-200 bg-amber-50">
      <CardHeader className="px-0 pt-0">
        <CardTitle className="text-amber-700 flex items-center gap-2">
          <Clock className="h-5 w-5" />
          {language === 'en' ? 'Registration In Process' : 'Registrierung wird bearbeitet'}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-amber-700 mb-2">
              {language === 'en' 
                ? 'Your staff profile is currently being processed. The data synchronization between our systems is still in progress.' 
                : 'Ihr Mitarbeiter-Profil wird derzeit bearbeitet. Die Datensynchronisation zwischen unseren Systemen ist noch im Gange.'}
            </p>
            <p className="text-sm text-amber-600">
              {language === 'en'
                ? 'Please check back later or contact support if you have any questions.'
                : 'Bitte schauen Sie später noch einmal vorbei oder wenden Sie sich bei Fragen an den Support.'}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};