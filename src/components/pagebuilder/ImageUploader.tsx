import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { API_URL } from '@/lib/apiUrl';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, Image as ImageIcon, Loader2, Check, X, Folder, ArrowLeft, Trash2, FolderPlus, Database } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { normalizeProfileImageUrl } from '@/utils/staffUtils';
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
import type { MediaSourceInfo } from '@/services/connectionsService';

interface ImageUploaderProps {
  value?: string;
  onChange: (url: string) => void;
  /**
   * Controls how the committed image is previewed above the picker button.
   * - `'banner'` (default): full-width landscape strip, ideal for hero/cover images.
   * - `'avatar'`: small fixed-size circle, ideal for profile/author pictures.
   */
  previewVariant?: 'banner' | 'avatar';
  /** @deprecated — storage is now configured server-side via Connections settings */
  bucket?: string;
  /** @deprecated — upload folder is now the current media browser path */
  folder?: string;
}

interface MediaItem {
  name: string;
  path: string;
  url: string;
  isFolder: boolean;
  size?: number;
  createdAt?: string;
}

export const ImageUploader: React.FC<ImageUploaderProps> = ({
  value,
  onChange,
  previewVariant = 'banner',
  folder,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(value || null);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [itemToDelete, setItemToDelete] = useState<MediaItem | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Multi-source support
  const [availableSources, setAvailableSources] = useState<MediaSourceInfo[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string>('primary');

  const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : 'Unbekannter Fehler.';

  const getAuthHeaders = useCallback(async (): Promise<HeadersInit> => {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    if (!accessToken) {
      return {};
    }

    return {
      Authorization: `Bearer ${accessToken}`,
    };
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${API_URL}/api/media/sources`, { headers });
      if (res.ok) {
        const data = await res.json() as { sources: MediaSourceInfo[] };
        setAvailableSources(data.sources ?? []);
      }
    } catch {
      // non-critical — picker still works with primary source
    }
  }, [getAuthHeaders]);

  const loadMediaLibrary = useCallback(async (path: string = '', sourceId: string = activeSourceId) => {
    setLoadingMedia(true);
    try {
      const params = new URLSearchParams({ path });
      if (sourceId !== 'primary') params.set('source', sourceId);
      const res = await fetch(`${API_URL}/api/media/list?${params.toString()}`, {
        headers: await getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { items: MediaItem[] };
      setMediaItems(data.items ?? []);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      toast.error(`Fehler beim Laden der Medien: ${message}`);
    } finally {
      setLoadingMedia(false);
    }
  }, [getAuthHeaders, activeSourceId]);

  // Load available sources once on mount
  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const handleSourceChange = (sourceId: string) => {
    setActiveSourceId(sourceId);
    setCurrentPath('');
    setPathHistory([]);
    void loadMediaLibrary('', sourceId);
  };

  const handleFolderClick = (folderName: string) => {
    const newPath = currentPath ? `${currentPath}/${folderName}` : folderName;
    setPathHistory([...pathHistory, currentPath]);
    setCurrentPath(newPath);
    void loadMediaLibrary(newPath);
  };

  const handleBackClick = () => {
    const previousPath = pathHistory[pathHistory.length - 1] || '';
    setPathHistory(pathHistory.slice(0, -1));
    setCurrentPath(previousPath);
    void loadMediaLibrary(previousPath);
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error('Bitte geben Sie einen Ordnernamen ein');
      return;
    }

    try {
      const folderPath = currentPath ? `${currentPath}/${newFolderName}` : newFolderName;
      const placeholderPath = `${folderPath}/.placeholder`;
      const formData = new FormData();
      formData.append('file', new File([''], '.placeholder', { type: 'text/plain' }));
      formData.append('path', folderPath);
      if (activeSourceId !== 'primary') formData.append('source', activeSourceId);

      const res = await fetch(`${API_URL}/api/media/upload`, {
        method: 'POST',
        body: formData,
        headers: await getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      // If .placeholder already exists we also treat that as success
      void placeholderPath; // silence unused var

      toast.success(`Ordner "${newFolderName}" erfolgreich erstellt`);
      setNewFolderName('');
      setShowNewFolderDialog(false);
      await loadMediaLibrary(currentPath);
    } catch (error: unknown) {
      toast.error(`Fehler beim Erstellen des Ordners: ${getErrorMessage(error)}`);
    }
  };

  const handleDeleteClick = (item: MediaItem, event: React.MouseEvent) => {
    event.stopPropagation();
    setItemToDelete(item);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;

    try {
      if (itemToDelete.isFolder) {
        // List all files inside the folder, then delete them one-by-one via the API
        const folderPath = itemToDelete.path;
        const authHeaders = await getAuthHeaders();
        const sourceParam = activeSourceId !== 'primary' ? `&source=${encodeURIComponent(activeSourceId)}` : '';
        const listRes = await fetch(`${API_URL}/api/media/list?path=${encodeURIComponent(folderPath)}${sourceParam}`, {
          headers: authHeaders,
        });
        if (listRes.ok) {
          const listData = await listRes.json() as { items: MediaItem[] };
          for (const child of listData.items) {
            if (!child.isFolder) {
              const deleteParams = new URLSearchParams({ path: child.path });
              if (activeSourceId !== 'primary') deleteParams.set('source', activeSourceId);
              await fetch(`${API_URL}/api/media/file?${deleteParams.toString()}`, {
                method: 'DELETE',
                headers: authHeaders,
              });
            }
          }
        }
        toast.success(`Ordner "${itemToDelete.name}" erfolgreich gelöscht`);
      } else {
        const deleteParams = new URLSearchParams({ path: itemToDelete.path });
        if (activeSourceId !== 'primary') deleteParams.set('source', activeSourceId);
        const res = await fetch(
          `${API_URL}/api/media/file?${deleteParams.toString()}`,
          {
            method: 'DELETE',
            headers: await getAuthHeaders(),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
          throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        toast.success(`Bild "${itemToDelete.name}" erfolgreich gelöscht`);
        if (selectedImage === itemToDelete.url) setSelectedImage(null);
      }

      setShowDeleteDialog(false);
      setItemToDelete(null);
      await loadMediaLibrary(currentPath);
    } catch (error: unknown) {
      toast.error(`Fehler beim Löschen: ${getErrorMessage(error)}`);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    const file = acceptedFiles[0];
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (currentPath) formData.append('path', currentPath);
      if (activeSourceId !== 'primary') formData.append('source', activeSourceId);

      const res = await fetch(`${API_URL}/api/media/upload`, {
        method: 'POST',
        body: formData,
        headers: await getAuthHeaders(),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const result = await res.json() as { url: string; path: string };

      // Auto-confirm: uploading = selecting. Write to form and close dialog.
      setSelectedImage(result.url);
      onChange(result.url);
      setIsOpen(false);
      toast.success('Bild erfolgreich hochgeladen!');
    } catch (error: unknown) {
      toast.error(`Upload fehlgeschlagen: ${getErrorMessage(error)}`);
    } finally {
      setUploading(false);
    }
  }, [currentPath, activeSourceId, getAuthHeaders, onChange]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'],
    },
    maxFiles: 1,
    disabled: uploading,
  });

  const handleConfirm = () => {
    if (selectedImage) {
      onChange(selectedImage);
      setIsOpen(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      // Sync internal selection with the current committed value
      setSelectedImage(value || null);
      // Reset to primary source and root path
      setActiveSourceId('primary');
      const initialPath = folder?.replace(/^\/+|\/+$/g, '') || '';
      setCurrentPath(initialPath);
      setPathHistory([]);
      void loadSources();
      void loadMediaLibrary(initialPath, 'primary');
    }
  };

  return (
    <div className="space-y-2">
      {/* Preview thumbnail shown when a value is committed */}
      {value && previewVariant === 'avatar' && (
        <div className="flex items-center gap-3">
          <div className="relative group shrink-0">
            <img
              src={normalizeProfileImageUrl(value, 160) || value}
              alt="Vorschau"
              className="w-16 h-16 rounded-full object-cover border-2 border-border"
            />
            <button
              type="button"
              onClick={() => onChange('')}
              title="Bild entfernen"
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <p className="text-xs text-muted-foreground break-all line-clamp-2">{value.split('/').pop()}</p>
        </div>
      )}
      {value && previewVariant === 'banner' && (
        <div className="relative group w-full rounded-lg overflow-hidden border bg-muted/30">
          <img
            src={value}
            alt="Vorschau"
            className="w-full h-40 object-cover"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onChange('')}
            title="Bild entfernen"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full">
          <ImageIcon className="h-4 w-4 mr-2" />
          {value ? 'Bild ändern' : 'Bild auswählen'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Bild auswählen oder hochladen</DialogTitle>
        </DialogHeader>

        {/* Source selector — only shown when multiple sources are configured */}
        {availableSources.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap pb-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Database className="h-3 w-3" />
              Quelle:
            </span>
            {availableSources.map((src) => (
              <button
                key={src.id}
                type="button"
                onClick={() => handleSourceChange(src.id)}
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
                  activeSourceId === src.id
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:bg-muted text-foreground',
                )}
              >
                {src.label}
                {!src.configured && (
                  <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0 h-3">!</Badge>
                )}
              </button>
            ))}
          </div>
        )}

        <Tabs defaultValue="library" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="library">Medien</TabsTrigger>
            <TabsTrigger value="upload">Vom Computer hochladen</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="space-y-4">
            {/* Navigation Bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                {currentPath ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleBackClick}
                      disabled={loadingMedia}
                    >
                      <ArrowLeft className="h-4 w-4 mr-1" />
                      Zurück
                    </Button>
                    <span className="font-medium">/{currentPath}</span>
                  </>
                ) : (
                  <span className="font-medium">Root</span>
                )}
              </div>
              
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowNewFolderDialog(true)}
                disabled={loadingMedia}
              >
                <FolderPlus className="h-4 w-4 mr-2" />
                Neuer Ordner
              </Button>
            </div>

            {loadingMedia ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                <div className="grid grid-cols-3 gap-4">
                  {mediaItems.map((item, index) => (
                    item.isFolder ? (
                      // Folder Item
                      <div
                        key={`folder-${item.name}-${index}`}
                        className="relative cursor-pointer rounded-lg border-2 border-transparent overflow-hidden transition-all hover:shadow-lg hover:border-primary/50 bg-muted group"
                        onClick={() => handleFolderClick(item.name)}
                      >
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                          onClick={(e) => handleDeleteClick(item, e)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <div className="w-full h-32 flex items-center justify-center">
                          <Folder className="h-16 w-16 text-primary" />
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-2 truncate">
                          📁 {item.name}
                        </div>
                      </div>
                    ) : (
                      // Image Item
                      <div
                        key={`image-${item.url}-${index}`}
                        className={cn(
                          'relative cursor-pointer rounded-lg border-2 overflow-hidden transition-all hover:shadow-lg group',
                          selectedImage === item.url
                            ? 'border-primary ring-2 ring-primary'
                            : 'border-transparent'
                        )}
                        onClick={() => setSelectedImage(item.url)}
                      >
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity z-10"
                          onClick={(e) => handleDeleteClick(item, e)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                        <img
                          src={item.url}
                          alt={item.name}
                          className="w-full h-32 object-cover"
                        />
                        {selectedImage === item.url && (
                          <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                            <Check className="h-4 w-4" />
                          </div>
                        )}
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs p-2 truncate">
                          {item.name}
                        </div>
                      </div>
                    )
                  ))}
                </div>
                {mediaItems.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <ImageIcon className="h-12 w-12 mb-2" />
                    <p>Keine Medien gefunden</p>
                    <p className="text-sm mt-1">
                      {currentPath ? 'Dieser Ordner ist leer' : 'Keine Ordner oder Dateien vorhanden'}
                    </p>
                  </div>
                )}
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="upload" className="space-y-4">
            <div
              {...getRootProps()}
              className={cn(
                'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors',
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50',
                uploading && 'opacity-50 cursor-not-allowed'
              )}
            >
              <input {...getInputProps()} />
              {uploading ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                  <p className="text-sm text-muted-foreground">Wird hochgeladen...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                  <p className="text-lg font-medium mb-2">
                    {isDragActive
                      ? 'Bild hier ablegen...'
                      : 'Bild hierher ziehen oder klicken zum Auswählen'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    PNG, JPG, GIF, WebP oder SVG (max. 10MB)
                  </p>
                </div>
              )}
            </div>

            {selectedImage && (
              <div className="relative rounded-lg border p-4">
                <div className="flex items-start space-x-4">
                  <img
                    src={selectedImage}
                    alt="Preview"
                    className="w-32 h-32 object-cover rounded"
                  />
                  <div className="flex-1">
                    <p className="font-medium mb-1">Ausgewähltes Bild</p>
                    <p className="text-sm text-muted-foreground break-all">{selectedImage}</p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setSelectedImage(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end space-x-2 mt-4">
          <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
            Abbrechen
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!selectedImage}>
            Auswählen
          </Button>
        </div>
      </DialogContent>

      {/* New Folder Dialog */}
      <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neuen Ordner erstellen</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="folder-name">Ordnername</Label>
              <Input
                id="folder-name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="z.B. Produktbilder"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateFolder();
                  }
                }}
              />
            </div>
          </div>
          <div className="flex justify-end space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowNewFolderDialog(false);
                setNewFolderName('');
              }}
            >
              Abbrechen
            </Button>
            <Button type="button" onClick={handleCreateFolder}>
              Erstellen
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {itemToDelete?.isFolder ? 'Ordner löschen?' : 'Bild löschen?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {itemToDelete?.isFolder
                ? `Möchten Sie den Ordner "${itemToDelete.name}" und alle darin enthaltenen Dateien wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`
                : `Möchten Sie das Bild "${itemToDelete?.name}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setItemToDelete(null)}>
              Abbrechen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
    </div>
  );
};
