import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, Loader2, Lock, Paperclip, Upload, X, Clock, PieChart as PieChartIcon, Share2, Copy, Check, Link as LinkIcon } from 'lucide-react';
import { toast } from 'sonner';
import NotFound from '@/pages/NotFound';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useTheme } from '@/contexts/ThemeContext';
import { getPublicFormByShareSlug, submitFormAnswers, uploadFormFile } from '@/services/formService';
import type { FormAnswerValue, FormFieldDefinition, FormUploadedFileValue, PublicFormDefinition } from '@/types/forms';
import { buildInitialAnswers, isDisplayOnlyFormFieldType } from '@/utils/forms';
import { useResolvedMediaUrl } from '@/utils/mediaUrl';
import { MarkdownContent } from '@/components/forms/MarkdownContent';

const FormShareImageField = ({ field, language }: { field: FormFieldDefinition; language: string }) => {
  const resolvedImageUrl = useResolvedMediaUrl(field.src);

  return (
    <div className="overflow-hidden rounded-xl border bg-muted/20">
      {field.src ? (
        <img
          src={resolvedImageUrl || field.src}
          alt={field.alt || field.label || 'Form image'}
          title={field.alt || undefined}
          className="h-auto w-full max-h-96 object-cover"
        />
      ) : (
        <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
          {language === 'en' ? 'No image selected yet.' : 'Noch kein Bild ausgewählt.'}
        </div>
      )}
      {field.caption && (
        <div className="border-t px-4 py-3 text-sm text-muted-foreground">
          {field.caption}
        </div>
      )}
    </div>
  );
};

const FormSharePage = () => {
  const { tenantName, formShareSlug } = useParams<{ tenantName: string; formShareSlug: string }>();
  const { language } = useTheme();
  const [formDefinition, setFormDefinition] = useState<PublicFormDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<string, FormAnswerValue>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingFields, setUploadingFields] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);
  const submissionId = useMemo(() => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `form-submission-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }, []);

  useEffect(() => {
    if (!tenantName || !formShareSlug) {
      setError('not-found');
      setIsLoading(false);
      return;
    }

    const loadForm = async () => {
      try {
        setIsLoading(true);
        const definition = await getPublicFormByShareSlug(tenantName, formShareSlug);
        setFormDefinition(definition);
        setAnswers(buildInitialAnswers(definition.fields));
        
        // Update document title for the browser tab
        document.title = `${definition.form.name} | ServiceCMS`;

        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load form.');
      } finally {
        setIsLoading(false);
      }
    };

    void loadForm();
  }, [tenantName, formShareSlug, language]);

  // Load MS Teams Share Launcher - wait until form is ready in the DOM
  useEffect(() => {
    if (isLoading || !formDefinition) return;

    const script = document.createElement('script');
    script.src = 'https://teams.microsoft.com/share/launcher.js';
    script.defer = true;
    document.body.appendChild(script);
    
    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, [isLoading, formDefinition]);

  const requiredFieldNames = useMemo(
    () => new Set(formDefinition?.fields.filter((field) => field.required && !isDisplayOnlyFormFieldType(field.type)).map((field) => field.name) ?? []),
    [formDefinition],
  );

  const handleFileSelect = async (fieldName: string, file: File | null) => {
    if (!file || !tenantName || !formShareSlug) {
      return;
    }

    try {
      setUploadingFields((current) => ({ ...current, [fieldName]: true }));
      const uploaded = await uploadFormFile({ tenantName, identifier: formShareSlug }, {
        file,
        field_name: fieldName,
        submission_id: submissionId,
      }, 'share');

      setAnswers((current) => ({ ...current, [fieldName]: uploaded }));
      toast.success(language === 'en' ? 'File uploaded.' : 'Datei hochgeladen.');
    } catch (uploadError) {
      toast.error(uploadError instanceof Error ? uploadError.message : 'Failed to upload file.');
    } finally {
      setUploadingFields((current) => ({ ...current, [fieldName]: false }));
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/20 px-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error === 'Form not found.' || error === 'not-found') {
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
                ? 'This form is only available to authenticated users.'
                : 'Dieses Formular ist nur für angemeldete Nutzer verfügbar.'}
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

  if (!formDefinition) {
    return null;
  }

  const handleSubmit = async () => {
    if (!tenantName || !formShareSlug) return;

    const missingRequiredField = formDefinition.fields.find((field) => {
      if (!requiredFieldNames.has(field.name)) return false;
      if (field.type === 'checkbox') return answers[field.name] !== true;
      if (field.type === 'consent-vote' || field.type === 'consent-poll') {
        const val = answers[field.name] as { position?: string; reason?: string } | null;
        if (!val || !val.position) return true;
        if (field.type === 'consent-vote' && (val.position === 'disagree' || val.position === 'block') && !val.reason?.trim()) return true;
        if (field.type === 'consent-poll' && val.position === 'veto' && !val.reason?.trim()) return true;
        return false;
      }
      return answers[field.name] === null || answers[field.name] === '';
    });

    if (missingRequiredField) {
      toast.error(language === 'en'
        ? `Please fill ${missingRequiredField.label}.`
        : `Bitte ${missingRequiredField.label} ausfüllen.`);
      return;
    }

    try {
      setIsSubmitting(true);
      await submitFormAnswers({ tenantName, identifier: formShareSlug }, {
        answers,
        source_slug: formDefinition.form.share_slug || formShareSlug,
      }, 'share');
      setSubmitted(true);
      toast.success(language === 'en' ? 'Form submitted.' : 'Formular gesendet.');
    } catch (submitError) {
      toast.error(submitError instanceof Error ? submitError.message : 'Failed to submit form.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = () => {
    void navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast.success(language === 'en' ? 'Link copied to clipboard!' : 'Link in die Zwischenablage kopiert!');
    setTimeout(() => setCopied(false), 2000);
  };

  const isExpired = formDefinition.form.deadline_at && new Date(formDefinition.form.deadline_at) < new Date();
  const isPoll = formDefinition.form.type === 'poll';
  const showResultsLink = isPoll && (formDefinition.form.voting_mode === 'live' || isExpired);

  return (
    <div className="min-h-screen bg-muted/20 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>{formDefinition.form.name}</CardTitle>
                {formDefinition.form.description && <CardDescription>{formDefinition.form.description}</CardDescription>}
              </div>
              <div className="flex flex-col items-end gap-2 text-right">
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="h-8 gap-2 border-primary/20 bg-primary/5 hover:bg-primary/10"
                    onClick={handleCopyLink}
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <LinkIcon className="h-3.5 w-3.5" />}
                    {language === 'en' ? 'Copy Link' : 'Link kopieren'}
                  </Button>
                  <div 
                    className="teams-share-button" 
                    data-href={window.location.href}
                    data-icon-type="small"
                  />
                </div>
                {isExpired && (
                  <Badge variant="destructive">
                    {language === 'en' ? 'Poll Closed' : 'Umfrage beendet'}
                  </Badge>
                )}
                {showResultsLink && (
                  <Button asChild variant="link" size="sm" className="h-auto p-0">
                    <Link to={`/forms/share/${tenantName}/${formShareSlug}/results`} className="flex items-center gap-1">
                      <PieChartIcon className="h-4 w-4" />
                      {language === 'en' ? 'View Results' : 'Ergebnisse ansehen'}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {submitted ? (
              <div className="space-y-6">
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>{language === 'en' ? 'Submission received' : 'Antwort erhalten'}</AlertTitle>
                  <AlertDescription>
                    {language === 'en'
                      ? 'Thank you. Your answer has been stored successfully.'
                      : 'Danke. Deine Antwort wurde erfolgreich gespeichert.'}
                  </AlertDescription>
                </Alert>
                {showResultsLink && (
                  <div className="flex justify-center">
                    <Button asChild variant="outline">
                      <Link to={`/forms/share/${tenantName}/${formShareSlug}/results`}>
                        <PieChartIcon className="mr-2 h-4 w-4" />
                        {language === 'en' ? 'Go to Results' : 'Zu den Ergebnissen'}
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            ) : isExpired ? (
              <Alert variant="destructive">
                <Clock className="h-4 w-4" />
                <AlertTitle>{language === 'en' ? 'Closed' : 'Beendet'}</AlertTitle>
                <AlertDescription>
                  {language === 'en' ? 'This poll is no longer accepting responses.' : 'Diese Umfrage nimmt keine weiteren Antworten mehr an.'}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-6">
                {formDefinition.fields.map((field) => (
                  <div key={field.name} className="space-y-2">
                    {!isDisplayOnlyFormFieldType(field.type) && (
                      <Label htmlFor={field.name}>{field.label}{field.required ? ' *' : ''}</Label>
                    )}
                    {field.description && !isDisplayOnlyFormFieldType(field.type) && <p className="text-sm text-muted-foreground">{field.description}</p>}

                    {field.type === 'help-text' && (
                      <div className="rounded-xl border bg-muted/20 p-4">
                        <div className="mb-2 text-sm font-semibold">{field.label}</div>
                        {field.content ? (
                          <MarkdownContent content={field.content} />
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {language === 'en' ? 'No help text provided yet.' : 'Noch kein Hilfetext vorhanden.'}
                          </p>
                        )}
                      </div>
                    )}

                    {field.type === 'image' && (
                      <FormShareImageField field={field} language={language} />
                    )}

                    {field.type === 'consent-poll' && (
                      <div className="space-y-4 rounded-xl border p-4 shadow-sm">
                        {field.content && (
                          <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg bg-muted/30 p-4">
                            <MarkdownContent content={field.content} />
                          </div>
                        )}
                        
                        <div className="space-y-3">
                          <Label className="text-base font-semibold">
                            {language === 'en' ? 'Your Sentiment' : 'Dein Stimmungsbild'}
                          </Label>
                          <RadioGroup
                            value={(answers[field.name] as { position?: string })?.position || ''}
                            onValueChange={(val) => setAnswers(curr => ({
                              ...curr,
                              [field.name]: { ...(curr[field.name] as unknown as Record<string, unknown> || {}), position: val }
                            }))}
                            className="grid grid-cols-2 gap-4 md:grid-cols-4"
                          >
                            {[
                              { id: 'positive', label: language === 'en' ? 'Positive' : 'Positiv', color: 'text-green-600' },
                              { id: 'neutral', label: language === 'en' ? 'Neutral/Wait' : 'Neutral/Warten', color: 'text-yellow-600' },
                              { id: 'critical', label: language === 'en' ? 'Critical' : 'Kritisch', color: 'text-orange-600' },
                              { id: 'veto', label: language === 'en' ? 'Veto' : 'Veto', color: 'text-red-500 font-black' }
                            ].map((pos) => (
                              <div key={pos.id} className="relative">
                                <RadioGroupItem
                                  value={pos.id}
                                  id={`${field.name}-${pos.id}`}
                                  className="peer sr-only"
                                />
                                <Label
                                  htmlFor={`${field.name}-${pos.id}`}
                                  className={`flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer`}
                                >
                                  <span className={`text-sm font-bold ${pos.color}`}>{pos.label}</span>
                                </Label>
                              </div>
                            ))}
                          </RadioGroup>
                        </div>

                        {((answers[field.name] as { position?: string })?.position === 'veto') && (
                          <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                            <Label htmlFor={`${field.name}-reason`} className="text-destructive font-medium">
                              {language === 'en' ? 'Reason (Required for Veto)' : 'Begründung (Erforderlich bei Veto)'}
                            </Label>
                            <Textarea
                              id={`${field.name}-reason`}
                              placeholder={language === 'en' ? 'Please explain your veto...' : 'Bitte erkläre dein Veto...'}
                              value={(answers[field.name] as { reason?: string })?.reason || ''}
                              onChange={(e) => setAnswers(curr => ({
                                ...curr,
                                [field.name]: { ...(curr[field.name] as unknown as Record<string, unknown> || {}), reason: e.target.value }
                              }))}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {field.type === 'consent-vote' && (
                      <div className="space-y-4 rounded-xl border p-4 shadow-sm">
                        {field.content && (
                          <div className="prose prose-sm dark:prose-invert max-w-none rounded-lg bg-muted/30 p-4">
                            <MarkdownContent content={field.content} />
                          </div>
                        )}
                        
                        <div className="space-y-3">
                          <Label className="text-base font-semibold">
                            {language === 'en' ? 'Your Position' : 'Deine Position'}
                          </Label>
                          <RadioGroup
                            value={(answers[field.name] as { position?: string })?.position || ''}
                            onValueChange={(val) => setAnswers(curr => ({
                              ...curr,
                              [field.name]: { ...(curr[field.name] as unknown as Record<string, unknown> || {}), position: val }
                            }))}
                            className="grid grid-cols-2 gap-4 md:grid-cols-4"
                          >
                            {[
                              { id: 'agree', label: language === 'en' ? 'Agree' : 'Zustimmen', color: 'text-green-600' },
                              { id: 'abstain', label: language === 'en' ? 'Abstain' : 'Enthalten', color: 'text-yellow-600' },
                              { id: 'disagree', label: language === 'en' ? 'Disagree' : 'Ablehnen', color: 'text-orange-600' },
                              { id: 'block', label: language === 'en' ? 'Block' : 'Blockieren', color: 'text-red-600' }
                            ].map((pos) => (
                              <div key={pos.id} className="relative">
                                <RadioGroupItem
                                  value={pos.id}
                                  id={`${field.name}-${pos.id}`}
                                  className="peer sr-only"
                                />
                                <Label
                                  htmlFor={`${field.name}-${pos.id}`}
                                  className={`flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer`}
                                >
                                  <span className={`text-sm font-bold ${pos.color}`}>{pos.label}</span>
                                </Label>
                              </div>
                            ))}
                          </RadioGroup>
                        </div>

                        {((answers[field.name] as { position?: string })?.position === 'disagree' || (answers[field.name] as { position?: string })?.position === 'block') && (
                          <div className="space-y-2 animate-in fade-in slide-in-from-top-2">
                            <Label htmlFor={`${field.name}-reason`} className="text-destructive font-medium">
                              {language === 'en' ? 'Reason (Required for Disagree/Block)' : 'Begründung (Erforderlich bei Ablehnung/Blockade)'}
                            </Label>
                            <Textarea
                              id={`${field.name}-reason`}
                              placeholder={language === 'en' ? 'Please explain your concerns...' : 'Bitte erkläre deine Bedenken...'}
                              value={(answers[field.name] as { reason?: string })?.reason || ''}
                              onChange={(e) => setAnswers(curr => ({
                                ...curr,
                                [field.name]: { ...(curr[field.name] as unknown as Record<string, unknown> || {}), reason: e.target.value }
                              }))}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {(field.type === 'text' || field.type === 'email' || field.type === 'date' || field.type === 'number') && (
                      <Input
                        id={field.name}
                        type={field.type === 'number' ? 'number' : field.type}
                        value={String(answers[field.name] ?? '')}
                        placeholder={field.placeholder}
                        onChange={(event) => setAnswers((current) => ({
                          ...current,
                          [field.name]: field.type === 'number' ? event.target.value : event.target.value,
                        }))}
                      />
                    )}

                    {field.type === 'textarea' && (
                      <Textarea
                        id={field.name}
                        value={String(answers[field.name] ?? '')}
                        placeholder={field.placeholder}
                        rows={5}
                        onChange={(event) => setAnswers((current) => ({ ...current, [field.name]: event.target.value }))}
                      />
                    )}

                    {field.type === 'file-upload' && (
                      <div className="space-y-3 rounded-md border p-4">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Paperclip className="h-4 w-4" />
                          <span>{language === 'en' ? 'Upload one file for this field.' : 'Eine Datei für dieses Feld hochladen.'}</span>
                        </div>
                        <Input
                          id={field.name}
                          type="file"
                          onChange={(event) => {
                            const selectedFile = event.target.files?.[0] ?? null;
                            void handleFileSelect(field.name, selectedFile);
                            event.target.value = '';
                          }}
                          disabled={uploadingFields[field.name] === true || isSubmitting}
                        />
                        {uploadingFields[field.name] && (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>{language === 'en' ? 'Uploading…' : 'Lade hoch…'}</span>
                          </div>
                        )}
                        {typeof answers[field.name] === 'object' && answers[field.name] !== null && 'path' in (answers[field.name] as FormUploadedFileValue) && (
                          <div className="flex items-center justify-between gap-3 rounded-md bg-muted/30 px-3 py-2 text-sm">
                            <div className="min-w-0">
                              <p className="truncate font-medium">{(answers[field.name] as FormUploadedFileValue).name}</p>
                              <a
                                href={(answers[field.name] as FormUploadedFileValue).download_url || (answers[field.name] as FormUploadedFileValue).url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs text-primary underline-offset-2 hover:underline"
                              >
                                {(language === 'en' ? 'Open uploaded file' : 'Hochgeladene Datei öffnen')}
                              </a>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button type="button" variant="outline" size="sm" asChild>
                                <a href={(answers[field.name] as FormUploadedFileValue).download_url || (answers[field.name] as FormUploadedFileValue).url} target="_blank" rel="noreferrer">
                                  <Upload className="mr-2 h-3.5 w-3.5" />
                                  {language === 'en' ? 'Open' : 'Öffnen'}
                                </a>
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => setAnswers((current) => ({ ...current, [field.name]: null }))}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {field.type === 'checkbox' && (
                      <div className="flex items-center gap-3 rounded-md border p-3">
                        <Checkbox
                          id={field.name}
                          checked={answers[field.name] === true}
                          onCheckedChange={(checked) => setAnswers((current) => ({ ...current, [field.name]: checked === true }))}
                        />
                        <Label htmlFor={field.name} className="mb-0">{field.placeholder || field.label}</Label>
                      </div>
                    )}

                    {(field.type === 'select' || field.type === 'radio') && field.options && (
                      <div className="space-y-3">
                        <Select
                          value={field.options.includes(String(answers[field.name] ?? '')) ? String(answers[field.name] ?? '') : (answers[field.name] ? '__other__' : '')}
                          onValueChange={(value) => setAnswers((current) => ({ ...current, [field.name]: value === '__other__' ? '' : value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={field.placeholder || field.label} />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((option) => (
                              <SelectItem key={option} value={option}>{option}</SelectItem>
                            ))}
                            {field.allow_custom && (
                              <SelectItem value="__other__">{language === 'en' ? 'Other...' : 'Sonstiges...'}</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {field.allow_custom && (answers[field.name] !== null && !field.options.includes(String(answers[field.name])) || answers[field.name] === '') && (
                          <Input
                            placeholder={language === 'en' ? 'Please specify...' : 'Bitte angeben...'}
                            value={String(answers[field.name] ?? '')}
                            onChange={(e) => setAnswers(curr => ({ ...curr, [field.name]: e.target.value }))}
                            className="animate-in fade-in slide-in-from-top-1"
                          />
                        )}
                      </div>
                    )}

                    {field.type === 'single-select' && field.options && (
                      <div className="space-y-3">
                        <Select
                          value={field.options.includes(String(answers[field.name] ?? '')) ? String(answers[field.name] ?? '') : (answers[field.name] ? '__other__' : '')}
                          onValueChange={(value) => setAnswers((current) => ({ ...current, [field.name]: value === '__other__' ? '' : value }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={field.placeholder || field.label} />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options.map((option) => (
                              <SelectItem key={option} value={option}>{option}</SelectItem>
                            ))}
                            {field.allow_custom && (
                              <SelectItem value="__other__">{language === 'en' ? 'Other...' : 'Sonstiges...'}</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {field.allow_custom && (answers[field.name] !== null && !field.options.includes(String(answers[field.name])) || (answers[field.name] === '' && field.options.every(o => o !== ''))) && (
                          <Input
                            placeholder={language === 'en' ? 'Please specify...' : 'Bitte angeben...'}
                            value={String(answers[field.name] ?? '')}
                            onChange={(e) => setAnswers(curr => ({ ...curr, [field.name]: e.target.value }))}
                            className="animate-in fade-in slide-in-from-top-1"
                          />
                        )}
                      </div>
                    )}

                    {field.type === 'multi-select' && field.options && (
                      <div className="space-y-3 rounded-md border p-3">
                        {field.options.map((option) => {
                          const currentValues = Array.isArray(answers[field.name]) ? answers[field.name] as string[] : [];
                          const checked = currentValues.includes(option);
                          return (
                            <div key={option} className="flex items-center gap-3">
                              <Checkbox
                                id={`${field.name}-${option}`}
                                checked={checked}
                                onCheckedChange={(nextChecked) => {
                                  const updatedValues = nextChecked === true
                                    ? Array.from(new Set([...currentValues, option]))
                                    : currentValues.filter((entry) => entry !== option);
                                  setAnswers((current) => ({ ...current, [field.name]: updatedValues }));
                                }}
                              />
                              <Label htmlFor={`${field.name}-${option}`} className="mb-0 cursor-pointer">{option}</Label>
                            </div>
                          );
                        })}
                        {field.allow_custom && (
                          <div className="space-y-3 pt-2 border-t mt-2">
                            <div className="flex items-center gap-3">
                              <Checkbox
                                id={`${field.name}-other-toggle`}
                                checked={Array.isArray(answers[field.name]) && (answers[field.name] as string[]).some(v => !field.options?.includes(v))}
                                onCheckedChange={(checked) => {
                                  if (!checked) {
                                    // Remove any value that isn't in options
                                    const currentValues = Array.isArray(answers[field.name]) ? answers[field.name] as string[] : [];
                                    setAnswers(curr => ({ ...curr, [field.name]: currentValues.filter(v => field.options?.includes(v)) }));
                                  } else {
                                    // Just visual - input handles the actual value
                                  }
                                }}
                              />
                              <Label htmlFor={`${field.name}-other-toggle`} className="mb-0 cursor-pointer">
                                {language === 'en' ? 'Other...' : 'Sonstiges...'}
                              </Label>
                            </div>
                            {(Array.isArray(answers[field.name]) && (answers[field.name] as string[]).some(v => !field.options?.includes(v)) || (document.getElementById(`${field.name}-other-toggle`) as HTMLInputElement)?.checked) && (
                              <Input
                                placeholder={language === 'en' ? 'Please specify...' : 'Bitte angeben...'}
                                value={(answers[field.name] as string[] || []).find(v => !field.options?.includes(v)) || ''}
                                onChange={(e) => {
                                  const currentValues = Array.isArray(answers[field.name]) ? answers[field.name] as string[] : [];
                                  const baseValues = currentValues.filter(v => field.options?.includes(v));
                                  if (e.target.value.trim()) {
                                    setAnswers(curr => ({ ...curr, [field.name]: [...baseValues, e.target.value] }));
                                  } else {
                                    setAnswers(curr => ({ ...curr, [field.name]: baseValues }));
                                  }
                                }}
                                className="animate-in fade-in slide-in-from-top-1"
                              />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <Button onClick={() => void handleSubmit()} disabled={isSubmitting} className="w-full">
                  {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {language === 'en' ? 'Submit' : 'Absenden'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default FormSharePage;
