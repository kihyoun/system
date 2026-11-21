import fs from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import type { ChildOptions, LifecycleProcess } from '../runtime/managed-child';

/** Keep build failures inspectable without exposing the parent's private environment. */
export async function dockerBuild(
  process: LifecycleProcess,
  args: string[],
  options: ChildOptions,
  log: string,
): Promise<void> {
  const chunks: Buffer[] = [];
  const limit = 1024 * 1024;
  let bytes = 0;
  let failure: unknown;
  try {
    await process.run('docker', args, {
      ...options,
      output: (chunk) => {
        const available = Math.max(0, limit - bytes);
        chunks.push(chunk.subarray(0, available));
        bytes += Math.min(chunk.length, available);
      },
    });
  } catch (error) {
    failure = error;
  }
  // Do not flush an incomplete final UTF-8 character after bounded capture.
  let text = new StringDecoder('utf8').write(Buffer.concat(chunks));
  const secrets = Object.entries(options.env)
    .filter(
      ([key, value]) =>
        /token|password|secret|credential|auth/i.test(key) && value && value.length >= 4,
    )
    .flatMap(([, value]) => [value!, encodeURIComponent(value!)])
    .sort((a, b) => b.length - a.length);
  for (const value of secrets) {
    text = text.split(value).join('[REDACTED]');
    // The process adapter can itself stop between chunks at its output bound.
    // Redact a credential prefix at EOF as well as complete credentials.
    for (let size = Math.min(value.length - 1, text.length); size > 0; size--) {
      if (text.endsWith(value.slice(0, size))) {
        text = text.slice(0, -size) + '[REDACTED]';
        break;
      }
    }
  }
  text = text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  text = text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]*$/gi, '$1[REDACTED]');
  text = new StringDecoder('utf8').write(Buffer.from(text).subarray(0, limit));
  try {
    fs.writeFileSync(log, text, { mode: 0o600 });
    if (failure) console.error('Container image build failed; build.log:\n' + text.slice(-16384));
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}
