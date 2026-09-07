import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, RefreshCw, RotateCcw, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { AdminPageLayout, AdminLoading } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTheme } from '@/contexts/ThemeContext';
import {
  clearMailJobs,
  deleteMailJob,
  fetchMailJobs,
  retryMailJob,
  type MailDeliveryJob,
  type MailJobStatus,
} from '@/services/mailService';

type StatusFilter = 'all' | MailJobStatus;

const STATUS_STYLES: Record<MailJobStatus, { label: string; className: string }> = {
  pending: { label: 'Ausstehend', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  processing: { label: 'In Zustellung', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  sent: { label: 'Gesendet', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  failed: { label: 'Fehlgeschlagen', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
};

const EVENT_LABELS: Record<string, string> = {
  queued: 'Eingereiht',
  testing: 'Verbindungstest',
  sending: 'Zustellung läuft',
  sent: 'Zugestellt',
  requeued: 'Erneut eingereiht',
  failed: 'Fehlgeschlagen',
};

const formatDateTime = (value: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
};

const VerwaltungMail = () => {
  const { language } = useTheme();
  const [jobs, setJobs] = useState<MailDeliveryJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [retryingJobIds, setRetryingJobIds] = useState<Set<string>>(new Set());
  const [deletingJobIds, setDeletingJobIds] = useState<Set<string>>(new Set());
  const [isClearingAll, setIsClearingAll] = useState(false);

  const loadJobs = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const data = await fetchMailJobs({ limit: 200 });
      setJobs(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Fehler beim Laden des E-Mail-Verlaufs');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const filteredJobs = useMemo(
    () => (statusFilter === 'all' ? jobs : jobs.filter((job) => job.status === statusFilter)),
    [jobs, statusFilter],
  );

  const failedCount = useMemo(() => jobs.filter((job) => job.status === 'failed').length, [jobs]);

  const handleRetry = async (job: MailDeliveryJob) => {
    setRetryingJobIds((prev) => new Set(prev).add(job.id));
    try {
      const result = await retryMailJob(job.id);
      if (result.sent) {
        toast.success(language === 'en' ? 'E-mail delivered successfully' : 'E-Mail erfolgreich zugestellt');
      } else if (result.requeued) {
        toast.info(
          language === 'en'
            ? 'Delivery attempt failed — e-mail remains queued for automatic retry'
            : 'Zustellversuch fehlgeschlagen — E-Mail bleibt in der Warteschlange für automatische Wiederholung',
        );
      } else {
        toast.success(language === 'en' ? 'Re-dispatch started' : 'Erneuter Versand gestartet');
      }
      await loadJobs(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erneuter Versand fehlgeschlagen');
    } finally {
      setRetryingJobIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  };

  const handleDelete = async (job: MailDeliveryJob) => {
    setDeletingJobIds((prev) => new Set(prev).add(job.id));
    try {
      await deleteMailJob(job.id);
      toast.success(language === 'en' ? 'Entry deleted' : 'Eintrag gelöscht');
      setExpandedJobId((prev) => (prev === job.id ? null : prev));
      await loadJobs(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Eintrag konnte nicht gelöscht werden');
    } finally {
      setDeletingJobIds((prev) => {
        const next = new Set(prev);
        next.delete(job.id);
        return next;
      });
    }
  };

  const handleClearAll = async () => {
    setIsClearingAll(true);
    try {
      const result = await clearMailJobs();
      toast.success(
        language === 'en'
          ? `${result.deleted} entr${result.deleted === 1 ? 'y' : 'ies'} deleted`
          : `${result.deleted} Eintr${result.deleted === 1 ? 'ag' : 'äge'} gelöscht`,
      );
      setExpandedJobId(null);
      await loadJobs(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Einträge konnten nicht gelöscht werden');
    } finally {
      setIsClearingAll(false);
    }
  };

  const statusFilters: Array<{ key: StatusFilter; label: string }> = [
    { key: 'all', label: language === 'en' ? 'All' : 'Alle' },
    { key: 'pending', label: STATUS_STYLES.pending.label },
    { key: 'processing', label: STATUS_STYLES.processing.label },
    { key: 'sent', label: STATUS_STYLES.sent.label },
    { key: 'failed', label: STATUS_STYLES.failed.label },
  ];

  return (
    <AdminPageLayout
      title={language === 'en' ? 'Mail' : 'E-Mail-Verlauf'}
      description={
        language === 'en'
          ? 'Delivery log for all outgoing notifications of your workspace. Failed e-mails are automatically retried and can be re-dispatched manually.'
          : 'Zustellungsprotokoll aller ausgehenden Benachrichtigungen Ihres Arbeitsbereichs. Fehlgeschlagene E-Mails werden automatisch wiederholt und können manuell erneut versendet werden.'
      }
      icon={Mail}
      actions={
        <Button variant="outline" onClick={() => void loadJobs()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          {language === 'en' ? 'Refresh' : 'Aktualisieren'}
        </Button>
      }
    >
      {isLoading ? (
        <AdminLoading language={language} />
      ) : (
        <div className="space-y-4">
          {failedCount > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-300">
              {language === 'en'
                ? `${failedCount} e-mail${failedCount === 1 ? '' : 's'} could not be delivered after the maximum number of attempts. Use the retry button to re-dispatch them.`
                : `${failedCount} E-Mail${failedCount === 1 ? '' : 's'} konnte${failedCount === 1 ? '' : 'n'} nach der maximalen Anzahl an Versuchen nicht zugestellt werden. Über die Schaltfläche „Erneut senden" können Sie sie erneut versenden.`}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {statusFilters.map((filter) => (
              <Button
                key={filter.key}
                size="sm"
                variant={statusFilter === filter.key ? 'default' : 'outline'}
                onClick={() => setStatusFilter(filter.key)}
              >
                {filter.label}
              </Button>
            ))}
          </div>

          <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[130px]">{language === 'en' ? 'Status' : 'Status'}</TableHead>
                  <TableHead>{language === 'en' ? 'Recipient' : 'Empfänger'}</TableHead>
                  <TableHead>{language === 'en' ? 'Subject' : 'Betreff'}</TableHead>
                  <TableHead>{language === 'en' ? 'Type' : 'Typ'}</TableHead>
                  <TableHead className="w-[90px]">{language === 'en' ? 'Attempts' : 'Versuche'}</TableHead>
                  <TableHead className="w-[160px]">{language === 'en' ? 'Created' : 'Erstellt'}</TableHead>
                  <TableHead className="w-[110px] text-right">
                    {language === 'en' ? 'Actions' : 'Aktionen'}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-10 text-gray-500 dark:text-gray-400">
                      {language === 'en'
                        ? 'No mail delivery entries found for this filter.'
                        : 'Keine E-Mail-Einträge für diesen Filter gefunden.'}
                    </TableCell>
                  </TableRow>
                )}
                {filteredJobs.map((job) => {
                  const style = STATUS_STYLES[job.status];
                  const isExpanded = expandedJobId === job.id;
                  const isFailed = job.status === 'failed';
                  const isRetrying = retryingJobIds.has(job.id);
                  const isDeleting = deletingJobIds.has(job.id);

                  return (
                    <Fragment key={job.id}>
                      <TableRow
                        className={
                          isFailed
                            ? 'bg-red-50/60 dark:bg-red-950/20 cursor-pointer'
                            : 'cursor-pointer'
                        }
                        onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                      >
                        <TableCell>
                          <Badge variant="outline" className={style.className}>
                            {style.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium break-all">{job.recipient_email}</TableCell>
                        <TableCell className="max-w-[280px] truncate" title={job.subject}>
                          {job.subject}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                          {job.event_type}
                        </TableCell>
                        <TableCell className="text-sm">
                          {job.attempt_count} / {job.max_attempts}
                        </TableCell>
                        <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                          {formatDateTime(job.created_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {isFailed && (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={isRetrying}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleRetry(job);
                                }}
                              >
                                <RotateCcw className={`h-3.5 w-3.5 mr-1 ${isRetrying ? 'animate-spin' : ''}`} />
                                {language === 'en' ? 'Retry' : 'Erneut senden'}
                              </Button>
                            )}
                            {isFailed && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600 dark:text-red-400"
                                disabled={isDeleting}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDelete(job);
                                }}
                              >
                                <Trash2 className={`h-3.5 w-3.5 mr-1 ${isDeleting ? 'animate-pulse' : ''}`} />
                                {language === 'en' ? 'Delete' : 'Löschen'}
                              </Button>
                            )}
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${job.id}-details`} className="bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <TableCell colSpan={7}>
                            <div className="py-2 space-y-3">
                              {job.last_error && (
                                <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/30 px-3 py-2 text-sm text-red-800 dark:text-red-300 break-all">
                                  <span className="font-semibold">
                                    {language === 'en' ? 'Last error: ' : 'Letzter Fehler: '}
                                  </span>
                                  {job.last_error}
                                </div>
                              )}
                              {job.next_attempt_at && job.status === 'pending' && (
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                  {language === 'en' ? 'Next automatic attempt: ' : 'Nächster automatischer Versuch: '}
                                  {formatDateTime(job.next_attempt_at)}
                                </p>
                              )}
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-sm font-semibold">
                                    {language === 'en' ? 'Event history' : 'Ereignisverlauf'}
                                  </p>
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-red-600 dark:text-red-400"
                                        disabled={isDeleting || job.status === 'processing'}
                                        onClick={(event) => event.stopPropagation()}
                                      >
                                        <Trash2 className={`h-3.5 w-3.5 mr-1 ${isDeleting ? 'animate-pulse' : ''}`} />
                                        {language === 'en' ? 'Delete entry' : 'Eintrag löschen'}
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>
                                          {language === 'en' ? 'Delete this entry?' : 'Diesen Eintrag löschen?'}
                                        </AlertDialogTitle>
                                        <AlertDialogDescription>
                                          {language === 'en'
                                            ? `The delivery entry to "${job.recipient_email}" including its event history is permanently deleted. E-mails already sent are not affected. This action cannot be undone.`
                                            : `Der Zustellungseintrag an "${job.recipient_email}" wird dauerhaft gelöscht (inklusive Ereignisverlauf). Bereits gesendete E-Mails sind davon nicht betroffen. Diese Aktion kann nicht rückgängig gemacht werden.`}
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>{language === 'en' ? 'Cancel' : 'Abbrechen'}</AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() => void handleDelete(job)}
                                          className="bg-red-600 hover:bg-red-700 text-white"
                                        >
                                          {language === 'en' ? 'Delete' : 'Löschen'}
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                </div>
                                <ol className="space-y-2">
                                  {job.mail_delivery_events.map((event) => (
                                    <li key={event.id} className="text-sm flex gap-3">
                                      <Badge variant="outline" className="shrink-0 w-fit">
                                        {EVENT_LABELS[event.event_type] ?? event.event_type}
                                      </Badge>
                                      <div className="min-w-0">
                                        <span className="text-gray-500 dark:text-gray-500 mr-2">
                                          {formatDateTime(event.created_at)}
                                        </span>
                                        <span className="break-all">{event.message}</span>
                                      </div>
                                    </li>
                                  ))}
                                  {job.mail_delivery_events.length === 0 && (
                                    <li className="text-sm text-gray-500 dark:text-gray-400">
                                      {language === 'en' ? 'No events recorded.' : 'Keine Ereignisse protokolliert.'}
                                    </li>
                                  )}
                                </ol>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </AdminPageLayout>
  );
};

export default VerwaltungMail;
