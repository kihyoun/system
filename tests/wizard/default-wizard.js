const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const source = path.resolve(__dirname, '../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'default-wizard-'));
for (const name of ['sync', 'system', 'project-bootstrap']) fs.mkdirSync(path.join(root, name));
// Isolate the native operation entry beside the compiled Sync modules, just as
// the project-provisioning fixture does. No GitLab or Docker process is needed.
fs.cpSync(path.join(source, 'sync/dist'), path.join(root, 'sync/dist'), {recursive:true});
fs.symlinkSync(path.join(source, 'sync/node_modules'), path.join(root, 'sync/node_modules'), 'dir');
fs.symlinkSync(path.join(source, 'nginx'), path.join(root, 'nginx'), 'dir');
fs.mkdirSync(path.join(root,'operations/dist/projects-routing'),{recursive:true});
fs.mkdirSync(path.join(root,'operations/dist/gitlab-provision'),{recursive:true});
fs.writeFileSync(path.join(root, 'operations/dist/projects-routing/entry.js'), 'process.exit(0)\n');
const trace = path.join(root, 'trace');
fs.writeFileSync(path.join(root, 'operations/dist/gitlab-provision/entry.js'), `
const assert=require('node:assert/strict');
assert.deepEqual(process.argv.slice(2),['project','--checkout',${JSON.stringify(root)}]);
let text=''; process.stdin.on('data', c=>text+=c); process.stdin.on('end',()=>{
 const input=JSON.parse(text);
 assert(['namespaces','create'].includes(input.action),'registration must not start a pipeline');
 if(input.action==='create'){
  assert.equal(input.projectKey,'wizard');assert.equal(input.template,'wizard');
  assert.equal(input.namespaceId,1);assert.equal(input.files,undefined);
  assert(input.ci.includes('when: never'));assert(/^[a-f0-9]{48}$/.test(input.operation));
 }
 require('fs').appendFileSync(${JSON.stringify(trace)}, input.action+'\\n');
 console.log(JSON.stringify(input.action==='namespaces'?{namespaces:[{id:1,path:'root'}]}:
 {repository:{id:99,namespaceId:1,path:'root/wizard',defaultBranch:'main',template:'wizard'}}));
});\n`);
process.chdir(path.join(root, 'sync'));
const bootstrap = require(path.join(root, 'sync/dist/ProjectBootstrap'));
const {ensureDefaultWizard, wizardConfiguration} = require(path.join(root, 'sync/dist/DefaultWizard'));
const {preserve} = require(path.join(source, 'project-bootstrap/preserve-system-project'));
const config = path.join(root, 'system/.docker.env');
const project = path.join(root, 'system/.projects.env/.wizard.env');
const signature = data => {
 assert.equal(data.substr(807,1),'$');
 assert.equal(crypto.createHash('md5').update(data.substr(0,1184)).digest('hex'),'bd4a8426355824593a5e21ad759830c1');
};
(async()=>{
 assert.equal((await ensureDefaultWizard()).state,'not-configured');
 fs.writeFileSync(config,'export WIZARD_ENABLE=false\n');
 assert.equal((await ensureDefaultWizard()).state,'disabled');
 assert(!fs.existsSync(project));
 fs.writeFileSync(config,'export WIZARD_ENABLE=true\nexport WIZARD_HOST="localhost"\nexport WIZARD_DOMAIN_MODE=0\n');
 const first=await ensureDefaultWizard();
 assert.equal(first.state,'registered');
 assert(first.repository.systemProject);
 assert.equal(first.repository.deploymentState,'existing-interface');
 let data=fs.readFileSync(project,'utf8'); signature(data);
 assert(data.includes('PROD_HOST="localhost"'));
 assert(data.includes('USE_BETA_HOST="false"'));
 assert(data.includes('USE_REVIEW_HOST="false"'));
 const receipt=bootstrap.readReceipt(data);
 assert(receipt.defaultProject && receipt.state==='complete');
 assert(first.repository.generatedCi.includes('when: never'));
 assert.equal(fs.readFileSync(trace,'utf8'),'namespaces\ncreate\n','registration does not start a pipeline');
 assert.equal((await ensureDefaultWizard()).repository.id,99);
 assert.equal(fs.readFileSync(trace,'utf8'),'namespaces\ncreate\n','startup is idempotent');
 fs.writeFileSync(config,'export WIZARD_ENABLE=true\nexport WIZARD_HOST="ui.example.com"\nexport WIZARD_DOMAIN_MODE=2\nexport WIZARD_SSL="/ssl/current.pem"\nexport WIZARD_SSL_KEY="/ssl/current.key"\n');
 await ensureDefaultWizard(); data=fs.readFileSync(project,'utf8'); signature(data);
 assert(data.includes('PROD_HOST="ui.example.com"'));
 assert(data.includes('PROD_DOMAIN_MODE="2"'));
 assert(data.includes('PROD_SSL="/ssl/current.pem"'));
 assert.equal(bootstrap.readReceipt(data).operation,receipt.operation);
 assert.equal(fs.readFileSync(trace,'utf8'),'namespaces\ncreate\n');
 const backup=path.join(root,'backup');
 preserve('snapshot',project,backup); fs.unlinkSync(project); preserve('restore',project,backup);
 assert.equal(fs.readFileSync(project,'utf8'),data,'Push retains the server-owned project');
 assert(!fs.existsSync(backup));
 assert.throws(()=>bootstrap.createProject({projectKey:'wizard',template:'wizard'}),/managed automatically/);
 const other=wizardConfiguration({WIZARD_HOST:'foreign.localhost'});
 fs.writeFileSync(project,other);
 await assert.rejects(ensureDefaultWizard(),/already configured/);
 assert.equal(fs.readFileSync(project,'utf8'),other,'foreign local configuration is preserved');
 preserve('snapshot',project,backup); assert(!fs.existsSync(backup));
 assert.throws(()=>wizardConfiguration({}),/real Wizard host/);
 console.log('Default Wizard: real URL/HTTPS, first scaffold, no pipeline, idempotent restart, Push preservation, collisions and signature passed.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{process.chdir(source);fs.rmdirSync(root,{recursive:true});});
