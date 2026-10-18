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
  'trace-unavailable':/$a/
};
const reasons=new Set(['script_failure','runner_configuration_error','runner_system_failure','job_execution_timeout','stuck_or_timeout_failure','api_failure','unknown_failure']);
const failureReason=value=>reasons.has(value)?value:undefined;
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
module.exports={classify,sanitize,failureReason};
