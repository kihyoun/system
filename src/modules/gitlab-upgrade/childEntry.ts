import path from 'node:path';
import { worker, watchdog } from './childProcess';
export async function childMain(args = process.argv.slice(2)): Promise<void> {
  const [mode, directory] = args;

  if (mode === 'worker' && !directory) {
    return worker();
  }

  if (mode === 'watchdog' && path.isAbsolute(directory || '') && args.length === 2) {
    return watchdog(directory);
  }

  throw Error('operation-mode-invalid');
}

if (require.main === module) {
  void childMain().catch(() => {
    process.exitCode = 1;
  });
}
