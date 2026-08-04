import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, Copy, ExternalLink, FileCode2, Loader2, Search, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { AdminCard, AdminPageLayout } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MarkdownContent } from '@/components/forms/MarkdownContent';
import { useTheme } from '@/contexts/ThemeContext';
import { API_URL } from '@/lib/apiUrl';
import { getSpecs } from '@/services/specService';
import type { SpecRecord } from '@/types/specs';

const STANDARD_SLUGS = new Set(['specy-frontend-guide', 'astro', 'nextjs']);

const McpPromptSpecs = () => {
  const { language } = useTheme();
  const [specs, setSpecs] = useState<SpecRecord[]>([]);
  const [query, setQuery] = useState('');
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadSpecs = useCallback(async () => {
    try {
      setIsLoading(true);
      const records = await getSpecs();
      setSpecs(records.filter((spec) => STANDARD_SLUGS.has(spec.slug) || spec.metadata?.standard_prompt === true));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load prompt specs.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSpecs();
  }, [loadSpecs]);

  const filteredSpecs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return specs;
    return specs.filter((spec) => [spec.name, spec.slug, spec.description ?? '', spec.llm_instructions ?? '', ...spec.tags]
      .some((value) => value.toLowerCase().includes(normalizedQuery)));
  }, [query, specs]);

  const copyPrompt = async (spec: SpecRecord) => {
    try {
      await navigator.clipboard.writeText(spec.llm_instructions ?? '');
      setCopiedSlug(spec.slug);
      window.setTimeout(() => setCopiedSlug((current) => current === spec.slug ? null : current), 2000);
      toast.success(language === 'en' ? 'Prompt copied.' : 'Prompt kopiert.');
    } catch {
      toast.error(language === 'en' ? 'Copy failed.' : 'Kopieren fehlgeschlagen.');
    }
  };

  return (
    <AdminPageLayout
      title={language === 'en' ? 'Frontend Prompt Specs' : 'Frontend-Prompt-Specs'}
      description={language === 'en'
        ? 'Copyable, agent-retrievable implementation prompts for standard Specy frontends.'
        : 'Kopierbare, für Agenten abrufbare Implementierungsprompts für Standard-Specy-Frontends.'}
      icon={Bot}
      actions={<Badge variant="outline">{filteredSpecs.length}</Badge>}
    >
      <AdminCard>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {language === 'en'
              ? 'These prompts are public published MCP specs. Agents can retrieve them through REST or MCP using their exact slug.'
              : 'Diese Prompts sind veröffentlichte öffentliche MCP-Specs. Agenten können sie per REST oder MCP über ihren exakten Slug abrufen.'}
          </p>
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={language === 'en' ? 'Search prompts…' : 'Prompts suchen…'} />
          </div>
        </div>
      </AdminCard>

      <AdminCard className="p-0">
        {isLoading ? (
          <div className="flex min-h-[240px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
        ) : filteredSpecs.length === 0 ? (
          <div className="flex min-h-[240px] items-center justify-center p-8 text-center text-sm text-muted-foreground">
            {language === 'en' ? 'No standard prompt specs found.' : 'Keine Standard-Prompt-Specs gefunden.'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{language === 'en' ? 'Spec' : 'Spec'}</TableHead>
                <TableHead>{language === 'en' ? 'Description' : 'Beschreibung'}</TableHead>
                <TableHead>{language === 'en' ? 'Tags' : 'Tags'}</TableHead>
                <TableHead className="w-[230px]">{language === 'en' ? 'Actions' : 'Aktionen'}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSpecs.map((spec) => {
                const isOpen = openSlug === spec.slug;
                return (
                  <TableRow key={spec.id} className="align-top">
                    <TableCell colSpan={4} className="p-0">
                      <Collapsible open={isOpen} onOpenChange={(open) => setOpenSlug(open ? spec.slug : null)}>
                        <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_2fr_1.3fr_230px] lg:items-start">
                          <CollapsibleTrigger asChild>
                            <Button variant="ghost" className="justify-start gap-2 p-0 text-left font-semibold hover:bg-transparent">
                              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                              <FileCode2 className="h-4 w-4 text-primary" />
                              <span><span className="block">{spec.name}</span><code className="text-xs font-normal text-muted-foreground">{spec.slug}</code></span>
                            </Button>
                          </CollapsibleTrigger>
                          <div className="text-sm text-muted-foreground">{spec.description || (language === 'en' ? 'No description.' : 'Keine Beschreibung.')}</div>
                          <div className="flex flex-wrap gap-1">{spec.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" onClick={() => void copyPrompt(spec)} disabled={!spec.llm_instructions}>
                              {copiedSlug === spec.slug ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                              {copiedSlug === spec.slug ? (language === 'en' ? 'Copied' : 'Kopiert') : (language === 'en' ? 'Copy prompt' : 'Prompt kopieren')}
                            </Button>
                            <Button asChild size="sm" variant="outline">
                              <a href={`${API_URL}/api/specs/${encodeURIComponent(spec.slug)}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />API</a>
                            </Button>
                          </div>
                        </div>
                        <CollapsibleContent>
                          <div className="border-t bg-muted/20 p-5">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <h3 className="font-semibold">{language === 'en' ? 'Markdown prompt' : 'Markdown-Prompt'}</h3>
                              <Badge variant="outline">MCP: {spec.slug}</Badge>
                            </div>
                            <div className="rounded-lg border bg-background p-4"><MarkdownContent content={spec.llm_instructions ?? ''} /></div>
                            <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">{language === 'en' ? 'Structured definition' : 'Strukturierte Definition'}</summary><pre className="mt-2 overflow-auto rounded-lg bg-muted p-4 text-xs">{JSON.stringify(spec.definition, null, 2)}</pre></details>
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </AdminCard>
    </AdminPageLayout>
  );
};

export default McpPromptSpecs;
