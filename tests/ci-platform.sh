#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export SYSTEM_DISPOSABLE_CANDIDATE=I_ACCEPT_PRIVILEGED_DISPOSABLE_EXECUTION
cleanup() {
  failed=0
  # The independent after_script retries only receipts from this job's checkout.
  node tests/e2e/candidate.js cleanup-all test-results/e2e || failed=1
  node - <<'JS' || failed=1
const {execFileSync}=require('child_process');
const {identifiers}=require('./tests/e2e/prepare-images');
let failed=false;
for(const name of Object.values(identifiers())){
  try{
    const listed=execFileSync('docker',['image','ls','--filter','reference='+name,'--format','{{.ID}}'],{encoding:'utf8',timeout:8000}).trim();
    if(!listed)continue;
    const item=JSON.parse(execFileSync('docker',['image','inspect',name],{encoding:'utf8',timeout:8000}))[0];
    if(item.Config.Labels['org.system-bootstrapper.test-job']!==process.env.CI_JOB_ID)throw Error();
    execFileSync('docker',['image','rm',name],{stdio:'ignore',timeout:8000});
  }catch{failed=true;}
}
if(failed)process.exitCode=1;
JS
  return "$failed"
}
if [ "${1:-}" = cleanup ]; then cleanup; exit $?; fi
on_exit() {
  primary=$?
  trap - EXIT INT TERM
  cleanup || { if [ "$primary" -eq 0 ]; then primary=1; fi; }
  exit "$primary"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node tests/e2e/prepare-images.js
node tests/e2e/candidate.js .candidate-images/spec.json
