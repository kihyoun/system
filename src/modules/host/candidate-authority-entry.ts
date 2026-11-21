import 'reflect-metadata';
import { lifecyclePolicy } from '../release/lifecycle-policy';
import { NativeEntryRuntime } from './native-entry-runtime';
import { HostModule } from './host.module';
import { CandidateAuthorityService, type CandidateGitLabApi } from './candidate-authority.service';
import { record } from '../release/source-identity';
import { requireValue } from './install';
const runtime = new NativeEntryRuntime();
export async function candidateAuthorityMain(): Promise<void> {
  const channel = runtime.channel;
  let callbackFailed = false;
  const call = (method: string, args: unknown[]) => {
    try {
      return channel.call(method, args);
    } catch (error) {
      callbackFailed = true;
      throw error;
    }
  };
  try {
    const request = record(channel.read()),
      args = request.arguments;
    requireValue(Array.isArray(args), 'candidate-authority-arguments-required');
    const api: CandidateGitLabApi = {
      get: async (endpoint) => call('get', [endpoint]),
      pages: async (endpoint) => {
        const rows = call('pages', [endpoint]);
        requireValue(Array.isArray(rows), 'GitLab-API-array-required');
        return rows;
      },
      raw: async (endpoint) => Buffer.from(String(call('raw', [endpoint])), 'base64'),
    };
    const app = await runtime.application(
        HostModule.register({
          lifecycleEvidence: lifecyclePolicy(),
        }),
      ),
      service = app.get(CandidateAuthorityService);
    let value: unknown;
    switch (request.operation) {
      case 'pipeline':
        value = await service.pipeline(
          api,
          record(args[0]),
          Buffer.from(String(args[1]), 'base64'),
          Buffer.from(String(args[2]), 'base64'),
          args[3] !== false,
        );
        break;
      case 'pair':
        value = await service.publicPair(
          api,
          record(args[0]),
          record(args[1]),
          String(args[2]),
          String(args[3]),
        );
        break;
      case 'completed':
        value = await service.completed(api, record(args[0]), args[1]);
        break;
      case 'wizard':
        value = service.wizard(record(args[0]), record(args[1]));
        break;
      default:
        throw Error('candidate-authority-operation-invalid');
    }
    channel.write({ complete: true, value: { result: value ?? null } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'candidate-authority-failed';
    // Rejected read-only authority inputs do not invalidate an idle provider context.
    // Transport failures still evict the peer and preserve the callback's exception.
    channel.write(
      callbackFailed
        ? { complete: true, error: message }
        : { complete: true, value: { rejected: message } },
    );
    if (callbackFailed) process.exitCode = 1;
  } finally {
    await runtime.settled();
  }
}
if (require.main === module) void runtime.run(candidateAuthorityMain);
