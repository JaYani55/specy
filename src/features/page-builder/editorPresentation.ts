import type { SchemaFieldDefinition } from '@/types/pagebuilder';

export type PageBuilderLanguage = 'de' | 'en';
type LocalizedCopy = string | Partial<Record<PageBuilderLanguage, string>>;

export interface PresentedSchemaField {
  field: SchemaFieldDefinition;
  label: string;
  helpText?: string;
  groupKey: string;
  groupLabel: string;
  groupDescription?: string;
  order: number;
  groupOrder: number;
}

export interface PresentedSchemaFieldGroup {
  key: string;
  label: string;
  description?: string;
  order: number;
  fields: PresentedSchemaField[];
}

const asRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const localizedCopy = (value: unknown, language: PageBuilderLanguage): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  const localized = asRecord(value);
  const selected = localized?.[language];
  const fallback = localized?.[language === 'de' ? 'en' : 'de'];
  if (typeof selected === 'string' && selected.trim()) return selected.trim();
  if (typeof fallback === 'string' && fallback.trim()) return fallback.trim();
  return undefined;
};

export const humanizeSchemaFieldName = (name: string, language: PageBuilderLanguage): string => {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return name;
  return words.charAt(0).toLocaleUpperCase(language === 'de' ? 'de-DE' : 'en-US') + words.slice(1);
};

const finiteOrder = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

/**
 * Resolve presentation-only labels and grouping from the developer schema and
 * optional editor_config.page_builder hints. This never changes content keys,
 * field types, validation rules, or the technical schema definition.
 */
export function resolveSchemaEditorPresentation(
  fields: SchemaFieldDefinition[],
  editorConfig: Record<string, unknown> | null | undefined,
  language: PageBuilderLanguage,
): PresentedSchemaField[] {
  const configRoot = asRecord(editorConfig?.page_builder) ?? {};
  const fieldHints = asRecord(configRoot.fields) ?? {};
  const groupHints = asRecord(configRoot.groups) ?? {};
  const defaultGroupLabel = language === 'de' ? 'Inhalt' : 'Content';

  return fields.map((field, index) => {
    const hint = asRecord(fieldHints[field.name]) ?? {};
    const groupKey = typeof hint.group === 'string' && hint.group.trim()
      ? hint.group.trim()
      : 'content';
    const groupHint = asRecord(groupHints[groupKey]) ?? {};
    const label = localizedCopy(hint.label, language) ?? humanizeSchemaFieldName(field.name, language);

    return {
      field,
      label,
      helpText: localizedCopy(hint.help_text, language) ?? field.description,
      groupKey,
      groupLabel: localizedCopy(groupHint.label, language)
        ?? (groupKey === 'content' ? defaultGroupLabel : humanizeSchemaFieldName(groupKey, language)),
      groupDescription: localizedCopy(groupHint.description, language),
      order: finiteOrder(hint.order, index),
      groupOrder: finiteOrder(groupHint.order, groupKey === 'content' ? Number.MAX_SAFE_INTEGER : index),
    };
  }).sort((left, right) => left.groupOrder - right.groupOrder || left.order - right.order);
}

export function groupPresentedSchemaFields(fields: PresentedSchemaField[]): PresentedSchemaFieldGroup[] {
  const groups = new Map<string, PresentedSchemaFieldGroup>();
  for (const field of fields) {
    let group = groups.get(field.groupKey);
    if (!group) {
      group = {
        key: field.groupKey,
        label: field.groupLabel,
        description: field.groupDescription,
        order: field.groupOrder,
        fields: [],
      };
      groups.set(field.groupKey, group);
    }
    group.fields.push(field);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      fields: group.fields.sort((left, right) => left.order - right.order),
    }))
    .sort((left, right) => left.order - right.order);
}
