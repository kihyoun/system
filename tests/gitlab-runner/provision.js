'use strict';
const assert = require('assert');
const {withToken} = require('../../gitlab-runner/provision');
const signature = require('fs').readFileSync(require('path').join(__dirname, '../../system/.docker.env.example'), 'utf8');
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
  const {GitlabRunnerRequestService} = require('../../operations/dist/gitlab-provision/runner-request.service');
  const {GitlabLockExecService} = require('../../operations/dist/gitlab-provision/lock-exec.service');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-request-'));
  const parent = path.join(directory, 'system-bootstrapper-auth');
  fs.mkdirSync(parent, {mode: 0o700});
  const containerId = 'a'.repeat(64), id = 'b'.repeat(64);
  let stored, command, creates = 0, starts = 0, ran = false, loseResponse = true;
  const transport = {async request(method, route, body) {
    if (route === `/containers/${containerId}/exec`) {
      creates++; command = body;
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
    await assert.rejects(service.execute(input), /interrupted-start/);
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
    await assert.rejects(service.execute({...input,pending:stored}), /command-proof-invalid/);
    command.Cmd = original;
    const response = path.join(parent,'runner-request-'+stored.nonce,'response');
    fs.chmodSync(response, 0o644);
    await assert.rejects(service.execute({...input,pending:stored}), /permissions-or-owner/);
    fs.chmodSync(response, 0o600);
    fs.writeFileSync(response, '{incomplete');
    await assert.rejects(service.execute({...input,pending:stored}), /response-invalid/);
    assert.equal(creates, 1);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
}
durableRequests().then(() => console.log('Runner requests retain exact exec identity and private responses across interrupted resets.')).catch(error=>{console.error(error);process.exitCode=1;});
