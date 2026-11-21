'use strict';
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const root=path.resolve(__dirname,'../..');
const tests=fs.readdirSync(path.join(root,'tests/operations')).filter(file=>file.endsWith('.test.cjs')).sort();
if(!tests.length)throw Error('Missing shared operations acceptance tests.');
// Bound file-process parallelism independently of the host CPU-derived default.
execFileSync(process.execPath,['--test','--test-concurrency=2',...tests.map(file=>path.join(root,'tests/operations',file))],{cwd:root,stdio:'inherit'});
