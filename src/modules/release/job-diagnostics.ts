import { object, type EvidenceObject } from './evidence-values';
interface DiagnosticReport extends EvidenceObject {
  commands: string[];
  codes: string[];
  testFiles?: string[];
  testSuites?: string[];
  exitCode?: number;
}
// Never retain a raw job trace: it may contain registry or GitLab credentials.
// Reports contain only these fixed, source-controlled classifications.
const commands: Record<string, RegExp> = {
  build: /^\$ docker build\b/m,
  login: /^\$ .*docker login\b/m,
  push: /^\$ docker push\b/m,
  pull: /^\$ docker pull\b/m,
  run: /^\$ docker run\b/m,
  proof: /^\$ printf candidate-registry-ok\b/m,
};
const failures: Record<string, RegExp> = {
  'registry-protocol':
    /server gave HTTP response to HTTPS client|Client sent an HTTP request to an HTTPS server/i,
  'registry-authentication':
    /no basic auth credentials|authentication required|unauthorized:|HTTP Basic: Access denied|denied: requested access/i,
  'connection-refused': /connection refused/i,
  'network-resolution':
    /no such host|Could not resolve host|network is unreachable|i\/o timeout|TLS handshake timeout/i,
  'daemon-transport':
    /Cannot connect to the Docker daemon|Is the docker daemon running|permission denied[^\n]*docker.sock/i,
  'image-unavailable':
    /No such image|manifest unknown|pull access denied|failed to resolve source metadata/i,
  'buildx-unavailable':
    /buildx[^\n]*(?:not a docker command|missing)|requires the buildx component/i,
  'invalid-image-reference': /invalid reference format/i,
  'runner-pull-policy':
    /PullPolicies[^\n]{0,200}AllowedPullPolicies|pull_policy[^\n]*not[^\n]*allowed/i,
  'checkout-failed':
    /fatal: unable to access|fatal:.*could not read Username|Authentication failed|Repository not found/i,
  'artifact-failed': /No files to upload|Uploading artifacts[^\n]*failed/i,
  'package-version-unavailable':
    /unable to select packages|breaks: world\[|Version [^\n]+ was not found/i,
  'npm-command-failed': /npm (?:error|ERR!) (?:code|command|errno)/i,
  'javascript-test-timeout': /(?!)/,
  'javascript-test-failed':
    /AssertionError|ERR_ASSERTION|(?:Test Files|Tests)\s+\d+ failed|FAIL\s+(?:src|tests?)\//,
  'typecheck-failed': /error TS[0-9]{4}:|TS[0-9]{4}:|Type error:/,
  'browser-check-failed':
    /browserType\.launch:|Failed to install browsers|Host system is missing dependencies|Executable doesn't exist at/i,
  'unclassified-job-failure': /(?!)/,
  'trace-unavailable': /(?!)/,
};
// Exact package script bodies from the supported Wizard source. A phase records
// an observed invocation, not its success or the cause of a later failure.
const phases: Record<string, string> = {
  lint: '> eslint .',
  'unit-tests': '> vitest run',
  'production-build': '> npm run docs:check && npm run typecheck && vite build',
  'docs-check':
    '> node scripts/compile-docs-locales.mjs --check && node --test tests/offline/docs-locales.test.cjs',
  typecheck: '> tsc --noEmit',
  'configuration-export':
    '> npm run build:config-export && node --test tests/offline/export-configuration.test.cjs',
  'configuration-export-build':
    '> rolldown scripts/export-configuration.ts --platform node --format cjs --file build-tools/export-configuration.cjs --no-codeSplitting',
  'delivery-tests': '> node --test tests/offline/delivery-recipe.test.cjs',
};
// Reviewed paths from the Wizard test sources. Only fixed file IDs survive;
// text following a known path is ignored, including parameterized test titles.
const testFiles: Record<string, string> = {
  'wizard-src-api-applicationaliases': 'src/api/ApplicationAliases.test.ts',
  'wizard-src-api-backuppair': 'src/api/BackupPair.test.tsx',
  'wizard-src-api-previewsetupintent': 'src/api/PreviewSetupIntent.test.tsx',
  'wizard-src-api-projectconfig': 'src/api/ProjectConfig.test.tsx',
  'wizard-src-api-recoveryconfig': 'src/api/RecoveryConfig.test.tsx',
  'wizard-src-api-runnerconfig': 'src/api/RunnerConfig.test.tsx',
  'wizard-src-api-syncserver': 'src/api/SyncServer.test.tsx',
  'wizard-src-api-websiteconfig': 'src/api/WebsiteConfig.test.tsx',
  'wizard-src-components-derivedlabel': 'src/components/DerivedLabel.test.tsx',
  'wizard-src-components-servercontrolbutton': 'src/components/ServerControlButton.test.tsx',
  'wizard-src-components-dialogs-pushdialog': 'src/components/dialogs/PushDialog.test.tsx',
  'wizard-src-components-dialogs-systemdiagnosticsdialog':
    'src/components/dialogs/SystemDiagnosticsDialog.test.tsx',
  'wizard-src-components-dialogs-tokenoverviewdialog':
    'src/components/dialogs/TokenOverviewDialog.test.tsx',
  'wizard-src-components-docs-docs': 'src/components/docs/Docs.test.tsx',
  'wizard-src-components-docs-migrationguide': 'src/components/docs/MigrationGuide.test.tsx',
  'wizard-src-components-form-wizard-i18n': 'src/components/form-wizard/I18n.test.tsx',
  'wizard-src-components-form-wizard-dialog-backupworkflowdialog':
    'src/components/form-wizard/dialog/BackupWorkflowDialog.test.tsx',
  'wizard-src-components-form-wizard-general-form-fields-startfields':
    'src/components/form-wizard/general-form/fields/StartFields.test.tsx',
  'wizard-src-components-form-wizard-projects-overview-previewsetupdialog':
    'src/components/form-wizard/projects-overview/PreviewSetupDialog.test.tsx',
  'wizard-src-components-form-wizard-projects-overview-projectformdialog':
    'src/components/form-wizard/projects-overview/ProjectFormDialog.test.tsx',
  'wizard-src-components-form-wizard-projects-overview-projectsoverview':
    'src/components/form-wizard/projects-overview/ProjectsOverview.test.tsx',
  'wizard-src-components-form-wizard-projects-overview-wizardbuilddialog':
    'src/components/form-wizard/projects-overview/WizardBuildDialog.test.tsx',
  'wizard-src-components-form-wizard-projects-overview-wizardenvironmentsdialog':
    'src/components/form-wizard/projects-overview/WizardEnvironmentsDialog.test.tsx',
  'wizard-src-components-form-wizard-projects-overview-wizardsourcedialog':
    'src/components/form-wizard/projects-overview/WizardSourceDialog.test.tsx',
  'wizard-src-components-legal-publicsiteinfo': 'src/components/legal/PublicSiteInfo.test.tsx',
  'wizard-src-docs-locales': 'src/docs/locales.test.tsx',
  'wizard-src-docs-model': 'src/docs/model.test.ts',
  'wizard-src-i18n-i18n': 'src/i18n/i18n.test.tsx',
  'wizard-src-i18n-operationskorean': 'src/i18n/operationsKorean.test.tsx',
  'wizard-tests-offline-delivery-recipe': 'tests/offline/delivery-recipe.test.cjs',
  'wizard-tests-offline-docs-locales': 'tests/offline/docs-locales.test.cjs',
  'wizard-tests-offline-export-configuration': 'tests/offline/export-configuration.test.cjs',
};
const tapLabels: Record<string, string> = {
  'successful image build binds immutable evidence and removes only its job resources':
    'wizard-suite-offline-delivery-recipe',
  'registry output without the exact image digest fails before recording build evidence':
    'wizard-suite-offline-delivery-recipe',
  'failed owned-resource cleanup fails the otherwise successful build':
    'wizard-suite-offline-delivery-recipe',
  'an expected-commit mismatch cannot contact Docker or publish an image':
    'wizard-suite-offline-delivery-recipe',
  'German docs compiler rejects stale, missing, summarized or technically changed translations':
    'wizard-suite-offline-docs-locales',
  'Korean docs preserve complete technical content and reject stale, missing or changed locale sources':
    'wizard-suite-offline-docs-locales',
  'offline adapter executes actual Wizard models and writes a signed private backup without browser or network':
    'wizard-suite-offline-export-configuration',
  'offline Fetch adapter carries supplied authenticated observation without confusing it with saved settings':
    'wizard-suite-offline-export-configuration',
  'coordinated export binds completed generation to exact ENV bytes through ordinary ZIP exporter':
    'wizard-suite-offline-export-configuration',
};
const testSuites: Record<string, boolean> = {
  'wizard-suite-offline-delivery-recipe': true,
  'wizard-suite-offline-docs-locales': true,
  'wizard-suite-offline-export-configuration': true,
};
function failureDetails(clean: string) {
  const observedPhases = new Set<string>(),
    files = new Set<string>(),
    suites = new Set<string>();
  let failureLines = 0,
    timedOut = false;
  const paths = new Map(Object.entries(testFiles).map(([id, file]) => [file, id]));
  for (let line of clean.split(/\r?\n/)) {
    // GitLab timestamp/stream and Docker build progress are transport prefixes.
    line = line
      .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z (?:\d{2}[OE] )?/, '')
      .replace(/^#\d+ \d+(?:\.\d+)? /, '')
      .trim();
    for (const [id, command] of Object.entries(phases))
      if (line === command) observedPhases.add(id);
    const fail = /^FAIL\s+(.+)$/.exec(line);
    if (fail) {
      failureLines = 0;
      const file = fail[1].split(' > ', 1)[0],
        id = paths.get(file);
      if (id) {
        files.add(id);
        failureLines = 12;
      }
    }
    const tap = /^not ok [1-9][0-9]* - (.+)$/.exec(line);
    if (tap) {
      failureLines = 0;
      if (Object.hasOwn(tapLabels, tap[1])) {
        suites.add(tapLabels[tap[1]]);
        failureLines = 12;
      }
    }
    const nodeFailure = /^✖ (.+) \([0-9]+(?:\.[0-9]+)?m?s\)$/.exec(line);
    if (nodeFailure) {
      failureLines = 0;
      if (Object.hasOwn(tapLabels, nodeFailure[1])) {
        suites.add(tapLabels[nodeFailure[1]]);
        failureLines = 12;
      }
    }
    if (failureLines > 0) {
      if (
        /^(?:Error: )?(?:Test|Hook) timed out in [1-9][0-9]*ms\.?$/.test(line) ||
        /^error: 'test timed out after [1-9][0-9]*ms'$/.test(line) ||
        /^failureType: 'testTimeoutFailure'$/.test(line)
      )
        timedOut = true;
      failureLines--;
    }
  }
  const result: EvidenceObject = {};
  if (observedPhases.size) result.phases = [...observedPhases];
  if (files.size) result.testFiles = [...files];
  if (suites.size) result.testSuites = [...suites];
  if (timedOut) result.codes = ['javascript-test-timeout'];
  return result;
}
const reasons = new Set([
  'script_failure',
  'runner_configuration_error',
  'runner_system_failure',
  'job_execution_timeout',
  'stuck_or_timeout_failure',
  'api_failure',
  'unknown_failure',
]);
export const failureReason = (value: unknown) =>
  typeof value === 'string' && reasons.has(value) ? value : undefined;
const setupFailures: Record<string, string> = {
  'Source transfer failed. Inspect project ownership and remote refs before explicitly resuming.':
    'source-transfer-failed',
  'Source CI producers differ from the accepted controller. No refs were pushed; use the explicit reviewed source-primary path.':
    'source-producer-mismatch',
  'The source default branch changed or is unavailable. No refs were pushed; run preflight again.':
    'source-default-branch-changed',
  'The imported project contains changed or additional refs. Preserve operator edits and reconcile manually.':
    'source-refs-conflict',
  'All required native source and delivery checks must succeed.': 'native-check-failed',
  'Native Wizard pipeline failed outside the optional public mirror.': 'native-check-failed',
};
const setupCodes = new Set([...Object.values(setupFailures), 'setup-failure-unclassified']);
export const setupFailureCode = (value: unknown) =>
  typeof value === 'string' && setupCodes.has(value) ? value : undefined;
export function setupFailure(input: unknown) {
  const job = object(input);
  return (
    setupFailureCode(job?.failureCode) ||
    (typeof job?.message === 'string' && Object.hasOwn(setupFailures, job.message)
      ? setupFailures[job.message]
      : 'setup-failure-unclassified')
  );
}
export function classify(trace: unknown) {
  if (typeof trace !== 'string' || trace.length > 524288) return { codes: ['trace-unavailable'] };
  const clean = trace.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const result: DiagnosticReport = {
    commands: Object.entries(commands)
      .filter(([, pattern]) => pattern.test(clean))
      .map(([name]) => name),
    codes: Object.entries(failures)
      .filter(([, pattern]) => pattern.test(clean))
      .map(([name]) => name),
  };
  const details = failureDetails(clean);
  const detailCodes = Array.isArray(details.codes)
    ? details.codes.filter((value): value is string => typeof value === 'string')
    : [];
  delete details.codes;
  Object.assign(result, details);
  result.codes.push(...detailCodes);
  if (
    (result.testFiles?.length || result.testSuites?.length) &&
    !result.codes.includes('javascript-test-failed')
  )
    result.codes.push('javascript-test-failed');
  const exit = /ERROR: Job failed[^\n]*exit code ([0-9]{1,3})\b/.exec(clean);
  if (exit && Number(exit[1]) <= 255) result.exitCode = Number(exit[1]);
  return result;
}
export function sanitize(input: unknown): EvidenceObject | undefined {
  const value = object(input);
  if (!value || typeof value !== 'object') return undefined;
  const result: EvidenceObject = {};
  for (const [key, allowed] of Object.entries({
    commands,
    codes: failures,
    phases,
    testFiles,
    testSuites,
  })) {
    if (Array.isArray(value[key]))
      result[key] = value[key]
        .filter((item) => typeof item === 'string' && Object.hasOwn(allowed, item))
        .slice(0, 12);
  }
  if (
    typeof value.exitCode === 'number' &&
    Number.isInteger(value.exitCode) &&
    value.exitCode >= 0 &&
    value.exitCode <= 255
  )
    result.exitCode = value.exitCode;
  return Object.keys(result).length ? result : undefined;
}
