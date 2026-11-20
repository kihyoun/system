import MainConfig from './MainConfig';
import Main from './Main';
import Helper from './Helper';

test('an empty token requests automatic setup and survives JSON backup', () => {
  const config = new MainConfig();
  expect(config.gitlabRunnerToken).toBe('');
  config.gitlabRunnerScale = 2;
  const restored = new MainConfig(JSON.parse(JSON.stringify(config.asJson)));
  expect(restored.gitlabRunnerScale).toBe(2);
  expect(restored.gitlabRunnerToken).toBe('');
});

test('Fetch imports the generated runner token for subsequent backup and push', () => {
  const main = new Main();
  main.importEnvData(Helper.textLogo + '\nGITLAB_RUNNER_TOKEN="glrt-example"\nexport GITLAB_RUNNER_SCALE="2"\n');
  expect(main.config!.gitlabRunnerToken).toBe('glrt-example');
  expect(main.config!.asJson.gitlabRunnerToken).toBe('glrt-example');
  expect(main.config!.content).toContain('glrt-example');
});

