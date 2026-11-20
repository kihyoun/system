import {
  RuntimeVerificationService,
  cube,
  serviceOrigin,
  type RuntimeBaseline,
  type VerificationOptions,
} from '../host-bootstrap/runtime-verification.service';
import 'reflect-metadata';
import {
  RecoveryPublicationService,
  recoverySource,
  releaseInstalledSource,
} from './recovery-publication.service';
import { UpgradeLifecycleService } from './upgrade-lifecycle.service';
import fs from 'node:fs';
import { UpgradePrerequisiteService } from './upgrade-prerequisite.service';
import { HostReleaseAuthorityService } from './release-authority.service';
import {
  runtimeImageSelectors,
  runnerCount,
  verifyImageInspections,
  RuntimeInspectionService,
  inspectServiceRows,
  failedStoppedController,
  type RuntimeConfig,
  type ContainerRow,
} from './runtime-inspection';
import { HostSourceService } from './source';
import { validateUpgradeGraph, upgradePath } from './upgrade-graph';
import { RecoveryImageService } from './recovery-images';
import { RecoveryManifestService, type RecoveryManifest } from './recovery-manifest';
import path from 'node:path';
import {
  HostInstallService,
  reference,
  sourceIdentity,
  checkedImage,
  acceptedMetadata,
  fresh,
  writePrivate,
  privateFile,
  type InstallOptions,
} from './install';

let retainedContext:
  | Promise<Awaited<ReturnType<typeof import('@nestjs/core').NestFactory.createApplicationContext>>>
  | undefined;
export async function closeCompatibilityContext() {
  if (retainedContext) await (await retainedContext).close();
  retainedContext = undefined;
}

/** Fixed compatibility RPC; pure decisions avoid unnecessary Nest startup. */
export async function compatibility(
  input: {
    operation: string;
    arguments: unknown[];
    deadline?: number;
    environment?: NodeJS.ProcessEnv;
  },
  retain = false,
) {
  const args = input.arguments;
  switch (input.operation) {
    case 'releaseInstalledSource':
      return releaseInstalledSource(args[0]);
    case 'recoverySource':
      return recoverySource(args[0]);
    case 'runtimeImageSelectors':
      return runtimeImageSelectors(args[0] as RuntimeConfig);
    case 'verifyImageInspections':
      return verifyImageInspections(
        args[0] as RuntimeConfig,
        args[1] as RecoveryManifest,
        args[2] as Record<string, ContainerRow>,
        args[3] as Parameters<typeof verifyImageInspections>[3],
      );
    case 'inspectServiceRows':
      return inspectServiceRows(
        args[0] as RuntimeConfig,
        args[1],
        args[2] === null ? undefined : (args[2] as string),
      );
    case 'runtimeRunnerCount':
      return runnerCount(args[0] as RuntimeConfig);
    case 'failedStoppedController':
      return failedStoppedController(args[0] as ContainerRow, args[1]);
    case 'validateUpgradeGraph':
      return validateUpgradeGraph(args[0]);
    case 'upgradePath':
      return upgradePath(args[0], String(args[1]), String(args[2]));
    case 'reference':
      return reference(args[0]);
    case 'sourceIdentity':
      return sourceIdentity(String(args[0]), String(args[1]), String(args[2]));
    case 'checkedImage':
      return checkedImage(
        String(args[0]),
        args[1] as Parameters<typeof checkedImage>[1],
        args[2],
        args[3] === true,
      );
    case 'acceptedMetadata':
      return acceptedMetadata(
        args[0] ? String(args[0]) : undefined,
        args[1] as Parameters<typeof acceptedMetadata>[1],
        String(args[2]),
        String(args[3]),
      );
    case 'fresh':
      return fresh(String(args[0]), String(args[1]));
    case 'privateFile':
      return privateFile(String(args[0]));
    case 'writePrivate':
      return writePrivate(String(args[0]), Buffer.from(String(args[1]), 'base64'));
  }
  const create = async () => {
    const { NestFactory } = await import('@nestjs/core');
    const { HostModule } = await import('./host.module.js');
    return NestFactory.createApplicationContext(
      HostModule.register({
        lifecycleEvidence: require('../../../gitlab/guided-preview-evidence'),
      }),
      { logger: false },
    );
  };
  const app = await (retain ? (retainedContext ??= create()) : create());
  try {
    const host = app.get(HostInstallService);
    host.deadline = input.deadline;
    host.environment = input.environment ?? process.env;
    switch (input.operation) {
      case 'runtimeVerification': {
        const service = app.get(RuntimeVerificationService),
          method = String(args[0]),
          values = args.slice(1),
          config = values[0] as RuntimeConfig;
        switch (method) {
          case 'cube':
            return cube(Buffer.from(String(values[0]), 'base64'));
          case 'origin':
            return serviceOrigin(config, String(values[1]));
          case 'settings':
            return service.settings(String(values[0]), String(values[1]), host.environment);
          case 'files':
            return service.files(config);
          case 'manifestAbsent':
            return service.manifestAbsent(config);
          case 'inspectServices':
            return service.services(config, values[1] == null ? undefined : String(values[1]));
          case 'verifyImages':
            return app
              .get(RuntimeInspectionService)
              .images(
                config,
                values[1] as RecoveryManifest,
                values[2] as Record<string, ContainerRow>,
              );
          case 'publicImages':
            return service.publicImages(config, values[1] as Record<string, ContainerRow>);
          case 'capture':
            return service.capture(
              config,
              String(values[1]),
              values[2] === true,
              values[3] == null ? undefined : String(values[3]),
              values[4] == null ? undefined : (values[4] as RecoveryManifest),
            );
          case 'assertBaseline':
            return service.assertBaseline(config, values[1] as RuntimeBaseline);
          case 'sync':
            return service.sync(config);
          case 'managementRoutes':
            return service.managementRoutes(config);
          case 'routes':
            return service.routes(
              config,
              values[1] as Record<string, ContainerRow>,
              values[2] == null ? undefined : String(values[2]),
            );
          case 'runnerContacts':
            return service.runnerContacts(
              config,
              values[1] as RuntimeBaseline,
              values[2] == null ? undefined : String(values[2]),
            );
          case 'verify':
            return service.verify(
              config,
              values[1] as RuntimeBaseline,
              values[2] as VerificationOptions,
            );
          case 'http': {
            const result = await service.http(
              String(values[0]),
              undefined,
              values[1] ?? undefined,
              (values[2] ?? {}) as Record<string, string>,
            );
            return {
              status: result.status,
              body: result.body.toString('base64'),
              headers: Object.fromEntries(result.headers),
            };
          }
          default:
            throw Error('unsupported-runtime-verification-operation');
        }
      }
      case 'refreshRecoveryManifest':
        return app
          .get(RecoveryPublicationService)
          .refresh(
            args[0],
            args[1],
            args[2],
            String(args[3]),
            String(args[4]),
            String(args[5]),
            String(args[6]),
            String(args[7]),
            args[8] === null ? undefined : String(args[8]),
            args[9] === null ? undefined : String(args[9]),
          );
      case 'interruptUpgrade':
        return app.get(UpgradeLifecycleService).interrupt(String(args[0]));
      case 'approvedUpgradePlan':
        return app.get(UpgradeLifecycleService).approvedPlan(String(args[0]), args[1]);
      case 'upgradePhase':
        return app
          .get(UpgradeLifecycleService)
          .transition(String(args[0]), args[1], args[2], args[3] ?? undefined);
      case 'gitlabUpgradePrerequisite':
        return app
          .get(UpgradePrerequisiteService)
          .verify(String(args[0]), String(args[1]), String(args[2]), args[3]);
      case 'publicReleaseInputs':
        return app
          .get(HostReleaseAuthorityService)
          .publicInputs(args[0], Buffer.from(String(args[1]), 'base64'), args[2]);
      case 'releaseInputs':
        return app
          .get(HostReleaseAuthorityService)
          .inputs(
            Buffer.from(String(args[0]), 'base64'),
            Buffer.from(String(args[1]), 'base64'),
            args[2],
          );
      case 'verifyMounts':
        return app
          .get(RuntimeInspectionService)
          .mounts(args[0] as RuntimeConfig, args[1] as Record<string, ContainerRow>);
      case 'verifySourceObjects':
        return app.get(HostSourceService).verifyObjects(args[0], String(args[1]));
      case 'verifyCheckout':
        return app.get(HostSourceService).verifyCheckout(args[0], String(args[1]));
      case 'verifyAncestry':
        return app.get(HostSourceService).verifyAncestry(args[0], args[1], String(args[2]));
      case 'restoreImages':
        return app.get(RecoveryImageService).restore(String(args[0]), args[1] as RecoveryManifest);
      case 'loadManifest':
        return app
          .get(RecoveryManifestService)
          .load(
            String(args[0]),
            String(args[1]),
            args[2] ? String(args[2]) : undefined,
            args[3] === true,
            args[4] === null || args[4] === undefined ? undefined : String(args[4]),
          );
      case 'validateSelected':
        return app
          .get(RecoveryManifestService)
          .validateSelected(args[0] as RecoveryManifest, String(args[1]));
      case 'source':
        return host.source(String(args[0]));
      case 'storage':
        return host.storage(String(args[0]), String(args[1]));
      case 'noExistingServices':
        return host.noExistingServices();
      case 'install':
        return host.install(args[0] as InstallOptions, String(args[1]));
      default:
        throw Error('unknown-host-operation');
    }
  } finally {
    if (!retain) await app.close();
  }
}
export function installArguments(argv: string[]): InstallOptions {
  const result: InstallOptions = {
    controller: '',
    wizard: '',
    persistenceEnv: '/etc/system-bootstrapper/persistence.env',
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--install-host') {
      result.installHost = true;
      continue;
    }
    const mapped = {
      '--controller': 'controller',
      '--wizard': 'wizard',
      '--persistence-env': 'persistenceEnv',
      '--release-metadata': 'releaseMetadata',
    }[key];
    if (!mapped || !argv[i + 1] || argv[i + 1].startsWith('--'))
      throw Error('invalid-install-arguments');
    result[mapped as 'controller' | 'wizard' | 'persistenceEnv' | 'releaseMetadata'] = argv[++i];
  }
  reference(result.controller);
  reference(result.wizard);
  return result;
}
export async function hostMain(): Promise<void> {
  try {
    if (process.argv[2] === '--worker') {
      const { compatibilityWorker } = await import('./compatibility-worker.js');
      await compatibilityWorker();
    } else if (process.argv[2] === '--compatibility') {
      const result = await compatibility(JSON.parse(fs.readFileSync(0, 'utf8')));
      process.stdout.write(JSON.stringify({ value: result ?? null }) + '\n');
    } else if (process.argv.includes('--help')) {
      process.stdout.write(
        'install-release --controller IMAGE@sha256:DIGEST --wizard IMAGE@sha256:DIGEST [--persistence-env FILE] [--release-metadata FILE] [--install-host]\n',
      );
    } else {
      const { NestFactory } = await import('@nestjs/core');
      const { HostModule } = await import('./host.module.js');
      const app = await NestFactory.createApplicationContext(HostModule.register(), {
        logger: false,
      });
      try {
        app
          .get(HostInstallService)
          .install(installArguments(process.argv.slice(2)), path.resolve(__dirname, '../../..'));
      } finally {
        await app.close();
      }
      process.stdout.write(
        'Public release startup requested. Complete first setup in the Wizard; service readiness is separate.\n',
      );
    }
  } catch (error) {
    const code =
      error instanceof Error && /^[a-z][a-zA-Z0-9:-]+$/.test(error.message)
        ? error.message
        : 'invalid-private-input-or-filesystem';
    if (process.argv[2] === '--compatibility')
      process.stdout.write(JSON.stringify({ error: code }) + '\n');
    else process.stderr.write('Public release installation: ' + code + '\n');
    process.exitCode = 1;
  }
}

if (require.main === module) void hostMain();
