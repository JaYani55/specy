import { Node, mergeAttributes } from '@tiptap/core';
import { tokenDisplayLabel } from '@/utils/formNotificationTemplates';

/**
 * Inline atom node representing a template token chip, e.g. `$first_name` or
 * `$submissions`. Serialized as `<span data-token="...">…</span>` so the API
 * renderer can resolve tokens server-side (see `api/lib/formMessageTemplate.ts`).
 */
export const TemplateToken = Node.create({
  name: 'templateToken',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      token: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-token'),
        renderHTML: (attributes: { token?: string | null }) => ({ 'data-token': attributes.token ?? '' }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-token]',
        getAttrs: (element) => {
          const token = (element as HTMLElement).getAttribute('data-token') ?? '';
          return token.trim() ? null : false;
        },
      },
    ];
  },

  renderHTML({ node }: { node: { attrs: { token?: string | null } } }) {
    const token = typeof node.attrs.token === 'string' ? node.attrs.token : '';
    return ['span', mergeAttributes({ 'data-token': token, class: 'template-token' }), tokenDisplayLabel(token)];
  },

  renderText({ node }: { node: { attrs: { token?: string | null } } }) {
    const token = typeof node.attrs.token === 'string' ? node.attrs.token : '';
    return tokenDisplayLabel(token);
  },
});
