import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { initializationGuard } from '../host/install';
import { ManagedChildProcess, type LifecycleProcess } from '../../common/runtime/managedChild';
import { RetainedRecoveryService } from './recovery.service';
import { RuntimeVerificationService } from './runtimeVerification.service';
import { UbuntuHostService } from './ubuntu.service';
import { HostCertificateService } from './certificate.service';
export interface InitializeOptions {
  checkout: string;
  receiptDir: string;
  installHost?: boolean;
  swapGiB?: number;
  timeout?: number;
  tokenFile?: string;
  redirectFrom?: string;
  renewalDryRun?: boolean;
}
@Injectable()
export class HostInitializeService {
  constructor(
    readonly recovery = new RetainedRecoveryService(),
    readonly verification = new RuntimeVerificationService(),
    readonly ubuntu = new UbuntuHostService(),
    readonly certificates = new HostCertificateService(),
    readonly child: LifecycleProcess = new ManagedChildProcess(),
    readonly guard = () => initializationGuard('/run/system-bootstrapper'),
  ) {}

  async initialize(
    options: InitializeOptions,
    env: NodeJS.ProcessEnv,
    signal?: AbortSignal,
  ): Promise<void> {
    if (process.geteuid?.() !== 0) {
      throw Error('Host initialization requires root.');
    }

    const checkout = fs.realpathSync(options.checkout),
      receipt = path.join(
        fs.realpathSync(path.dirname(path.resolve(options.receiptDir))),
        path.basename(options.receiptDir),
      ),
      swap = options.swapGiB ?? 0,
      timeout = options.timeout ?? 1200;

    if (
      !path.isAbsolute(options.receiptDir) ||
      receipt === '/' ||
      receipt === checkout ||
      receipt.startsWith(checkout + '/')
    ) {
      throw Error('Private receipt directory outside checkout required.');
    }

    if (
      !Number.isInteger(swap) ||
      swap < 0 ||
      swap > 32 ||
      !Number.isInteger(timeout) ||
      timeout < 0 ||
      timeout > 3600
    ) {
      throw Error('Invalid initialization bounds.');
    }

    if (fs.lstatSync(receipt, { throwIfNoEntry: false })) {
      throw Error('Receipt directory already exists.');
    }

    const selector = env.PERSISTENCE_ENV_FILE;

    if (!selector) {
      throw Error('Select the private persistence environment.');
    }

    const release = this.guard();
    try {
      // Validate retained storage and configuration before packages, receipts or service mutations.
      await this.verification.settings(selector, checkout, env, signal);
      await this.recovery.recover(checkout, env, true, signal);
      fs.mkdirSync(receipt, { mode: 0o700 });
      const phase = (value: string) =>
        fs.writeFileSync(path.join(receipt, 'status'), value + '\n', { mode: 0o600 });
      const run = async (binary: string, args: string[], log: string) => {
        const output = await this.child.run(binary, args, {
          cwd: checkout,
          env,
          signal,
          timeout: 1800000,
        });
        fs.appendFileSync(path.join(receipt, log), output, { mode: 0o600 });
        return output;
      };
      try {
        phase('Capturing retained baseline');
        const verification = {
          checkout,
          persistenceEnv: selector,
          baseline: path.join(receipt, 'baseline.json'),
          output: path.join(receipt, 'verification.json'),
          timeout,
          tokenFile: options.tokenFile,
          redirectFrom: options.redirectFrom,
        };
        await this.verification.execute(
          { ...verification, operation: 'baseline', output: verification.baseline },
          env,
          signal,
        );

        if (swap && !(await run('swapon', ['--show=NAME', '--noheadings'], 'swap.log')).trim()) {
          if (fs.lstatSync('/swapfile', { throwIfNoEntry: false })) {
            throw Error('Existing swapfile must be managed deliberately.');
          }

          const usage = fs.statfsSync('/');

          if (usage.bavail * usage.bsize <= (swap + 2) * 1024 ** 3) {
            throw Error('Insufficient root filesystem reserve for swap.');
          }

          await run('fallocate', ['-l', String(swap * 1024 ** 3), '/swapfile'], 'swap.log');
          fs.chmodSync('/swapfile', 0o600);
          await run('mkswap', ['/swapfile'], 'swap.log');
          await run('swapon', ['/swapfile'], 'swap.log');

          if (
            !fs
              .readFileSync('/etc/fstab', 'utf8')
              .split('\n')
              .some((line) => line.trim().split(/\s+/)[0] === '/swapfile')
          ) {
            fs.appendFileSync('/etc/fstab', '/swapfile none swap sw 0 0\n');
          }
        }

        if (options.installHost) {
          phase('Installing native Ubuntu dependencies');
          await this.ubuntu.install(env, signal);
          await run('apt-get', ['install', '-y', 'certbot'], 'install.log');
        }

        await run('docker', ['--host=unix:///var/run/docker.sock', 'version'], 'preflight.log');
        await run('certbot', ['--version'], 'preflight.log');
        phase('Recovering retained platform');
        await this.recovery.recover(checkout, env, false, signal);
        phase('Verifying running platform');
        await this.verification.execute({ ...verification, operation: 'check' }, env, signal);

        if (options.renewalDryRun) {
          phase('Testing certificate renewal');
          const renewal = await this.certificates.renew(
            checkout,
            ['renew', '--dry-run', '--run-deploy-hooks', '--no-random-sleep-on-renew'],
            env,
            signal,
          );
          fs.writeFileSync(path.join(receipt, 'certificate-renewal.log'), renewal, { mode: 0o600 });

          if (
            /Hook .*returned error code [1-9]/.test(renewal) ||
            !renewal.includes('all simulated renewals succeeded')
          ) {
            throw Error(
              'Certificate renewal simulation did not confirm successful renewal and hooks.',
            );
          }

          await this.verification.execute(
            { ...verification, operation: 'check', timeout: 60 },
            env,
            signal,
          );
        }

        phase('Initialization and runtime verification completed');
      } catch (error) {
        phase('Initialization failed; preserve retained state and inspect private receipts.');
        throw error;
      }
    } finally {
      release();
    }
  }
}
