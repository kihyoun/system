// Native runtime policy with the existing paired fixture's external I/O ports.
require('../../node_modules/reflect-metadata');
const { NativeEntryRuntime } = require('../../dist/modules/host/nativeEntryRuntime');
const { HostModule } = require('../../dist/modules/host/host.module');
const {
  RuntimeVerificationService,
} = require('../../dist/modules/host-bootstrap/runtimeVerification.service');
const {
  ControllerUpdateSequenceService,
} = require('../../dist/modules/host/controllerUpdateSequence.service');
const {
  ControllerRollbackSequenceService,
} = require('../../dist/modules/host/controllerRollbackSequence.service');
const { RuntimeInspectionService } = require('../../dist/modules/host/runtimeInspection');
const runtime = new NativeEntryRuntime(),
  channel = runtime.channel;
async function main() {
  const call = (method, args) => channel.call(method, args);
  try {
    const request = channel.read();
    const methods = new Set(
      'journal assertBaseline verifySelection publicImages pipeline publicPair syncIdle currentServices repairBaseline critical command inspect writeConfiguration writeSelection now reload saveBaseline waitReady services saveVerification mainSha pairedBaseline stoppedIdle repairPeers recoveredReceipt restoreStopped inspectServices verification'.split(
        ' ',
      ),
    );
    const callbackPort = new Proxy(
      {},
      {
        get: (_, method) =>
          methods.has(method)
            ? (...args) => {
                if (['command', 'writeConfiguration'].includes(method) && args.length === 1)
                  args.push(null);
                return call(method, args);
              }
            : undefined,
      },
    );
    const app = await runtime.application(
      HostModule.register({
        controllerUpdateSequencePort: callbackPort,
        controllerRollbackPort: callbackPort,
        runner: {
          run(binary, args) {
            return { stdout: call('command', [binary, args]), stderr: '', status: 0 };
          },
        },
      }),
    );
    if (request.method === 'updateSequence' || request.method === 'rollbackSequence') {
      const sequence = app.get(
        request.method === 'updateSequence'
          ? ControllerUpdateSequenceService
          : ControllerRollbackSequenceService,
      );
      channel.write({ complete: true, value: { result: await sequence.run(...request.arguments) } });
      return;
    }
    const service = app.get(RuntimeVerificationService);
    service.routes = (...args) => call('routes', args.slice(0, 3));
    service.sync = (...args) => call('sync', args.slice(0, 1));
    service.runnerContacts = (...args) => call('runnerContacts', args.slice(0, 3));
    RuntimeInspectionService.prototype.mounts = function (...args) {
      return call('mounts', args);
    };
    if (!['capture', 'publicImages', 'verify', 'settings'].includes(request.method))
      throw Error('runtime-fixture-method-invalid');
    if (request.method === 'settings') {
      service.persistence.prepare = async (environment) => environment;
      request.arguments[2] = process.env;
    }
    if (request.method === 'capture') {
      request.arguments[3] ??= undefined;
      request.arguments[4] ??= undefined;
    }
    const result = await service[request.method](...request.arguments);
    channel.write({ complete: true, value: { result } });
  } catch (error) {
    channel.write({ complete: true, value: { rejected: error.message } });
  } finally {
    await runtime.settled();
  }
}
void runtime.run(main);
