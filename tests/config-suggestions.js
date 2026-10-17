// Run after compiling sync with: node tests/config-suggestions.js
const assert = require('assert');
const { suggestConfig } = require(process.env.SUGGESTIONS_MODULE || '../sync/dist/ConfigSuggestions');
const route = (role, host, ssl = false) => `server {
  listen ${ssl ? '443 ssl' : '80'};
  server_name ${host};
  ${ssl ? 'ssl_certificate /ssl/test/fullchain.pem;\n  ssl_certificate_key /ssl/test/privkey.pem;' : ''}
  location / { proxy_pass http://${role}; }
}
`;
const actual = suggestConfig(route('gitlab', 'gitlab.actual.test', true) +
  route('registry', 'registry.actual.test'), 'sync.other.test', 'container', '/mnt/seed');
assert.equal(actual.config.gitlabHost, 'gitlab.actual.test');
assert.equal(actual.config.gitlabDomainMode, 2);
assert.equal(actual.config.gitlabExternalUrl, 'https://gitlab.actual.test');
assert.equal(actual.config.gitlabRegistryHost, 'registry.actual.test');
assert.equal(actual.config.gitlabRegistryDomainMode, 0);
assert.equal(actual.config.gitlabSSL, '/ssl/test/fullchain.pem');
assert.equal(actual.config.seedDir, '/mnt/seed');
assert.equal(actual.fields.gitlabHost, 'Existing NGINX route');
const local = suggestConfig('', 'localhost', 'a241c71a95c9', '');
assert.equal(local.config.gitlabHost, 'gitlab.localhost');
assert.equal(local.config.gitlabRegistryHost, 'registry.localhost');
assert.match(local.fields.gitlabHost, /verify DNS/);
const noGuess = suggestConfig('', '127.0.0.1', 'a241c71a95c9', '');
assert.equal(noGuess.config.gitlabHost, undefined);
assert.equal(noGuess.config.gitlabRegistryHost, undefined);
const template = suggestConfig(route('gitlab', 'gitlab.example.com'), 'sync.real.test', '', '');
assert.equal(template.config.gitlabHost, 'gitlab.real.test');
assert.equal(template.config.gitlabDomainMode, 0);
assert.equal(suggestConfig('', 'sync.example.com', '', '').config.gitlabHost, undefined);
const ignored = suggestConfig('# ' + route('gitlab', 'bad.test').replace(/\n/g, '\n# '), '', '', '');
assert.equal(ignored.config.gitlabHost, undefined);
assert.equal(actual.config.syncPass, undefined);
assert.equal(actual.config.gitlabRunnerToken, undefined);
console.log('PASS: NGINX precedence, HTTP/HTTPS, certificate paths, local suggestions, unknown hosts and placeholder rejection');
