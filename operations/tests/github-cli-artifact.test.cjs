'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {acceptedCliArtifact}=require('../dist/release/github-cli-artifact');
const {hash,integrity}=require('../dist/release/npm-identity');
test('bootstrap CLI receipt binds exact successful package source and immutable bytes',()=>{
 const bytes=Buffer.from('tested artifact'),expected={version:'2.0.0',sourceRevision:'a'.repeat(40),sourceTree:'b'.repeat(40),pipelineId:10,packageJobId:42};
 const receipt={format:'system-cli-source-v1',name:'@systembootstrapper/cli',...expected,filename:'systembootstrapper-cli-2.0.0.tgz',sha256:hash(bytes),integrity:integrity(bytes)};
 assert.deepEqual(acceptedCliArtifact(receipt,bytes,expected),receipt);
 for(const patch of [{packageJobId:43},{pipelineId:11},{sourceRevision:'c'.repeat(40)},{sourceTree:'d'.repeat(40)},{version:'2.0.1'},{sha256:'e'.repeat(64)},{integrity:integrity(Buffer.from('other'))},{url:'https://untrusted.test/artifact'}])assert.throws(()=>acceptedCliArtifact({...receipt,...patch},bytes,expected));
 assert.throws(()=>acceptedCliArtifact(receipt,Buffer.from('replacement'),expected));
});
