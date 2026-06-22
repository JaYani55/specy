import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Logo from "@/components/shared/Logo";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { Loader2, AlertCircle } from "lucide-react";
import { AuthApiError } from '@supabase/supabase-js';

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  
  const navigate = useNavigate();
  const { login } = useAuth();
  const { language } = useTheme();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    
    if (!email || !password) {
      setError(language === "en" ? "Email and password are required" : "E-Mail und Passwort sind erforderlich");
      return;
    }
    
    setIsLoading(true);
    
    try {
      await login(email, password);
      
      // Only navigate if login was successful
      navigate("/", { replace: true });
    } catch (err: unknown) {
      console.error("Login error:", err);
      const errorObj = err as { name?: string; message?: string };
      const isAuthApiError = errorObj?.name === 'AuthApiError';
      const message = isAuthApiError || err instanceof Error ? (err as Error).message : String(err);
      const trimmedMessage = message?.trim() || '';

      if (trimmedMessage.includes('Email not confirmed') || trimmedMessage.includes('E-Mail nicht bestätigt')) {
        setError(language === "en" 
          ? "Please confirm your email address to log in." 
          : "Bitte bestätigen Sie Ihre E-Mail-Adresse, um sich anzumelden.");
      } else if (trimmedMessage.includes('Not permitted') || trimmedMessage.includes('Keine Berechtigung')) {
        setError(language === "en" 
          ? "You don't have permission to access this application" 
          : "Sie haben keine Berechtigung für diese Anwendung");
      } else {
        setError(trimmedMessage || (language === "en" ? "Login failed" : "Anmeldung fehlgeschlagen"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="container flex items-center justify-center min-h-screen">
      <div className="w-full max-w-md space-y-8 glass p-8 rounded-xl">
        <div className="space-y-2 text-center">
          <div className="flex justify-center pb-2">
            <Logo variant="login" className="max-w-full" />
          </div>
          <h1 className="text-3xl font-bold">
            {language === "en" ? "Welcome back" : "Willkommen zurück"}
          </h1>
          <p className="text-muted-foreground">
            {language === "en"
              ? "Enter your credentials to continue"
              : "Geben Sie Ihre Anmeldedaten ein"}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="sr-only">
              {language === "en" ? "Email" : "E-Mail"}
            </label>
            <Input
              id="email"
              type="email"
              placeholder={language === "en" ? "Email" : "E-Mail"}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isLoading}
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="password" className="sr-only">
              {language === "en" ? "Password" : "Passwort"}
            </label>
            <Input
              id="password"
              type="password"
              placeholder={language === "en" ? "Password" : "Passwort"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
            />
          </div>
          
          {error && (
            <div className="flex items-center gap-2 p-3 text-sm bg-destructive/10 text-destructive rounded-md">
              <AlertCircle className="h-4 w-4" />
              <p>{error}</p>
            </div>
          )}
          
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {language === "en" ? "Signing in..." : "Anmelden..."}
              </>
            ) : (
              language === "en" ? "Sign in" : "Anmelden"
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default Login;
