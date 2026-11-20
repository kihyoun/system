import content from './content.json';
import german from './locales/de.json';
import korean from './locales/ko.json';
import { translate, type Locale } from '../i18n';

export type Chapter = { id: string; title: string; group: string; source: string; sourceStart?: number;
  prerequisite: string; outcome: string; markdown: string; headings: { title: string; anchor: string; level: number }[] };
export const chapters: Chapter[] = content.chapters;
export const images: Record<string, string> = content.images;
type Translation = { sourceSha256: string; markdown: string };
const translations: Record<'de' | 'ko', Record<string, Translation>> = { de: german.chapters, ko: korean.chapters };

export function headingSlug(text: string): string {
  return text.toLowerCase().replace(/`/g, '').replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');
}

export function markdownHeadings(markdown: string) {
  const result: { title: string; anchor: string; level: number; offset: number }[] = [];
  const counts = new Map<string, number>();
  let fence = '', offset = 0;
  for (const line of markdown.split(/(?<=\n)/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]?.[0];
    if (marker) fence = fence === marker ? '' : fence || marker;
    const heading = !fence && /^(#{1,6}) (.+?)\s*$/.exec(line);
    if (heading) {
      const base = headingSlug(heading[2]), count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      result.push({ title: heading[2], anchor: base + (count ? `-${count}` : ''), level: heading[1].length, offset });
    }
    offset += line.length;
  }
  return result;
}

function translatedChapters(locale: 'de' | 'ko'): Chapter[] {
  return chapters.map(chapter => {
    // Catalog compilation guarantees complete translations for every chapter.
    const markdown = translations[locale][chapter.id].markdown;
    const original = chapter.headings.length ? chapter.headings : markdownHeadings(chapter.markdown);
    const headings = markdownHeadings(markdown).map((heading, index) => ({ ...heading, anchor: original[index]?.anchor ?? heading.anchor }));
    return { ...chapter, title: translate(chapter.title, locale), group: translate(chapter.group, locale),
      prerequisite: translate(chapter.prerequisite, locale), outcome: translate(chapter.outcome, locale), markdown, headings };
  });
}

const catalogs: Record<Locale, Chapter[]> = { en: chapters, de: translatedChapters('de'), ko: translatedChapters('ko') };

export function localizedChapters(locale: Locale): Chapter[] { return catalogs[locale]; }

export function docsLocation(hash = window.location.hash, catalog: Chapter[] = chapters): { chapter: Chapter; anchor: string } {
  const [, id, ...anchor] = hash.split('/');
  let decodedAnchor = '';
  try { decodedAnchor = decodeURIComponent(anchor.join('/')); } catch { /* Ignore malformed browser fragments. */ }
  return { chapter: catalog.find(chapter => chapter.id === id) ?? catalog[0], anchor: decodedAnchor };
}

export function docsHref(id: string, anchor = ''): string {
  return `#docs/${id}${anchor ? `/${encodeURIComponent(anchor)}` : ''}`;
}

function repositoryPath(href: string, source: string): { path: string; anchor: string } | undefined {
  if (href.startsWith('#docs/')) return undefined;
  const remote = href.match(/^https:\/\/github\.com\/kihyoun\/system\/blob\/master\/(.*)$/);
  if (!remote && /^[a-z][a-z\d+.-]*:/i.test(href)) return undefined;
  const [file, anchor = ''] = (remote?.[1] ?? href).split('#');
  const base = new URL(remote ? '/' : source, 'https://docs.invalid/');
  return { path: new URL(file || source.split('/').at(-1)!, base).pathname.slice(1), anchor: decodeURIComponent(anchor) };
}

export function resolveDocLink(href: string, current: Chapter): string {
  if (href.startsWith('#docs/')) return href;
  const target = repositoryPath(href, current.source);
  if (!target) return href;
  const candidates = chapters.filter(chapter => chapter.source === target.path);
  const chapter = candidates.find(chapter => chapter.headings.some(heading => heading.anchor === target.anchor)) ?? candidates[0];
  if (chapter) return docsHref(chapter.id, target.anchor);
  return `https://github.com/kihyoun/system/blob/master/${target.path}${target.anchor ? `#${target.anchor}` : ''}`;
}

export function resolveDocImage(src: string, current: Chapter): string | undefined {
  const target = repositoryPath(src, current.source);
  return target ? images[target.path] : undefined;
}

export function plainText(markdown: string): string {
  return markdown.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`#*>|]/g, '').replace(/\s+/g, ' ').trim();
}

export function searchDocs(query: string, catalog: Chapter[] = chapters) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return catalog.flatMap(chapter => {
    const text = plainText(chapter.markdown);
    const haystack = `${chapter.title} ${text}`.toLowerCase();
    if (!terms.every(term => haystack.includes(term))) return [];
    const start = Math.max(0, text.toLowerCase().indexOf(terms[0]) - 75);
    const markdownIndex = chapter.markdown.toLowerCase().indexOf(terms[0]);
    const previousHeadings = chapter.headings.filter(heading => chapter.markdown.indexOf(heading.title) <= markdownIndex);
    return [{ chapter, snippet: `${start ? '…' : ''}${text.slice(start, start + 240)}${start + 240 < text.length ? '…' : ''}`, anchor: previousHeadings.at(-1)?.anchor ?? '' }];
  });
}

/** Prompted transcripts copy only commands; ordinary shell fences already contain commands. */
export function copyableCode(code: string, language: string): string | undefined {
  const lines = code.trimEnd().split('\n');
  const prompt = /^(?:\$ |PS [^>]*> )/;
  if (lines.some(line => prompt.test(line))) {
    return lines.filter(line => prompt.test(line) || /^> /.test(line)).map(line => line.replace(/^(?:\$ |PS [^>]*> |> )/, '')).join('\n');
  }
  if (/^(?:bash|sh|shell|powershell|pwsh|json|yaml|yml|ini|dockerfile|python|javascript|typescript|nginx|cron)$/.test(language)) return code.trimEnd();
  return undefined;
}
