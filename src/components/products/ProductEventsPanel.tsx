import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ExternalLink, Loader2, Plus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/hooks/usePermissions';
import { supabase } from '@/lib/supabase';

interface ProductEventsPanelProps {
  tenantId: string;
  /** Stable service-product UUID. The legacy FK is resolved privately for event queries. */
  serviceProductId?: string;
  /** Internal legacy product ID, used only by the existing event relationship. */
  legacyProductId?: number;
  onBeforeCreateEvent?: () => boolean;
}

interface ProductEventSummary {
  id: string;
  date: string | null;
  time: string | null;
  title: string | null;
  hasPage: boolean;
  pageStatus: 'draft' | 'published' | 'archived' | null;
}

const localDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatEventDate = (value: string | null) => {
  if (!value) return 'Datum nicht festgelegt';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(date);
};

export function ProductEventsPanel({ tenantId, serviceProductId, legacyProductId, onBeforeCreateEvent }: ProductEventsPanelProps) {
  const navigate = useNavigate();
  const permissions = usePermissions();
  const [events, setEvents] = useState<ProductEventSummary[]>([]);
  const [resolvedLegacyProductId, setResolvedLegacyProductId] = useState<number | undefined>(legacyProductId);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setLoadFailed(false);
      setEvents([]);
      setResolvedLegacyProductId(legacyProductId);
      try {
        let resolvedLegacyId = legacyProductId;
        if (resolvedLegacyId === undefined && serviceProductId) {
          const { data: product, error: productError } = await supabase
            .from('mentorbooking_products')
            .select('id')
            .eq('integration_id', serviceProductId)
            .eq('tenant_id', tenantId)
            .maybeSingle();
          if (productError) throw productError;
          resolvedLegacyId = product?.id;
        }
        if (resolvedLegacyId === undefined) throw new Error('The product could not be resolved in this workspace.');
        if (!cancelled) setResolvedLegacyProductId(resolvedLegacyId);

        const today = localDate();
        const loadEventRows = () => supabase
          .from('mentorbooking_events')
          .select('id, date, time, page_id')
          .eq('tenant_id', tenantId)
          .eq('product_id', resolvedLegacyId);
        let eventResult = await loadEventRows()
          .gte('date', today)
          .order('date', { ascending: true })
          .order('time', { ascending: true })
          .limit(8);
        if (!eventResult.error && (eventResult.data ?? []).length === 0) {
          eventResult = await loadEventRows()
            .lt('date', today)
            .order('date', { ascending: false })
            .order('time', { ascending: false })
            .limit(5);
        }
        if (eventResult.error) throw eventResult.error;

        const rows = (eventResult.data ?? []) as Array<{ 
          id: string;
          date: string | null;
          time: string | null;
          page_id: string | null;
        }>;
        const pageIds = [...new Set(rows.map((event) => event.page_id).filter((id): id is string => Boolean(id)))];
        const { data: pageRows, error: pagesError } = pageIds.length
          ? await supabase.from('pages').select('id, name, status').eq('tenant_id', tenantId).in('id', pageIds)
          : { data: [], error: null };
        if (pagesError) throw pagesError;
        const pageById = new Map((pageRows ?? []).map((page) => [page.id, page]));
        const summaries = rows.map((event) => {
          const page = event.page_id ? pageById.get(event.page_id) : undefined;
          return {
            id: event.id,
            date: event.date,
            time: event.time,
            title: page?.name ?? null,
            hasPage: Boolean(event.page_id),
            pageStatus: page?.status === 'draft' || page?.status === 'published' || page?.status === 'archived'
              ? page.status
              : null,
          } satisfies ProductEventSummary;
        });
        if (!cancelled) setEvents(summaries);
      } catch (error) {
        console.error('Could not load product events:', error);
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    if (!tenantId || (!serviceProductId && legacyProductId === undefined)) {
      setEvents([]);
      setLoadFailed(true);
      setIsLoading(false);
      return () => { cancelled = true; };
    }
    void load();
    return () => { cancelled = true; };
  }, [legacyProductId, serviceProductId, tenantId]);

  const handleCreateEvent = () => {
    if (resolvedLegacyProductId === undefined || (onBeforeCreateEvent && !onBeforeCreateEvent())) return;
    navigate('/create-event', {
      state: {
        preselectedProductId: resolvedLegacyProductId,
        returnTo: window.location.pathname,
      },
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Veranstaltungen
          </CardTitle>
          <CardDescription className="mt-1">
            Kommende und zuletzt vergangene Veranstaltungen zu diesem Produkt.
          </CardDescription>
        </div>
        {permissions.canCreateEvents && resolvedLegacyProductId !== undefined && (
          <Button size="sm" onClick={handleCreateEvent}>
            <Plus className="mr-2 h-4 w-4" />
            Veranstaltung erstellen
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Veranstaltungen werden geladen…
          </div>
        ) : loadFailed ? (
          <p role="status" className="py-4 text-sm text-muted-foreground">
            Veranstaltungen für dieses Produkt konnten nicht geladen werden.
          </p>
        ) : events.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Für dieses Produkt sind keine kommenden Veranstaltungen geplant.
          </p>
        ) : (
          <ul className="divide-y">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {event.title || 'Veranstaltung'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatEventDate(event.date)}{event.time ? ` · ${event.time}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {event.pageStatus ? (
                    <Badge variant={event.pageStatus === 'published' ? 'default' : 'secondary'}>
                      {event.pageStatus === 'published'
                        ? 'Seite veröffentlicht'
                        : event.pageStatus === 'archived'
                          ? 'Seite archiviert'
                          : 'Seitenentwurf'}
                    </Badge>
                  ) : !event.hasPage ? (
                    <Badge variant="outline">Keine öffentliche Seite</Badge>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/events/${event.id}`)}>
                    <ExternalLink className="mr-1.5 h-4 w-4" />
                    Öffnen
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
