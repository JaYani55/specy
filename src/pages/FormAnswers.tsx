import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Loader2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/contexts/ThemeContext';
import { getForm, getFormAnswers } from '@/services/formService';
import type { FormAnswerRecord, FormRecord, FormUploadedFileValue } from '@/types/forms';

const isUploadedFileValue = (value: unknown): value is FormUploadedFileValue => (
  typeof value === 'object'
  && value !== null
  && 'name' in value
  && 'url' in value
  && 'path' in value
);

const FormAnswers = () => {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();
  const { language } = useTheme();
  const [form, setForm] = useState<FormRecord | null>(null);
  const [answers, setAnswers] = useState<FormAnswerRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!formId) return;

    try {
      setIsLoading(true);
      const [formData, answersData] = await Promise.all([
        getForm(formId),
        getFormAnswers(formId),
      ]);
      setForm(formData);
      setAnswers(answersData);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load answers.');
      navigate('/forms', { replace: true });
    } finally {
      setIsLoading(false);
    }
  }, [formId, navigate]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <AdminPageLayout
      title={language === 'en' ? 'Form Answers' : 'Formularantworten'}
      description={form ? `${form.name} · ${answers.length} ${language === 'en' ? 'submissions' : 'Einsendungen'}` : undefined}
      icon={MessageSquare}
      actions={(
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link to={form ? `/forms/${form.id}` : '/forms'}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {language === 'en' ? 'Back to form' : 'Zurück zum Formular'}
            </Link>
          </Button>
        </div>
      )}
    >
      {isLoading ? (
        <AdminCard className="flex min-h-[280px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </AdminCard>
      ) : answers.length === 0 ? (
        <AdminCard className="border-dashed">
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 text-center">
            <ClipboardList className="h-12 w-12 text-muted-foreground" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">
                {language === 'en' ? 'No answers yet' : 'Noch keine Antworten'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {language === 'en' ? 'Published forms will store submissions here.' : 'Veröffentlichte Formulare speichern Einsendungen hier.'}
              </p>
            </div>
          </div>
        </AdminCard>
      ) : (
        <div className="space-y-4">
          {answers.map((answer) => (
            <AdminCard key={answer.id} title={new Date(answer.created_at).toLocaleString()} icon={MessageSquare} iconColor="from-cyan-500 to-blue-600">
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge variant="outline">{answer.submitted_via}</Badge>
                  <Badge variant="outline">{answer.source_slug || (language === 'en' ? 'No source slug' : 'Ohne Source-Slug')}</Badge>
                  {answer.submitted_by && <Badge variant="outline">{answer.submitted_by}</Badge>}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  {Object.entries(answer.answers).map(([fieldName, value]) => (
                    <div key={fieldName} className="rounded-lg border bg-muted/20 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{fieldName}</p>
                      {isUploadedFileValue(value) ? (
                        <div className="mt-2 space-y-1 text-sm">
                          <p className="font-medium">{value.name}</p>
                          <a href={value.url} target="_blank" rel="noreferrer" className="break-all text-primary underline-offset-2 hover:underline">
                            {value.url}
                          </a>
                        </div>
                      ) : (
                        <p className="mt-2 break-words text-sm">
                          {typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value ?? '')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </AdminCard>
          ))}
        </div>
      )}
    </AdminPageLayout>
  );
};

export default FormAnswers;