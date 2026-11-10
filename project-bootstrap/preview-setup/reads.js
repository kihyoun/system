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
module.exports = {batchedReads, MAX_ROUTES, MAX_OUTPUT_BYTES};
