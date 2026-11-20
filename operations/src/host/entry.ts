import { UpgradeLifecycleService } from './upgrade-lifecycle.service';
import fs from 'node:fs';
import { UpgradePrerequisiteService } from './upgrade-prerequisite.service';
import { HostReleaseAuthorityService } from './release-authority.service';
import {
  runtimeImageSelectors,
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

/** Fixed compatibility RPC for remaining Python consumers; never evaluates code. */
export function compatibility(input: {
  operation: string;
  arguments: unknown[];
  deadline?: number;
}) {
  const args = input.arguments,
    host = new HostInstallService(undefined, undefined, undefined, undefined, input.deadline);
  switch (input.operation) {
    case 'approvedUpgradePlan':
      return new UpgradeLifecycleService().approvedPlan(String(args[0]), args[1]);
    case 'upgradePhase':
      return new UpgradeLifecycleService().transition(
        String(args[0]),
        args[1],
        args[2],
        args[3] ?? undefined,
      );
    case 'gitlabUpgradePrerequisite':
      return new UpgradePrerequisiteService(host).verify(
        String(args[0]),
        String(args[1]),
        String(args[2]),
        args[3],
      );
    case 'publicReleaseInputs':
      return new HostReleaseAuthorityService(
        require('../../../gitlab/guided-preview-evidence'),
      ).publicInputs(args[0], Buffer.from(String(args[1]), 'base64'), args[2]);
    case 'releaseInputs':
      return new HostReleaseAuthorityService(
        require('../../../gitlab/guided-preview-evidence'),
      ).inputs(
        Buffer.from(String(args[0]), 'base64'),
        Buffer.from(String(args[1]), 'base64'),
        args[2],
      );
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
    case 'failedStoppedController':
      return failedStoppedController(args[0] as ContainerRow, args[1]);
    case 'verifyMounts':
      return new RuntimeInspectionService(host).mounts(
        args[0] as RuntimeConfig,
        args[1] as Record<string, ContainerRow>,
      );
    case 'verifySourceObjects':
      return new HostSourceService(host).verifyObjects(args[0], String(args[1]));
    case 'verifyCheckout':
      return new HostSourceService(host).verifyCheckout(args[0], String(args[1]));
    case 'verifyAncestry':
      return new HostSourceService(host).verifyAncestry(args[0], args[1], String(args[2]));
    case 'validateUpgradeGraph':
      return validateUpgradeGraph(args[0]);
    case 'upgradePath':
      return upgradePath(args[0], String(args[1]), String(args[2]));
    case 'restoreImages':
      return new RecoveryImageService(host).restore(String(args[0]), args[1] as RecoveryManifest);
    case 'loadManifest':
      return new RecoveryManifestService(host).load(
        String(args[0]),
        String(args[1]),
        args[2] ? String(args[2]) : undefined,
        args[3] === true,
        args[4] === null || args[4] === undefined ? undefined : String(args[4]),
      );
    case 'validateSelected':
      return new RecoveryManifestService(host).validateSelected(
        args[0] as RecoveryManifest,
        String(args[1]),
      );
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
if (require.main === module) {
  try {
    if (process.argv[2] === '--compatibility') {
      const result = compatibility(JSON.parse(fs.readFileSync(0, 'utf8')));
      process.stdout.write(JSON.stringify({ value: result ?? null }) + '\n');
    } else if (process.argv.includes('--help')) {
      process.stdout.write(
        'install-release --controller IMAGE@sha256:DIGEST --wizard IMAGE@sha256:DIGEST [--persistence-env FILE] [--release-metadata FILE] [--install-host]\n',
      );
    } else {
      new HostInstallService().install(
        installArguments(process.argv.slice(2)),
        path.resolve(__dirname, '../../..'),
      );
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
