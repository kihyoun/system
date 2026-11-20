# Ubuntu 호스트 준비

새 Ubuntu 24.04 또는 26.04 LTS amd64 호스트에서는 [단일 명령 빠른 시작](docs/QUICKSTART.md)이
승인된 공개 릴리스를 선택하고 아래의 기본 도구에 작업을 위임합니다. RAM 8 GiB,
여유 디스크 40 GiB, curl, 관리자 접근 권한이 필요합니다.
기존 설치, DNS/HTTPS, 복구에는 아래의 명시적인 경로를 사용하세요.

## 테스트된 공개 릴리스 설치

최종 사용자 설치에는 검토된 **완전한 컨트롤러** 이미지와 이에 일치하는 Wizard 웹 이미지를
공개 Docker Hub 저장소에서 사용하세요. 컨트롤러는 `system/Dockerfile`에서 빌드하며
Sync와 수명 주기 도구를 포함합니다. `bootstrapper/Dockerfile`에서 빌드한 더 작은 런타임
기반 이미지는 부팅 가능한 컨트롤러가 아니므로 대신 사용하면 안 됩니다.

릴리스의 정확한 System 소스 리비전과 각각 `@sha256:...`로 끝나는 두 불변 이미지 참조를
선택하세요. 게시자의 릴리스 증거는 소스 리비전/트리, 고정된 Wizard 리비전, 두 이미지 ID를
이 참조에 연결합니다. [GitHub Releases](https://github.com/kihyoun/system/releases)의
버전별 공개 메타데이터에서 [릴리스 검증 절차](docs/RELEASES.md)에 따라 값을 얻거나,
직접 성공시킨 게시 출력에서 값을 얻으세요. CI 작업 아티팩트가 자동으로 공개 다운로드가
되는 것은 아닙니다. 최초 시작이 비공개 GitLab 인스턴스 접근에 의존하지 않도록 하세요.

`sha-<full-System-commit>-job-<candidate-job-id>` 같은 시도별 태그와 선택적인 보호 버전
태그 `v1.2.3` 등으로 이미지를 찾을 수 있습니다. 후보 작업이 포함되는 이유는 소유권 레이블이
이미지 다이제스트를 바꾸기 때문입니다. 같은 커밋을 나중에 빌드해도 별도로 테스트된 시도입니다.
게시된 버전 별칭은 다른 시도에 재할당하지 않습니다. `latest`를 포함한 태그가 불변이라고
가정하지 말고 기록된 다이제스트로 설치하세요. 공개 가져오기에는 Docker Hub 계정이 필요하지
않지만 익명 요청 속도 제한과 Docker Hub 가용성의 영향은 여전히 받습니다. 선언된 공개
릴리스는 `linux/amd64` 대상이며 전체 플랫폼의 ARM64 지원을 보장하지 않습니다.
어떤 이미지에도 비공개 기본 구성, 서비스 데이터베이스, Seed는 포함되지 않습니다.
공개 릴리스 기록은 두 프로젝트 이미지를 연결하지만 모든 타사 서비스를 고정하지는 않습니다.
배포에 사용할 기본 GitLab, Runner, NGINX 이미지 선택은 별도로 검토하세요.

호스트 준비는 여전히 Ubuntu/Docker APT 저장소에서 Docker Engine/Compose를 설치합니다.
릴리스 이미지를 사용하면 새 호스트에서 컨트롤러/Wizard 소스 빌드와 Alpine 패키지 해석을
수행할 필요가 없어집니다. 호스트 의존성, GitLab 최초 초기화, CI에서 빌드 입력을 유지해야 할
요구 사항까지 없어지는 것은 아닙니다. 전체 [로컬](docs/HANDBOOK.md#0-getting-started) 또는
[도메인/HTTPS](docs/HANDBOOK.md#public-server-own-domain-and-https) 안내를 참조하세요.

## 호스트 의존성 준비

먼저 아래의 런타임 준비 절차를 완료한 후 Ubuntu의 로컬 체크아웃에서 호스트 설치 프로그램을 실행하세요. systemd를 활성화한 WSL2의
Ubuntu도 포함됩니다. Docker APT 저장소에서 Docker Engine, Buildx, Compose 플러그인을
설치하고 Docker를 시작한 뒤 `hello-world`를 실행합니다. 관련 없는 운영체제 패키지는
업그레이드하지 않습니다.

```bash
SYSTEM_REVISION='REPLACE_WITH_40_CHARACTER_RELEASE_COMMIT'
git clone https://github.com/kihyoun/system.git
cd system
git checkout --detach "$SYSTEM_REVISION"
git submodule update --init --recursive
CONTROLLER_RELEASE='docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST'
WIZARD_RELEASE='docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST'
# After preparing the runtime below:
sudo /opt/system-bootstrapper-runtime/bin/node bootstrapper/install.js
```

설치 프로그램은 오케스트레이션 스크립트용 `docker-compose` 래퍼를 제공합니다.
예상되는 밑줄 구분 컨테이너 이름을 유지하도록 `docker compose --compatibility`를 사용합니다.
서비스 구성, 영구 저장, 플랫폼 승인 검사는 별도 단계입니다.

## 네이티브 호스트 런타임 준비

호스트의 `system-bootstrapper start --checkout /absolute/reviewed/source`, `system-bootstrapper stop --checkout /absolute/reviewed/source`, `bootstrapper/persistence.js`, 릴리스 설치 및 호스트 작업 진입점,
교체/복원 도구는 첫 호출 **전에** Node와 컴파일된 `operations`가 필요합니다. Docker만
설치하거나 초기화 도구에 `--install-host`를 전달해도 이 런타임은 준비되지 않습니다.
아래 준비 경로 중 하나를 선택하여 시작 절차나 복구 절차 전에 완료하세요.

Quickstart는 고정된 커밋과 스크립트 해시를 확인하여 nvm **0.41.0**을 설치한 뒤,
nvm으로 Node **24.22.0**을 설치합니다. 전용 설치 경로는
`/opt/system-bootstrapper-runtime`이며 기존 사용자의 nvm 설치, 기본 버전과
셸 프로필은 변경하지 않습니다. nvm이 내려받은 Node 압축 파일의 고정 해시도
확인합니다. Quickstart는 검증된 CLI 아카이브와 포함된 의존성을 오프라인으로
설치하며 설치 스크립트를 실행하지 않습니다. 이 컴파일된 파일을 동일한 승인
소스 체크아웃에 복사하므로 다시 빌드할 필요가 없습니다.

수동 설치에서는 먼저 검토된 릴리스의 소스를 체크아웃한 다음 [릴리스 안내](docs/RELEASES.md)에 따라 공개 메타데이터를 검증합니다.
호스트 수명 주기, 영구 저장 또는 설치 진입점을 호출하기 전에 다음 명령으로 런타임을 준비하세요.

```sh
SYSTEM_RELEASE_TAG='vMAJOR.MINOR.PATCH' # Exact reviewed public release
sudo bash tools/quickstart/quickstart.sh --runtime-only "$SYSTEM_RELEASE_TAG"
# The checkout must match that release's verified source revision.
test ! -e operations/dist && test ! -e operations/node_modules && \
sudo cp -a /opt/system-bootstrapper-runtime/cli/node_modules/@systembootstrapper/cli/dist operations/dist && \
sudo cp -a /opt/system-bootstrapper-runtime/cli/node_modules/@systembootstrapper/cli/node_modules operations/node_modules
```

기존 런타임 디렉터리는 덮어쓰지 않습니다. 오프라인 복구를 위해
런타임 디렉터리와 `operations/dist`, `operations/node_modules`를
보존하세요. 도구는 저장된 Node 실행 파일의 절대 경로를 사용하므로 복구 중에는
nvm, 셸 프로필이나 npm 네트워크 접근이 필요하지 않습니다. 실행 파일 경로는
`/opt/system-bootstrapper-runtime/node-executable`에 기록됩니다.

### 사전 빌드된 컨트롤러 런타임 없이 소스 개발하기

검토된 소스 체크아웃에서는 소스로 처음 시작하기 전에 고정된 호스트 런타임을 준비하고
operations를 컴파일하세요. 이는 온라인 빌드 단계이며 승인된 이미지 복구가 아닙니다.
저장소 루트에서 실행하는 다음 명령은 별도의 nvm 체크아웃을 사용하며 셸 프로필이나
다른 nvm 설치를 변경하지 않습니다. 경로가 이미 존재하면 새 디렉터리를 선택하고 보관된
런타임을 덮어쓰지 마세요. 위에서 설명한 Docker/Compose와 호스트 의존성이 이미 필요합니다.

```bash
SYSTEM_NVM_DIR="$HOME/.local/share/system-bootstrapper-nvm"
mkdir -p "$(dirname "$SYSTEM_NVM_DIR")"
git clone https://github.com/nvm-sh/nvm.git "$SYSTEM_NVM_DIR"
git -C "$SYSTEM_NVM_DIR" checkout --detach 4e8758a801eea9479b32a904f31093e410ddaba4
(cd "$SYSTEM_NVM_DIR" && printf '%s  nvm.sh\n' e7ffd3d192735da61e5eb04e68f1aca4a293af4cd0000864568d6de7aa8f6fc4 | sha256sum --check)
export NVM_DIR="$SYSTEM_NVM_DIR"
. "$NVM_DIR/nvm.sh" --no-use
test "$(nvm --version)" = 0.41.0
NVM_NODEJS_ORG_MIRROR=https://nodejs.org/dist nvm install --no-progress -b 24.22.0
nvm use 24.22.0
printf '%s  %s\n' cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008 "$NVM_DIR/.cache/bin/node-v24.22.0-linux-x64/node-v24.22.0-linux-x64.tar.xz" | sha256sum --check
test "$(node --version)" = v24.22.0
test "$(npm --version)" = 11.19.1
npm ci --prefix operations --ignore-scripts
npm run build --prefix operations
SYSTEM_NODE_BIN="$(dirname "$(command -v node)")"
test -f operations/dist/host-lifecycle/entry.js
```

부팅 절차에 따라 운영 저장소를 선택한 다음 공개 이미지 설치 프로그램 대신
다음 소스 빌드 시작 명령을 사용하세요:

```bash
sudo env "PATH=$SYSTEM_NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  node operations/dist/cli.js start --checkout "$PWD"
```

`SYSTEM_NODE_BIN`을 유지하여 이후 `sudo env "PATH=..."` 호출에서
`system-bootstrapper stop --checkout /absolute/reviewed/source`, `bootstrapper/persistence.js`, 네이티브 호스트 도구에 전달하세요. sudo는 보통 대화형
nvm PATH를 제거합니다. 또는 승인된 이미지 경로로 준비한 전용 런타임을 사용하세요.
기존 승인 릴리스 프로필에서 빌드를 비활성화하지 않았다면 소스 시작은 여전히 컨트롤러와
Wizard 이미지를 빌드합니다. 복구 기록에 필요한 이미지를 다시 빌드하여 대체해도 된다는
뜻은 아닙니다.

오프라인 복구를 위해 원래 호스트를 잃기 전에 Node 설치와 `operations/dist`,
`operations/node_modules`를 포함한 일치하는 체크아웃을 보관하세요. `initialize.js`나
`recover-volume.js`가 저장소를 확인하기 전에 검증된 도구를 복원하세요. 없다면 유지보수
전에 호환되는 검토된 도구를 별도로 준비하세요. 중지된 플랫폼이나 npm 가용성은 복구의
전제 조건이 아닙니다. 기록된 서비스 이미지와 소스 식별 정보를 유지하세요.

## 자체 공개 릴리스 게시

소스 개발, 병합 검토, 필수 후보 검사는 GitLab에서 유지하세요. 공개 Docker Hub 게시는
해당 검사 이후의 배포 단계입니다. Docker Hub가 개발 또는 운영 환경 제어 영역이 되는
것은 아닙니다. 게시자는 테스트 후 다른 이미지를 다시 빌드하지 않고, 승인된 완전한 컨트롤러와
Wizard 이미지의 정확한 식별 정보를 복사합니다.

Docker Hub 네임스페이스에 맞게 System GitLab 프로젝트의 CI 변수를 구성하세요.

| 변수 | 값 / 처리 |
| --- | --- |
| `DOCKERHUB_PUBLISH_ENABLED` | 보호 변수입니다. `true`를 설정하면 공개 릴리스 게시를 사용합니다 |
| `DOCKERHUB_REPOSITORY` | 보호 변수입니다. 공개 컨트롤러 저장소이며, 예: `your-namespace/system` |
| `DOCKERHUB_WIZARD_REPOSITORY` | 보호 변수입니다. 공개 Wizard 저장소이며, 예: `your-namespace/wizard` |
| `DOCKERHUB_USER` | 해당 저장소에 쓰기 권한이 있는 보호 및 마스킹된 게시자 식별 정보입니다 |
| `DOCKERHUB_TOKEN` | 범위가 제한된 쓰기 토큰입니다. 보호 및 마스킹하고 소스에 저장하지 않습니다 |

게시를 활성화하기 전에 공개 저장소를 만들고 보호된 기본 브랜치/릴리스 태그 규칙을 구성하세요.
신뢰할 수 없는 병합 요청 코드에서는 게시자 자격 증명을 사용할 수 없도록 유지하세요.
공개 릴리스 기록은 소스와 이미지 식별 정보를 기록하며 자격 증명이나 설치 데이터는 기록하지
않습니다. 다른 운영자가 설치해야 한다면 공개 릴리스 채널로 기록이나 소스/다이제스트 선택을
공유하세요. 컨테이너 이미지 게시만으로 비공개 GitLab 작업 아티팩트가 공개되지는 않습니다.

저장소 쓰기는 게시자 식별 정보로 제한하세요. 가능한 경우 Docker Hub의 저장소 측 불변 태그
정책을 `sha-*`와 `v*` 별칭에 활성화하세요. CI는 게시자를 직렬화하고 이미 충돌하는 별칭을
거부하지만, 이 검사는 다른 외부 게시자의 동시 푸시를 원자적으로 배제하지는 못합니다.
설치의 기준은 별칭이 아니라 기록된 다이제스트입니다.

## 컨테이너 호스트 호환성 및 로깅

애플리케이션 데이터베이스 이미지를 선택하거나 커널 유지보수를 계획하기 전에
[기본 호스트 호환성 사전 검사](docs/HOST_OPERATIONS.md)를 실행하세요. 컨테이너는
데몬 호스트의 커널과 CPU를 공유하므로 Ubuntu ABI 번호만으로는 충분하지 않습니다.
이 가이드는 크기가 제한된 Docker 로그 기본값, 구성 백업 계약 및 명시적인
컨테이너 재생성 후 검증 방법도 설명합니다.

## 로컬 통합 테스트

호환되는 GitLab 및 Runner 릴리스를 명시적으로 선택하세요. 아래 예시는 보안 릴리스 프로필과
폐기 가능한 통합 테스트 모음으로 고정한 GitLab CE 19.5.3 및 Runner 19.5.1을 사용합니다.
GitLab의 지원되는 업그레이드 경로를 따르지 않고 새 주 버전을 기존 GitLab 데이터에 연결하지 마세요.

로컬 통합 설정에서는 GitLab을 시작하기 전에 다음 선택적 내보내기를
`PERSISTENT_DIR/configuration/.docker.env`의 완전한 비공개 기본 구성에 포함하세요.
이 옵션만 있는 불완전한 기본 구성을 만들지 마세요. 컨트롤러 내부에서 `system/.docker.env`는
저장된 구성에 대한 호환성 링크입니다. 영구 저장된 사본이 이미지에 포함된 구성보다 우선합니다.

```bash
export GITLAB_IMAGE=gitlab/gitlab-ce:19.6.1-ce.0@sha256:d3727f8b1a1ee6de44916bb9113f3dc40339dba2d6a6ad6ef331d0f239004056
export GITLAB_RUNNER_IMAGE=gitlab/gitlab-runner:v19.6.0@sha256:fb454a097fd26ea329b0234d6d82b53ae25f672bd625c278eaaee683a00f2507
export GITLAB_SSH_BIND=127.0.0.1:2222
export GITLAB_REGISTRY_BIND=127.0.0.1:5050
```

GitLab, Registry, Sync, Wizard 호스트로 각각 `gitlab.localhost`, `registry.localhost`,
`sync.localhost`, `localhost`를 사용하고, 도메인 모드는 0(HTTP), 외부 URL은 일치하도록
설정하세요. `sudo node bootstrapper/prepare-local.js`를 실행하면 로컬 호스트 이름과
`registry.localhost:5050`에 대한 Docker HTTP 예외를 추가합니다. 이 도우미는 로컬 테스트에
명시적으로 선택하는 도구입니다. 운영 환경에서는 구성된 도메인과 인증서를 사용해야 합니다.
다른 Docker 데몬 설정은 보존합니다. 위 포트 재정의는 GitLab SSH와 Registry에 적용되며
플랫폼의 웹 리스너에는 적용되지 않습니다.

관리형 로컬 GitLab에서는 Runner 개수를 1로 하고 토큰을 비워 두세요. Bootstrapper가 공유
풀을 자동으로 생성/재사용합니다. 이후 가져오기를 실행하면 Runner 토큰을 불러옵니다.
[핸드북](docs/HANDBOOK.md#2-setting-up-gitlab-runners)을 참조하세요. 또는 GitLab에서
Runner를 생성하고 해당 `glrt-` 인증 토큰을 `GITLAB_RUNNER_TOKEN`으로,
`GITLAB_RUNNER_SCALE=1`과 함께 제공하세요. 등록 스크립트는 레거시 등록 토큰도 허용하며,
기존 등록은 중복 생성하지 않고 검증합니다.

통합 테스트를 재현하려면 `tests/registry/registry-smoke.gitlab-ci.yml`을 폐기 가능한 GitLab
프로젝트의 `.gitlab-ci.yml`에 복사하세요. 이 플랫폼의 Docker 소켓 Runner를 사용하며
증명 정보 없는 단일 아키텍처 이미지를 다룹니다. 영향을 받는 Docker/GitLab 버전이 해당
매니페스트를 `blob unknown to registry`로 거부할 수 있으므로 픽스처는 BuildKit 증명 정보를
비활성화합니다. [GitLab 호환성 우회 방법](https://support.gitlab.com/hc/en-us/articles/29426166749596-Push-to-Container-Registry-Fails-Error-error-from-registry-blob-unknown-to-registry)을 참조하세요.

토큰과 생성된 `.docker.env` 파일을 Git에 넣지 마세요. 보존된 사용자 데이터에 픽스처
프로젝트를 실행하는 대신 [폐기 가능한 통합 테스트 모음](tests/e2e/README.md)을 사용해
격리된 플랫폼 승인 검사를 수행하세요.

## 부팅

먼저 [호스트 런타임 준비](#prepare-the-host-operations-runtime)를 완료하세요.

새 설치는 Ubuntu/WSL 시스템 디스크의 `/var/lib/system-bootstrapper/platform`에 있는
로컬 작업 데이터를 사용합니다. 연결된 볼륨이나 Seed는 필요하지 않습니다. 레이아웃을
명시적으로 선택하려면 비공개 호스트 선택자 파일을 만드세요.

```bash
sudo install -d -m 0700 /etc/system-bootstrapper
sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<'EOF'
PERSISTENCE_MODE=local
PERSISTENT_MOUNT=/
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
EOF
sudo chmod 0600 /etc/system-bootstrapper/persistence.env
sudo env GITLAB_SSH_BIND=127.0.0.1:2222 GITLAB_REGISTRY_BIND=127.0.0.1:5050 \
  python3 bootstrapper/install-release.py \
  --controller "$CONTROLLER_RELEASE" --wizard "$WIZARD_RELEASE" \
  --persistence-env /etc/system-bootstrapper/persistence.env
```

WSL에서는 Windows 마운트 데이터 디렉터리 대신 Linux 파일시스템을 사용하세요.
시작 시 여유 공간, 권한, 파일시스템 동작을 검증합니다. 모드가 없는 기존 `PERSISTENT_MOUNT`
선택자는 볼륨 의미를 유지합니다. 명시적인 라이브 볼륨을 사용하려면 `PERSISTENCE_MODE=volume`과
실제 마운트/UUID를 선택하세요. 선택한 볼륨이 없으면 로컬 대체 데이터를 생성하지 않고 안전하게
실패합니다. 모드를 바꿔도 기존 설치가 마이그레이션되지는 않습니다.
[작업 저장소와 백업 매체](docs/PERSISTENT_VOLUME.md)를 참조하세요.

HTTPS를 사용하는 호스트에는 Certbot을 별도로 설치한 뒤
`sudo node bootstrapper/install-volume-host.js`를 실행해 영구 TLS 상태와 갱신 통합을
구성하세요. 로컬 모드에는 추가 마운트 의존성이 필요하지 않습니다. Docker, 정상 서비스 시작,
인증서 갱신 중 어느 것도 외부 Seed 대상에 의존하지 않습니다.

`install-release.py`는 깨끗한 체크아웃과 고정된 Wizard 리비전을 가져온 공개 이미지 식별
정보와 대조해 검증합니다. 재설치를 업그레이드로 취급하지 않고, 기존 기본 구성이나 GitLab
데이터가 있으면 거부합니다. 비공개 `configuration/.release-images.env`에는 두 릴리스
이미지 선택자만 기록하고 빌드를 비활성화하여 기본 시작을 호출합니다. 이후 일반적인
`sudo node operations/dist/cli.js start --checkout "$PWD"` 호출은 이 프로필을 재사용합니다. 저장된 기본 구성에 명시한 선택자가
여전히 우선합니다. Docker 설치를 아직 실행하지 않았다면 `--install-host`로 수행할 수
있습니다. 이 설치 프로그램은 Seed 복원, 구성 ZIP 가져오기, 인증서 발급을 수행하지 않습니다.

새 로컬 설치에서는 호스트에서 `http://localhost/`를 여세요. 가져온 Bootstrapper가 구성
Wizard와 Sync 프록시를 시작합니다. 이미지 다운로드와 서비스 시작에 필요한 시간을 주세요.
생성된 최초 설정 Sync 로그인 정보는 `PERSISTENT_DIR/configuration/sync-auth.env`에서
비공개로 읽으세요. 컨트롤러에서는 `/state/sync-auth.env`에 마운트됩니다. 이후
`configuration/.docker.env`의 저장된 기본 구성을 불러오며 `SYNC_USER`와 `SYNC_PASS`를
재정의할 수 있습니다. 저장된 값이 있으면 해당 값을 사용하세요. 시작 로그에는 암호를 출력하지
않습니다.

WSL에서는 플랫폼을 사용하는 동안 Ubuntu 셸을 열어 두세요. systemd 서비스만으로는 WSL
인스턴스가 계속 실행되지 않습니다.
[Microsoft WSL systemd 문서](https://learn.microsoft.com/en-us/windows/wsl/systemd)를 참조하세요.

## Seed 수명 주기

### Wizard의 최초 설정 제안

동기화 → 가져오기(`Synchronize → Fetch`)는 먼저 저장된 구성을 요청합니다. 기본 구성이 없는 경우(HTTP 404)에만
인증된 `GET /config/suggestions` 엔드포인트를 호출합니다. 인증 오류와 기타 서버 오류는
추정을 유발하지 않습니다.

제안은 생성된 NGINX 라우팅 템플릿이 있으면 이를 사용합니다. 빠진 서비스 호스트 이름은
연결/서버 호스트 이름에서 제안할 수 있습니다. 이는 제안일 뿐입니다. DNS를 검증하거나,
도메인을 프로비저닝하거나, HTTPS를 사용할 수 있음을 확정하지 않습니다. IP 주소, Docker
형식 컨테이너 ID, example.com/org/net 자리표시자 도메인으로 호스트 이름을 만들어 내지
않습니다. 알 수 없는 값은 Wizard에 빈칸으로 남습니다. 암호와 Runner 토큰은 추론하지
않습니다. 사용자는 보내기 전에 폼을 완성하고 검증해야 합니다.

Wizard는 파생된 값에 `*`와 확인을 요청하는 도구 설명을 표시합니다. 사용자가 변경하고 싶을 수
있는 값을 포함해 저장된 구성이 항상 우선합니다. 제안을 읽는 작업은 구성을 생성/변경하거나,
서비스를 시작하거나, Seed를 적용하지 않습니다.

이를 통해 구성 절차(열기 `Open` / 백업 `Backup`, 보내기 `Push` / 가져오기 `Fetch`)와 영구 데이터 절차
(`Harvest` / `Seed`)가 독립적으로 유지됩니다. 구성은 `platform/configuration` 아래에
별도로 영구 저장하고 `/state`에 마운트합니다. 제안 자체는 구성을 자동으로 저장하거나 적용하지
않습니다.

Sync를 컴파일한 뒤 `node tests/sync/config-suggestions.js`를 실행하세요. API 테스트
`node tests/sync/config-suggestions-api.js`는 임시 구성 트리로 포트 8071에서 자체 Sync
프로세스를 시작하므로 폐기 가능한 컨테이너에서 실행해야 합니다.

### GitLab 최초 관리자 로그인

사용자 이름은 `root`입니다. 새 데이터베이스에서는 Bootstrapper가 고유한 초기 암호를
생성하거나, `GITLAB_INITIAL_ROOT_PASSWORD`(12자 이상)를
`PERSISTENT_DIR/configuration/.docker.env`의 완전한 비공개 기본 구성에서 받습니다. 컨트롤러는
`system/.docker.env` 호환성 링크를 통해 이를 읽습니다. 영구 저장된 구성이 이미지에 포함된
구성보다 우선합니다. 추적되는 예시에는 의도적으로 공용 기본 암호가 없습니다.

시작 후 로컬에서 암호를 읽으세요.

```bash
sudo docker exec system_gitlab_1 cat /etc/gitlab/bootstrapper_initial_root_password
```

root만 읽을 수 있는 이 파일은 영구 GitLab 구성 볼륨에 있으며, GitLab의 임시 초기 암호
파일과 달리 다시 시작 후에도 보존됩니다. GitLab 구성을 Seed로 Harvest할 때도 포함됩니다.
따라서 해당 Seed에 자격 증명이 들어 있다고 취급하세요. 암호를 비공개로 보관하고 로그인 후
변경하세요. 보존된 파일은 초기 암호를 기록하며 이후 변경은 기록하지 않습니다. 기존 파일은
절대 덮어쓰지 않으며, 이 파일 없이 기존 PostgreSQL 디렉터리가 있으면 생성을 건너뜁니다.
이 옵션을 설정해도 기존 GitLab 계정은 초기화되지 않습니다. 대신 GitLab의 암호 재설정
절차를 사용하세요.

Sync 자격 증명과 GitLab 관리자 자격 증명은 별개입니다. 보존된 암호 파일을 저장소나 진단
로그에 게시하면 안 됩니다.

실행 중인 GitLab 설치에 영향을 주지 않고 임시 디렉터리로 초기화 동작을 확인하려면
`node tests/gitlab/root-password.js`를 실행하세요.

### 영구 상태

`SEED_DIR`은 독립적으로 선택하는 백업 대상입니다. 선택적인 `SEED_MOUNT`/`SEED_UUID`는
이동식 저장소를 식별하며 Seed를 만들거나 읽을 때만 확인합니다. 로컬 라이브 모드에는 외부
백업 파일시스템이 필요합니다. 레거시 볼륨 모드는 유지된 볼륨에 분리된 Seed를 둘 수 있습니다.
일시적인 작업 도우미가 대상을 연결합니다. 일반 컨트롤러/GitLab 컨테이너는 `/seed` 마운트를
유지하지 않습니다. Harvest는 `/srv`의 서비스 데이터, `/ssl`의 TLS 파일, 전체 Certbot
계정/갱신 상태를 포함하는 완료된 복구 스냅샷을 만듭니다. GitLab을 중지하고 정상 종료를
요구하며, 체크섬/소유권 매니페스트를 검증하고 `seed/current`를 통해 새 스냅샷을 원자적으로
선택합니다. 이전 스냅샷은 보존합니다.

Seed 복원은 명시적 작업입니다. 시작 시 라이브 데이터를 자동으로 덮어쓰지 않습니다.
복원에는 새 라이브 서비스 데이터 디렉터리, 없거나 중지된 GitLab, 완료된 매니페스트,
동일한 GitLab 이미지 식별 정보가 필요합니다. 불완전하거나 레거시의 표시 없는 Seed는
복사 전에 거부됩니다. Seed가 없으면 기존 대상 데이터는 그대로 둡니다. 구성은 별도의
Wizard 백업으로 유지하며, Wizard는 서비스 데이터 Seed를 다운로드하지 않습니다.
잠금, 실패 처리, 빈 저장소에 복원하는 방법은 [복구 계약](docs/RECOVERY_CONTRACT.md)을
참조하세요.

셸/rsync 회귀 검사는 임시 데이터와 픽스처 Docker 명령을 사용합니다.

```bash
python3 tests/seed/recovery-contract.py
```

실제 GitLab, Registry, Runner CI, 구성 내보내기, TLS 갱신을 함께 실행하려면
[전체 폐기 가능한 승인 테스트 모음](tests/e2e/README.md)을 실행하세요.

## 종료

준비된 호스트 런타임을 사용하세요. 소스 개발 경로에서는 위의 명시적 Node PATH를 전달하세요.

```bash
sudo node operations/dist/cli.js stop --checkout "$PWD"
```
