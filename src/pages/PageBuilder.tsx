import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageBuilderForm } from '@/components/pagebuilder/PageBuilderForm';
import { getProductPageData } from '@/services/productPageService';
import { getSchema, getPage } from '@/services/pageService';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageBuilderData, PageSchema, PageRecord } from '@/types/pagebuilder';

const PageBuilder: React.FC = () => {
  // Legacy route: /pagebuilder/:id
  const { id, schemaSlug, pageId } = useParams<{ id?: string; schemaSlug?: string; pageId?: string }>();
  const navigate = useNavigate();

  const [initialData, setInitialData] = useState<PageBuilderData | null>(null);
  const [productName, setProductName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [schema, setSchema] = useState<PageSchema | null>(null);
  const [pageRecord, setPageRecord] = useState<PageRecord | null>(null);

  const isSchemaMode = !!schemaSlug;
  const isEditMode = !!pageId;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);

        if (isSchemaMode && schemaSlug) {
          // Schema-driven mode
          const schemaData = await getSchema(schemaSlug);
          setSchema(schemaData);
          setProductName(schemaData.name);

          if (isEditMode && pageId) {
            // Load existing page
            const page = await getPage(pageId);
            setPageRecord(page);
            setInitialData(page.content as unknown as PageBuilderData);
            setProductName(page.name);
          }
        } else if (id) {
          // Legacy mode
          const { product, name } = await getProductPageData(id);
          setInitialData(product);
          setProductName(name);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [id, schemaSlug, pageId, isSchemaMode, isEditMode]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    return <div className="text-red-500">Error loading page data: {error}</div>;
  }

  return (
    <div className="container mx-auto py-8">
      {isSchemaMode && (
        <Button
          variant="ghost"
          onClick={() => navigate(`/pages/schema/${schemaSlug}`)}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      )}
      <h1 className="text-3xl font-bold mb-4">
        {isSchemaMode
          ? (isEditMode ? `Edit: ${productName}` : `New ${schema?.name || 'Page'}`)
          : `Page Builder for ${productName}`}
      </h1>
      <PageBuilderForm
        initialData={initialData}
        productId={isSchemaMode ? pageRecord?.id : id}
        productName={productName}
        productSlug={isSchemaMode ? pageRecord?.slug : undefined}
        productStatus={isSchemaMode ? pageRecord?.status : undefined}
        schema={schema ?? undefined}
        schemaSlug={schemaSlug}
      />
    </div>
  );
};

export default PageBuilder;
