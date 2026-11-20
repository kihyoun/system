import FileSaver from 'file-saver';
import {
  makeAutoObservable,
  observable,
  runInAction
} from 'mobx';
import MainConfig from './MainConfig';
import ProjectConfig from './ProjectConfig';
import JSZip from 'jszip';
import SyncServer from './SyncServer';
import { v4 as uuidv4 } from 'uuid';
import md5 from 'md5';
import {environment} from './Environment';
import {recoveryMetadata, recoveryGuide, importedRecovery} from './Recovery';
import {previewSetupIntent, type PreviewSetupIntent} from './PreviewSetupIntent';

/**
 * General Configuration Object
 */
export default class Main {
    private _placeHolder!: MainConfig;
    private _config!: MainConfig;
    private _projects: Map<string, ProjectConfig>;
    private _syncServer!: SyncServer;
    recoveryObservation: any = null;
    importedRecovery: any = null;
    backupSeedAssociation: any = null;
    private backupCreatedAt = new Date();
    init = true;
    uploadProgress = false;
    derivedFields: { [key: string]: string } = {};
    previewSetup: PreviewSetupIntent | null = null;
    id = uuidv4();

    /**
     * Set Config
     * @param {MainConfig|undefined} config MainConfig
     */
    constructor(
      _config: MainConfig | undefined = undefined,
      _projects: Map<string, ProjectConfig> | undefined = undefined
    ) {
      makeAutoObservable(this);
      this.generateConfig(_config);

      this._projects = _projects || observable(new Map<string, ProjectConfig>());
    }

    public generateConfig(_config: any | undefined): void {
      this.recoveryObservation = null;
      this.backupSeedAssociation = null;
      this.importedRecovery = null;
      this.derivedFields = {};
      this.previewSetup = null;
      this._config = new MainConfig(_config);
      this._syncServer = this._syncServer ? this._syncServer : new SyncServer(this);
      this._placeHolder = new MainConfig(_config);
    }

    public applySuggestions(suggestions: any): void {
      const values = suggestions.config || {};
      this.generateConfig(values);
      const config = this._config;
      config.seedDir = values.seedDir || '';
      config.gitlabHost = values.gitlabHost || '';
      config.gitlabRegistryHost = values.gitlabRegistryHost || '';
      config.gitlabDomainMode = values.gitlabDomainMode || 0;
      config.gitlabRegistryDomainMode = values.gitlabRegistryDomainMode || 0;
      config.gitlabExternalUrl = values.gitlabExternalUrl ||
        (config.gitlabHost ? `${config.gitlabDomainMode > 1 ? 'https' : 'http'}://${config.gitlabHost}` : '');
      config.gitlabRegistryUrl = values.gitlabRegistryUrl ||
        (config.gitlabRegistryHost
          ? `${config.gitlabRegistryDomainMode > 1 ? 'https' : 'http'}://${config.gitlabRegistryHost}` : '');
      config.gitlabRunnerScale = 0;
      config.gitlabRunnerToken = '';
      config.syncEnable = 'true';
      config.syncHost = values.syncHost || '';
      config.syncDomainMode = values.syncDomainMode || 0;
      config.syncUser = this.sync.userName || '';
      config.syncPass = '';
      config.wizardEnable = values.wizardHost ? 'true' : 'false';
      config.wizardHost = values.wizardHost || '';
      config.wizardDomainMode = values.wizardDomainMode || 0;
      config.gitlabSSL = values.gitlabSSL || '';
      config.gitlabSSLKey = values.gitlabSSLKey || '';
      config.gitlabRegistrySSL = values.gitlabRegistrySSL || '';
      config.gitlabRegistrySSLKey = values.gitlabRegistrySSLKey || '';
      config.syncSSL = values.syncSSL || '';
      config.syncSSLKey = values.syncSSLKey || '';
      config.wizardSSL = values.wizardSSL || '';
      config.wizardSSLKey = values.wizardSSLKey || '';
      this.derivedFields = suggestions.fields || {};
      this.init = false;
    }

    public get placeholder(): MainConfig | undefined {
      return this._placeHolder;
    }

    public get config(): MainConfig | undefined {
      return this._config;
    }

    public get sync(): SyncServer {
      return this._syncServer;
    }

    public addProject(project: ProjectConfig) {
      runInAction(() => {
        this._projects.set(project.projectKey, project);
        project.saved = true;
      });
    }

    public saveProject(project: ProjectConfig, oldConfig: ProjectConfig) {
      runInAction(() => {
        this._projects.delete(oldConfig.projectKey);
        this._projects.set(project.projectKey, project);
        project.saved = true;
      });
    }

    get projects(): Map<string, ProjectConfig> {
      return this._projects;
    }

    public get asJson() {
      const proxies:any = [];
      this._projects.forEach(config => proxies.push(config.asJson));

      return {
        main         : this._config.asJson,
        proxies      : proxies,
        derivedFields: this.derivedFields,
        previewSetup : previewSetupIntent(this.previewSetup),
        recovery     : recoveryMetadata(this._config.content, this.recoveryObservation, this.backupCreatedAt, this.importedRecovery, this.backupSeedAssociation)
      }
    }

    public exportJson() {
      this.backupCreatedAt = new Date();
      const file = new Blob([JSON.stringify(this.asJson, null, 4)],
        { type: 'text/plain;charset=utf-8' });
      FileSaver.saveAs(file, 'bootstrapper.json');
    }

    public importFile(file: File, result:string) {
      if (file.name.substr(-4) === 'json') {
        this.importJson(file, result);
      } else if (file.name.indexOf('.docker.env') > -1) {
        this.importEnv(result);
      } else if (file.name.indexOf('.env') > -1 ) {
        this.importProjectEnv(result);
      } else {
        throw 'Invalid File';
      }
    }

    public importProjectFile(file: File, result:any) {
      if (file.name.substr(-3) === 'env') {
        this.importProjectEnv(result);
      }
    }

    public importJson(file:File, result:string) {
      const config = JSON.parse(result);
      runInAction(() => this.uploadProgress = true);
      runInAction(() => {
        this.recoveryObservation = null;
        this.backupSeedAssociation = null;
        this.generateConfig(config.main);
        this.importedRecovery = importedRecovery(config.recovery);
        this.derivedFields = config.derivedFields || {};
        this.previewSetup = previewSetupIntent(config.previewSetup);

        if (!this.sync.connected) {
          this.sync.generateConfig();
        }

        this._projects = observable(new Map<string, ProjectConfig>());
        config.proxies.forEach((pConfig:any) => {
          this._projects.set(pConfig.projectKey, new ProjectConfig(this, pConfig));
        });
        this.init = false;
        this.uploadProgress = false;

      });
    }

    public importEnv(result: any) {
      this.importEnvData(result);
    }

    public importEnvData(data: any) {

      if (data.substr(807, 1) !== '$'
        || md5(data.substr(0, 1184)) !== 'bd4a8426355824593a5e21ad759830c1') {
        throw new Error('Invalid Configuration');
      }

      const assignments = environment(data);
      runInAction(() => {
        this.recoveryObservation = null;
        this.backupSeedAssociation = null;
        this.importedRecovery = null;
        this.derivedFields = {};
        this.previewSetup = null;
        this.uploadProgress = true;
        this.init=false;
      });
      runInAction(() => {
        this._config = new MainConfig();
        // Domain setters derive URLs. Explicit saved URLs must win afterwards.
        const ordered = assignments.filter(([key]) => !['GITLAB_EXTERNAL_URL', 'GITLAB_REGISTRY_URL'].includes(key))
          .concat(assignments.filter(([key]) => ['GITLAB_EXTERNAL_URL', 'GITLAB_REGISTRY_URL'].includes(key)));
        ordered.forEach(([key, value]) => this._config.setProperty(key, value));
        this.uploadProgress = false;
      });
    }

    public importProjectEnv(result:any) {
      this.importProjectEnvData(result);
    }

    public importProjectEnvData(data:any) {

      if (data.substr(807, 1) !== '$'
        || md5(data.substr(0, 1184)) !== 'bd4a8426355824593a5e21ad759830c1') {
        throw new Error('Invalid Configuration');
      }

      const assignments = environment(data);
      const config = new ProjectConfig(this);
      config.template = 'empty';
      // Legacy ENV omits disabled domain modes. Do not invent HTTPS fields
      // during Fetch: pending Save must round-trip to the same configuration.
      config.prodDomainMode = 0;
      config.betaDomainMode = 0;
      config.reviewDomainMode = 1;
      runInAction(() => {
        this.uploadProgress = true;
        this.init = false;
      });
      runInAction(() => {
        assignments.forEach(([key, value]) => config.setProperty(key, value));
        for (const context of ['prod', 'beta', 'review']) {
          const upper = context.toUpperCase();
          if (!new RegExp('^' + upper + '_DOMAIN_MODE=', 'm').test(data)
            && new RegExp('^' + upper + '_SSL=', 'm').test(data)) {
            (config as any)[context + 'DomainMode'] = 2;
          }
        }
        const metadata = data.split('\n').find((line:string) => line.startsWith('# BOOTSTRAPPER_REPOSITORY='));
        if (metadata) {
          config.repository = JSON.parse(decodeURIComponent(metadata.substr('# BOOTSTRAPPER_REPOSITORY='.length)));
        }
        config.bootstrapperProject = data.split('\n').find((line:string) => line.startsWith('# BOOTSTRAPPER_PROJECT='))?.slice('# BOOTSTRAPPER_PROJECT='.length) || '';
        config.namespaceId = config.repository?.namespaceId || '';
        this.addProject(config);
        this.uploadProgress = false;
      });
    }

    public exportZip() {
      this.generateZip().then(function(content:any) {
        FileSaver.saveAs(content, 'bootstrapper.zip');
      });
    }

    public generateZip(sourceFiles?: {main: string; projects: {filename: string; data: string}[]}) {
      this.backupCreatedAt = new Date();
      const zip = new JSZip();
      const backup = this.asJson;
      zip.file('bootstrapper.json', JSON.stringify(backup, null, 4));
      zip.file('recovery.json', JSON.stringify(backup.recovery, null, 2));
      zip.file('RECOVERY.md', recoveryGuide(backup.recovery));
      zip.file('.docker.env', sourceFiles?.main ?? this._config.content);
      const projects = zip.folder('.projects.env');
      if (sourceFiles) sourceFiles.projects.forEach(file => projects?.file(file.filename, file.data));
      else this._projects.forEach(projectConfig => {
        projects?.file(`.${projectConfig.projectKey}.env`, projectConfig.content);
      });

      return zip.generateAsync({ type: 'blob' });
    }

    public exportProjectConfigs() {
      const zip = new JSZip();
      const projects = zip.folder('.projects.env');
      this._projects.forEach(projectConfig => {
        projects?.file(`.${projectConfig.projectKey}.env`, projectConfig.content);
      });

      zip.generateAsync({ type: 'blob' }).then(function(content:any) {
        FileSaver.saveAs(content, 'projects.env.zip');
      });

    }

}

export interface HostInfo {
  context: string;
  useHost: string;
  domainMode: number;
  deployMode: number;
  host: string;
  ssl: string;
  sslKey: string;
  url: string;
}
