import {Injectable} from '@nestjs/common';
import fs from 'node:fs';
import {projectConfigPath} from '../StatePaths';
import {createProject, queryGitlab, lookupJob, validProjectKey, projectBusy, validateProject} from '../ProjectBootstrap';
import {initializeWizardSource, previewWizardSource} from '../WizardWorkflow';
import {activateWizardBuild, previewWizardBuild, refreshWizardBuild} from '../WizardBuild';
import {configureWizardEnvironments, previewWizardEnvironments, refreshWizardEnvironments} from '../WizardEnvironments';
import {previewSetupStatus, preflightPreviewSetup, applyPreviewSetup} from '../PreviewSetup';
import {RuntimeService} from '../runtime/runtime.service';
import {SyncHttpError} from '../http/sync-http-error';

@Injectable()
export class ProjectsService {
  constructor(private readonly runtime: RuntimeService) {}
  private conflict<T>(work: () => T): T {
    try { return work(); }
    catch (error) { throw new SyncHttpError(409, {message: error.message}); }
  }
  private ensureSetupFinished(checkEnvironment = true) {
    if (this.runtime.status.runnerSetupInProgress || this.runtime.status.defaultWizardSetupInProgress ||
        (checkEnvironment && this.runtime.environmentHelperBusy()))
      throw new SyncHttpError(409, {message: 'Wait for system setup to finish.'});
  }
  private ensureIdle() {
    if (this.runtime.operationBusy()) throw new SyncHttpError(409, {message: 'Wait for the current platform operation to finish.'});
  }
  job(id: string) {
    const result = lookupJob(id);
    if (!result) throw new SyncHttpError(404);
    return result;
  }
  previewSetup() {
    try { return previewSetupStatus(); }
    catch { throw new SyncHttpError(409, {message: 'Development preview setup status is unavailable.'}); }
  }
  async preflight(input: any) {
    this.ensureIdle();
    try { return await preflightPreviewSetup(input); }
    catch (error) { throw new SyncHttpError(409, {message: error.message}); }
  }
  applyPreview(input: any) { this.ensureIdle(); return this.conflict(() => applyPreviewSetup(input)); }
  source() { return this.conflict(() => previewWizardSource()); }
  initializeSource(input: any) {
    this.ensureSetupFinished();
    return this.conflict(() => initializeWizardSource(input));
  }
  build() { return this.conflict(() => previewWizardBuild()); }
  activateBuild(input: any) {
    this.ensureSetupFinished();
    // The native module deduplicates its running job and rejects other locks.
    return this.conflict(() => activateWizardBuild(input));
  }
  buildStatus() { this.ensureSetupFinished(false); return this.conflict(() => refreshWizardBuild()); }
  environments() { return this.conflict(() => previewWizardEnvironments()); }
  configureEnvironments(input: any) {
    this.ensureSetupFinished();
    return this.conflict(() => configureWizardEnvironments(input));
  }
  environmentStatus() { this.ensureSetupFinished(false); return this.conflict(() => refreshWizardEnvironments()); }
  namespaces() {
    try { return queryGitlab({action: 'namespaces'}); }
    catch (error) { throw new SyncHttpError(503, {message: error.message}); }
  }
  availability(projectKey: unknown, namespaceId: unknown) {
    if (!validProjectKey(projectKey) || !/^[1-9][0-9]*$/.test(String(namespaceId)))
      throw new SyncHttpError(400, {message: 'Invalid Project Key or namespace.'});
    if (fs.existsSync(projectConfigPath(projectKey))) return {occupied: true, result: {state: 'complete', availability: 'occupied'}};
    try { return {occupied: false, result: queryGitlab({action: 'availability', projectKey, namespaceId})}; }
    catch (error) { throw new SyncHttpError(503, {message: error.message}); }
  }
  create(input: any) {
    if (this.runtime.status.runnerSetupInProgress || this.runtime.status.defaultWizardSetupInProgress || projectBusy() || this.runtime.environmentHelperBusy())
      throw new SyncHttpError(409, {message: 'Wait for runner or project setup to finish.'});
    try { validateProject(input); }
    catch (error) { throw new SyncHttpError(400, {message: error.message}); }
    return this.conflict(() => createProject(input));
  }
}
