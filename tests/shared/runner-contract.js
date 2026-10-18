'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {runChecks} = require('./run-checks');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'component-runner-'));
  try {
    fs.mkdirSync(path.join(root,'tests'));
    fs.writeFileSync(path.join(root,'tests/pass.js'), 'console.log("result < & >");\n');
    fs.writeFileSync(path.join(root,'tests/fail.js'), 'process.exitCode = 7;\n');
    const marker = path.join(root,'descendant-survived');
    const descendant = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected'), 800);`;
    fs.writeFileSync(path.join(root,'tests/hang.js'), `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'ignore'}); setInterval(() => {}, 1000);\n`);
    const checks = ['pass','fail','hang'].map(name => ({component:'fixture',file:name+'.js',timeoutSeconds:0.2}));
    const reportDirectory = path.join(root,'reports');
    const results = await runChecks(checks, {root,reportDirectory,log:()=>{}});
    assert.deepStrictEqual(results.map(item=>item.status), ['passed','failed','timeout']);
    assert.equal(results[1].code,7);
    assert(fs.readFileSync(path.join(reportDirectory,'junit.xml'),'utf8').includes('result &lt; &amp; &gt;'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(reportDirectory,'results.json'))).results.length,3);
    const signal = setTimeout(() => process.kill(process.pid,'SIGTERM'),100);
    const canceled = await runChecks([{component:'fixture',file:'hang.js',timeoutSeconds:2}], {root,reportDirectory,log:()=>{}});
    clearTimeout(signal);
    assert.equal(canceled[0].status,'canceled');
    await new Promise(resolve=>setTimeout(resolve,900));
    assert(!fs.existsSync(marker),'timeout/cancellation must terminate descendant processes');
    console.log('PASS: success, nonzero child exit, timeout/cancellation descendant cleanup and escaped persistent reports.');
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
