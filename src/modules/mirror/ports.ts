import { NativeProcessRunner } from '../../common/runtime/process';
import { startTransport } from './transport';
export interface MirrorContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}
export interface MirrorPort {
  git(args: string[], context: MirrorContext): string;
  transport(args: string[], context: MirrorContext): Promise<boolean>;
  command(binary: string, args: string[], context: MirrorContext): string;
}
export const MIRROR_PORT = Symbol('MIRROR_PORT');
export class NativeMirrorPort implements MirrorPort {
  private readonly process = new NativeProcessRunner();
  command(binary: string, args: string[], context: MirrorContext): string {
    return this.process
      .run(binary, args, { cwd: context.cwd, env: context.env, timeout: 30000 })
      .stdout.trim();
  }

  git(args: string[], context: MirrorContext): string {
    return this.command('git', ['-c', 'core.hooksPath=/dev/null', ...args], context);
  }

  async transport(args: string[], context: MirrorContext): Promise<boolean> {
    if (context.signal?.aborted) throw Error('mirror cancelled');
    const child = startTransport(
      args,
      Number(context.env.GITHUB_BACKUP_TIMEOUT_SECONDS || 30),
      context.env,
      context.cwd,
    );
    context.signal?.addEventListener('abort', child.cancel, { once: true });
    try {
      const result = await child.done;
      if (context.signal?.aborted) throw Error('mirror cancelled');
      return result === 0;
    } finally {
      context.signal?.removeEventListener('abort', child.cancel);
    }
  }
}
