#!/usr/bin/env bash
# The only shell bootstrap: prepare pinned Node, verify the accepted CLI, hand off to Nest.
set -euo pipefail
umask 077
mode=install
release_tag=''
if (( $# )); then
  [[ $# == 2 && $1 == --runtime-only && $2 =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Usage: quickstart.sh [--runtime-only vMAJOR.MINOR.PATCH]' >&2; exit 1; }
  mode=runtime
  release_tag=$2
fi
[[ $(id -u) == 0 ]] || { echo 'Run Quickstart with sudo/root access.' >&2; exit 1; }
exec 9>/run/system-bootstrapper-quickstart.lock
flock -n 9 || { echo 'Another Quickstart is running.' >&2; exit 1; }
runtime=/opt/system-bootstrapper-runtime
targets=("$runtime" /usr/local/bin/system-bootstrapper)
if [[ $mode == install ]]; then targets+=(/opt/system-bootstrapper /etc/system-bootstrapper /var/lib/system-bootstrapper /system); fi
for target in "${targets[@]}"; do
  [[ ! -e "$target" && ! -L "$target" ]] || { echo "Preserving existing state: $target" >&2; exit 1; }
done
# Download into a private temporary directory; execute only checksum-verified bytes.
staging=$(mktemp -d)
runtime_created=0
cleanup_quickstart() {
  local status=$?
  trap - EXIT
  rm -rf -- "$staging"
  if (( status != 0 && runtime_created == 1 )) && [[ ! -e "$runtime/.host-handoff" ]]; then
    rm -rf -- "$runtime"
  fi
  exit "$status"
}
trap cleanup_quickstart EXIT
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --max-time 180 \
  https://raw.githubusercontent.com/nvm-sh/nvm/4e8758a801eea9479b32a904f31093e410ddaba4/nvm.sh -o "$staging/nvm.sh"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --max-time 300 \
  https://nodejs.org/dist/v24.22.0/node-v24.22.0-linux-x64.tar.xz -o "$staging/node.tar.xz"
(cd "$staging" && sha256sum --check <<'SYSTEM_RUNTIME_HASHES'
e7ffd3d192735da61e5eb04e68f1aca4a293af4cd0000864568d6de7aa8f6fc4  nvm.sh
cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008  node.tar.xz
SYSTEM_RUNTIME_HASHES
)
mkdir "$runtime"
runtime_created=1
mkdir -p "$runtime/nvm/versions/node"
cp "$staging/nvm.sh" "$runtime/nvm/nvm.sh"
tar -xJf "$staging/node.tar.xz" -C "$runtime/nvm/versions/node" --no-same-owner
mv "$runtime/nvm/versions/node/node-v24.22.0-linux-x64" "$runtime/nvm/versions/node/v24.22.0"
ln -s "$runtime/nvm/versions/node/v24.22.0/bin" "$runtime/bin"
node="$runtime/bin/node"
[[ $("$node" --version) == v24.22.0 ]]
printf '%s\n' "$runtime/nvm/versions/node/v24.22.0/bin/node" > "$runtime/node-executable"
export PATH="$runtime/bin:$PATH"
"$node" --input-type=module - "$staging" "$runtime" "$mode" "$release_tag" <<'SYSTEM_QUICKSTART_JS'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const REPOSITORY = 'kihyoun/system'; // Replaced for the accepted public mirror.
const ACCEPTED_RELEASE_TAG = null; // Replaced only in the accepted public release asset.
const allowed = new Set(['api.github.com','github.com','release-assets.githubusercontent.com','objects.githubusercontent.com']);
const require = (ok, message) => { if (!ok) throw Error(message); };
async function download(address, limit = 32 * 1024 * 1024) {
  const signal = AbortSignal.timeout(60000);
  for(let redirects = 0; redirects < 6; redirects++) {
    const url = new URL(address);
    require(url.protocol === 'https:' && allowed.has(url.hostname) && !url.port && !url.username && !url.password && !url.hash, 'Unapproved public download origin.');
    const response = await fetch(url, {redirect:'manual', signal, headers:{'User-Agent':'System-Bootstrapper-Quickstart'}});
    if ([301,302,303,307,308].includes(response.status)) {
      address = new URL(response.headers.get('location'),url).href;
      await response.body?.cancel();
      continue;
    }
    require(response.ok, 'Public release download failed.');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      require(size <= limit, 'Public release input is too large.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw Error('Too many public download redirects.');
}
const digest = (data, algorithm, encoding='hex') => crypto.createHash(algorithm).update(data).digest(encoding);
export async function metadata(requestedTag = '') {
  require(!requestedTag || /^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(requestedTag), 'Stable release tag required.');
  const selectedTag = ACCEPTED_RELEASE_TAG || requestedTag;
  require(!ACCEPTED_RELEASE_TAG || !requestedTag || requestedTag === ACCEPTED_RELEASE_TAG, 'Published Quickstart release binding mismatch.');
  const release = JSON.parse(await download('https://api.github.com/repos/'+REPOSITORY+'/releases/'+(selectedTag ? 'tags/'+selectedTag : 'latest')));
  const tag = release.tag_name;
  require(/^v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(tag) && (!selectedTag || tag === selectedTag) && release.draft === false && release.prerelease === false, 'Published stable accepted release required.');
  const asset = async name => {
    const rows = release.assets.filter(row=>row.name === name);
    const url = 'https://github.com/'+REPOSITORY+'/releases/download/'+tag+'/'+name;
    require(rows.length === 1 && rows[0].browser_download_url === url, 'Expected public release asset missing.');
    return download(url);
  };
  const name = 'system-release-'+tag+'.json', raw = await asset(name);
  require((await asset(name+'.sha256')).toString() === digest(raw,'sha256')+'  '+name+'\n', 'Metadata checksum mismatch.');
  const value = JSON.parse(raw), source = value.source, receipt = value.quickstart?.cli;
  require(value.format === 'system-accepted-release-v1' && value.tag === tag && value.version === tag.slice(1) && value.platform === 'linux/amd64' && value.acceptance?.requiredChecksPassed === true && value.acceptance?.controllerWizardSameAttempt === true, 'Accepted public release required.');
  require(source?.sourceLayout === 'system-monorepo-v1' && source.repository === 'https://github.com/'+REPOSITORY+'.git' && ['revision','tree','wizardSourceTree'].every(key=>/^[a-f0-9]{40}$/.test(source[key])), 'Exact accepted monorepo source required.');
  require(receipt?.format === 'system-cli-source-v1' && receipt.name === '@systembootstrapper/cli' && receipt.version === value.version && receipt.sourceRevision === source.revision && receipt.sourceTree === source.tree && receipt.filename === 'systembootstrapper-cli-'+value.version+'.tgz' && ['pipelineId','packageJobId'].every(key=>Number.isSafeInteger(receipt[key]) && receipt[key]>0) && /^[a-f0-9]{64}$/.test(receipt.sha256) && /^sha512-[A-Za-z0-9+/]{86}==$/.test(receipt.integrity), 'Exact accepted CLI receipt required.');
  const artifact = await asset(receipt.filename);
  require(digest(artifact,'sha256') === receipt.sha256 && 'sha512-'+digest(artifact,'sha512','base64') === receipt.integrity, 'Accepted CLI checksum mismatch.');
  return {value,artifact};
}
export async function main(staging, runtime, mode, requestedTag) {
  const {value,artifact} = await metadata(requestedTag);
  const archive = path.join(staging,value.quickstart.cli.filename), manifest = path.join(staging,'release.json');
  fs.writeFileSync(archive,artifact,{mode:0o600});
  fs.writeFileSync(manifest,JSON.stringify(value),{mode:0o600});
  const run = (args,env,timeout) => {
    const result = spawnSync(process.execPath,args,{env,stdio:'inherit',timeout});
    require(!result.error && result.status === 0,'Native CLI operation failed. Preserve state and consult the installation guide.');
  };
  run([path.join(runtime,'bin/npm'),'install','--offline','--ignore-scripts','--no-audit','--no-fund','--prefix',path.join(runtime,'cli'),archive],{PATH:path.join(runtime,'bin'),HOME:staging,npm_config_cache:path.join(staging,'cache'),npm_config_userconfig:path.join(staging,'user.npmrc'),npm_config_globalconfig:path.join(staging,'global.npmrc')},180000);
  const retainedArtifact=path.join(runtime,'accepted-cli.tgz');
  fs.copyFileSync(archive,retainedArtifact,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(retainedArtifact,0o600);
  const retainedMetadata=path.join(runtime,'accepted-release.json');
  fs.copyFileSync(manifest,retainedMetadata,fs.constants.COPYFILE_EXCL);
  fs.chmodSync(retainedMetadata,0o600);
  const entry=path.join(runtime,'cli/node_modules/@systembootstrapper/cli/dist/cli/main.js');
  if (mode === 'runtime') {
    run([entry,'cli-install','--runtime',runtime,'--release-metadata',manifest,'--artifact',retainedArtifact],process.env,180000);
    console.log('Accepted offline host runtime ready: '+runtime); return;
  }
  fs.writeFileSync(path.join(runtime,'.host-handoff'),'native-quickstart\n',{mode:0o600,flag:'wx'});
  run([entry,'host-bootstrap','quickstart','--checkout','/opt/system-bootstrapper','--metadata',manifest],process.env,3600000);
  run([entry,'cli-install','--runtime',runtime,'--release-metadata',manifest,'--artifact',retainedArtifact,'--checkout','/opt/system-bootstrapper'],process.env,180000);
  console.log('Wizard ready: http://127.0.0.1/configuration. For remote access use a protected SSH tunnel: ssh -N -L 8080:127.0.0.1:80 <your-user>@<your-host>');
  console.log('Read first-access credentials locally: sudo cat /var/lib/system-bootstrapper/platform/configuration/sync-auth.env');
}
if (process.argv[1] === '-') await main(process.argv[2],process.argv[3],process.argv[4],process.argv[5]).catch(error=>{console.error('Quickstart: '+error.message);process.exitCode=1;});
SYSTEM_QUICKSTART_JS
