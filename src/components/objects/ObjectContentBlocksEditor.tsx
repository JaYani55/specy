import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { ChevronDown, Plus } from 'lucide-react';
import type { ContentBlock } from '@/types/pagebuilder';
import { StandaloneContentBlockEditor } from '@/components/pagebuilder/StandaloneContentBlockEditor';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const generateBlockId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

const createDefaultBlock = (type: ContentBlock['type'], prefix: string): ContentBlock => {
  const id = generateBlockId(prefix);
  switch (type) {
    case 'text':
      return { id, type: 'text', content: '' };
    case 'heading':
      return { id, type: 'heading', content: '', level: 'heading2' };
    case 'image':
      return { id, type: 'image', src: '', alt: '', width: 800, height: 600 };
    case 'quote':
      return { id, type: 'quote', text: '' };
    case 'list':
      return { id, type: 'list', style: 'unordered', items: [] };
    case 'video':
      return { id, type: 'video', src: '', provider: 'youtube' };
    case 'form':
      return { id, type: 'form', form_id: '', form_slug: '', form_name: '' };
    case 'audio':
      return { id, type: 'audio', src: '' };
  }
};

interface ObjectContentBlocksEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  addPrefix?: string;
}

export const ObjectContentBlocksEditor: React.FC<ObjectContentBlocksEditorProps> = ({
  blocks,
  onChange,
  addPrefix = 'markdown-object-block',
}) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = blocks.findIndex((block) => block.id === active.id);
    const newIndex = blocks.findIndex((block) => block.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    onChange(arrayMove(blocks, oldIndex, newIndex));
  };

  const addBlock = (type: ContentBlock['type']) => {
    onChange([...blocks, createDefaultBlock(type, addPrefix)]);
  };

  return (
    <div className="space-y-3">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
      >
        <SortableContext items={blocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
          {blocks.map((block, index) => (
            <StandaloneContentBlockEditor
              key={block.id}
              block={block}
              onChange={(updated) => onChange(blocks.map((entry, entryIndex) => (entryIndex === index ? updated : entry)))}
              onRemove={() => onChange(blocks.filter((_, entryIndex) => entryIndex !== index))}
            />
          ))}
        </SortableContext>
      </DndContext>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" variant="outline" className="w-full border-dashed">
            <Plus className="mr-2 h-4 w-4" />
            Content-Block hinzufügen
            <ChevronDown className="ml-auto h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          {(['text', 'heading', 'image', 'quote', 'list', 'video', 'form', 'audio'] as ContentBlock['type'][]).map((type) => (
            <DropdownMenuItem key={type} onClick={() => addBlock(type)}>
              {type === 'text' && '📝 '}
              {type === 'heading' && '📋 '}
              {type === 'image' && '🖼️ '}
              {type === 'quote' && '💬 '}
              {type === 'list' && '📄 '}
              {type === 'video' && '🎥 '}
              {type === 'form' && '🧾 '}
              {type === 'audio' && '🎵 '}
              {type.charAt(0).toUpperCase() + type.slice(1)} Block
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};