import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as legacy from './legacy-build-recipe.service';
import { validate } from '../source-preparation/wizard-source.service';
import { generateTypedBuildRecipe } from '../project-ci/recipe.service';
export interface BuildRecipe {
  version: number;
  ciHash: string;
  recipeHash: string;
  profile?: string;
  ci: string;
  files: { path: string; content: string; sha256: string }[];
}
const sourceRoot = path.resolve(__dirname, '../../..');
const recipeRoot = path.join(sourceRoot, 'templates/project-bootstrap/wizard-build');
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const cleanupProfiles: Record<string, string> = {
  'legacy-cleanup-v2': 'legacy',
  'node24-vite8-cleanup-v2': 'node24-vite8',
};
const overviewProfile = 'node24-vite8-overview-v3';
const caProfiles: Record<string, string> = {
  'legacy-ca-v4': 'legacy-cleanup-v2',
  'node24-vite8-ca-v4': overviewProfile,
};
const quickstartProfile = 'node24-vite8-quickstart-v5';
export function generate(logo: string, profile = 'legacy'): BuildRecipe {
  if (profile === 'node24-vite8-typed-v6') return generateTypedBuildRecipe(logo, sourceRoot);
  if (profile === quickstartProfile) {
    const baseline = generate(logo, 'node24-vite8-ca-v4');
    const smoke = fs
      .readFileSync(path.join(recipeRoot, 'quickstart-v5', 'check.js'), 'utf8')
      .replace(/\r\n/g, '\n');
    const files = baseline.files.map((file) =>
      file.path.endsWith('/smoke/check.js')
        ? { ...file, content: smoke, sha256: hash(smoke) }
        : file,
    );
    const manifest = {
      version: 1,
      ciHash: baseline.ciHash,
      files: files.map(({ path, sha256 }) => ({ path, sha256 })),
    };
    return {
      ...manifest,
      profile,
      recipeHash: hash(JSON.stringify(manifest)),
      ci: baseline.ci,
      files,
    };
  }
  if (Object.hasOwn(caProfiles, profile)) {
    const baseline = generate(logo, caProfiles[profile]);
    const prefix = '.system-bootstrapper/build-v1/';
    const refresh =
      'COPY ' +
      prefix +
      'refresh-ca.sh /opt/system-bootstrapper/refresh-ca.sh\n' +
      'COPY ' +
      prefix +
      'ca /opt/system-bootstrapper/ca\nRUN sh /opt/system-bootstrapper/refresh-ca.sh\n';
    const files = baseline.files.map((file) => {
      let content = file.content;
      if (file.path.endsWith('/Dockerfile') || file.path.endsWith('/Browser.Dockerfile')) {
        content = content.replace(/^(FROM .+)$/gm, '$1\n' + refresh);
        content = content.replace(
          'ENV NODE_OPTIONS=--max-old-space-size=2048',
          'ENV NODE_OPTIONS="--use-openssl-ca --max-old-space-size=2048"',
        );
        if (!content.includes('ENV NODE_OPTIONS='))
          content = content.replace(/^(FROM .+)$/m, '$1\nENV NODE_OPTIONS=--use-openssl-ca');
        content = content.replace(
          '14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0',
          '925de64a85319052d6971ae81ef2417da956e8a3a2c4a0fac732327970f017f5',
        );
      }
      if (file.path.endsWith('/Browser.Dockerfile.dockerignore'))
        content += '\n!' + prefix + 'refresh-ca.sh\n!' + prefix + 'ca\n!' + prefix + 'ca/**\n';
      return { ...file, content, sha256: hash(content) };
    });
    for (const relative of ['refresh-ca.sh', 'ca/cacert-2026-10-20.crt']) {
      // Reserved recipes retain their original bytes, independently of current host tools.
      const source =
        relative === 'refresh-ca.sh'
          ? path.join(recipeRoot, 'historical/refresh-ca-v4.txt')
          : path.join(sourceRoot, 'config', relative);
      const content = fs.readFileSync(source, 'utf8');
      files.push({ path: prefix + relative, content, sha256: hash(content) });
    }
    const ci = baseline.ci
      .replace(
        'docker:29-cli@sha256:6fae2214c3121a28d5aa639d09032f61310b7c9c75ffbad1025f261a1b621800',
        'docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb',
      )
      .replace(
        '  tags: [docker]',
        '  tags: [docker]\n  before_script:\n    - sh ' + prefix + 'refresh-ca.sh',
      );
    const manifest = {
      version: 1,
      ciHash: hash(ci),
      files: files.map(({ path, sha256 }) => ({ path, sha256 })),
    };
    return { ...manifest, profile, recipeHash: hash(JSON.stringify(manifest)), ci, files };
  }
  if (profile === overviewProfile) {
    const baseline = generate(logo, 'node24-vite8-cleanup-v2');
    const smoke = fs
      .readFileSync(path.join(recipeRoot, 'overview-v3', 'check.js'), 'utf8')
      .replace(/\r\n/g, '\n');
    const files = baseline.files.map((file) =>
      file.path.endsWith('/smoke/check.js')
        ? { ...file, content: smoke, sha256: hash(smoke) }
        : file,
    );
    const manifest = {
      version: 1,
      ciHash: baseline.ciHash,
      files: files.map(({ path, sha256 }) => ({ path, sha256 })),
    };
    return {
      ...manifest,
      profile,
      recipeHash: hash(JSON.stringify(manifest)),
      ci: baseline.ci,
      files,
    };
  }
  if (Object.hasOwn(cleanupProfiles, profile)) {
    const baseline = generate(logo, cleanupProfiles[profile]);
    const cleanup = fs
      .readFileSync(path.join(recipeRoot, 'cleanup-v2.sh'), 'utf8')
      .replace(/\r\n/g, '\n');
    const files = baseline.files.map((file) =>
      file.path.endsWith('/cleanup.sh')
        ? { ...file, content: cleanup, sha256: hash(cleanup) }
        : file,
    );
    const manifest = {
      version: 1,
      ciHash: baseline.ciHash,
      files: files.map(({ path, sha256 }) => ({ path, sha256 })),
    };
    return {
      ...manifest,
      profile,
      recipeHash: hash(JSON.stringify(manifest)),
      ci: baseline.ci,
      files,
    };
  }
  if (profile === 'legacy') return legacy.generate(logo);
  if (profile !== 'node24-vite8') throw new Error('Unknown managed Wizard toolchain profile.');
  const baseline = legacy.generate(logo);
  const files = baseline.files.map((file) => {
    const relative = file.path.slice('.system-bootstrapper/build-v1/'.length);
    const content = fs
      .readFileSync(path.join(recipeRoot, 'modern', relative), 'utf8')
      .replace(/\r\n/g, '\n');
    return { ...file, content, sha256: hash(content) };
  });
  const ci = baseline.ci.replace(
    'Managed Wizard build v1.',
    'Managed Wizard build v1 (Node 24 / Vite 8).',
  );
  const manifest = {
    version: 1,
    ciHash: hash(ci),
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
  };
  return { ...manifest, profile, recipeHash: hash(JSON.stringify(manifest)), ci, files };
}
export function select(logo: string, recipeHash: string): BuildRecipe {
  for (const profile of [
    'legacy',
    'node24-vite8',
    ...Object.keys(cleanupProfiles),
    overviewProfile,
    ...Object.keys(caProfiles),
    quickstartProfile,
    'node24-vite8-typed-v6',
  ]) {
    const recipe = generate(logo, profile);
    if (recipe.recipeHash === recipeHash) return recipe;
  }
  throw new Error(
    'A different build recipe is reserved (Unknown reserved Wizard build recipe). Use a reviewed versioned recipe upgrade.',
  );
}
export function forSource(logo: string, sourceRevision: string): BuildRecipe {
  const snapshot = validate(
    JSON.parse(
      fs.readFileSync(path.join(sourceRoot, 'assets/wizard-source/snapshot.json'), 'utf8'),
    ),
  );
  if (snapshot.sourceRevision !== sourceRevision) return generate(logo, 'legacy-ca-v4'); // Existing hashes still select their original recipe.
  const file = snapshot.files.find((file) => file.path === 'package.json');
  if (!file) throw Error('Incomplete Wizard source.');
  const packageJson = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const runtime = snapshot.files.find((file) => file.path === '.gitlab/runtime/project-ci.cjs');
  if (runtime) {
    const recipe = generate(logo, 'node24-vite8-typed-v6');
    const pinned = recipe.files.find(
      (file) => file.path === '.system-bootstrapper/build-v2/runtime/project-ci.cjs',
    );
    if (!pinned || runtime.sha256 !== pinned.sha256)
      throw new Error('Source runtime requires a reviewed versioned build recipe.');
    return recipe;
  }
  const profile =
    packageJson.dependencies?.vite || packageJson.devDependencies?.vite
      ? quickstartProfile
      : 'legacy-ca-v4';
  return generate(logo, profile);
}

@Injectable()
export class BuildRecipeService {
  generate(logo: string, profile = 'legacy'): BuildRecipe {
    return generate(logo, profile);
  }

  select(logo: string, recipeHash: string): BuildRecipe {
    return select(logo, recipeHash);
  }

  forSource(logo: string, sourceRevision: string): BuildRecipe {
    return forSource(logo, sourceRevision);
  }
}
