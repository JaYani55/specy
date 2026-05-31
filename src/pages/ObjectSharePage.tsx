import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileJson, Loader2, Lock } from 'lucide-react';
import NotFound from '@/pages/NotFound';
import { ObjectContentRenderer } from '@/components/objects/ObjectContentRenderer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { getPublicObjectByShareSlug } from '@/services/objectService';
import type { MarkdownObjectData, PublicObjectDefinition } from '@/types/objects';

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isMarkdownObjectData = (value: unknown): value is MarkdownObjectData => (
  isPlainObject(value)
  && isPlainObject(value.metadata)
  && Array.isArray(value.content)
);

const ObjectSharePage = () => {
  const { tenantName, objectShareSlug } = useParams<{ tenantName: string; objectShareSlug: string }>();
  const { language } = useTheme();
  const [objectDefinition, setObjectDefinition] = useState<PublicObjectDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantName || !objectShareSlug) {
      setError('not-found');
      setIsLoading(false);
      return;
    }

    const loadObject = async () => {
      try {
        setIsLoading(true);
        const definition = await getPublicObjectByShareSlug(tenantName, objectShareSlug);
        setObjectDefinition(definition);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load object.');
      } finally {
        setIsLoading(false);
      }
    };

    void loadObject();
  }, [tenantName, objectShareSlug]);

  const metadataEntries = useMemo(() => {
    if (!objectDefinition) {
      return [];
    }

    const data = objectDefinition.data;
    const metadata = isMarkdownObjectData(data)
      ? data.metadata
      : isPlainObject(data)
        ? data
        : null;

    if (!metadata) {
      return [];
    }

    return Object.entries(objectDefinition.schema)
      .filter(([fieldName]) => metadata[fieldName] !== undefined && metadata[fieldName] !== null && metadata[fieldName] !== '')
      .map(([fieldName, schema]) => ({
        fieldName,
        label: fieldName,
        description: schema.description,
        value: metadata[fieldName],
      }));
  }, [objectDefinition]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20 px-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error === 'Object not found.' || error === 'not-found') {
    return <NotFound />;
  }

  if (error === 'Authentication required.') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20 px-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              {language === 'en' ? 'Login required' : 'Anmeldung erforderlich'}
            </CardTitle>
            <CardDescription>
              {language === 'en'
                ? 'This document is only available to authenticated users.'
                : 'Dieses Dokument ist nur für angemeldete Nutzer verfügbar.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/login">{language === 'en' ? 'Go to login' : 'Zum Login'}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!objectDefinition) {
    return null;
  }

  const markdownData = isMarkdownObjectData(objectDefinition.data) ? objectDefinition.data : null;

  return (
    <div className="min-h-screen bg-muted/20 px-4 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{objectDefinition.name}</CardTitle>
            {objectDefinition.description ? (
              <CardDescription>{objectDefinition.description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-6">
            {metadataEntries.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {metadataEntries.map((entry) => (
                  <div key={entry.fieldName} className="rounded-xl border bg-muted/20 p-4">
                    <div className="text-sm font-medium">{entry.label}</div>
                    <div className="mt-1 break-words text-sm text-foreground/90">
                      {typeof entry.value === 'string' || typeof entry.value === 'number' || typeof entry.value === 'boolean'
                        ? String(entry.value)
                        : JSON.stringify(entry.value)}
                    </div>
                    {entry.description ? (
                      <p className="mt-2 text-xs text-muted-foreground">{entry.description}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {objectDefinition.agent_description ? (
              <div className="rounded-xl border bg-muted/20 p-4 text-sm text-muted-foreground">
                {objectDefinition.agent_description}
              </div>
            ) : null}

            {objectDefinition.object_type === 'markdown' && markdownData ? (
              <ObjectContentRenderer blocks={markdownData.content} tenantSlug={tenantName} />
            ) : (
              <div className="rounded-xl border bg-background p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <FileJson className="h-4 w-4" />
                  JSON
                </div>
                <pre className="overflow-auto whitespace-pre-wrap text-sm">
                  {JSON.stringify(objectDefinition.data, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ObjectSharePage;
