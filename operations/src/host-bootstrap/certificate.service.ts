import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { ManagedChildProcess, type LifecycleProcess } from '../runtime/managed-child';
import { readEnvironment } from '../host-lifecycle/lifecycle.service';
import { HostPersistenceService } from '../host-lifecycle/persistence.service';
function canonical(filename: string): string {
  if (fs.lstatSync(filename, { throwIfNoEntry: false })) return fs.realpathSync(filename);
  return path.join(canonical(path.dirname(filename)), path.basename(filename));
}
export function rebindRenewal(text: string, webroot: string): string {
  if (!path.isAbsolute(webroot) || /[\r\n,]/.test(webroot))
    throw Error('Invalid certificate webroot.');
  if (!/^authenticator\s*=\s*webroot\s*$/m.test(text)) return text;
  text = text.replace(/^(webroot_path\s*=\s*).*$/gm, (_, prefix: string) => prefix + webroot + ',');
  const marker = '[[webroot_map]]',
    index = text.indexOf(marker);
  if (index < 0) return text;
  const before = text.slice(0, index + marker.length),
    rest = text.slice(index + marker.length);
  const end = rest.search(/^\s*\[/m),
    mapping = end < 0 ? rest : rest.slice(0, end);
  return (
    before +
    mapping.replace(/^(\s*[^#\s][^=\n]*=\s*)\/[^\n]*$/gm, (_, prefix: string) => prefix + webroot) +
    (end < 0 ? '' : rest.slice(end))
  );
}
function activeState(directory: string): boolean {
  if (!fs.existsSync(directory)) return false;
  for (const item of fs.readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (item.isFile()) {
      const relative = path.relative(directory, path.join(item.parentPath, item.name));
      if (
        relative.endsWith('.pem') ||
        relative.startsWith('accounts/') ||
        /^renewal\/.*\.conf$/.test(relative)
      )
        return true;
    }
  }
  return false;
}
@Injectable()
export class HostCertificateService {
  constructor(
    readonly process: LifecycleProcess = new ManagedChildProcess(),
    readonly systemRoot = '/',
  ) {}
  private host(relative: string) {
    return path.join(this.systemRoot, relative);
  }
  private run(
    binary: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
    timeout = 15000,
  ) {
    return this.process.run(binary, args, { cwd: this.systemRoot, env, signal, timeout });
  }
  async selection(
    checkout: string,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<NodeJS.ProcessEnv> {
    return readEnvironment(
      this.process,
      [env.PERSISTENCE_ENV_FILE || this.host('etc/system-bootstrapper/persistence.env')],
      env,
      checkout,
      signal,
    );
  }
  async validate(env: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<string> {
    const mount = env.PERSISTENT_MOUNT,
      data = env.PERSISTENT_DIR;
    if (
      !mount?.startsWith('/') ||
      !data?.startsWith('/') ||
      data === '/' ||
      fs.realpathSync(data) !== data.replace(/\/$/, '')
    )
      throw Error('Canonical retained certificate storage required.');
    const inspect = async (field: string, target: string) =>
      (await this.run('findmnt', ['-rn', '-T', target, '-o', field], env, signal)).trim();
    if ((env.PERSISTENCE_MODE || 'volume') === 'local') {
      if (mount !== '/') throw Error('Local certificate storage must use root filesystem.');
    } else {
      if ((env.PERSISTENCE_MODE || 'volume') !== 'volume') throw Error('Invalid persistence mode.');
      await this.run('mountpoint', ['-q', mount], env, signal);
      if ((await inspect('TARGET', data)) !== mount)
        throw Error('Certificate volume mount changed.');
    }
    if (
      fs.readFileSync(path.join(data, '.system-bootstrapper-volume'), 'utf8').trim() !==
      'system-bootstrapper-persistence-v1'
    )
      throw Error('Invalid certificate volume marker.');
    if (env.PERSISTENT_UUID && (await inspect('UUID', mount)) !== env.PERSISTENT_UUID)
      throw Error('Certificate volume UUID changed.');
    return data;
  }
  async renew(
    checkout: string,
    args: string[],
    input: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<string> {
    const env = await this.selection(checkout, input, signal),
      data = await this.validate(env, signal);
    const lock = path.join(data, 'host/letsencrypt/.system-bootstrapper-certificate-lock');
    fs.mkdirSync(lock, { mode: 0o700 });
    try {
      return await this.run('/usr/bin/certbot', args, env, signal, 7200000);
    } finally {
      fs.rmdirSync(lock);
    }
  }
  async publish(checkout: string, input: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    const env = await this.selection(checkout, input, signal),
      data = await this.validate(env, signal);
    const lineage =
      env.RENEWED_LINEAGE || this.host('etc/letsencrypt/live/system-bootstrapper.com');
    const prefix = this.host('etc/letsencrypt/live') + '/',
      name = path.basename(lineage);
    if (
      !lineage.startsWith(prefix) ||
      lineage !== prefix + name ||
      !/^[A-Za-z0-9.-]+$/.test(name) ||
      ['.', '..'].includes(name)
    )
      throw Error('Invalid certificate lineage.');
    const target = path.join(data, 'ssl/live', name);
    if (canonical(target) !== target)
      throw Error('Certificate destination must not escape live storage.');
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    for (const [filename, mode] of [
      ['fullchain.pem', 0o644],
      ['privkey.pem', 0o600],
    ] as const) {
      const temporary = path.join(target, filename + '.next');
      if (fs.lstatSync(temporary, { throwIfNoEntry: false }))
        throw Error('Interrupted certificate publication needs inspection.');
      fs.writeFileSync(temporary, fs.readFileSync(path.join(lineage, filename)), {
        flag: 'wx',
        mode,
        flush: true,
      });
    }
    for (const filename of ['fullchain.pem', 'privkey.pem'])
      fs.renameSync(path.join(target, filename + '.next'), path.join(target, filename));
    let running = false;
    try {
      running =
        (
          await this.run(
            'docker',
            [
              '--host=unix:///var/run/docker.sock',
              'inspect',
              '--format',
              '{{.State.Running}}',
              'system_web_1',
            ],
            env,
            signal,
          )
        ).trim() === 'true';
    } catch (error) {
      if (signal?.aborted) throw error;
    }
    if (running)
      for (const args of [
        ['nginx', '-t'],
        ['nginx', '-s', 'reload'],
      ])
        await this.run(
          'docker',
          ['--host=unix:///var/run/docker.sock', 'exec', 'system_web_1', ...args],
          env,
          signal,
        );
  }
  async install(checkout: string, input: NodeJS.ProcessEnv, signal?: AbortSignal): Promise<void> {
    const env = await this.selection(checkout, input, signal);
    const selected = await new HostPersistenceService(this.process).prepare(
      env,
      process.geteuid?.(),
      signal,
    );
    const mount = selected.PERSISTENT_MOUNT!,
      data = selected.PERSISTENT_DIR!;
    if (/[\r\n\s\\]/.test(mount)) throw Error('Mount path cannot be represented in fstab/systemd.');
    const fstab = this.host('etc/fstab'),
      content = fs.readFileSync(fstab, 'utf8');
    if (
      selected.PERSISTENCE_MODE === 'volume' &&
      !content
        .split('\n')
        .some((line) => !line.trim().startsWith('#') && line.trim().split(/\s+/)[1] === mount)
    ) {
      const uuid =
        selected.PERSISTENT_UUID ||
        (await this.run('findmnt', ['-rn', '-T', mount, '-o', 'UUID'], env, signal)).trim();
      if (!/^[a-fA-F0-9-]+$/.test(uuid)) throw Error('Cannot persist the data mount UUID.');
      fs.appendFileSync(fstab, `UUID=${uuid} ${mount} ext4 defaults,nofail 0 2\n`);
    }
    const state = path.join(data, 'host/letsencrypt'),
      host = this.host('etc/letsencrypt');
    fs.mkdirSync(state, { recursive: true, mode: 0o700 });
    const existing = fs.lstatSync(host, { throwIfNoEntry: false });
    if (existing?.isDirectory() && !existing.isSymbolicLink()) {
      const localActive = activeState(host),
        volumeActive = activeState(state);
      if (localActive && volumeActive)
        throw Error('Both host and volume contain active Certbot state; reconcile them first.');
      if (localActive || !volumeActive)
        fs.cpSync(host, state, {
          recursive: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
      const retained =
        host +
        '.before-volume-' +
        new Date()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\.\d+Z$/, 'Z');
      if (fs.existsSync(retained)) throw Error('Retained Certbot host state already exists.');
      fs.renameSync(host, retained);
    }
    if (fs.lstatSync(host, { throwIfNoEntry: false })) {
      if (fs.realpathSync(host) !== state) throw Error('Host Certbot link selects another volume.');
    } else fs.symlinkSync(state, host);
    const entry = path.join(checkout, 'operations/dist/host-bootstrap/entry.js');
    fs.chmodSync(entry, 0o755);
    for (const name of ['system-certbot', 'system-install-certificate']) {
      const destination = this.host('usr/local/sbin/' + name);
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
      if (fs.lstatSync(destination, { throwIfNoEntry: false })) fs.unlinkSync(destination);
      fs.symlinkSync(entry, destination);
    }
    for (const service of ['docker', 'certbot']) {
      const directory = this.host(`etc/systemd/system/${service}.service.d`);
      fs.mkdirSync(directory, { recursive: true, mode: 0o755 });
      const text =
        `[Unit]\nRequiresMountsFor=${mount}\n` +
        (service === 'certbot'
          ? `[Service]\nEnvironment="PATH=${path.dirname(process.execPath)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"\nExecStart=\nExecStart=/usr/local/sbin/system-certbot -q renew\n`
          : '');
      fs.writeFileSync(path.join(directory, '20-system-volume.conf'), text, { mode: 0o644 });
    }
    const renewal = path.join(state, 'renewal'),
      webroot = path.join(data, 'ssl/acme-http01');
    if (fs.existsSync(renewal))
      for (const name of fs.readdirSync(renewal).filter((name) => name.endsWith('.conf'))) {
        const filename = path.join(renewal, name),
          text = fs.readFileSync(filename, 'utf8'),
          updated = rebindRenewal(text, webroot);
        if (text !== updated) fs.writeFileSync(filename, updated);
      }
    const hook = path.join(state, 'renewal-hooks/deploy/system-web');
    fs.mkdirSync(path.dirname(hook), { recursive: true, mode: 0o755 });
    if (fs.lstatSync(hook, { throwIfNoEntry: false })) fs.unlinkSync(hook);
    fs.symlinkSync(entry, hook);
    await this.run('systemctl', ['daemon-reload'], env, signal);
    if (
      (
        await this.run(
          'systemctl',
          ['list-unit-files', 'certbot.timer', '--no-legend'],
          env,
          signal,
        )
      ).includes('certbot.timer')
    )
      await this.run('systemctl', ['enable', '--now', 'certbot.timer'], env, signal);
  }
}
