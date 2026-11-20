'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
test('targeted proxy setup prepares only the selected application without recreating images or removing siblings', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-proxy-scope-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.symlinkSync(path.resolve(__dirname,'../../operations'),path.join(root,'operations'),'dir');
  for (const directory of ['nginx-proxy/.projects', 'system/.projects.env', 'bin']) fs.mkdirSync(path.join(root, directory), {recursive: true});
  fs.copyFileSync(path.join(__dirname, '../../nginx-proxy/start.sh'), path.join(root, 'nginx-proxy/start.sh'));
  fs.writeFileSync(path.join(root, 'system/.docker.env'), 'NGINX_PROXY_IMAGE="operator-proxy@sha256:' + 'a'.repeat(64) + '"\n');
  for (const key of ['selected', 'unrelated']) fs.writeFileSync(path.join(root, 'system/.projects.env/.' + key + '.env'),
    'PROJECT_NAME=' + key + '\nUSE_PROD_HOST=true\nUSE_BETA_HOST=false\nUSE_REVIEW_HOST=true\n');
  fs.writeFileSync(path.join(root, 'nginx-proxy/.projects/.unrelated.env'), 'unchanged sibling');
  const bin = path.join(root, 'bin'), trace = path.join(root, 'trace');
  fs.writeFileSync(path.join(bin, 'docker-compose'), '#!/bin/sh\nprintf "%s %s\\n" "$NGINX_PROXY_IMAGE" "$*" >> "$TRACE"\n', {mode: 0o755});
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TRACE"\nprintf "172.20.0.2\\n"\n', {mode: 0o755});
  const result = spawnSync('bash', ['start.sh', 'selected'], {cwd: path.join(root, 'nginx-proxy'), encoding: 'utf8', env: {...process.env, PATH: bin + ':' + process.env.PATH, TRACE: trace}});
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(trace, 'utf8');
  assert.match(commands, /-p selected up --no-recreate --no-build -d prod/);
  assert.match(commands, /-p selected up --no-recreate --no-build -d review/);
  assert.match(commands, /operator-proxy@sha256:/);
  assert.doesNotMatch(commands, /unrelated|beta|--remove-orphans|--force-recreate|gitlab|stop|restart/);
  assert.equal(fs.readFileSync(path.join(root, 'nginx-proxy/.projects/.unrelated.env'), 'utf8'), 'unchanged sibling');
  assert.equal(fs.readFileSync(path.join(root, 'nginx-proxy/.projects/.selected.env'), 'utf8'), 'PROD_PROXY=172.20.0.2\nREVIEW_PROXY=172.20.0.2\n');
  fs.writeFileSync(trace, '');
  const startup = spawnSync('bash', ['start.sh'], {cwd: path.join(root, 'nginx-proxy'), encoding: 'utf8', env: {...process.env,
    PATH: bin + ':' + process.env.PATH, TRACE: trace, SYSTEM_PROJECT_ROUTING_ONLY: 'false'}});
  assert.equal(startup.status, 0, startup.stderr);
  const startupCommands = fs.readFileSync(trace, 'utf8');
  assert.match(startupCommands, /-p selected up --remove-orphans --no-build -d prod/);
  assert.match(startupCommands, /-p unrelated up --remove-orphans --no-build -d prod/);
  assert.doesNotMatch(startupCommands, /--no-recreate/, 'normal controller startup must apply changed Compose logging and image settings');

});

test('failed native apply restores previous proxy address records', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'project-proxy-rollback-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const directory of ['nginx-proxy/.projects','system/.projects.env','nginx'])fs.mkdirSync(path.join(root,directory),{recursive:true});
  fs.cpSync(path.resolve(__dirname,'../../nginx/.templates'),path.join(root,'nginx/.templates'),{recursive:true});
  fs.writeFileSync(path.join(root,'system/.docker.env'),'');fs.writeFileSync(path.join(root,'system/.projects.env/.sample.env'),'');
  fs.writeFileSync(path.join(root,'nginx-proxy/.projects/.sample.env'),'previous addresses');
  const {ProjectsRoutingService}=require('../../operations/dist/projects-routing/projects-routing.service');
  const {ProcessFailure}=require('../../operations/dist/runtime/process');
  const configuration={read:()=>({PROJECT_NAME:'sample',USE_PROD_HOST:'true',GITLAB_DOMAIN_MODE:'0',GITLAB_REGISTRY_DOMAIN_MODE:'0'})};
  const runner={run(binary,args){if(binary==='docker'&&args[0]==='exec')throw new ProcessFailure('docker',23,null,false);return {stdout:'172.20.0.2',stderr:'',status:0};}};
  const service=new ProjectsRoutingService(runner,configuration);
  assert.throws(()=>service.run({action:'apply',root,templates:path.join(root,'templates'),projects:['sample']}),error=>error.status===23);
  assert.equal(fs.readFileSync(path.join(root,'nginx-proxy/.projects/.sample.env'),'utf8'),'previous addresses');
});
