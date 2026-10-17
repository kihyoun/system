const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const snapshot = require('/source/project-bootstrap/wizard-source/package').validate(JSON.parse(fs.readFileSync('/snapshot.json', 'utf8')));
assert.equal(snapshot.sourceRevision, 'e796f7e45bcc7a1511280385e95a3f23e026b8aa');
for (const file of snapshot.files) {
  const target = path.resolve('/candidate', file.path);
  assert(target.startsWith('/candidate/'));
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, Buffer.from(file.content, 'base64'));
  fs.chmodSync(target, file.mode === '100755' ? 0o755 : 0o644);
}
const logo = require('/source/sync/dist/Helper').default.textLogo;
assert.equal(crypto.createHash('md5').update(logo.slice(0, 1184)).digest('hex'), 'bd4a8426355824593a5e21ad759830c1');
const recipe = require('/source/project-bootstrap/wizard-build/recipe').generate(logo);
for (const file of recipe.files) {
  const target = path.resolve('/candidate', file.path);
  assert(target.startsWith('/candidate/'));
  fs.mkdirSync(path.dirname(target), {recursive: true});
  fs.writeFileSync(target, file.content);
}
fs.writeFileSync('/candidate/.system-bootstrapper/ci.yml', recipe.ci);
console.log(JSON.stringify({sourceRevision: snapshot.sourceRevision, sourceFiles: snapshot.files.length, recipeHash: recipe.recipeHash}));
