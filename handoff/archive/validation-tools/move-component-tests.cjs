const fs = require('fs');
const path = require('path');
const root = 'C:/Users/kihyo/Documents/Codex/2026-10-16/kja/work/component-test-ci';
const moves = {
 'application-templates.js':'gitlab/application-templates.js',
 'application-templates-live.js':'gitlab/live/application-templates.js',
 'application-templates-live-audit.rb':'gitlab/live/application-templates-audit.rb',
 'project-bootstrap.js':'gitlab/project-bootstrap.js',
 'project-bootstrap-live.js':'gitlab/live/project-bootstrap.js',
 'project-bootstrap-audit.rb':'gitlab/live/project-bootstrap-audit.rb',
 'gitlab-root-password.js':'gitlab/root-password.js',
 'gitlab-startup.sh':'gitlab/startup.sh',
 'config-suggestions.js':'sync/config-suggestions.js',
 'config-suggestions-api.js':'sync/config-suggestions-api.js',
 'runner-provision.js':'gitlab-runner/provision.js',
 'runner-endpoint.js':'gitlab-runner/endpoint.js',
 'runner-live.py':'gitlab-runner/live/runner.py',
 'runner-startup.sh':'bootstrapper/runner-startup.sh',
 'default-wizard.js':'wizard/default-wizard.js',
 'default-wizard-live.js':'wizard/live/default-wizard.js',
 'default-wizard-routing.sh':'nginx/default-wizard-routing.sh',
 'registry-smoke.gitlab-ci.yml':'registry/registry-smoke.gitlab-ci.yml',
 'seed-cycle.py':'seed/seed-cycle.py',
};
for (const [oldName, newName] of Object.entries(moves)) {
 const source = path.join(root, 'tests', oldName), destination = path.join(root, 'tests', newName);
 fs.mkdirSync(path.dirname(destination), {recursive:true});
 let text = fs.readFileSync(source, 'utf8');
 if (newName.endsWith('.js')) {
  const up = '../'.repeat(newName.split('/').length);
  text = text.replace(/(['"])\.\.\/(sync|gitlab-runner|system|gitlab)\//g, (_, quote, service) => quote + up + service + '/');
  if (oldName === 'default-wizard.js') text = text.replace("path.resolve(__dirname, '..')", "path.resolve(__dirname, '../..')");
 }
 if (newName.endsWith('.sh')) text = text.replaceAll('$(dirname "$0")/..', '$(dirname "$0")/../..');
 if (oldName === 'seed-cycle.py') text = text.replace('parents[1]', 'parents[2]');
 text = text.replace('node tests/config-suggestions.js', 'node tests/sync/config-suggestions.js');
 fs.writeFileSync(destination, text);
 fs.unlinkSync(source);
}
for (const name of ['docs/PROJECT_BOOTSTRAP_GUIDE.md','docs/HANDBOOK.md','Prepare-Host.md']) {
 const file=path.join(root,name); let text=fs.readFileSync(file,'utf8');
 for (const [oldName,newName] of Object.entries(moves)) text=text.replaceAll('tests/'+oldName,'tests/'+newName);
 fs.writeFileSync(file,text);
}
console.log('Moved '+Object.keys(moves).length+' component tests and updated documentation links.');
