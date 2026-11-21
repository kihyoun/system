'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {DocumentationSourceCheckService} = require('../../dist/modules/documentation/documentation-source-check.service');
const checker = new DocumentationSourceCheckService();
const check = directory => checker.check(directory);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-docs-source-'));
try {
  fs.mkdirSync(path.join(root, 'wizard/src/docs'), {recursive: true});
  fs.mkdirSync(path.join(root, 'docs'));
  fs.mkdirSync(path.join(root, 'config/releases'), {recursive: true});
  const graph = '{"format":"system-upgrade-paths-v1","versions":[],"transitions":[]}\n';
  fs.writeFileSync(path.join(root, 'config/releases/upgrade-paths.json'), graph);
  fs.writeFileSync(path.join(root, 'wizard/src/docs/upgrade-paths.json'), graph);
  const text = '# Install\n\n```sh\necho hello\n```\n\n## Configure\nMore details.\n';
  fs.writeFileSync(path.join(root, 'docs/guide.md'), text);
  const split = text.indexOf('## Configure');
  const content = {sources: {'docs/guide.md': crypto.createHash('sha256').update(text).digest('hex')}, chapters: [
    {id: 'installation', source: 'docs/guide.md', sourceStart: 0, markdown: text.slice(0, split)},
    {id: 'configuration', source: 'docs/guide.md', sourceStart: split, markdown: text.slice(split)}]};
  const output = path.join(root, 'wizard/src/docs/content.json');
  const save = data => fs.writeFileSync(output, JSON.stringify(data));
  save(content); assert.equal(check(root), 2);
  fs.writeFileSync(path.join(root, 'wizard/src/docs/upgrade-paths.json'), '{}');
  assert.throws(() => check(root), /migration metadata is stale/);
  fs.writeFileSync(path.join(root, 'wizard/src/docs/upgrade-paths.json'), graph);
  fs.appendFileSync(path.join(root, 'docs/guide.md'), 'Changed\n');
  assert.throws(() => check(root), /stale/);
  fs.writeFileSync(path.join(root, 'docs/guide.md'), text);
  for (const mutate of [
    c => { c.chapters.pop(); }, c => { c.chapters[1].markdown = 'Summary replacing the guide'; },
    c => { c.chapters[0].id = c.chapters[1].id; }, c => { c.sources['../private.md'] = '0'.repeat(64); },
  ]) {
    const changed = structuredClone(content); mutate(changed); save(changed);
    assert.throws(() => check(root));
  }
  console.log('Wizard Docs source drift, complete guide preservation, chapter identity and path boundaries passed.');
} finally { fs.rmSync(root, {recursive: true, force: true}); }

// Keep the former authoring checks in the existing component entry: no extra gate.
const {DocumentationExportService,documentationHeadings}=require('../../dist/modules/documentation/documentation-export.service');
const service=new DocumentationExportService(),checkout=path.resolve(__dirname,'../..'),bundle=service.build(checkout);
const {includedTest:included}=require('../../dist/modules/ci/context-selection');
for(const filename of [...Object.keys(bundle.sources),...Object.keys(bundle.images),'docs/wizard-docs-catalog.json'])assert(included(filename),filename);
assert(!included('docs/private.env'));assert(!included('docs/credentials.json'));
for(const filename of Object.keys(bundle.sources)){
  const chapters=bundle.chapters.filter(chapter=>chapter.source===filename&&Number.isInteger(chapter.sourceStart)).sort((a,b)=>a.sourceStart-b.sourceStart);
  assert.equal(chapters.map(chapter=>chapter.markdown).join(''),fs.readFileSync(path.join(checkout,filename),'utf8'),filename);
}
for(const chapter of bundle.chapters){
  for(const match of chapter.markdown.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)){
    const url=new URL(match[1],'https://docs.invalid/'+chapter.source);
    if(url.origin==='https://docs.invalid'&&url.pathname.endsWith('.md'))
      assert(url.pathname.slice(1) in bundle.sources,`${chapter.source}: ${match[1]}`);
  }
  assert(!/gitlab\.system-bootstrapper\.com|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+/.test(chapter.markdown));
}
assert(Object.keys(bundle.images).length>=8);
assert(!bundle.chapters.flatMap(chapter=>chapter.headings).some(heading=>heading.title.includes('Only for a confirmed failure')));
assert.deepEqual(documentationHeadings('# 한글\n```bash\n# comment\n```\n## 한글\n## 한글\n').map(heading=>heading.anchor),['한글','한글-1','한글-2']);
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'wizard-docs-export-'));
try{
  fs.mkdirSync(path.join(temporary,'docs'),{recursive:true});fs.mkdirSync(path.join(temporary,'config/releases'),{recursive:true});
  const chapter={id:'getting-started',title:'0. Getting Started',group:'Start',source:'docs/HANDBOOK.md',prerequisite:'Prepared host',outcome:'Read guide',headings:[],markdown:'Intro'};
  const catalog={gettingStarted:chapter,foundations:{...chapter,id:'foundations',title:'2. Foundations'},
    meta:[['intro','1. Installation','Install','Host','Running']],guides:[],contexts:{}};
  const catalogPath=path.join(temporary,'docs/wizard-docs-catalog.json');
  fs.writeFileSync(catalogPath,JSON.stringify(catalog));fs.writeFileSync(path.join(temporary,'docs/HANDBOOK.md'),'# Install\n\nText 😀 preserved.\n');
  fs.writeFileSync(path.join(temporary,'config/releases/upgrade-paths.json'),'{}\n');
  assert.throws(()=>service.export(temporary,true),/stale/);
  assert.equal(service.export(temporary),3);assert.equal(service.export(temporary,true),3);
  assert.equal(check(temporary),3);
  fs.appendFileSync(path.join(temporary,'docs/HANDBOOK.md'),'Changed\n');assert.throws(()=>service.export(temporary,true),/stale/);
  fs.appendFileSync(path.join(temporary,'docs/HANDBOOK.md'),'## Unmapped\n');assert.throws(()=>service.build(temporary),/catalog-mismatch/);
  catalog.guides=[['../private.md','private','3. Unsafe','Private']];catalog.contexts.private=['Input','Output'];
  fs.writeFileSync(catalogPath,JSON.stringify(catalog));assert.throws(()=>service.build(temporary),/invalid-documentation-guide/);
}finally{fs.rmSync(temporary,{recursive:true,force:true});}
console.log('Native documentation export preserves full sources, links, images, Unicode anchors and stale-content refusal.');
