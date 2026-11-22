import fs from 'node:fs';
import path from 'node:path';
import { check } from './documentationPolicy';
export function documentationCheckMain(environment = process.env, directory = process.cwd()): void {
  const output = path.join(directory, 'test-results/documentation');
  fs.mkdirSync(output, { recursive: true });
  try {
    if (fs.existsSync('/var/run/docker.sock')) {
      throw Error('Use a socket-free documentation runner.');
    }

    const result = check(environment, directory);
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ status: 'passed', ...result }, null, 2) + '\n',
    );
    console.log(
      'Documentation check passed: committed diff and ' +
        result.markdownFiles.length +
        ' Markdown files.',
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'documentation-check-failed';
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ status: 'failed', reason }, null, 2) + '\n',
    );
    console.error(reason);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  documentationCheckMain();
}
