## 0. 시작하기

### 새 Ubuntu 호스트에 빠르게 설치

sudo 권한, curl, 인터넷, RAM 8 GiB 이상,
데이터용 여유 공간 40 GiB와 소스용 1 GiB, 사용 가능한 포트 80/443을 갖춘
Ubuntu 24.04 / 26.04 LTS x86_64 호스트의 터미널에서 다음 명령을 실행하세요.

```bash
curl -fsSL https://github.com/kihyoun/system/releases/latest/download/quickstart.sh | sudo bash
```

간단한 설치 프로그램이 검증된 공개 릴리스를 가져오고 호스트를 준비한 뒤 초기 Wizard를 시작합니다.
로컬 최초 접속 안내를 따르세요. 원격 호스트에는 SSH 터널을 사용하고 브라우저에서 설정을 계속하세요.
다운로드와 서비스 시작에는 시간이 걸립니다.
이 명령은 공개 DNS/HTTPS 설정, Seed 복원 또는 기존 설치 마이그레이션을 수행하지 않습니다.
요구 사항, 릴리스 선택 및 실패 처리는 [빠른 설치](QUICKSTART.md)를,
소스/이미지 검증은 [공개 릴리스](RELEASES.md)를 참조하세요.

아래 수동 로컬 설치는 Ubuntu/WSL2에서 계속 사용할 수 있습니다.
공개 서비스에는 [도메인 및 HTTPS 경로](#public-server-own-domain-and-https)를 사용하세요.

이 절차는 **로컬 Ubuntu / WSL2 HTTP** 설치입니다.
신뢰할 수 있는 로컬 컴퓨터에서 사용하고 암호화되지 않은 구성을 공개 서비스로 노출하지 마세요.
Kubernetes 경험은 필요하지 않습니다. Ubuntu에서 명령을 실행한 뒤 브라우저에서 플랫폼을 설정하세요.
기본 Ubuntu 사용자는 Windows 설치 단계를 건너뛸 수 있습니다.

**Bootstrapper**는 서비스를 시작하고 관리합니다. **Wizard**는 React 인터페이스입니다.
**Sync 서비스**는 인터페이스를 Bootstrapper 인스턴스에 연결합니다.
GitLab, 레지스트리 및 Runner는 설정 후 추가됩니다.

### 0.1 Ubuntu 열기 및 프로젝트 체크아웃

Windows에서는 Ubuntu WSL2 콘솔을 여세요. Ubuntu를 아직 설치하지 않았다면
먼저 PowerShell에서 다음 명령을 실행하세요.

```powershell
wsl --install -d Ubuntu
```

설치 안내를 따르고 요청하면 Windows를 다시 시작한 뒤 Ubuntu를 여세요.
이후 모든 셸 명령은 PowerShell 대신 **Ubuntu 콘솔**에서 실행하세요.

검증된 공개 릴리스를 선택하고 게시자의 신뢰할 수 있는 릴리스 증거에서
정확한 System 소스 리비전, 전체 컨트롤러 다이제스트 및 일치하는 Wizard 다이제스트를 기록하세요.
이는 운영자가 제공할 입력값입니다. 아래 자리표시자를 선택한 릴리스 값으로 바꾸세요.
공개 Docker Hub 다운로드에는 계정이 필요하지 않습니다. 지정된 릴리스 대상은 `linux/amd64`입니다.

Git을 설치하고 Wizard 소스를 포함한 정확한 릴리스를 체크아웃하세요.
새 릴리스는 wizard/를 직접 포함합니다. 아래 서브모듈 초기화는 Wizard gitlink를
기록한 과거 릴리스에만 적용됩니다.

```bash
sudo apt-get update
sudo apt-get install -y git
SYSTEM_REVISION='REPLACE_WITH_40_CHARACTER_RELEASE_COMMIT'
git clone https://github.com/kihyoun/system.git
cd system
git checkout --detach "$SYSTEM_REVISION"
git submodule update --init --recursive
CONTROLLER_RELEASE='docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST'
WIZARD_RELEASE='docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST'
```

스크린샷은 로컬 구성을 보여 줍니다. 인터페이스는 컨테이너 이미지로 실행되므로
Git 체크아웃만 갱신해도 이미지가 갱신되지는 않습니다.
릴리스 설치 프로그램은 소스/이미지 식별 정보를 검증하고 검사된 이미지를 다운로드하며,
새 호스트에서 컨트롤러나 Wizard를 컴파일하지 않습니다.
전체 컨트롤러와 런타임 기본 이미지의 차이는
[공개 릴리스 선택](../Prepare-Host.md#install-a-tested-public-release)을 참조하세요.

### 0.2 Docker 및 로컬 호스트 이름 준비

필요한 Docker 도구를 설치하세요.

```bash
sudo node bootstrapper/install.js
```

설치 프로그램은 Docker와 Compose를 설치하고 테스트 컨테이너로 Docker를 확인합니다.
로컬 HTTP 테스트에는 로컬 호스트 이름과 레지스트리의 HTTP 예외도 설정하세요.

```bash
sudo node bootstrapper/prepare-local.js
```

WSL은 시작할 때 `/etc/hosts`를 다시 만들 수 있습니다.
나중에 레지스트리나 다른 로컬 호스트 이름이 해석되지 않으면 이 준비 단계를 다시 실행하세요.
컨테이너를 다시 시작하지 않고 Docker 설정을 다시 불러옵니다.
HTTP 예외는 로컬 테스트로 제한됩니다.

이 안내서는 로컬 테스트에만 HTTP를 사용합니다.
공개적으로 접근 가능한 인스턴스에는 자체 도메인과 HTTPS 설정이 필요합니다.

컨트롤러와 Wizard는 게시자의 파이프라인에서 빌드하고 검사했습니다.
검토와 개발에 사용할 소스는 체크아웃에 남아 있습니다.
최초 설치는 Dockerfile을 실행하거나 Alpine APK 패키지를 확인하지 않습니다.
수정 버전의 빌드는 검토가 필요한 별도의 개발 작업입니다.

### 0.3 Bootstrapper 최초 시작

네이티브 호스트 설치, 시작/중지, 영구 저장소 검사 또는 복구 전에
[호스트 런타임 준비](../Prepare-Host.md#prepare-the-host-operations-runtime)를 완료하세요.
Quickstart는 Node와 operations를 자동으로 준비합니다. 수동 소스/교체 호스트 경로는
먼저 이를 준비하거나 복원해야 합니다. `--install-host`는 네이티브 호스트 의존성을
설치하며 누락된 운영 런타임은 설치하지 않습니다. 유지보수 전에 검증된 Node 설치,
`operations/dist`, `operations/node_modules`, `operations/assets`를 오프라인으로 사용할 수 있게 보관하세요.

새 Ubuntu/WSL 설치는 시스템 디스크의 `/var/lib/system-bootstrapper/platform`에
로컬 작업 데이터를 저장합니다. 최초 시작에 두 번째 디스크, USB,
클라우드 볼륨 또는 Seed 백업은 필요하지 않습니다.
Unix 소유권과 파일시스템 동작을 사용할 수 있도록 WSL 데이터는
`/mnt/c` 같은 Windows 마운트 경로 대신 Linux 파일시스템 안에 보관하세요.

릴리스 설치 프로그램과 수명 주기 도구가 공유할 root 소유의 저장소 선택자를 만드세요.
이 예시는 기본 로컬 작업 디렉터리를 선택합니다.

```bash
sudo install -d -m 0700 /etc/system-bootstrapper
sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<'EOF'
PERSISTENCE_MODE=local
PERSISTENT_MOUNT=/
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
EOF
sudo chmod 0600 /etc/system-bootstrapper/persistence.env
```

네이티브 수명 주기는 선택자 없이도 기본 로컬 저장소를 지원하지만
이 안내서는 명시적인 선택자를 사용합니다.
`PERSISTENT_MOUNT`가 있고 모드가 없는 기존 선택자는 볼륨 의미를 유지하며,
필수 볼륨이 없을 때 로컬 저장소로 대체하지 않습니다.
기존 구성을 변경하기 전에 [영구 저장소 안내서](PERSISTENT_VOLUME.md)를 읽으세요.
Harvest 또는 Seed 복원을 사용하려면 독립적인 백업 저장소를 설정하세요.
일반 운영과 인증서 갱신에는 백업 매체가 필요하지 않습니다.

그런 다음 프로젝트 루트 디렉터리에서 다음 명령을 실행하세요.

```bash
sudo env GITLAB_SSH_BIND=127.0.0.1:2222 GITLAB_REGISTRY_BIND=127.0.0.1:5050 \
  /opt/system-bootstrapper-runtime/bin/node operations/dist/cli.js install --checkout "$PWD" \
  --controller "$CONTROLLER_RELEASE" --wizard "$WIZARD_RELEASE" \
  --persistence-env /etc/system-bootstrapper/persistence.env
```

설치 프로그램에는 컨트롤러 릴리스와 고정된 Wizard 커밋에 일치하는 깨끗한 소스가 필요합니다.
기존 GitLab 데이터나 저장된 주 설정이 있으면 거부하므로 기존 설치에는 교체/복구 절차를 사용하세요.
선택한 공개 이미지를 비공개 작업 설정 디렉터리에 기록하고 빌드를 비활성화하여 시작합니다.
이후 정상 시작은 해당 릴리스 프로필을 재사용하며,
저장된 주 설정에 명시된 이미지 선택자가 우선합니다.

Bootstrapper는 먼저 Wizard와 Sync 접속점을 시작합니다.
이 단계에서 GitLab 설정은 완료되지 않았습니다.
이미지 다운로드와 이후 GitLab 초기화에는 여전히 시간이 걸립니다.
공개 릴리스는 소스 빌드를 없애지만 서비스 시작 시간까지 없애지는 않습니다.

컨테이너와 시작 출력을 확인하세요.

```bash
sudo docker ps
sudo docker logs system_bootstrapper_1
```

플랫폼을 사용하는 동안 **WSL의 Ubuntu 콘솔을 열어 두세요**.
실행 중인 systemd 서비스만으로는 WSL 인스턴스가 유지되지 않습니다.

### 0.4 서명, 서버 주소 및 실제 인증 정보 찾기

Bootstrapper 출력에 원래 System Cube와 수신 주소가 표시됩니다.

```text
server listening on http://<internal-container-ip>:8071
Sync authentication is configured.
```

인증 정보는 로그에 출력되지 않습니다.
최초 시작 시 생성한 인증 정보는 `PERSISTENT_DIR/configuration/sync-auth.env`에 비공개로 저장합니다.
주 설정이 생기면 해당 `SYNC_USER`와 `SYNC_PASS`가 초기 값보다 우선합니다.

사용자의 Docker 호스트에서 다음 명령을 로컬로 실행하여 활성 Sync 사용자 이름과 비밀번호만 표시하세요.
시작 시와 같은 우선순위를 사용합니다.

```bash
sudo bash -c '
  set -euo pipefail
  PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
  if [[ -f /etc/system-bootstrapper/persistence.env ]]; then
    source /etc/system-bootstrapper/persistence.env
  fi
  source "$PERSISTENT_DIR/configuration/sync-auth.env"
  if [[ -f "$PERSISTENT_DIR/configuration/.docker.env" ]]; then
    source "$PERSISTENT_DIR/configuration/.docker.env"
  fi
  printf "Username: %s\nPassword: %s\n" "$SYNC_USER" "$SYNC_PASS"
'
```

출력된 값을 연결 대화상자에 입력하고 터미널 출력을 비공개로 유지하세요.
시작할 때 사용자 지정 `PERSISTENCE_ENV_FILE`을 선택했다면 명령에서도 해당 선택자 파일을 사용하세요.
스크린샷과 자리표시자는 사용자 설치의 유효한 인증 정보를 제공하지 않습니다.

표시된 컨테이너 IP와 포트 `8071`은 내부 Node 주소입니다.
로컬 최초 시작 시 브라우저에서는 **`http://localhost/sync`**로 Sync에 접근하세요.
NGINX가 이 주소를 Node 서비스로 전달합니다.
내부 IP는 컨테이너를 다시 시작할 때마다 바뀔 수 있습니다.

### 0.5 브라우저에서 Wizard 열기

[http://localhost/](http://localhost/)를 여세요.

**개요**에는 간단한 프로젝트 소개, **작동 방식** 카드 및 **빠른 설치**가 표시됩니다.
설치 버튼은 호스트 터미널에서 실행할 명령으로 스크롤합니다.
상단 **Wizard** 탭을 선택하면 아래의 설정 작업 공간으로 이동합니다.
개요, Wizard 및 하단 법적 정보 페이지 간 이동은 연결과 보내지 않은 양식 값을 유지합니다.
브라우저를 새로고침하면 이 로컬 상태는 초기화됩니다.

![플랫폼 소개와 빠른 설치가 있는 개요](images/getting-started/00-overview.png)

이전 버전이 이미 열려 있다면 페이지를 새로고침하세요.
인터페이스가 오래되어 보이면 **Ctrl+F5**를 사용하세요.
브라우저 캐시에 이전 버전이 남아 있을 수 있습니다.

![연결 전 Wizard: 오른쪽 위의 연필 아이콘과 연결 버튼](images/getting-started/01-wizard-start.png)

설정을 불러오기 전 양식에는 예시 값이 있을 수 있습니다.
해당 주소로 GitLab 설정이 이미 완료되었다는 의미는 아닙니다.
아직 보내기나 Seed를 누르지 마세요.

### 0.6 먼저 수정 열기 및 연결 정보 입력

**연결 바로 왼쪽의 연필 아이콘**을 누르세요.
입력 필드 세 개가 있는 **연결** 대화상자가 열립니다.

![서버 주소와 비어 있는 사용자 이름 및 비밀번호를 보여 주는 수정 대화상자](images/getting-started/03-edit-connection.png)

다음을 입력하세요.

| 수정 대화상자의 필드 | 값의 출처 |
| --- | --- |
| **서버 주소** | 로컬 최초 시작의 경우: `http://localhost/sync` |
| **사용자 이름** | 0.4절의 비공개 로컬 명령으로 표시한 활성 Sync 사용자 이름 |
| **비밀번호** | 같은 명령으로 표시한 활성 Sync 비밀번호 |

**이 인증 정보는 사용자 자신의 영구 설정에서 가져옵니다.**
GitLab 인증 정보와 별개입니다. 스크린샷에서 복사하지 마세요.

### 0.7 세 필드 입력 후 연결

세 필드를 모두 채운 뒤 **적용**으로 대화상자를 확인하세요.
이 버튼으로 로그인하므로 이후 연결을 다시 누를 필요는 없습니다.

주 화면의 연결 버튼은 이미 저장된 연결 설정을 사용하는 바로가기입니다.
최초 로그인에는 위에서 설명한 수정 대화상자를 사용하세요.

![연결 성공: 서버 주소, 연결 해제 및 동기화가 표시됨](images/getting-started/04-connected.png)

서버 주소, 녹색 점, 색상이 바뀐 **연결 해제** 버튼 및 추가된 **동기화** 메뉴는
Bootstrapper 인스턴스 연결에 성공했음을 나타냅니다.

### 0.8 가져오기로 설정 불러오기

**동기화**를 열고 **가져오기**를 선택하세요.

![가져오기 항목이 있는 동기화 메뉴](images/getting-started/05-fetch-menu.png)

두 가지 경우가 있습니다.

- **인스턴스에 저장된 설정이 있는 경우:** 가져오기는 정확한 저장 설정과 기존 프로젝트를 Wizard에 불러옵니다.
- **주 설정을 아직 전송하지 않은 경우:** 현재 버전은 연결된 Bootstrapper에서
  자동 도출한 제안을 요청하여 양식에 불러옵니다.

![가져오기 후 최초 시작: 별표가 붙은 제안 로컬 호스트 이름](images/getting-started/06-derived-settings.png)

**별표**는 자동 도출한 값을 나타냅니다. 마우스를 올리거나 Tab 키로 포커스를 맞추세요.
도움말은 출처를 설명하고 전송 전에 값을 확인하도록 안내합니다.

![자동 도출한 데이터를 확인해야 한다고 설명하는 별표 도움말](images/getting-started/07-derived-tooltip.png)

제안을 도출할 때 기존 NGINX 경로를 우선합니다.
그 외에는 연결 주소에서 호스트 이름을 제안할 수 있습니다.
제안은 DNS를 설정하거나 인증서 존재를 증명하지 않습니다.
알 수 없는 값은 비워 두며 비밀번호와 Runner 토큰을 추측하지 않습니다.

가져오기는 서버에 새 설정을 쓰지 않지만 브라우저 양식의 값을 교체합니다.
보내지 않은 변경 사항을 보존하려면 먼저 백업하세요.

### 0.9 로컬 테스트용 제안 완성

일반 아래의 **시작**, **SSL**, **Sync**, **Wizard** 영역을 확인하세요.

| 설정 | 로컬 테스트 값 |
| --- | --- |
| `SEED_DIR` | 선택적인 독립 백업 대상. Seed 저장소를 선택할 때까지 비워 두세요 |
| `GITLAB_HOST` | `gitlab.localhost` |
| `GITLAB_REGISTRY_HOST` | `registry.localhost` |
| GitLab Runner | 처음에는 `0`. GitLab에 로그인한 뒤 Runner를 설정하세요 |
| SSL 아래의 GitLab 및 레지스트리 | **기본값, HTTP** |
| 동기화 서버 활성화 | 활성화 |
| `SYNC_HOST` | `sync.localhost` |
| `SYNC_USER` 및 `SYNC_PASS` | 이후 연결에 사용할 인증 정보를 직접 선택하고 기억하세요 |
| Sync 모드 | **기본값, HTTP** |
| Wizard 활성화 | 활성화 |
| `WIZARD_HOST` | `localhost` |
| Wizard 모드 | **기본값, HTTP** |

Seed 경로는 Docker 호스트의 백업 대상이며 운영 작업 디렉터리가 아닙니다.
최초 시작은 자동으로 복원하지 않습니다.
외부 백업 대상은 명시적 Harvest 또는 Seed 작업 중에만 필요합니다.
사용하기 전에 호스트 선택자에 마운트/식별 정보를 설정하세요.

#### 공개 웹사이트 및 운영자 정보

**일반 → 웹사이트**에서 하단의 **운영자 정보** 및 **개인정보 보호** 페이지에 표시할 정보를 검토하세요.
운영자 이름, 우편 주소 및 연락처 이메일은 **Max Mustermann**,
**Musterstraße 1, 12345 Musterstadt, Deutschland**, **kontakt@example.com**이라는 예시로 시작합니다.
입력 자리표시자일 뿐 아니라 실제 양식 값이므로 자신의 공개 정보로 바꾸거나 지우세요.
공개 페이지는 변경되지 않은 예시를 예시로 표시합니다.
명시적으로 지운 필드는 비어 있는 상태를 유지하며, 이전 설정에 없는 필드에는 초기 설정 예시를 넣습니다.

![공개 운영자 예시와 선택적 개인정보 필드가 있는 웹사이트 설정](images/getting-started/08-website-settings.png)

선택 필드에는 추가 개인정보 처리방침 링크, 실제 배포에서 사용하는 접속 로그 보관 기간 및
추가 개인정보 안내문을 입력할 수 있습니다.
보관 기간 설명은 로그 기록이나 순환 방식을 변경하지 않습니다.
여섯 필드 모두 공개되므로 비밀번호, 토큰 또는 기타 기밀 정보를 넣지 마세요.

**백업**, **열기**, **가져오기**, **보내기**에는 이 설정이 포함됩니다.
보내기가 성공하면 이미지 재빌드나 CI 파이프라인 없이 정상 플랫폼 다시 시작을 통해 적용됩니다.
시작 시 전용 영구 저장소의 `privacy-instance.json`에 공개 문자열 여섯 개만 기록합니다.
Wizard는 인증된 Sync 설정을 가져오지 않고 공개된 이 파일을 읽습니다.

### 0.10 설정 백업, 전송 및 적용

1. **백업 → bootstrapper.json → 다운로드**로 수정 가능한 설정을 저장하거나,
   JSON과 생성된 환경 파일을 함께 받으려면 **백업 → bootstrapper.zip**을 선택하세요.
   둘 다 인증 정보를 포함하므로 비공개로 보관하세요.
2. **동기화 → 보내기**를 선택하고 전송을 확인하세요.
   Wizard 설정을 인스턴스로 보냅니다. 표시된 서비스 영향을 확인하세요. 기존
   애플리케이션 라우팅은 GitLab을 유지하며 프록시를 다시 로드하고 더 넓은 변경은 서비스를 재시작합니다.
   서비스가 시작되는 동안 인터페이스를 일시적으로 사용할 수 없습니다.
3. 인터페이스가 돌아올 때까지 기다린 뒤 다시 연결하고 가져오기로 설정을 검증하세요.

**보내기는 설정을 전송하고 적용합니다. 다시 시작 버튼을 별도로 누를 필요는 없습니다.**
열기는 이전에 다운로드한 JSON 파일을 Wizard에 불러옵니다.
파일을 불러오는 것만으로 서버 설정이 바뀌지는 않습니다.

### 0.11 GitLab 열기 및 최초 로그인

GitLab 최초 시작에는 몇 분이 걸릴 수 있습니다. Ubuntu에서 상태를 확인하세요.

```bash
sudo docker ps
```

GitLab 컨테이너는 최종적으로 `healthy`를 보고해야 합니다.
그런 다음 [http://gitlab.localhost/](http://gitlab.localhost/)를 여세요.

GitLab 관리자 사용자 이름은 **`root`**입니다.
새 데이터베이스에는 Bootstrapper가 무작위 초기 비밀번호를 생성합니다.
완전한 비공개 설정을 미리 준비한 설치라면 GitLab 최초 시작 전에
`GITLAB_INITIAL_ROOT_PASSWORD`를 12자 이상으로
`PERSISTENT_DIR/configuration/.docker.env`에 설정할 수도 있습니다.
Wizard에는 이 선택 값의 전용 필드가 없습니다.

최초 시작 후 로컬에서 초기 비밀번호를 읽으세요.

```bash
sudo docker exec system_gitlab_1 cat /etc/gitlab/bootstrapper_initial_root_password
```

root만 읽을 수 있는 이 파일은 GitLab의 영구 설정 볼륨에 저장되며 다시 시작해도 유지됩니다.
`root`로 로그인하고 인증 정보를 비공개로 보관하세요.
파일은 초기 비밀번호를 기록하며 나중의 비밀번호 변경은 반영되지 않습니다.
Harvest는 GitLab 설정 볼륨을 통해 이 파일도 Seed에 포함하므로 Seed도 비공개로 유지하세요.

기존 데이터베이스는 변경하지 않습니다.
이 방식 없이 설정된 경우 추정 로그인 비밀번호를 담은 파일을 나중에 생성하지 않습니다.
GitLab의 원래 임시 파일이 남아 있다면 확인할 수 있습니다.

```bash
sudo docker exec system_gitlab_1 grep 'Password:' /etc/gitlab/initial_root_password
```

GitLab은 24시간 이후 컨테이너를 다시 시작할 때 원래 임시 파일을 제거할 수 있습니다.
유효한 비밀번호를 모르면 대상 GitLab 비밀번호 재설정이 필요합니다.
Sync 인증 정보는 GitLab 로그인과 별개입니다.

### 0.12 나중에 다시 연결 및 설정 변경

[http://localhost/](http://localhost/)에서 Wizard를 다시 여세요.
위 설정을 완료한 뒤에는 Sync 주소가 **`http://sync.localhost`**가 되어
최초 시작의 `/sync` 경로를 대체합니다.

수정 대화상자와 0.9절에서 선택한 Sync 인증 정보를 사용하세요.
**동기화 → 가져오기**로 저장된 설정을 불러오세요.
설정을 바꾸고 로컬 백업을 저장한 뒤 보내기로 적용할 수 있으며 자동으로 다시 시작합니다.

공개 사용에는 사용자의 DNS, HTTPS 인증서 및 호스트 인증서 갱신을 설정하세요.
데이터베이스 재사용이나 영구 저장소 이동에는 별도의 [복구 절차](RECOVERY_CONTRACT.md)가 필요합니다.
