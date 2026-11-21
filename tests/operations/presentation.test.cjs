const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { test } = require('node:test');
const { BOOTSTRAPPER_CUBE, renderWelcome } = require('../../dist/cli/presentation');

test('CLI keeps the original Cube byte signature and opening', () => {
  assert.equal(Buffer.byteLength(BOOTSTRAPPER_CUBE, 'ascii'), 1184);
  assert.equal(createHash('md5').update(BOOTSTRAPPER_CUBE).digest('hex'),
    'bd4a8426355824593a5e21ad759830c1');
  assert.equal(BOOTSTRAPPER_CUBE[807], '$');
});

test('welcome includes the unchanged Cube, version and help entry point', () => {
  const output = renderWelcome('2.0.0');
  assert.ok(output.startsWith(BOOTSTRAPPER_CUBE));
  assert.match(output, /System Bootstrapper 2\.0\.0/);
  assert.match(output, /system-bootstrapper --help/);
});
