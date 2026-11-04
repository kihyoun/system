#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {execFileSync}=require('child_process');
const {validate}=require('../../project-bootstrap/wizard-source/package');
const root=path.resolve(__dirname,'../..');
const securityRelease=require('../../gitlab/security-release.json');
const trust=require('../../bootstrapper/ca/check');
const defaults={
  daemon:'docker:29.9.2-dind@sha256:9e79b879b177fbd72c34376a3dd3d91747da5db49e1f560f76aea59561471977',
  gitlab:securityRelease.toImage,
  previousGitlab:securityRelease.fromImage,
  runner:securityRelease.runner.toImage,
  previousRunner:securityRelease.runner.fromImage,
  previousHelper:securityRelease.runner.fromHelperImage,
  nginx:'nginx@sha256:332d0beea97cff8c0d5d27976c0778a4b00345b9d74c2feaaf8efde548314948',
  helper:securityRelease.runner.helperImage
};
function identifiers(env=process.env){
  if(!/^\d+$/.test(env.CI_PROJECT_ID||'')||!/^\d+$/.test(env.CI_JOB_ID||'')||!(/^[a-f0-9]{40}$/.test(env.CI_COMMIT_SHA||'')))throw Error('Valid CI source and job identifiers required.');
  const suffix=env.CI_PROJECT_ID+'-'+env.CI_JOB_ID;
  return {candidate:'system-platform-candidate:ci-'+suffix,wizard:'system-platform-wizard:ci-'+suffix};
}
function privateWizardAcceptance(files,exists=filename=>fs.existsSync(path.join(root,filename))) {
  const helpers=["system/ensure-wizard-image.sh","system/wizard-image-recovery.js","system/wizard-registry-token.rb"];
  if(!helpers.some(filename=>files.includes(filename)))return false;
  if(!helpers.every(filename=>files.includes(filename))||!exists("tests/e2e/recovery.js")||!exists("tests/e2e/wizard-pin-fixture.js"))throw Error("Private Wizard startup requires the complete private-registry recovery contract.");
  return true;
}
function acmeAcceptance(files,exists=filename=>fs.existsSync(path.join(root,filename))) {
  const adapter=['tests/e2e/local-acme.js','tests/e2e/prepare-acme-images.js','tests/e2e/acme-fixture/pebble.minica.pem'];
  const host=['bootstrapper/certbot-with-volume-lock.sh','bootstrapper/install-volume-certificate.sh','bootstrapper/rebind-renewal.py'];
  if(!adapter.some(exists))return false;
  if(!adapter.every(exists)||!host.every(filename=>files.includes(filename)))throw Error('ACME acceptance requires the complete pinned authority and fresh-source host contract.');
  return true;
}
function verifyPreparedTrust(tags,execute=execFileSync){
  for(const [role,reference,file] of [
    ['candidate',tags.candidate,'/etc/ssl/certs/ca-certificates.crt'],
    ['wizard',tags.wizard,'/etc/ssl/certs/ca-certificates.crt'],
    ['runner',defaults.runner,'/etc/ssl/certs/ca-certificates.crt'],
    ['helper',defaults.helper,'/etc/ssl/certs/ca-certificates.crt'],
    ['daemon',defaults.daemon,'/etc/ssl/certs/ca-certificates.crt'],
    ['gitlab',defaults.gitlab,'/opt/gitlab/embedded/ssl/certs/cacert.pem']
  ]){
    const bundle=execute('docker',['run','--rm','--network','none','--label','org.system-bootstrapper.test-job='+process.env.CI_JOB_ID,'--entrypoint','cat',reference,file],{encoding:'utf8',timeout:60000});
    if(trust.check(trust.certificates(bundle))<50)throw Error('Incomplete prepared '+role+' CA trust.');
  }
}
function prepare(){
  if(process.arch!=='x64'||process.platform!=='linux')throw Error('Current pinned candidate images require Linux amd64.');
  const tags=identifiers();
  const output=path.join(root,'.candidate-images');fs.mkdirSync(output,{recursive:true,mode:0o700});
  const manifest=path.join(root,'.candidate-context');
  if(fs.readFileSync(path.join(manifest,'revision'),'utf8').trim()!==process.env.CI_COMMIT_SHA)throw Error('Candidate context revision mismatch.');
  const archive=path.join(manifest,'context.tar');
  if(crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')!==fs.readFileSync(path.join(manifest,'sha256'),'utf8').trim())throw Error('Candidate context checksum mismatch.');
  const trackedManifest=JSON.parse(fs.readFileSync(path.join(manifest,'manifest.json'),'utf8'));
  const recoveryAcceptance=trackedManifest.files.includes('system/seed-manifest.js');
  const privateWizardRecovery=privateWizardAcceptance(trackedManifest.files);
  const acmeRenewalAcceptance=acmeAcceptance(trackedManifest.files);
  if(acmeRenewalAcceptance&&!recoveryAcceptance)throw Error('ACME acceptance requires marked Seed recovery.');
  if(privateWizardRecovery&&!recoveryAcceptance)throw Error('Private Wizard recovery requires marked Seed recovery.');
  if(recoveryAcceptance&&!fs.existsSync(path.join(__dirname,'recovery.js')))throw Error('Marked Seed requires the complete cold recovery adapter.');
  const run=(args,options={})=>execFileSync('docker',args,{stdio:'inherit',timeout:600000,...options});
  let fd=fs.openSync(archive,'r');
  try{run(['build','--provenance=false','--sbom=false','--label','org.opencontainers.image.revision='+process.env.CI_COMMIT_SHA,'--label','org.system-bootstrapper.test-job='+process.env.CI_JOB_ID,'-f','system/Dockerfile','-t',tags.candidate,'-'],{stdio:[fd,'inherit','inherit']});}finally{fs.closeSync(fd);}
  run(['pull',defaults.nginx]);
  require('../persistence/http01-nginx-probe').run({helperImage:tags.candidate,nginxImage:defaults.nginx});
  const snapshot=validate(JSON.parse(fs.readFileSync(path.join(root,'project-bootstrap/wizard-source/snapshot.json'),'utf8')));
  const context=path.join(output,'wizard-context');fs.mkdirSync(context,{recursive:true});
  for(const file of snapshot.files){const name=path.join(context,file.path);fs.mkdirSync(path.dirname(name),{recursive:true});fs.writeFileSync(name,Buffer.from(file.content,'base64'),{mode:file.mode==='100755'?0o755:0o644});}
  const recipes=require('../../project-bootstrap/wizard-build/recipe');
  const logo=fs.readFileSync(path.join(root,'system/.docker.env.example'),'utf8').slice(0,1184);
  const recipe=recipes.forSource?recipes.forSource(logo,snapshot.sourceRevision):recipes.generate(logo);
  const buildFiles=recipe.files;
  if(buildFiles.filter(file=>/\/Dockerfile(?:\.dockerignore)?$/.test(file.path)).length!==2)throw Error('Complete managed Wizard Docker recipe required.');
  for(const file of buildFiles){const filename=path.join(context,file.path);fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,file.content);}
  run(['build','--label','org.system-bootstrapper.test-job='+process.env.CI_JOB_ID,
    '-f',path.join(context,'.system-bootstrapper/build-v1/Dockerfile'),'-t',tags.wizard,context]);
  let configurationExporter;
  if(recoveryAcceptance){
    const filename=path.join(output,'export-configuration.cjs');const descriptor=fs.openSync(filename,'wx',0o600);
    try{run(['run','--rm','--network','none','--entrypoint','cat',tags.wizard,'/opt/system-bootstrapper/test-tools/export-configuration.cjs'],{stdio:['ignore',descriptor,'inherit']});}finally{fs.closeSync(descriptor);}
    configurationExporter={archive:filename,sha256:crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'),sourceRevision:snapshot.sourceRevision};
    require('../persistence/native-restore-docker').run({helperImage:tags.candidate,configurationExporter});
  }
  for(const image of Object.values(defaults))run(['pull',image]);
  verifyPreparedTrust(tags);
  const images={};
  for(const [role,reference] of Object.entries({...tags,...Object.fromEntries(Object.entries(defaults).filter(([role])=>role!=='daemon'))})){
    const id=execFileSync('docker',['image','inspect','--format','{{.Id}}',reference],{encoding:'utf8'}).trim();
    if(!/^sha256:[a-f0-9]{64}$/.test(id))throw Error('Invalid inspected image identity.');
    const filename=path.join(output,role+'.tar');run(['image','save','--output',filename,reference]);images[role]={id,archive:filename};
  }
  const acmeImages=acmeRenewalAcceptance?require('./prepare-acme-images').prepare(output):undefined;
  if(acmeRenewalAcceptance)require('./local-acme').validate({acmeImages});
  const spec={sourceRevision:process.env.CI_COMMIT_SHA,configurationExporter,recoveryAcceptance,privateWizardRecovery,acmeRenewalAcceptance,acmeImages,daemonImage:defaults.daemon,images:Object.fromEntries(Object.entries(images).filter(([role])=>!['helper','previousGitlab','previousRunner','previousHelper'].includes(role))),
    supportImages:{helper:images.helper,previousGitlab:images.previousGitlab,previousRunner:images.previousRunner,previousHelper:images.previousHelper},gitlabUpgradeAcceptance:true,fullAcceptance:true,readinessMilliseconds:600000};
  fs.writeFileSync(path.join(output,'spec.json'),JSON.stringify(spec,null,2)+'\n',{mode:0o600});
  console.log('Prepared pinned full-platform candidate images for '+process.env.CI_COMMIT_SHA);
}
module.exports={defaults,identifiers,privateWizardAcceptance,acmeAcceptance,verifyPreparedTrust};
if(require.main===module){try{prepare();}catch{console.error('Candidate image preparation failed; see public build log.');process.exitCode=1;}}
