import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');
/** Deterministic helper implementation identity, independent of host paths. */
export function helperInventory(root = path.resolve(__dirname, '../../..')): string {
  const files: { path: string; sha256: string }[] = [];
  const walk = (directory: string, prefix: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (prefix.startsWith('runtime/') && entry.name === 'node_modules') {
        continue;
      }

      const filename = path.join(directory, entry.name),
        name = prefix + '/' + entry.name;

      if (entry.isDirectory()) {
        walk(filename, name);
      } else if (entry.isFile()) {
        files.push({ path: name, sha256: hash(fs.readFileSync(filename)) });
      } else {
        throw Error('Helper dependency links are unsupported.');
      }
    }
  };
  walk(path.join(root, 'templates/project-bootstrap'), 'templates/project-bootstrap');
  walk(path.join(root, 'dist'), 'dist');
  for (const relative of [
    'assets/wizard-source/snapshot.json',
    'tools/gitlab/bootstrap-token.rb',
    'config/ca/cacert-2026-10-20.crt',
    'config/ca/provenance.json',
  ]) {
    const filename = path.join(root, relative);

    if (!fs.lstatSync(filename).isFile()) {
      throw Error('Helper dependency links are unsupported.');
    }

    files.push({
      path: relative,
      sha256: hash(fs.readFileSync(filename)),
    });
  }
  const seen = new Set<string>();
  const collect = (manifest: string) => {
    const metadata: { name?: string; dependencies?: Record<string, string> } = JSON.parse(
      fs.readFileSync(manifest, 'utf8'),
    );
    const requireFrom = createRequire(manifest);
    for (const dependency of Object.keys(metadata.dependencies || {}).sort()) {
      let entry: string;
      try {
        entry = requireFrom.resolve(dependency + '/package.json');
      } catch (_) {
        entry = requireFrom.resolve(dependency);
      }
      let directory = path.dirname(entry);
      while (!fs.existsSync(path.join(directory, 'package.json'))) {
        const parent = path.dirname(directory);

        if (parent === directory) {
          throw Error('Helper runtime dependency manifest is unavailable.');
        }

        directory = parent;
      }
      // Some entrypoints sit beneath a nested package.json. Find the package root.
      while (
        JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).name !==
        dependency
      ) {
        const parent = path.dirname(directory);

        if (parent === directory) {
          throw Error('Helper runtime dependency identity changed.');
        }

        directory = parent;
        while (!fs.existsSync(path.join(directory, 'package.json'))) {
          const next = path.dirname(directory);

          if (next === directory) {
            throw Error('Helper runtime dependency identity changed.');
          }

          directory = next;
        }
      }
      const key =
        dependency +
        '@' +
        JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
      const identity = fs.realpathSync(directory);

      if (seen.has(identity)) {
        continue;
      }

      seen.add(identity);
      walk(directory, 'runtime/' + key);
      collect(path.join(directory, 'package.json'));
    }
  };
  collect(path.join(root, 'package.json'));
  files.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return hash(JSON.stringify(files));
}
export function verifyHelperTree(expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected) || helperInventory() !== expected) {
    throw Error('Helper implementation identity changed.');
  }

  return 'verified';
}
