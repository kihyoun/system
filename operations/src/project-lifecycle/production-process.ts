import { ManagedChildProcess } from '../runtime/managed-child';
const processRunner = new ManagedChildProcess();
/** Production and ordinary lifecycle commands share bounded, secret-free process handling. */
export async function productionDocker(
  args: string[],
  input = '',
  timeout = 180000,
): Promise<string> {
  return (
    await processRunner.run('docker', args, {
      cwd: process.cwd(),
      env: process.env,
      input,
      timeout,
      maxBuffer: 2000000,
    })
  ).trim();
}
