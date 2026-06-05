import type { Env } from './supabase';

export interface MetaTags {
  title: string;
  description?: string;
  image?: string;
  url?: string;
  type?: string;
  origin?: string;
}

const DEFAULT_META: MetaTags = {
  title: 'Pluracon Service',
  description: 'Pluracon Platform',
  image: undefined, // No default image on the right if not provided by content
  type: 'website',
};

/**
 * Injects Open Graph and basic meta tags into the index.html content.
 * This is used for server-side SEO/Share preview support.
 */
export function injectMetaTags(html: string, meta: Partial<MetaTags>): string {
  const finalMeta = { ...DEFAULT_META, ...meta };
  const origin = meta.origin || '';
  
  // Construct absolute image URL for the right-side OG image
  let imageUrl = finalMeta.image;
  if (imageUrl && imageUrl.startsWith('/') && origin) {
    imageUrl = `${origin}${imageUrl}`;
  }
  
  // Construct absolute icon URL for the top-left logo
  // The user wants to use the service-cms transparent logo as the site logo
  const iconUrl = origin ? `${origin}/servicecms-transp_icon.png` : '/servicecms-transp_icon.png';
  
  const tags = [
    `<title>${escapeHtml(finalMeta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(finalMeta.description || '')}" />`,
    `<meta property="og:title" content="${escapeHtml(finalMeta.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(finalMeta.description || '')}" />`,
    `<meta property="og:type" content="${escapeHtml(finalMeta.type || 'website')}" />`,
    `<meta property="og:site_name" content="Pluracon Service" />`,
    // Inject the favicon replacement here too
    `<link rel="icon" type="image/png" href="${escapeHtml(iconUrl)}" />`,
    `<link rel="shortcut icon" href="${escapeHtml(iconUrl)}" />`,
  ];

  if (imageUrl) {
    tags.push(`<meta property="og:image" content="${escapeHtml(imageUrl)}" />`);
    tags.push(`<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`);
    tags.push(`<meta name="twitter:card" content="summary_large_image" />`);
  } else {
    // If no image, use a standard summary card (logo might still show in some previewers)
    tags.push(`<meta name="twitter:card" content="summary" />`);
  }

  if (finalMeta.url) {
    tags.push(`<meta property="og:url" content="${escapeHtml(finalMeta.url)}" />`);
  }

  tags.push(`<meta name="twitter:title" content="${escapeHtml(finalMeta.title)}" />`);
  tags.push(`<meta name="twitter:description" content="${escapeHtml(finalMeta.description || '')}" />`);

  const headContent = tags.join('\n    ');

  // Replace default title, description, and favicon if they exist
  let processedHtml = html;
  
  processedHtml = processedHtml.replace(/<title>.*?<\/title>/gi, '');
  processedHtml = processedHtml.replace(/<meta\s+name=["']description["']\s+content=["'].*?["']\s*\/?>/gi, '');
  processedHtml = processedHtml.replace(/<link\s+rel=["'](?:shortcut\s+)?icon["'].*?\/?>/gi, '');
  
  // Insert new tags
  return processedHtml.replace('</head>', `    ${headContent}\n  </head>`);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
