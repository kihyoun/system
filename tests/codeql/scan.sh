#!/bin/sh
# Runs on a prepared public source tree; no build or dependency installation.
set -eu
source_dir=${1:-/source}
report_dir=${2:-/reports}
codeql=${CODEQL_BINARY:-/opt/codeql/codeql}
mkdir -p "$report_dir"
"$codeql" version --format=json > "$report_dir/tool.json"
node -e 'const x=JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));if(x.version!=="2.27.4")throw Error("Expected CodeQL 2.27.4");' "$report_dir/tool.json"
# The pinned official extractor skips hidden directories unless each hidden
# directory is an explicit include root. Retain the normal root as well.
LGTM_INDEX_INCLUDE=$(node "$(dirname -- "$0")/extractor-includes.js" "$source_dir")
export LGTM_INDEX_INCLUDE
unset LGTM_INDEX_EXCLUDE LGTM_INDEX_FILTERS LGTM_REPOSITORY_FOLDERS_CSV
"$codeql" database create "$report_dir/database" --language=javascript --build-mode=none \
  --source-root="$source_dir" --threads=2 --ram=4096
"$codeql" database analyze "$report_dir/database" \
  codeql/javascript-queries:codeql-suites/javascript-code-scanning.qls \
  --threads=2 --ram=4096 --format=sarifv2.1.0 --sarif-category=javascript-typescript \
  --sarif-add-baseline-file-info --output="$report_dir/results.sarif"
node "$(dirname -- "$0")/check-sarif.js" "$report_dir/results.sarif" "$source_dir/scan-source.json" > "$report_dir/gate.json"
