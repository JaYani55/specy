// Content Block Types
export type ContentBlock = TextBlock | HeadingBlock | ImageBlock | QuoteBlock | ListBlock | VideoBlock;

export interface CodeBlockItem {
  id: string;
  language: string;
  code: string;
  label?: string;
  pattern?: string;
  frameworks?: string[];
}

export interface BaseBlock {
  id: string;
  type: string;
}

export interface TextBlock extends BaseBlock {
  type: 'text';
  content: string;
}

export interface HeadingBlock extends BaseBlock {
  type: 'heading';
  content: string;
  level: 'heading1' | 'heading2' | 'heading3' | 'heading4' | 'heading5' | 'heading6';
}

export interface ImageBlock extends BaseBlock {
  type: 'image';
  src: string;
  alt: string;
  caption?: string;
  width?: number;
  height?: number;
}

export interface QuoteBlock extends BaseBlock {
  type: 'quote';
  text: string;
  author?: string;
  source?: string;
}

export interface ListBlock extends BaseBlock {
  type: 'list';
  style: 'ordered' | 'unordered';
  items: string[];
}

export interface VideoBlock extends BaseBlock {
  type: 'video';
  src: string;
  provider: 'youtube' | 'vimeo' | 'other';
  caption?: string;
}

// Page Builder Data Interfaces
export interface Cta {
  title: string;
  description: string;
  primaryButton: string;
}

export interface FaqItem {
  question: string;
  answer: ContentBlock[];
}

export interface HeroStat {
  label: string;
  value: string;
}

export interface Hero {
  image: string;
  stats: HeroStat[];
  title: string;
  description: ContentBlock[];
}

export interface CardItem {
  icon: string;
  color: string;
  items?: string[];
  content?: Array<ContentBlock | { type: 'bullet-point'; id: string; text: string }>;
  title: string;
  description: string;
}

export interface Feature {
  title: string;
  description: ContentBlock[];
  reverse?: boolean;
  alignment?: 'left' | 'center' | 'right';
}

export interface PageBuilderData {
  cta: Cta;
  faq: FaqItem[];
  hero: Hero;
  cards: CardItem[];
  features: Feature[];
  subtitle: string;
  'trainer-module': boolean;
}

// --- Schema-Driven PageBuilder Types ---

export type SchemaRegistrationStatus = 'pending' | 'waiting' | 'registered' | 'archived';

export interface PageSchema {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  schema: Record<string, unknown>;
  llm_instructions: string | null;
  registration_code: string | null;
  registration_status: SchemaRegistrationStatus;
  frontend_url: string | null;
  revalidation_endpoint: string | null;
  revalidation_secret: string | null;
  slug_structure: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface PageRecord {
  id: string;
  slug: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  is_draft: boolean;
  content: Record<string, unknown>;
  schema_id: string | null;
  domain_url: string | null;
  updated_at: string;
  published_at: string | null;
}

export interface SchemaFieldDefinition {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'ContentBlock[]' | 'CodeBlock[]' | 'media';
  /** Help text shown below the field in the Page Builder */
  description?: string;
  /** Input placeholder shown inside the input in the Page Builder */
  placeholder?: string;
  /**
   * Developer / LLM context about the intended function and design of this field.
   * NOT rendered in the Page Builder — exposed only via the schema API and spec.txt.
   */
  meta_description?: string;
  required?: boolean;
  properties?: SchemaFieldDefinition[];
  items?: SchemaFieldDefinition;
  enum?: string[];
}

/** Grouping of schemas by their frontend domain (TLD). */
export interface TLDGroup {
  /** The domain URL, or null for unassigned schemas */
  domain: string | null;
  /** Health status of the domain */
  health: 'online' | 'offline' | 'checking' | 'unknown';
  /** Latency in ms (only when online) */
  latency_ms?: number;
  /** All schemas registered to this TLD */
  schemas: PageSchema[];
}

// --- Agent Log Types ---

export interface AgentLog {
  id: string;
  schema_id: string | null;
  schema_slug: string | null;
  method: string;
  path: string;
  status_code: number | null;
  request_body: Record<string, unknown> | null;
  response_body: Record<string, unknown> | null;
  duration_ms: number | null;
  ip_address: string | null;
  user_agent: string | null;
  error: string | null;
  created_at: string;
}

export interface AgentLogStats {
  total: number;
  last_24h: number;
  errors: number;
  unique_agents: number;
}

export interface AgentLogPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}
