const contexts = ['prod', 'beta', 'review'];
const hostname = (host: string) => host.length > 0 && host.length <= 253 && !/^[0-9.]+$/.test(host) &&
  host.split('.').every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
export function applicationAliasError(project: any): string {
  const owned = new Set<string>();
  for (const context of contexts) {
    const aliases = String(project[context + 'Aliases'] || '').trim().split(/\s+/).filter(Boolean).map(host => host.toLowerCase());
    if (!aliases.length) continue;
    if (aliases.length > 100 || aliases.some(alias => !hostname(alias)) || new Set(aliases).size !== aliases.length)
      return 'Configure at most 100 distinct exact DNS aliases without schemes, ports or wildcards.';
    if (project['use' + context[0].toUpperCase() + context.slice(1) + 'Host'] !== 'true') continue;
    if (![0, 2].includes(project[context + 'DomainMode']) || !hostname(project[context + 'Host']))
      return 'Application aliases require an exact canonical host in domain mode 0 or 2.';
    const main = project.main;
    for (const alias of aliases) {
      if (owned.has(alias)) return 'Each application alias must belong to one enabled environment.';
      owned.add(alias);
      const conflicts = (host: string, mode: number) => host && (mode === 1 || mode === 3 || host.startsWith('*.')
        ? alias.endsWith('.' + host.replace(/^\*\./, '').toLowerCase()) : alias === host.toLowerCase());
      if (['wizard', 'gitlab', 'gitlabRegistry', 'sync'].some(prefix => conflicts(main.config[prefix + 'Host'], main.config[prefix + 'DomainMode'])) ||
          String(main.config.wizardAliases || '').toLowerCase().split(/\s+/).includes(alias))
        return 'An application alias conflicts with a platform host or Wizard alias.';
      for (const other of [project, ...Array.from(main.projects.values()).filter((item: any) => item.projectKey !== project.projectKey)])
        for (const environment of contexts) {
          if (other['use' + environment[0].toUpperCase() + environment.slice(1) + 'Host'] === 'true' &&
              (conflicts(other[environment + 'Host'], other[environment + 'DomainMode']) ||
              (other !== project && String(other[environment + 'Aliases'] || '').toLowerCase().split(/\s+/).includes(alias))))
            return 'An application alias conflicts with an enabled project host or alias.';
        }
    }
  }
  return '';
}
