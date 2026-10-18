const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const legacy = require('./legacy');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function generate(logo, profile = 'legacy') {
  if (profile === 'legacy') return legacy.generate(logo);
  if (profile !== 'node24-vite8') throw new Error('Unknown managed Wizard toolchain profile.');
  const baseline = legacy.generate(logo);
  const files = baseline.files.map(file => {
    const relative = file.path.slice('.system-bootstrapper/build-v1/'.length);
    const content = fs.readFileSync(path.join(__dirname, 'modern', relative), 'utf8').replace(/\r\n/g, '\n');
    return {...file, content, sha256: hash(content)};
  });
  const ci = baseline.ci.replace('Managed Wizard build v1.', 'Managed Wizard build v1 (Node 24 / Vite 8).');
  const manifest = {version: 1, ciHash: hash(ci), files: files.map(({path, sha256}) => ({path, sha256}))};
  return {...manifest, profile, recipeHash: hash(JSON.stringify(manifest)), ci, files};
}
function select(logo, recipeHash) {
  for (const profile of ['legacy', 'node24-vite8']) {
    const recipe = generate(logo, profile);
    if (recipe.recipeHash === recipeHash) return recipe;
  }
  throw new Error('A different build recipe is reserved (Unknown reserved Wizard build recipe). Use a reviewed versioned recipe upgrade.');
}
function forSource(logo, sourceRevision) {
  const snapshot = require('../wizard-source/package').validate(JSON.parse(
    fs.readFileSync(path.join(__dirname, '../wizard-source/snapshot.json'), 'utf8')));
  if (snapshot.sourceRevision !== sourceRevision) return generate(logo); // Historical imports retain their reviewed legacy profile.
  const file = snapshot.files.find(file => file.path === 'package.json');
  const packageJson = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  const profile = packageJson.dependencies?.vite || packageJson.devDependencies?.vite ? 'node24-vite8' : 'legacy';
  return generate(logo, profile);
}
module.exports = {generate, select, forSource};
