import fs from 'fs';
import path from 'path';
import type {Express, RequestHandler, Request, Response} from 'express';
import {readSettings} from './DefaultWizard';
import {mainConfigPath, projectsDirectory} from './StatePaths';
import {nativeProbe, diagnosticCode, ProbeDriver} from './SystemDiagnosticsProbe';
import {dockerRead, inspectRunner, pullHelper, validHelperImage} from './SystemDiagnosticsDocker';

export interface DiagnosticStep {name: string; status: 'passed' | 'failed' | 'not-checked'; durationMs: number; code: string; detail: string}
export interface DiagnosticTargets {registry: string; helper: string; helperImage: string; runners: string[]; context: string}
const CONTEXT = 'Sync controller process network; this does not establish runner or Docker-daemon connectivity';
export function configuredRegistry(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' ||
      url.search || url.hash || !url.hostname || url.hostname.endsWith('.') || url.href.length > 1024) throw new Error('Invalid registry target');
  return url;
}
export async function diagnosticTargets(): Promise<DiagnosticTargets> {
  const settings = readSettings(fs.readFileSync(mainConfigPath(), 'utf8'));
  const registry = configuredRegistry(settings.GITLAB_REGISTRY_URL);
  // GitLab's generated registry listener is 5050 in HTTP modes. Preserve an
  // explicit operator port; only fill the listener when the URL omits it.
  if (!/:\d+\/?$/.test(settings.GITLAB_REGISTRY_URL) && !registry.port && registry.protocol === 'http:' && Number(settings.GITLAB_REGISTRY_DOMAIN_MODE || 0) < 2) registry.port = '5050';
  const image = settings.GITLAB_RUNNER_HELPER_IMAGE || process.env.GITLAB_RUNNER_HELPER_IMAGE ||
    require('../../gitlab/security-release.json').runner.helperImage;
  if (!validHelperImage(image)) throw new Error('Invalid helper target');
  const helperAuthority = image.split('/')[0];
  const helper = configuredRegistry(helperAuthority === registry.host ? registry.origin : 'https://' + helperAuthority);
  const permitted = new Set<string>();
  const pool = (name: string, count: string) => {
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(name) || !/^(?:[0-9]|[1-4][0-9]|50)$/.test(count || '')) return;
    for (let index = 1; index <= Number(count); index++) permitted.add(name + '_docker_' + index);
  };
  pool('runner', settings.GITLAB_RUNNER_SCALE);
  try {
    for (const file of fs.readdirSync(projectsDirectory()).filter(file => /^\.?[a-z0-9][a-z0-9_-]*\.env$/.test(file)).slice(0, 100)) {
      const project = readSettings(fs.readFileSync(path.join(projectsDirectory(), file), 'utf8'));
      if (project.PROJECT_NAME === 'wizard' && project.PROJECT_TEMPLATE === 'wizard') continue;
      pool(project.PROJECT_NAME + '_runner', project.GITLAB_RUNNER_SCALE);
    }
  } catch (_) { /* Main pool metadata remains available without project configuration. */ }
  let runners: string[] = [];
  try {
    const names = await dockerRead(['container', 'ls', '--format', '{{.Names}}']);
    runners = names.trim().split('\n').filter(name => permitted.has(name)).slice(0, 100);
  } catch (_) { /* Missing daemon is represented by no inspectable managers. */ }
  return {registry: registry.origin, helper: helper.origin, helperImage: image, runners, context: CONTEXT};
}
export async function checkRegistry(target: string, driver: ProbeDriver = nativeProbe) {
  const startedAt = new Date().toISOString();
  const url = configuredRegistry(target), hostname = url.hostname.replace(/^\[|\]$/g, '');
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const steps: DiagnosticStep[] = [];
  let address = '', blocked = false;
  const step = async (name: string, work: () => Promise<{code: string; detail: string; failed?: boolean}>) => {
    if (blocked) { steps.push({name, status: 'not-checked', durationMs: 0, code: 'DEPENDENCY_FAILED', detail: 'A preceding check failed; this step was not run.'}); return; }
    const started = performance.now();
    try {
      const result = await work();
      steps.push({name, status: result.failed ? 'failed' : 'passed', durationMs: Math.round(performance.now() - started), code: result.code, detail: result.detail});
      blocked = !!result.failed;
    } catch (error) {
      blocked = true;
      steps.push({name, status: 'failed', durationMs: Math.round(performance.now() - started), code: diagnosticCode(error), detail: 'This check did not complete successfully. The result does not establish a root cause.'});
    }
  };
  await step('DNS', async () => {
    const addresses = await driver.dns(hostname);
    if (!addresses.length) throw Object.assign(new Error('No address'), {code: 'ENOTFOUND'});
    address = addresses[0];
    return {code: 'RESOLVED', detail: 'The server resolver returned an address. Subsequent checks use the first address; other addresses are not tested.'};
  });
  await step('TCP', async () => { await driver.tcp(address, port); return {code: 'CONNECTED', detail: 'A TCP connection was established to the selected address and configured port.'}; });
  if (url.protocol === 'https:') {
    await step('TLS', async () => { await driver.tls(address, port, hostname); return {code: 'VERIFIED', detail: 'TLS trust and certificate hostname verification succeeded using the controller trust store.'}; });
  } else steps.push({name: 'TLS', status: 'not-checked', durationMs: 0, code: blocked ? 'DEPENDENCY_FAILED' : 'HTTP_CONFIGURED', detail: 'The configured target uses HTTP; TLS was not checked.'});
  await step('Registry HTTP', async () => {
    const result = await driver.http(url, address);
    if (result.status === 401 && result.challenge) return {code: 'HTTP_401_CHALLENGE', detail: 'HTTP 401 authentication challenge received from /v2/. The endpoint is reachable; credentials, authorization and image availability remain unverified.'};
    if (result.status === 200 && result.registry) return {code: 'HTTP_200_REGISTRY', detail: 'Registry API responded successfully. Image availability and runner authentication remain unverified.'};
    return {code: 'HTTP_' + result.status, failed: true, detail: 'The endpoint returned an unexpected HTTP status or an unrecognized registry response. Redirects are not followed.'};
  });
  return {context: CONTEXT, target: url.origin, startedAt, steps};
}
export interface DiagnosticDependencies {
  targets: typeof diagnosticTargets;
  probe: ProbeDriver;
  inspect: typeof inspectRunner;
  pull: typeof pullHelper;
}
export function registerSystemDiagnostics(app: Express, authenticate: RequestHandler,
  dependencies: Partial<DiagnosticDependencies> = {}) {
  const deps: DiagnosticDependencies = {targets: diagnosticTargets, probe: nativeProbe, inspect: inspectRunner, pull: pullHelper, ...dependencies};
  let active = 0;
  // No result store, background scheduler or automatic retry. Each caller holds
  // at most its current response. A shared limit covers metadata and both actions.
  const bounded = (run: (req: Request, res: Response) => Promise<void>): RequestHandler => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (active >= 2) { res.status(429).json({message: 'Diagnostics are busy. Retry after the current checks finish.'}); return; }
    active++;
    try { await run(req, res); }
    catch (_) { res.status(503).json({message: 'Diagnostics could not inspect the configured service or runner. Check server configuration and daemon availability.'}); }
    finally { active--; }
  };
  app.get('/diagnostics', authenticate, bounded(async (_req, res) => { res.json(await deps.targets()); }));
  app.post('/diagnostics/connection', authenticate, bounded(async (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || !['registry', 'helper'].includes(req.body.target)) {
      res.status(400).json({message: 'Choose a configured registry target.'}); return;
    }
    const targets = await deps.targets();
    res.json(await checkRegistry(req.body.target === 'registry' ? targets.registry : targets.helper, deps.probe));
  }));
  let pulling = false;
  app.post('/diagnostics/pull', authenticate, bounded(async (req, res) => {
    if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.runner !== 'string') {
      res.status(400).json({message: 'Choose a configured runner manager.'}); return;
    }
    if (pulling) { res.status(429).json({message: 'A helper pull is already in progress.'}); return; }
    pulling = true;
    try {
      const targets = await deps.targets();
      if (!targets.runners.includes(req.body.runner)) { res.status(400).json({message: 'The selected runner is not an available configured manager.'}); return; }
      const context = await deps.inspect(req.body.runner);
      if (context.image !== targets.helperImage) { res.status(409).json({message: 'The runner helper image differs from the configured immutable helper image. Review runner configuration before retrying.'}); return; }
      const start = performance.now();
      const result = await deps.pull(context);
      res.json({runner: context.runner, image: context.image, context: context.daemon, authentication: context.authentication,
        durationMs: Math.round(performance.now() - start), success: result.success, code: result.code,
        detail: result.success ? 'The selected daemon completed this exact helper-image pull. CI startup, runner credentials and other images remain unverified.' :
          'The selected daemon did not confirm a completed pull. This result alone does not establish a network ban, credential failure or missing digest. Layers may have been cached; a timed-out daemon operation may continue.'});
    } finally { pulling = false; }
  }));
}
