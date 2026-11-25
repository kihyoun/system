const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { bootstrapperCube, renderWelcome } = require('../../dist/cli/presentation');

test('CLI keeps the original Cube byte signature and opening', () => {
  assert.equal(Buffer.byteLength(bootstrapperCube, 'ascii'), 1184);
  assert.equal(createHash('md5').update(bootstrapperCube).digest('hex'),
    'bd4a8426355824593a5e21ad759830c1');
  assert.equal(bootstrapperCube[807], '$');
});

test('welcome includes the unchanged Cube, version and help entry point', () => {
  const output = renderWelcome('2.0.0');
  assert.ok(output.startsWith(bootstrapperCube));
  assert.match(output, /System Bootstrapper 2\.0\.0/);
  assert.match(output, /system-bootstrapper --help/);
});
