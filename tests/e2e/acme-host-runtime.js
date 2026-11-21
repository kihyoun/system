'use strict';
// Test-only native Certbot transport. The accepted controller image supplies the
// same compiled Nest certificate provider used on the real host.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
function basePaths(base){
  if(!['/candidate-data/platform','/recovered-data/platform'].includes(base))throw Error('acme-owned-data-root-required');
  return {base,parent:path.posix.dirname(base),state:base+'/host/letsencrypt',tools:base+'/acme-test-tools',webroot:base+'/ssl/acme-http01'};
}

async function run(input, dependencies = {}) {
  if (!input || !net.isIPv4(input.caAddress) || input.certbotReference !== 'acme-certbot:under-test' ||
      !Array.isArray(input.args) || input.args.some(value => typeof value !== 'string' || /[\0\r\n]/.test(value)))
    throw Error('Invalid isolated ACME host input.');
  const selectedPaths = basePaths(input.base), paths = dependencies.paths || selectedPaths;
  const {NestFactory} = require('../../node_modules/@nestjs/core');
  const {HostCertificateService} = require('../../dist/modules/host-bootstrap/certificate.service');
  const {ManagedChildProcess} = require('../../dist/common/runtime/managed-child');
  const native = dependencies.native || new ManagedChildProcess();
  const checkout = dependencies.checkout || '/system';
  const selector = dependencies.selector || '/tmp/acme-persistence.env';
  const marker = path.join(paths.state, '.fixture-deploy-fired');
  const environment = {...process.env, PERSISTENCE_ENV_FILE: selector};
  fs.writeFileSync(selector, 'PERSISTENCE_MODE=local\nPERSISTENT_MOUNT=/\nPERSISTENT_DIR=' + paths.base + '\n', {flag: 'wx', mode: 0o600});
  const abort = new AbortController(), cancel = () => abort.abort();
  process.on('SIGINT', cancel); process.on('SIGTERM', cancel);
  let app;
  const transport = {
    async run(binary, args, options) {
      if (binary !== '/usr/bin/certbot') return native.run(binary, args, options);
      fs.rmSync(marker, {force: true});
      const output = await native.run('docker', ['--host=unix:///var/run/docker.sock', 'run', '--rm', '--pull', 'never',
        '--name', 'acme-certbot-operation', '--memory', '256m', '--cpus', '0.5', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--tmpfs', '/var/lib/letsencrypt', '--tmpfs', '/var/log/letsencrypt', '--add-host', 'pebble:' + input.caAddress,
        '--env', 'REQUESTS_CA_BUNDLE=/fixture-tools/pebble.minica.pem',
        '--volume', paths.state + ':/etc/letsencrypt', '--volume', paths.tools + ':/fixture-tools:ro',
        '--volume', paths.webroot + ':' + paths.webroot, input.certbotReference, ...args,
        '--deploy-hook', 'touch /etc/letsencrypt/.fixture-deploy-fired'], options);
      if (!fs.existsSync(marker)) throw Error('Real Certbot deploy hook did not fire.');
      // Publish and reload while renew() still holds the real durable lease.
      await app.get(HostCertificateService).publish(checkout, {...environment, RENEWED_LINEAGE: path.join(dependencies.systemRoot || '/', 'etc/letsencrypt/live/recovery-fixture')}, abort.signal);
      return output;
    },
  };
  class AcmeHostModule {}
  try {
    app = await NestFactory.createApplicationContext({module: AcmeHostModule,
      providers: [{provide: HostCertificateService, useFactory: () => new HostCertificateService(transport, dependencies.systemRoot || '/')}],
    }, {logger: false, abortOnError: false});
    await app.get(HostCertificateService).renew(checkout, input.args, environment, abort.signal);
  } finally {
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
    await app?.close();
    fs.unlinkSync(selector);
  }
}
module.exports = {run, basePaths};
if (require.main === module) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; if (raw.length > 65536) process.stdin.destroy(Error('Bounded fixture input required.')); });
  process.stdin.on('error', () => { process.exitCode = 1; });
  process.stdin.on('end', () => { void Promise.resolve().then(() => run(JSON.parse(raw))).catch(() => { console.error('Native ACME host integration failed.'); process.exitCode = 1; }); });
}
