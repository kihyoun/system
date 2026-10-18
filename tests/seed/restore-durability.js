'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {test}=require('node:test');
const {markRestore,finishRestore}=require('../../system/seed-manifest');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'restore-durable-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));for(const name of ['srv/gitlab/data','ssl','letsencrypt','source'])fs.mkdirSync(path.join(root,name),{recursive:true});const source=path.join(root,'source');fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({entries:['srv','srv/gitlab','srv/gitlab/data','ssl','letsencrypt'].map(path=>({path,type:'directory'}))}));return {root,source,srv:path.join(root,'srv'),ssl:path.join(root,'ssl'),certbot:path.join(root,'letsencrypt'),marker:path.join(root,'srv/gitlab/data/.system-bootstrapper-restore-incomplete')};}
function observe(events,fail){return {...fs,fsyncSync(descriptor){const type=fs.fstatSync(descriptor).isDirectory()?'directory':'file';events.push(type);if(fail&&fail(events,type))throw Error('fixture-storage-sync-failed');return fs.fsyncSync(descriptor);},unlinkSync(name){events.push('unlink-marker');return fs.unlinkSync(name);}};}
test('restore marker file and parent are durable before mark returns',t=>{const f=fixture(t),events=[];markRestore(f.srv,observe(events));assert.deepEqual(events,['file','directory']);assert(fs.existsSync(f.marker));});
test('marker file or parent sync failure aborts the pre-copy barrier',t=>{for(const failed of ['file','directory']){const f=fixture(t),events=[];assert.throws(()=>markRestore(f.srv,observe(events,(_events,type)=>type===failed)),/storage-sync-failed/);assert(fs.existsSync(f.marker));}});
test('all restored directories sync before marker removal and its parent syncs afterwards',t=>{const f=fixture(t),events=[];markRestore(f.srv);finishRestore(f.source,f.srv,f.ssl,f.certbot,observe(events));assert.deepEqual(events,['directory','directory','directory','directory','directory','unlink-marker','directory']);assert(!fs.existsSync(f.marker));});
test('destination directory sync failure retains the incomplete restore marker',t=>{const f=fixture(t),events=[];markRestore(f.srv);assert.throws(()=>finishRestore(f.source,f.srv,f.ssl,f.certbot,observe(events,()=>true)),/storage-sync-failed/);assert(fs.existsSync(f.marker));assert(!events.includes('unlink-marker'));});
