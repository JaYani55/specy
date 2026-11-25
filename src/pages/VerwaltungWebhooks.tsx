import { useCallback, useEffect, useState } from 'react';
import { Webhook, RefreshCw, Plus, Trash2, Copy, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { AdminPageLayout, AdminLoading } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useTheme } from '@/contexts/ThemeContext';
import { usePermissions } from '@/hooks/usePermissions';
import { getVisibleTenantNameMap, getVisibleTenants, type TenantRecord } from '@/services/tenantService';
import {
  WEBHOOK_EVENT_TYPES,
  createWebhookSubscription,
  deleteWebhookSubscription,
  fetchWebhookJobs,
  fetchWebhookSubscriptions,
  updateWebhookSubscription,
  webhookEventLabel,
  type WebhookDeliveryJob,
  type WebhookEventType,
  type WebhookSubscription,
} from '@/services/webhookService';

type DeliveryStatusFilter = 'all' | WebhookDeliveryJob['status'];

const STATUS_STYLES: Record<WebhookDeliveryJob['status'], { label: string; className: string }> = {
  pending: { label: 'Ausstehend', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  delivered: { label: 'Zugestellt', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  failed: { label: 'Fehlgeschlagen', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
};

const formatDateTime = (value: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
};

const VerwaltungWebhooks = () => {
  const { language } = useTheme();
  const { canManageWebhooks } = usePermissions();
  const en = language === 'en';

  const [subscriptions, setSubscriptions] = useState<WebhookSubscription[]>([]);
  const [jobs, setJobs] = useState<WebhookDeliveryJob[]>([]);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'subscriptions' | 'jobs'>('subscriptions');
  const [statusFilter, setStatusFilter] = useState<DeliveryStatusFilter>('all');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newTenantId, setNewTenantId] = useState('');
  const [newEvents, setNewEvents] = useState<WebhookEventType[]>(['object.created']);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [tenantOptions, setTenantOptions] = useState<TenantRecord[]>([]);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [subs, deliveryJobs, tenantMap, tenants] = await Promise.all([
        fetchWebhookSubscriptions(),
        fetchWebhookJobs(200),
        getVisibleTenantNameMap(),
        getVisibleTenants(),
      ]);
      setSubscriptions(subs);
      setJobs(deliveryJobs);
      setTenantNames(tenantMap);
      setTenantOptions(tenants);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (en ? 'Failed to load webhooks' : 'Fehler beim Laden der Webhooks'));
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [en]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreate = async () => {
    if (!newName.trim() || !newUrl.trim() || !newTenantId || newEvents.length === 0) return;
    setIsSubmitting(true);
    try {
      const created = await createWebhookSubscription({
        name: newName.trim(),
        url: newUrl.trim(),
        events: newEvents,
        tenant_id: newTenantId,
      });
      setCreatedSecret(created.signing_secret);
      setSecretCopied(false);
      await loadData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (en ? 'Failed to create subscription' : 'Fehler beim Erstellen des Abonnements'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleActive = async (sub: WebhookSubscription) => {
    try {
      await updateWebhookSubscription(sub.id, { active: !sub.active });
      await loadData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (en ? 'Failed to update subscription' : 'Fehler beim Aktualisieren'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteWebhookSubscription(id);
      toast.success(en ? 'Subscription deleted' : 'Abonnement gelöscht');
      await loadData(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : (en ? 'Failed to delete subscription' : 'Fehler beim Löschen'));
    }
  };

  const resetCreateDialog = () => {
    setNewName('');
    setNewUrl('');
    setNewEvents(['object.created']);
    setCreatedSecret(null);
  };

  const filteredJobs = statusFilter === 'all'
    ? jobs
    : jobs.filter((job) => job.status === statusFilter);

  const tenantLabel = (tenantId: string): string => tenantNames[tenantId] ?? tenantId;

  if (isLoading) {
    return <AdminLoading language={language} />;
  }

  return (
    <AdminPageLayout
      title={en ? 'Outbound Webhooks' : 'Ausgehende Webhooks'}
      description={
        en
          ? 'Subscribe automation targets (e.g. n8n) to workspace events. Deliveries are signed, retried automatically and logged.'
          : 'Abonniere Automatisierungsziele (z. B. n8n) auf Arbeitsbereich-Ereignisse. Zustellungen werden signiert, automatisch wiederholt und protokolliert.'
      }
      icon={Webhook}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void loadData()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {en ? 'Refresh' : 'Aktualisieren'}
          </Button>
          {canManageWebhooks && (
            <Button
              onClick={() => {
                resetCreateDialog();
                setIsCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              {en ? 'New Subscription' : 'Neues Abonnement'}
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-6 flex items-center gap-2">
        {(['subscriptions', 'jobs'] as const).map((tab) => (
          <Button
            key={tab}
            variant={activeTab === tab ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'subscriptions'
              ? (en ? 'Subscriptions' : 'Abonnements')
              : (en ? 'Delivery Log' : 'Zustellungsverlauf')}
          </Button>
        ))}
      </div>

      {activeTab === 'subscriptions' && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{en ? 'Name' : 'Name'}</TableHead>
                <TableHead>{en ? 'Workspace' : 'Arbeitsbereich'}</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>{en ? 'Events' : 'Ereignisse'}</TableHead>
                <TableHead>{en ? 'Active' : 'Aktiv'}</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {subscriptions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                    {en ? 'No subscriptions yet.' : 'Noch keine Abonnements vorhanden.'}
                  </TableCell>
                </TableRow>
              )}
              {subscriptions.map((sub) => (
                <TableRow key={sub.id}>
                  <TableCell className="font-medium">{sub.name}</TableCell>
                  <TableCell>{tenantLabel(sub.tenant_id)}</TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs">{sub.url}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {sub.events.map((event) => (
                        <Badge key={event} variant="secondary">{webhookEventLabel(event)}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {canManageWebhooks ? (
                      <Switch
                        checked={sub.active}
                        onCheckedChange={() => void handleToggleActive(sub)}
                      />
                    ) : (
                      sub.active
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        : <XCircle className="h-4 w-4 text-gray-400" />
                    )}
                  </TableCell>
                  <TableCell>
                    {canManageWebhooks && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <Trash2 className="h-4 w-4 text-red-600" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              {en ? 'Delete subscription?' : 'Abonnement löschen?'}
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              {en
                                ? 'The subscriber URL will no longer receive events. Delivery log entries are kept.'
                                : 'Die Abonnent-URL erhält keine Ereignisse mehr. Protokolleinträge bleiben erhalten.'}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{en ? 'Cancel' : 'Abbrechen'}</AlertDialogCancel>
                            <AlertDialogAction onClick={() => void handleDelete(sub.id)}>
                              {en ? 'Delete' : 'Löschen'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {activeTab === 'jobs' && (
        <>
          <div className="mb-4">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as DeliveryStatusFilter)}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{en ? 'All statuses' : 'Alle Status'}</SelectItem>
                {(['pending', 'delivered', 'failed'] as const).map((status) => (
                  <SelectItem key={status} value={status}>{STATUS_STYLES[status].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{en ? 'Event' : 'Ereignis'}</TableHead>
                  <TableHead>{en ? 'Status' : 'Status'}</TableHead>
                  <TableHead>{en ? 'Attempts' : 'Versuche'}</TableHead>
                  <TableHead>{en ? 'Response' : 'Antwort'}</TableHead>
                  <TableHead>{en ? 'Created' : 'Erstellt'}</TableHead>
                  <TableHead>{en ? 'Delivered' : 'Zugestellt'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-500 py-8">
                      {en ? 'No deliveries yet.' : 'Noch keine Zustellungen vorhanden.'}
                    </TableCell>
                  </TableRow>
                )}
                {filteredJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-xs">{webhookEventLabel(job.event)}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_STYLES[job.status].className}>
                        {STATUS_STYLES[job.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell>{job.attempts} / {job.max_attempts}</TableCell>
                    <TableCell>
                      {job.last_response_status ?? '—'}
                      {job.last_error && (
                        <div className="text-xs text-red-600 dark:text-red-400">{job.last_error}</div>
                      )}
                    </TableCell>
                    <TableCell>{formatDateTime(job.created_at)}</TableCell>
                    <TableCell>{formatDateTime(job.delivered_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          if (!open) setIsCreateOpen(false);
        }}
      >
        <DialogContent className="max-w-lg">
          {createdSecret === null ? (
            <>
              <DialogHeader>
                <DialogTitle>{en ? 'New Webhook Subscription' : 'Neues Webhook-Abonnement'}</DialogTitle>
                <DialogDescription>
                  {en
                    ? 'Register an HTTPS endpoint that receives signed event deliveries.'
                    : 'Registriere einen HTTPS-Endpunkt, der signierte Ereignis-Zustellungen empfängt.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="webhook-name">{en ? 'Name' : 'Name'}</Label>
                  <Input
                    id="webhook-name"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={en ? 'e.g. n8n automation' : 'z. B. n8n-Automatisierung'}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="webhook-url">URL</Label>
                  <Input
                    id="webhook-url"
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{en ? 'Workspace' : 'Arbeitsbereich'}</Label>
                  <Select value={newTenantId} onValueChange={setNewTenantId}>
                    <SelectTrigger>
                      <SelectValue placeholder={en ? 'Select workspace' : 'Arbeitsbereich wählen'} />
                    </SelectTrigger>
                    <SelectContent>
                      {tenantOptions.map((tenant) => (
                        <SelectItem key={tenant.id} value={tenant.id}>
                          {tenant.organization_name ?? tenant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{en ? 'Events' : 'Ereignisse'}</Label>
                  <div className="space-y-2">
                    {WEBHOOK_EVENT_TYPES.map((event) => (
                      <label key={event} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={newEvents.includes(event)}
                          onCheckedChange={(checked) => {
                            setNewEvents((prev) => (
                              checked
                                ? [...prev, event]
                                : prev.filter((e) => e !== event)
                            ));
                          }}
                        />
                        {webhookEventLabel(event)}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                  {en ? 'Cancel' : 'Abbrechen'}
                </Button>
                <Button onClick={() => void handleCreate()} disabled={isSubmitting}>
                  {en ? 'Create' : 'Erstellen'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{en ? 'Subscription created' : 'Abonnement erstellt'}</DialogTitle>
                <DialogDescription>
                  {en
                    ? 'Store the signing secret now — it is shown only once.'
                    : 'Speichere das Signaturgeheimnis jetzt — es wird nur einmal angezeigt.'}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 py-2">
                <code className="flex-1 rounded bg-gray-100 dark:bg-gray-800 px-3 py-2 text-xs break-all">
                  {createdSecret}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(createdSecret);
                      setSecretCopied(true);
                    } catch {
                      toast.error(en ? 'Copy failed' : 'Kopieren fehlgeschlagen');
                    }
                  }}
                >
                  {secretCopied
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setIsCreateOpen(false);
                    setActiveTab('subscriptions');
                  }}
                >
                  {en ? 'Done' : 'Fertig'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </AdminPageLayout>
  );
};

export default VerwaltungWebhooks;
