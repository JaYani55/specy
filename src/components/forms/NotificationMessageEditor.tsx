import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Typography from '@tiptap/extension-typography';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import {
  Bold as BoldIcon,
  ChevronDown,
  Heading1,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic as ItalicIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  RotateCcw,
  Unlink,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTheme } from '@/contexts/ThemeContext';
import { ImageUploader } from '@/components/pagebuilder/ImageUploader';
import { TemplateToken } from '@/components/forms/TemplateToken';
import { SYSTEM_TOKENS, tokenDisplayLabel } from '@/utils/formNotificationTemplates';
import { cn } from '@/lib/utils';
import type { FormFieldDefinition } from '@/types/forms';

const DRAG_TOKEN_MIME = 'text/template-token';

const FILLABLE_FIELD_TYPES = new Set(['help-text', 'image']);

interface NotificationMessageEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initialHtml: string;
  defaultHtml: string;
  fields: FormFieldDefinition[];
  onSave: (html: string | null) => void;
}

const EditorToolbarButton: React.FC<{
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, active, disabled, title, children }) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    className={cn('h-8 w-8 p-0', active && 'bg-accent text-accent-foreground')}
    onClick={onClick}
    disabled={disabled}
    title={title}
  >
    {children}
  </Button>
);

export const NotificationMessageEditor: React.FC<NotificationMessageEditorProps> = ({
  open,
  onOpenChange,
  title,
  description,
  initialHtml,
  defaultHtml,
  fields,
  onSave,
}) => {
  const { language } = useTheme();
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [imageSectionOpen, setImageSectionOpen] = useState(false);
  const restoredRef = useRef(false);
  const lastSavedContentRef = useRef<string>(initialHtml);

  const fillableFields = fields.filter((field) => !FILLABLE_FIELD_TYPES.has(field.type));

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bold: false,
        italic: false,
        link: false,
        heading: { levels: [1, 2, 3] },
      }),
      Typography,
      Bold,
      Italic,
      Link.configure({
        openOnClick: false,
        autolink: false,
        defaultProtocol: 'https',
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      Image.configure({ inline: false, allowBase64: false }),
      TemplateToken,
    ],
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'notification-message-editor min-h-[220px] max-h-[46vh] overflow-y-auto rounded-md border bg-background p-3 text-sm focus:outline-none',
      },
      handleDrop: (view, event) => {
        const token = event.dataTransfer?.getData(DRAG_TOKEN_MIME);
        if (!token) return false;
        const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coordinates) return false;
        const node = view.state.schema.nodes.templateToken?.create({ token });
        if (!node) return false;
        view.dispatch(view.state.tr.insert(coordinates.pos, node));
        return true;
      },
    },
    onUpdate: () => {
      restoredRef.current = false;
    },
  });

  // Load the current template each time the modal opens.
  useEffect(() => {
    if (!open || !editor) return;
    restoredRef.current = false;
    lastSavedContentRef.current = initialHtml;
    editor.commands.setContent(initialHtml, { emitUpdate: false });
    setImageSectionOpen(false);
    setLinkPopoverOpen(false);
  }, [open, editor, initialHtml]);

  const insertToken = (targetEditor: Editor, token: string): void => {
    targetEditor
      .chain()
      .focus()
      .insertContent({ type: 'templateToken', attrs: { token } })
      .run();
  };

  const applyLink = (): void => {
    if (!editor) return;
    const trimmed = linkUrl.trim();
    if (!trimmed) {
      setLinkPopoverOpen(false);
      return;
    }
    let normalized = trimmed;
    if (!trimmed.startsWith('/') && !trimmed.startsWith('#') && !trimmed.startsWith('mailto:') && !trimmed.startsWith('tel:')) {
      normalized = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: normalized }).run();
    setLinkUrl('');
    setLinkPopoverOpen(false);
  };

  const removeLink = (): void => {
    if (!editor) return;
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    setLinkUrl('');
    setLinkPopoverOpen(false);
  };

  const handleSave = (): void => {
    if (!editor) return;
    if (restoredRef.current) {
      onSave(null);
    } else {
      const html = editor.getHTML();
      if (!html.trim() || html === '<p></p>') {
        toast.error(language === 'en' ? 'The message must not be empty.' : 'Der Nachrichtentext darf nicht leer sein.');
        return;
      }
      onSave(html);
    }
    onOpenChange(false);
  };

  const handleRestoreDefault = (): void => {
    if (!editor) return;
    restoredRef.current = true;
    editor.commands.setContent(defaultHtml, { emitUpdate: false });
    toast.info(language === 'en'
      ? 'Standard text restored. Apply to save it as the default again.'
      : 'Standardtext wiederhergestellt. Mit Übernehmen wird wieder der Standard gespeichert.');
  };

  if (!editor) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1 rounded-md border bg-muted/40 p-1">
            <EditorToolbarButton
              onClick={() => editor.chain().focus().toggleBold().run()}
              active={editor.isActive('bold')}
              title="Fett (Strg+B)"
            >
              <BoldIcon className="h-4 w-4" />
            </EditorToolbarButton>
            <EditorToolbarButton
              onClick={() => editor.chain().focus().toggleItalic().run()}
              active={editor.isActive('italic')}
              title="Kursiv (Strg+I)"
            >
              <ItalicIcon className="h-4 w-4" />
            </EditorToolbarButton>
            <EditorToolbarButton
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              active={editor.isActive('heading', { level: 1 })}
              title="Überschrift 1"
            >
              <Heading1 className="h-4 w-4" />
            </EditorToolbarButton>
            <EditorToolbarButton
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              active={editor.isActive('heading', { level: 2 })}
              title="Überschrift 2"
            >
              <Heading2 className="h-4 w-4" />
            </EditorToolbarButton>
            <EditorToolbarButton
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              active={editor.isActive('heading', { level: 3 })}
              title="Überschrift 3"
            >
              <Heading3 className="h-4 w-4" />
            </EditorToolbarButton>
            <EditorToolbarButton
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              active={editor.isActive('bulletList')}
              title="Aufzählung"
            >
              <List className="h-4 w-4" />
            </EditorToolbarButton>
            <EditorToolbarButton
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
              active={editor.isActive('orderedList')}
              title="Nummerierte Liste"
            >
              <ListOrdered className="h-4 w-4" />
            </EditorToolbarButton>

            <Popover open={linkPopoverOpen} onOpenChange={(next) => {
              if (next) {
                setLinkUrl(editor.isActive('link') ? (editor.getAttributes('link').href ?? '') : '');
              }
              setLinkPopoverOpen(next);
            }}>
              <PopoverTrigger asChild>
                <EditorToolbarButton
                  onClick={() => setLinkUrl(editor.isActive('link') ? (editor.getAttributes('link').href ?? '') : '')}
                  active={editor.isActive('link')}
                  title="Link einfügen / bearbeiten"
                >
                  <LinkIcon className="h-4 w-4" />
                </EditorToolbarButton>
              </PopoverTrigger>
              <PopoverContent className="w-80 space-y-2" align="start">
                <Input
                  value={linkUrl}
                  onChange={(event) => setLinkUrl(event.target.value)}
                  placeholder="https://beispiel.de"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyLink();
                    }
                  }}
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" className="flex-1" onClick={applyLink}>
                    {language === 'en' ? 'Apply link' : 'Link übernehmen'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="flex-1" onClick={removeLink} disabled={!editor.isActive('link')}>
                    <Unlink className="mr-1 h-3.5 w-3.5" />
                    {language === 'en' ? 'Remove' : 'Entfernen'}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <EditorToolbarButton
              onClick={() => setImageSectionOpen((current) => !current)}
              active={imageSectionOpen}
              title={language === 'en' ? 'Insert image' : 'Bild einfügen'}
            >
              <ImageIcon className="h-4 w-4" />
            </EditorToolbarButton>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" title={language === 'en' ? 'Insert dynamic blocks' : 'Dynamische Blöcke einfügen'}>
                  {language === 'en' ? 'Blocks' : 'Blöcke'}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
                <DropdownMenuLabel>{language === 'en' ? 'System' : 'System'}</DropdownMenuLabel>
                {SYSTEM_TOKENS.map((descriptor) => (
                  <DropdownMenuItem
                    key={descriptor.token}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer?.setData(DRAG_TOKEN_MIME, descriptor.token);
                      event.dataTransfer?.setData('text/plain', descriptor.label);
                    }}
                    onSelect={() => insertToken(editor, descriptor.token)}
                  >
                    <div className="min-w-0">
                      <span className="template-token template-token-preview">{descriptor.label}</span>
                      <p className="truncate text-xs text-muted-foreground">{descriptor.description}</p>
                    </div>
                  </DropdownMenuItem>
                ))}
                {fillableFields.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{language === 'en' ? 'Form blocks' : 'Formular-Blöcke'}</DropdownMenuLabel>
                    {fillableFields.map((field) => {
                      const token = `field:${field.name}`;
                      return (
                        <DropdownMenuItem
                          key={field.name}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer?.setData(DRAG_TOKEN_MIME, token);
                            event.dataTransfer?.setData('text/plain', tokenDisplayLabel(token));
                          }}
                          onSelect={() => insertToken(editor, token)}
                        >
                          <div className="min-w-0">
                            <span className="template-token template-token-preview">{tokenDisplayLabel(token)}</span>
                            <p className="truncate text-xs text-muted-foreground">{field.label}</p>
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {imageSectionOpen && (
            <div className="rounded-md border bg-muted/20 p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                {language === 'en'
                  ? 'Select an image from the media library. Note: the image URL must be publicly accessible so it renders in e-mail clients.'
                  : 'Bild aus der Medienauswahl wählen. Hinweis: Die Bild-URL muss öffentlich abrufbar sein, damit sie in E-Mail-Clients dargestellt wird.'}
              </p>
              <ImageUploader
                value=""
                previewVariant="banner"
                onChange={(url) => {
                  if (!url) return;
                  editor.chain().focus().setImage({ src: url, alt: '' }).run();
                  setImageSectionOpen(false);
                }}
              />
            </div>
          )}

          <EditorContent editor={editor} />

          <p className="text-xs text-muted-foreground">
            {language === 'en'
              ? 'Tip: blocks can also be dragged from the menu directly into the text.'
              : 'Tipp: Blöcke lassen sich aus dem Menü auch direkt per Drag & Drop in den Text ziehen.'}
          </p>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={handleRestoreDefault}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {language === 'en' ? 'Restore default' : 'Standard wiederherstellen'}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {language === 'en' ? 'Cancel' : 'Abbrechen'}
            </Button>
            <Button type="button" onClick={handleSave}>
              {language === 'en' ? 'Apply' : 'Übernehmen'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
