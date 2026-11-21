import path from 'node:path';
import crypto from 'node:crypto';
import {
  release,
  readRecord,
  type Aliases,
  type RunnerPlan,
  type UpgradeOptions,
  type Container,
} from './types';
export const hash = (bytes: string | Buffer) =>
  crypto.createHash('sha256').update(bytes).digest('hex');
export const cube = (text: string) => {
  if (
    text[807] !== '$' ||
    crypto.createHash('md5').update(text.slice(0, 1184)).digest('hex') !==
      'bd4a8426355824593a5e21ad759830c1'
  )
    throw Error('upgrade-cube-invalid');
};

export { run } from './native-process';

export function imageAssignment(text: string, image: string, aliases: Aliases = {}) {
  cube(text);
  if (![release.fromImage, release.toImage, ...Object.values(aliases)].includes(image))
    throw Error('upgrade-image-not-approved');
  const re = /^(?:export )?GITLAB_IMAGE=.*$/gm;
  const matches = [...text.matchAll(re)];
  if (matches.length > 1) throw Error('upgrade-duplicate-image-assignment');
  const line = "export GITLAB_IMAGE='" + image + "'";
  const result = matches.length
    ? text.replace(re, () => line)
    : text.replace(/\n?$/, '\n') + line + '\n';
  cube(result);
  return result;
}

export function runnerAssignment(text: string, image: string, aliases: Aliases = {}) {
  cube(text);
  if (
    ![release.runner.fromImage, release.runner.toImage, ...Object.values(aliases)].includes(image)
  )
    throw Error('upgrade-runner-image-not-approved');
  const re = /^(?:export )?GITLAB_RUNNER_IMAGE=.*$/gm,
    matches = [...text.matchAll(re)];
  if (matches.length !== 1) throw Error('upgrade-runner-image-assignment-required');
  const result = text.replace(re, () => "export GITLAB_RUNNER_IMAGE='" + image + "'");
  cube(result);
  return result;
}

export function runnerSelection(
  text: string,
  aliases: Aliases = {},
  verifyRetained?: (selected: string, pinned: string) => void,
) {
  const matches = [...text.matchAll(/^(?:export )?GITLAB_RUNNER_IMAGE=(.*)$/gm)];
  if (matches.length !== 1) throw Error('upgrade-runner-image-assignment-required');
  const raw = matches[0][1],
    value = /^(['"])(.*)\1$/.exec(raw)?.[2] || raw;
  for (const reference of [release.runner.fromImage, release.runner.toImage])
    if (value === (aliases[reference] || reference)) return reference;
  if (value === release.runner.fromImage.split('@')[0] && verifyRetained) {
    verifyRetained(value, release.runner.fromImage);
    return release.runner.fromImage;
  }
  throw Error('upgrade-runner-image-not-approved');
}

export function runnerHelper(content: string, image?: string, aliases: Aliases = {}) {
  let active = false,
    sections = 0,
    found = 0;
  const lines = content.split('\n'),
    allowed = [
      release.runner.fromHelperImage,
      release.runner.helperImage,
      ...Object.values(aliases),
      '',
    ];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^\s*\[/.test(line)) {
      active = /^\s*\[runners\.docker\]\s*$/.test(line);
      if (active) sections++;
    }
    if (active && /^\s*helper_image\s*=/.test(line)) {
      const match = /^\s*helper_image\s*=\s*"([^"\r\n]*)"\s*$/.exec(line);
      if (!match || !allowed.includes(match[1]) || ++found > 1)
        throw Error('upgrade-unreviewed-runner-helper');
      if (image) lines[index] = '    helper_image = "' + image + '"';
    }
  }
  if (sections !== 1) throw Error('upgrade-single-runner-docker-section-required');
  if (image && !allowed.includes(image)) throw Error('upgrade-unreviewed-runner-helper');
  if (image && !found) {
    const index = lines.findIndex((line) => /^\s*\[runners\.docker\]\s*$/.test(line));
    lines.splice(index + 1, 0, '    helper_image = "' + image + '"');
  }
  return lines.join('\n');
}

export function runnerCheckpoint(value: RunnerPlan | undefined) {
  if (!value) return;
  if (
    ![release.runner.fromImage, release.runner.toImage].includes(value.fromImage) ||
    !Number.isInteger(value.scale) ||
    value.scale < 0 ||
    value.scale > 50 ||
    !Array.isArray(value.configurations) ||
    value.configurations.length > 5000
  )
    throw Error('upgrade-runner-checkpoint-invalid');
  const paths = new Set();
  for (const row of value.configurations) {
    if (
      typeof row.path !== 'string' ||
      row.path.length > 256 ||
      !/^(?:runner|[a-z0-9][a-z0-9_-]*_runner)\/(?:[1-9]|[1-4][0-9]|50)\/config$/.test(row.path) ||
      paths.has(row.path) ||
      !/^[a-f0-9]{64}$/.test(row.sha256 || '') ||
      !/^[a-f0-9]{64}$/.test(row.managerIdentitySha256 || '')
    )
      throw Error('upgrade-runner-checkpoint-invalid');
    paths.add(row.path);
  }
  for (let index = 1; index <= value.scale; index++)
    if (!paths.has('runner/' + index + '/config')) throw Error('upgrade-runner-checkpoint-invalid');
}

export function options(value: unknown): UpgradeOptions {
  const candidate = readRecord(value);
  if (
    !candidate ||
    Object.keys(candidate).some(
      (k) =>
        ![
          'sourceRevision',
          'evidence',
          'stateDir',
          'persistentDir',
          'checkpointDir',
          'readyTimeoutSeconds',
        ].includes(k),
    ) ||
    !/^[a-f0-9]{40}$/.test(
      typeof candidate.sourceRevision === 'string' ? candidate.sourceRevision : '',
    )
  )
    throw Error('upgrade-options-invalid');
  for (const key of ['evidence', 'stateDir', 'persistentDir', 'checkpointDir'])
    if (
      !path.isAbsolute(typeof candidate[key] === 'string' ? candidate[key] : '') ||
      path.resolve(String(candidate[key])) !== candidate[key]
    )
      throw Error('upgrade-options-invalid');
  if (
    candidate.stateDir !== '/state' ||
    typeof candidate.checkpointDir !== 'string' ||
    !candidate.checkpointDir.startsWith('/state/gitlab-upgrades/')
  )
    throw Error('upgrade-state-boundary-invalid');
  if (
    typeof candidate.readyTimeoutSeconds !== 'number' ||
    !Number.isInteger(candidate.readyTimeoutSeconds) ||
    candidate.readyTimeoutSeconds < 60 ||
    candidate.readyTimeoutSeconds > 1800
  )
    throw Error('upgrade-readiness-budget-invalid');
  return candidate as unknown as UpgradeOptions;
}

export function terminalContainerState(container: Container) {
  const state = container.State || {};
  if (state.OOMKilled === true) return 'oom';
  // Docker marks a container dead while removing it; only its explicit removal
  // status establishes this transitional state rather than a terminal failure.
  if (state.Status === 'removing') return;
  if (state.Dead === true || state.Status === 'dead') return 'dead';
  if (state.Status !== 'exited' || state.Running === true || state.Restarting === true) return;
  const policy = container.HostConfig?.RestartPolicy;
  // An exited container may still have a restart scheduled. Only explicit
  // policies and exhausted retry counts establish that it will stay down.
  if (policy?.Name === 'no' || policy?.Name === '') return 'exited';
  if (
    policy?.Name === 'on-failure' &&
    (state.ExitCode === 0 ||
      (typeof policy.MaximumRetryCount === 'number' &&
        Number.isInteger(policy.MaximumRetryCount) &&
        policy.MaximumRetryCount > 0 &&
        typeof container.RestartCount === 'number' &&
        Number.isInteger(container.RestartCount) &&
        container.RestartCount >= policy.MaximumRetryCount))
  )
    return 'exited';
}

export {
  regular,
  jsonBytes,
  json,
  atomic,
  durableDirectory,
  durableAncestors,
  inventoryAt,
  inventory,
  INPUT_JSON_MAX_BYTES,
  CHECKPOINT_JSON_MAX_BYTES,
} from './checkpoint-files';
