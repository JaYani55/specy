insert into public.llm_specs (
  slug,
  name,
  description,
  definition,
  llm_instructions,
  status,
  is_public,
  is_main_template,
  tags,
  metadata
)
select
  'specy-schema-docs',
  'Specy Schema Docs',
  'General instructions for agents that need to understand Specy schema architecture and create new schemas programmatically.',
  jsonb_build_object(
    'kind', 'specy-schema-docs',
    'version', '1.0.0',
    'purpose', 'Teach an agent how Specy page schemas are structured so it can propose and create a schema without manual use of the schema editor.',
    'platform_overview', jsonb_build_object(
      'what_is_specy', 'Specy is a schema-driven CMS. Schemas define page structure, pages store schema-compliant JSON content, and registered frontends consume published pages through schema-scoped APIs.',
      'schema_role', 'A page schema describes the allowed field structure, integration requirements, and guidance for frontend-building agents.',
      'spec_role', 'A spec is an agent-readable contract that can be attached to a schema and exposed through REST discovery and MCP.',
      'registration_role', 'Schemas own frontend registration. Specs do not register frontends directly.'
    ),
    'schema_authoring_rules', jsonb_build_array(
      'The root schema must be a JSON object whose keys are field names.',
      'Each field entry must declare a supported type.',
      'Use description for Page Builder help text shown to editors.',
      'Use placeholder for inline Page Builder hints.',
      'Use meta_description for developer and agent intent. This is API-facing context, not end-user copy.',
      'For object fields, define nested properties.',
      'For array fields, define items.',
      'For ContentBlock[] fields, expect rich blocks such as text, heading, image, quote, list, video, and form.',
      'For CodeBlock[] fields, define the code item shape and keep language/code fields explicit.',
      'Prefer stable snake_case or kebab-case field names that match the actual content model.'
    ),
    'field_types', jsonb_build_array(
      jsonb_build_object('type', 'string', 'purpose', 'Single line or free text values.', 'notes', jsonb_build_array('Supports description, placeholder, meta_description, required, and enum.')),
      jsonb_build_object('type', 'number', 'purpose', 'Numeric content such as counts, ordering, or measurements.'),
      jsonb_build_object('type', 'boolean', 'purpose', 'Feature flags or layout toggles.'),
      jsonb_build_object('type', 'array', 'purpose', 'Lists of repeated values or objects.', 'notes', jsonb_build_array('Must include an items definition.')),
      jsonb_build_object('type', 'object', 'purpose', 'Nested groups of related fields.', 'notes', jsonb_build_array('Must include properties when structure is known.')),
      jsonb_build_object('type', 'ContentBlock[]', 'purpose', 'Rich editorial content assembled from typed blocks.'),
      jsonb_build_object('type', 'CodeBlock[]', 'purpose', 'Structured code examples with language, pattern, frameworks, and code fields.'),
      jsonb_build_object('type', 'media', 'purpose', 'Media asset references selected through the media library.')
    ),
    'content_block_types', jsonb_build_array(
      jsonb_build_object('type', 'text', 'shape', jsonb_build_object('id', 'string', 'type', 'text', 'content', 'string')),
      jsonb_build_object('type', 'heading', 'shape', jsonb_build_object('id', 'string', 'type', 'heading', 'content', 'string', 'level', 'heading1|heading2|heading3|heading4|heading5|heading6')),
      jsonb_build_object('type', 'image', 'shape', jsonb_build_object('id', 'string', 'type', 'image', 'src', 'string', 'alt', 'string', 'caption', 'string?', 'width', 'number?', 'height', 'number?')),
      jsonb_build_object('type', 'quote', 'shape', jsonb_build_object('id', 'string', 'type', 'quote', 'text', 'string', 'author', 'string?', 'source', 'string?')),
      jsonb_build_object('type', 'list', 'shape', jsonb_build_object('id', 'string', 'type', 'list', 'style', 'ordered|unordered', 'items', 'string[]')),
      jsonb_build_object('type', 'video', 'shape', jsonb_build_object('id', 'string', 'type', 'video', 'src', 'string', 'provider', 'youtube|vimeo|other', 'caption', 'string?')),
      jsonb_build_object('type', 'form', 'shape', jsonb_build_object('id', 'string', 'type', 'form', 'form_id', 'string', 'form_slug', 'string', 'form_name', 'string', 'share_slug', 'string?', 'requires_auth', 'boolean?'))
    ),
    'code_block_field_type', jsonb_build_object(
      'field_type', 'CodeBlock[]',
      'recommended_item_shape', jsonb_build_object(
        'id', 'string',
        'label', 'string?',
        'language', 'string',
        'pattern', 'string?',
        'frameworks', 'string[]?',
        'code', 'string'
      )
    ),
    'integration_contract', jsonb_build_object(
      'route_ownership_values', jsonb_build_array('isolated', 'shared-layout-only', 'may-modify-existing'),
      'page_discovery_modes', jsonb_build_array('schema-scoped-api', 'supabase-by-schema', 'infer-content-shape'),
      'registration_requirements', jsonb_build_array(
        'Frontend registration is performed against /api/schemas/:slug/register.',
        'slug_structure must include :slug exactly once.',
        'Use integration_requirements to constrain canonical domain, route ownership, and page discovery expectations.'
      )
    ),
    'recommended_workflow', jsonb_build_array(
      'Understand the target content model first.',
      'Design the root schema as editor-friendly JSON fields.',
      'Choose field types that match the frontend rendering needs.',
      'Use meta_description aggressively to explain intent to future agents.',
      'Add integration requirements when the frontend route shape or ownership must be constrained.',
      'After the schema exists, attach or replace the main spec in schema settings if needed.'
    ),
    'example_schema', jsonb_build_object(
      'hero', jsonb_build_object(
        'type', 'object',
        'description', 'Top section of the page',
        'properties', jsonb_build_object(
          'title', jsonb_build_object('type', 'string', 'required', true, 'meta_description', 'Primary headline for the page.'),
          'description', jsonb_build_object('type', 'ContentBlock[]', 'meta_description', 'Rich lead content below the headline.'),
          'image', jsonb_build_object('type', 'media', 'meta_description', 'Primary hero image.')
        )
      ),
      'faq', jsonb_build_object(
        'type', 'array',
        'description', 'Frequently asked questions',
        'items', jsonb_build_object(
          'type', 'object',
          'properties', jsonb_build_object(
            'question', jsonb_build_object('type', 'string', 'required', true),
            'answer', jsonb_build_object('type', 'ContentBlock[]', 'required', true)
          )
        )
      )
    )
  ),
  'Use this spec when an agent needs to design a new Specy page schema. First understand the target content model, then produce schema JSON that respects Specy field types, content block support, integration requirements, and editor-facing metadata. This spec is for authoring schemas, not for registering a frontend directly.',
  'published',
  true,
  true,
  '["core-docs", "schema-authoring", "specy", "mcp"]'::jsonb,
  '{"global_discovery": true, "scope": "core-docs", "mcp_exposed": true, "hard_coded": true}'::jsonb
where not exists (
  select 1
  from public.llm_specs
  where slug = 'specy-schema-docs'
);