import http from 'node:http';
import { readRecord } from './types';
/** Bounded local authenticated transport; credentials never enter command arguments. */
export async function syncStatus(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<{ idle: boolean }> {
  const request = (
    route: string,
    method: string,
    body?: string,
    token?: string,
  ): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port: 8071,
          path: route,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
          },
          signal: AbortSignal.timeout(5000),
        },
        (res) => {
          let raw = '';
          res.on('data', (part) => {
            raw += part;

            if (raw.length > 16384) {
              req.destroy();
            }
          });
          res.on('error', () => reject(Error('upgrade-sync-unavailable')));
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                throw Error();
              }

              resolve(readRecord(JSON.parse(raw) as unknown));
            } catch {
              reject(Error('upgrade-sync-unavailable'));
            }
          });
        },
      );
      req.on('error', () => reject(Error('upgrade-sync-unavailable')));
      req.end(body);
    });
  const auth = await request(
    '/login',
    'POST',
    JSON.stringify({ username: environment.SYNC_USER, password: environment.SYNC_PASS }),
  );

  if (typeof auth.accessToken !== 'string') {
    throw Error('upgrade-sync-unavailable');
  }

  const status = await request('/status', 'GET', undefined, auth.accessToken);
  return {
    idle:
      status.projectOperationInProgress === false &&
      status.runnerSetupInProgress === false &&
      status.harvestInProgress === false &&
      status.defaultWizardSetupInProgress === false &&
      status.needRestart === false,
  };
}
