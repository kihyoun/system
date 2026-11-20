#!/bin/sh
# Browser tests consume the exact build artifact from the required check job.
set -eu
[ -s build/index.html ] && [ -s build-tools/export-configuration.cjs ] || {
  printf '%s\n' 'Required source-check artifacts missing.' >&2; exit 1;
}
mkdir -p test-results
./node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort >test-results/preview.log 2>&1 &
preview=$!
cleanup() { kill "$preview" 2>/dev/null || :; wait "$preview" 2>/dev/null || :; }
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
node --input-type=module - <<'JS'
let ready = false;
for (let i = 0; i < 100; i++) {
  try {
    const response = await fetch('http://127.0.0.1:4173', {signal: AbortSignal.timeout(1000)});
    if (response.status === 200) { ready = true; break; }
  } catch {}
  await new Promise(resolve => setTimeout(resolve, 200));
}
if (!ready) { console.error('Isolated Wizard preview did not become ready.'); process.exitCode = 1; }
JS
WIZARD_BASE_URL=http://127.0.0.1:4173 npm run test:ci
