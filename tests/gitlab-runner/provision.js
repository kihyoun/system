'use strict';
const assert = require('assert');
const {withRunnerToken: withToken} = require('../../dist/modules/lifecycle/runner.service');
const signature = require('fs').readFileSync(require('path').join(__dirname, '../../config/system/.docker.env.example'), 'utf8');
const updated = withToken(signature, 'glrt-example_token-123');
assert.strictEqual(updated.slice(0, 1184), signature.slice(0, 1184));
assert.strictEqual(updated.match(/^GITLAB_RUNNER_TOKEN=.*$/m)[0], "GITLAB_RUNNER_TOKEN='glrt-example_token-123'");
assert.strictEqual(withToken(updated, 'glrt-example_token-123'), updated);
assert.ok(withToken(signature, 'glrt-t1_example.suffix').includes('glrt-t1_example.suffix'));
assert.throws(() => withToken(signature, "glrt-'; echo secret"));
console.log('Runner token update preserves signature and rejects shell injection.');

async function durableRequests() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const {GitlabRunnerRequestService} = require('../../dist/modules/gitlab-provision/runnerRequest.service');
  const {GitlabLockExecService} = require('../../dist/modules/gitlab-provision/lockExec.service');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-request-'));
  const parent = path.join(directory, 'system-bootstrapper-auth');
  fs.mkdirSync(parent, {mode: 0o700});
  const containerId = 'a'.repeat(64), id = 'b'.repeat(64);
  let stored, command, creates = 0, starts = 0, ran = false, loseResponse = true;
  const transport = {async request(method, route, body) {
    if (route === `/containers/${containerId}/exec`) {
      assert.ok(stored && stored.nonce, 'request identity must be durable before exec creation');creates++; command = body;
      return {status: 201, value: {Id: id}};
    }
    if (route === `/exec/${id}/json`) return {status: 200, value: {
      ID: id, ContainerID: containerId, Running: false, ExitCode: 0,
      OpenStdin: false, OpenStdout: false, OpenStderr: false,
      ProcessConfig: {user: command.User, entrypoint: command.Cmd[0], arguments: command.Cmd.slice(1), tty: false, privileged: false},
    }};
    assert.equal(route, `/exec/${id}/start`);
    starts++;
    if (ran) return {status:409, value:null};
    ran = true;
    const requestDirectory = path.join(parent, 'runner-request-' + stored.nonce);
    fs.writeFileSync(path.join(requestDirectory, 'headers'), 'HTTP/1.1 201 Created\r\n\r\n');
    fs.writeFileSync(path.join(requestDirectory, 'response'), JSON.stringify({id: 12, token:'glrt-once'}));
    if (loseResponse) throw Error('interrupted-start-response');
    return {status:200, value:null};
  }};
  const executions = new GitlabLockExecService(transport);
  const service = new GitlabRunnerRequestService(executions);
  const input = {containerId, configDirectory: directory, token:'glpat-private-admin', route:'runners/12/reset_authentication_token', body:{}, save: state => {stored=JSON.parse(JSON.stringify(state));}};
  try {
    await assert.rejects(service.execute(input), error => error.uncertain === true && /reconciliation-required/.test(error.message));
    assert.equal(creates, 1);
    assert.ok(stored.exec);
    assert.ok(!JSON.stringify(command).includes(input.token));
    const curl = command.Cmd.indexOf('curl');
    assert.equal(command.Cmd[curl+1], '-q');
    assert.deepEqual(command.Cmd.slice(curl+2,curl+4), ['--proxy','']);
    assert.ok(command.Cmd.includes('--max-time'));
    assert.ok(command.Cmd.includes('--max-filesize'));
    assert.ok(command.Cmd.includes('env') && command.Cmd.includes('-i'));
    loseResponse = false;
    const result = await service.execute({...input,pending:stored});
    assert.deepEqual(result, {status:201, value:{id:12,token:'glrt-once'}});
    assert.equal(creates, 1, 'retry must never create another reset exec');
    assert.equal(starts, 2, 'same exact exec safely returns conflict after completion');
    await assert.rejects(service.execute({...input,pending:stored,route:'runners/13/reset_authentication_token'}), /identity-mismatch/);
    await assert.rejects(service.execute({...input,route:'users/1'}), /request-invalid/);
    await assert.rejects(executions.create(containerId,'0:0',['curl']), /native-command-invalid/);
    await assert.rejects(executions.createRunnerRequest(containerId,'0:0',stored.nonce,'users/1'), /request-invalid/);
    command.ProcessConfig = undefined;
    const original = command.Cmd;
    command.Cmd = ['unexpected-command'];
    await assert.rejects(service.execute({...input,pending:stored}), /reconciliation-required/);
    command.Cmd = original;
    const response = path.join(parent,'runner-request-'+stored.nonce,'response');
    fs.chmodSync(response, 0o644);
    await assert.rejects(service.execute({...input,pending:stored}), /reconciliation-required/);
    fs.chmodSync(response, 0o600);
    fs.writeFileSync(response, '{incomplete');
    await assert.rejects(service.execute({...input,pending:stored}), /reconciliation-required/);
    assert.equal(creates, 1);
    service.cleanup(directory,stored);
    assert.ok(!fs.existsSync(path.dirname(response)));
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
}
durableRequests().then(() => console.log('Runner requests retain exact exec identity and private responses across interrupted resets.')).catch(error=>{console.error(error);process.exitCode=1;});

async function credentials() {
  const fs=require('fs'), path=require('path'), os=require('os');
  const {GitlabRunnerCredentialService}=require('../../dist/modules/gitlab-provision/runnerCredential.service');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'runner-credential-'));
  let stored, runner, calls=[], requests=0, cleanup=0, execProof={running:false,exitCode:0};
  const authority={context:{checkout:root,containerId:'a'.repeat(64)},configDirectory:root,credential:{token:'glpat-admin'}};
  const journals={async withFile(directory,name,validate,fn){assert.equal(name,'runner');return fn({read:()=>stored&&validate(JSON.parse(JSON.stringify(stored))),save:s=>{stored=JSON.parse(JSON.stringify(s));}});}};
  const api={async request(context,admin,method,route,body){
    calls.push([method,route,body]);
    if(route.startsWith('runners/all?'))return {status:200,value:runner?[{id:runner.id,description:runner.description}]:[]};
    if(route==='runners/12')return {status:200,value:runner};
    if(route==='runners/verify')return {status:200,value:{id:12}};
    throw Error('unexpected route '+route);
  }};
  const policy={id:12,description:'System Bootstrapper Docker pool',runner_type:'instance_type',locked:false,run_untagged:true,access_level:'not_protected',tag_list:['aws','docker']};
  const request={async execute(input){requests++;input.save(input.pending??{nonce:'c'.repeat(48),identity:'d'.repeat(64),containerId:authority.context.containerId,exec:{id:'e'.repeat(64),digest:'f'.repeat(64)}});runner={...policy,maintenance_note:input.body.maintenance_note??runner?.maintenance_note};return {status:201,value:{id:12,token:'glrt-captured'}};},cleanup(){cleanup++;}};
  const manager=path.join(root,'runners','runner','1','config');
  const child={async run(binary,args){assert.equal(binary,'docker');if(args[1]==='stop'){assert.equal(args.at(-1),'9'.repeat(64));return '';}assert.equal(args.at(-1),'runner_docker_1');return JSON.stringify({Id:'9'.repeat(64),Name:'/runner_docker_1',Config:{Labels:{'com.docker.compose.project':'runner','com.docker.compose.service':'docker_1'}},Mounts:[{Type:'bind',Source:manager,Destination:'/etc/gitlab-runner',RW:true}]});}};
  const service=new GitlabRunnerCredentialService({ensure:async()=>authority},journals,api,request,child,{resolve:async()=>authority.context},{inspect:async()=>execProof});
  const options={checkout:root,persistentDirectory:root,startupOperation:'startup-'+'2'.repeat(32)};
  try {
    assert.deepEqual(await service.current(options),{id:12,token:'glrt-captured'});
    assert.equal(requests,1);assert.equal(cleanup,1);
    assert.ok(!calls.some(c=>c[1]==='runners/verify'),'fresh provisioning must not invent a manager system ID');
    assert.deepEqual(await service.current(options),{id:12,token:'glrt-captured'});
    assert.equal(requests,1);
    stored=undefined;runner={...policy};
    await assert.rejects(service.current(options),/explicit-rotation-required/);
    assert.equal(requests,1,'an unrecoverable old secret must not silently reset');
    fs.mkdirSync(manager,{recursive:true});
    fs.writeFileSync(path.join(manager,'config.toml'),'[[runners]]\n  id = 12\n  name = "runner-docker-1"\n  token = "glrt-existing"\n  [runners.docker]\n    network_mode = "system_gitlab"\n',{mode:0o600});
    fs.writeFileSync(path.join(manager,'.runner_system_id'),'s_existing\n',{mode:0o600});
    assert.deepEqual(await service.current(options),{id:12,token:'glrt-existing'});
    assert.equal(requests,1);
    assert.ok(calls.some(c=>c[1]==='runners/verify'&&c[2].system_id==='s_existing'));
    await assert.rejects(service.current({...options,rotateRunnerId:13,rotation:'1'.repeat(48)}),/rotation-identity-mismatch/);
    await assert.rejects(service.current({...options,rotateRunnerId:12}),/rotation-operation-required/);
    assert.deepEqual(await service.current({...options,rotateRunnerId:12,rotation:'1'.repeat(48)}),{id:12,token:'glrt-captured'});
    assert.equal(requests,2);
    assert.ok(fs.readFileSync(path.join(manager,'config.toml'),'utf8').includes('token = "glrt-captured"'));
    assert.equal(fs.readFileSync(path.join(manager,'.runner_system_id'),'utf8'),'s_existing\n');
    await service.current({...options,rotateRunnerId:12,rotation:'1'.repeat(48)});
    assert.equal(requests,2,'repeating the same explicit recovery operation must not rotate again');
    assert.deepEqual(await service.reconciliation(options,options.startupOperation,'1'.repeat(48)),{id:12});
    execProof=undefined;await assert.rejects(service.reconciliation(options,options.startupOperation,'1'.repeat(48)),/exec-incomplete/);execProof={running:false,exitCode:0};
    await assert.rejects(service.reconciliation(options,'startup-'+'3'.repeat(32),'1'.repeat(48)),/reconciliation-identity-mismatch/);
    stored=undefined;
    fs.writeFileSync(path.join(manager,'config.toml'),'[[runners]]\n  id = 99\n  name = "runner-docker-1"\n  token = "glrt-foreign"\n  [runners.docker]\n    network_mode = "system_gitlab"\n');
    await assert.rejects(service.current(options),/manager-identity-mismatch/);
    assert.equal(requests,2);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
credentials().then(()=>console.log('Runner credentials preserve owned manager IDs and require idempotent explicit rotation.')).catch(error=>{console.error(error);process.exitCode=1;});

function startupReconciliation() {
  const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
  const {startupBegin}=require('../../dist/modules/storage/lease');
  const {attachRunnerStartup,runnerStartupRecovery}=require('../../dist/modules/lifecycle/runnerStartup');
  const state=fs.mkdtempSync(path.join(os.tmpdir(),'runner-startup-'));
  try {
    const operation=startupBegin(state,process.pid);
    assert.throws(()=>runnerStartupRecovery(state,operation,state,'provision'),/legacy-or-foreign/);
    attachRunnerStartup(state,operation,state,'provision');
    assert.throws(()=>runnerStartupRecovery(state,operation,state,'provision'),/owner-live/);
    assert.throws(()=>runnerStartupRecovery(state,operation,state,'1'.repeat(48)),/legacy-or-foreign/);
    const owner=path.join(state,'.storage-operation-lock/startup-owner.json');
    fs.unlinkSync(owner);fs.rmdirSync(path.dirname(owner));
    const entry=require.resolve('../../dist/modules/lifecycle/runnerStartup');
    const lease=require.resolve('../../dist/modules/storage/lease');
    const child=spawnSync(process.execPath,['-e',`const {startupBegin}=require(${JSON.stringify(lease)});const {attachRunnerStartup}=require(${JSON.stringify(entry)});const op=startupBegin(${JSON.stringify(state)},process.pid);attachRunnerStartup(${JSON.stringify(state)},op,${JSON.stringify(state)},'provision');console.log(op);`],{encoding:'utf8'});
    assert.equal(child.status,0,child.stderr);
    const interrupted=child.stdout.trim();
    runnerStartupRecovery(state,interrupted,state,'provision');
    const before=fs.readFileSync(owner,'utf8');
    const changed=JSON.parse(before);changed.runner.namespace='pid:[123]';fs.writeFileSync(owner,JSON.stringify(changed));
    assert.throws(()=>runnerStartupRecovery(state,interrupted,state,'provision'),/namespace-ambiguous/);
    fs.writeFileSync(owner,before);
    fs.mkdirSync(path.join(state,'.gitlab-upgrade-lock'));
    assert.throws(()=>runnerStartupRecovery(state,interrupted,state,'provision'),/foreign-owner/);
    fs.rmdirSync(path.join(state,'.gitlab-upgrade-lock'));
    runnerStartupRecovery(state,interrupted,state,'provision',true);
    assert.equal(JSON.parse(fs.readFileSync(owner)).pid,process.pid);
    assert.equal(JSON.parse(fs.readFileSync(owner)).operation,interrupted.slice(8));
  }finally{fs.rmSync(state,{recursive:true,force:true});}
}
startupReconciliation();
