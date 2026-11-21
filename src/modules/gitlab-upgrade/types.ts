import fs from 'node:fs';
import path from 'node:path';
export const ROOT = path.resolve(__dirname, '../../..');
export const GITLAB = path.join(ROOT, 'config/gitlab');
export type Aliases = Record<string, string>;
export interface ReleaseProfile {
  fromImage: string;
  toImage: string;
  fromVersion: string;
  toVersion: string;
  jobCaBundleSha256: string;
  runner: {
    fromImage: string;
    toImage: string;
    fromVersion: string;
    toVersion: string;
    fromHelperImage: string;
    helperImage: string;
  };
}
export const release: ReleaseProfile = parseRelease(
  fs.readFileSync(path.join(GITLAB, 'security-release.json'), 'utf8'),
);
/** The standalone watchdog is a native process-group boundary, not an operation service. */
export interface ChildJournal {
  uptime(): number;
  activeGroup(group: number): boolean;
  stat(pid: number): { state: string; start: string } | null;
}
export { childJournal };
import * as childJournal from './child-journal';
export interface CommandOptions {
  timeout?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
  detached?: boolean;
}
export type Command = (binary: string, args: string[], options?: CommandOptions) => string;
export interface UpgradeOptions {
  sourceRevision: string;
  evidence: string;
  stateDir: string;
  persistentDir: string;
  checkpointDir: string;
  readyTimeoutSeconds: number;
}
export interface UpgradeDependencies {
  run?: Command;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  serviceData?: string;
  seed?: string;
  certbot?: string;
  imageIds?: Aliases;
  aliases?: Aliases;
  runnerAliases?: Aliases;
  helperAliases?: Aliases;
  runnerData?: string;
  /** Native public-release adapter only; the running helper must itself be the tested candidate. */
  publicExecution?: PublicPrerequisiteExecution;
}
export interface PublicPrerequisiteExecution {
  containerId: string;
  preparationSha256: string;
  recoveryCheckpoint?: string;
  controller: {
    Id: string;
    Image: string;
    Mounts: unknown;
    restartPolicy: unknown;
    labels: unknown;
  };
}
export interface Container {
  Id: string;
  Image: string;
  State: {
    Running?: boolean;
    OOMKilled?: boolean;
    Dead?: boolean;
    Status?: string;
    Restarting?: boolean;
    ExitCode?: number;
    Paused?: boolean;
  };
  Config?: { Labels?: Record<string, string>; Hostname?: string };
  Mounts?: { Destination: string; RW?: boolean; Type: string; Name: string; Source?: string }[];
  HostConfig?: {
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number };
    PidMode?: string;
    NetworkMode?: string;
  };
  RestartCount?: number;
}
export interface Image {
  Id: string;
  RepoDigests?: string[];
}
export interface RunnerConfiguration {
  path: string;
  sha256: string;
  managerIdentitySha256: string;
}
export interface RunnerPlan {
  fromImage: string;
  fromImageId: string;
  toImageId: string;
  helperImageId: string;
  fromHelperImageId: string;
  scale: number;
  configurations: RunnerConfiguration[];
}
export interface EvidenceReceipt {
  sha256: string;
  candidateImage: string;
}
export interface UpgradePlan {
  format: string;
  sourceRevision: string;
  releaseSha256: string;
  evidence: EvidenceReceipt;
  containerId: string;
  fromImageId: string;
  toImageId: string;
  configurationSha256: string;
  runner?: RunnerPlan;
  checkpointDir: string;
}
export interface PlanReceipt {
  plan: UpgradePlan;
  planSha256: string;
}
export interface InventoryRoot {
  full: string;
  path: string;
}
export interface InventoryEntry {
  path: string;
  mode: number;
  uid: number;
  gid: number;
  type?: string;
  target?: string;
  size?: number;
  sha256?: string;
}
export interface Checkpoint {
  format: string;
  sourceRevision: string;
  createdAt: string;
  plan: UpgradePlan;
  entries: InventoryEntry[];
}
export interface CheckpointReceipt {
  checkpoint: Checkpoint;
  checkpointSha256: string;
}
export interface UpgradeOwner {
  format: string;
  operation: string;
  pid: number;
  start?: string;
  planSha256?: string;
  checkpointSha256?: string;
  phase?: string;
  quiesceDeadline?: number;
  runnersStopped?: boolean;
}
export interface ChildRecord {
  format: string;
  operation: string;
  group: number;
  watchdogPid: number;
  watchdogStart: string;
}
export interface OperationReceipt {
  status: string;
  checkpointSha256?: string;
  toImage?: string;
}
export interface OperationStatus {
  phase: unknown;
  locked: boolean;
  checkpointSha256: unknown;
  planSha256: unknown;
}
interface AcceptanceEvidence {
  sourceRevision?: unknown;
  results: { name?: unknown; status?: unknown }[];
  fullAcceptance?: unknown;
  evidence?: { gitlabUpgrade?: Record<string, unknown> };
  images: Record<string, string>;
}
export function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('upgrade-input-invalid');
  return value as Record<string, unknown>;
}
export function parseRecord(raw: string): Record<string, unknown> {
  return readRecord(JSON.parse(raw) as unknown);
}
function stringFields(value: Record<string, unknown>, fields: string[]): void {
  for (const key of fields)
    if (typeof value[key] !== 'string') throw Error('upgrade-input-invalid');
}
function optionalFields(
  value: Record<string, unknown>,
  kind: 'number' | 'boolean' | 'string',
  fields: string[],
): void {
  for (const key of fields)
    if (value[key] !== undefined && typeof value[key] !== kind)
      throw Error('upgrade-input-invalid');
}
function parseRelease(raw: string): ReleaseProfile {
  const value = parseRecord(raw),
    runner = readRecord(value.runner);
  stringFields(value, ['fromImage', 'toImage', 'fromVersion', 'toVersion', 'jobCaBundleSha256']);
  stringFields(runner, [
    'fromImage',
    'toImage',
    'fromVersion',
    'toVersion',
    'fromHelperImage',
    'helperImage',
  ]);
  return value as unknown as ReleaseProfile;
}
export function parseContainer(raw: string): Container {
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || !values.length) throw Error('upgrade-input-invalid');
  const value = readRecord(values[0]);
  // Docker fields absent in older responses stay absent; use sites decide whether they are required.
  optionalFields(value, 'string', ['Id', 'Image']);
  const state = readRecord(value.State || {});
  optionalFields(state, 'boolean', ['Running', 'OOMKilled', 'Dead', 'Restarting', 'Paused']);
  optionalFields(state, 'string', ['Status']);
  optionalFields(state, 'number', ['ExitCode']);
  if (value.Config !== undefined) {
    const config = readRecord(value.Config);
    if (config.Labels !== undefined) {
      const labels = readRecord(config.Labels);
      for (const label of Object.values(labels))
        if (typeof label !== 'string') throw Error('upgrade-input-invalid');
    }
  }
  if (value.Mounts !== undefined) {
    if (!Array.isArray(value.Mounts)) throw Error('upgrade-input-invalid');
    for (const item of value.Mounts) {
      const mount = readRecord(item);
      stringFields(mount, ['Destination', 'Type']);
      optionalFields(mount, 'string', ['Name', 'Source']);
      optionalFields(mount, 'boolean', ['RW']);
    }
  }
  if (value.HostConfig !== undefined) {
    const host = readRecord(value.HostConfig);
    if (host.RestartPolicy !== undefined) {
      const policy = readRecord(host.RestartPolicy);
      optionalFields(policy, 'string', ['Name']);
      optionalFields(policy, 'number', ['MaximumRetryCount']);
    }
  }
  optionalFields(value, 'number', ['RestartCount']);
  return value as unknown as Container;
}
export function parseImage(raw: string): Image {
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || !values.length) throw Error('upgrade-input-invalid');
  const value = readRecord(values[0]);
  stringFields(value, ['Id']);
  if (
    value.RepoDigests !== undefined &&
    (!Array.isArray(value.RepoDigests) ||
      value.RepoDigests.some((item) => typeof item !== 'string'))
  )
    throw Error('upgrade-input-invalid');
  return value as unknown as Image;
}
export function parseOwner(input: unknown): UpgradeOwner {
  const value = readRecord(input);
  stringFields(value, ['format', 'operation']);
  if (typeof value.pid !== 'number')
    throw Error('upgrade-interrupted-operation-requires-inspection');
  optionalFields(value, 'string', ['start', 'planSha256', 'checkpointSha256', 'phase']);
  optionalFields(value, 'number', ['quiesceDeadline']);
  optionalFields(value, 'boolean', ['runnersStopped']);
  return value as unknown as UpgradeOwner;
}
export function parseChild(input: unknown): ChildRecord {
  const value = readRecord(input);
  stringFields(value, ['format', 'operation', 'watchdogStart']);
  for (const key of ['group', 'watchdogPid'])
    if (typeof value[key] !== 'number') throw Error('upgrade-operation-child-still-running');
  return value as unknown as ChildRecord;
}
export function parseCheckpoint(raw: string): Checkpoint {
  const value = parseRecord(raw),
    plan = readRecord(value.plan);
  if (plan.runner !== undefined) {
    const runner = readRecord(plan.runner);
    if (!Array.isArray(runner.configurations)) throw Error('upgrade-runner-checkpoint-invalid');
    for (const row of runner.configurations) readRecord(row);
  }
  if (!Array.isArray(value.entries)) throw Error('upgrade-checkpoint-verification-failed');
  for (const row of value.entries) {
    const entry = readRecord(row);
    stringFields(entry, ['path', 'type']);
  }
  return value as unknown as Checkpoint;
}
export function parseEvidence(raw: string): AcceptanceEvidence {
  const value = parseRecord(raw);
  if (!Array.isArray(value.results)) throw Error('upgrade-passing-successor-evidence-required');
  for (const row of value.results) readRecord(row);
  if (value.evidence !== undefined) {
    const evidence = readRecord(value.evidence);
    if (evidence.gitlabUpgrade !== undefined) readRecord(evidence.gitlabUpgrade);
  }
  const images = readRecord(value.images);
  for (const image of Object.values(images))
    if (typeof image !== 'string') throw Error('upgrade-passing-successor-evidence-required');
  return value as unknown as AcceptanceEvidence;
}
