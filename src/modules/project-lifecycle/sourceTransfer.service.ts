import { cliRepositoryPath } from '../project-ci/cliFileEvidence';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
export interface GitOptions {
  trim?: boolean;
  encoding?: 'base64';
  maxBuffer?: number;
  mutating?: boolean;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}
export interface SourceTransferInput {
  origin: string;
  destination: string;
  token: string;
  username?: string;
  approvedFiles?: { path: string; sha256: string }[];
}
export interface SourceTransferPort {
  run(args: string[], options?: GitOptions): Promise<string>;
  lookup(host: string): Promise<{ address: string }[]>;
}
export const sourceTransferPort = Symbol('SOURCE_TRANSFER_PORT');

function run(args: string[], options: GitOptions = {}): Promise<string> {
  const { trim = true, mutating = false, ...execution } = options;
  return new Promise((resolve, reject) =>
    execFile(
      'git',
      args,
      { timeout: 240000, maxBuffer: 4000000, ...execution },
      (error, stdout) => {
        // Git errors can include authentication material; return a fixed diagnostic.
        if (error) {
          reject(
            Object.assign(
              Error(
                'Source transfer failed. Inspect project ownership and remote refs before explicitly resuming.',
              ),
              mutating && !['ENOENT', 'EACCES'].includes(String(error.code))
                ? { uncertain: true, action: 'preview-source-push' }
                : {},
            ),
          );
        } else {
          resolve(trim ? stdout.trim() : stdout);
        }
      },
    ),
  );
}
export function publicAddress(address: string) {
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && [18, 19].includes(b)) ||
      (a === 192 && b === 0 && [0, 2].includes(c)) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }

  return net.isIPv6(address) && /^[23][a-f0-9]{3}:/i.test(address) && !/^2001:db8:/i.test(address);
}
function gitEnvironment() {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(?:GIT_|PREVIEW_GIT_|SSH_ASKPASS)/.test(key)),
  );
  return {
    ...environment,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_LFS_SKIP_SMUDGE: '1',
  };
}
export async function originPreflight(
  origin: string,
  port: SourceTransferPort = nativeSourceTransferPort,
) {
  const url = new URL(origin);
  const addresses = await port.lookup(url.hostname);

  if (!addresses.length || addresses.some((row) => !publicAddress(row.address))) {
    throw Error('The source origin must resolve only to public network addresses.');
  }

  // Disable redirects and prompts for every source read; credentials are never sent upstream.
  const pins = addresses.flatMap((row) => [
    '-c',
    'http.curloptResolve=' +
      url.hostname +
      ':443:' +
      (row.address.includes(':') ? '[' + row.address + ']' : row.address),
  ]);
  // Git receives the already validated addresses; it cannot resolve the host
  // again between validation and transfer. Disable proxy re-resolution too.
  return {
    pins,
    head: await port.run(
      [
        ...pins,
        '-c',
        'http.followRedirects=false',
        '-c',
        'http.proxy=',
        '-c',
        'protocol.allow=never',
        '-c',
        'protocol.https.allow=always',
        'ls-remote',
        '--symref',
        origin,
        'HEAD',
      ],
      { env: gitEnvironment(), cwd: os.tmpdir() },
    ),
  };
}
export async function transfer(
  { origin, destination, token, username = 'oauth2', approvedFiles = [] }: SourceTransferInput,
  port: SourceTransferPort = nativeSourceTransferPort,
) {
  const verified = await originPreflight(origin, port);
  const url = new URL(destination);

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !token ||
    !username ||
    /[:\r\n\0]/.test(username) ||
    /[\r\n\0]/.test(token)
  ) {
    throw Error(
      'Use the configured TLS GitLab destination and a scoped temporary repository credential.',
    );
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrapper-preview-source-'));
  try {
    const sourceEnv = gitEnvironment();
    await port.run(
      [
        ...verified.pins,
        '-c',
        'http.followRedirects=false',
        '-c',
        'http.proxy=',
        '-c',
        'protocol.allow=never',
        '-c',
        'protocol.https.allow=always',
        'clone',
        '--bare',
        '--',
        origin,
        path.join(directory, 'source.git'),
      ],
      { env: sourceEnv, cwd: directory },
    );
    for (const file of approvedFiles) {
      const content = await port.run(['show', 'HEAD:' + file.path], {
        cwd: path.join(directory, 'source.git'),
        env: sourceEnv,
        trim: false,
        ...(file.path === cliRepositoryPath
          ? { encoding: 'base64' as const, maxBuffer: 12 * 1024 * 1024 }
          : {}),
      });

      if (
        crypto
          .createHash('sha256')
          .update(file.path === cliRepositoryPath ? Buffer.from(content, 'base64') : content)
          .digest('hex') !== file.sha256
      ) {
        throw Error(
          'Source CI producers differ from the accepted controller. No refs were pushed; use the explicit reviewed source-primary path.',
        );
      }
    }
    // Git consumes credentials only for this HTTPS destination, without a helper
    // program, secret-bearing argv or a credential file in the temporary clone.
    const authorization =
      'Authorization: Basic ' + Buffer.from(username + ':' + token).toString('base64');
    const env = {
      ...sourceEnv,
      GIT_CONFIG_COUNT: '3',
      GIT_CONFIG_KEY_0: 'credential.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'http.' + destination + '.extraHeader',
      GIT_CONFIG_VALUE_1: '',
      GIT_CONFIG_KEY_2: 'http.' + destination + '.extraHeader',
      GIT_CONFIG_VALUE_2: authorization,
    };
    const cwd = path.join(directory, 'source.git');
    const refs = (
      await port.run(
        ['for-each-ref', '--format=%(objectname) %(refname)', 'refs/heads', 'refs/tags'],
        { cwd, env: sourceEnv },
      )
    )
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(' '));

    if (!refs.length || refs.length > 500) {
      throw Error('Import requires a bounded source repository with at least one branch.');
    }

    const defaultRef = await port.run(['symbolic-ref', '--quiet', 'HEAD'], { cwd, env: sourceEnv });
    const advertised = verified.head.split('\n');
    const defaultHead = refs.find(([, name]) => name === defaultRef);

    if (
      !/^refs\/heads\//.test(defaultRef) ||
      !defaultHead ||
      !advertised.includes('ref: ' + defaultRef + '\tHEAD') ||
      !advertised.includes(defaultHead[0] + '\tHEAD')
    ) {
      throw Error(
        'The source default branch changed or is unavailable. No refs were pushed; run preflight again.',
      );
    }

    const historical = refs.filter(([, name]) => name !== defaultRef);
    const actualRefs = async () =>
      (
        await port.run(
          ['-c', 'http.followRedirects=false', 'ls-remote', '--heads', '--tags', destination],
          { env },
        )
      )
        .split('\n')
        .filter(Boolean)
        .filter((line) => !line.endsWith('^{}') && /\srefs\/(?:heads|tags)\//.test(line))
        .map((line) => line.split(/\s+/));
    const same = (actual: string[][], expected: string[][]) =>
      actual.length === expected.length &&
      actual.every(([sha, name]) =>
        expected.some(
          ([expectedSha, expectedName]) => sha === expectedSha && name === expectedName,
        ),
      );
    const conflict = () =>
      Error(
        'The imported project contains changed or additional refs. Preserve operator edits and reconcile manually.',
      );
    let actual = await actualRefs();

    // Only an exact complete import or our exact default-only intermediate
    // state can resume. Never turn arbitrary partial/operator refs into leases.
    if (same(actual, refs)) {
      return { unchanged: true };
    }

    if (actual.length && !same(actual, [defaultHead])) {
      throw conflict();
    }

    const push = async (selected: string[][], skipCI: boolean) =>
      port.run(
        [
          '-c',
          'http.followRedirects=false',
          'push',
          '--atomic',
          '--no-follow-tags',
          ...(skipCI ? ['--push-option=ci.skip'] : []),
          ...selected.map(([, name]) => '--force-with-lease=' + name + ':'),
          destination,
          ...selected.map(([, name]) => name + ':' + name),
        ],
        { cwd, env, mutating: true },
      );

    if (!actual.length) {
      // GitLab bounds pipelines per push. Give the source default branch its
      // own ordinary push, so historical refs cannot displace its native CI.
      await push([defaultHead], false);
      actual = await actualRefs();

      if (same(actual, refs)) {
        return { imported: true };
      }

      if (!same(actual, [defaultHead])) {
        throw conflict();
      }
    }

    // Preserve history without running obsolete branch/tag CI. The candidate's
    // default-branch pipeline above is never skipped or recreated through API.
    await push(historical, true);

    if (!same(await actualRefs(), refs)) {
      throw conflict();
    }

    return { imported: true };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export const nativeSourceTransferPort: SourceTransferPort = {
  run,
  lookup: (host) => dns.lookup(host, { all: true }),
};
@Injectable()
export class SourceTransferService {
  constructor(@Inject(sourceTransferPort) private readonly port: SourceTransferPort) {}

  transfer(input: SourceTransferInput) {
    return transfer(input, this.port);
  }

  preflight(origin: string) {
    return originPreflight(origin, this.port);
  }
}
