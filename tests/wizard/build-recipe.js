const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
const logo = require(path.join(root, 'sync/dist/Helper')).default.textLogo;
const recipe = require(path.join(root, 'project-bootstrap/wizard-build/recipe')).generate(logo);
assert.equal(recipe.version, 1);
assert.equal(recipe.ci[807], '$');
assert.equal(crypto.createHash('md5').update(recipe.ci.slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
assert(!/deploy:|stage: deploy|when: manual|DOCKERHUB|PRIVATE_KEY/.test(recipe.ci));
assert(recipe.ci.includes('CI_OPEN_MERGE_REQUESTS') && recipe.ci.includes('merge_request_event'));
assert(recipe.ci.includes('dotenv: image.env') && recipe.ci.includes('artifacts: true'));
const defaultSection = recipe.ci.split('\ndefault:\n')[1].split('\nworkflow:')[0];
assert(!/^  timeout:/m.test(defaultSection), 'GitLab default must not contain the job-only timeout keyword');
for (const jobName of ['build:wizard', 'test:wizard']) {
  const job = recipe.ci.split('\n' + jobName + ':\n')[1].split(/\n[^ \n]/)[0];
  assert(/^  timeout: 30 minutes$/m.test(job), jobName + ' must declare its own bounded timeout');
}
for (const file of recipe.files) {
  assert.equal(crypto.createHash('sha256').update(file.content).digest('hex'), file.sha256);
  assert(file.path.startsWith('.system-bootstrapper/build-v1/'));
  assert(!file.path.endsWith('/.gitlab-ci.yml'));
}
const content = name => recipe.files.find(file => file.path.endsWith('/' + name)).content;
assert(content('Dockerfile').includes('node:13.12.0-alpine@sha256:'));
assert(content('Dockerfile').includes('RUN npm ci') && content('Dockerfile').includes('CI=true npm test'));
assert(content('Dockerfile').includes('RUN CI= npm run build'));
assert(!content('Dockerfile').includes('npm install'));
assert(content('Dockerfile.dockerignore').includes('**/.git'));
assert(content('Dockerfile.dockerignore').includes('**/.env'));
assert(content('cleanup.sh').includes('docker buildx rm -f'));
assert(content('verify.sh').includes('--internal'));
const lock = JSON.parse(content('smoke/package-lock.json'));
assert.equal(lock.packages['node_modules/playwright'].version, '1.63.0');
assert.equal(lock.packages['node_modules/playwright-core'].version, '1.63.0');
assert.equal(JSON.parse(content('smoke/package.json')).dependencies.playwright, '1.63.0');
const again = require(path.join(root, 'project-bootstrap/wizard-build/recipe')).generate(logo);
assert.equal(recipe.recipeHash, again.recipeHash);
console.log('Wizard recipe: immutable signature, deterministic manifest, legacy lockfile checks, browser gate, contextual excludes and no deployment passed.');
const recipes = require(path.join(root, 'project-bootstrap/wizard-build/recipe'));
const modern = recipes.generate(logo, 'node24-vite8');
const modernContent = name => modern.files.find(file => file.path.endsWith('/' + name)).content;
assert.equal(modern.profile, 'node24-vite8');
assert.notEqual(modern.recipeHash, recipe.recipeHash);
assert.deepEqual(recipes.select(logo, recipe.recipeHash), recipe, 'Legacy reservations must keep identical file/CI hashes');
assert.deepEqual(recipes.select(logo, modern.recipeHash), modern);
assert.throws(() => recipes.select(logo, '0'.repeat(64)), /Unknown reserved/);
assert.equal(modern.ci[807], '$');
assert.equal(crypto.createHash('md5').update(modern.ci.slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
assert(modernContent('Dockerfile').includes('node:24.22.0-bookworm@sha256:'));
assert(modernContent('Dockerfile').includes('npm run lint && npm test && npm run build'));
assert(!modernContent('Dockerfile').includes('13.12.0'));
assert(!modernContent('Dockerfile').includes('COPY package.json package-lock.json .npmrc'), 'Source snapshots deliberately exclude npm credential files');
assert(modernContent('build.sh').includes('"testRunner":"vitest"'));
assert(!modernContent('build.sh').includes('"jest":true'), 'Vitest evidence must not claim Jest ran');
assert.equal(JSON.parse(modernContent('smoke/package.json')).dependencies.playwright, '1.64.1');
assert.equal(JSON.parse(modernContent('smoke/package-lock.json')).packages['node_modules/playwright'].version, '1.64.1');
for (const file of modern.files) assert.equal(crypto.createHash('sha256').update(file.content).digest('hex'), file.sha256);
const sourceSnapshot = JSON.parse(fs.readFileSync(path.join(root, 'project-bootstrap/wizard-source/snapshot.json'), 'utf8'));
const packageJson = JSON.parse(Buffer.from(sourceSnapshot.files.find(file => file.path === 'package.json').content, 'base64'));
assert.equal(recipes.forSource(logo, sourceSnapshot.sourceRevision).recipeHash,
  recipes.generate(logo, packageJson.dependencies?.vite || packageJson.devDependencies?.vite ? 'node24-vite8-quickstart-v5' : 'legacy-ca-v4').recipeHash);
assert.equal(recipes.forSource(logo, 'f'.repeat(40)).recipeHash, recipes.generate(logo, 'legacy-ca-v4').recipeHash, 'New historical-source reservations retain the legacy toolchain with corrected cleanup');
console.log('Modern Wizard profile: Node 24, exact browser lock, honest Vitest evidence, strict reservation and backward-compatible legacy hashes passed.');
const historical = {
  legacy: 'd6f99917add408077ad732621f717bb545566e75c98c896624bd606c00a0c406',
  'node24-vite8': 'd0d8fcd0e325cdf806f2f5fec6aec59481f13dea78c475f7f69c8764db947360',
  'legacy-cleanup-v2': 'f25ac5294694ff96eb2baf150d064162f66b11967caa69c984a472abd21dd991',
  'node24-vite8-cleanup-v2': '2032f68f7c84f100ac97fe783a857108d03a668f8c09427241f9cad8b55f543a',
  'node24-vite8-overview-v3': 'c75d423482e48666a48878a8417b363f94f0d6cd28bea98e94d048e53e0f8d1e',
  'legacy-ca-v4': '9c4e13d774c0bb9c93b65e01240cc8e62d6cccb9a47152c466bbab4648e9fa7b',
  'node24-vite8-ca-v4': '6f4fd137e234f932c0c35ee7c7cdc8e81b9493ec4df8d50bb0cd138db39fe1f8'
};
for (const [profile, hash] of Object.entries(historical)) assert.equal(recipes.generate(logo, profile).recipeHash, hash);
const overview = recipes.generate(logo, 'node24-vite8-overview-v3');
const previous = recipes.generate(logo, 'node24-vite8-cleanup-v2');
assert.deepEqual(recipes.select(logo, overview.recipeHash), overview);
assert.notEqual(overview.recipeHash, previous.recipeHash);
assert.equal(overview.ci, previous.ci);
for (const file of previous.files.filter(file => !file.path.endsWith('/smoke/check.js'))) {
  assert.deepEqual(overview.files.find(other => other.path === file.path), file, 'Overview profile changes only browser navigation');
}
for (const file of overview.files) assert.equal(crypto.createHash('sha256').update(file.content).digest('hex'), file.sha256);
const navigation = overview.files.find(file => file.path.endsWith('/smoke/check.js')).content;
assert(navigation.includes("name: 'Main navigation'") && navigation.includes("name: 'Getting Started'") && navigation.includes("name: 'Wizard'"));
assert(navigation.includes("name: 'Connect'") && navigation.includes("name: 'Projects'") && navigation.includes("name: 'Backup'"));
assert(navigation.includes("name: 'Overview'") && navigation.includes('cubeSignature: true'));
console.log('Overview browser profile: versioned navigation checks, unchanged required evidence and four exact historical recipe hashes passed.');
const quickstart = recipes.generate(logo, 'node24-vite8-quickstart-v5');
const ca = recipes.generate(logo, 'node24-vite8-ca-v4');
assert.deepEqual(recipes.select(logo, quickstart.recipeHash), quickstart);
assert.notEqual(quickstart.recipeHash, ca.recipeHash);
assert.equal(quickstart.ci, ca.ci, 'Quick Install checks retain every CI gate');
for (const file of ca.files.filter(file => !file.path.endsWith('/smoke/check.js'))) {
  assert.deepEqual(quickstart.files.find(other => other.path === file.path), file, 'Quick Install profile changes only its browser script');
}
for (const file of quickstart.files) assert.equal(crypto.createHash('sha256').update(file.content).digest('hex'), file.sha256);
const quickstartSmoke = quickstart.files.find(file => file.path.endsWith('/smoke/check.js')).content;
assert.equal(quickstartSmoke, fs.readFileSync(path.join(root, 'project-bootstrap/wizard-build/quickstart-v5/check.js'), 'utf8'));
assert(quickstartSmoke.includes("name: 'How it works'") && quickstartSmoke.includes("name: 'Quick Install'"));
assert(quickstartSmoke.includes("name: 'Docs'") && quickstartSmoke.includes('cubeSignature: true'));
console.log('Quick Install browser profile: source-selected version, unchanged CI/toolchain/CA files and seven exact historical recipe hashes passed.');
