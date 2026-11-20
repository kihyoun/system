'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('public tarball carries compiled CLI and offline validation assets without private or checkout files',()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bootstrapper-package-'));
  try {
    const [record]=JSON.parse(execFileSync('npm',['pack','--json','--ignore-scripts','--pack-destination',temporary],{cwd:root,encoding:'utf8'}));
    const files=record.files.map(file=>file.path);
    for(const required of ['dist/cli.js','dist/index.js','dist/storage/entry.js','assets/project-bootstrap/preview-setup/settings.js','README.md','LICENSE'])assert(files.includes(required),required);
    assert(files.every(file=>/^(?:dist\/|assets\/|README.md$|LICENSE$|package.json$)/.test(file)));
    assert(!files.some(file=>/(?:^|\/)(?:node_modules|\.env|\.npmrc|private|tests)(?:\/|$)/.test(file)));
    execFileSync('tar',['-xzf',path.join(temporary,record.filename),'-C',temporary]);
    const unpacked=path.join(temporary,'package');
    const metadata=JSON.parse(fs.readFileSync(path.join(unpacked,'package.json')));
    for(const script of ['preinstall','install','postinstall','prepare'])assert.equal(metadata.scripts[script],undefined);
    assert.equal(metadata.bin['system-bootstrapper'],'dist/cli.js');
    const version=execFileSync(process.execPath,[path.join(unpacked,'dist/cli.js'),'--version'],{encoding:'utf8',env:{PATH:'/missing',HOME:temporary}}).trim();
    assert.equal(version,metadata.version);
    const installed=path.join(temporary,'installed'); fs.mkdirSync(installed);
    execFileSync('npm',['install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',installed,path.join(temporary,record.filename)],{cwd:temporary,stdio:'pipe'});
    const installedCli=path.join(installed,'node_modules/.bin/system-bootstrapper');
    assert.equal(execFileSync(process.execPath,[installedCli,'--version'],{encoding:'utf8'}).trim(),metadata.version);
    const api=require(path.join(installed,'node_modules/@systembootstrapper/cli'));
    assert.equal(typeof api.StorageModule.register,'function');
    assert.equal(typeof api.StorageService,'function');
    const adapter=require(path.join(unpacked,'dist/runtime/preview-settings.js'));
    assert.equal(adapter.normalizePreview({version:2,namespace:'example',wizard:{mode:'existing',project:'system'},review:{enabled:false,host:'',ssl:'',sslKey:''},beta:{enabled:false,host:'',ssl:'',sslKey:''}}).version,2);
  } finally {fs.rmSync(temporary,{recursive:true,force:true});}
});
