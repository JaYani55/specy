import { useCallback, useEffect, useRef, useState } from 'react';
import { API_URL } from '@/lib/apiUrl';
import { supabase } from '@/lib/supabase';

interface UseMediaPlaybackResult {
  /** The blob: URL for the audio element src, or null if not yet loaded */
  blobUrl: string | null;
  /** True while the blob is being fetched */
  isLoading: boolean;
  /** Error message if the fetch failed, null otherwise */
  error: string | null;
}

/**
 * Fetches a media file from the PluraDash files/download endpoint using JWT
 * authentication and returns a blob: URL suitable for <audio src>.
 *
 * Uses the same reliable blob-fetch pattern proven in the IsibotPage voicefiles
 * section — JWT Bearer token auth instead of fragile HMAC-signed URLs.
 */
export function useMediaPlayback(
  objectKey: string | null | undefined,
  tenantId?: string,
): UseMediaPlaybackResult {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  // Cleanup blob URL on unmount or when objectKey changes
  const revokeCurrentBlob = useCallback(() => {
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!objectKey) {
      setBlobUrl(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;

    const fetchBlob = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const url = new URL(`${API_URL}/api/plugin/pluradash/files/download`);
        url.searchParams.set('path', objectKey);
        if (tenantId) {
          url.searchParams.set('tenantId', tenantId);
        }

        const headers = new Headers();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        }

        const res = await fetch(url.toString(), { headers });

        if (!res.ok) {
          const payload = await res.json().catch(() => ({ error: 'Fehler beim Laden der Audiodatei.' })) as { error?: string };
          throw new Error(payload.error ?? 'Fehler beim Laden der Audiodatei.');
        }

        const blob = await res.blob();

        if (cancelled) return;

        // Revoke previous blob URL before creating a new one
        revokeCurrentBlob();

        const newBlobUrl = URL.createObjectURL(blob);
        activeBlobUrlRef.current = newBlobUrl;
        setBlobUrl(newBlobUrl);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler beim Laden der Audiodatei.';
        setError(message);
        setBlobUrl(null);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void fetchBlob();

    return () => {
      cancelled = true;
    };
  }, [objectKey, tenantId, revokeCurrentBlob]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      revokeCurrentBlob();
    };
  }, [revokeCurrentBlob]);

  return { blobUrl, isLoading, error };
}