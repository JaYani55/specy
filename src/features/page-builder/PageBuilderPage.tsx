import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useTheme } from '@/contexts/ThemeContext';
import { getLegacyProductPageContext } from './legacy/productPageService';
import { getPage, getSchema } from '@/services/pageService';
import { getServiceProductByPage, type ServiceProduct } from '@/services/productService';
import { getEventPageAggregateByPage, type EventPageAggregate } from '@/services/events/eventPageService';
import { getSchemaConsolePath } from '@/utils/schemaPaths';
import type { PageBuilderData, PageRecord, PageSchema } from '@/types/pagebuilder';
import { LegacyProductContentEditor } from './LegacyProductContentEditor';
import { SchemaContentEditor } from './SchemaContentEditor';

const PageBuilderPage: React.FC = () => {
  const { id, schemaSlug, tenantSlug, pageId } = useParams<{
    id?: string;
    schemaSlug?: string;
    tenantSlug?: string;
    pageId?: string;
  }>();
  const navigate = useNavigate();
  const { language } = useTheme();
  const languageRef = useRef(language);
  languageRef.current = language;
  const [legacyContent, setLegacyContent] = useState<PageBuilderData | null>(null);
  const [productName, setProductName] = useState('');
  const [schemaContent, setSchemaContent] = useState<Record<string, unknown> | null>(null);
  const [schema, setSchema] = useState<PageSchema | null>(null);
  const [page, setPage] = useState<PageRecord | null>(null);
  const [productAggregate, setProductAggregate] = useState<ServiceProduct | null>(null);
  const [eventAggregate, setEventAggregate] = useState<EventPageAggregate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isSchemaRoute = Boolean(schemaSlug);
  const isEditRoute = Boolean(pageId);

  useEffect(() => {
    let cancelled = false;
    let redirected = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      setLegacyContent(null);
      setProductName('');
      setSchemaContent(null);
      setSchema(null);
      setPage(null);
      setProductAggregate(null);
      setEventAggregate(null);
      try {
        if (isSchemaRoute && schemaSlug) {
          const loadedSchema = await getSchema(schemaSlug, tenantSlug);
          if (loadedSchema.entity_kind === 'event' && !isEditRoute) {
            throw new Error(languageRef.current === 'en'
              ? 'Create event pages from the event form so the event and page are linked safely.'
              : 'Erstelle Veranstaltungsseiten über das Veranstaltungsformular, damit Veranstaltung und Seite sicher verknüpft werden.');
          }
          if (cancelled) return;
          setSchema(loadedSchema);

          if (isEditRoute && pageId) {
            const loadedPage = await getPage(pageId);
            if (loadedPage.schema_id !== loadedSchema.id
              || (loadedPage.tenant_id ?? null) !== (loadedSchema.tenant_id ?? null)) {
              throw new Error(languageRef.current === 'en'
                ? 'This page does not belong to the selected schema and workspace.'
                : 'Diese Seite gehört nicht zum ausgewählten Schema und Workspace.');
            }
            if (cancelled) return;
            setPage(loadedPage);
            setSchemaContent(loadedPage.content);
            setProductName(loadedPage.name);

            if (loadedSchema.entity_kind === 'service-product') {
              if (!loadedSchema.tenant_id) {
                throw new Error(languageRef.current === 'en'
                  ? 'The product schema is not assigned to a workspace.'
                  : 'Das Produktschema ist keinem Workspace zugeordnet.');
              }
              const aggregate = await getServiceProductByPage(loadedPage.id, loadedSchema.tenant_id);
              if (cancelled) return;
              setProductAggregate(aggregate);
            } else if (loadedSchema.entity_kind === 'event') {
              if (!loadedSchema.tenant_id) throw new Error('Event schema must belong to a workspace.');
              const aggregate = await getEventPageAggregateByPage(loadedPage.id, loadedSchema.tenant_id);
              if (cancelled) return;
              setEventAggregate(aggregate);
            }
          } else if (!isEditRoute) {
            setProductName(loadedSchema.name);
          }
          return;
        }

        if (!id) {
          throw new Error(languageRef.current === 'en' ? 'No page or product was selected.' : 'Es wurde keine Seite und kein Produkt ausgewählt.');
        }

        // Compatibility entry point: resolve the old numeric product ID to its
        // linked canonical page. Schema-bound content is always edited at the
        // tenant/schema/page URL so it uses the correct schema and aggregate writer.
        const legacyProduct = await getLegacyProductPageContext(id);
        if (cancelled) return;
        setProductName(legacyProduct.name);

        if (legacyProduct.pageId && legacyProduct.schemaId) {
          const linkedSchema = await getSchema(legacyProduct.schemaId);
          if ((linkedSchema.tenant_id ?? null) !== (legacyProduct.tenantId ?? null)) {
            throw new Error(languageRef.current === 'en'
              ? 'The product and its content page belong to different workspaces.'
              : 'Das Produkt und seine Inhaltsseite gehören zu unterschiedlichen Workspaces.');
          }
          if (linkedSchema.entity_kind === 'event') {
            throw new Error(languageRef.current === 'en'
              ? 'This page belongs to an event schema and cannot be edited as a product.'
              : 'Diese Seite gehört zu einem Veranstaltungsschema und kann nicht als Produkt bearbeitet werden.');
          }
          redirected = true;
          navigate(`${getSchemaConsolePath(linkedSchema)}/edit/${legacyProduct.pageId}`, { replace: true });
          return;
        }

        if (!legacyProduct.pageId) {
          throw new Error(languageRef.current === 'en'
            ? 'This older product has no linked content page. Create schema-based products from Product schemas.'
            : 'Dieses ältere Produkt hat noch keine verknüpfte Inhaltsseite. Schema-basierte Produkte werden unter Produktschemata angelegt.');
        }

        // Keep the fixed-layout editor only for historical pages without a
        // schema. It cannot edit schema-defined or aggregate-backed content.
        setLegacyContent(legacyProduct.product as PageBuilderData | null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error
            ? loadError.message
            : languageRef.current === 'en' ? 'The page could not be loaded.' : 'Die Seite konnte nicht geladen werden.');
        }
      } finally {
        if (!cancelled && !redirected) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [id, schemaSlug, tenantSlug, pageId, isSchemaRoute, isEditRoute, navigate]);

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-3xl py-8">
        <Card>
          <CardHeader>
            <CardTitle>{language === 'en' ? 'PageBuilder could not open this content' : 'Der PageBuilder konnte diesen Inhalt nicht öffnen'}</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => navigate('/products/manage')}>
              {language === 'en' ? 'Back to product management' : 'Zurück zur Produktverwaltung'}
            </Button>
            <Button onClick={() => navigate('/products/schemas')}>
              {language === 'en' ? 'Open product schemas' : 'Produktschemata öffnen'}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (schema && schemaSlug) {
    return (
      <div className="container mx-auto py-8">
        <Button
          variant="ghost"
          onClick={() => navigate(getSchemaConsolePath(schema))}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {language === 'en' ? 'Back to entries' : 'Zurück zu den Einträgen'}
        </Button>
        <SchemaContentEditor
          schema={schema}
          schemaSlug={schema.api_slug || schemaSlug}
          pageId={page?.id}
          initialData={schemaContent}
          productAggregateId={productAggregate?.id}
          productVersion={productAggregate?.version}
          eventAggregateId={eventAggregate?.id}
          initialPageUpdatedAt={page?.updated_at}
          initialName={productName}
          initialSlug={page?.slug}
          initialStatus={page?.status}
        />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <Button variant="ghost" onClick={() => navigate('/products/manage')} className="mb-4">
        <ArrowLeft className="mr-2 h-4 w-4" />
        {language === 'en' ? 'Back to product management' : 'Zurück zur Produktverwaltung'}
      </Button>
      <h1 className="mb-4 text-3xl font-bold">
        {language === 'en' ? `Legacy content for ${productName}` : `Älterer Inhalt für ${productName}`}
      </h1>
      <LegacyProductContentEditor
        initialData={legacyContent}
        productId={id}
        productName={productName}
      />
    </div>
  );
};

export default PageBuilderPage;
