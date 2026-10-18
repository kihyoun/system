'use strict';
const fs = require('fs');
const path = require('path');
const {spawn} = require('child_process');

const xml = value => String(value).replace(/[<>&"']/g, character => ({'<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;'}[character]));
function sanitize(text) {
  for (const [key, value] of Object.entries(process.env)) {
    if (/password|secret|token|private.key/i.test(key) && value.length >= 8) text = text.split(value).join('[redacted]');
  }
  // XML 1.0 reports cannot contain terminal control bytes (including ANSI ESC).
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}
function killGroup(child) {
  if (!Number.isInteger(child.pid)) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
async function execute(check, root) {
  const started = Date.now();
  const file = path.resolve(root, 'tests', check.file);
  const command = check.file.endsWith('.sh') ? 'bash' : check.file.endsWith('.rb') ? 'ruby' : check.file.endsWith('.py') ? 'python3' : process.execPath;
  return new Promise(resolve => {
    let output = '', timedOut = false, canceled = false, launchError;
    const environment = {...process.env};
    // These test-only overrides must not redirect the isolated suite to another checkout.
    delete environment.SYNC_ENTRY;
    delete environment.SUGGESTIONS_MODULE;
    const child = spawn(command, [file], {cwd:root, env:environment, detached:true, stdio:['ignore','pipe','pipe']});
    const append = data => { output = (output + data.toString()).slice(-65536); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const cancel = () => { canceled = true; killGroup(child); };
    process.once('SIGTERM', cancel);
    process.once('SIGINT', cancel);
    const timer = setTimeout(() => { timedOut = true; killGroup(child); }, check.timeoutSeconds * 1000);
    child.on('error', error => { launchError = error.code; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      // Remove descendants even when the parent exited without cleaning up its Sync child.
      killGroup(child);
      process.removeListener('SIGTERM', cancel);
      process.removeListener('SIGINT', cancel);
      const status = canceled ? 'canceled' : timedOut ? 'timeout' : code === 0 ? 'passed' : 'failed';
      resolve({...check, status, code, signal, launchError, seconds:(Date.now()-started)/1000, output:sanitize(output)});
    });
  });
}
function writeReports(results, directory) {
  fs.mkdirSync(directory, {recursive:true});
  fs.writeFileSync(path.join(directory, 'results.json'), JSON.stringify({results}, null, 2) + '\n');
  const failures = results.filter(item => item.status !== 'passed').length;
  const cases = results.map(item => `<testcase classname="${xml(item.component)}" name="${xml(item.file)}" time="${item.seconds}">` +
    (item.status === 'passed' ? '' : `<failure message="${xml(item.status)}">${xml(item.output || item.launchError || item.signal || item.code)}</failure>`) +
    `<system-out>${xml(item.output)}</system-out></testcase>`).join('\n');
  fs.writeFileSync(path.join(directory, 'junit.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuite name="isolated" tests="${results.length}" failures="${failures}" time="${results.reduce((sum,item)=>sum+item.seconds,0)}">\n${cases}\n</testsuite>\n`);
}
async function runChecks(checks, {root, reportDirectory, log=console.log}) {
  const results = [];
  for (const check of checks) {
    const result = await execute(check, root);
    results.push(result);
    writeReports(results, reportDirectory);
    log(`[${result.component}] ${result.file}: ${result.status} (${result.seconds.toFixed(2)}s)`);
    if (result.output) log(result.output.trimEnd());
    if (result.status === 'canceled') break;
  }
  return results;
}
module.exports = {runChecks};
