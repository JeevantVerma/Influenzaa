// Small HTML helpers shared by discovery sources and the website contact finder.

export const decode = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

function metaContent(html, attr, value) {
  const re = new RegExp(`<meta\\b[^>]*${attr}\\s*=\\s*["']${value}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  return tag ? decode(/content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]) : '';
}

/** Title, site name, description and first heading of an HTML page. */
export function pageMeta(html) {
  const h = String(html || '');
  return {
    title: decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1]).slice(0, 300),
    siteName: (metaContent(h, 'property', 'og:site_name') || metaContent(h, 'name', 'application-name')).slice(0, 120),
    description: (metaContent(h, 'name', 'description') || metaContent(h, 'property', 'og:description')).slice(0, 500),
    h1: decode(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(h)?.[1]?.replace(/<[^>]+>/g, ' ')).slice(0, 200),
  };
}

/** Visible text of a page (scripts, styles and tags removed), capped. */
export function pageText(html, max = 15_000) {
  return decode(
    String(html || '')
      .replace(/<(script|style|noscript|svg|nav|footer|header)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).slice(0, max);
}

