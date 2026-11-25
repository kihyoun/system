import { environment, shellValue } from './Environment';

/** Descriptive backup evidence only. Never apply these fields to configuration. */
export function recoveryMetadata(
  content: string,
  observation: any = null,
  now = new Date(),
  importedBackup: any = null,
  seedAssociation: any = null,
): any {
  const values = Object.fromEntries(
    environment(content).map(([key, value]) => [key, shellValue(value)]),
  );
  const savedImages = Object.fromEntries(
    Object.entries({
      controller: 'BOOTSTRAPPER_IMAGE',
      wizard: 'WIZARD_IMAGE',
      gitlab: 'GITLAB_IMAGE',
      runner: 'GITLAB_RUNNER_IMAGE',
      runnerHelper: 'GITLAB_RUNNER_HELPER_IMAGE',
      nginx: 'NGINX_IMAGE',
    }).map(([role, key]) => [
      role,
      {
        setting: key,
        reference: values[key] ?? null,
        status: values[key] ? 'saved' : values[key] === '' ? 'empty' : 'unspecified',
      },
    ]),
  );
  return {
    format: 'system-configuration-recovery-v1',
    createdAt: now.toISOString(),
    scope: 'configuration-only',
    savedImages,
    importedBackup,
    recoveryTools: {
      minimumSystemProductVersion: '1.0.0',
      backupFormat: 'system-configuration-recovery-v1',
      extendedConfigurationZipRequired: true,
      note: 'Recovery-tool compatibility is separate from saved runtime image selection; older controllers may reject the metadata entries.',
    },
    observedRuntime:
      observation?.format === 'system-runtime-observation-v1'
        ? observation
        : {
            format: 'system-runtime-observation-v1',
            status: 'unavailable',
            observedAt: null,
            reason: 'No authenticated runtime observation accompanies this configuration.',
            system: null,
            wizard: null,
            images: {},
          },
    seed: validSeedAssociation(seedAssociation)
      ? seedAssociation
      : {
          status: 'matching-completed-seed-required',
          generation: null,
          manifest: null,
          verified: false,
          reason:
            'This export neither contains nor verifies persistent service data or a Seed association.',
        },
  };
}

export function validSeedAssociation(value: any): boolean {
  return (
    value?.format === 'system-backup-pair-v1' &&
    value.status === 'matched-completed-seed' &&
    value.verified === true &&
    /^[a-f0-9]{32}$/.test(value.operation) &&
    /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value.generation) &&
    value.manifest === `snapshots/${value.generation}/manifest.json` &&
    /^[a-f0-9]{64}$/.test(value.manifestSha256) &&
    !Number.isNaN(Date.parse(value.completedAt)) &&
    !Number.isNaN(Date.parse(value.capturedAt)) &&
    Array.isArray(value.configurationFiles) &&
    value.configurationFiles.length > 0 &&
    value.configurationFiles.length <= 1000 &&
    value.configurationFiles[0].filename === '.docker.env' &&
    new Set(value.configurationFiles.map((file: any) => file.filename)).size ===
      value.configurationFiles.length &&
    value.configurationFiles.every(
      (file: any) =>
        /^(?:\.docker\.env|\.projects\.env\/\.[A-Za-z0-9_.-]+\.env)$/.test(file.filename) &&
        /^[a-f0-9]{64}$/.test(file.sha256),
    )
  );
}

export function recoveryGuide(metadata: any): string {
  return `# Restore this configuration with a matching completed Seed\n\nBackup: ${metadata.createdAt}\nFormat: ${metadata.format}\n\nThis archive contains settings and secrets, recovery.json and this guide. It does\nnot contain GitLab data, registry image payloads, certificates or renewal state.\nProtect the whole archive as a secret. Recovery metadata is descriptive data only;\nOpen/Push never use it to select images, change storage or start a migration.\n\n1. Read recovery.json (also embedded as recovery in bootstrapper.json). Saved image\n   references are settings; observedRuntime records a separately timestamped\n   authenticated observation when available. Unknown/offline information is not\n   verified and must not be replaced with latest. A browser export can differ from\n   the running platform; reconcile the two before selecting recovery inputs.\n   importedBackup, when present, retains historical unverified evidence from an\n   opened JSON backup. It is not a fresh observation or authority over settings.\n2. Select the completed Harvest Seed corresponding to this configuration and\n   verify its manifest, generation, timestamp and exact GitLab image/version.\n   ${validSeedAssociation(metadata.seed) ? 'The coordinated workflow recorded the exact completed generation and manifest checksum in recovery.json. Verify these against the retained Seed and check configurationFiles against the archive ENV entries.' : 'No matching Seed has been inferred or verified by this configuration export.'}\n   A newer export and an older Seed are not automatically a matching pair.\n3. Fetch the recorded System source revision and verify its source layout:\n   git clone https://github.com/kihyoun/system.git\n   cd system\n   git checkout --detach <recorded-System-source-revision>\n   For system-monorepo-v1, wizard/ is an ordinary directory: verify sourceRevision\n   and wizardSourceTree against the accepted metadata. Only historical gitlink\n   checkouts require git submodule update --init --recursive.\n   If source identity is unavailable, obtain and verify it before recovery.\n   Public accepted releases include versioned metadata at\n   https://github.com/kihyoun/system/releases with paired immutable images.\n4. Pull the required exact image digests or load separately retained verified\n   Docker image archives. A reference does not preserve an image payload. Keep\n   private/unavailable images recoverable independently, or in the matching\n   restored registry; never substitute a new build for a missing immutable image.\n5. Use recovery tools from accepted System product release 1.0.0 or newer that\n   explicitly support system-configuration-recovery-v1 and the selected Seed. Older\n   controller helpers can reject the extra ZIP entries. A saved old controller\n   image is a runtime selection, not proof of compatible recovery tools. Obtain\n   the compatible accepted tool checkout/controller separately; do not change\n   saved runtime image settings or claim an old runtime version was verified.\n   Follow docs/RECOVERY_CONTRACT.md in the compatible tool checkout. The commands\n   below use the 2.0 tools; historical accepted tools require their own documented\n   procedure. Before any host operation, prepare verified Node 24.22.0 and npm\n   11.19.1 plus dist, node_modules and operations/assets as described in\n   Prepare-Host.md. Retain this runtime for offline recovery. A source checkout\n   alone is insufficient; source builds run npm ci and npm run build in operations.\n   Prepare the supported Ubuntu host with the compiled host bootstrap CLI:\n   sudo /absolute/verified/node /absolute/tools/dist/modules/host-bootstrap/entry.js install-host --checkout /absolute/tools\n   Select fresh live storage and mount the retained backup filesystem using the\n   private /etc/system-bootstrapper/persistence.env selector, then run:\n   sudo /absolute/verified/node /absolute/tools/dist/cli/main.js persistence --checkout /absolute/tools\n   sudo /absolute/verified/node /absolute/tools/dist/cli/main.js restore --checkout /absolute/tools --image <accepted-controller-image> --persistence-env /etc/system-bootstrapper/persistence.env --configuration-backup <absolute-path-to-this-ZIP> --check-only\n   Repeat restore without --check-only after reviewing validation. Do not start\n   writers first. Keep host storage selectors separate from imported configuration.\n   Restore requires the Seed's exact GitLab image and refuses existing live data.\n6. Install the documented certificate integration if applicable, then start with:\n   sudo /absolute/verified/node /absolute/tools/dist/cli/main.js start --checkout /absolute/tools\n   Verify authenticated Fetch, Wizard, GitLab, registry and runner CI.\n   Use the recorded versions and native upgrade/rollback tools for any later\n   migration; configuration import is not a database upgrade.\n\nFull procedure: https://github.com/kihyoun/system/blob/master/docs/RECOVERY_CONTRACT.md\nThe matching source checkout is the authoritative version of that procedure.\n`;
}

/** Retain one historical record; never grow a nested chain or retain Seed claims. */
export function importedRecovery(value: any): any {
  if (
    value?.format !== 'system-configuration-recovery-v1' ||
    JSON.stringify(value).length > 1024 * 1024
  )
    return null;
  return {
    format: value.format,
    status: 'imported-unverified',
    createdAt: value.createdAt || null,
    savedImages: value.savedImages || null,
    observedRuntime: value.observedRuntime || null,
    recoveryTools: value.recoveryTools || null,
  };
}
