import { publicPackagePayload } from '../../common/publicPayload';
const publicInputs = new Set<string>(publicPackagePayload);
export const snapshotPath = 'assets/wizard-source/snapshot.json';
const credentialsSource = 'src/modules/mirror/credentials.service.ts';
const initialTools = ['tools/quickstart/quickstart.sh', 'tools/gitlab/bootstrap-token.rb'];
const packageFiles = [
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'eslint.config.mjs',
  '.prettierrc',
  '.prettierignore',
  'LICENSE',
  'README.md',
  'VERSION',
];
const privateName =
  /(^|\/)(private\.env|\.docker\.env|\.env(?:\.[^/]+)?|credentials(?:\.[^/]+)?|bootstrapper\.json|bootstrapper\.zip|bootstrapper_initial_root_password)$/;
function sourcePath(name: string): boolean {
  return (
    /^[A-Za-z0-9._/-]+$/.test(name) &&
    !name.split('/').some((part) => part === '..' || part === '.git')
  );
}
function publicFile(name: string, excluded: RegExp, publicTestCa = false): boolean {
  return (
    sourcePath(name) &&
    name !== snapshotPath &&
    !excluded.test(name) &&
    (name === credentialsSource || !privateName.test(name)) &&
    ((publicTestCa && name === 'tests/e2e/acme-fixture/pebble.minica.pem') ||
      !/\.(key|pem|p12|pfx)$/.test(name))
  );
}
export function includedTest(name: string): boolean {
  if (!name.startsWith('wizard/') && publicInputs.has(name)) {
    return true;
  }

  if (initialTools.includes(name)) {
    return true;
  }

  if (
    !publicFile(
      name,
      /(^|\/)(node_modules|dist|test-results|\.test-context|\.projects\.env)(\/|$)/,
      true,
    )
  ) {
    return false;
  }

  if (
    /^docs\/[A-Za-z0-9_.\/-]+\.(?:md|png|jpg|jpeg|svg)$/.test(name) ||
    [
      'docs/wizard-docs-catalog.json',
      'Prepare-Host.md',
      'overview.png',
      'gitlab-runner/README.md',
      'bootstrapper/README.md',
      'config/ca/cacert-2026-10-20.crt',
      'config/ca/provenance.json',
    ].includes(name)
  ) {
    return true;
  }

  return (
    name.startsWith('src/') ||
    ['config/', 'templates/', 'containers/', 'assets/', 'tests/'].some((prefix) =>
      name.startsWith(prefix),
    ) ||
    packageFiles.includes(name) ||
    ['renovate.json', '.gitlab-ci.yml', 'VERSION'].includes(name)
  );
}
export function includedCandidate(name: string): boolean {
  if (!name.startsWith('wizard/') && publicInputs.has(name)) {
    return true;
  }

  if (initialTools.includes(name)) {
    return true;
  }

  if (
    !publicFile(
      name,
      /(^|\/)(node_modules|dist|test-results|\.test-context|\.candidate-context|\.projects\.env|\.hosts|seed|ssl)(\/|$)/,
    )
  ) {
    return false;
  }

  if (
    !/^src\/modules\/configuration\/[^/]+\.ts$/.test(name) &&
    /(^|\/)configuration(\/|$)/.test(name)
  ) {
    return false;
  }

  if (name === 'tests/e2e/acme-host-runtime.js') {
    return true;
  }

  return (
    ['src', 'config', 'templates', 'containers', 'assets'].includes(name.split('/')[0]) ||
    packageFiles.includes(name) ||
    name === '.dockerignore'
  );
}
export function includedCodeql(name: string): boolean {
  if (!name.startsWith('wizard/') && publicInputs.has(name)) {
    return true;
  }

  return publicFile(
    name,
    /(^|\/)(node_modules|dist|test-results|\.test-context|\.candidate-context|\.codeql-context|\.projects\.env)(\/|$)/,
    true,
  );
}
