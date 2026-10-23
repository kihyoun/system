'use strict';
const assert = require('assert/strict');
const {assess, LIMITS} = require('../../gitlab/check-candidate-capacity');
const memory = gib => `MemTotal: 99999999 kB\nMemAvailable: ${gib * 1024 ** 2} kB\n`;
const disk = gib => ({bavail: BigInt(gib * 1024 ** 2), bsize: 1024n});

assert.equal(assess(memory(14), disk(40)).capacityReady, true);
assert.equal(assess(memory(13), disk(40)).memoryReady, false);
assert.equal(assess(memory(14), disk(39)).diskReady, false);
assert.equal(assess(memory(0), disk(40)).capacityReady, false);
assert.throws(() => assess('MemTotal: 99999999 kB\n', disk(40)));
assert.throws(() => assess(memory(16) + memory(16), disk(40)));
assert.throws(() => assess(memory(16), {bavail: -1, bsize: 1024}));
assert.throws(() => assess(memory(16), {bavail: Number.MAX_SAFE_INTEGER, bsize: 1024}));
assert.equal(LIMITS.candidateMemoryBytes, 12 * 1024 ** 3);
console.log('Candidate capacity checks passed, including missing/insufficient/ambiguous inputs.');
