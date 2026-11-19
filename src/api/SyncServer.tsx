import {
  makeAutoObservable, runInAction
} from 'mobx';
import Main from './Main';
import ProjectConfig from './ProjectConfig';
import axios from 'axios';

/**
 * General Configuration Object
 */
export default class SyncServer {
  progress = 100;
  /**
   * Set Config
   * @param {ServerConfig} config ServerConfig
   */
  constructor(
    private main: Main,
    _config: any | undefined = undefined
  ) {
    makeAutoObservable(this);
    this.generateConfig(_config);
  }

  generateConfig(_config: any | undefined = undefined): void {
    runInAction(() => {
      this.serverAddress = _config?.serverAddress || this.main.config?.syncHostInfo.url;
      this.userName = _config?.userName || this.main.config?.syncUser;
      this.accessToken = _config?.accessToken || 'secret-token';
      this.refreshToken = _config?.refreshToken || 'secret-refresh-token';
      this.connected = _config?.connected || false;
    });
  }

  login(username:string, password:string) {
    const data = {
      username,
      password
    };

    return new Promise<void>((resolve, reject) => {
      axios.post(this.serverAddress + '/login', data).then(res => {
        runInAction(() => {
          this.accessToken = res.data.accessToken;
          this.refreshToken = res.data.refreshToken;
          this.connected = true;
        });
        resolve();
      }).catch(err => {
        reject(err);
      });
    });
  }

  async projectRequest(route:string, data?:any): Promise<any> {
    await this.token();
    const headers = {
      Authorization : `Bearer ${this.accessToken}`,
      'Content-Type': 'application/json'
    };
    let response = data
      ? await axios.post(this.serverAddress + route, data, { headers })
      : await axios.get(this.serverAddress + route, { headers });
    while (response.data.state === 'running') {
      await new Promise(resolve => setTimeout(resolve, 1500));
      response = await axios.get(this.serverAddress + '/projects/jobs/' + response.data.id, { headers });
    }
    if (response.data.state === 'failed') {
      const error:any = new Error(response.data.message); error.conflict = response.data.conflict; throw error;
    }
    return response.data;
  }

  async createProject(project:ProjectConfig) {
    const result = await this.projectRequest('/projects', {
      projectKey : project.projectKey,
      namespaceId: project.namespaceId,
      template   : project.template,
      data       : project.content,
      ci         : project.gitlabCi
    });
    runInAction(() => { project.repository = result.repository; project.bootstrapPending = false; });
    return result;
  }

  logout() {
    return new Promise((resolve, reject) => {
      this.token().then(() =>
        axios.post(this.serverAddress + '/logout', { t: this.accessToken }, this.getHeaders()).then(res => {
          runInAction(() => {
            this.accessToken = '';
            this.refreshToken = '';
            this.connected = false;
          });
          resolve(res);
        }).catch(err => {
          reject(err);
        })
      ).catch(err => reject(err));
    });
  }

  async fetch() {
    await this.token();
    let res;
    try {
      res = await axios.get(this.serverAddress + '/config/main', this.getHeaders());
    } catch (error) {
      if (error.response?.status !== 404) { throw error; }
      const suggestions = await axios.get(this.serverAddress + '/config/suggestions', this.getHeaders());
      this.main.applySuggestions(suggestions.data);
      return 0;
    }
    this.main.importEnvData(res.data.data);
    this.main.recoveryObservation = res.data.recoveryObservation || null;
    const projects = await axios.get(this.serverAddress + '/config/projects', this.getHeaders());
    let skipCount = 0;
    this.main.projects.clear();
    projects.data.forEach((fileinfo:any) => {
      try {
        this.main.importProjectEnvData(fileinfo.data);
        {
          const project = Array.from(this.main.projects.values()).pop();
          if (project) {
            project.repository = fileinfo.repository || project.repository;
            project.namespaceId = project.repository?.namespaceId || fileinfo.namespaceId || '';
            project.bootstrapPending = fileinfo.bootstrapPending || false;
            project.template = fileinfo.template || project.repository?.template || project.template;
          }
        }
      } catch {
        skipCount++;
        console.log(`${fileinfo.filename} is invalid, skipped`);
      }
    })
    return skipCount;
  }

  async pushImpact() {
    const content = await this.main.generateZip();
    const formData = new FormData();
    formData.append('bootstrapper.zip', new File([content], 'bootstrapper.zip'));
    await this.token();
    return (await axios.post(this.serverAddress + '/config/impact', formData, this.getFileHeaders())).data;
  }

  async push(impact?: string) {
    const bootstrapperRaw = await this.main.generateZip();
    const file = new File([bootstrapperRaw], 'bootstrapper.zip');
    const formData = new FormData();
    formData.append('bootstrapper.zip', file);
    if (impact) formData.append('impact', impact);
    await this.token();
    return axios.post(this.serverAddress + '/config/zip', formData, this.getFileHeaders());
  }

  async diagnosticRequest(route: string, data?: any): Promise<any> {
    await this.token();
    const config = {headers: {Authorization: `Bearer ${this.accessToken}`, 'Content-Type': 'application/json'}};
    const response = data === undefined ? await axios.get(this.serverAddress + route, config) :
      await axios.post(this.serverAddress + route, data, config);
    return response.data;
  }

  async downloadBackup(id: string): Promise<Blob> {
    if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid backup operation.');
    await this.token();
    const response = await axios.get(this.serverAddress + '/backup/' + id + '/download',
      {headers: {Authorization: `Bearer ${this.accessToken}`}, responseType: 'blob'});
    return response.data;
  }

  async pushMain() {
    const raw = this.main.config?.content || '';
    const file = new File([raw], '.docker.env');
    const formData = new FormData();
    formData.append('.docker.env',file);
    await this.token();
    const res = await axios.post(this.serverAddress + '/config/main',
      formData,
      this.getFileHeaders());
    return res;
  }

  async restart() {
    await this.token();
    const options:any = Object.assign(this.getHeaders(), {
      method: 'PATCH',
      url   : this.serverAddress + '/command/restart'
    });

    const res = await axios.request(options);
    return res;
  }

  async registerRunners() {
    await this.token();
    const options:any = Object.assign(this.getHeaders(), {
      method: 'PATCH',
      url   : this.serverAddress + '/command/runners/register'
    });

    const res = await axios.request(options);
    return res;
  }

  async unregisterRunners() {
    await this.token();
    const options:any = Object.assign(this.getHeaders(), {
      method: 'PATCH',
      url   : this.serverAddress + '/command/runners/unregister'
    });

    const res = await axios.request(options);
    return res;
  }

  async deleteMain() {
    await this.token();
    const res = await axios.delete(this.serverAddress + '/config/main', this.getHeaders());
    return res;
  }

  async deleteProjects() {
    await this.token();
    const res = await axios.delete(this.serverAddress + '/config/projects', this.getHeaders());
    return res;
  }

  async seed() {
    await this.token();
    const options:any = Object.assign(this.getHeaders(), {
      method: 'PATCH',
      url   : this.serverAddress + '/command/seed'
    });
    const res = await axios.request(options);
    return res;
  }

  async harvest() {
    await this.token();
    const options:any = Object.assign(this.getHeaders(), {
      method: 'PATCH',
      url   : this.serverAddress + '/command/harvest'
    });
    const res = await axios.request(options);
    return res;
  }
  async hotPatch() {
    await this.token();
    const options:any = Object.assign(this.getHeaders(), {
      method: 'PATCH',
      url   : this.serverAddress + '/command/system/patch'
    });
    const res = await axios.request(options);
    return res;
  }
  token() {
    return new Promise((resolve, reject) => {
      axios.post(this.serverAddress + '/token', { token: this.refreshToken })
        .then((res:any) => {
          this.accessToken = res.data.accessToken;
          resolve(res);
        }).catch(() => {
          reject('Login expired.');
          this.connected = false;
        });
    });
  }

  getFileHeaders() {
    return {
      headers: {
        'Content-Type' : 'multipart/form-data',
        'Authorization': `Bearer ${this.accessToken}`
      }
    };
  }

  getHeaders() {
    return {
      headers: {
        'Authorization': `Bearer ${this.accessToken}` ,
        'Content-Type' : 'application/x-www-form-urlencoded'
      }
    };
  }

  serverAddress!:string;
  userName!:string;
  accessToken!:string;
  refreshToken!:string;
  connected!:boolean;
}
