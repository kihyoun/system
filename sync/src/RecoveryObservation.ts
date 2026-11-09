import {execFileSync} from 'child_process';
import fs from 'fs';
import path from 'path';
import {configDirectory} from './StatePaths';

/** Inspect platform containers; Config.Env and credentials never leave this module. */
export function recoveryObservation(inspect = (args: string[]) => execFileSync('docker',
  ['--host=unix:///var/run/docker.sock', ...args], {timeout: 1500, maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore']}).toString(), receipt = () => {
  const file = path.join(configDirectory(), '.release-images.json'), stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}): any {
  const revision = (value: any) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
  const reference = (value: any) => typeof value === 'string' && value.length <= 500 &&
    /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(value) ? value : null;
  const imageId = (value: any) => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
  const running = (value: any) => value && value.State?.Running === true && imageId(value.Image);
  const containers: any = {};
  for (const [role, name] of Object.entries({controller: 'system_bootstrapper_1', wizard: 'system_wizard_1', gitlab: 'system_gitlab_1'})) {
    try {
      const rows = JSON.parse(inspect(['container', 'inspect', name]));
      containers[role] = Array.isArray(rows) && rows.length === 1 && running(rows[0]) ? rows[0] : null;
    } catch { containers[role] = null; }
  }
  // Main and project pools use independently named runner_docker_N managers.
  // Scale zero and stopped/absent managers do not establish a running version.
  containers.runner = [];
  try {
    const names = inspect(['container', 'ls', '--filter', 'name=runner_docker_', '--format', '{{.Names}}'])
      .trim().split('\n').filter(name => /^(?:[a-z0-9][a-z0-9_-]*_)?runner_docker_[1-9][0-9]*$/.test(name)).slice(0, 50);
    if (names.length) {
      const rows = JSON.parse(inspect(['container', 'inspect', ...names]));
      if (Array.isArray(rows)) containers.runner = rows.filter(running);
    }
  } catch { /* An unavailable daemon is an unknown version. */ }
  const all = [...Object.values(containers).filter(value => value && !Array.isArray(value)), ...containers.runner] as any[];
  const details = new Map();
  try {
    const ids = Array.from(new Set(all.map(row => row.Image)));
    if (ids.length) {
      const rows = JSON.parse(inspect(['image', 'inspect', ...ids]));
      if (Array.isArray(rows)) for (const row of rows) if (ids.includes(row.Id)) details.set(row.Id, row);
    }
  } catch { /* Keep independent container observations; image digest remains unknown. */ }
  const observation = (row: any) => {
    if (!row) return null;
    const image = details.get(row.Image), labels = image?.Config?.Labels || {};
    return {status: 'running', imageId: row.Image, reference: reference(row.Config?.Image),
      repositoryDigests: Array.isArray(image?.RepoDigests) ? image.RepoDigests.filter((item: any) => reference(item) && /@sha256:[a-f0-9]{64}$/.test(item)) : [],
      versionLabel: /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(labels['org.opencontainers.image.version'] || '')
        ? labels['org.opencontainers.image.version'] : null,
      sourceRevision: revision(labels['org.opencontainers.image.revision']),
      systemSourceRevision: revision(labels['org.system-bootstrapper.source-revision'])};
  };
  const images: any = Object.fromEntries(Object.entries(containers).map(([role, value]: [string, any]) =>
    [role, Array.isArray(value) ? value.map(observation) : observation(value)]));
  let release = null;
  try {
    const selected = receipt(), product = selected?.productRelease;
    if (product && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(product.version) &&
      product.tag === 'v' + product.version && product.sourceRevision === images.controller?.sourceRevision &&
      selected.images?.controller?.imageId === images.controller?.imageId &&
      selected.images?.wizard?.imageId === images.wizard?.imageId &&
      images.wizard?.systemSourceRevision === images.controller?.sourceRevision) release = product.version;
  } catch { /* Unrecorded or changed image pairs have no verified product release identity. */ }
  return {format: 'system-runtime-observation-v1', observedAt: new Date().toISOString(),
    status: all.length ? 'partial' : 'unavailable',
    system: images.controller ? {sourceRevision: images.controller.sourceRevision, release: release || images.controller.versionLabel,
      releaseOrigin: release ? 'accepted-pair-receipt' : images.controller.versionLabel ? 'image-label' : null} : null,
    wizard: images.wizard ? {sourceRevision: images.wizard.sourceRevision, release: release || images.wizard.versionLabel,
      releaseOrigin: release ? 'accepted-pair-receipt' : images.wizard.versionLabel ? 'image-label' : null} : null, images};
}
