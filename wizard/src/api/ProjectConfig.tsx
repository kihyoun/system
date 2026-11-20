import FileSaver from 'file-saver';
import { makeAutoObservable, runInAction } from 'mobx';
import Helper from './Helper';
import { extraEnvironment } from './Environment';
import Main, { HostInfo } from './Main';

/**
 * General Configuration Object
 */
export default class ProjectConfig {
  template = 'react';
  namespaceId = '';
  repository: any = undefined;
  bootstrapPending = false;
  bootstrapperProject = '';
  _projectKey = '';

  get projectKey() {
    return this._projectKey;
  }

  set projectKey(key: string) {
    runInAction(() => {
      if (this.main.projects.has(key)) {
        throw 'Key already exists!';
      }

      this._projectKey = key;
    });
  }

  prodAliases = '';
  prodHost!: string;
  useProdHost!: string;
  _prodDomainMode!: number;
  get prodDomainMode() {
    return this._prodDomainMode;
  }
  set prodDomainMode(mode: any) {
    this._prodDomainMode = parseInt(mode, 10) || 0;
  }
  _prodDeployMode!: number;
  get prodDeployMode() {
    return this._prodDeployMode;
  }
  set prodDeployMode(mode: any) {
    this._prodDeployMode = parseInt(mode, 10) || 0;
  }
  prodSSL!: string;
  prodSSLKey!: string;

  useBetaHost!: string;
  betaAliases = '';
  betaHost!: string;
  _betaDomainMode!: number;
  get betaDomainMode() {
    return this._betaDomainMode;
  }
  set betaDomainMode(mode: any) {
    this._betaDomainMode = parseInt(mode, 10) || 0;
  }
  _betaDeployMode!: number;
  get betaDeployMode() {
    return this._betaDeployMode;
  }
  set betaDeployMode(mode: any) {
    this._betaDeployMode = parseInt(mode, 10) || 0;
  }
  betaSSL!: string;
  betaSSLKey!: string;

  useReviewHost!: string;
  reviewAliases = '';
  reviewHost!: string;
  _reviewDomainMode!: number;
  get reviewDomainMode() {
    return this._reviewDomainMode;
  }
  set reviewDomainMode(mode: any) {
    this._reviewDomainMode = parseInt(mode, 10) || 0;
  }
  _reviewDeployMode!: number;
  get reviewDeployMode() {
    return this._reviewDeployMode;
  }
  set reviewDeployMode(mode: any) {
    this._reviewDeployMode = parseInt(mode, 10) || 0;
  }
  reviewSSL!: string;
  reviewSSLKey!: string;

  gitlabRunnerToken!: string;
  gitlabRunnerScale!: number;

  main!: Main;
  saved = false;
  /**
   * Set Config
   * @param {ProjectConfig} config ProjectConfig
   */
  constructor(main: Main, _config: any | undefined = undefined) {
    makeAutoObservable(this);
    this.main = main;
    this.generateConfig(_config);
  }

  runtimeOptions: { [key: string]: string } = {};

  generateConfig(_config: any | undefined = undefined) {
    this.runtimeOptions = { ...(_config?.runtimeOptions ?? {}) };
    this.generateMainConfig(_config);
    this.generateProdProxyConfig(_config);
    this.generateBetaProxyConfig(_config);
    this.generateReviewProxyConfig(_config);
    this.generateRunnerConfig(_config);
  }

  generateMainConfig(_config: any | undefined = undefined): void {
    runInAction(() => {
      this._projectKey = _config?.projectKey ?? '';
      this.namespaceId = _config?.namespaceId ?? _config?.repository?.namespaceId ?? '';
      this.repository = _config?.repository;
      this.bootstrapperProject = _config?.bootstrapperProject ?? '';
      this.template = _config
        ? _config.template || _config.repository?.template || 'empty'
        : 'react';
      this.bootstrapPending = _config?.bootstrapPending ?? false;
    });
  }

  generateProdProxyConfig(_config: any | undefined = undefined): void {
    runInAction(() => {
      this.useProdHost = _config?.useProdHost ?? 'true';
      this.prodAliases = _config?.prodAliases ?? '';
      this.prodHost = _config?.prodHost ?? `www.${this.projectKey}.com`;
      this.prodDomainMode = _config ? parseInt(_config.prodDomainMode, 10) : 2;
      this.prodDeployMode = _config ? parseInt(_config.prodDeployMode, 10) : 1;
      this.prodSSL =
        _config?.prodSSL?.replace(/;/g, '') || `/ssl/live/${this.prodHost}/fullchain.pem`;
      this.prodSSLKey =
        _config?.prodSSLKey?.replace(/;/g, '') || `/ssl/live/${this.prodHost}/privkey.pem`;
    });
  }

  get prodHostInfo(): HostInfo {
    const host =
      (this.prodDomainMode === 1 || this.prodDomainMode === 3 ? '*.' : '') + this.prodHost;
    return {
      context: 'Production',
      useHost: this.useProdHost,
      host,
      domainMode: this.prodDomainMode,
      deployMode: this.prodDeployMode,
      ssl: this.prodSSL,
      sslKey: this.prodSSLKey,
      url: (this.prodDomainMode < 2 ? 'http://' : 'https://') + host,
    };
  }

  generateBetaProxyConfig(_config: any | undefined = undefined): void {
    runInAction(() => {
      this.useBetaHost = _config?.useBetaHost ?? 'false';
      this.betaAliases = _config?.betaAliases ?? '';
      this.betaHost = _config?.betaHost ?? `beta.${this.projectKey}.com`;
      this.betaDomainMode = _config ? parseInt(_config.betaDomainMode, 10) || 0 : 2;
      this.betaDeployMode = _config ? parseInt(_config.betaDeployMode, 10) || 0 : 1;
      this.betaSSL = _config?.betaSSL ?? `/ssl/live/${this.betaHost}/fullchain.pem`;
      this.betaSSLKey = _config?.betaSSLKey ?? `/ssl/live/${this.betaHost}/privkey.pem`;
    });
  }

  get betaHostInfo(): HostInfo {
    const host =
      (this.betaDomainMode === 1 || this.betaDomainMode === 3 ? '*.' : '') + this.betaHost;
    return {
      context: 'Beta',
      useHost: this.useBetaHost,
      host,
      domainMode: this.betaDomainMode,
      deployMode: this.betaDeployMode,
      ssl: this.betaSSL,
      sslKey: this.betaSSLKey,
      url: (this.betaDomainMode < 2 ? 'http://' : 'https://') + host,
    };
  }

  generateReviewProxyConfig(_config: any | undefined = undefined): void {
    runInAction(() => {
      this.useReviewHost = _config?.useReviewHost ?? 'true';
      this.reviewAliases = _config?.reviewAliases ?? '';
      this.reviewHost = _config?.reviewHost ?? `${this.projectKey}.com`;
      this.reviewDomainMode = _config ? parseInt(_config.reviewDomainMode, 10) || 0 : 1;
      this.reviewDeployMode = _config ? parseInt(_config.reviewDeployMode, 10) || 0 : 1;
      this.reviewSSL = _config?.reviewSSL ?? `/ssl/live/${this.reviewHost}/fullchain.pem`;
      this.reviewSSLKey = _config?.reviewSSLKey ?? `/ssl/live/${this.reviewHost}/privkey.pem`;
    });
  }

  get reviewHostInfo(): HostInfo {
    const host =
      (this.reviewDomainMode === 1 || this.reviewDomainMode === 3 ? '*.' : '') + this.reviewHost;
    return {
      context: 'Review',
      useHost: this.useReviewHost,
      host,
      domainMode: this.reviewDomainMode,
      deployMode: this.reviewDeployMode,
      ssl: this.reviewSSL,
      sslKey: this.reviewSSLKey,
      url: (this.reviewDomainMode < 2 ? 'http://' : 'https://') + host,
    };
  }

  generateRunnerConfig(_config: any | undefined = undefined): void {
    runInAction(() => {
      this.gitlabRunnerScale = parseInt(_config?.gitlabRunnerScale, 10) || 0;
      this.gitlabRunnerToken = _config?.gitlabRunnerToken ?? '';
    });
  }
  public setProperty(propertyKey: any, value: any) {
    switch (propertyKey) {
      case 'PROD_DEPLOY_MODE':
        this.prodDeployMode = parseInt(Helper.unquote(value), 10);
        break;
      case 'BETA_DEPLOY_MODE':
        this.betaDeployMode = parseInt(Helper.unquote(value), 10);
        break;
      case 'REVIEW_DEPLOY_MODE':
        this.reviewDeployMode = parseInt(Helper.unquote(value), 10);
        break;
      case 'PROJECT_TEMPLATE':
        this.template = Helper.unquote(value);
        break;
      case 'PROJECT_NAME':
        this.projectKey = Helper.unquote(value);
        break;
      case 'USE_PROD_HOST':
        this.useProdHost = Helper.unquote(value);
        break;
      case 'PROD_ALIASES':
        this.prodAliases = Helper.unquote(value);
        break;
      case 'PROD_HOST':
        this.prodHost = Helper.unquote(value);
        break;
      case 'PROD_DOMAIN_MODE':
        this.prodDomainMode = parseInt(Helper.unquote(value), 10);
        break;
      case 'PROD_SSL':
        this.prodSSL = Helper.unquote(value).replace(/;/g, '');
        break;
      case 'PROD_SSL_KEY':
        this.prodSSLKey = Helper.unquote(value).replace(/;/g, '');
        break;
      case 'USE_BETA_HOST':
        this.useBetaHost = Helper.unquote(value);
        break;
      case 'BETA_ALIASES':
        this.betaAliases = Helper.unquote(value);
        break;
      case 'BETA_HOST':
        this.betaHost = Helper.unquote(value);
        break;
      case 'BETA_DOMAIN_MODE':
        this.betaDomainMode = parseInt(Helper.unquote(value), 10);
        break;
      case 'BETA_SSL':
        this.betaSSL = Helper.unquote(value).replace(/;/g, '');
        break;
      case 'BETA_SSL_KEY':
        this.betaSSLKey = Helper.unquote(value).replace(/;/g, '');
        break;
      case 'USE_REVIEW_HOST':
        this.useReviewHost = Helper.unquote(value);
        break;
      case 'REVIEW_ALIASES':
        this.reviewAliases = Helper.unquote(value);
        break;
      case 'REVIEW_HOST':
        this.reviewHost = Helper.unquote(value);
        break;
      case 'REVIEW_DOMAIN_MODE':
        this.reviewDomainMode = parseInt(Helper.unquote(value), 10);
        break;
      case 'REVIEW_SSL':
        this.reviewSSL = Helper.unquote(value).replace(/;/g, '');
        break;
      case 'REVIEW_SSL_KEY':
        this.reviewSSLKey = Helper.unquote(value).replace(/;/g, '');
        break;
      case 'GITLAB_RUNNER_TOKEN':
        this.gitlabRunnerToken = Helper.unquote(value);
        break;
      case 'GITLAB_RUNNER_SCALE':
        this.gitlabRunnerScale = parseInt(Helper.unquote(value), 10) || 0;
        break;
      default:
        this.runtimeOptions[propertyKey] = Helper.unquote(value);
        break;
    }
  }

  public get content(): string {
    const metadata = encodeURIComponent(JSON.stringify(this.repository || null));
    const ret =
      Helper.textLogo +
      `# BOOTSTRAPPER_REPOSITORY=${metadata}
PROJECT_NAME=${Helper.quote(this.projectKey)}
PROJECT_TEMPLATE=${Helper.quote(this.template)}
PROD_DEPLOY_MODE=${Helper.quote(this.prodDeployMode)}
BETA_DEPLOY_MODE=${Helper.quote(this.betaDeployMode)}
REVIEW_DEPLOY_MODE=${Helper.quote(this.reviewDeployMode)}
# Filepath: ./.projects.env/.${this.projectKey}.env

USE_PROD_HOST=${Helper.quote(this.useProdHost)}
`;
    const prod = `
PROD_HOST=${Helper.quote(this.prodHost)}
PROD_DOMAIN_MODE=${Helper.quote(this.prodDomainMode)}
`;
    const prodSSL = `
PROD_SSL=${Helper.quote(this.prodSSL)}
PROD_SSL_KEY=${Helper.quote(this.prodSSLKey)}
`;
    const betaUse = `
# Set false if not using a Beta Deployment
USE_BETA_HOST=${Helper.quote(this.useBetaHost)}
`;
    const beta = `
BETA_HOST=${Helper.quote(this.betaHost)}
BETA_DOMAIN_MODE=${Helper.quote(this.betaDomainMode)}
`;
    const betaSSL = `
BETA_SSL=${Helper.quote(this.betaSSL)}
BETA_SSL_KEY=${Helper.quote(this.betaSSLKey)}
`;
    const reviewUse = `
# Set false if not using the Review
USE_REVIEW_HOST=${Helper.quote(this.useReviewHost)}
`;
    const reviewHost = `
REVIEW_HOST=${Helper.quote(this.reviewHost)}
REVIEW_DOMAIN_MODE=${Helper.quote(this.reviewDomainMode)}
`;
    const reviewSSL = `
REVIEW_SSL=${Helper.quote(this.reviewSSL)}
REVIEW_SSL_KEY=${Helper.quote(this.reviewSSLKey)}
  `;
    const gitlabRunner = `
# -- GITLAB RUNNER for Project
GITLAB_RUNNER_TOKEN=${Helper.quote(this.gitlabRunnerToken)}
export GITLAB_RUNNER_SCALE=${Helper.quote(this.gitlabRunnerScale)}
`;
    const createdOn = `# created on ${new Date()}`;
    return (
      ret +
      ((this.useProdHost === 'true' && prod) || '') +
      (((this.prodDomainMode > 1 || this.prodAliases.trim()) && prodSSL) || '') +
      betaUse +
      ((this.useBetaHost === 'true' && beta) || '') +
      (((this.betaDomainMode > 1 || this.betaAliases.trim()) && betaSSL) || '') +
      reviewUse +
      ((this.useReviewHost === 'true' && reviewHost) || '') +
      (((this.reviewDomainMode > 1 || this.reviewAliases.trim()) && reviewSSL) || '') +
      (['prod', 'beta', 'review'] as const)
        .filter((context) => this[`${context}Aliases`].trim())
        .map(
          (context) =>
            `\n${context.toUpperCase()}_ALIASES=${Helper.quote(this[`${context}Aliases`])}\n`,
        )
        .join('') +
      gitlabRunner +
      extraEnvironment(this.runtimeOptions) +
      (this.bootstrapperProject ? `# BOOTSTRAPPER_PROJECT=${this.bootstrapperProject}\n` : '') +
      createdOn
    );
  }

  public get gitlabCi(): string {
    if (this.template !== 'empty' && this.repository?.generatedCi)
      return this.repository.generatedCi;
    const ret =
      Helper.textLogo +
      `# Gitlab CI Definition
# ProjectID: ${this.projectKey}
${this.useProdHost === 'true' ? `# Production: ${this.prodHostInfo.url}` : ''}
${this.useBetaHost === 'true' ? `# Beta: ${this.betaHostInfo.url}` : ''}
${this.useReviewHost === 'true' ? `# Review Apps: ${this.reviewHostInfo.url}` : ''}
# Filepath: ./gitlab-ci.yml
workflow:
  rules:
    - exists:
        - Dockerfile
    - when: never
image: docker:latest
services:
  - docker:dind
variables:
  IMAGE_TAG: $CI_REGISTRY_IMAGE:$CI_COMMIT_REF_SLUG
  npm_config_cache: "$CI_PROJECT_DIR/.npm"
  CYPRESS_CACHE_FOLDER: "$CI_PROJECT_DIR/cache/Cypress"
stages:
  - build
  - test
  - deploy
cache:
  key: \${CI_COMMIT_REF_SLUG}
  paths:
    - .npm
    - cache/Cypress
    - node_modules
build:
  stage: build
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login --username $CI_REGISTRY_USER --password-stdin $CI_REGISTRY
  script:
    - docker build -t $IMAGE_TAG .
    - docker push $IMAGE_TAG
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
test:cypress:
  stage: test
  services:
    - name: $IMAGE_TAG
      alias: alpha-host
  image: cypress/base:10
  script:
    - npm ci
    # check Cypress binary path and cached versions
    # useful to make sure we are not carrying around old versions
    - npx cypress cache path
    - npx cypress cache list
    - npx cypress run --config baseUrl=http://alpha-host:80
  artifacts:
    when: always
    paths:
      - cypress/videos/**/*.mp4
      - cypress/screenshots/**/*.png
    expire_in: 1 day
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
    `;

    const review =
      `
test:review:
  stage: test
  environment:
    name: review/$CI_COMMIT_REF_NAME
    url: ${this.reviewDomainMode < 2 ? 'http' : 'https'}://$CI_COMMIT_REF_SLUG.${this.reviewHost}
    on_stop: stop:review
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login --username $CI_REGISTRY_USER --password-stdin $CI_REGISTRY
    - set +e
    - docker stop $CI_COMMIT_REF_SLUG.${this.reviewHost}
    - docker rm $CI_COMMIT_REF_SLUG.${this.reviewHost}
    - set -e
  script:
    - docker run -itd --network ` +
      `${this.projectKey}_review -e VIRTUAL_HOST=$CI_COMMIT_REF_SLUG.${this.reviewHost} ` +
      `--name $CI_COMMIT_REF_SLUG.${this.reviewHost} $IMAGE_TAG
  only:
    - merge_requests
  ${(this.reviewDeployMode === 0 && 'when: manual') || ''}
stop:review:
  stage: deploy
  allow_failure: true
  script:
    - docker stop $CI_COMMIT_REF_SLUG.${this.reviewHost}
    - docker rm $CI_COMMIT_REF_SLUG.${this.reviewHost}
  environment:
    name: review/$CI_COMMIT_REF_NAME
    action: stop
  when: manual
  only:
    - merge_requests
  ${(this.betaDeployMode === 0 && 'when: manual') || ''}

`;
    const beta =
      `
deploy:beta:
  stage: deploy
  environment:
    name: production/beta
    url: ${this.betaDomainMode < 2 ? 'http://' : 'https://'}${this.betaHost}
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login --username $CI_REGISTRY_USER --password-stdin $CI_REGISTRY
    - set +e
    - docker stop ${this.betaHost}
    - docker rm ${this.betaHost}
    - set -e
  script:
    - docker run -itd --network ${this.projectKey}_beta ` +
      `-e VIRTUAL_HOST=${this.betaHost} ` +
      `--name ${this.betaHost} $IMAGE_TAG
  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
  ${(this.betaDeployMode === 0 && 'when: manual') || ''}
`;
    const prod =
      `
deploy:prod:
  stage: deploy
  environment:
    name: production/www
    url: ${this.prodDomainMode < 2 ? 'http://' : 'https://'}${this.prodHost}
  before_script:
    - echo "$CI_REGISTRY_PASSWORD" | docker login --username $CI_REGISTRY_USER --password-stdin $CI_REGISTRY
    - set +e
    - docker stop ${this.prodHost}
    - docker rm ${this.prodHost}
    - set -e
  script:
    - docker run -itd --network ${this.projectKey}_prod ` +
      `-e VIRTUAL_HOST=${this.prodHost} ` +
      `--name ${this.prodHost} $IMAGE_TAG
  rules:
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH'
  ${(this.prodDeployMode === 0 && 'when: manual') || ''}
`;
    return (
      ret +
      ((this.useReviewHost === 'true' && review) || '') +
      ((this.useBetaHost === 'true' && beta) || '') +
      ((this.useProdHost === 'true' && prod) || '')
    );
  }

  public exportGitlabCi() {
    const file = new File([this.gitlabCi], 'gitlab-ci.yml', { type: 'text/plain;charset=utf-8' });
    FileSaver.saveAs(file);
  }

  public get asJson(): any {
    return {
      template: this.template,
      projectKey: this.projectKey,
      namespaceId: this.namespaceId,
      repository: this.repository,
      bootstrapPending: this.bootstrapPending,
      bootstrapperProject: this.bootstrapperProject,
      runtimeOptions: { ...this.runtimeOptions },
      useProdHost: this.useProdHost,
      prodAliases: this.prodAliases,
      prodHost: this.prodHost,
      prodDomainMode: this.prodDomainMode,
      prodDeployMode: this.prodDeployMode,
      prodSSL: this.prodSSL,
      prodSSLKey: this.prodSSLKey,
      useBetaHost: this.useBetaHost,
      betaAliases: this.betaAliases,
      betaHost: this.betaHost,
      betaDomainMode: this.betaDomainMode,
      betaDeployMode: this.betaDeployMode,
      betaSSL: this.betaSSL,
      betaSSLKey: this.betaSSLKey,
      useReviewHost: this.useReviewHost,
      reviewAliases: this.reviewAliases,
      reviewHost: this.reviewHost,
      reviewDomainMode: this.reviewDomainMode,
      reviewDeployMode: this.reviewDeployMode,
      reviewSSL: this.reviewSSL,
      reviewSSLKey: this.reviewSSLKey,
      gitlabRunnerToken: this.gitlabRunnerToken,
      gitlabRunnerScale: this.gitlabRunnerScale,
    };
  }
}
