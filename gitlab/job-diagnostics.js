'use strict';
// Never retain a raw job trace: it may contain registry or GitLab credentials.
// Reports contain only these fixed, source-controlled classifications.
const commands={build:/^\$ docker build\b/m,login:/^\$ .*docker login\b/m,push:/^\$ docker push\b/m,pull:/^\$ docker pull\b/m,run:/^\$ docker run\b/m,proof:/^\$ printf candidate-registry-ok\b/m};
const failures={
  'registry-protocol':/server gave HTTP response to HTTPS client|Client sent an HTTP request to an HTTPS server/i,
  'registry-authentication':/no basic auth credentials|authentication required|unauthorized:|HTTP Basic: Access denied|denied: requested access/i,
  'connection-refused':/connection refused/i,
  'network-resolution':/no such host|Could not resolve host|network is unreachable|i\/o timeout|TLS handshake timeout/i,
  'daemon-transport':/Cannot connect to the Docker daemon|Is the docker daemon running|permission denied[^\n]*docker.sock/i,
  'image-unavailable':/No such image|manifest unknown|pull access denied|failed to resolve source metadata/i,
  'buildx-unavailable':/buildx[^\n]*(?:not a docker command|missing)|requires the buildx component/i,
  'invalid-image-reference':/invalid reference format/i,
  'runner-pull-policy':/PullPolicies[^\n]{0,200}AllowedPullPolicies|pull_policy[^\n]*not[^\n]*allowed/i,
  'checkout-failed':/fatal: unable to access|fatal:.*could not read Username|Authentication failed|Repository not found/i,
  'artifact-failed':/No files to upload|Uploading artifacts[^\n]*failed/i,
  'package-version-unavailable':/unable to select packages|breaks: world\[|Version [^\n]+ was not found/i,
  'npm-command-failed':/npm (?:error|ERR!) (?:code|command|errno)/i,
  'javascript-test-failed':/AssertionError|ERR_ASSERTION|(?:Test Files|Tests)\s+\d+ failed|FAIL\s+(?:src|tests?)\//,
  'typecheck-failed':/error TS[0-9]{4}:|TS[0-9]{4}:|Type error:/,
  'browser-check-failed':/browserType\.launch:|Failed to install browsers|Host system is missing dependencies|Executable doesn't exist at/i,
  'unclassified-job-failure':/(?!)/,
  'trace-unavailable':/(?!)/
};
const reasons=new Set(['script_failure','runner_configuration_error','runner_system_failure','job_execution_timeout','stuck_or_timeout_failure','api_failure','unknown_failure']);
const failureReason=value=>reasons.has(value)?value:undefined;
const setupFailures={
  'Source transfer failed. Inspect project ownership and remote refs before explicitly resuming.':'source-transfer-failed',
  'Source CI producers differ from the accepted controller. No refs were pushed; use the explicit reviewed source-primary path.':'source-producer-mismatch',
  'The source default branch changed or is unavailable. No refs were pushed; run preflight again.':'source-default-branch-changed',
  'The imported project contains changed or additional refs. Preserve operator edits and reconcile manually.':'source-refs-conflict',
  'All required native source and delivery checks must succeed.':'native-check-failed',
  'Native Wizard pipeline failed outside the optional public mirror.':'native-check-failed'
};
const setupCodes=new Set([...Object.values(setupFailures),'setup-failure-unclassified']);
const setupFailureCode=value=>setupCodes.has(value)?value:undefined;
function setupFailure(job){
  return setupFailureCode(job?.failureCode)||
    (typeof job?.message==='string'&&Object.hasOwn(setupFailures,job.message)?setupFailures[job.message]:'setup-failure-unclassified');
}
function classify(trace) {
  if(typeof trace!=='string'||trace.length>524288)return {codes:['trace-unavailable']};
  const clean=trace.replace(/\x1b\[[0-9;]*m/g,'');
  const result={commands:Object.entries(commands).filter(([,pattern])=>pattern.test(clean)).map(([name])=>name),
    codes:Object.entries(failures).filter(([,pattern])=>pattern.test(clean)).map(([name])=>name)};
  const exit=/ERROR: Job failed[^\n]*exit code ([0-9]{1,3})\b/.exec(clean);
  if(exit&&Number(exit[1])<=255)result.exitCode=Number(exit[1]);
  return result;
}
function sanitize(value) {
  if(!value||typeof value!=='object')return undefined;
  const result={};
  for(const [key,allowed]of [['commands',commands],['codes',failures]]) {
    if(Array.isArray(value[key]))result[key]=value[key].filter(item=>typeof item==='string'&&Object.hasOwn(allowed,item)).slice(0,12);
  }
  if(Number.isInteger(value.exitCode)&&value.exitCode>=0&&value.exitCode<=255)result.exitCode=value.exitCode;
  return Object.keys(result).length?result:undefined;
}
module.exports={classify,sanitize,failureReason,setupFailure,setupFailureCode};
