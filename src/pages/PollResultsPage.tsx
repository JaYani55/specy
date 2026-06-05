import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, PieChart as PieChartIcon, ArrowLeft, AlertCircle, Clock, Users, MessageSquare, Info } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip as UITooltip, TooltipContent as UITooltipContent, TooltipProvider as UITooltipProvider, TooltipTrigger as UITooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from '@/contexts/ThemeContext';
import { API_URL } from '@/lib/apiUrl';
import { type FormSchemaDefinition } from '@/types/forms';
import { isDisplayOnlyFormFieldType } from '@/utils/forms';

interface PollResultResponse {
  form: {
    id: string;
    name: string;
    schema: FormSchemaDefinition;
    voting_mode: 'live' | 'deadline';
    deadline_at: string | null;
  };
  total_responses: number;
  responses: Array<{
    answers: Record<string, any>;
    submitter_name: string | null;
    created_at: string;
  }>;
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

const CONSENT_VOTE_MAP: Record<string, { label: { en: string; de: string }; color: string }> = {
  agree: { label: { en: 'Agree', de: 'Zustimmen' }, color: 'text-green-600' },
  abstain: { label: { en: 'Abstain', de: 'Enthalten' }, color: 'text-yellow-600' },
  disagree: { label: { en: 'Disagree', de: 'Ablehnen' }, color: 'text-orange-600' },
  block: { label: { en: 'Block', de: 'Blockieren' }, color: 'text-red-600' },
  positive: { label: { en: 'Positive', de: 'Positiv' }, color: 'text-green-600' },
  neutral: { label: { en: 'Neutral', de: 'Neutral' }, color: 'text-yellow-600' },
  critical: { label: { en: 'Critical', de: 'Kritisch' }, color: 'text-orange-600' },
  veto: { label: { en: 'Veto', de: 'Veto' }, color: 'text-red-500 font-bold' },
};

const PollResultsPage = () => {
  const { tenantName, formShareSlug } = useParams<{ tenantName: string; formShareSlug: string }>();
  const { language } = useTheme();
  const [data, setData] = useState<PollResultResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResults = useCallback(async () => {
    if (!tenantName || !formShareSlug) return;

    try {
      setIsLoading(true);
      const response = await fetch(`${API_URL}/api/forms/share/${encodeURIComponent(tenantName)}/${encodeURIComponent(formShareSlug)}/results`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load poll results.');
      }

      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred.');
    } finally {
      setIsLoading(false);
    }
  }, [tenantName, formShareSlug]);

  useEffect(() => {
    void loadResults();
  }, [loadResults]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{language === 'en' ? 'Error' : 'Fehler'}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <div className="mt-6 flex justify-center">
          <Button asChild variant="outline">
            <Link to={`/forms/share/${tenantName}/${formShareSlug}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {language === 'en' ? 'Back to Poll' : 'Zurück zur Umfrage'}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Aggregate results based on schema
  const schema = data.form.schema || {};
  const aggregatedResults = Object.entries(schema)
    .filter(([key, field]) => {
      const type = (field as any).type;
      return !isDisplayOnlyFormFieldType(type) && key !== 'participant_name';
    })
    .map(([key, field]) => {
      const fieldDef = field as any;
      const fieldType = fieldDef.type;

      // For charts: counts
      const counts: Record<string, number> = {};
      // For tables: list of all entries
      const entries: Array<{ name: string; value: any; reason?: string; timestamp: string }> = [];

      data.responses.forEach(resp => {
        const val = resp.answers[key];
        const subName = resp.submitter_name || (language === 'en' ? 'Anonymous' : 'Anonym');
        
        if (val === undefined || val === null) return;

        // Handle arrays (multiselect)
        if (Array.isArray(val)) {
          val.forEach(item => {
            const displayItem = String(item);
            counts[displayItem] = (counts[displayItem] || 0) + 1;
          });
          entries.push({ name: subName, value: val.join(', '), timestamp: resp.created_at });
          return;
        }

        // Handle booleans
        if (typeof val === 'boolean') {
          const displayVal = val 
            ? (language === 'en' ? 'Yes' : 'Ja') 
            : (language === 'en' ? 'No' : 'Nein');
          counts[displayVal] = (counts[displayVal] || 0) + 1;
          entries.push({ name: subName, value: displayVal, timestamp: resp.created_at });
          return;
        }

        // Handle consent-vote structure
        if (typeof val === 'object' && 'position' in val) {
          const pos = val.position || 'Unknown';
          const posConfig = CONSENT_VOTE_MAP[pos] || { label: { en: pos, de: pos }, color: '' };
          const displayVal = posConfig.label[language];
          counts[displayVal] = (counts[displayVal] || 0) + 1;
          entries.push({ name: subName, value: displayVal, reason: val.reason, timestamp: resp.created_at });
          return;
        }

        // Simple string/number
        const displayVal = String(val);
        counts[displayVal] = (counts[displayVal] || 0) + 1;
        entries.push({ name: subName, value: displayVal, timestamp: resp.created_at });
      });

      return {
        key,
        type: fieldType,
        label: fieldDef.label || key,
        data: Object.entries(counts).map(([name, value]) => ({ name, value })),
        entries
      };
    })
    .filter(result => result.entries.length > 0);

  const isExpired = data.form.deadline_at && new Date(data.form.deadline_at) < new Date();

  return (
    <div className="container mx-auto max-w-4xl px-4 py-12">
      <div className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{data.form.name}</h1>
          <p className="text-muted-foreground">
            {language === 'en' ? 'Poll Results' : 'Umfrage-Ergebnisse'} · {data.total_responses} {language === 'en' ? 'participants' : 'Teilnehmer'}
          </p>
        </div>
        <div className="flex gap-2">
          {isExpired && (
            <Badge variant="destructive" className="flex gap-1">
              <Clock className="h-3 w-3" />
              {language === 'en' ? 'Closed' : 'Beendet'}
            </Badge>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to={`/forms/share/${tenantName}/${formShareSlug}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {language === 'en' ? 'Back' : 'Zurück'}
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-8">
        {aggregatedResults.map((result, idx) => (
          <Card key={result.key} className="overflow-hidden border-2 shadow-sm">
            <CardHeader className="bg-muted/10 border-b">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl font-bold">{result.label}</CardTitle>
                <Badge variant="outline" className="capitalize">{result.type.replace(/-/g, ' ')}</Badge>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className={result.data.length > 0 && result.entries.some(e => result.type === 'consent-vote' || result.type === 'consent-poll' || result.type === 'text' || result.type === 'textarea') ? "grid grid-cols-1 lg:grid-cols-2 gap-8" : ""}>
                {(result.type === 'consent-vote' || result.type === 'consent-poll' || result.type === 'single-select' || result.type === 'multi-select' || result.type === 'checkbox') && (
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={result.data}
                          cx="50%"
                          cy="50%"
                          labelLine={false}
                          label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                          outerRadius={100}
                          innerRadius={60}
                          paddingAngle={5}
                          fill="#8884d8"
                          dataKey="value"
                        >
                          {result.data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                        />
                        <Legend verticalAlign="bottom" height={36}/>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {(result.type === 'text' || result.type === 'textarea' || result.type === 'consent-vote' || result.type === 'consent-poll') && (
                  <div className="space-y-4">
                    {result.type === 'consent-vote' || result.type === 'consent-poll' ? (
                      <h4 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                        <Users className="h-4 w-4" />
                        {language === 'en' ? 'Individual Votes' : 'Einzelstimmen'}
                      </h4>
                    ) : null}
                    
                    <div className="rounded-xl border overflow-hidden">
                      <Table>
                        <TableHeader className="bg-muted/50">
                          <TableRow>
                            <TableHead className="w-[120px]">{language === 'en' ? 'Participant' : 'Teilnehmer'}</TableHead>
                            <TableHead>{language === 'en' ? 'Answer' : 'Antwort'}</TableHead>
                            {result.entries.some(e => e.reason) && (
                              <TableHead>{language === 'en' ? 'Reason' : 'Begründung'}</TableHead>
                            )}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.entries.map((entry, eIdx) => (
                            <TableRow key={eIdx}>
                              <TableCell className="font-medium text-xs">{entry.name}</TableCell>
                              <TableCell className="text-sm">
                                {result.type === 'textarea' ? (
                                  <div className="max-w-[200px] whitespace-pre-wrap italic text-muted-foreground text-xs">
                                    "{entry.value}"
                                  </div>
                                ) : (
                                  <span className={result.type.includes('consent') ? 'font-semibold underline decoration-2 underline-offset-4 decoration-primary/30' : ''}>
                                    {entry.value}
                                  </span>
                                )}
                              </TableCell>
                              {result.entries.some(e => e.reason) && (
                                <TableCell>
                                  {entry.reason ? (
                                    <UITooltipProvider>
                                      <UITooltip>
                                        <UITooltipTrigger asChild>
                                          <div className="flex items-center gap-1 text-xs text-destructive font-medium cursor-help">
                                            <MessageSquare className="h-3 w-3" />
                                            {entry.reason.length > 20 ? entry.reason.substring(0, 20) + '...' : entry.reason}
                                          </div>
                                        </UITooltipTrigger>
                                        <UITooltipContent className="max-w-[300px] whitespace-pre-wrap">
                                          {entry.reason}
                                        </UITooltipContent>
                                      </UITooltip>
                                    </UITooltipProvider>
                                  ) : (
                                    <span className="text-xs text-muted-foreground italic">-</span>
                                  )}
                                </TableCell>
                              )}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        <Card className="border-2 shadow-sm">
          <CardHeader className="bg-muted/10 border-b">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              <CardTitle className="text-xl font-bold">{language === 'en' ? 'Participants' : 'Teilnehmer'}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid gap-3 sm:grid-cols-2">
              {data.responses.map((resp, idx) => (
                <div key={idx} className="flex items-center justify-between p-4 rounded-xl border bg-muted/5 hover:bg-muted/10 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                      {resp.submitter_name ? resp.submitter_name.charAt(0).toUpperCase() : '?'}
                    </div>
                    <span className="font-semibold">{resp.submitter_name || (language === 'en' ? 'Anonymous' : 'Anonym')}</span>
                  </div>
                  <span className="text-[10px] uppercase font-bold text-muted-foreground bg-muted/20 px-2 py-1 rounded">
                    {new Date(resp.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                </div>
              ))}
              {data.responses.length === 0 && (
                <div className="col-span-full py-12 text-center text-muted-foreground flex flex-col items-center gap-2">
                  <Users className="h-12 w-12 opacity-10" />
                  {language === 'en' ? 'No participants yet.' : 'Bisher keine Teilnehmer.'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default PollResultsPage;
