import { vi } from 'vitest';
import axios from 'axios';
import Main from './Main';
import Helper from './Helper';

vi.mock('axios');
const get = axios.get as ReturnType<typeof vi.fn>;

function connected() {
  const main = new Main();
  (axios.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { accessToken: 'test-token' } });
  main.sync.userName = 'local-test';
  return main;
}

beforeEach(() => vi.clearAllMocks());

test('a saved configuration wins and is not marked as derived', async () => {
  const main = connected();
  main.derivedFields = { gitlabHost: 'old guess' };
  get.mockResolvedValueOnce({ data: { data: Helper.textLogo + '\nexport GITLAB_HOST="gitlab.saved.test"\n' } });
  get.mockResolvedValueOnce({ data: [] });
  await main.sync.fetch();
  expect(main.config!.gitlabHost).toBe('gitlab.saved.test');
  expect(main.derivedFields).toEqual({});
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls.every(call => !call[0].endsWith('/config/suggestions'))).toBe(true);
});

test('missing config loads marked suggestions without generating credentials', async () => {
  const main = connected();
  get.mockRejectedValueOnce({ response: { status: 404 } });
  get.mockResolvedValueOnce({
    data: {
      source: 'derived',
      config: {
        gitlabHost      : 'gitlab.localhost',
        gitlabDomainMode: 0
      },
      fields: { gitlabHost: 'Connection hostname' }
    }
  });
  await main.sync.fetch();
  expect(main.config!.gitlabHost).toBe('gitlab.localhost');
  expect(main.config!.gitlabExternalUrl).toBe('http://gitlab.localhost');
  expect(main.config!.gitlabRegistryHost).toBe('');
  expect(main.config!.gitlabRunnerToken).toBe('');
  expect(main.config!.syncPass).toBe('');
  expect(main.derivedFields.gitlabHost).toBe('Connection hostname');
  expect(main.init).toBe(false);
  expect((axios.post as ReturnType<typeof vi.fn>).mock.calls.every(call => call[0].endsWith('/token'))).toBe(true);
});

test('authentication and server errors do not replace the form with guesses', async () => {
  const main = connected();
  const before = main.config!.gitlabHost;
  get.mockRejectedValueOnce({ response: { status: 401 } });
  await expect(main.sync.fetch()).rejects.toEqual({ response: { status: 401 } });
  expect(main.config!.gitlabHost).toBe(before);
  expect(get).toHaveBeenCalledTimes(1);
});

test('a failed ZIP generation rejects Push instead of leaving its progress dialog pending', async () => {
  const main = connected();
  const failure = new Error('ZIP generation failed');
  vi.spyOn(main, 'generateZip').mockRejectedValueOnce(failure);
  await expect(main.sync.push()).rejects.toBe(failure);
  expect(axios.post).not.toHaveBeenCalled();
});

test('a failed authenticated upload rejects Push with the server error', async () => {
  const main = connected();
  const failure = new Error('Upload rejected');
  const post = axios.post as ReturnType<typeof vi.fn>;
  post.mockResolvedValueOnce({ data: { accessToken: 'test-token' } }).mockRejectedValueOnce(failure);
  await expect(main.sync.push()).rejects.toBe(failure);
  expect(post.mock.calls.map(call => call[0])).toEqual([
    main.sync.serverAddress + '/token', main.sync.serverAddress + '/config/zip'
  ]);
});

test('native backup failure is returned as terminal status rather than swallowed as a project-job error', async () => {
  const main = connected();
  const status = {id: 'a'.repeat(32), state: 'failed', error: 'seed-filesystem-unavailable'};
  get.mockResolvedValueOnce({data: status});
  await expect(main.sync.diagnosticRequest('/backup/' + status.id)).resolves.toEqual(status);
  expect(get).toHaveBeenCalledTimes(1);
  expect(get.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
});
