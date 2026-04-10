import BlogTemplate from '@/default-schemas/blog.json';
import TechOnepagerTemplate from '@/default-schemas/tech-onepager.json';
import type { SchemaTemplateDefinition } from '@/types/pagebuilder';

export const SCHEMA_TEMPLATES: SchemaTemplateDefinition[] = [
  {
    id: 'blog',
    slug: 'blog',
    name: 'Blog Post',
    nameDe: 'Blog-Beitrag',
    description: 'A standard blog post schema with hero, content blocks, cards, and FAQ.',
    descriptionDe: 'Ein Standard-Blog-Post-Schema mit Hero, Content-Blöcken, Karten und FAQ.',
    icon: '📝',
    schema: BlogTemplate,
    source: 'bundled',
  },
  {
    id: 'tech-onepager',
    slug: 'tech-onepager',
    name: 'Tech Onepager',
    nameDe: 'Tech-Onepager',
    description: 'A technical landing page schema with hero, value props, specs, CTA, and FAQ.',
    descriptionDe: 'Ein technisches Landingpage-Schema mit Hero, Value Props, Spezifikationen, CTA und FAQ.',
    icon: '🚀',
    schema: TechOnepagerTemplate,
    source: 'bundled',
  }
];

export type SchemaTemplate = SchemaTemplateDefinition;
