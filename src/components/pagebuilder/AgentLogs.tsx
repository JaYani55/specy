import React, { useEffect, useState, useCallback } from 'react';
import {
  Download, Trash2, RefreshCw, ChevronDown, ChevronRight,
  AlertTriangle, Activity, Clock, Globe, Filter, X,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';
import type { AgentLog, AgentLogStats, PageSchema } from '@/types/pagebuilder';
import {
  fetchLogs,
  fetchLogStats,
  downloadLogs,
  deleteAllLogs,
  deleteLogEntry,
  type FetchLogsParams,
} from '@/services/agentLogService';

interface AgentLogsProps {
  language: string;
  schemas: PageSchema[];
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  POST: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  PUT: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  PATCH: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  DELETE: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};

const statusColor = (code: number | null) => {
  if (!code) return 'text-muted-foreground';
  if (code < 300) return 'text-green-600 dark:text-green-400';
  if (code < 400) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
};

const formatDuration = (ms: number | null) => {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

// ─── Single Log Row ────────────────────────────────────────────────

const LogRow: React.FC<{
  log: AgentLog;
  language: string;
  onDelete: (id: string) => void;
}> = ({ log, language, onDelete }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-muted/50 last:border-0">
      <div
        className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer text-sm"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}

        {/* Method badge */}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider shrink-0 ${METHOD_COLORS[log.method] || 'bg-gray-100 text-gray-700'}`}>
          {log.method}
        </span>

        {/* Path */}
        <span className="font-mono text-xs truncate flex-1 text-foreground/80" title={log.path}>{log.operation_name || log.path}</span>

        {/* Status */}
        <span className={`font-mono text-xs font-semibold shrink-0 ${statusColor(log.status_code)}`}>
          {log.status_code ?? '—'}
        </span>

        {/* Duration */}
        <span className="text-xs text-muted-foreground shrink-0 w-16 text-right">
          {formatDuration(log.duration_ms)}
        </span>

        {/* Time */}
        <span className="text-xs text-muted-foreground shrink-0 w-32 text-right hidden md:inline">
          {formatTime(log.created_at)}
        </span>
      </div>

      {expanded && (
        <div className="px-4 pb-3 ml-7 space-y-3">
          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {log.schema_slug && (
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3" /> {log.schema_slug}
              </span>
            )}
            {(log.user_email || log.user_id) && (
              <span title={log.user_id ?? undefined}>
                {language === 'en' ? 'Account:' : 'Konto:'} {log.user_email || log.user_id}
              </span>
            )}
            {log.transport_status_code !== null && log.transport_status_code !== log.status_code && (
              <span>
                {language === 'en' ? 'HTTP transport:' : 'HTTP-Transport:'} {log.transport_status_code}
              </span>
            )}
            {log.ip_address && (
              <span>IP: {log.ip_address}</span>
            )}
            {log.user_agent && (
              <span className="truncate max-w-xs" title={log.user_agent}>
                UA: {log.user_agent.substring(0, 60)}{log.user_agent.length > 60 ? '…' : ''}
              </span>
            )}
            <span>{new Date(log.created_at).toLocaleString('de-DE')}</span>
          </div>

          {/* Error */}
          {log.error && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 rounded-lg p-3 text-xs text-red-700 dark:text-red-400">
              <strong>{language === 'en' ? 'Error:' : 'Fehler:'}</strong> {log.error}
            </div>
          )}

          {/* Request body */}
          {log.request_body && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Request Body</p>
              <pre className="bg-muted/40 rounded-lg p-3 text-xs font-mono overflow-auto max-h-48">
                {JSON.stringify(log.request_body, null, 2)}
              </pre>
            </div>
          )}

          {/* Response body */}
          {log.response_body && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Response Body</p>
              <pre className="bg-muted/40 rounded-lg p-3 text-xs font-mono overflow-auto max-h-48">
                {JSON.stringify(log.response_body, null, 2)}
              </pre>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              onClick={(e) => { e.stopPropagation(); onDelete(log.id); }}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {language === 'en' ? 'Delete' : 'Löschen'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Stats Cards ───────────────────────────────────────────────────

const StatsCards: React.FC<{ stats: AgentLogStats; language: string }> = ({ stats, language }) => (
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
    <div className="bg-muted/30 rounded-lg p-3 text-center">
      <p className="text-2xl font-bold">{stats.total}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {language === 'en' ? 'Total Requests' : 'Anfragen gesamt'}
      </p>
    </div>
    <div className="bg-muted/30 rounded-lg p-3 text-center">
      <p className="text-2xl font-bold">{stats.last_24h}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {language === 'en' ? 'Last 24 h' : 'Letzte 24 h'}
      </p>
    </div>
    <div className="bg-muted/30 rounded-lg p-3 text-center">
      <p className={`text-2xl font-bold ${stats.errors > 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{stats.errors}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {language === 'en' ? 'Errors' : 'Fehler'}
      </p>
    </div>
    <div className="bg-muted/30 rounded-lg p-3 text-center">
      <p className="text-2xl font-bold">{stats.unique_agents}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {language === 'en' ? 'Unique Agents' : 'Einzigartige Agents'}
      </p>
    </div>
  </div>
);

// ─── Main Component ────────────────────────────────────────────────

const AgentLogs: React.FC<AgentLogsProps> = ({ language, schemas }) => {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [stats, setStats] = useState<AgentLogStats | null>(null);
  const [pagination, setPagination] = useState({ page: 1, limit: 30, total: 0, pages: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Filters
  const [filterSchema, setFilterSchema] = useState<string>('all');
  const [filterMethod, setFilterMethod] = useState<string>('all');
  const [filterErrors, setFilterErrors] = useState(false);

  const loadData = useCallback(async (page = 1) => {
    try {
      setIsLoading(true);
      const params: FetchLogsParams = { page, limit: 30 };
      if (filterSchema !== 'all') params.schema_slug = filterSchema;
      if (filterMethod !== 'all') params.method = filterMethod;
      if (filterErrors) params.min_status = 400;

      const [logsResult, statsResult] = await Promise.all([
        fetchLogs(params),
        fetchLogStats(),
      ]);

      setLogs(logsResult.logs);
      setPagination(logsResult.pagination);
      setStats(statsResult);
    } catch (err) {
      toast.error(language === 'en' ? 'Failed to load logs' : 'Logs konnten nicht geladen werden');
    } finally {
      setIsLoading(false);
    }
  }, [filterSchema, filterMethod, filterErrors, language]);

  useEffect(() => {
    loadData(1);
  }, [loadData]);

  const handleDeleteEntry = async (id: string) => {
    try {
      await deleteLogEntry(id);
      setLogs(prev => prev.filter(l => l.id !== id));
      toast.success(language === 'en' ? 'Log entry deleted' : 'Logeintrag gelöscht');
    } catch {
      toast.error(language === 'en' ? 'Failed to delete' : 'Löschen fehlgeschlagen');
    }
  };

  const handleDeleteAll = async () => {
    try {
      setIsDeleting(true);
      await deleteAllLogs();
      setDeleteDialogOpen(false);
      toast.success(language === 'en' ? 'All logs deleted' : 'Alle Logs gelöscht');
      loadData(1);
    } catch {
      toast.error(language === 'en' ? 'Failed to delete logs' : 'Löschen fehlgeschlagen');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDownload = async () => {
    try {
      await downloadLogs(filterSchema !== 'all' ? { schema_slug: filterSchema } : {});
      toast.success(language === 'en' ? 'Download started' : 'Download gestartet');
    } catch {
      toast.error(language === 'en' ? 'Download failed' : 'Download fehlgeschlagen');
    }
  };

  const hasFilters = filterSchema !== 'all' || filterMethod !== 'all' || filterErrors;
  const clearFilters = () => {
    setFilterSchema('all');
    setFilterMethod('all');
    setFilterErrors(false);
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-lg">
                {language === 'en' ? 'Agent Communication Logs' : 'Agent-Kommunikationslogs'}
              </CardTitle>
              <CardDescription>
                {language === 'en'
                  ? 'All requests from frontend agents to the CMS API'
                  : 'Alle Anfragen von Frontend-Agents an die CMS-API'}
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => loadData(pagination.page)}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isLoading ? 'animate-spin' : ''}`} />
              {language === 'en' ? 'Refresh' : 'Aktualisieren'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {language === 'en' ? 'Download' : 'Herunterladen'}
            </Button>
            <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30">
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  {language === 'en' ? 'Clear All' : 'Alle löschen'}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {language === 'en' ? 'Delete all logs?' : 'Alle Logs löschen?'}
                  </DialogTitle>
                  <DialogDescription>
                    {language === 'en'
                      ? 'This will permanently delete all agent communication logs. This action cannot be undone.'
                      : 'Alle Agent-Kommunikationslogs werden unwiderruflich gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.'}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                    {language === 'en' ? 'Cancel' : 'Abbrechen'}
                  </Button>
                  <Button variant="destructive" onClick={handleDeleteAll} disabled={isDeleting}>
                    {isDeleting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
                    {language === 'en' ? 'Delete All' : 'Alle löschen'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats */}
        {stats && <StatsCards stats={stats} language={language} />}

        <Separator />

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Filter className="h-3.5 w-3.5" />
            {language === 'en' ? 'Filters' : 'Filter'}:
          </div>

          <Select value={filterSchema} onValueChange={setFilterSchema}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue placeholder="Schema" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{language === 'en' ? 'All schemas' : 'Alle Schemas'}</SelectItem>
              {schemas.map(s => (
                <SelectItem key={s.slug} value={s.slug}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterMethod} onValueChange={setFilterMethod}>
            <SelectTrigger className="w-28 h-8 text-xs">
              <SelectValue placeholder="Method" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{language === 'en' ? 'All methods' : 'Alle Methoden'}</SelectItem>
              <SelectItem value="GET">GET</SelectItem>
              <SelectItem value="POST">POST</SelectItem>
              <SelectItem value="PUT">PUT</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={filterErrors ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setFilterErrors(!filterErrors)}
          >
            <AlertTriangle className="h-3 w-3 mr-1" />
            {language === 'en' ? 'Errors only' : 'Nur Fehler'}
          </Button>

          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
              <X className="h-3 w-3 mr-1" />
              {language === 'en' ? 'Clear' : 'Zurücksetzen'}
            </Button>
          )}
        </div>

        {/* Log entries */}
        <div className="border rounded-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-2 bg-muted/40 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b">
            <span className="w-3.5" />
            <span className="w-12">Method</span>
            <span className="flex-1">Path</span>
            <span className="w-10 text-right">Status</span>
            <span className="w-16 text-right">{language === 'en' ? 'Duration' : 'Dauer'}</span>
            <span className="w-32 text-right hidden md:inline">{language === 'en' ? 'Time' : 'Zeit'}</span>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="h-5 w-5 animate-spin mr-2" />
              {language === 'en' ? 'Loading logs…' : 'Lade Logs…'}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground space-y-2">
              <Activity className="h-8 w-8 opacity-40" />
              <p className="text-sm">
                {hasFilters
                  ? (language === 'en' ? 'No logs match your filters' : 'Keine Logs entsprechen deinen Filtern')
                  : (language === 'en' ? 'No agent communication logged yet' : 'Noch keine Agent-Kommunikation protokolliert')}
              </p>
            </div>
          ) : (
            logs.map((log) => (
              <LogRow key={log.id} log={log} language={language} onDelete={handleDeleteEntry} />
            ))
          )}
        </div>

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between text-sm">
            <p className="text-muted-foreground text-xs">
              {language === 'en'
                ? `Page ${pagination.page} of ${pagination.pages} · ${pagination.total} total`
                : `Seite ${pagination.page} von ${pagination.pages} · ${pagination.total} gesamt`}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page <= 1}
                onClick={() => loadData(pagination.page - 1)}
              >
                ← {language === 'en' ? 'Previous' : 'Zurück'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pagination.page >= pagination.pages}
                onClick={() => loadData(pagination.page + 1)}
              >
                {language === 'en' ? 'Next' : 'Weiter'} →
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default AgentLogs;
