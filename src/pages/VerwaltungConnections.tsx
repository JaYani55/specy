import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  RefreshCw,
  Shield,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Database,
  HardDrive,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  Loader2,
  Copy,
  Check,
  AlertTriangle,
  Info,
  Unplug,
  CheckCircle2,
  XCircle,
  FlaskConical,
  Server,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { getPluginAdminConnectionSections } from '@/plugins/loader';
import type { PluginAdminConnectionSection } from '@/types/plugin';
import {
  listSecrets,
  getEnvStatus,
  upsertSecret,
  deleteSecret,
  getMailConfigSettings,
  testMailConnection,
  updateMailConfigSettings,
  getMediaConfig,
  testMediaConnection,
  getMediaMountsConfig,
  updateMediaMountsConfig,
  upsertMediaSourceSecret,
  deleteMediaMount,
  SECRETS_MANIFEST,
  type CfSecret,
  type SecretDefinition,
  type MediaConfig,
  type EnvStatusEntry,
  type MailConfigSettings,
  type MailSecretStatus,
  type MediaMount,
} from '@/services/connectionsService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const OPERATIONAL_CONFIG_SECRET_NAMES = new Set(['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'STORAGE_PROVIDER', 'STORAGE_BUCKET', 'R2_PUBLIC_URL']);

// ─── Types ─────────────────────────────────────────────────────────────────

interface SecretWithStatus extends SecretDefinition {
  cfSecret: CfSecret | null; // null = not yet stored in CF
  envConfigured: boolean;    // true = value present via env-var or secrets-store binding
}

interface EditState {
  secret: SecretWithStatus;
  value: string;
  comment: string;
  showValue: boolean;
  saving: boolean;
}

interface MailConfigState extends MailConfigSettings, MailSecretStatus {
  smtpPassword: string;
  resendApiKey: string;
  saving: boolean;
  testing: boolean;
  lastTest: {
    ok: boolean;
    provider?: 'smtp' | 'resend';
    detail?: string;
    error?: string;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function CategoryIcon({ category }: { category: string }) {
  if (category === 'Database') return <Database className="h-4 w-4" />;
  if (category === 'Storage') return <HardDrive className="h-4 w-4" />;
  return <KeyRound className="h-4 w-4" />;
}

function StatusBadge({ secret }: { secret: SecretWithStatus }) {
  const isConfigured = secret.cfSecret !== null || secret.envConfigured;
  if (!isConfigured) {
    return (
      <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30 gap-1">
        <ShieldAlert className="h-3 w-3" />
        Not configured
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-green-600 border-green-300 bg-green-50 dark:bg-green-950/30 gap-1">
      <ShieldCheck className="h-3 w-3" />
      Configured
    </Badge>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ─── Main component ────────────────────────────────────────────────────────

const VerwaltungConnections: React.FC = () => {
  const navigate = useNavigate();
  const permissions = usePermissions();

  const [loading, setLoading] = useState(true);
  const [cfSecrets, setCfSecrets] = useState<CfSecret[]>([]);
  const [envStatusMap, setEnvStatusMap] = useState<Record<string, boolean>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [mailConfig, setMailConfig] = useState<MailConfigState>({
    provider: '',
    fromName: '',
    fromEmail: '',
    replyToEmail: '',
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUsername: '',
    smtpPassword: '',
    resendApiKey: '',
    smtpPasswordConfigured: false,
    resendApiKeyConfigured: false,
    saving: false,
    testing: false,
    lastTest: null,
  });

  // Media storage live status
  const [mediaConfig, setMediaConfig] = useState<MediaConfig | null>(null);
  const [mediaTesting, setMediaTesting] = useState(false);
  const [mediaTestResult, setMediaTestResult] = useState<{ ok: boolean; itemCount?: number; error?: string } | null>(null);

  // Media mounts
  const [mediaMounts, setMediaMounts] = useState<MediaMount[]>([]);
  const [mountsSaving, setMountsSaving] = useState(false);
  const [mountDialogOpen, setMountDialogOpen] = useState(false);
  const [editingMount, setEditingMount] = useState<MediaMount | null>(null);
  const [mountForm, setMountForm] = useState<MediaMount & { secretAccessKey: string }>({
    id: '',
    label: '',
    type: 'supabase',
    bucket: '',
    isDefault: true,
    endpoint: '',
    region: 'us-east-1',
    publicUrl: '',
    accessKeyId: '',
    secretAccessKey: '',
  });
  const [deletingMountId, setDeletingMountId] = useState<string | null>(null);

  // Edit dialog state
  const [editState, setEditState] = useState<EditState | null>(null);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<SecretWithStatus | null>(null);

  // Custom secret creation
  const [addCustomOpen, setAddCustomOpen] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customValue, setCustomValue] = useState('');
  const [customComment, setCustomComment] = useState('');
  const [customShowValue, setCustomShowValue] = useState(false);
  const [customSaving, setCustomSaving] = useState(false);

  // Redirect if insufficient permissions
  useEffect(() => {
    if (!permissions.canManageAccounts || !permissions.userRoles.includes('super-admin')) {
      navigate('/admin');
    }
  }, [permissions.canManageAccounts, permissions.userRoles, navigate]);

  const loadSecrets = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const [data, envEntries] = await Promise.all([
        listSecrets().catch(() => [] as CfSecret[]),
        getEnvStatus(),
      ]);
      setCfSecrets(data);
      const map: Record<string, boolean> = {};
      envEntries.forEach((e: EnvStatusEntry) => { map[e.name] = e.hasValue; });
      setEnvStatusMap(map);
      // Only show API error if both failed
      if (data.length === 0 && envEntries.length === 0) {
        setApiError('Could not reach Worker API. Make sure the Worker is deployed.');
      }
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to load secrets from Cloudflare');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMailConfig = useCallback(async () => {
    try {
      const config = await getMailConfigSettings();
      setMailConfig((current) => ({
        ...current,
        ...config.mail,
        ...config.secrets,
        smtpPassword: '',
        resendApiKey: '',
        saving: false,
        testing: false,
      }));
    } catch (err) {
      setApiError(err instanceof Error ? err.message : 'Failed to load mail configuration');
    }
  }, []);

  const loadMediaStatus = useCallback(async () => {
    try {
      const cfg = await getMediaConfig();
      setMediaConfig(cfg);
    } catch {
      setMediaConfig(null);
    }
  }, []);

  const loadMediaMounts = useCallback(async () => {
    try {
      const mounts = await getMediaMountsConfig();
      setMediaMounts(mounts);
    } catch {
      // non-critical
    }
  }, []);

  useEffect(() => {
    loadSecrets();
    loadMailConfig();
    loadMediaStatus();
    loadMediaMounts();
  }, [loadSecrets, loadMailConfig, loadMediaStatus, loadMediaMounts]);

  // Build merged list: manifest entry + CF secrets store status + env-var status
  const secretsWithStatus: SecretWithStatus[] = SECRETS_MANIFEST.map((def) => ({
    ...def,
    cfSecret: cfSecrets.find((s) => s.name === def.name) ?? null,
    envConfigured: envStatusMap[def.name] ?? false,
  }));

  // Group by category
  const categories = Array.from(new Set(SECRETS_MANIFEST.map((s) => s.category)));

  // ── Edit handlers ──────────────────────────────────────────────────────

  const openEdit = (secret: SecretWithStatus) => {
    setEditState({
      secret,
      value: '',
      comment: secret.cfSecret?.comment ?? '',
      showValue: false,
      saving: false,
    });
  };

  const saveEdit = async () => {
    if (!editState) return;
    if (!editState.value.trim()) {
      toast.error('Value cannot be empty');
      return;
    }
    setEditState((s) => s && { ...s, saving: true });
    try {
      await upsertSecret(editState.secret.name, editState.value, editState.comment);
      toast.success(`Secret "${editState.secret.name}" saved successfully`);
      setEditState(null);
      await loadSecrets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save secret');
      setEditState((s) => s && { ...s, saving: false });
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteSecret(deleteTarget.name);
      toast.success(`Secret "${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      await loadSecrets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete secret');
      setDeleteTarget(null);
    }
  };

  // ── Custom secret handlers ────────────────────────────────────────────

  const saveCustom = async () => {
    if (!customName.trim() || !customValue.trim()) {
      toast.error('Name and value are required');
      return;
    }
    if (/\s/.test(customName)) {
      toast.error('Secret name cannot contain spaces');
      return;
    }
    setCustomSaving(true);
    try {
      await upsertSecret(customName.toUpperCase().replace(/[^A-Z0-9_]/g, '_'), customValue, customComment);
      toast.success(`Secret "${customName}" saved`);
      setAddCustomOpen(false);
      setCustomName('');
      setCustomValue('');
      setCustomComment('');
      await loadSecrets();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save secret');
    } finally {
      setCustomSaving(false);
    }
  };

  // ── Media mount handlers ────────────────────────────────────────────────

  const normalizeDefaultMounts = (mounts: MediaMount[]): MediaMount[] => {
    if (mounts.length === 0) {
      return [];
    }

    const defaultMountId = mounts.find((mount) => mount.isDefault)?.id ?? mounts[0].id;
    return mounts.map((mount) => ({
      ...mount,
      isDefault: mount.id === defaultMountId,
    }));
  };

  const openAddMount = () => {
    setEditingMount(null);
    setMountForm({
      id: '',
      label: '',
      type: 'supabase',
      bucket: '',
      isDefault: mediaMounts.length === 0,
      endpoint: '',
      region: 'us-east-1',
      publicUrl: '',
      accessKeyId: '',
      secretAccessKey: '',
    });
    setMountDialogOpen(true);
  };

  const openEditMount = (mount: MediaMount) => {
    setEditingMount(mount);
    setMountForm({
      id: mount.id,
      label: mount.label,
      type: mount.type,
      bucket: mount.bucket,
      isDefault: mount.isDefault,
      endpoint: mount.endpoint ?? '',
      region: mount.region ?? 'us-east-1',
      publicUrl: mount.publicUrl ?? '',
      accessKeyId: mount.accessKeyId ?? '',
      secretAccessKey: '',
    });
    setMountDialogOpen(true);
  };

  const saveMountDialog = async () => {
    const { secretAccessKey, ...rawMountData } = mountForm;
    if (!rawMountData.id.trim() || !rawMountData.label.trim() || !rawMountData.bucket.trim()) {
      toast.error('ID, label and bucket are required');
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(rawMountData.id)) {
      toast.error('ID must be lowercase alphanumeric with hyphens (e.g. "aws-photos")');
      return;
    }
    if (rawMountData.type === 's3' && !rawMountData.endpoint?.trim()) {
      toast.error('S3 mounts require an endpoint');
      return;
    }

    const mountData: MediaMount = {
      id: rawMountData.id.trim(),
      label: rawMountData.label.trim(),
      type: rawMountData.type,
      bucket: rawMountData.bucket.trim(),
      isDefault: rawMountData.isDefault,
      endpoint: rawMountData.type === 's3' ? rawMountData.endpoint?.trim() || '' : undefined,
      region: rawMountData.type === 's3' ? rawMountData.region?.trim() || '' : undefined,
      publicUrl: rawMountData.type === 'r2' || rawMountData.type === 's3' ? rawMountData.publicUrl?.trim() || '' : undefined,
      accessKeyId: rawMountData.type === 's3' ? rawMountData.accessKeyId?.trim() || '' : undefined,
    };

    setMountsSaving(true);
    try {
      const updatedMounts = editingMount
        ? mediaMounts.map((mount) => (mount.id === editingMount.id ? mountData : mount))
        : [...mediaMounts, mountData];
      const saved = await updateMediaMountsConfig(normalizeDefaultMounts(updatedMounts));
      if (secretAccessKey.trim()) {
        await upsertMediaSourceSecret(mountData.id, secretAccessKey.trim());
      }
      setMediaMounts(saved);
      setMountDialogOpen(false);
      await loadMediaStatus();
      toast.success(editingMount ? 'Mount updated' : 'Mount added');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save mount');
    } finally {
      setMountsSaving(false);
    }
  };

  const setDefaultMount = async (mountId: string) => {
    setMountsSaving(true);
    try {
      const saved = await updateMediaMountsConfig(
        mediaMounts.map((mount) => ({
          ...mount,
          isDefault: mount.id === mountId,
        })),
      );
      setMediaMounts(saved);
      await loadMediaStatus();
      toast.success('Default mount updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update default mount');
    } finally {
      setMountsSaving(false);
    }
  };

  const confirmDeleteMount = async () => {
    if (!deletingMountId) return;
    try {
      await deleteMediaMount(deletingMountId);
      setMediaMounts((prev) => prev.filter((mount) => mount.id !== deletingMountId));
      setDeletingMountId(null);
      await loadMediaStatus();
      toast.success('Mount removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove mount');
    }
  };

  const saveMailConfig = async () => {
    if (!mailConfig.provider) {
      toast.error('Provider is required');
      return;
    }

    if (!mailConfig.fromEmail.trim()) {
      toast.error('From e-mail is required');
      return;
    }

    setMailConfig((current) => ({ ...current, saving: true }));
    try {
      const result = await updateMailConfigSettings({
        provider: mailConfig.provider,
        fromName: mailConfig.fromName,
        fromEmail: mailConfig.fromEmail,
        replyToEmail: mailConfig.replyToEmail,
        smtpHost: mailConfig.smtpHost,
        smtpPort: Number(mailConfig.smtpPort) || 587,
        smtpSecure: mailConfig.smtpSecure,
        smtpUsername: mailConfig.smtpUsername,
        smtpPassword: mailConfig.smtpPassword,
        resendApiKey: mailConfig.resendApiKey,
      });

      setMailConfig((current) => ({
        ...current,
        ...result.mail,
        ...result.secrets,
        smtpPassword: '',
        resendApiKey: '',
        saving: false,
      }));
      toast.success('Mail configuration saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save mail configuration');
      setMailConfig((current) => ({ ...current, saving: false }));
    }
  };

  const runMailTest = async () => {
    setMailConfig((current) => ({ ...current, testing: true, lastTest: null }));
    try {
      const result = await testMailConnection();
      setMailConfig((current) => ({
        ...current,
        testing: false,
        lastTest: {
          ok: result.success,
          provider: result.provider,
          detail: result.detail,
        },
      }));
      toast.success('Mail connection succeeded');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Mail test failed';
      setMailConfig((current) => ({
        ...current,
        testing: false,
        lastTest: {
          ok: false,
          error: message,
        },
      }));
      toast.error(message);
    }
  };

  // Extra CF secrets not in the manifest
  const extraCfSecrets = cfSecrets.filter(
    (s) => !SECRETS_MANIFEST.some((m) => m.name === s.name) && !OPERATIONAL_CONFIG_SECRET_NAMES.has(s.name),
  );

  // Plugin admin connection sections
  const pluginAdminSections = useMemo<PluginAdminConnectionSection[]>(
    () => getPluginAdminConnectionSections(permissions.roles),
    [permissions.roles],
  );

  // ── Summary stats ───────────────────────────────────────────────────────

  const isConfigured = (s: SecretWithStatus) => s.cfSecret !== null || s.envConfigured;
  const configuredCount = secretsWithStatus.filter(isConfigured).length;
  const requiredCount = secretsWithStatus.filter((s) => s.required).length;
  const requiredConfigured = secretsWithStatus.filter((s) => s.required && isConfigured(s)).length;
  const allRequiredDone = requiredConfigured === requiredCount;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">

        {/* ── Header ── */}
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="mt-1">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Zurück
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-slate-700 to-slate-900 flex items-center justify-center shadow">
                <Unplug className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Connections</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Manage runtime secrets separately from non-sensitive system configuration
                </p>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void loadSecrets();
              void loadMailConfig();
              void loadMediaStatus();
              void loadMediaMounts();
            }}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {/* ── API Error banner ── */}
        {apiError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Could not reach Cloudflare API:</strong> {apiError}
              <br />
              <span className="text-xs mt-1 block opacity-80">
                Make sure the Worker is deployed and <code>CF_API_TOKEN</code>, <code>CF_ACCOUNT_ID</code>,
                and <code>SECRETS_STORE_ID</code> are all configured in <code>wrangler.jsonc</code>.
              </span>
            </AlertDescription>
          </Alert>
        )}

        {/* ── Status summary ── */}
        {!apiError && (
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="text-2xl font-bold">{configuredCount} / {secretsWithStatus.length}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Secrets configured</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className={`text-2xl font-bold ${allRequiredDone ? 'text-green-600' : 'text-amber-500'}`}>
                  {requiredConfigured} / {requiredCount}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">Required secrets</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5 pb-4">
                <div className="text-2xl font-bold">{cfSecrets.length}</div>
                <div className="text-xs text-muted-foreground mt-0.5">Managed secrets in store</div>
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4" />
              Storage Mounts
            </CardTitle>
            <CardDescription>
              Configure the buckets and object stores exposed to media and data pickers. Each mount appears like a selectable drive, and one mount is marked as the default for legacy flows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {mediaMounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No mounts configured yet. Add at least one Supabase, R2, or S3 mount to expose it in the pickers.</p>
            ) : (
              <div className="space-y-2">
                {mediaMounts.map((mount) => (
                  <div key={mount.id} className="flex items-center justify-between rounded-lg border p-3 gap-4">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{mount.label}</span>
                        <Badge variant="outline" className="text-xs font-mono">{mount.id}</Badge>
                        <Badge variant="secondary" className="text-xs uppercase">{mount.type}</Badge>
                        {mount.isDefault && <Badge className="text-xs">Default drive</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground break-all">
                        {mount.type === 's3'
                          ? `${mount.endpoint || 'S3 endpoint missing'} / ${mount.bucket}`
                          : mount.bucket}
                      </p>
                      {(mount.type === 'r2' || mount.type === 's3') && mount.publicUrl && (
                        <p className="text-xs text-muted-foreground break-all">Delivery: {mount.publicUrl}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!mount.isDefault && (
                        <Button size="sm" variant="outline" onClick={() => void setDefaultMount(mount.id)} disabled={mountsSaving}>
                          Set default
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => openEditMount(mount)}>
                        <Pencil className="h-3 w-3 mr-1" />Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeletingMountId(mount.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={openAddMount}>
                <Plus className="h-4 w-4 mr-2" />
                Add mount
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadMediaMounts()} disabled={mountsSaving}>
                Reload mounts
              </Button>
            </div>
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Supabase mounts reuse your existing project credentials. R2 mounts currently use the single Worker binding <code>MEDIA_BUCKET</code>, so only one R2 bucket can be live at a time unless you add more Worker bindings.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FlaskConical className="h-4 w-4" />
              Mail Configuration
            </CardTitle>
            <CardDescription>
              Configure the outbound mail provider, sender identity, and provider credentials used by form notifications.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Provider</Label>
                <Select
                  value={mailConfig.provider}
                  onValueChange={(value) => setMailConfig((current) => ({ ...current, provider: value as MailConfigSettings['provider'] }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="smtp">SMTP</SelectItem>
                    <SelectItem value="resend">Resend</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mail-from-name">From Name</Label>
                <Input
                  id="mail-from-name"
                  value={mailConfig.fromName}
                  onChange={(event) => setMailConfig((current) => ({ ...current, fromName: event.target.value }))}
                  placeholder="ServiceCMS"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mail-from-email">From E-Mail</Label>
                <Input
                  id="mail-from-email"
                  value={mailConfig.fromEmail}
                  onChange={(event) => setMailConfig((current) => ({ ...current, fromEmail: event.target.value }))}
                  placeholder="noreply@example.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mail-reply-to">Reply-To</Label>
                <Input
                  id="mail-reply-to"
                  value={mailConfig.replyToEmail}
                  onChange={(event) => setMailConfig((current) => ({ ...current, replyToEmail: event.target.value }))}
                  placeholder="support@example.com"
                />
              </div>
            </div>

            {mailConfig.provider === 'smtp' && (
              <div className="rounded-lg border p-4 space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="mail-smtp-host">SMTP Host</Label>
                    <Input
                      id="mail-smtp-host"
                      value={mailConfig.smtpHost}
                      onChange={(event) => setMailConfig((current) => ({ ...current, smtpHost: event.target.value }))}
                      placeholder="smtp.resend.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mail-smtp-port">SMTP Port</Label>
                    <Input
                      id="mail-smtp-port"
                      type="number"
                      value={mailConfig.smtpPort}
                      onChange={(event) => setMailConfig((current) => ({ ...current, smtpPort: Number(event.target.value) || 587 }))}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="mail-smtp-username">SMTP Username</Label>
                    <Input
                      id="mail-smtp-username"
                      value={mailConfig.smtpUsername}
                      onChange={(event) => setMailConfig((current) => ({ ...current, smtpUsername: event.target.value }))}
                      placeholder="resend"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mail-smtp-password">SMTP Password</Label>
                    <Input
                      id="mail-smtp-password"
                      type="password"
                      value={mailConfig.smtpPassword}
                      onChange={(event) => setMailConfig((current) => ({ ...current, smtpPassword: event.target.value }))}
                      placeholder={mailConfig.smtpPasswordConfigured ? 'Leave blank to keep current password' : 'Enter SMTP password'}
                    />
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant={mailConfig.smtpPasswordConfigured ? 'default' : 'outline'}>
                        {mailConfig.smtpPasswordConfigured ? 'Password stored' : 'Password missing'}
                      </Badge>
                      <span>{mailConfig.smtpPasswordConfigured ? 'Stored securely in managed secrets' : 'Required before sending mail'}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-md bg-muted/40 p-3">
                  <div>
                    <Label>Use TLS immediately</Label>
                    <p className="text-xs text-muted-foreground">Enable this for providers that expect SMTPS on connect.</p>
                  </div>
                  <Switch checked={mailConfig.smtpSecure} onCheckedChange={(value) => setMailConfig((current) => ({ ...current, smtpSecure: value }))} />
                </div>
              </div>
            )}

            {mailConfig.provider === 'resend' && (
              <div className="rounded-lg border p-4 space-y-2">
                <Label htmlFor="mail-resend-key">Resend API Key</Label>
                <Input
                  id="mail-resend-key"
                  type="password"
                  value={mailConfig.resendApiKey}
                  onChange={(event) => setMailConfig((current) => ({ ...current, resendApiKey: event.target.value }))}
                  placeholder={mailConfig.resendApiKeyConfigured ? 'Leave blank to keep current API key' : 're_...'}
                />
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={mailConfig.resendApiKeyConfigured ? 'default' : 'outline'}>
                    {mailConfig.resendApiKeyConfigured ? 'API key stored' : 'API key missing'}
                  </Badge>
                  <span>{mailConfig.resendApiKeyConfigured ? 'Stored securely in managed secrets' : 'Required before sending mail'}</span>
                </div>
              </div>
            )}

            {mailConfig.lastTest && (
              <div className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${mailConfig.lastTest.ok ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'}`}>
                {mailConfig.lastTest.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                <span>
                  {mailConfig.lastTest.ok
                    ? `Connection OK${mailConfig.lastTest.provider ? ` (${mailConfig.lastTest.provider})` : ''}${mailConfig.lastTest.detail ? ` — ${mailConfig.lastTest.detail}` : ''}`
                    : `Connection failed: ${mailConfig.lastTest.error}`}
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={saveMailConfig} disabled={mailConfig.saving}>
                {mailConfig.saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save mail config
              </Button>
              <Button variant="outline" onClick={loadMailConfig} disabled={mailConfig.saving || mailConfig.testing}>
                Reload config
              </Button>
              <Button variant="outline" onClick={runMailTest} disabled={mailConfig.testing || mailConfig.saving || !mailConfig.provider}>
                {mailConfig.testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FlaskConical className="mr-2 h-4 w-4" />}
                Test connection
              </Button>
            </div>

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Provider secrets are write-only. Leave password or API key fields empty when you want to keep the stored value unchanged.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        {/* ── Manifest secrets (grouped by category) ── */}
        {categories.map((category) => {
          const items = secretsWithStatus.filter((s) => s.category === category);
          return (
            <Card key={category}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CategoryIcon category={category} />
                  {category}
                </CardTitle>
                <CardDescription>
                  {category === 'Database'
                    ? 'Sensitive server-side credentials. These are write-only values managed separately from plain runtime configuration.'
                    : 'API keys and tokens used by the Worker.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((s, idx) => (
                  <React.Fragment key={s.name}>
                    {idx > 0 && <Separator />}
                    <div className="flex items-start justify-between gap-4 py-1">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold">{s.name}</span>
                          {s.required && (
                            <Badge variant="secondary" className="text-[10px] h-4 px-1">Required</Badge>
                          )}
                          <StatusBadge secret={s} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
                        {s.binding && (
                          <p className="text-xs text-muted-foreground/70 mt-0.5 font-mono">
                            Binding: <span className="text-foreground/60">{s.binding}</span>
                            <CopyButton text={s.binding} />
                          </p>
                        )}
                        {s.cfSecret?.created_at && (
                          <p className="text-xs text-muted-foreground/60 mt-0.5">
                            Last updated: {new Date(s.cfSecret.updated_at ?? s.cfSecret.created_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          size="sm"
                          variant={s.cfSecret ? 'outline' : 'default'}
                          onClick={() => openEdit(s)}
                          disabled={loading}
                        >
                          {s.cfSecret ? (
                            <><Pencil className="h-3 w-3 mr-1" />Edit</>
                          ) : (
                            <><Shield className="h-3 w-3 mr-1" />Set</>
                          )}
                        </Button>
                        {s.cfSecret && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(s)}
                            disabled={loading}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </CardContent>
            </Card>
          );
        })}

        {/* ── Media Storage connection test ── */}
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="h-4 w-4" />
              Active Drive — Connection Test
            </CardTitle>
            <CardDescription>
              Live status of the current default mount. Update the mount list above, then click Test to verify the active bucket and binding.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* ── Provider status ── */}
            <div className="flex items-center gap-3">
              <div className="text-sm font-medium w-28 shrink-0">Provider</div>
              {mediaConfig ? (
                <Badge
                  variant="outline"
                  className={
                    mediaConfig.provider === 'unconfigured'
                      ? 'text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30'
                      : 'text-green-600 border-green-300 bg-green-50 dark:bg-green-950/30'
                  }
                >
                  {mediaConfig.provider === 'supabase' && '⚡ Supabase Storage'}
                  {mediaConfig.provider === 'r2' && '☁️ Cloudflare R2'}
                  {mediaConfig.provider === 's3' && '🪣 S3-Compatible'}
                  {mediaConfig.provider === 'unconfigured' && 'Not configured'}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">Loading…</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-sm font-medium w-28 shrink-0">Bucket</div>
              <span className="text-sm font-mono text-muted-foreground">
                {mediaConfig?.bucket ?? '—'}
              </span>
            </div>
            {mediaConfig?.provider === 'r2' && (
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium w-28 shrink-0">Binding</div>
                <Badge
                  variant="outline"
                  className={
                    mediaConfig.bindingConfigured
                      ? 'text-green-600 border-green-300 bg-green-50 dark:bg-green-950/30'
                      : 'text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30'
                  }
                >
                  {mediaConfig.bindingConfigured
                    ? `${mediaConfig.bindingName ?? 'MEDIA_BUCKET'} bound`
                    : `${mediaConfig.bindingName ?? 'MEDIA_BUCKET'} missing`}
                </Badge>
              </div>
            )}
            {mediaConfig?.provider === 'r2' && (
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium w-28 shrink-0">Public URL</div>
                <Badge
                  variant="outline"
                  className={
                    mediaConfig.publicUrlConfigured
                      ? 'text-green-600 border-green-300 bg-green-50 dark:bg-green-950/30'
                      : 'text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30'
                  }
                >
                  {mediaConfig.publicUrlConfigured ? 'Configured' : 'Not set'}
                </Badge>
              </div>
            )}
            {mediaConfig?.provider === 'r2' && (
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium w-28 shrink-0">Delivery</div>
                <span className="text-sm font-mono text-muted-foreground break-all">
                  {mediaConfig.assetBaseUrl ?? '—'}
                </span>
              </div>
            )}
            {mediaConfig?.provider === 'r2' && !mediaConfig.configured && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  R2 bucket binding (<code>MEDIA_BUCKET</code>) is not bound. Add the Worker R2 binding in
                  <code>wrangler.jsonc</code> and redeploy the Worker.
                </AlertDescription>
              </Alert>
            )}
            {mediaConfig?.provider === 's3' && (
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium w-28 shrink-0">Endpoint</div>
                <span className="text-sm font-mono text-muted-foreground break-all">
                  {mediaConfig.endpoint ?? '—'}
                </span>
              </div>
            )}
            {mediaConfig?.provider === 's3' && (
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium w-28 shrink-0">Delivery</div>
                <span className="text-sm font-mono text-muted-foreground break-all">
                  {mediaConfig.assetBaseUrl ?? '—'}
                </span>
              </div>
            )}

            {/* ── Test result ── */}
            {mediaTestResult && (
              <div className={`flex items-center gap-2 text-sm rounded-md px-3 py-2 ${
                mediaTestResult.ok
                  ? 'bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-400'
                  : 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
              }`}>
                {mediaTestResult.ok
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : <XCircle className="h-4 w-4 shrink-0" />}
                <span>
                  {mediaTestResult.ok
                    ? `Connection OK — ${mediaTestResult.itemCount} item(s) at root`
                    : `Connection failed: ${mediaTestResult.error}`}
                </span>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={loadMediaStatus}
                disabled={mediaTesting}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Reload Config
              </Button>
              <Button
                size="sm"
                disabled={mediaTesting || !mediaConfig?.configured}
                onClick={async () => {
                  setMediaTesting(true);
                  setMediaTestResult(null);
                  const result = await testMediaConnection();
                  setMediaTestResult(result);
                  setMediaTesting(false);
                }}
              >
                {mediaTesting ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Testing…</>
                ) : (
                  <><FlaskConical className="h-3.5 w-3.5 mr-1.5" />Test Connection</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── Extra / custom secrets in the store ── */}
        {(
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <KeyRound className="h-4 w-4" />
                    Custom Secrets
                  </CardTitle>
                  <CardDescription>
                    Additional secrets stored in the store not part of the default manifest.
                    Use these for third-party API keys, webhooks, or any BYOK credential.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => setAddCustomOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add secret
                </Button>
              </div>
            </CardHeader>
            {extraCfSecrets.length > 0 && (
              <CardContent className="space-y-3">
                {extraCfSecrets.map((s, idx) => (
                  <React.Fragment key={s.id}>
                    {idx > 0 && <Separator />}
                    <div className="flex items-center justify-between gap-4 py-1">
                      <div className="flex-1 min-w-0">
                        <span className="font-mono text-sm font-semibold">{s.name}</span>
                        {s.comment && (
                          <p className="text-xs text-muted-foreground mt-0.5">{s.comment}</p>
                        )}
                        {s.created_at && (
                          <p className="text-xs text-muted-foreground/60 mt-0.5">
                            Last updated: {new Date(s.updated_at ?? s.created_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            openEdit({
                              name: s.name,
                              category: 'Custom',
                              label: s.name,
                              description: s.comment ?? '',
                              required: false,
                              cfSecret: s,
                              envConfigured: true,
                            })
                          }
                        >
                          <Pencil className="h-3 w-3 mr-1" />Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() =>
                            setDeleteTarget({
                              name: s.name,
                              category: 'Custom',
                              label: s.name,
                              description: '',
                              required: false,
                              cfSecret: s,
                              envConfigured: true,
                            })
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </CardContent>
            )}
            {extraCfSecrets.length === 0 && !loading && (
              <CardContent>
                <p className="text-sm text-muted-foreground">No custom secrets yet.</p>
              </CardContent>
            )}
          </Card>
        )}

        {/* ── How it works ── */}
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Info className="h-4 w-4" />
              How it works
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              Secrets are stored in your <strong>Cloudflare Secrets Store</strong> — encrypted at rest,
              injected into the Worker at runtime via bindings declared in <code>wrangler.jsonc</code>.
              Values are <strong>write-only</strong>: they can be set or deleted, but never read back through this UI.
            </p>
            <p>
              Bucket mounts are stored as non-sensitive system configuration. Media and data pickers read that list directly and expose each mount as a selectable drive, while S3 access keys remain write-only managed secrets.
            </p>
            <p>
              To bind a new secret to the Worker, add an entry to <code>secrets_store_secrets</code> in
              your <code>wrangler.jsonc</code> and redeploy. The management API (<code>/api/secrets</code>)
              requires <code>CF_API_TOKEN</code> to be set as a Worker secret:
            </p>
            <pre className="bg-muted rounded p-2 text-[11px] overflow-x-auto">
              npx wrangler secret put CF_API_TOKEN
            </pre>
          </CardContent>
        </Card>

        {/* ── Plugin Admin Sections ── */}
        {pluginAdminSections.map((section) => {
          const SectionComponent = section.component;
          return (
            <Card key={section.id}>
              <CardHeader>
                <CardTitle className="text-lg">{section.title}</CardTitle>
                {section.description && (
                  <CardDescription>{section.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <SectionComponent />
              </CardContent>
            </Card>
          );
        })}

      </div>

      {/* ── Edit secret dialog ── */}
      <Dialog open={editState !== null} onOpenChange={(open) => { if (!open) setEditState(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editState?.secret.cfSecret ? 'Update secret' : 'Set secret'}
            </DialogTitle>
            <DialogDescription>
              <span className="font-mono font-semibold">{editState?.secret.name}</span>
              {' — '}{editState?.secret.description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Value</Label>
              <div className="relative">
                <Input
                  type={editState?.showValue ? 'text' : 'password'}
                  value={editState?.value ?? ''}
                  onChange={(e) => setEditState((s) => s && { ...s, value: e.target.value })}
                  placeholder={editState?.secret.placeholder ?? 'Enter secret value…'}
                  className="pr-10 font-mono text-sm"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setEditState((s) => s && { ...s, showValue: !s.showValue })}
                >
                  {editState?.showValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Existing value is never returned by the API. Enter the full new value to update.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Comment <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                value={editState?.comment ?? ''}
                onChange={(e) => setEditState((s) => s && { ...s, comment: e.target.value })}
                placeholder="e.g. Supabase project: my-app-prod"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditState(null)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={editState?.saving}>
              {editState?.saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editState?.secret.cfSecret ? 'Update' : 'Save secret'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add custom secret dialog ── */}
      <Dialog open={addCustomOpen} onOpenChange={(open) => { if (!open) setAddCustomOpen(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add custom secret</DialogTitle>
            <DialogDescription>
              Store any additional API key or token. The name will be uppercased and sanitised automatically.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Secret name</Label>
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="MY_API_KEY"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">Letters, numbers and underscores only. No spaces.</p>
            </div>

            <div className="space-y-1.5">
              <Label>Value</Label>
              <div className="relative">
                <Input
                  type={customShowValue ? 'text' : 'password'}
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  placeholder="Enter secret value…"
                  className="pr-10 font-mono text-sm"
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setCustomShowValue((v) => !v)}
                >
                  {customShowValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Comment <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                value={customComment}
                onChange={(e) => setCustomComment(e.target.value)}
                placeholder="What is this key for?"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCustomOpen(false)}>Cancel</Button>
            <Button onClick={saveCustom} disabled={customSaving}>
              {customSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save secret
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete secret?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <span className="font-mono font-semibold">{deleteTarget?.name}</span> from
              the Cloudflare Secrets Store. Any Worker binding pointing to this secret will stop working until you
              set a new value.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Add / Edit media mount dialog ── */}
      <Dialog open={mountDialogOpen} onOpenChange={(open) => { if (!open) setMountDialogOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingMount ? 'Edit storage mount' : 'Add storage mount'}</DialogTitle>
            <DialogDescription>
              Configure a mount that will appear as a selectable drive in media and data pickers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="src-id">ID <span className="text-muted-foreground text-xs">(unique slug)</span></Label>
                <Input
                  id="src-id"
                  value={mountForm.id}
                  onChange={(e) => setMountForm((f) => ({ ...f, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                  placeholder="blog-media"
                  disabled={!!editingMount}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="src-label">Display Name</Label>
                <Input
                  id="src-label"
                  value={mountForm.label}
                  onChange={(e) => setMountForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="Blog Media"
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Mount Type</Label>
                <Select
                  value={mountForm.type}
                  onValueChange={(value) => setMountForm((current) => ({
                    ...current,
                    type: value as MediaMount['type'],
                    endpoint: value === 's3' ? current.endpoint || 'https://s3.amazonaws.com' : '',
                    region: value === 's3' ? current.region || 'us-east-1' : '',
                    accessKeyId: value === 's3' ? current.accessKeyId || '' : '',
                    publicUrl: value === 'supabase' ? '' : current.publicUrl || '',
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select mount type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="supabase">Supabase Storage</SelectItem>
                    <SelectItem value="r2">Cloudflare R2</SelectItem>
                    <SelectItem value="s3">S3-compatible</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="src-bucket">Bucket Name</Label>
                <Input
                  id="src-bucket"
                  value={mountForm.bucket}
                  onChange={(e) => setMountForm((f) => ({ ...f, bucket: e.target.value }))}
                  placeholder="my-media-bucket"
                  className="font-mono text-sm"
                />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-md bg-muted/40 p-3">
              <div>
                <Label>Default drive</Label>
                <p className="text-xs text-muted-foreground">Used when a flow does not specify a mount explicitly.</p>
              </div>
              <Switch checked={mountForm.isDefault === true} onCheckedChange={(value) => setMountForm((current) => ({ ...current, isDefault: value }))} />
            </div>
            {mountForm.type === 's3' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="src-endpoint">Endpoint URL</Label>
                  <Input
                    id="src-endpoint"
                    value={mountForm.endpoint || ''}
                    onChange={(e) => setMountForm((f) => ({ ...f, endpoint: e.target.value }))}
                    placeholder="https://s3.amazonaws.com"
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">For AWS S3 use <code>https://s3.amazonaws.com</code>. For DigitalOcean Spaces, MinIO, etc. use their custom endpoint.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="src-region">Region</Label>
                    <Input
                      id="src-region"
                      value={mountForm.region || ''}
                      onChange={(e) => setMountForm((f) => ({ ...f, region: e.target.value }))}
                      placeholder="us-east-1"
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="src-keyid">Access Key ID</Label>
                    <Input
                      id="src-keyid"
                      value={mountForm.accessKeyId || ''}
                      onChange={(e) => setMountForm((f) => ({ ...f, accessKeyId: e.target.value }))}
                      placeholder="AKIAIOSFODNN7EXAMPLE"
                      className="font-mono text-sm"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="src-secret">Secret Access Key</Label>
                  <Input
                    id="src-secret"
                    type="password"
                    value={mountForm.secretAccessKey}
                    onChange={(e) => setMountForm((f) => ({ ...f, secretAccessKey: e.target.value }))}
                    placeholder={editingMount ? 'Leave blank to keep stored key' : 'Enter secret access key'}
                    className="font-mono text-sm"
                    autoComplete="off"
                  />
                  <p className="text-xs text-muted-foreground">Stored encrypted via managed secrets.</p>
                </div>
              </>
            )}
            {(mountForm.type === 'r2' || mountForm.type === 's3') && (
              <div className="space-y-1.5">
                <Label htmlFor="src-publicurl">Public URL Base</Label>
                <Input
                  id="src-publicurl"
                  value={mountForm.publicUrl || ''}
                  onChange={(e) => setMountForm((f) => ({ ...f, publicUrl: e.target.value }))}
                  placeholder={mountForm.type === 'r2' ? 'https://assets.example.com' : 'https://my-media-bucket.s3.amazonaws.com'}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">Optional. Used to generate direct delivery URLs for this drive.</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMountDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveMountDialog} disabled={mountsSaving}>
              {mountsSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editingMount ? 'Save changes' : 'Add mount'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete mount confirm ── */}
      <AlertDialog open={deletingMountId !== null} onOpenChange={(open) => { if (!open) setDeletingMountId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove storage mount?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the mount <span className="font-mono font-semibold">{deletingMountId}</span> from
              the picker configuration. If it is an S3 mount, its stored secret access key will also be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteMount}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default VerwaltungConnections;
