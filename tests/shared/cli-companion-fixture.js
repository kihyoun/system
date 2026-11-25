'use strict';
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const { execFileSync } = require('node:child_process');
const hash = (value) => require('node:crypto').createHash('sha256').update(value).digest('hex');
function companionPair() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wizard-v7-companions-'));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  write('source.txt', 'same committed source');
  git('add', 'source.txt');
  git('commit', '-m', 'Shared companion source');
  const sourceRevision = git('rev-parse', 'HEAD'),
    sourceTree = git('rev-parse', 'HEAD^{tree}');
  write(
    'package/package.json',
    JSON.stringify({
      name: '@systembootstrapper/cli',
      version: '2.0.0',
      bin: { 'system-bootstrapper': 'dist/cli/main.js' },
      files: ['dist', 'assets'],
    }),
  );
  write('package/dist/cli/main.js', '#!/usr/bin/env node\n');
  const artifacts = [1, 2].map((pipelineId) => {
    write(
      'package/assets/source.json',
      JSON.stringify({
        format: 'system-cli-source-v1',
        version: '2.0.0',
        sourceRevision,
        sourceTree,
        pipelineId,
        packageJobId: 10 + pipelineId,
      }),
    );
    const output = path.join(root, 'pipeline-' + pipelineId);
    fs.mkdirSync(output);
    const [packed] = JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', output],
        { cwd: path.join(root, 'package'), encoding: 'utf8' },
      ),
    );
    const filename = path.join(output, packed.filename),
      receipt = {
        format: 'system-cli-companion-v1',
        version: '2.0.0',
        sourceRevision,
        sourceTree,
        sha256: hash(fs.readFileSync(filename)),
      };
    fs.writeFileSync(filename + '.json', JSON.stringify(receipt));
    return {
      artifact: require('../../dist/modules/project-ci/cliArtifact').readCliArtifact(filename),
      filename,
    };
  });
  return { root, artifacts };
}
module.exports = { companionPair };
