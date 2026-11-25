import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import console from 'node:console';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const documentationLocales = ['de', 'ko'];
const languageNames = {de: 'German', ko: 'Korean'};
const hangul = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/gu;

export function structure(markdown) {
  const code = [], headings = [], links = [], inline = [], tables = [];
  const prose = [];
  let fence = '', block = '';
  for (const line of markdown.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      block += line;
      if (marker?.[0] === fence[0] && marker.length >= fence.length) { code.push(block); block = ''; fence = ''; }
    } else if (marker) { fence = marker; block = line; }
    else {
      prose.push(line);
      const heading = /^(#{1,6}) (.+?)\s*$/.exec(line);
      if (heading) headings.push(heading[1].length);
      for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) links.push(match[1]);
      if (/^\s*\|/.test(line)) tables.push((line.match(/(?<!\\)\|/g) ?? []).length);
    }
  }
  if (fence) throw new Error('Documentation contains an unclosed fenced code block.');
  for (const match of prose.join('').matchAll(/(?<!`)(`+)([^`]*?)\1(?!`)/g)) inline.push(match[2]);
  return { code, headings, links, inline, tables };
}

export function compile(directory = root, locale = 'de') {
  if (!documentationLocales.includes(locale)) throw new Error('Unsupported documentation locale.');
  const language = languageNames[locale];
  const content = JSON.parse(fs.readFileSync(path.join(directory, 'src/docs/content.json'), 'utf8'));
  const sources = JSON.parse(fs.readFileSync(path.join(directory, 'src/docs/locales', locale, 'sources.json'), 'utf8'));
  const chapters = {};
  if (Object.keys(sources).sort().join() !== content.chapters.map(chapter => chapter.id).sort().join())
    throw new Error(`${language} documentation must cover the complete English chapter catalog.`);
  for (const chapter of content.chapters) {
    const sourceSha256 = hash(chapter.markdown);
    if (sources[chapter.id] !== sourceSha256) throw new Error(`Review the ${language} translation of ${chapter.id} after its English source changed.`);
    const markdown = fs.readFileSync(path.join(directory, 'src/docs/locales', locale, chapter.id + '.md'), 'utf8');
    const original = structure(chapter.markdown), translated = structure(markdown);
    for (const key of ['code', 'headings', 'links', 'inline', 'tables']) {
      if (JSON.stringify(original[key]) !== JSON.stringify(translated[key]))
        throw new Error(`${language} ${chapter.id} must preserve every code block, heading level and link target (${key}).`);
    }
    // Hangul syllables occupy two display cells and express more than one
    // Latin character. Apply the same coverage floor in display units rather
    // than requiring Korean prose to be padded to an English byte length.
    const translatedLength = markdown.trim().length + (locale === 'ko' ? [...markdown.matchAll(hangul)].length : 0);
    const prose = markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '').replace(/`[^`]*`|\]\([^)]+\)/g, '');
    if (translatedLength < chapter.markdown.trim().length * .6 || markdown === chapter.markdown ||
        locale === 'ko' && !/[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u.test(prose))
      throw new Error(`A complete ${language} translation is required for ${chapter.id}.`);
    chapters[chapter.id] = { sourceSha256, markdown };
  }
  return { version: 1, chapters };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const results = documentationLocales.map(locale => ({locale, result: JSON.stringify(compile(root, locale), null, 2) + '\n'}));
    for (const {locale, result} of results) {
      const output = path.join(root, 'src/docs/locales', locale + '.json');
      if (process.argv.includes('--check')) {
        if (fs.readFileSync(output, 'utf8') !== result) throw new Error(`Compile the reviewed ${languageNames[locale]} documentation with npm run docs:compile.`);
        console.log(`${languageNames[locale]} documentation matches all English source hashes; commands, structure and links are preserved.`);
      } else { fs.writeFileSync(output, result); console.log(`Compiled complete ${languageNames[locale]} documentation.`); }
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
