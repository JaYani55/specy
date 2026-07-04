import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Puzzle,
  Plus,
  Trash2,
  Settings2,
  ExternalLink,
  RefreshCw,
  Loader2,
  Info,
  Github,
  PackageCheck,
  PackageX,
  AlertTriangle,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Globe,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
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
import { toast } from 'sonner';
import { ImageUploader } from '@/components/pagebuilder/ImageUploader';
import { usePermissions } from '@/hooks/usePermissions';
import {
  buildPluginSecretName,
  fetchPlugins,
  filterPluginConfigValues,
  getPluginLink,
  getPluginLinkLabel,
  isWebappRegistration,
  isSecretPluginField,
  registerPlugin,
  updatePluginConfig,
  updatePluginStatus,
  updatePluginTenant,
  deletePlugin,
} from '@/services/pluginService';
import {
  getTenantOptions,
  getVisibleTenantNameMap,
  pickInitialTenantId,
  type TenantOption,
} from '@/services/tenantService';
import {
  deleteSecret,
  listSecrets,
  upsertSecret,
  type CfSecret,
} from '@/services/connectionsService';
import type { PluginConfigFieldDefinition, PluginDefinition, PluginRegistration } from '@/types/plugin';
import { getPlugins } from '@/plugins/loader';

// ─── Status badge ──────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<PluginRegistration['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  registered: { label: 'Registriert', variant: 'secondary' },
  installed:  { label: 'Installiert', variant: 'outline' },
  enabled:    { label: 'Aktiv', variant: 'default' },
  disabled:   { label: 'Deaktiviert', variant: 'secondary' },
  error:      { label: 'Fehler', variant: 'destructive' },
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }

  return fallback;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function buildWebappSlug(name: string, externalUrl: string, manualSlug?: string): string {
  const trimmedManualSlug = manualSlug?.trim();
  if (trimmedManualSlug) {
    return slugify(trimmedManualSlug);
  }

  try {
    const url = new URL(externalUrl);
    const pathPart = url.pathname.replace(/^\/|\/$/g, '').replace(/\//g, '-');
    const derivedFromUrl = slugify(`${url.hostname}-${pathPart}`);

    if (derivedFromUrl) {
      return derivedFromUrl;
    }
  } catch {
    // Validation is handled separately. Fall back to the display name.
  }

  return slugify(name);
}

function parseConfigSchemaJson(raw: string): PluginConfigFieldDefinition[] {
  const trimmed = raw.trim();

  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error('Das Konfigurationsschema muss ein JSON-Array sein.');
  }

  return parsed as PluginConfigFieldDefinition[];
}

function getPluginSchemaFields(plugin: PluginRegistration): PluginConfigFieldDefinition[] {
  return Array.isArray(plugin.config_schema) ? plugin.config_schema : [];
}

function getPublicPluginFields(plugin: PluginRegistration): PluginConfigFieldDefinition[] {
  return getPluginSchemaFields(plugin).filter((field) => !isSecretPluginField(field));
}

function getSecretPluginFields(plugin: PluginRegistration): PluginConfigFieldDefinition[] {
  return getPluginSchemaFields(plugin).filter((field) => isSecretPluginField(field));
}

function toPublicConfigValues(plugin: PluginRegistration): Record<string, string> {
  return filterPluginConfigValues(plugin.config ?? {}, getPluginSchemaFields(plugin));
}

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function Plugins() {
  const navigate = useNavigate();
  const { canManagePlugins } = usePermissions();

  const [plugins, setPlugins] = useState<PluginRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});

  // Register dialog
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    repo_url:    '',
    slug:        '',
    name:        '',
    description: '',
    author_name: '',
    author_url:  '',
    license:     '',
    version:     '0.0.0',
    download_url: '',
    config_schema_json: '',
  });
  const [registerSaving, setRegisterSaving] = useState(false);

  // Register webapp dialog
  const [registerWebappOpen, setRegisterWebappOpen] = useState(false);
  const [registerWebappSaving, setRegisterWebappSaving] = useState(false);
  const [webappForm, setWebappForm] = useState({
    name: '',
    slug: '',
    description: '',
    external_url: '',
    icon_url: '',
    tenant_id: '',
  });
  const [tenantDialogWebapp, setTenantDialogWebapp] = useState<PluginRegistration | null>(null);
  const [tenantDialogValue, setTenantDialogValue] = useState('');
  const [tenantDialogSaving, setTenantDialogSaving] = useState(false);

  // Config dialog
  const [configPlugin, setConfigPlugin] = useState<PluginRegistration | null>(null);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [configSaving, setConfigSaving] = useState(false);
  const [secretSavingKey, setSecretSavingKey] = useState<string | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [pluginSecrets, setPluginSecrets] = useState<Record<string, CfSecret | null>>({});
  const [configLoading, setConfigLoading] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<PluginRegistration | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Runtime plugins (from build-time registry)
  const runtimePlugins = getPlugins();
  const runtimePluginBySlug = useMemo(
    () => new Map(runtimePlugins.map((plugin) => [plugin.id, plugin])),
    [runtimePlugins],
  );

  // ── Guard ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!canManagePlugins) {
      navigate('/events', { replace: true });
    }
  }, [canManagePlugins, navigate]);

  // ── Load ───────────────────────────────────────────────────────────────────
  const loadPlugins = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await fetchPlugins();
      setPlugins(data);
      setTenantNames(await getVisibleTenantNameMap(data.map((plugin) => plugin.tenant_id)));
    } catch {
      toast.error('Fehler beim Laden der Plugins');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadPlugins(); }, [loadPlugins]);

  useEffect(() => {
    const loadTenantOptions = async () => {
      try {
        const options = await getTenantOptions();
        setTenantOptions(options);
        setWebappForm((current) => ({
          ...current,
          tenant_id: pickInitialTenantId(options, current.tenant_id),
        }));
      } catch {
        toast.error('Workspaces konnten nicht geladen werden');
      }
    };

    void loadTenantOptions();
  }, []);

  // ── Auto-slug from repo URL ────────────────────────────────────────────────
  const handleRepoUrlChange = (url: string) => {
    setRegisterForm((f) => {
      const slug = slugify(url
        .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
        .replace(/\//g, '-')
      );
      return { ...f, repo_url: url, slug: f.slug || slug };
    });
  };

  // ── Register ───────────────────────────────────────────────────────────────
  const handleRegister = async () => {
    if (!registerForm.repo_url.trim() || !registerForm.slug.trim() || !registerForm.name.trim()) {
      toast.error('Repository-URL, Slug und Name sind Pflichtfelder.');
      return;
    }

    let configSchema: PluginConfigFieldDefinition[] = [];
    try {
      configSchema = parseConfigSchemaJson(registerForm.config_schema_json);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Konfigurationsschema ist kein gültiges JSON.'));
      return;
    }

    setRegisterSaving(true);
    try {
      await registerPlugin({
        kind: 'plugin',
        tenant_id: null,
        slug:         registerForm.slug.trim(),
        name:         registerForm.name.trim(),
        version:      registerForm.version.trim() || '0.0.0',
        description:  registerForm.description.trim() || null,
        author_name:  registerForm.author_name.trim() || null,
        author_url:   registerForm.author_url.trim() || null,
        license:      registerForm.license.trim() || null,
        repo_url:     registerForm.repo_url.trim(),
        download_url: registerForm.download_url.trim() || null,
        external_url: null,
        icon_url: null,
        config_schema: configSchema,
      });
      toast.success('Plugin registriert');
      setRegisterOpen(false);
      setRegisterForm({ repo_url: '', slug: '', name: '', description: '', author_name: '', author_url: '', license: '', version: '0.0.0', download_url: '', config_schema_json: '' });
      loadPlugins();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Registrierung fehlgeschlagen'));
    } finally {
      setRegisterSaving(false);
    }
  };

  const handleRegisterWebapp = async () => {
    if (!webappForm.name.trim() || !webappForm.external_url.trim()) {
      toast.error('Name und Webapp-URL sind Pflichtfelder.');
      return;
    }

    if (!webappForm.tenant_id) {
      toast.error('Bitte einen Workspace auswählen.');
      return;
    }

    if (!isValidHttpUrl(webappForm.external_url.trim())) {
      toast.error('Bitte gib eine gültige http(s)-URL an.');
      return;
    }

    const resolvedSlug = buildWebappSlug(
      webappForm.name,
      webappForm.external_url,
      webappForm.slug,
    );

    if (!resolvedSlug) {
      toast.error('Es konnte kein gueltiger interner Slug erzeugt werden.');
      return;
    }

    setRegisterWebappSaving(true);
    try {
      await registerPlugin({
        kind: 'webapp',
        slug: resolvedSlug,
        name: webappForm.name.trim(),
        version: 'external',
        description: webappForm.description.trim() || null,
        author_name: null,
        author_url: null,
        license: null,
        repo_url: null,
        download_url: null,
        external_url: webappForm.external_url.trim(),
        icon_url: webappForm.icon_url.trim() || null,
        tenant_id: webappForm.tenant_id,
        status: 'enabled',
        config_schema: [],
      });
      toast.success('Webapp registriert');
      setRegisterWebappOpen(false);
      setWebappForm({
        name: '',
        slug: '',
        description: '',
        external_url: '',
        icon_url: '',
        tenant_id: pickInitialTenantId(tenantOptions),
      });
      loadPlugins();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Webapp konnte nicht registriert werden'));
    } finally {
      setRegisterWebappSaving(false);
    }
  };

  const openWebappTenantDialog = (plugin: PluginRegistration) => {
    setTenantDialogWebapp(plugin);
    setTenantDialogValue(pickInitialTenantId(tenantOptions, plugin.tenant_id));
  };

  const handleSaveWebappTenant = async () => {
    if (!tenantDialogWebapp || !tenantDialogValue) {
      toast.error('Bitte einen Workspace auswählen.');
      return;
    }

    setTenantDialogSaving(true);
    try {
      await updatePluginTenant(tenantDialogWebapp.id, tenantDialogValue);
      toast.success('Workspace aktualisiert');
      setTenantDialogWebapp(null);
      await loadPlugins();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Workspace konnte nicht gespeichert werden'));
    } finally {
      setTenantDialogSaving(false);
    }
  };

  // ── Config ─────────────────────────────────────────────────────────────────
  const loadPluginSecrets = useCallback(async (plugin: PluginRegistration) => {
    const secretFields = getSecretPluginFields(plugin);

    if (secretFields.length === 0) {
      setPluginSecrets({});
      return;
    }

    setConfigLoading(true);
    try {
      const secrets = await listSecrets();
      const nextSecrets = Object.fromEntries(
        secretFields.map((field) => {
          const secretName = buildPluginSecretName(plugin.slug, field.key);
          return [field.key, secrets.find((secret) => secret.name === secretName) ?? null];
        })
      );
      setPluginSecrets(nextSecrets);
    } catch {
      toast.error('Plugin-Secrets konnten nicht geladen werden');
      setPluginSecrets({});
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const openConfig = (plugin: PluginRegistration) => {
    setConfigPlugin(plugin);
    setConfigValues(toPublicConfigValues(plugin));
    setSecretValues({});
    setPluginSecrets({});
    void loadPluginSecrets(plugin);
  };

  const handleConfigSave = async () => {
    if (!configPlugin) return;
    setConfigSaving(true);
    try {
      await updatePluginConfig(configPlugin.id, configValues, getPluginSchemaFields(configPlugin));
      toast.success('Konfiguration gespeichert');
      setConfigPlugin(null);
      loadPlugins();
    } catch {
      toast.error('Konfiguration konnte nicht gespeichert werden');
    } finally {
      setConfigSaving(false);
    }
  };

  const handleSecretSave = async (field: PluginConfigFieldDefinition) => {
    if (!configPlugin) return;

    const nextValue = secretValues[field.key]?.trim();
    if (!nextValue) {
      toast.error('Secret-Wert darf nicht leer sein');
      return;
    }

    const secretName = buildPluginSecretName(configPlugin.slug, field.key);
    setSecretSavingKey(field.key);
    try {
      await upsertSecret(secretName, nextValue, `Plugin secret for ${configPlugin.slug}:${field.key}`);
      toast.success(`Secret "${field.label}" gespeichert`);
      setSecretValues((current) => ({ ...current, [field.key]: '' }));
      await loadPluginSecrets(configPlugin);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Secret konnte nicht gespeichert werden');
    } finally {
      setSecretSavingKey(null);
    }
  };

  const handleSecretDelete = async (field: PluginConfigFieldDefinition) => {
    if (!configPlugin) return;

    const secretName = buildPluginSecretName(configPlugin.slug, field.key);
    setSecretSavingKey(field.key);
    try {
      await deleteSecret(secretName);
      toast.success(`Secret "${field.label}" gelöscht`);
      await loadPluginSecrets(configPlugin);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Secret konnte nicht gelöscht werden');
    } finally {
      setSecretSavingKey(null);
    }
  };

  // ── Toggle enable/disable ──────────────────────────────────────────────────
  const handleToggleStatus = async (plugin: PluginRegistration) => {
    const next = plugin.status === 'enabled' ? 'disabled' : 'enabled';
    try {
      await updatePluginStatus(plugin.id, next);
      toast.success(next === 'enabled' ? 'Eintrag aktiviert' : 'Eintrag deaktiviert');
      loadPlugins();
    } catch {
      toast.error('Status konnte nicht geändert werden');
    }
  };

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deletePlugin(deleteTarget.id);
      toast.success('Eintrag entfernt');
      setDeleteTarget(null);
      loadPlugins();
    } catch {
      toast.error('Eintrag konnte nicht entfernt werden');
    } finally {
      setDeleting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!canManagePlugins) return null;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Puzzle className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Plugins</h1>
            <p className="text-sm text-muted-foreground">
              Plugin-Registrierung und Konfiguration
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadPlugins(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Aktualisieren
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRegisterWebappOpen(true)}>
            <Globe className="h-4 w-4 mr-2" />
            Webapp registrieren
          </Button>
          <Button size="sm" onClick={() => setRegisterOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Plugin registrieren
          </Button>
        </div>
      </div>

      {/* Info banner */}
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          <strong>Workflow:</strong> Plugins werden aus dem Workspace-Ordner <code>plugins/</code> registriert und per{' '}
          <code>node scripts/register-plugins.mjs</code> in die generierten Registry-Dateien übernommen.{' '}
          <code>plugins.json</code> dient nur noch als optionale Quellenliste für Remote-Installationen. Webapps werden direkt als externer
          Navigationspunkt gespeichert und erscheinen nach dem Aktivieren automatisch in Navbar und Sidebar.
        </AlertDescription>
      </Alert>

      {/* Runtime vs registered info */}
      {runtimePlugins.length > 0 && (
        <Alert>
          <PackageCheck className="h-4 w-4" />
          <AlertDescription>
            <strong>{runtimePlugins.length} Plugin(s) aktuell geladen:</strong>{' '}
            {runtimePlugins.map((p) => p.name).join(', ')}
          </AlertDescription>
        </Alert>
      )}

      {/* Plugin list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : plugins.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
            <Puzzle className="h-12 w-12 text-muted-foreground/40" />
            <p className="text-muted-foreground">Keine Plugins oder Webapps registriert.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setRegisterOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Erstes Plugin registrieren
              </Button>
              <Button variant="outline" onClick={() => setRegisterWebappOpen(true)}>
                <Globe className="h-4 w-4 mr-2" />
                Erste Webapp registrieren
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {plugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              runtimePlugin={runtimePluginBySlug.get(plugin.slug) ?? null}
              tenantLabel={plugin.tenant_id ? (tenantNames[plugin.tenant_id] ?? null) : null}
              isActive={!isWebappRegistration(plugin) && runtimePlugins.some((r) => r.id === plugin.slug)}
              onConfig={isWebappRegistration(plugin) ? undefined : () => openConfig(plugin)}
              onManageWebappTenant={isWebappRegistration(plugin) ? () => openWebappTenantDialog(plugin) : undefined}
              onToggle={() => handleToggleStatus(plugin)}
              onDelete={() => setDeleteTarget(plugin)}
            />
          ))}
        </div>
      )}

      {/* ── Register webapp dialog ── */}
      <Dialog open={registerWebappOpen} onOpenChange={setRegisterWebappOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neue Webapp registrieren</DialogTitle>
            <DialogDescription>
              Registriere eine externe Anwendung als Navigationspunkt. Die Webapp wird als externer Link in Navbar und Sidebar angezeigt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="webapp-name">Name *</Label>
              <Input
                id="webapp-name"
                placeholder="Mentor Portal"
                value={webappForm.name}
                onChange={(e) => setWebappForm((current) => ({ ...current, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="webapp-slug">Slug <span className="text-muted-foreground text-xs">(optional)</span></Label>
                <Input
                  id="webapp-slug"
                  placeholder="Automatisch aus URL oder Name"
                  value={webappForm.slug}
                  onChange={(e) => setWebappForm((current) => ({ ...current, slug: slugify(e.target.value) }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="webapp-url">Webapp-URL *</Label>
                <Input
                  id="webapp-url"
                  type="url"
                  placeholder="https://app.example.com"
                  value={webappForm.external_url}
                  onChange={(e) => setWebappForm((current) => ({ ...current, external_url: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Workspace *</Label>
              <Select value={webappForm.tenant_id} onValueChange={(value) => setWebappForm((current) => ({ ...current, tenant_id: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Workspace auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {tenantOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="webapp-description">Beschreibung</Label>
              <Input
                id="webapp-description"
                placeholder="Externe Anwendung fuer Staff oder Mentoren"
                value={webappForm.description}
                onChange={(e) => setWebappForm((current) => ({ ...current, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Webapp-Icon</Label>
              <ImageUploader
                value={webappForm.icon_url}
                onChange={(url) => setWebappForm((current) => ({ ...current, icon_url: url }))}
                previewVariant="avatar"
                folder="webapps/icons"
              />
              <Input
                type="url"
                placeholder="Oder Icon-URL direkt einfuegen"
                value={webappForm.icon_url}
                onChange={(e) => setWebappForm((current) => ({ ...current, icon_url: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Du kannst ein Icon aus der Mediathek waehlen oder eine direkte Bild-URL eintragen.
              </p>
              <p className="text-xs text-muted-foreground">
                Tipp: <a href="https://dashboardicons.com/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">https://dashboardicons.com/</a> ist eine gute Quelle fuer passende Icons.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterWebappOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleRegisterWebapp} disabled={registerWebappSaving}>
              {registerWebappSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Webapp registrieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Register dialog ── */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neues Plugin registrieren</DialogTitle>
            <DialogDescription>
              Gib das GitHub-Repository des Plugins an. Es wird erst nach dem Ausführen von{' '}
              <code>install-plugins.mjs</code> und einem Redeploy aktiv.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="repo_url">GitHub Repository-URL *</Label>
              <div className="relative">
                <Github className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="repo_url"
                  className="pl-8"
                  placeholder="https://github.com/owner/repo"
                  value={registerForm.repo_url}
                  onChange={(e) => handleRepoUrlChange(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="slug">Slug * <span className="text-muted-foreground text-xs">(eindeutig)</span></Label>
                <Input
                  id="slug"
                  placeholder="mein-plugin"
                  value={registerForm.slug}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, slug: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="version">Version</Label>
                <Input
                  id="version"
                  placeholder="0.0.0"
                  value={registerForm.version}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, version: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                placeholder="Mein Plugin"
                value={registerForm.name}
                onChange={(e) => setRegisterForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">Beschreibung</Label>
              <Input
                id="description"
                value={registerForm.description}
                onChange={(e) => setRegisterForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="author_name">Autor</Label>
                <Input
                  id="author_name"
                  value={registerForm.author_name}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, author_name: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="license">Lizenz</Label>
                <Input
                  id="license"
                  placeholder="MIT"
                  value={registerForm.license}
                  onChange={(e) => setRegisterForm((f) => ({ ...f, license: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="download_url">
                Download-URL{' '}
                <span className="text-muted-foreground text-xs">(optional, überschreibt GitHub ZIP)</span>
              </Label>
              <Input
                id="download_url"
                placeholder="https://..."
                value={registerForm.download_url}
                onChange={(e) => setRegisterForm((f) => ({ ...f, download_url: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="config_schema_json">
                Konfigurationsschema (JSON)
                <span className="text-muted-foreground text-xs"> (optional, getrennt von Werten und Secrets)</span>
              </Label>
              <Textarea
                id="config_schema_json"
                className="min-h-40 font-mono text-xs"
                placeholder={`[
  {
    "key": "google_client_id",
    "label": "Google Client ID",
    "type": "text",
    "required": true,
    "description": "OAuth Client ID"
  },
  {
    "key": "google_client_secret",
    "label": "Google Client Secret",
    "type": "secret",
    "required": true
  }
]`}
                value={registerForm.config_schema_json}
                onChange={(e) => setRegisterForm((f) => ({ ...f, config_schema_json: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Erlaubte Typen: <code>text</code>, <code>textarea</code>, <code>url</code>, <code>secret</code>.
                Secrets werden spaeter separat im Plugin-Dialog gespeichert.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleRegister} disabled={registerSaving}>
              {registerSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Registrieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Config dialog ── */}
      <Dialog open={!!configPlugin} onOpenChange={(open) => { if (!open) setConfigPlugin(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Konfiguration: {configPlugin?.name}</DialogTitle>
            <DialogDescription>
              Felder werden aus dem Plugin-Schema geladen. Secrets liegen getrennt im Cloudflare Secrets Store.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[28rem] overflow-y-auto pr-1">
            {configLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Secret-Status wird geladen
              </div>
            )}

            {configPlugin && getPluginSchemaFields(configPlugin).length === 0 && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Dieses Plugin hat noch kein <code>config_schema</code> definiert. Beim nächsten Installationslauf wird ein Schema aus der <code>plugin.json</code> übernommen, falls vorhanden.
                </AlertDescription>
              </Alert>
            )}

            {configPlugin && getPluginSchemaFields(configPlugin).map((field) => {
              const isSecret = isSecretPluginField(field);
              const storedSecret = pluginSecrets[field.key];
              const inputType = field.type === 'url' ? 'url' : 'text';

              return (
                <div key={field.key} className="space-y-3 rounded-md border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor={`plugin-config-${field.key}`}>{field.label}</Label>
                    {isSecret ? (
                      <Badge variant="destructive" className="gap-1">
                        <Shield className="h-3 w-3" />
                        Secret
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Variable</Badge>
                    )}
                    {field.required && <Badge variant="outline">Pflichtfeld</Badge>}
                    <Badge variant="outline">
                      {field.expose_to_frontend ? 'Frontend erlaubt' : 'Nur Backend'}
                    </Badge>
                    {isSecret ? (
                      storedSecret ? (
                        <Badge variant="outline" className="gap-1 border-green-300 text-green-600">
                          <ShieldCheck className="h-3 w-3" />
                          Gespeichert
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 border-amber-300 text-amber-600">
                          <ShieldAlert className="h-3 w-3" />
                          Nicht gesetzt
                        </Badge>
                      )
                    ) : null}
                  </div>

                  {field.description && (
                    <p className="text-sm text-muted-foreground">{field.description}</p>
                  )}

                  {isSecret ? (
                    <>
                      <Input
                        id={`plugin-config-${field.key}`}
                        type="password"
                        placeholder={field.placeholder ?? 'Secret eingeben'}
                        value={secretValues[field.key] ?? ''}
                        onChange={(e) =>
                          setSecretValues((current) => ({ ...current, [field.key]: e.target.value }))
                        }
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">
                          Secret-Name: {configPlugin ? buildPluginSecretName(configPlugin.slug, field.key) : ''}
                        </span>
                        {storedSecret?.updated_at && (
                          <span>Zuletzt aktualisiert: {new Date(storedSecret.updated_at).toLocaleString('de-DE')}</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleSecretSave(field)}
                          disabled={secretSavingKey === field.key || configLoading}
                        >
                          {secretSavingKey === field.key && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                          Secret speichern
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSecretDelete(field)}
                          disabled={secretSavingKey === field.key || !storedSecret || configLoading}
                        >
                          Secret löschen
                        </Button>
                      </div>
                    </>
                  ) : (
                    field.type === 'textarea' ? (
                      <Textarea
                        id={`plugin-config-${field.key}`}
                        placeholder={field.placeholder ?? ''}
                        value={configValues[field.key] ?? ''}
                        onChange={(e) =>
                          setConfigValues((current) => ({ ...current, [field.key]: e.target.value }))
                        }
                      />
                    ) : (
                      <Input
                        id={`plugin-config-${field.key}`}
                        type={inputType}
                        placeholder={field.placeholder ?? ''}
                        value={configValues[field.key] ?? ''}
                        onChange={(e) =>
                          setConfigValues((current) => ({ ...current, [field.key]: e.target.value }))
                        }
                      />
                    )
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfigPlugin(null)}>
              Abbrechen
            </Button>
            <Button
              onClick={handleConfigSave}
              disabled={configSaving || !!configPlugin && getPublicPluginFields(configPlugin).length === 0}
            >
              {configSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Öffentliche Variablen speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete dialog ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTarget && isWebappRegistration(deleteTarget) ? 'Webapp entfernen?' : 'Plugin entfernen?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && isWebappRegistration(deleteTarget)
                ? <>Dies entfernt den Datenbankeintrag für <strong>{deleteTarget.name}</strong> und entfernt den Navigationspunkt aus der Anwendung.</>
                : <>Dies entfernt den Datenbankeintrag für <strong>{deleteTarget?.name}</strong>. Lokale Plugin-Dateien in <code>plugins/{deleteTarget?.slug}/</code> bleiben erhalten und müssen bei Bedarf separat entfernt werden.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Entfernen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!tenantDialogWebapp} onOpenChange={(open) => { if (!open) setTenantDialogWebapp(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Webapp-Workspace</DialogTitle>
            <DialogDescription>
              Ordne die Webapp einem Tenant zu. Nur Mitglieder dieses Workspaces sehen den Link anschließend in Navbar und Sidebar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>Workspace</Label>
              <Select value={tenantDialogValue} onValueChange={setTenantDialogValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Workspace auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {tenantOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTenantDialogWebapp(null)}>
              Abbrechen
            </Button>
            <Button onClick={handleSaveWebappTenant} disabled={tenantDialogSaving || !tenantDialogValue}>
              {tenantDialogSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Workspace speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Plugin Card ──────────────────────────────────────────────────────────────
interface PluginCardProps {
  plugin: PluginRegistration;
  runtimePlugin: PluginDefinition | null;
  tenantLabel?: string | null;
  isActive: boolean;
  onConfig?: () => void;
  onManageWebappTenant?: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

function PluginCard({ plugin, runtimePlugin, tenantLabel, isActive, onConfig, onManageWebappTenant, onToggle, onDelete }: PluginCardProps) {
  const isWebapp = isWebappRegistration(plugin);
  const badge = STATUS_BADGE[plugin.status] ?? STATUS_BADGE.registered;
  const schemaFields = getPluginSchemaFields(plugin);
  const secretCount = schemaFields.filter((field) => isSecretPluginField(field)).length;
  const publicCount = schemaFields.length - secretCount;
  const link = getPluginLink(plugin);
  const linkLabel = getPluginLinkLabel(plugin.kind);
  const apiRoutes = runtimePlugin?.apiMetadata?.routes ?? [];
  const capabilities = runtimePlugin?.capabilities ?? [];
  const apiBasePath = runtimePlugin?.apiMetadata?.basePath ?? (runtimePlugin ? `/api/plugin/${runtimePlugin.id}` : null);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {isWebapp ? (
              plugin.icon_url ? (
                <img
                  src={plugin.icon_url}
                  alt=""
                  className="h-5 w-5 shrink-0 rounded-sm object-contain"
                />
              ) : (
                <Globe className="h-5 w-5 text-primary shrink-0" />
              )
            ) : isActive ? (
              <PackageCheck className="h-5 w-5 text-green-500 shrink-0" />
            ) : (
              <PackageX className="h-5 w-5 text-muted-foreground shrink-0" />
            )}
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{plugin.name}</CardTitle>
              <p className="text-xs font-mono text-muted-foreground">
                {plugin.slug}
                {!isWebapp ? ` · v${plugin.version}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline">{isWebapp ? 'Webapp' : 'Plugin'}</Badge>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {!isWebapp && isActive && (
              <Badge variant="outline" className="text-green-600 border-green-600">
                Geladen
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {plugin.description && (
          <p className="text-sm text-muted-foreground">{plugin.description}</p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {plugin.author_name && <span>Autor: {plugin.author_name}</span>}
          {plugin.license && <span>Lizenz: {plugin.license}</span>}
          {!isWebapp && schemaFields.length > 0 && <span>Schema: {publicCount} Variablen · {secretCount} Secrets</span>}
          {tenantLabel && <span>Workspace: {tenantLabel}</span>}
          {isWebapp && plugin.external_url && <span className="font-mono">{plugin.external_url}</span>}
          {plugin.installed_at && (
            <span>Installiert: {new Date(plugin.installed_at).toLocaleDateString('de-DE')}</span>
          )}
        </div>

        {plugin.error_message && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{plugin.error_message}</AlertDescription>
          </Alert>
        )}

        {!isWebapp && runtimePlugin && apiRoutes.length > 0 && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Shield className="h-4 w-4 text-violet-600" />
              Plugin-Endpunkte
            </div>
            <div className="space-y-2 text-xs text-muted-foreground">
              {apiRoutes.map((route) => (
                <div key={route.id} className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="font-mono text-foreground">{route.method} {apiBasePath}{route.path}</div>
                  {route.summary && <div>{route.summary}</div>}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                    <span>Auth: {route.auth ?? 'public'}</span>
                    <span>Logging: {route.logging ?? 'agentLogger'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isWebapp && runtimePlugin && capabilities.length > 0 && (
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Info className="h-4 w-4 text-primary" />
              Runtime-Fähigkeiten
            </div>
            <div className="space-y-2 text-xs text-muted-foreground">
              {capabilities.map((capability) => (
                <div key={capability.key} className="rounded-md bg-muted/40 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-foreground">{capability.key}</span>
                    <Badge variant="outline">{capability.kind}</Badge>
                  </div>
                  {capability.description && <div className="pt-1">{capability.description}</div>}
                  {capability.targets?.length ? <div className="pt-1 font-mono">{capability.targets.join(', ')}</div> : null}
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator />

        <div className="flex flex-wrap gap-2">
          {link && (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-normal transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              {isWebapp ? (
                plugin.icon_url ? (
                  <img src={plugin.icon_url} alt="" className="h-4 w-4 rounded-sm object-contain" />
                ) : (
                  <Globe className="h-4 w-4" />
                )
              ) : <Github className="h-4 w-4" />}
              {linkLabel}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {!isWebapp && onConfig && (
            <Button variant="outline" size="sm" onClick={onConfig}>
              <Settings2 className="h-4 w-4 mr-1.5" />
              Konfiguration
            </Button>
          )}
          {isWebapp && onManageWebappTenant && (
            <Button variant="outline" size="sm" onClick={onManageWebappTenant}>
              <Globe className="h-4 w-4 mr-1.5" />
              Workspace
            </Button>
          )}
          {plugin.status === 'installed' || plugin.status === 'enabled' || plugin.status === 'disabled' ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onToggle}
            >
              {plugin.status === 'enabled' ? 'Deaktivieren' : 'Aktivieren'}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive ml-auto"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            Entfernen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
