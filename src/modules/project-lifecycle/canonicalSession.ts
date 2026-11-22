import fs from 'node:fs';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import path from 'node:path';
import { DeploymentSlot, EnvironmentKind, EnvironmentSetting } from './types';
const prefix = '# BOOTSTRAPPER_PROJECT=';
const sha = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
export interface CanonicalPayload {
  token?: string;
  operation?: string;
  helper?: string;
  expectedHash?: string;
  previousBindingHash?: string;
  binding?: unknown;
  deployments?: Partial<Record<EnvironmentKind, DeploymentSlot>>;
}
export interface CanonicalReceipt {
  defaultProject: boolean;
  template: string;
  state: string;
  operation: string;
  namespaceId: number;
  repository: {
    id: number;
    path: string;
    defaultBranch: string;
    ciPath: string;
    systemProject: boolean;
    managementMode?: string;
    namespaceId?: number;
  };
  sourcePrimary?: unknown;
  wizardWorkflow?: {
    environments?: {
      operation: string;
      controller: string;
      deployments?: Partial<Record<EnvironmentKind, DeploymentSlot>>;
      settings: Record<EnvironmentKind, EnvironmentSetting>;
    };
  };
}
export type CanonicalFiles = Pick<
  typeof fs,
  | 'readFileSync'
  | 'writeFileSync'
  | 'existsSync'
  | 'statSync'
  | 'mkdirSync'
  | 'rmdirSync'
  | 'unlinkSync'
  | 'renameSync'
>;
export interface CanonicalOptions {
  configDirectory?: string;
  files?: CanonicalFiles;
  lookup?: (host: string) => Promise<{ address: string }[]>;
}
export class CanonicalSession {
  readonly configDirectory: string;
  readonly file: string;
  readonly lock: string;
  readonly reviewBinding: string;
  readonly betaBinding: string;
  readonly files: CanonicalFiles;
  readonly lookup: (host: string) => Promise<{ address: string }[]>;
  constructor(options: CanonicalOptions = {}) {
    this.configDirectory = options.configDirectory || '/system/config/system';
    this.file = path.join(this.configDirectory, '.projects.env/.wizard.env');
    this.lock = this.file + '.environments.lock';
    this.reviewBinding = this.file + '.system-review.json';
    this.betaBinding = this.file + '.system-beta.json';
    this.files = options.files || fs;
    this.lookup = options.lookup || ((host) => dns.lookup(host, { all: true }));
  }

  read() {
    const { file, configDirectory } = this;
    const text = this.files.readFileSync(file, 'utf8');

    if (
      text[807] !== '$' ||
      crypto.createHash('md5').update(text.slice(0, 1184)).digest('hex') !==
        'bd4a8426355824593a5e21ad759830c1'
    ) {
      throw new Error('signature');
    }

    const lines = text.split('\n').filter((line) => line.startsWith(prefix));

    if (lines.length !== 1) {
      throw new Error('receipt');
    }

    const receipt: CanonicalReceipt = JSON.parse(
      Buffer.from(lines[0].slice(prefix.length), 'base64').toString(),
    );

    if (
      !receipt.defaultProject ||
      receipt.template !== 'wizard' ||
      receipt.state !== 'complete' ||
      !receipt.repository?.systemProject ||
      !(
        (receipt.repository.managementMode === 'source-primary' &&
          receipt.repository.ciPath === '.gitlab/primary.yml') ||
        (!receipt.repository.managementMode &&
          receipt.repository.ciPath === '.system-bootstrapper/ci.yml')
      )
    ) {
      throw new Error('ownership');
    }

    const allowed = new Set([
      'WIZARD_HOST',
      'GITLAB_HOST',
      'GITLAB_REGISTRY_HOST',
      'GITLAB_REGISTRY_URL',
      'GITLAB_REGISTRY_DOMAIN_MODE',
    ]);
    const publicSettings: Record<string, string> = {};
    for (const line of this.files
      .readFileSync(path.join(configDirectory, '.docker.env'), 'utf8')
      .split('\n')) {
      const match = /^(?:export )?([A-Z_]+)=(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*$/.exec(line);

      if (match && allowed.has(match[1])) {
        publicSettings[match[1]] = match[2] ?? match[3] ?? match[4];
      }
    }
    const registry = new URL(publicSettings.GITLAB_REGISTRY_URL);

    if (
      registry.username ||
      registry.password ||
      registry.pathname !== '/' ||
      registry.search ||
      registry.hash
    ) {
      throw new Error('registry');
    }

    return { text, receipt, publicSettings, contentHash: sha(text) };
  }

  async run(action: string, payload: CanonicalPayload) {
    const { file, lock, reviewBinding, betaBinding } = this;

    if (action !== 'read' && action !== 'dns' && !/^[a-f0-9]{48}$/.test(payload.token || '')) {
      throw new Error('token');
    }

    const cancelled = file + '.environments-cancel-' + payload.token;

    if (action === 'unlock') {
      // Unlock by the acquired owner token even if an external administrator
      // changed the reservation while this helper was running.
      // Durable token cancellation also covers a lost acquisition response: a
      // delayed lock command must not acquire after its helper has given up.
      this.files.writeFileSync(cancelled, payload.token!, { mode: 0o600 });
      let owner;
      try {
        owner = JSON.parse(this.files.readFileSync(lock + '/owner', 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { ok: true, notOwned: true };
        }

        throw error;
      }

      if (owner.token !== payload.token) {
        throw new Error('lock-owner');
      }

      this.files.unlinkSync(lock + '/owner');
      this.files.rmdirSync(lock);
      return { ok: true };
    }

    if (action === 'lock') {
      if (this.files.existsSync(cancelled)) {
        throw new Error('cancelled');
      }

      this.files.mkdirSync(lock, { mode: 0o700 });
      const acquired = this.files.statSync(lock);
      const sameDirectory = () => {
        try {
          const now = this.files.statSync(lock);
          return now.dev === acquired.dev && now.ino === acquired.ino;
        } catch (_) {
          return false;
        }
      };
      try {
        // The backend uses the same lock. Re-read after acquiring it rather
        // than relying on a reservation observed before mkdir succeeded.
        const environment = this.read().receipt.wizardWorkflow?.environments;

        if (
          !environment ||
          environment.operation !== payload.operation ||
          environment.controller !== 'system_bootstrapper_1'
        ) {
          throw new Error('reservation');
        }

        this.files.writeFileSync(
          lock + '/owner',
          JSON.stringify({ token: payload.token, helper: payload.helper }),
          { flag: 'wx', mode: 0o600 },
        );

        if (this.files.existsSync(cancelled)) {
          throw new Error('cancelled');
        }

        return { ok: true };
      } catch (error) {
        // An uncertain-acquisition unlock may already have released this
        // directory. Never remove a subsequently acquired replacement mutex.
        if (sameDirectory()) {
          let own;
          try {
            own =
              JSON.parse(this.files.readFileSync(lock + '/owner', 'utf8')).token === payload.token;
          } catch (ownerError) {
            own = (ownerError as NodeJS.ErrnoException).code === 'ENOENT';
          }

          if (own && sameDirectory()) {
            try {
              this.files.unlinkSync(lock + '/owner');
            } catch (_) {
              /* owner was not created */
            }

            if (sameDirectory()) {
              try {
                this.files.rmdirSync(lock);
              } catch (_) {
                /* another owner must reconcile */
              }
            }
          }
        }

        throw error;
      }
    }

    const current = this.read();

    if (action === 'read') {
      const receipt = current.receipt;
      let systemReviewBinding,
        bindingText = '';
      try {
        bindingText = this.files.readFileSync(reviewBinding, 'utf8');
        systemReviewBinding = JSON.parse(bindingText);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
      let systemBetaBinding,
        betaText = '';
      try {
        betaText = this.files.readFileSync(betaBinding, 'utf8');
        systemBetaBinding = JSON.parse(betaText);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
      return {
        systemBetaBinding,
        systemBetaBindingHash: sha(betaText),
        receipt: {
          operation: receipt.operation,
          namespaceId: receipt.namespaceId,
          repository: {
            id: receipt.repository.id,
            path: receipt.repository.path,
            defaultBranch: receipt.repository.defaultBranch,
            ciPath: receipt.repository.ciPath,
            systemProject: receipt.repository.systemProject,
            managementMode: receipt.repository.managementMode,
            namespaceId: receipt.repository.namespaceId,
          },
          sourcePrimary: receipt.sourcePrimary,
          wizardWorkflow: receipt.wizardWorkflow,
        },
        publicSettings: current.publicSettings,
        contentHash: current.contentHash,
        systemReviewBinding,
        systemReviewBindingHash: sha(bindingText),
      };
    }

    const environment = current.receipt.wizardWorkflow?.environments;

    if (
      !environment ||
      environment.operation !== payload.operation ||
      environment.controller !== 'system_bootstrapper_1'
    ) {
      throw new Error('reservation');
    }

    if (action === 'bind-system-review') {
      throw new Error(
        'System Review bindings are retired; retain existing files for owned cleanup.',
      );
    }

    if (action === 'bind-system-beta') {
      const reviewBinding = betaBinding;
      const owner = JSON.parse(this.files.readFileSync(lock + '/owner', 'utf8'));

      if (
        owner.token !== payload.token ||
        current.contentHash !== payload.expectedHash ||
        !payload.binding ||
        JSON.stringify(payload.binding).length > 10000
      ) {
        throw new Error('binding-raced');
      }

      const slot = environment.deployments?.beta || {};

      if (slot.active || slot.pending || slot.retired?.length) {
        throw new Error('review-must-be-stopped');
      }

      let previous = '';
      try {
        previous = this.files.readFileSync(reviewBinding, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      if (sha(previous) !== payload.previousBindingHash) {
        throw new Error('binding-raced');
      }

      const bytes = JSON.stringify(payload.binding, null, 2) + '\n';

      if (previous === bytes) {
        return { ok: true, unchanged: true };
      }

      if (previous) {
        const archive = reviewBinding + '.history';
        this.files.mkdirSync(archive, { recursive: true, mode: 0o700 });
        const saved = path.join(archive, sha(previous) + '.json');

        if (!this.files.existsSync(saved)) {
          this.files.writeFileSync(saved, previous, { flag: 'wx', mode: 0o600 });
        }
      }

      const temporary = reviewBinding + '.' + payload.token;
      this.files.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
      try {
        this.files.renameSync(temporary, reviewBinding);
      } catch (error) {
        this.files.unlinkSync(temporary);
        throw error;
      }
      return { ok: true };
    }

    if (action === 'cas') {
      const owner = JSON.parse(this.files.readFileSync(lock + '/owner', 'utf8'));

      if (owner.token !== payload.token || current.contentHash !== payload.expectedHash) {
        throw new Error('receipt-raced');
      }

      if (JSON.stringify(payload.deployments).length > 100000) {
        throw new Error('receipt-size');
      }

      if (!payload.deployments || typeof payload.deployments !== 'object') {
        throw new Error('receipt-size');
      }

      environment.deployments = payload.deployments;
      const next = current.text
        .split('\n')
        .map((line) =>
          line.startsWith(prefix)
            ? prefix + Buffer.from(JSON.stringify(current.receipt)).toString('base64')
            : line,
        )
        .join('\n');
      const temporary = file + '.environments-' + payload.token;
      this.files.writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 });
      try {
        this.files.renameSync(temporary, file);
      } catch (error) {
        this.files.unlinkSync(temporary);
        throw error;
      }
      return { ok: true, contentHash: sha(next) };
    }

    if (action === 'dns') {
      const production = await this.lookup(current.publicSettings.WIZARD_HOST);
      const addresses = new Set(production.map((row) => row.address));

      if (!addresses.size) {
        throw new Error('production-dns');
      }

      for (const kind of ['review', 'beta'] as const) {
        const setting = environment.settings[kind];

        if (!setting.enabled) {
          continue;
        }

        if (setting.host === current.publicSettings.WIZARD_HOST) {
          throw new Error('production-conflict');
        }

        const candidate = await this.lookup(setting.host);

        if (!candidate.length || candidate.some((row) => !addresses.has(row.address))) {
          throw new Error('candidate-dns');
        }
      }
      return { ok: true };
    }

    throw new Error('action');
  }
}
