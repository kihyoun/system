import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { requireValue } from '../host/install';

interface Heading {
  offset: number;
  level: number;
  title: string;
  anchor: string;
}
interface Chapter {
  id: string;
  title: string;
  group: string;
  source: string;
  sourceStart?: number;
  markdown: string;
  prerequisite: string;
  outcome: string;
  headings: Omit<Heading, 'offset'>[];
}
type Section = [string, string, string, string, string];
interface Catalog {
  gettingStarted: Chapter;
  foundations: Chapter;
  meta: Section[];
  guides: [string, string, string, string][];
  contexts: Record<string, [string, string]>;
}
export interface DocumentationBundle {
  chapters: Chapter[];
  sources: Record<string, string>;
  images: Record<string, string>;
}

export function documentationHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [],
    counts = new Map<string, number>();
  let fence: string | undefined,
    offset = 0;
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line);
    if (marker) {
      const character = marker[1][0];
      fence = fence === character ? undefined : (fence ?? character);
    }
    const match = fence === undefined ? /^(#{1,6}) (.+?)\s*$/.exec(line) : null;
    if (match) {
      const base = match[2]
        .toLowerCase()
        .replaceAll('`', '')
        .replace(/[^\p{L}\p{N}_\- ]/gu, '')
        .replaceAll(' ', '-');
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      headings.push({
        offset,
        level: match[1].length,
        title: match[2],
        anchor: base + (count ? `-${count}` : ''),
      });
    }
    offset += line.length;
  }
  return headings;
}

/** Bundle source guides without rendering, trimming or rewriting their Markdown. */
@Injectable()
export class DocumentationExportService {
  build(root: string): DocumentationBundle {
    const catalog = this.catalog(root),
      chapters: Chapter[] = [catalog.gettingStarted],
      sources: Record<string, string> = {},
      images: Record<string, string> = {};
    const add = (
      filename: string,
      [id, title, group, prerequisite, outcome]: Section,
      start = 0,
      end?: number,
    ) => {
      const pathname = path.resolve(root, filename),
        raw = fs.readFileSync(pathname, 'utf8'),
        markdown = raw.slice(start, end);
      sources[filename] = createHash('sha256').update(raw).digest('hex');
      chapters.push({
        id,
        title,
        group,
        source: filename,
        // Preserve the established source index's Unicode code-point offsets.
        sourceStart: [...raw.slice(0, start)].length,
        markdown,
        prerequisite,
        outcome,
        headings: documentationHeadings(markdown).map(({ title, anchor, level }) => ({
          title,
          anchor,
          level,
        })),
      });
      for (const match of markdown.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = path.resolve(path.dirname(pathname), match[1]);
        if (!fs.existsSync(target)) continue;
        const resolved = fs.realpathSync(target),
          relative = path.relative(root, resolved);
        if (
          relative === '..' ||
          relative.startsWith('..' + path.sep) ||
          path.isAbsolute(relative) ||
          !fs.statSync(resolved).isFile()
        )
          continue;
        const mime = path.extname(resolved) === '.png' ? 'image/png' : 'image/jpeg';
        images[relative.split(path.sep).join('/')] =
          `data:${mime};base64,` + fs.readFileSync(resolved).toString('base64');
      }
    };
    const handbook = fs.readFileSync(path.join(root, 'docs/HANDBOOK.md'), 'utf8'),
      sections = documentationHeadings(handbook).filter((heading) => heading.level <= 2);
    requireValue(
      sections.length === catalog.meta.length,
      'documentation-handbook-catalog-mismatch',
    );
    sections.forEach((section, index) =>
      add('docs/HANDBOOK.md', catalog.meta[index], section.offset, sections[index + 1]?.offset),
    );
    chapters.splice(5, 0, catalog.foundations);
    for (const [filename, id, title, group] of catalog.guides) {
      const [prerequisite, outcome] = catalog.contexts[id];
      add(filename, [id, title, group, prerequisite, outcome]);
    }
    const order = (chapter: Chapter) => {
      const match = /^(\d+)(?:\.(\d+))?/.exec(chapter.title)!;
      return [Number(match[1]), match[2] === undefined ? -1 : Number(match[2])];
    };
    chapters.sort((a, b) => {
      const left = order(a),
        right = order(b);
      return left[0] - right[0] || left[1] - right[1];
    });
    return { chapters, sources, images };
  }

  export(root: string, check = false): number {
    const content = this.build(root),
      output = path.join(root, 'wizard/src/docs/content.json'),
      graph = fs.readFileSync(path.join(root, 'bootstrapper/upgrade-paths.json')),
      graphOutput = path.join(root, 'wizard/src/docs/upgrade-paths.json'),
      serialized = JSON.stringify(content, null, 2) + '\n';
    if (check) {
      requireValue(
        fs.existsSync(output) && fs.readFileSync(output, 'utf8') === serialized,
        'Wizard docs are stale. Run node docs/export-wizard-docs.js and commit the generated content.',
      );
      requireValue(
        fs.existsSync(graphOutput) && fs.readFileSync(graphOutput).equals(graph),
        'Wizard migration metadata is stale. Regenerate the bundled documentation.',
      );
    } else {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, serialized);
      fs.writeFileSync(graphOutput, graph);
    }
    return content.chapters.length;
  }

  private catalog(root: string): Catalog {
    const value: unknown = JSON.parse(
      fs.readFileSync(path.join(root, 'docs/wizard-docs-catalog.json'), 'utf8'),
    );
    requireValue(
      !!value && typeof value === 'object' && !Array.isArray(value),
      'invalid-documentation-catalog',
    );
    const row = value as Record<string, unknown>;
    const strings = (input: unknown, count: number) =>
      Array.isArray(input) &&
      input.length === count &&
      input.every((value) => typeof value === 'string' && value.length > 0);
    for (const key of ['gettingStarted', 'foundations']) {
      const chapter = row[key] as Record<string, unknown> | undefined;
      requireValue(
        !!chapter &&
          typeof chapter === 'object' &&
          ['id', 'title', 'group', 'source', 'prerequisite', 'outcome', 'markdown'].every(
            (name) => typeof chapter[name] === 'string',
          ) &&
          Array.isArray(chapter.headings) &&
          chapter.headings.length === 0,
        'invalid-documentation-introduction',
      );
    }
    requireValue(
      Array.isArray(row.meta) &&
        row.meta.every((value) => strings(value, 5)) &&
        Array.isArray(row.guides) &&
        row.guides.every((value) => strings(value, 4)) &&
        !!row.contexts &&
        typeof row.contexts === 'object' &&
        !Array.isArray(row.contexts),
      'invalid-documentation-sections',
    );
    const contexts = row.contexts as Record<string, unknown>,
      identifiers = new Set<string>(['getting-started', 'foundations']);
    for (const section of [...(row.meta as string[][]), ...(row.guides as string[][])]) {
      const isGuide = section.length === 4,
        id = section[isGuide ? 1 : 0],
        title = section[isGuide ? 2 : 1];
      requireValue(
        !identifiers.has(id) && /^\d+(?:\.\d+)?[ .]/.test(title),
        'invalid-documentation-section-identity',
      );
      identifiers.add(id);
      if (isGuide)
        requireValue(
          /^[A-Za-z0-9_.\/-]+\.md$/.test(section[0]) &&
            !section[0].split('/').includes('..') &&
            strings(contexts[id], 2),
          'invalid-documentation-guide',
        );
    }
    return value as Catalog;
  }
}
