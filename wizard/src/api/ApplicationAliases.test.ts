import Main from './Main';
import ProjectConfig from './ProjectConfig';
import { applicationAliasError } from './ApplicationAliases';
test('application alias edits reject loops, invalid exact hosts and reserved ownership before Save', () => {
  const main = new Main();
  const project = new ProjectConfig(main, {
    projectKey: 'sample',
    useProdHost: 'true',
    prodHost: 'www.example.test',
    prodDomainMode: 2,
    prodAliases: 'example.test',
  });
  expect(applicationAliasError(project)).toBe('');
  for (const alias of [
    'www.example.test',
    '*.example.test',
    'https://example.test',
    'example.test EXAMPLE.TEST',
    main.config!.gitlabHost,
  ]) {
    project.prodAliases = alias;
    expect(applicationAliasError(project)).not.toBe('');
  }
  project.prodAliases = 'example.test';
  project.prodDomainMode = 3;
  expect(applicationAliasError(project)).toContain('exact canonical host');
  project.prodDomainMode = 2;
  project.useProdHost = 'false';
  expect(applicationAliasError(project)).toBe('');
  project.useProdHost = 'true';
  main.addProject(
    new ProjectConfig(main, {
      projectKey: 'other',
      prodHost: 'other.example.test',
      prodAliases: 'example.test',
      useProdHost: 'true',
    }),
  );
  expect(applicationAliasError(project)).toContain('project host or alias');
});
