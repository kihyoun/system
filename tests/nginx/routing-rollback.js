'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');
const source = path.resolve(__dirname, '../..');
test('nginx validation and reload failures restore templates and the previous active proxy configuration', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'routing-rollback-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.symlinkSync(path.resolve(__dirname,'../../operations'),path.join(root,'operations'),'dir');
  for (const directory of ['nginx', 'system/.projects.env', 'gitlab', 'wizard', 'nginx-proxy/.projects', 'project-bootstrap', 'bin', 'templates', 'active'])
    fs.mkdirSync(path.join(root, directory), {recursive: true});
  fs.cpSync(path.join(source, 'nginx/.templates'), path.join(root, 'nginx/.templates'), {recursive: true});
  const script = fs.readFileSync(path.join(source, 'nginx/start.sh'), 'utf8').replaceAll('/templates', path.join(root, 'templates'));
  fs.writeFileSync(path.join(root, 'nginx/start.sh'), script);
  for (const file of ['nginx/wizard-aliases.js', 'nginx/application-aliases.js', 'project-bootstrap/preserve-system-project.js'])
    fs.copyFileSync(path.join(source, file), path.join(root, file));
  fs.writeFileSync(path.join(root, '.docker.env'), 'BOOTSTRAPPER_IP=127.0.0.1\n');
  fs.writeFileSync(path.join(root, 'gitlab/.docker.env'), 'GITLAB_IP=127.0.0.1\n');
  fs.writeFileSync(path.join(root, 'system/.docker.env'), 'GITLAB_HOST=gitlab.example.test\nGITLAB_DOMAIN_MODE=0\nGITLAB_REGISTRY_HOST=registry.example.test\nGITLAB_REGISTRY_DOMAIN_MODE=0\nSYNC_ENABLE=false\nWIZARD_ENABLE=false\n');
  const executable = (name, contents) => fs.writeFileSync(path.join(root, 'bin', name), contents, {mode: 0o755});
  executable('docker', '#!' + process.execPath + '\nconst cp=require("node:child_process");const script=process.argv.at(-1).replaceAll("/etc/nginx/conf.d",process.env.ACTIVE).replaceAll("/docker-entrypoint.d/20-envsubst-on-templates.sh",process.env.RENDER);const result=cp.spawnSync("sh",["-ec",script],{stdio:"inherit"});process.exit(result.status ?? 1);\n');
  executable('render', '#!/bin/sh\nprintf candidate > "$ACTIVE/default.conf"\n');
  executable('nginx', '#!/bin/sh\nif [ -f "$FAIL" ] && { [ "$1" = "$PHASE" ] || [ "$2" = "$PHASE" ]; }; then rm "$FAIL"; exit 19; fi\nprintf "%s\\n" "$*" >> "$TRACE"\n');
  for (const phase of ['-t', 'reload']) {
    const template = path.join(root, 'templates/default.conf.template'), active = path.join(root, 'active/default.conf');
    fs.writeFileSync(template, 'previous template'); fs.writeFileSync(active, 'previous active config');
    fs.writeFileSync(path.join(root, 'fail'), 'once'); fs.writeFileSync(path.join(root, 'trace'), '');
    const result = spawnSync('bash', ['-e', 'start.sh', 'reload'], {cwd: path.join(root, 'nginx'), encoding: 'utf8', env: {...process.env,
      PATH: path.join(root, 'bin') + ':' + process.env.PATH, ACTIVE: path.join(root, 'active'), RENDER: path.join(root, 'bin/render'),
      FAIL: path.join(root, 'fail'), PHASE: phase, TRACE: path.join(root, 'trace')}});
    assert.notEqual(result.status, 0, phase);
    assert.equal(fs.readFileSync(template, 'utf8'), 'previous template');
    assert.equal(fs.readFileSync(active, 'utf8'), 'previous active config');
    assert.match(fs.readFileSync(path.join(root, 'trace'), 'utf8'), /-s reload/, 'rollback reloads the previous validated configuration');
  }
});
