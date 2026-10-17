const fs=require('fs'),cp=require('child_process'),assert=require('assert');
const root='C:/Users/kihyo/Documents/Codex/2026-10-16/kja/work/component-test-ci';
const before=cp.execFileSync('git',['show','HEAD:.gitlab-ci.yml'],{cwd:root});
const after=cp.execFileSync('git',['show',':.gitlab-ci.yml'],{cwd:root});
assert(before.subarray(0,1184).equals(after.subarray(0,1184)));
const manifest=JSON.parse(fs.readFileSync(root+'/tests/manifest.json'));
assert.equal(manifest.length,18);
for(const row of manifest){assert(fs.existsSync(root+'/tests/'+row.file));assert(!row.file.includes('/live/'));}
assert.equal(new Set(manifest.map(row=>row.file)).size,18);
assert(manifest.some(row=>row.file==='gitlab/source-import.rb'));
assert(!fs.existsSync(root+'/tests/wizard/source-import.rb'));
fs.writeFileSync(root+'/test-results/original-integrated-ci.yml',before);
console.log('PASS: immutableCI prefix, 18 unique existing isolated manifest paths, Ruby component move.');
