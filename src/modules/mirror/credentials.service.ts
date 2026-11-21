import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MIRROR_PORT, MirrorPort, MirrorContext } from './ports';
@Injectable()
export class MirrorCredentialsService {
  constructor(@Inject(MIRROR_PORT) private readonly port: MirrorPort) {}

  async using<T>(
    context: MirrorContext,
    action: (privateContext: MirrorContext, directory: string) => Promise<T>,
  ): Promise<T> {
    const env = context.env;
    if (!env.GITHUB_SSH_PRIVATE_KEY) throw Error('protected SSH key missing');
    if (!env.GITHUB_SSH_KNOWN_HOSTS || !fs.existsSync(env.GITHUB_SSH_KNOWN_HOSTS))
      throw Error('verified known-hosts file variable missing');
    const directory = fs.mkdtempSync(path.join(env.TMPDIR || os.tmpdir(), 'system-github-backup.'));
    fs.chmodSync(directory, 0o700);
    try {
      const hosts = path.join(directory, 'known_hosts');
      fs.writeFileSync(hosts, fs.readFileSync(env.GITHUB_SSH_KNOWN_HOSTS), { mode: 0o600 });
      try {
        this.port.command('ssh-keygen', ['-F', 'github.com', '-f', hosts], context);
      } catch {
        throw Error('verified GitHub host key missing');
      }
      const identity = this.identity(
        env.GITHUB_SSH_PRIVATE_KEY,
        path.join(directory, 'identity'),
        context,
      );
      const clean: NodeJS.ProcessEnv = {
        ...env,
        GITHUB_BACKUP_KNOWN_HOSTS_FILE: hosts,
        GITHUB_BACKUP_IDENTITY_FILE: identity,
      };
      delete clean.GITHUB_SSH_PRIVATE_KEY;
      return await action({ ...context, env: clean }, directory);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  identity(selector: string, output: string, context: MirrorContext): string {
    let value = selector;
    if (!selector.includes('\n') && fs.existsSync(selector))
      value = fs.readFileSync(selector, 'utf8');
    fs.writeFileSync(output, value.replace(/\r/g, '').replace(/\n?$/, '\n'), { mode: 0o600 });
    try {
      this.port.command('ssh-keygen', ['-y', '-P', '', '-f', output], context);
    } catch {
      throw Error('SSH identity could not be loaded');
    }
    return output;
  }
}
