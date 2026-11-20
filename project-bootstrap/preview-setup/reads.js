'use strict';
const MAX_ROUTES = 32;
const MAX_OUTPUT_BYTES = 1500000;
// Coalesce independent evidence GETs, never their results. Later plan/apply
// phases must observe fresh project, pipeline, artifact and repository state.
function batchedReads(send) {
  const pending = [];
  let running = false;
  async function drain() {
    while (pending.length) {
      const batch = pending.splice(0, MAX_ROUTES);
      try {
        const values = await send(batch.map(item => item.route));
        if (!Array.isArray(values) || values.length !== batch.length || Buffer.byteLength(JSON.stringify({values})) > MAX_OUTPUT_BYTES)
          throw Error('Preview setup GitLab request failed; verify readiness, permissions and the recorded operation.');
        batch.forEach((item, index) => item.resolve(values[index]));
      } catch (error) {
        for (const item of [...batch, ...pending.splice(0)]) item.reject(error);
      }
    }
    running = false;
  }
  return route => new Promise((resolve, reject) => {
    if (typeof route !== 'string' || route.length > 2048 || pending.length >= 160) {
      reject(Error('Invalid preview evidence route.')); return;
    }
    pending.push({route, resolve, reject});
    if (!running) { running = true; queueMicrotask(drain); }
  });
}
// One native collector's response belongs to one plan invocation only. Keep
// duplicate GETs distinct and refuse requests not performed by that collector.
function collectedReads(result) {
  if (!Array.isArray(result?.reads) || !result.reads.length || result.reads.length > MAX_ROUTES ||
      Buffer.byteLength(JSON.stringify(result)) > MAX_OUTPUT_BYTES || result.reads.some(row =>
        !row || typeof row.route !== 'string' || row.route.length > 2048 || !Object.hasOwn(row, 'value')))
    throw Error('Preview setup GitLab request failed; verify readiness, permissions and the recorded operation.');
  const pending = new Map();
  for (const {route, value} of result.reads) {
    if (!pending.has(route)) pending.set(route, []);
    pending.get(route).push(value);
  }
  return async route => {
    const values = pending.get(route);
    if (!values?.length) throw Error('Invalid preview evidence route.');
    return values.shift();
  };
}
module.exports = {batchedReads, collectedReads, MAX_ROUTES, MAX_OUTPUT_BYTES};
