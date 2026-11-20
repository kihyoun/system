import { Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ProcessRunner } from '../runtime/process';
import { ConfigurationPort } from './ports';
import * as wizard from './wizard-aliases';
import * as application from './application-aliases';
import { impact } from './impact';
import { Settings } from './types';
export const ROUTING_PROCESS = Symbol('ROUTING_PROCESS');
export const ROUTING_CONFIGURATION = Symbol('ROUTING_CONFIGURATION');
export interface RoutingCommand {
  action:
    'start' | 'stop' | 'reload' | 'recovery' | 'proxies' | 'stop-proxies' | 'apply' | 'impact';
  root: string;
  templates?: string;
  projects?: string[];
  archive?: string;
  current?: string;
}
const prefixes = ['PROD', 'BETA', 'REVIEW'];
const keys = [
  'PROJECT_NAME',
  'PROJECT_TEMPLATE',
  'NGINX_PROXY_IMAGE',
  'BOOTSTRAPPER_IP',
  'GITLAB_IP',
  'WIZARD_IP',
  'SYNC_ENABLE',
  'WIZARD_ENABLE',
  ...['GITLAB', 'GITLAB_REGISTRY', 'SYNC', 'WIZARD', ...prefixes].flatMap((prefix) =>
    ['HOST', 'DOMAIN_MODE', 'SSL', 'SSL_KEY', 'PROXY'].map((key) => prefix + '_' + key),
  ),
  ...prefixes.map((prefix) => 'USE_' + prefix + '_HOST'),
];
const defaults = Object.fromEntries(keys.map((key) => [key, '']));
const reloadScript = `snapshot=$(mktemp -d /tmp/system-routing-conf.XXXXXXXX)
cp -a /etc/nginx/conf.d/. "$snapshot/"
rollback() {
  result=$?; trap - EXIT
  if [ "$result" != 0 ]; then
    rm -f /etc/nginx/conf.d/*.conf
    cp -a "$snapshot/." /etc/nginx/conf.d/
    nginx -t && nginx -s reload || { echo "Previous proxy configuration could not be reloaded; inspect the proxy before retrying." >&2; result=1; }
  fi
  rm -rf "$snapshot"; exit "$result"
}
trap rollback EXIT
/docker-entrypoint.d/20-envsubst-on-templates.sh
nginx -t
nginx -s reload`;
@Injectable()
export class ProjectsRoutingService {
  constructor(
    @Inject(ROUTING_PROCESS) private readonly process: ProcessRunner,
    @Inject(ROUTING_CONFIGURATION) private readonly configuration: ConfigurationPort,
  ) {}
  run(command: RoutingCommand): unknown {
    if (!path.isAbsolute(command.root)) throw Error('Absolute routing checkout required.');
    if (command.action === 'impact') {
      if (!command.archive || !command.current)
        throw Error('Configuration archive and current state required.');
      return impact(command.archive, command.current);
    }
    if (command.action === 'stop') return this.stop(command);
    if (command.action === 'stop-proxies') return this.stopProxies(command);
    if (command.action === 'proxies') return this.proxies(command, false);
    if (command.action === 'apply')
      return this.transaction(path.join(command.root, 'nginx-proxy/.projects'), '.env', () => {
        this.proxies(command, true);
        this.render({ ...command, action: 'reload' });
      });
    if (!['start', 'reload', 'recovery'].includes(command.action))
      throw Error('Unknown routing action.');
    return this.render(command);
  }
  private stop(command: RoutingCommand): void {
    const root = command.root,
      main = path.join(root, 'system/.docker.env'),
      gitlab = path.join(root, 'gitlab/.docker.env');
    const files =
      fs.existsSync(main) && fs.existsSync(gitlab)
        ? [main, gitlab]
        : [path.join(root, 'system/.seed.env'), path.join(root, '.docker.env')];
    const compose = path.join(root, 'system/docker-compose.yml');
    const selected = [
      ...new Set(
        [...fs.readFileSync(compose, 'utf8').matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)].map(
          (match) => match[1],
        ),
      ),
    ];
    const environment = this.configuration.read(
      files,
      selected,
      Object.fromEntries(selected.map((key) => [key, process.env[key] || ''])),
    );
    this.process.run('docker-compose', ['-f', '../system/docker-compose.yml', 'stop', 'web'], {
      cwd: path.join(root, 'nginx'),
      env: { ...process.env, ...environment },
      timeout: 180000,
    });
  }
  private stopProxies(command: RoutingCommand): void {
    for (const file of this.projectPaths(command.root)) {
      const project = this.configuration.read([file], keys, defaults),
        name = project.PROJECT_NAME;
      if (project.PROJECT_TEMPLATE === 'wizard' && name === 'wizard') continue;
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw Error('Invalid project proxy identity.');
      this.process.run('docker-compose', ['-p', name, 'down'], {
        cwd: path.join(command.root, 'nginx-proxy'),
        timeout: 180000,
      });
    }
  }
  private projectPaths(root: string): string[] {
    return ['.projects.env', 'projects.env'].flatMap((name) => {
      const directory = path.join(root, 'system', name);
      return fs.existsSync(directory)
        ? fs
            .readdirSync(directory)
            .filter(
              (file) => file.endsWith('.env') && fs.statSync(path.join(directory, file)).isFile(),
            )
            .sort()
            .map((file) => path.join(directory, file))
        : [];
    });
  }
  private transaction<T>(directory: string, suffix: string, action: () => T): T {
    fs.mkdirSync(directory, { recursive: true });
    const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), 'system-routing-'));
    try {
      fs.cpSync(directory, snapshot, { recursive: true, verbatimSymlinks: true });
      try {
        return action();
      } catch (error) {
        for (const name of fs.readdirSync(directory))
          if (name.endsWith(suffix) && fs.lstatSync(path.join(directory, name)).isFile())
            fs.unlinkSync(path.join(directory, name));
        fs.cpSync(snapshot, directory, { recursive: true, verbatimSymlinks: true });
        throw error;
      }
    } finally {
      fs.rmSync(snapshot, { recursive: true, force: true });
    }
  }
  private proxies(command: RoutingCommand, targeted: boolean): void {
    const root = command.root,
      directory = path.join(root, 'nginx-proxy/.projects');
    fs.mkdirSync(directory, { recursive: true });
    const mainFile = path.join(root, 'system/.docker.env');
    const main = this.configuration.read(
      fs.existsSync(mainFile) ? [mainFile] : [],
      ['NGINX_PROXY_IMAGE', 'SYSTEM_LOG_MAX_SIZE', 'SYSTEM_LOG_MAX_FILES'],
      Object.fromEntries(
        ['NGINX_PROXY_IMAGE', 'SYSTEM_LOG_MAX_SIZE', 'SYSTEM_LOG_MAX_FILES'].map((key) => [
          key,
          process.env[key] || '',
        ]),
      ),
    );
    for (const file of this.projectPaths(root)) {
      const project = this.configuration.read([file], keys, defaults),
        name = project.PROJECT_NAME;
      if (
        (project.PROJECT_TEMPLATE === 'wizard' && name === 'wizard') ||
        (command.projects?.length && !command.projects.includes(name))
      )
        continue;
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw Error('Invalid project proxy identity.');
      const options = {
        cwd: path.join(root, 'nginx-proxy'),
        env: { ...process.env, ...main },
        timeout: 180000,
      };
      let content = '';
      for (const prefix of prefixes)
        if (project['USE_' + prefix + '_HOST'] === 'true') {
          const environment = prefix.toLowerCase();
          const preserve =
            targeted ||
            !!command.projects?.length ||
            process.env.SYSTEM_PROJECT_ROUTING_ONLY === 'true';
          this.process.run(
            'docker-compose',
            [
              '-p',
              name,
              'up',
              preserve ? '--no-recreate' : '--remove-orphans',
              '--no-build',
              '-d',
              environment,
            ],
            options,
          );
          const address = this.process
            .run(
              'docker',
              [
                'inspect',
                '-f',
                '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
                name + '_' + environment + '_1',
              ],
              options,
            )
            .stdout.trim();
          if (!/^[0-9a-fA-F:.]+$/.test(address)) throw Error('Invalid project proxy address.');
          content += prefix + '_PROXY=' + address + '\n';
        }
      const temporary = fs.mkdtempSync(path.join(directory, '.routing-'));
      try {
        const next = path.join(temporary, 'record');
        fs.writeFileSync(next, content, { mode: 0o600 });
        fs.renameSync(next, path.join(directory, '.' + name + '.env'));
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
  private render(command: RoutingCommand): void {
    const root = command.root,
      recovery = command.action === 'recovery',
      mainFile = path.join(root, 'system/.docker.env'),
      projects = path.join(root, 'system/.projects.env');
    // Every alias is checked before replacing templates or invoking Docker.
    const wizardAliases = recovery ? '' : wizard.render(wizard.validateFiles(mainFile, projects));
    const appAliases = recovery
      ? ''
      : application.render(
          application.validate(
            fs.readFileSync(mainFile, 'utf8'),
            wizard.projectFiles(projects).map((file) => file.content),
            true,
          ),
        );
    const composeFile = path.join(root, 'system/docker-compose.yml');
    const composeKeys = fs.existsSync(composeFile)
      ? [...fs.readFileSync(composeFile, 'utf8').matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)].map(
          (match) => match[1],
        )
      : [];
    const mainKeys = [...new Set([...keys, ...composeKeys])];
    const main = this.configuration.read(
      [path.join(root, '.docker.env'), path.join(root, 'gitlab/.docker.env'), mainFile],
      mainKeys,
      Object.fromEntries(mainKeys.map((key) => [key, process.env[key] || ''])),
    );
    const render = (
      mode: string,
      upstream: string,
      address: string,
      port: string,
      host: string,
      certificate: string,
      key: string,
    ) => {
      const names = [
        'default.conf.template',
        'default.wildcard.conf.template',
        'default.ssl.conf.template',
        'default.wildcard.ssl.conf.template',
      ];
      if (!/^[0-3]$/.test(mode)) return '';
      const values: Settings = {
        PROXY_UPSTREAM: upstream,
        PROXY_IP: address,
        PROXY_PORT: port,
        PROXY_HOSTNAME: host,
        PROXY_SSL_CERT_PATH: certificate,
        PROXY_SSL_CERT_KEY_PATH: key,
      };
      return fs
        .readFileSync(path.join(root, 'nginx/.templates', names[Number(mode)]), 'utf8')
        .replace(/\$\{(PROXY_[A-Z_]+)\}/g, (_, name: string) => values[name] ?? '');
    };
    const route = (
      settings: Settings,
      prefix: string,
      upstream: string,
      address: string,
      port = '80',
    ) =>
      render(
        settings[prefix + '_DOMAIN_MODE'],
        upstream,
        address,
        port,
        settings[prefix + '_HOST'],
        settings[prefix + '_SSL'],
        settings[prefix + '_SSL_KEY'],
      );
    let content = route(main, 'GITLAB', 'gitlab', main.GITLAB_IP);
    if (!recovery) content += '\ninclude /etc/nginx/templates/wizard-environments/*.conf;\n';
    content += route(main, 'GITLAB_REGISTRY', 'registry', main.GITLAB_IP, '5050');
    if (!recovery) {
      for (const file of this.projectPaths(root)) {
        const project = this.configuration.read([file], keys, defaults),
          name = project.PROJECT_NAME;
        if (project.PROJECT_TEMPLATE === 'wizard' && name === 'wizard') continue;
        if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw Error('Invalid project routing identity.');
        const selected = this.configuration.read(
          [file, path.join(root, 'nginx-proxy/.projects/.' + name + '.env')],
          keys,
          defaults,
        );
        for (const prefix of prefixes)
          if (selected['USE_' + prefix + '_HOST'] === 'true')
            content += route(
              selected,
              prefix,
              name + '_' + prefix.toLowerCase(),
              selected[prefix + '_PROXY'],
            );
      }
      if (main.SYNC_ENABLE === 'true')
        content += route(main, 'SYNC', 'sync', main.BOOTSTRAPPER_IP, '8071');
      if (main.WIZARD_ENABLE === 'true') {
        const wizardSettings = this.configuration.read(
          [path.join(root, 'wizard/.docker.env')],
          ['WIZARD_IP'],
          defaults,
        );
        content += route(main, 'WIZARD', 'wizard', wizardSettings.WIZARD_IP);
      }
    }
    const directory = command.templates || '/templates';
    this.transaction(directory, '.template', () => {
      fs.copyFileSync(
        path.join(root, 'nginx/.templates/acme-http01.conf.template'),
        path.join(directory, '00-acme-http01.conf.template'),
      );
      fs.writeFileSync(
        path.join(directory, 'zz-wizard-aliases.conf.template'),
        wizardAliases.replace(/\n*$/, '') + '\n',
      );
      fs.writeFileSync(
        path.join(directory, 'zz-application-aliases.conf.template'),
        appAliases.replace(/\n*$/, '') + '\n',
      );
      fs.writeFileSync(path.join(directory, 'default.conf.template'), content);
      if (command.action === 'reload')
        this.process.run('docker', ['exec', 'system_web_1', 'sh', '-ec', reloadScript], {
          timeout: 180000,
        });
      else
        this.process.run(
          'docker-compose',
          [
            '-f',
            '../system/docker-compose.yml',
            'up',
            '--build',
            '--remove-orphans',
            '--force-recreate',
            '-d',
            'web',
          ],
          { cwd: path.join(root, 'nginx'), env: { ...process.env, ...main }, timeout: 180000 },
        );
    });
  }
}
