import React, { useState } from 'react';
import { ContentBlock } from '@/types/pagebuilder';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus } from 'lucide-react';

interface AddContentBlockProps {
  onAdd: (block: ContentBlock) => void;
  prefix: string;
}

export const AddContentBlock: React.FC<AddContentBlockProps> = ({ onAdd, prefix }) => {
  const generateBlockId = () => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  };

  const addTextBlock = () => {
    onAdd({
      id: generateBlockId(),
      type: 'text',
      content: '',
    });
  };

  const addHeadingBlock = () => {
    onAdd({
      id: generateBlockId(),
      type: 'heading',
      content: '',
      level: 'heading2',
    });
  };

  const addImageBlock = () => {
    onAdd({
      id: generateBlockId(),
      type: 'image',
      src: '',
      alt: '',
      width: 800,
      height: 600,
    });
  };

  const addQuoteBlock = () => {
    onAdd({
      id: generateBlockId(),
      type: 'quote',
      text: '',
    });
  };

  const addListBlock = () => {
    onAdd({
      id: generateBlockId(),
      type: 'list',
      style: 'unordered',
      items: [],
    });
  };

  const addVideoBlock = () => {
    onAdd({
      id: generateBlockId(),
      type: 'video',
      src: '',
      provider: 'youtube',
    });
  };

  const addFormBlock = () => {
    onAdd({
      id: generateBlockId(),
      type: 'form',
      form_id: '',
      form_slug: '',
      form_name: '',
    });
  };

  const addAudioBlock = () => {
    onAdd({
      id: generateBlockId(),
      type: 'audio',
      src: '',
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          Inhaltsblock hinzufügen
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={addTextBlock}>
          📝 Text-Block
        </DropdownMenuItem>
        <DropdownMenuItem onClick={addHeadingBlock}>
          📋 Überschrift
        </DropdownMenuItem>
        <DropdownMenuItem onClick={addImageBlock}>
          🖼️ Bild
        </DropdownMenuItem>
        <DropdownMenuItem onClick={addQuoteBlock}>
          💬 Zitat
        </DropdownMenuItem>
        <DropdownMenuItem onClick={addListBlock}>
          📋 Liste
        </DropdownMenuItem>
        <DropdownMenuItem onClick={addVideoBlock}>
          🎥 Video
        </DropdownMenuItem>
        <DropdownMenuItem onClick={addFormBlock}>
          🧾 Formular
        </DropdownMenuItem>
        <DropdownMenuItem onClick={addAudioBlock}>
          🎵 Audio
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
