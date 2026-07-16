import { Loader2 } from 'lucide-react';
import { useMediaPlayback } from '@/hooks/useMediaPlayback';

interface MediaAudioPlayerProps {
  /** The R2 object key to fetch and play */
  objectKey: string | null | undefined;
  /** Optional tenant ID for scoped file access */
  tenantId?: string;
  /** Optional caption displayed below the audio player */
  caption?: string;
  /** CSS class for the wrapper figure element */
  className?: string;
}

/**
 * A unified audio player component that fetches media files via JWT-authenticated
 * blob download and renders a native <audio> element.
 *
 * Drop-in replacement for:
 * - Direct <audio src={signedUrl}> in ObjectContentRenderer AudioBlocks
 * - window.open(playbackUrl) in IsibotPage recordings
 * - Manual blob-fetch + <audio> in IsibotPage voicefiles
 */
export function MediaAudioPlayer({
  objectKey,
  tenantId,
  caption,
  className,
}: MediaAudioPlayerProps) {
  const { blobUrl, isLoading, error } = useMediaPlayback(objectKey, tenantId);

  if (!objectKey) {
    return (
      <span className="text-xs text-muted-foreground">
        Keine Audiodatei verfügbar.
      </span>
    );
  }

  if (isLoading) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Audio wird geladen ...
      </span>
    );
  }

  if (error) {
    return (
      <span className="text-xs text-destructive">
        Audio konnte nicht geladen werden.
      </span>
    );
  }

  if (!blobUrl) {
    return (
      <span className="text-xs text-muted-foreground">
        Audio nicht verfügbar.
      </span>
    );
  }

  return (
    <figure className={className}>
      <audio
        controls
        preload="metadata"
        className="h-10 min-w-[220px] max-w-full"
        src={blobUrl}
      >
        Ihr Browser unterstützt kein Audio-Playback.
      </audio>
      {caption ? (
        <figcaption className="text-sm text-muted-foreground mt-2">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}