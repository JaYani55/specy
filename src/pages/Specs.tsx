import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bot, Copy, ExternalLink, FileCode2, FilePlus2, Globe, Loader2, Pencil, Search, Shield, Tag, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTheme } from '@/contexts/ThemeContext';
import { API_URL } from '@/lib/apiUrl';
import { deleteSpec, getSpecs, updateSpec } from '@/services/specService';
import type { SpecRecord } from '@/types/specs';

const statusVariant: Record<SpecRecord['status'], 'default' | 'secondary' | 'destructive'> = {
  draft: 'secondary',
  published: 'default',
  archived: 'destructive',
};

const Specs = () => {
  const navigate = useNavigate();
  const { language } = useTheme();
  const [specs, setSpecs] = useState<SpecRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | SpecRecord['status']>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'private'>('all');
  const [copiedValue, setCopiedValue] = useState<'mcp' | 'discovery' | null>(null);

  const mcpEndpointUrl = `${API_URL}/mcp`;
  const mcpDiscoveryUrl = `${API_URL}/.well-known/mcp.json`;

  const loadSpecs = useCallback(async () => {
    try {
      setIsLoading(true);
      setSpecs(await getSpecs());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load specs.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSpecs();
  }, [loadSpecs]);

  const filteredSpecs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return specs.filter((spec) => {
      const matchesQuery = !query
        || spec.name.toLowerCase().includes(query)
        || spec.slug.toLowerCase().includes(query)
        || (spec.description ?? '').toLowerCase().includes(query)
        || spec.tags.some((tag) => tag.toLowerCase().includes(query));

      const matchesStatus = statusFilter === 'all' || spec.status === statusFilter;
      const matchesVisibility = visibilityFilter === 'all'
        || (visibilityFilter === 'public' && spec.is_public)
        || (visibilityFilter === 'private' && !spec.is_public);

      return matchesQuery && matchesStatus && matchesVisibility;
    });
  }, [searchQuery, specs, statusFilter, visibilityFilter]);

  const handleArchiveToggle = async (spec: SpecRecord) => {
    try {
      await updateSpec(spec.id, {
        status: spec.status === 'archived' ? 'draft' : 'archived',
      });
      toast.success(spec.status === 'archived'
        ? (language === 'en' ? 'Spec restored.' : 'Spec wiederhergestellt.')
        : (language === 'en' ? 'Spec archived.' : 'Spec archiviert.'));
      await loadSpecs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update spec.');
    }
  };

  const handleDelete = async (spec: SpecRecord) => {
    const confirmed = window.confirm(
      language === 'en'
        ? `Delete spec "${spec.name}" permanently?`
        : `Spec „${spec.name}" dauerhaft löschen?`
    );

    if (!confirmed) {
      return;
    }

    try {
      await deleteSpec(spec.id);
      toast.success(language === 'en' ? 'Spec deleted.' : 'Spec gelöscht.');
      await loadSpecs();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete spec.');
    }
  };

  const handleCopy = async (value: string, key: 'mcp' | 'discovery') => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(key);
      window.setTimeout(() => setCopiedValue((current) => (current === key ? null : current)), 2000);
      toast.success(language === 'en' ? 'Copied.' : 'Kopiert.');
    } catch {
      toast.error(language === 'en' ? 'Copy failed.' : 'Kopieren fehlgeschlagen.');
    }
  };

  const emptyState = (
    <AdminCard className="border-dashed">
      <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 text-center">
        <Bot className="h-12 w-12 text-muted-foreground" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">
            {language === 'en' ? 'No specs yet' : 'Noch keine Specs'}
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            {language === 'en'
              ? 'Create reusable agent-readable specs and attach them to page schemas as discoverable MCP tools.'
              : 'Erstelle wiederverwendbare agentenlesbare Specs und hänge sie an Seitenschemata als discoverable MCP-Tools an.'}
          </p>
        </div>
        <Button onClick={() => navigate('/specs/new')}>
          <FilePlus2 className="mr-2 h-4 w-4" />
          {language === 'en' ? 'Create spec' : 'Spec erstellen'}
        </Button>
      </div>
    </AdminCard>
  );

  return (
    <AdminPageLayout
      title={language === 'en' ? 'Specs' : 'Specs'}
      description={language === 'en'
        ? 'Manage the shared repository of agent-readable tool specifications used by schemas, REST discovery, and MCP.'
        : 'Verwalte das gemeinsame Repository agentenlesbarer Tool-Spezifikationen für Schemas, REST-Discovery und MCP.'}
      icon={Bot}
      actions={(
        <div className="flex items-center gap-2">
          <Badge variant="outline">{filteredSpecs.length} / {specs.length}</Badge>
          <Button onClick={() => navigate('/specs/new')}>
            <FilePlus2 className="mr-2 h-4 w-4" />
            {language === 'en' ? 'New Spec' : 'Neue Spec'}
          </Button>
        </div>
      )}
    >
      <AdminCard>
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">
              {language === 'en' ? 'Connect An Agent To MCP' : 'Agent mit MCP verbinden'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {language === 'en'
                ? 'Use the configured public API domain for direct MCP connection. The discovery document is optional, but useful for clients that want a self-describing HTTP entrypoint.'
                : 'Verwende die konfigurierte öffentliche API-Domain für die direkte MCP-Verbindung. Das Discovery-Dokument ist optional, aber hilfreich für Clients mit selbstbeschreibendem HTTP-Einstiegspunkt.'}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">MCP HTTP URL</label>
              <div className="flex gap-2">
                <Input readOnly value={mcpEndpointUrl} />
                <Button type="button" variant="outline" onClick={() => void handleCopy(mcpEndpointUrl, 'mcp')}>
                  <Copy className="mr-2 h-4 w-4" />
                  {copiedValue === 'mcp'
                    ? (language === 'en' ? 'Copied' : 'Kopiert')
                    : (language === 'en' ? 'Copy' : 'Kopieren')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">MCP Discovery URL</label>
              <div className="flex gap-2">
                <Input readOnly value={mcpDiscoveryUrl} />
                <Button type="button" variant="outline" onClick={() => void handleCopy(mcpDiscoveryUrl, 'discovery')}>
                  <Copy className="mr-2 h-4 w-4" />
                  {copiedValue === 'discovery'
                    ? (language === 'en' ? 'Copied' : 'Kopiert')
                    : (language === 'en' ? 'Copy' : 'Kopieren')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </AdminCard>

      <AdminCard>
        <div className="grid gap-4 md:grid-cols-[1.2fr_0.4fr_0.4fr]">
          <div className="space-y-2">
            <label className="text-sm font-medium">{language === 'en' ? 'Search' : 'Suche'}</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="pl-9"
                placeholder={language === 'en' ? 'Search by name, slug, tag…' : 'Nach Name, Slug, Tag suchen…'}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{language === 'en' ? 'Status' : 'Status'}</label>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as typeof statusFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{language === 'en' ? 'All' : 'Alle'}</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{language === 'en' ? 'Visibility' : 'Sichtbarkeit'}</label>
            <Select value={visibilityFilter} onValueChange={(value) => setVisibilityFilter(value as typeof visibilityFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{language === 'en' ? 'All' : 'Alle'}</SelectItem>
                <SelectItem value="public">{language === 'en' ? 'Public' : 'Öffentlich'}</SelectItem>
                <SelectItem value="private">{language === 'en' ? 'Private' : 'Privat'}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </AdminCard>

      {isLoading ? (
        <AdminCard className="flex min-h-[280px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </AdminCard>
      ) : filteredSpecs.length === 0 ? (
        emptyState
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {filteredSpecs.map((spec) => (
            <AdminCard
              key={spec.id}
              title={spec.name}
              icon={FileCode2}
              iconColor="from-indigo-500 to-cyan-600"
              actions={<Badge variant={statusVariant[spec.status]}>{spec.status}</Badge>}
            >
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {spec.description || (language === 'en' ? 'No description yet.' : 'Noch keine Beschreibung.')}
                </p>

                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">/{spec.slug}</Badge>
                  <Badge variant="outline">{spec.is_public ? (language === 'en' ? 'Public' : 'Öffentlich') : (language === 'en' ? 'Private' : 'Privat')}</Badge>
                  {spec.is_main_template && <Badge variant="outline">{language === 'en' ? 'Template' : 'Vorlage'}</Badge>}
                  <Badge variant="outline">{Object.keys(spec.definition || {}).length} keys</Badge>
                </div>

                {spec.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {spec.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        <Tag className="mr-1 h-3 w-3" />
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="grid gap-3 rounded-xl border bg-muted/20 p-4 md:grid-cols-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Shield className="h-4 w-4" />
                    <span>{spec.llm_instructions ? (language === 'en' ? 'Has LLM instructions' : 'Mit LLM-Anweisungen') : (language === 'en' ? 'No LLM instructions' : 'Keine LLM-Anweisungen')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Globe className="h-4 w-4" />
                    <span>{new Date(spec.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/specs/${spec.slug}`}>
                      <Pencil className="mr-2 h-4 w-4" />
                      {language === 'en' ? 'Edit' : 'Bearbeiten'}
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handleArchiveToggle(spec)}>
                    <Shield className="mr-2 h-4 w-4" />
                    {spec.status === 'archived'
                      ? (language === 'en' ? 'Restore' : 'Wiederherstellen')
                      : (language === 'en' ? 'Archive' : 'Archivieren')}
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={`/api/specs/${spec.slug}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      {language === 'en' ? 'Open API' : 'API öffnen'}
                    </a>
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => void handleDelete(spec)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {language === 'en' ? 'Delete' : 'Löschen'}
                  </Button>
                </div>
              </div>
            </AdminCard>
          ))}
        </div>
      )}
    </AdminPageLayout>
  );
};

export default Specs;