import type { ContentBlock } from './pagebuilder';

export type ObjectStatus = 'published' | 'archived';

export type ObjectType = 'json' | 'markdown';

export type ObjectFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'url'
  | 'email'
  | 'date'
  | 'price';

export interface ObjectFieldDefinition {
  editorId?: string;
  name: string;
  type: ObjectFieldType;
  description?: string;
  placeholder?: string;
  meta_description?: string;
  required?: boolean;
  currency?: string;
  multiple?: boolean;
  enum?: string[];
  properties?: ObjectFieldDefinition[];
  items?: ObjectFieldDefinition;
}

export type ObjectSchemaDefinition = Record<string, Omit<ObjectFieldDefinition, 'name'>>;

export interface MarkdownObjectData {
  metadata: Record<string, unknown>;
  content: ContentBlock[];
}

export interface ObjectRecord {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  agent_description: string | null;
  object_type: ObjectType;
  schema: ObjectSchemaDefinition;
  data: Record<string, unknown> | unknown[] | MarkdownObjectData;
  status: ObjectStatus;
  requires_auth: boolean;
  api_enabled: boolean;
  share_enabled: boolean;
  share_slug: string | null;
  tenant_id?: string | null;
  owner_user_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PublicObjectDefinition {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  agent_description: string | null;
  object_type: ObjectType;
  requires_auth: boolean;
  api_enabled: boolean;
  share_enabled: boolean;
  share_slug: string | null;
  schema: ObjectSchemaDefinition;
  data: Record<string, unknown> | unknown[] | MarkdownObjectData;
  updated_at: string;
}
