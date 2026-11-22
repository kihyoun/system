import type { BuildRecipe } from '../project-lifecycle/buildRecipe.service';
import type { EnvironmentRecipeOptions } from '../project-lifecycle/environmentRecipe.service';
import type {
  EnvironmentJob,
  EnvironmentOutcome,
  EnvironmentReceipt,
  EnvironmentRecipe,
  EnvironmentReservation,
  EnvironmentSettings,
  PlatformSettings,
} from './types';

export const environmentProject = Symbol('ENVIRONMENT_PROJECT');
export const environmentFiles = Symbol('ENVIRONMENT_FILES');
export const environmentInputs = Symbol('ENVIRONMENT_INPUTS');
export const environmentPreflight = Symbol('ENVIRONMENT_PREFLIGHT');
export const environmentRecipes = Symbol('ENVIRONMENT_RECIPES');
export const environmentLease = Symbol('ENVIRONMENT_LEASE');

export interface EnvironmentNativeRequest {
  action:
    | 'wizard-environments'
    | 'wizard-environments-status'
    | 'wizard-environments-primary'
    | 'wizard-environments-primary-status';
  projectKey: 'wizard';
  namespaceId: string | number;
  operation: string;
  repository: EnvironmentReceipt['repository'];
  workflow: EnvironmentReceipt['wizardWorkflow'];
  build: EnvironmentReceipt['wizardWorkflow']['build'];
  environments: EnvironmentReservation;
  expectedCi: string;
  legacyRecipe?: BuildRecipe;
  recipe: EnvironmentRecipe;
  previousEnvironments?: EnvironmentReservation;
  previousRecipe?: EnvironmentRecipe;
  sourcePrimary?: EnvironmentReceipt['sourcePrimary'];
  controller: string;
  registryPrefix: string;
}
export interface EnvironmentProjectPort {
  readReceipt(content: string): unknown;
  writeReceipt(file: string, data: string, receipt: EnvironmentReceipt): void;
  validateProject(input: {
    projectKey: string;
    namespaceId: string | number;
    template: 'wizard';
    data: string;
    ci: string;
  }): unknown;
  call(input: EnvironmentNativeRequest): Promise<unknown>;
  startJob(id: string, work: () => Promise<EnvironmentOutcome>): EnvironmentJob;
  lookupJob(id: string): EnvironmentJob | undefined;
  withProjectLock<T>(id: string, work: () => T, parentOperation?: string): T;
  readSettings(content: string): PlatformSettings;
  wizardCi(): string;
  wizardConfiguration(platform: PlatformSettings, settings: EnvironmentSettings): string;
}
export interface EnvironmentFilePort {
  read(file: string): string;
  exists(file: string): boolean;
  entries(directory: string): string[];
  regular(file: string): boolean;
  lock(directory: string): void;
  unlock(directory: string): void;
  persisted(file: string): void;
}
export interface EnvironmentInputs {
  wizardFile(): string;
  mainFile(): string;
  helperImage(): string;
  controller(): string;
}
export interface EnvironmentPreflightPort {
  resolve(host: string): Promise<string[]>;
  certificate(host: string, certificate: string, key: string): Promise<void>;
}
export interface EnvironmentRecipePort {
  generate(logo: string, options: EnvironmentRecipeOptions): EnvironmentRecipe;
  primary(reservation: EnvironmentReservation): EnvironmentRecipe;
  nextPrimary(
    previous: EnvironmentReservation,
    options: { operation: string; helperImage: string; activationCommit: string; ciFiles: unknown },
  ): EnvironmentReservation;
  select(logo: string, recipeHash: string, cliArtifactSha256?: string): BuildRecipe;
  forSource(logo: string, revision: string): BuildRecipe;
}
export interface EnvironmentOperationLease {
  finish(safe: boolean): void;
}
export interface EnvironmentLeaseObservation {
  kind: 'storage' | 'gitlab-upgrade';
  owner: 'wizard-environments' | 'foreign' | 'unavailable';
  operation?: string;
  completion: 'running' | 'uncertain' | 'unknown';
}
export interface EnvironmentOperationLeasePort {
  acquire(operation: string, helperImage: string): EnvironmentOperationLease;
  observe(): EnvironmentLeaseObservation | undefined;
}
