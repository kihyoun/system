import { isIP } from 'net';

export interface Suggestions {
  source: 'derived';
  config: { [key: string]: string | number };
  fields: { [key: string]: string };
}

// Suggestions are deliberately separate from saved configuration and never written.
export function suggestConfig(nginx: string, connectionHost: string,
                              serverName: string, seedDir: string): Suggestions {
  const result: Suggestions = { source: 'derived', config: {}, fields: {} };
  const add = (key: string, value: string | number, source: string) => {
    result.config[key] = value;
    result.fields[key] = source;
  };
  const validHost = (host: string) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host)
    && host.length <= 253 && !/(^|\.)example\.(com|org|net)$/i.test(host)
    && !/^[a-f0-9]{12,64}$/i.test(host)
    && host !== '_' && !isIP(host);
  const roles: { [key: string]: string } = {
    gitlab: 'gitlab', registry: 'gitlabRegistry', sync: 'sync', wizard: 'wizard'
  };
  // Parse only the generated server blocks, not arbitrary NGINX configuration.
  const blocks = nginx.replace(/#.*$/gm, '').match(/server\s*\{[\s\S]*?^\}/gm) || [];
  Object.keys(roles).forEach(role => {
    const candidates = blocks.filter(block =>
      new RegExp('proxy_pass\\s+https?://' + role + '(?:[;/\\s])').test(block));
    const matches = candidates.map(block => {
      const names = (block.match(/server_name\s+([^;]+);/) || [])[1] || '';
      return { block, names: names.trim().split(/\s+/).filter(validHost) };
    }).filter(item => item.names.length === 1);
    const hosts = Array.from(new Set(matches.map(item => item.names[0])));
    if (hosts.length !== 1) { return; }
    const prefix = roles[role];
    const selectedBlock = matches.find(item => item.names[0] === hosts[0])!.block;
    const mode = /listen\s+[^;]*\bssl\b/.test(selectedBlock) ? 2 : 0;
    add(prefix + 'Host', hosts[0], 'Existing NGINX route');
    add(prefix + 'DomainMode', mode, 'Existing NGINX listener');
    if (role === 'gitlab' || role === 'registry') {
      add(role === 'gitlab' ? 'gitlabExternalUrl' : 'gitlabRegistryUrl',
        (mode === 2 ? 'https://' : 'http://') + hosts[0], 'Existing NGINX route');
    }
    const cert = (selectedBlock.match(/ssl_certificate\s+([^;\s]+);/) || [])[1];
    const key = (selectedBlock.match(/ssl_certificate_key\s+([^;\s]+);/) || [])[1];
    if (cert) { add(prefix + 'SSL', cert, 'Existing NGINX certificate path'); }
    if (key) { add(prefix + 'SSLKey', key, 'Existing NGINX key path'); }
  });
  const base = [connectionHost, serverName].filter(validHost)[0];
  if (base) {
    const suffix = base.replace(/^(sync|wizard|gitlab|registry)\./i, '');
    Object.keys(roles).forEach(role => {
      const prefix = roles[role];
      if (!result.config[prefix + 'Host']) {
        add(prefix + 'Host', role + '.' + suffix, 'Suggested from connection/server hostname; verify DNS');
        // A guessed hostname does not establish whether a certificate exists.
        add(prefix + 'DomainMode', 0, 'HTTP suggested; HTTPS must be configured explicitly');
      }
    });
  }
  if (seedDir) { add('seedDir', seedDir, 'Bootstrapper seed directory setting'); }
  add('syncEnable', 'true', 'Connected sync service');
  return result;
}
