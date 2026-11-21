import * as manifest from './manifest';
export function main(args: string[]): void {
  try {
    const [command, root, ...rest] = args;
    if (command === 'create') manifest.create(root);
    else if (command === 'verify') manifest.verify(root);
    else if (command === 'publish') manifest.publish(root, rest[0]);
    else if (command === 'current') console.log(manifest.current(root));
    else if (command === 'mark-restore') manifest.markRestore(root);
    else if (command === 'finish-restore') manifest.finishRestore(root, rest[0], rest[1], rest[2]);
    else throw Error('invalid-seed-manifest-command');
  } catch {
    console.error('seed-manifest-failed');
    process.exitCode = 1;
  }
}
if (require.main === module) main(process.argv.slice(2));
