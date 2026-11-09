'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const trust=require('../../bootstrapper/ca/check'),release=require('../../gitlab/security-release.json');
const bundle=fs.readFileSync(path.join(__dirname,'../../bootstrapper/ca',trust.provenance.bundle));
assert.equal(crypto.createHash('sha256').update(bundle).digest('hex'),trust.provenance.sha256);
assert.equal(release.jobCaBundleSha256,trust.provenance.sha256);
assert.equal(new Set(trust.provenance.distrustedSha256).size,21);
assert(trust.check(trust.certificates(bundle.toString()))>100);
// Public compromised root from the upstream CNG distrust change, never a key.
const compromised="-----BEGIN CERTIFICATE-----\nMIICKTCCAa+gAwIBAgIQDnYGcvFDRZ/I/gqwvAXjlDAKBggqhkjOPQQDAzBWMQsw\nCQYDVQQGEwJJTjElMCMGA1UECgwcZU11ZGhyYSBUZWNobm9sb2dpZXMgTGltaXRl\nZDEgMB4GA1UEAwwXZW1TaWduIFJvb3QgVExTIENBIC0gRzMwHhcNMjQwMjA4MDgx\nOTMyWhcNNDkwMjA3MDgxOTMyWjBWMQswCQYDVQQGEwJJTjElMCMGA1UECgwcZU11\nZGhyYSBUZWNobm9sb2dpZXMgTGltaXRlZDEgMB4GA1UEAwwXZW1TaWduIFJvb3Qg\nVExTIENBIC0gRzMwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAARfD9w/q1cWxL6D9bMG\nH6CQ4u+gAV6GN9s+PwQx9Bl4hC+0iU8QOk8mWO/RwXQy10DCSxT8vSIJClHKp+Ao\n4qJKdYeV0SwZ7LMQziyLfxIUOY6Grja/sQFwLKYf8EdDXAyjQjBAMB0GA1UdDgQW\nBBThOqshfPHjTVSu1HK3/YtZQiCQVDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0TAQH/\nBAUwAwEB/zAKBggqhkjOPQQDAwNoADBlAjBhCFTkly7Yl7+s4hiw+k6ZJTXT2AiI\nrvmsmfqPr5E7ecwXb6kXA5LTFd6rjwTuV3sCMQC9w6ZSbVq1mveMO6dKFziOzClT\nKCT2RFT6yXtq6nzgRICgBmiXbJAXsmZ8yAwjyWc=\n-----END CERTIFICATE-----\n";
assert.throws(()=>trust.check(trust.certificates(compromised)),/distrusted/);
assert.throws(()=>trust.certificates('no certificates'),/required/);
assert.throws(()=>trust.check([]),/required/);
const proof=trust.system();assert.equal(proof.bundleSha256,trust.provenance.sha256);assert.equal(proof.nodeCaMode,'openssl');
const {spawnSync}=require('node:child_process'),os=require('node:os');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'public-CA-refusal-'));
try{
 const filename=path.join(directory,'distrusted.crt');fs.writeFileSync(filename,compromised);
 const execute=env=>spawnSync(process.execPath,[path.join(__dirname,'../../bootstrapper/ca/check.js')],{env:{...process.env,...env},encoding:'utf8'});
 assert.notEqual(execute({NODE_OPTIONS:'--use-bundled-ca'}).status,0);
 assert.notEqual(execute({NODE_OPTIONS:'--use-openssl-ca',NODE_EXTRA_CA_CERTS:filename}).status,0);
}finally{fs.rmSync(directory,{recursive:true,force:true});}
const {verifyPreparedTrust}=require('../e2e/prepare-images');let calls=0;
verifyPreparedTrust({candidate:'candidate:fixture',wizard:'wizard:fixture'},()=>{calls++;return bundle.toString();});assert.equal(calls,6);
assert.throws(()=>verifyPreparedTrust({candidate:'candidate:fixture',wizard:'wizard:fixture'},()=>bundle.toString()+compromised),/distrusted/);
const recipes=require('../../project-bootstrap/wizard-build/recipe');
const logo=fs.readFileSync(path.join(__dirname,'../../system/.docker.env.example'),'utf8').slice(0,1184);
for(const profile of ['legacy-ca-v4','node24-vite8-ca-v4','node24-vite8-quickstart-v5']){
 const recipe=recipes.generate(logo,profile);assert.deepEqual(recipes.select(logo,recipe.recipeHash),recipe);
 assert(recipe.ci.includes('29.9.2-cli@sha256:'));assert(recipe.ci.includes('before_script:'));
 assert.equal(recipe.files.find(f=>f.path.endsWith('/ca/'+trust.provenance.bundle)).content,bundle.toString());
 for(const file of recipe.files.filter(f=>/\/(?:Dockerfile|Browser\.Dockerfile)$/.test(f.path)))assert(file.content.includes('refresh-ca.sh'));
}
console.log('PASS: pinned public bundle, all21 distrusted fingerprints, positive refusal, effective Node/OpenSSL trust and versioned offline Wizard CA recipes.');
