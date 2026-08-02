import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, Bot, Building2, Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import Logo from '@/components/shared/Logo';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { supabase } from '@/lib/supabase';
import {
  approveAuthorization,
  denyAuthorization,
  getAuthorizationDetails,
  getConsentWorkspace,
  type ConsentWorkspace,
  type OAuthAuthorizationDetails,
} from '@/services/oauthConsentService';

type PageState = 'loading' | 'ready' | 'approving' | 'denying' | 'denied' | 'error';

const OAuthConsent = () => {
  const [searchParams] = useSearchParams();
  const authorizationId = searchParams.get('authorization_id');
  const { user } = useAuth();
  const { language } = useTheme();
  const navigate = useNavigate();

  const [state, setState] = useState<PageState>('loading');
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [workspace, setWorkspace] = useState<ConsentWorkspace | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isEn = language === 'en';

  // Check the real Supabase session before invoking OAuth SDK methods. The
  // AuthContext may have cached user data while the client has no session.
  useEffect(() => {
    if (!authorizationId) {
      setErrorMessage(
        isEn
          ? 'Missing authorization_id parameter. This page is part of the OAuth 2.1 flow — you cannot visit it directly.'
          : 'Fehlender authorization_id-Parameter. Diese Seite ist Teil des OAuth-2.1-Flows — Sie können sie nicht direkt aufrufen.',
      );
      setState('error');
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData.session) {
          navigate('/login', {
            replace: true,
            state: { returnTo: `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}` },
          });
          return;
        }

        const [authorizationDetails, consentWorkspace] = await Promise.all([
          getAuthorizationDetails(authorizationId),
          getConsentWorkspace().catch(() => null),
        ]);
        if (cancelled) return;

        if (authorizationDetails.redirect_url) {
          window.location.assign(authorizationDetails.redirect_url);
          return;
        }

        setDetails(authorizationDetails);
        if (consentWorkspace) setWorkspace(consentWorkspace);
        setState('ready');
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(
          error instanceof Error
            ? error.message
            : isEn
              ? 'The authorization request could not be loaded.'
              : 'Die Autorisierungsanfrage konnte nicht geladen werden.',
        );
        setState('error');
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [authorizationId, navigate, isEn]);

  const handleApprove = async () => {
    if (!authorizationId) return;
    setState('approving');
    try {
      const decision = await approveAuthorization(authorizationId);
      window.location.href = decision.redirect_url;
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : isEn
            ? 'Approval failed.'
            : 'Die Genehmigung ist fehlgeschlagen.',
      );
      setState('error');
    }
  };

  const handleDeny = async () => {
    if (!authorizationId) return;
    setState('denying');
    try {
      const decision = await denyAuthorization(authorizationId);
      if (decision?.redirect_url) {
        window.location.href = decision.redirect_url;
        return;
      }
      setState('denied');
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : isEn
            ? 'Denial failed.'
            : 'Die Ablehnung ist fehlgeschlagen.',
      );
      setState('error');
    }
  };

  if (state === 'loading' || (!user && state !== 'error')) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const scopes = details?.scope?.split(/\s+/).filter(Boolean) ?? [];
  const clientName = details?.client?.name || details?.client?.id || (isEn ? 'Unknown application' : 'Unbekannte Anwendung');
  const isBusy = state === 'approving' || state === 'denying';

  return (
    <div className="container flex min-h-screen items-center justify-center py-10">
      <Card className="w-full max-w-lg">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center pb-1">
            <Logo variant="login" className="max-w-full" />
          </div>
          <CardTitle className="text-2xl">
            {isEn ? 'Authorize agent access' : 'Agenten-Zugriff autorisieren'}
          </CardTitle>
          <CardDescription>
            {isEn
              ? 'An application requests access to your Specy workspace via MCP.'
              : 'Eine Anwendung fordert Zugriff auf Ihren Specy-Arbeitsbereich via MCP an.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {state === 'error' && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>{isEn ? 'Authorization not possible' : 'Autorisierung nicht möglich'}</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          {state === 'denied' && (
            <Alert>
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>{isEn ? 'Access denied' : 'Zugriff abgelehnt'}</AlertTitle>
              <AlertDescription>
                {isEn
                  ? 'The authorization request was denied. You can close this window.'
                  : 'Die Autorisierungsanfrage wurde abgelehnt. Sie können dieses Fenster schließen.'}
              </AlertDescription>
            </Alert>
          )}

          {(state === 'ready' || isBusy) && details && (
            <>
              <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-start gap-3">
                  <Bot className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{clientName}</p>
                    {details.client?.uri && (
                      <p className="break-all text-xs text-muted-foreground">{details.client.uri}</p>
                    )}
                    <p className="break-all text-xs text-muted-foreground">
                      {isEn ? 'Redirect:' : 'Weiterleitung:'} {details.redirect_uri}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">
                      {isEn ? 'Workspace binding' : 'Arbeitsbereich-Bindung'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {workspace
                        ? isEn
                          ? `The agent will act in workspace "${workspace.name}" (${workspace.slug}).`
                          : `Der Agent agiert im Arbeitsbereich „${workspace.name}“ (${workspace.slug}).`
                        : isEn
                          ? 'No active workspace found for your account. The agent token will not be bound to a workspace.'
                          : 'Kein aktiver Arbeitsbereich für Ihr Konto gefunden. Das Agenten-Token wird an keinen Arbeitsbereich gebunden.'}
                    </p>
                  </div>
                </div>

                {scopes.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium leading-none">
                      {isEn ? 'Requested scopes' : 'Angeforderte Berechtigungen'}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {scopes.map((scope) => (
                        <Badge key={scope} variant="secondary">{scope}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {isEn
                  ? `Signed in as ${user?.email ?? ''}. By approving, you allow this application to act on your behalf with your roles until the grant is revoked or the token expires.`
                  : `Angemeldet als ${user?.email ?? ''}. Mit der Genehmigung erlauben Sie dieser Anwendung, mit Ihren Rollen in Ihrem Namen zu handeln, bis die Genehmigung widerrufen oder das Token abgelaufen ist.`}
              </p>

              <div className="flex gap-3">
                <Button className="flex-1" onClick={handleApprove} disabled={isBusy}>
                  {state === 'approving' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  {isEn ? 'Approve' : 'Genehmigen'}
                </Button>
                <Button className="flex-1" variant="outline" onClick={handleDeny} disabled={isBusy}>
                  {state === 'denying' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <X className="mr-2 h-4 w-4" />
                  )}
                  {isEn ? 'Deny' : 'Ablehnen'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default OAuthConsent;
