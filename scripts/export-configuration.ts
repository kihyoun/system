/** Offline test adapter for the Wizard's actual Fetch -> Backup model. */
import fs from 'node:fs';
import Main from '../src/api/Main';
import {validSeedAssociation} from '../src/api/Recovery';
import crypto from 'node:crypto';
import {previewSetupIntent} from '../src/api/PreviewSetupIntent';

export async function exportConfiguration(inputPath: string, outputPath: string): Promise<void> {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (typeof input.main?.data !== 'string' || !Array.isArray(input.projects)) {
    throw new Error('Expected authenticated main and project Fetch responses');
  }
  const main = new Main();
  main.importEnvData(input.main.data);
  main.recoveryObservation = input.main.recoveryObservation || null;
  for (const fileinfo of input.projects) {
    if (typeof fileinfo.data !== 'string') throw new Error('Invalid project Fetch response');
    main.importProjectEnvData(fileinfo.data);
    const project = Array.from(main.projects.values()).pop();
    if (!project) throw new Error('Project import failed');
    project.repository = fileinfo.repository || project.repository;
    project.namespaceId = project.repository?.namespaceId || fileinfo.namespaceId || '';
    project.bootstrapPending = fileinfo.bootstrapPending || false;
    project.template = fileinfo.template || project.repository?.template || project.template;
  }
  if (input.previewSetup !== undefined) {
    const intent = previewSetupIntent(input.previewSetup);
    if (!intent) throw new Error('Invalid portable preview intent');
    main.previewSetup = intent;
  }
  let sourceFiles;
  if (input.seedAssociation) {
    if (!validSeedAssociation(input.seedAssociation)) throw new Error('Invalid backup pair');
    const files = [{filename: '.docker.env', data: input.main.data}, ...input.projects.map((file: any) => ({
      filename: '.projects.env/' + file.filename, data: file.data}))];
    const actual = files.map(file => ({filename: file.filename,
      sha256: crypto.createHash('sha256').update(file.data).digest('hex')}));
    if (JSON.stringify(actual) !== JSON.stringify(input.seedAssociation.configurationFiles)) throw new Error('Backup pair checksum mismatch');
    main.backupSeedAssociation = input.seedAssociation;
    sourceFiles = {main: input.main.data, projects: input.projects};
  }
  const archive = await main.generateZip(sourceFiles);
  fs.writeFileSync(outputPath, Buffer.from(await archive.arrayBuffer()), {mode: 0o600, flag: 'wx', flush: true});
}

if (typeof require !== 'undefined' && require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || process.argv.length !== 4) {
    process.stderr.write('Usage: export-configuration INPUT_JSON OUTPUT_ZIP\n');
    process.exitCode = 1;
  } else {
    exportConfiguration(input, output).then(() => {
      process.stdout.write('Wizard configuration ZIP written.\n');
    }).catch(() => {
      // Configuration, credentials and raw import errors never enter CI logs.
      process.stderr.write('Wizard configuration export failed.\n');
      process.exitCode = 1;
    });
  }
}
