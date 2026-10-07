import React from 'react';
import { useNavigate } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface AccessDeniedProps {
  language: 'en' | 'de';
}

export const AccessDenied = ({ language }: AccessDeniedProps) => {
  const navigate = useNavigate();
  
  return (
    <div className="flex flex-col items-center justify-center h-64 space-y-4">
      <ShieldAlert className="h-16 w-16 text-destructive" />
      <h2 className="text-2xl font-bold text-center">
        {language === "en" 
          ? "Access Denied" 
          : "Zugriff verweigert"}
      </h2>
      <p className="text-muted-foreground text-center max-w-md">
        {language === "en"
          ? "Staff can only view their own profile and coach profiles."
          : "Mitarbeitende können nur ihr eigenes Profil und Coach-Profile einsehen."}
      </p>
      <Button onClick={() => navigate('/profile')}>
        {language === "en" ? "Go to My Profile" : "Zu meinem Profil"}
      </Button>
    </div>
  );
};