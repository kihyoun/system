import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Injectable } from '@nestjs/common';
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Error('A complete unique documentation chapter catalog is required.');
  }

  return value as Record<string, unknown>;
}
/** Verifies complete authored Markdown against its bundled, source-indexed chapters. */
@Injectable()
export class DocumentationSourceCheckService {
  check(root: string): number {
    if (
      !fs
        .readFileSync(path.join(root, 'config/releases/upgrade-paths.json'))
        .equals(fs.readFileSync(path.join(root, 'wizard/src/docs/upgrade-paths.json')))
    ) {
      throw Error(
        'Bundled Wizard migration metadata is stale; regenerate from repository sources.',
      );
    }

    const content = record(
        JSON.parse(
          fs.readFileSync(path.join(root, 'wizard/src/docs/content.json'), 'utf8'),
        ) as unknown,
      ),
      sources = record(content.sources);

    if (!Array.isArray(content.chapters) || !Object.keys(sources).length) {
      throw Error('A complete unique documentation chapter catalog is required.');
    }

    const chapters = content.chapters.map(record);

    if (new Set(chapters.map((chapter) => chapter.id)).size !== chapters.length) {
      throw Error('A complete unique documentation chapter catalog is required.');
    }

    for (const [source, expected] of Object.entries(sources)) {
      if (!/^[A-Za-z0-9_.\/-]+\.md$/.test(source) || source.split('/').includes('..')) {
        throw Error('Documentation source must be a repository Markdown path.');
      }

      const raw = fs.readFileSync(path.join(root, source));

      if (crypto.createHash('sha256').update(raw).digest('hex') !== expected) {
        throw Error('Bundled Wizard docs are stale; regenerate from repository sources.');
      }

      const sections = chapters
        .filter((chapter) => chapter.source === source && Number.isInteger(chapter.sourceStart))
        .sort((a, b) => Number(a.sourceStart) - Number(b.sourceStart));

      if (
        !sections.length ||
        sections[0].sourceStart !== 0 ||
        sections.map((chapter) => chapter.markdown).join('') !== raw.toString('utf8')
      ) {
        throw Error('The complete original guide must remain available in Docs.');
      }
    }
    return chapters.length;
  }
}
