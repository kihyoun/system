import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

export interface ArchiveProcess {
  save(reference: string, destination: Writable, signal: AbortSignal): Promise<void>;
}
type ArchiveChild = ChildProcessByStdio<null, Readable, null>;
/** Streaming Docker export with bounded cancellation; never buffers an image in memory. */
export class DockerArchiveProcess implements ArchiveProcess {
  constructor(
    private readonly launch: (reference: string) => ArchiveChild = (reference) =>
      spawn('docker', ['--host=unix:///var/run/docker.sock', 'image', 'save', reference], {
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: false,
      }),
  ) {}

  async save(reference: string, destination: Writable, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw Error('controller-image-archive-cancelled');
    const child = this.launch(reference);
    const cancellation = new AbortController();
    let failed = false;
    const stop = () => {
      cancellation.abort();
      child.kill('SIGKILL');
    };
    const completion = new Promise<void>((resolve) => {
      child.once('error', () => {
        failed = true;
        cancellation.abort();
      });
      child.once('close', (code, killed) => {
        failed ||= code !== 0 || killed !== null;
        if (failed) cancellation.abort();
        resolve();
      });
    });
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    try {
      await pipeline(child.stdout, createGzip(), destination, { signal: cancellation.signal });
      await completion;
      if (failed || signal.aborted) throw Error('controller-image-archive-failed');
    } catch {
      stop();
      await completion;
      throw Error('controller-image-archive-failed-or-cancelled');
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }
}
