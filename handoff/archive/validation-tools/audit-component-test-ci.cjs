const fs=require('fs'),cp=require('child_process'),assert=require('assert'),crypto=require('crypto');
const root='C:/Users/kihyo/Documents/Codex/2026-10-16/kja/work/component-test-ci';
const git=(...args)=>cp.execFileSync('git',args,{cwd:root});
const before=git('show','HEAD:.gitlab-ci.yml');
const staged=git('show',':.gitlab-ci.yml');
assert(before.subarray(0,1184).equals(staged.subarray(0,1184)),'immutable root CI header');
const manifest=JSON.parse(fs.readFileSync(root+'/tests/manifest.json'));
assert(manifest.length===13);
for(const item of manifest){
 assert(!item.file.includes('/live/'));
 assert(fs.existsSync(root+'/tests/'+item.file));
 assert(item.timeoutSeconds>0);
}
assert(new Set(manifest.map(item=>item.file)).size===manifest.length);
const reports=JSON.parse(fs.readFileSync(root+'/test-results/all/results.json'));
assert(reports.results.every(item=>item.status==='passed'));
console.log('PASS: root CI signature prefix byte-identical to base; manifest references unique existing isolated files; all recorded checks passed.');
console.log('Root CI prefix MD5: '+crypto.createHash('md5').update(staged.subarray(0,1184)).digest('hex'));
