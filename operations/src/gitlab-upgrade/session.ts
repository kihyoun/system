import path from 'node:path';
import { options } from './policy';
import type {
  UpgradeOptions,
  UpgradeDependencies,
  UpgradeOwner,
  Aliases,
  Command,
  CommandOptions,
  Container,
  EvidenceReceipt,
  RunnerPlan,
  PlanReceipt,
  UpgradePlan,
  CheckpointReceipt,
  Checkpoint,
  OperationReceipt,
  OperationStatus,
  PublicPrerequisiteExecution,
} from './types';
import { UpgradeGuardianService } from './guardian.service';
import { UpgradeRuntimeService } from './runtime.service';
import { UpgradeRunnerService } from './runner.service';
import { UpgradeCheckpointService } from './checkpoint.service';
import { UpgradeWorkflowService } from './workflow.service';
export interface UpgradeCapabilities {
  guardian: UpgradeGuardianService;
  runtime: UpgradeRuntimeService;
  runner: UpgradeRunnerService;
  checkpoint: UpgradeCheckpointService;
  workflow: UpgradeWorkflowService;
}
export class UpgradeSession {
  readonly options: UpgradeOptions;
  run: Command;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  serviceData: string;
  seed: string;
  certbot: string;
  imageIds?: Aliases;
  aliases: Aliases;
  runnerAliases: Aliases;
  helperAliases: Aliases;
  runnerData: string;
  state: string;
  config: string;
  checkpoints: string;
  operation!: string;
  owner!: UpgradeOwner;
  held: string[] = [];
  readonly publicExecution?: PublicPrerequisiteExecution;
  constructor(
    input: unknown,
    dependencies: UpgradeDependencies,
    private readonly capabilities: UpgradeCapabilities,
  ) {
    this.options = options(input);
    this.publicExecution = dependencies.publicExecution;
    this.run = dependencies.run || ((binary, args, opts) => this.ownedRun(binary, args, opts));
    this.sleep = dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = dependencies.now || Date.now;
    this.serviceData = dependencies.serviceData || '/srv/gitlab';
    this.seed = dependencies.seed || '/seed';
    this.certbot = dependencies.certbot || '/host-letsencrypt';
    this.imageIds = dependencies.imageIds;
    this.aliases = dependencies.aliases || {};
    this.runnerAliases = dependencies.runnerAliases || {};
    this.helperAliases = dependencies.helperAliases || {};
    this.runnerData = dependencies.runnerData || path.join(this.options.persistentDir, 'runners');
    this.state = this.options.stateDir;
    this.config = path.join(this.state, '.docker.env');
    this.checkpoints = this.options.checkpointDir;
  }
  ownedRun(binary: string, args: string[], opts: CommandOptions = {}): string {
    return this.capabilities.guardian.ownedRun(this, binary, args, opts);
  }
  lock(planSha256?: string): void {
    return this.capabilities.guardian.lock(this, planSha256);
  }
  updateOwner(checkpointSha256?: string): void {
    return this.capabilities.guardian.updateOwner(this, checkpointSha256);
  }
  unlock(): void {
    return this.capabilities.guardian.unlock(this);
  }
  adopt(expected: string, field: 'planSha256' | 'checkpointSha256'): void {
    return this.capabilities.guardian.adopt(this, expected, field);
  }
  quiesceFinished(): Promise<void> {
    return this.capabilities.guardian.quiesceFinished(this);
  }
  docker(args: string[], opts?: CommandOptions): string {
    return this.capabilities.runtime.docker(this, args, opts);
  }
  inspect(name: string): Container {
    return this.capabilities.runtime.inspect(this, name);
  }
  image(reference: string): string {
    return this.capabilities.runtime.image(this, reference);
  }
  verifyMounts(container: Container): void {
    return this.capabilities.runtime.verifyMounts(this, container);
  }
  preflight(version: string): Promise<Container> {
    return this.capabilities.runtime.preflight(this, version);
  }
  stop(): Promise<void> {
    return this.capabilities.runtime.stop(this);
  }
  ready(version: string, image: string): Promise<void> {
    return this.capabilities.runtime.ready(this, version, image);
  }
  start(reference: string, restore = false): void {
    return this.capabilities.runtime.start(this, reference, restore);
  }
  syncIdle(): void {
    return this.capabilities.runtime.syncIdle(this);
  }
  resumeScheduling(): Promise<void> {
    return this.capabilities.runtime.resumeScheduling(this);
  }
  quiesceScheduling(): Promise<void> {
    return this.capabilities.runtime.quiesceScheduling(this);
  }
  runnerReference(text = this.configuration()): string {
    return this.capabilities.runner.runnerReference(this, text);
  }
  runnerPlan(verifyRunning = true): RunnerPlan {
    return this.capabilities.runner.runnerPlan(this, verifyRunning);
  }
  runnerPool(script: 'start' | 'stop'): void {
    return this.capabilities.runner.runnerPool(this, script);
  }
  runnersStopped(plan: RunnerPlan): void {
    return this.capabilities.runner.runnersStopped(this, plan);
  }
  runnersReady(plan: RunnerPlan, restore = false): void {
    return this.capabilities.runner.runnersReady(this, plan, restore);
  }
  configuration(): string {
    return this.capabilities.checkpoint.configuration(this);
  }
  snapshot(plan: UpgradePlan): CheckpointReceipt {
    return this.capabilities.checkpoint.snapshot(this, plan);
  }
  checkpoint(expected: string): Checkpoint {
    return this.capabilities.checkpoint.checkpoint(this, expected);
  }
  evidence(): EvidenceReceipt {
    return this.capabilities.workflow.evidence(this);
  }
  plan(): Promise<PlanReceipt> {
    return this.capabilities.workflow.plan(this);
  }
  migrate(plan: UpgradePlan): Promise<OperationReceipt> {
    return this.capabilities.workflow.migrate(this, plan);
  }
  promote(expected: string): Promise<OperationReceipt> {
    return this.capabilities.workflow.promote(this, expected);
  }
  abort(expected: string): Promise<OperationReceipt> {
    return this.capabilities.workflow.abort(this, expected);
  }
  status(): OperationStatus {
    return this.capabilities.workflow.status(this);
  }
  rollback(expected: string): Promise<OperationReceipt> {
    return this.capabilities.workflow.rollback(this, expected);
  }
  restoreCheckpoint(checkpoint: Checkpoint): void {
    this.capabilities.checkpoint.restore(this, checkpoint);
  }
}
