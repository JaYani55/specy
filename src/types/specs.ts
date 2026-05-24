export type SpecStatus = 'draft' | 'published' | 'archived';

export interface SpecRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  definition: Record<string, unknown>;
  llm_instructions: string | null;
  status: SpecStatus;
  is_public: boolean;
  is_main_template: boolean;
  tags: string[];
  metadata: Record<string, unknown> | null;
  tenant_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchemaSpecSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: SpecStatus;
  is_public: boolean;
  llm_instructions: string | null;
  definition: Record<string, unknown>;
  tags: string[];
  metadata: Record<string, unknown> | null;
  updated_at: string;
  enabled: boolean;
  is_main: boolean;
  sort_order: number;
}

export interface SchemaSpecBundle {
  schema?: {
    id: string;
    slug: string;
    name: string;
    registration_status?: string | null;
    frontend_url?: string | null;
  };
  main_spec: SchemaSpecSummary | null;
  attached_specs: SchemaSpecSummary[];
}

export interface SaveSpecInput {
  slug: string;
  name: string;
  description?: string | null;
  definition: Record<string, unknown>;
  llm_instructions?: string | null;
  status: SpecStatus;
  is_public: boolean;
  is_main_template?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
  tenant_id?: string | null;
}