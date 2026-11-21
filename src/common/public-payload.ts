import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Exact immutable package payload; mutable runtime scaffolds, operator state and source snapshots are excluded. */
export const PUBLIC_PACKAGE_PAYLOAD = [
  'config/ca/cacert-2026-10-20.crt',
  'config/ca/provenance.json',
  'config/gitlab-runner/docker-compose.yml',
  'config/gitlab/docker-compose.omnibus.yml',
  'config/gitlab/gitlab.rb',
  'config/gitlab/security-release.json',
  'config/nginx-proxy/.projects/README.md',
  'config/nginx-proxy/docker-compose.yml',
  'config/releases/upgrade-paths.json',
  'config/system/.docker.env.example',
  'config/system/.seed.env',
  'config/system/docker-compose.yml',
  'containers/bootstrapper/Dockerfile',
  'containers/controller/Dockerfile',
  'templates/nginx/acme-http01.conf.template',
  'templates/nginx/default.conf.template',
  'templates/nginx/default.ssl.conf.template',
  'templates/nginx/default.sync.template',
  'templates/nginx/default.wildcard.conf.template',
  'templates/nginx/default.wildcard.ssl.conf.template',
  'templates/project-bootstrap/preview-setup/README.md',
  'templates/project-bootstrap/templates/angular/.dockerignore',
  'templates/project-bootstrap/templates/angular/.editorconfig',
  'templates/project-bootstrap/templates/angular/.gitignore',
  'templates/project-bootstrap/templates/angular/.prettierrc',
  'templates/project-bootstrap/templates/angular/Dockerfile',
  'templates/project-bootstrap/templates/angular/GETTING_STARTED.md',
  'templates/project-bootstrap/templates/angular/angular.json',
  'templates/project-bootstrap/templates/angular/nginx.conf',
  'templates/project-bootstrap/templates/angular/package-lock.json',
  'templates/project-bootstrap/templates/angular/package.json',
  'templates/project-bootstrap/templates/angular/src/app/app.config.ts',
  'templates/project-bootstrap/templates/angular/src/app/app.css',
  'templates/project-bootstrap/templates/angular/src/app/app.html',
  'templates/project-bootstrap/templates/angular/src/app/app.routes.ts',
  'templates/project-bootstrap/templates/angular/src/app/app.spec.ts',
  'templates/project-bootstrap/templates/angular/src/app/app.ts',
  'templates/project-bootstrap/templates/angular/src/index.html',
  'templates/project-bootstrap/templates/angular/src/main.ts',
  'templates/project-bootstrap/templates/angular/src/styles.css',
  'templates/project-bootstrap/templates/angular/tsconfig.app.json',
  'templates/project-bootstrap/templates/angular/tsconfig.json',
  'templates/project-bootstrap/templates/angular/tsconfig.spec.json',
  'templates/project-bootstrap/templates/react/.dockerignore',
  'templates/project-bootstrap/templates/react/.gitignore',
  'templates/project-bootstrap/templates/react/Dockerfile',
  'templates/project-bootstrap/templates/react/GETTING_STARTED.md',
  'templates/project-bootstrap/templates/react/index.html',
  'templates/project-bootstrap/templates/react/nginx.conf',
  'templates/project-bootstrap/templates/react/package-lock.json',
  'templates/project-bootstrap/templates/react/package.json',
  'templates/project-bootstrap/templates/react/src/App.css',
  'templates/project-bootstrap/templates/react/src/App.tsx',
  'templates/project-bootstrap/templates/react/src/index.css',
  'templates/project-bootstrap/templates/react/src/main.tsx',
  'templates/project-bootstrap/templates/react/tsconfig.app.json',
  'templates/project-bootstrap/templates/react/tsconfig.json',
  'templates/project-bootstrap/templates/react/tsconfig.node.json',
  'templates/project-bootstrap/templates/react/vite.config.ts',
  'templates/project-bootstrap/templates/web/.dockerignore',
  'templates/project-bootstrap/templates/web/.gitignore',
  'templates/project-bootstrap/templates/web/Dockerfile',
  'templates/project-bootstrap/templates/web/GETTING_STARTED.md',
  'templates/project-bootstrap/templates/web/index.html',
  'templates/project-bootstrap/templates/web/main.js',
  'templates/project-bootstrap/templates/web/nginx.conf',
  'templates/project-bootstrap/templates/web/styles.css',
  'templates/project-bootstrap/wizard-build/README.md',
  'templates/project-bootstrap/wizard-build/cleanup-v2.sh',
  'templates/project-bootstrap/wizard-build/historical/refresh-ca-v4.txt',
  'templates/project-bootstrap/wizard-build/modern/Browser.Dockerfile',
  'templates/project-bootstrap/wizard-build/modern/Browser.Dockerfile.dockerignore',
  'templates/project-bootstrap/wizard-build/modern/Dockerfile',
  'templates/project-bootstrap/wizard-build/modern/Dockerfile.dockerignore',
  'templates/project-bootstrap/wizard-build/modern/build.sh',
  'templates/project-bootstrap/wizard-build/modern/cleanup.sh',
  'templates/project-bootstrap/wizard-build/modern/smoke/check.js',
  'templates/project-bootstrap/wizard-build/modern/smoke/package-lock.json',
  'templates/project-bootstrap/wizard-build/modern/smoke/package.json',
  'templates/project-bootstrap/wizard-build/modern/verify.sh',
  'templates/project-bootstrap/wizard-build/overview-v3/check.js',
  'templates/project-bootstrap/wizard-build/quickstart-v5/check.js',
  'templates/project-bootstrap/wizard-build/recipe/Browser.Dockerfile',
  'templates/project-bootstrap/wizard-build/recipe/Browser.Dockerfile.dockerignore',
  'templates/project-bootstrap/wizard-build/recipe/Dockerfile',
  'templates/project-bootstrap/wizard-build/recipe/Dockerfile.dockerignore',
  'templates/project-bootstrap/wizard-build/recipe/build.sh',
  'templates/project-bootstrap/wizard-build/recipe/cleanup.sh',
  'templates/project-bootstrap/wizard-build/recipe/smoke/check.js',
  'templates/project-bootstrap/wizard-build/recipe/smoke/package-lock.json',
  'templates/project-bootstrap/wizard-build/recipe/smoke/package.json',
  'templates/project-bootstrap/wizard-build/recipe/verify.sh',
  'templates/project-bootstrap/wizard-build/typed-v6/Browser.Dockerfile',
  'templates/project-bootstrap/wizard-build/typed-v6/Browser.Dockerfile.dockerignore',
  'templates/project-bootstrap/wizard-build/typed-v6/Dockerfile',
  'templates/project-bootstrap/wizard-build/typed-v6/Dockerfile.dockerignore',
  'templates/project-bootstrap/wizard-build/typed-v6/runtime/LICENSES.txt',
  'templates/project-bootstrap/wizard-build/typed-v6/runtime/project-ci.cjs',
  'templates/project-bootstrap/wizard-environments/README.md',
  'templates/project-bootstrap/wizard-environments/historical/run-v1.sh',
  'templates/project-bootstrap/wizard-environments/historical/source-primary-v1.sh',
  'templates/project-bootstrap/wizard-production/README.md',
  'templates/project-bootstrap/wizard-source-primary/README.md',
  'templates/project-bootstrap/wizard-upgrade/README.md',
  'wizard/.gitlab/runtime/LICENSES.txt',
  'wizard/.gitlab/runtime/project-ci.cjs',
] as const;

export interface PublicPayloadFile {
  path: string;
  content: Buffer;
}
interface PublicPayloadRow {
  path: string;
  sha256: string;
  content: string;
}
export interface PublicPayloadManifest {
  format: 'system-public-runtime-assets-v1';
  files: PublicPayloadRow[];
}
const checksum = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
// npm omits these three canonical template files during packing. Their validated
// static manifest bytes remain the package asset; no other missing path is optional.
const npmIgnoredTemplateFiles = new Set<string>([
  'templates/project-bootstrap/templates/angular/.gitignore',
  'templates/project-bootstrap/templates/react/.gitignore',
  'templates/project-bootstrap/templates/web/.gitignore',
]);
function regularParents(root: string, relative: string): void {
  let current = root;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    const entry = fs.lstatSync(current);
    if (entry.isSymbolicLink()) throw Error('public-payload-links-refused');
    if (!entry.isDirectory()) throw Error('public-payload-regular-directory-required');
  }
}

function regular(root: string, relative: string): Buffer {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const entry = fs.lstatSync(current);
    if (entry.isSymbolicLink()) throw Error('public-payload-links-refused');
  }
  const stat = fs.lstatSync(current);
  if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
    throw Error('public-payload-regular-file-required');
  return fs.readFileSync(current);
}
/** Build-time manifest creation reads only explicit public source paths. */
export function createPublicPayload(root: string): PublicPayloadManifest {
  return {
    format: 'system-public-runtime-assets-v1',
    files: PUBLIC_PACKAGE_PAYLOAD.map((name) => {
      const bytes = regular(root, name);
      return { path: name, sha256: checksum(bytes), content: bytes.toString('base64') };
    }),
  };
}
function readManifest(root: string): PublicPayloadManifest {
  const raw = regular(root, 'assets/public-runtime.json');
  if (raw.length > 32 * 1024 * 1024) throw Error('public-payload-manifest-too-large');
  const value: unknown = JSON.parse(raw.toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('public-payload-manifest-invalid');
  const record = value as Record<string, unknown>;
  if (
    record.format !== 'system-public-runtime-assets-v1' ||
    !Array.isArray(record.files) ||
    record.files.length !== PUBLIC_PACKAGE_PAYLOAD.length
  )
    throw Error('public-payload-manifest-invalid');
  const files: PublicPayloadRow[] = record.files.map((input: unknown, index: number) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw Error('public-payload-manifest-invalid');
    const row = input as Record<string, unknown>;
    if (
      row.path !== PUBLIC_PACKAGE_PAYLOAD[index] ||
      typeof row.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.sha256) ||
      typeof row.content !== 'string'
    )
      throw Error('public-payload-manifest-invalid');
    const bytes = Buffer.from(row.content, 'base64');
    if (bytes.toString('base64') !== row.content || checksum(bytes) !== row.sha256)
      throw Error('public-payload-manifest-hash-mismatch');
    return { path: PUBLIC_PACKAGE_PAYLOAD[index], sha256: row.sha256, content: row.content };
  });
  return { format: 'system-public-runtime-assets-v1', files };
}
/** Hash-verify the installed payload while retaining canonical source names. */
export function verifyPublicPayload(root: string): PublicPayloadFile[] {
  return readManifest(root).files.map((file) => {
    const selected = file.path;
    let bytes: Buffer;
    if (npmIgnoredTemplateFiles.has(selected)) {
      regularParents(root, selected);
      if (!fs.lstatSync(path.join(root, selected), { throwIfNoEntry: false })) {
        const alias = selected.slice(0, -10) + '.npmignore';
        bytes = fs.lstatSync(path.join(root, alias), { throwIfNoEntry: false })
          ? regular(root, alias)
          : Buffer.from(file.content, 'base64');
      } else bytes = regular(root, selected);
    } else bytes = regular(root, selected);
    if (checksum(bytes) !== file.sha256 || bytes.toString('base64') !== file.content)
      throw Error('public-payload-file-hash-mismatch');
    return { path: file.path, content: bytes };
  });
}
/** Do not enumerate disk entries: unknown files can never become generated project files. */
export function publicPayloadFiles(root: string, prefix: string): PublicPayloadFile[] {
  const selected = prefix.replace(/\/$/, '') + '/';
  if (!PUBLIC_PACKAGE_PAYLOAD.some((name) => name.startsWith(selected)))
    throw Error('public-payload-prefix-unknown');
  return verifyPublicPayload(root).filter((file) => file.path.startsWith(selected));
}
