## 공개 서버: 자체 도메인 및 HTTPS

이 경로는 sudo 권한, 충분한 로컬 디스크 및 관리 권한이 있는 도메인을 갖춘
Ubuntu 24.04 LTS 서버에 **새 플랫폼**을 설치합니다.
명시적으로 마운트한 운영 볼륨은 선택 사항입니다.
GitLab 데이터를 재사용하려면 대신 [교체 호스트 절차](#replace-a-host-while-retaining-its-data-volume)를 따르세요.
GitLab과 실행할 Runner 작업을 위한 메모리, CPU 및 디스크를 할당하세요.
Docker 설치 검사는 해당 자원이 충분함을 입증하지 않습니다.

예시는 Wizard에 `www.example.com`, Sync에 `sync.example.com`,
GitLab에 `gitlab.example.com`, 레지스트리에 `registry.example.com`을 사용합니다.
전체 안내에서 이름, 서버 주소, 관리자 계정 및 연락처 이메일을 바꾸세요.
이 예시는 기본 도메인인 `example.com`에 서비스를 설정하지 않습니다.
인증서를 받는 것만으로 별칭 라우팅이 생기지는 않습니다.

### 공개 1. DNS, 포트 및 호스트 준비

DNS 제공자에서 다음 레코드를 만드세요. `203.0.113.10`은 문서용 주소이므로
서버의 실제 공개 IPv4 주소로 바꾸세요.

| DNS 이름 | 유형 | 값 |
| --- | --- | --- |
| `www.example.com` | A | `203.0.113.10` |
| `sync.example.com` | A | `203.0.113.10` |
| `gitlab.example.com` | A | `203.0.113.10` |
| `registry.example.com` | A | `203.0.113.10` |

서버가 실제로 이 이름들을 IPv6로 제공할 때만 AAAA 레코드를 게시하세요.
인증서 요청 전에 오래된 IPv6 레코드를 제거하세요.
서버 외부 컴퓨터에서 예를 들어 `dig +short A NAME`과
`dig +short AAAA NAME`으로 네 이름을 모두 확인하세요.
이 호스트로 해석되어야 하며 다음 단계 전에 DNS 변경이 전파될 시간을 주세요.

새 서버의 **제공자 외부 방화벽**을 설정하세요.

| 수신 트래픽 | 최초 인증서 발급 | 최초 Wizard 설정 | HTTPS 설치 완료 후 |
| --- | --- | --- | --- |
| SSH 포트, 일반적으로 TCP 22 | 관리 주소에서 허용 | 허용 유지 | 허용 유지 |
| TCP 80 | HTTP-01용으로 공개 허용 | 공개 접근 차단 | 리디렉션 및 HTTP-01 갱신용으로 공개 허용 |
| TCP 443 | 차단 유지 | HTTPS 설정까지 차단 유지 | 공개 허용 |
| TCP 8071, 5050 및 2222 | 공개 규칙 불필요 | 공개 규칙 불필요 | 이 예시에서는 공개 규칙 불필요 |

호스트 방화벽에도 같은 제한을 적용하세요. 규칙을 변경하는 동안 작동 중인 SSH 세션을 열어 두세요.
이후 SSH 터널은 브라우저 연결을 보호하지만 Bootstrapper의 80번 포트 수신을 제한하지는 **않습니다**.
따라서 임시 HTTP 설정 중에는 외부 규칙이 필요합니다.
Docker가 공개한 브리지 포트는 UFW의 일반 INPUT 규칙을 우회하므로 별도로 주의해야 합니다.
선택적인 [SSH 포트 분리](#public-7-separate-administrative-and-gitlab-ssh) 절차에서 이 경계를 설명합니다.
이 최초 시작 예시는 GitLab SSH와 직접 레지스트리 포트를 루프백에 둡니다.

SSH로 연결하여 서버에서 다음 명령을 실행하세요.

```bash
sudo apt-get update
sudo apt-get install -y git certbot dnsutils openssl
certbot --version
SYSTEM_REVISION='REPLACE_WITH_40_CHARACTER_RELEASE_COMMIT'
git clone https://github.com/kihyoun/system.git
cd system
git checkout --detach "$SYSTEM_REVISION"
git submodule update --init --recursive
CONTROLLER_RELEASE='docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST'
WIZARD_RELEASE='docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST'
sudo bash bootstrapper/install.sh
```

[공개 릴리스 선택](../Prepare-Host.md#install-a-tested-public-release)에 따라
하나의 승인 릴리스에서 소스 리비전과 두 공개 이미지 다이제스트를 선택하세요.
검증되지 않은 브랜치, 런타임 기본 이미지 또는 유동적인 `latest` 태그를 사용하지 마세요.
새 호스트는 이미지를 로컬에서 빌드하는 대신 전체 컨트롤러와 Wizard를 다운로드합니다.

`reconfigure`를 지원하는 Certbot **2.3.0 이상**을 사용하세요.
Ubuntu 24.04 [패키지는 이 인터페이스를 제공합니다](https://packages.ubuntu.com/noble/certbot).
아래 호스트 통합은 `/usr/bin/certbot`과 `certbot.timer`를 호출하므로
별도 Snap 설치 대신 배포판 패키지를 사용합니다.
`bootstrapper/prepare-local.sh`를 실행하지 마세요.
공개 DNS와 신뢰할 수 있는 HTTPS 레지스트리가 로컬 hosts 파일과 비보안 레지스트리 변경을 대체합니다.

### 공개 2. 작업 저장소 선택 및 인증서 통합 설치

이 새 설치는 서버 시스템 디스크에 운영 데이터를 저장합니다.
인증서 통합과 수명 주기 도구가 같은 작업 디렉터리를 공유하도록 명시적인 선택자를 만드세요.

```bash
sudo install -d -m 0700 /etc/system-bootstrapper
sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<'EOF'
PERSISTENCE_MODE=local
PERSISTENT_MOUNT=/
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
EOF
sudo chmod 0600 /etc/system-bootstrapper/persistence.env
sudo bash bootstrapper/install-volume-host.sh
sudo systemctl stop certbot.timer
```

호환성을 위한 이름과 달리 `install-volume-host.sh`는 로컬 저장소도 지원합니다.
작업 저장소를 검증하고 `/etc/letsencrypt`를
`PERSISTENT_DIR/host/letsencrypt`에 연결하며 `system-certbot` 잠금 래퍼와 인증서 배포 훅을 설치합니다.
외부 Seed 대상을 Docker 또는 갱신의 의존성으로 추가하지 않습니다.
인증서 상태를 삭제하지 말고 충돌하는 활성 Certbot 트리를 정리하세요.
아래에서 갱신 방식을 변경하는 동안 타이머를 일시 중지합니다.

운영 데이터를 볼륨에 두려면 `PERSISTENCE_MODE=volume`과
[영구 저장소 안내서](PERSISTENT_VOLUME.md)의 실제 마운트 지점/UUID를 사용하세요.
기존 볼륨을 포맷하지 마세요. 선택한 운영 볼륨이 없으면 시작이 차단됩니다.

### 공개 3. 플랫폼 시작 전에 첫 인증서 받기

이 시점에는 **호스트 포트 80을 점유하는 것이 없어야 합니다**.
`sudo ss -ltnp`를 확인하고 기존 호스트 웹 서버나 컨테이너를 의도적으로 처리하세요.
이 단계에서는 공개 TCP 80을 열어 두세요.
그러면 Certbot 독립 서버가 NGINX나 인증서 없이도 HTTP-01에 응답할 수 있습니다.

```bash
sudo system-certbot certonly --standalone --non-interactive --agree-tos \
  --email YOUR_CONTACT_EMAIL --cert-name example.com \
  -d www.example.com -d sync.example.com \
  -d gitlab.example.com -d registry.example.com
sudo system-certbot certificates --cert-name example.com
sudo env RENEWED_LINEAGE=/etc/letsencrypt/live/example.com \
  /usr/local/sbin/system-install-certificate
```

실제 연락처 이메일을 사용하세요. 인증서는 서비스 이름 네 개를 모두 포함해야 하며
스테이징 인증서 대신 운영 CA에서 발급되어야 합니다.
발급에 실패하면 재시도 전에 DNS/AAAA, TCP 80 도달 가능 여부 및 포트 점유를 확인하세요.
라우팅을 진단하려고 인증서를 반복 요청하지 마세요.

`--cert-name example.com`은 계보 디렉터리 이름을 고정할 뿐 기본 도메인을 인증서에 추가하지 않습니다.
설치된 배포 훅은 인증서와 비공개 키를 `PERSISTENT_DIR/ssl/live/example.com/`으로 복사합니다.
명시적 명령은 프록시가 생기기 전에도 첫 복사본을 준비합니다.

| 용도 | 경로 |
| --- | --- |
| 전체 보존 Certbot 상태 | `PERSISTENT_DIR/host/letsencrypt/`, 호스트에는 `/etc/letsencrypt`로 노출 |
| 호스트 원본 인증서 및 키 | `/etc/letsencrypt/live/example.com/fullchain.pem` 및 `privkey.pem` |
| 데이터 볼륨에 배포된 복사본 | `PERSISTENT_DIR/ssl/live/example.com/fullchain.pem` 및 `privkey.pem` |
| NGINX 내부에서 Wizard에 입력할 경로 | `/ssl/live/example.com/fullchain.pem` 및 `/ssl/live/example.com/privkey.pem` |

`archive`, 계정 및 갱신 상태를 포함한 Certbot 트리 전체를 보관하세요.
`live` 심볼릭 링크만 복사하면 충분하지 않습니다.
Wizard는 인증서를 발급하지 않으며 NGINX는 호스트의 `/etc/letsencrypt` 경로를 직접 읽지 않습니다.

### 공개 4. SSH 터널로 최초 시작 설정

**Bootstrapper를 시작하기 전에 제공자 방화벽에서 공개 TCP 80을 다시 차단하세요.**
TCP 443도 아직 차단해 두세요. 서버의 프로젝트 디렉터리에서 새 설치를 시작하세요.

```bash
sudo env GITLAB_SSH_BIND=127.0.0.1:2222 GITLAB_REGISTRY_BIND=127.0.0.1:5050 \
  python3 bootstrapper/install-release.py \
  --controller "$CONTROLLER_RELEASE" --wizard "$WIZARD_RELEASE" \
  --persistence-env /etc/system-bootstrapper/persistence.env
sudo docker ps
sudo docker logs system_bootstrapper_1
```

설치 프로그램은 소스, 정확한 컨트롤러 및 일치하는 Wizard를 검증하고 공개 이미지를 다운로드하여
소스 빌드 없이 시작합니다. 새 설치 검사는 기존 GitLab 데이터나 주 설정을 거부합니다.
공개 릴리스는 기존 데이터베이스를 다른 GitLab 버전으로 변경할 권한을 부여하지 않습니다.
해당 전환에는 업그레이드 절차를 사용하세요.
GitLab SSH는 루프백 포트 2222를 유지하므로 호스트 관리 포트를 점유하지 않습니다.
레지스트리 클라이언트는 443번 포트의 HTTPS 이름을 사용하며 직접 호스트 포트 5050은 비공개로 유지됩니다.

**사용자 자신의 컴퓨터**에서 터미널을 하나 더 열고 이 터널을 계속 실행하세요.

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8080:127.0.0.1:80 ADMIN_USER@SERVER_IP
```

사용자의 SSH 계정, 서버 주소 및 필요한 경우 `-p PORT`를 사용하세요.
`http://localhost:8080/`를 열고 **Wizard**를 선택한 다음 연필/수정 대화상자의
서버 주소에 **`http://localhost:8080/sync`**를 입력하세요.
[0.4절](#04-find-the-signature-server-address-and-actual-credentials)의 비공개 명령으로
서버에서 생성된 Sync 인증 정보를 읽으세요.
연결을 적용하고 **동기화 → 가져오기**를 선택하세요.
새 인스턴스의 가져오기는 제안을 반환하므로 확인하고 다음 표의 값으로 바꾸세요.

| 영역 / Wizard 필드 | 공개 예시 값 |
| --- | --- |
| 일반 → 시작: `SEED_DIR` | 별도 Seed 백업 대상을 선택할 때까지 비워 두기 |
| 일반 → 시작: `GITLAB_HOST` | `gitlab.example.com` |
| 일반 → 시작: `GITLAB_REGISTRY_HOST` | `registry.example.com` |
| 일반 → 시작: GitLab Runner / Runner 인증 토큰 | 처음에는 `0` / 비어 있음. GitLab이 정상화된 후 등록 |
| 일반 → SSL: `GITLAB_DOMAIN_MODE`, `GITLAB_REGISTRY_DOMAIN_MODE` | 둘 다 **SSL 암호화**, 값 `2` |
| 일반 → SSL: `GITLAB_SSL`, `GITLAB_REGISTRY_SSL` | 둘 다 `/ssl/live/example.com/fullchain.pem` |
| 일반 → SSL: `GITLAB_SSL_KEY`, `GITLAB_REGISTRY_SSL_KEY` | 둘 다 `/ssl/live/example.com/privkey.pem` |
| 일반 → Sync: 동기화 서버 활성화 / `SYNC_HOST` | 활성화 / `sync.example.com` |
| 일반 → Sync: `SYNC_USER`, `SYNC_PASS` | 기본값이 아닌 사용자 이름 및 강력한 비밀번호 |
| 일반 → Sync: `SYNC_DOMAIN_MODE` | **SSL 암호화**, 값 `2` |
| 일반 → Sync: `SYNC_SSL`, `SYNC_SSL_KEY` | `/ssl/live/example.com/fullchain.pem`, `/ssl/live/example.com/privkey.pem` |
| 일반 → Wizard: Wizard 활성화 / `WIZARD_HOST` | 활성화 / `www.example.com` |
| 일반 → Wizard: `WIZARD_DOMAIN_MODE` | **SSL 암호화**, 값 `2` |
| 일반 → Wizard: `WIZARD_SSL`, `WIZARD_SSL_KEY` | `/ssl/live/example.com/fullchain.pem`, `/ssl/live/example.com/privkey.pem` |

`example.com` 같은 추가 이름을 이 Wizard로 리디렉션하려면
[기준 Wizard 별칭](WIZARD_ALIASES.md)을 설정하세요.
각 별칭이 이 프록시를 가리키도록 하고 선택한 인증서에 포함하세요.
별칭은 명시적으로 저장하는 설정입니다.
`www.example.com`만 선택해도 기본 도메인 리디렉션이 생기지는 않습니다.
보내기 후 경로와 쿼리를 포함하여 HTTP와 HTTPS를 모두 검사하세요.

필드에는 `/ssl`을 포함한 **전체 컨테이너 경로**가 필요합니다.
입력 옆에 표시되는 경로 장식은 이 접두사를 대체하지 않습니다.
`*_HOST` 필드에는 스킴 없는 호스트 이름을 사용하세요.
생성되는 GitLab 및 레지스트리 외부 URL은 `https://gitlab.example.com`과
`https://registry.example.com`이어야 하며 `:5050`을 넣으면 안 됩니다.
과거의 `system/.docker.env.example`에는 `/live/...` 경로가 있으며 `/ssl` 마운트 접두사가 없습니다.
HTTP 모드에서는 비활성이지만 HTTPS를 활성화할 때 그대로 복사하면 안 됩니다.
**일반 → 웹사이트**를 검토하고 사이트 공개 전에 운영자 예시를 바꾸세요.

**백업 → bootstrapper.json** 또는 **bootstrapper.zip**을 비공개로 저장한 뒤
**동기화 → 보내기**를 실행하세요.
성공하면 설정을 적용하고 플랫폼을 다시 시작합니다.
설정된 HTTPS 라우팅이 적용되면서 임시 `/sync` 터널 엔드포인트는 작동을 멈춥니다.
새 설치를 위해 Seed를 실행하지 마세요.

### 공개 5. HTTPS 검사 후 공개 트래픽 허용

서비스가 시작되는 동안 SSH 접근과 외부 제한을 유지하세요. 서버에서 실행하세요.

```bash
sudo docker ps
sudo docker exec system_web_1 nginx -t
curl --resolve www.example.com:443:127.0.0.1 -I https://www.example.com/
curl --resolve gitlab.example.com:443:127.0.0.1 -I https://gitlab.example.com/users/sign_in
curl --resolve registry.example.com:443:127.0.0.1 -I https://registry.example.com/v2/
```

GitLab이 `healthy`를 보고할 때까지 기다리세요.
Wizard는 HTTP 200을 반환해야 하고 GitLab 로그인 페이지에 접근할 수 있어야 합니다.
인증되지 않은 레지스트리 요청은 일반적으로 인증 챌린지가 포함된 HTTP 401을 반환합니다.
`curl -k`를 사용하지 마세요. 호스트 이름 불일치나 신뢰할 수 없는 인증서는 수정해야 합니다.

이제 제공자 및 호스트 방화벽에서 **공개 TCP 80과 443**을 허용하세요.
사용자 컴퓨터에서 `https://www.example.com/`를 여세요.
저장한 Sync 인증 정보로 Wizard를 **`https://sync.example.com`**에 연결하고
가져오기로 저장된 호스트 이름, 모드 및 프로젝트를 확인하세요.
서비스 이름 네 개의 HTTP 요청은 HTTPS로 리디렉션되어야 하며,
HTTP-01 챌린지 파일은 포트 80에서 계속 접근 가능해야 합니다.
더 이상 필요하지 않으면 임시 SSH 터널을 닫으세요.

[0.11절](#011-open-gitlab-and-sign-in-for-the-first-time)에 따라
서버에서 초기 GitLab `root` 비밀번호를 읽고,
`https://gitlab.example.com/`에 로그인하여 변경하세요.
Runner는 공개 Wizard 및 Sync URL로 [2장](#2-setting-up-gitlab-runners)을 따르세요.
수량을 `1`로 설정하고 토큰은 비운 채 보내기를 실행한 뒤 등록을 기다리고
**Admin → CI/CD → Runners**에서 온라인 관리자를 확인하세요.
이 예시의 Git 복제와 레지스트리 접근은 HTTPS를 사용합니다.
GitLab SSH를 공개하려면 별도로 의도적인 포트 및 방화벽 설정이 필요합니다.
HTTPS와 갱신 설정을 끝낸 뒤 [공개 7](#public-7-separate-administrative-and-gitlab-ssh)을 참조하세요.

### 공개 6. 무인 갱신을 실행 중인 프록시로 전환

최초 발급은 인증 방식으로 **standalone**을 저장합니다.
이대로 두면 이후 갱신 시 NGINX와 포트 80을 두고 충돌합니다.
현재 모드 2 프록시는 공유 웹 루트에서 HTTP-01을 제공합니다.
초기 시작 프록시는 설정된 각 호스트에 이 경로를 제공하지 않습니다.
현재 일반 HTTP 경로도 공유 웹 루트를 제공하므로 기존 애플리케이션은 HTTPS로
전환하기 전에 인증서를 발급받을 수 있습니다. 독립된 애플리케이션 계보와 브라우저
데이터에 대한 고려 사항은 [애플리케이션 HTTPS 절차](PROJECT_BOOTSTRAP_GUIDE.md#give-an-application-a-trusted-https-hostname)를 참조하세요.

서버에서 실제 웹 루트에 무해한 확인 파일을 만드세요.

```bash
sudo bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  chmod 0711 "$PERSISTENT_DIR/ssl"
  install -d -m 0755 "$PERSISTENT_DIR/ssl/acme-http01" \
    "$PERSISTENT_DIR/ssl/acme-http01/.well-known" \
    "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge"
  printf "%s\n" bootstrapper-acme-check > "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/bootstrapper-check"
  chmod 0644 "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/bootstrapper-check"
'
```

네이티브 저장소 준비는 마운트된 `/ssl` 루트에 탐색 권한을 추가하고 공개 ACME 웹 루트를 만듭니다.
이 확인 명령은 공개 챌린지 하위 디렉터리와 토큰도 만들지만
`ssl/live` 계보 디렉터리와 비공개 키 권한은 변경하지 않습니다.
인증서 트리에 재귀적으로 권한 변경을 적용하지 마세요.

서버 **외부**에서 `http://www.example.com/.well-known/acme-challenge/bootstrapper-check`를 요청하고
`sync`, `gitlab`, `registry`에도 반복하세요.
네 호스트 모두 리디렉션 없이 HTTP 200으로 `bootstrapper-acme-check`를 반환해야 합니다.
예:

```bash
for name in www sync gitlab registry; do
  curl --fail --silent --show-error "http://$name.example.com/.well-known/acme-challenge/bootstrapper-check"
done
```

설정한 모든 Wizard 별칭에도 같은 챌린지 검사를 반복하세요.
일반 리디렉션을 적용하더라도 HTTP-01 챌린지 경로에는 직접 접근할 수 있어야 합니다.

확인에 성공하면 서버에서 실행하세요.

```bash
sudo bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  /usr/local/sbin/system-certbot reconfigure --cert-name example.com \
    --authenticator webroot --webroot-path "$PERSISTENT_DIR/ssl/acme-http01"
  /usr/local/sbin/system-certbot renew --cert-name example.com --dry-run --run-deploy-hooks
  RENEWED_LINEAGE=/etc/letsencrypt/live/example.com /usr/local/sbin/system-install-certificate
  cmp /etc/letsencrypt/live/example.com/fullchain.pem "$PERSISTENT_DIR/ssl/live/example.com/fullchain.pem"
  cmp /etc/letsencrypt/live/example.com/privkey.pem "$PERSISTENT_DIR/ssl/live/example.com/privkey.pem"
  docker exec system_web_1 nginx -t
  curl --fail --silent --show-error --output /dev/null \
    --resolve www.example.com:443:127.0.0.1 https://www.example.com/
  rm "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/bootstrapper-check"
  systemctl enable --now certbot.timer
'
systemctl list-timers certbot.timer
```

`reconfigure`는 CA 스테이징 서비스로 검사한 뒤 성공한 웹 루트 방식을 다음 갱신용으로 저장합니다.
`install-volume-host.sh`는 복구 시 기존 **webroot** 경로를 다시 연결하지만,
standalone 계보를 웹 루트 갱신으로 변환하지는 않습니다.
재설정 또는 시험 실행이 실패하면 설정을 완료하지 마세요.
잠금이 활성/중단된 갱신이나 Harvest를 보고하면 실행 중일 수 있는 잠금을 삭제하는 대신 소유 작업을 해결하세요.

위 시험 실행은 스테이징 인증서 대신 **활성 신뢰 인증서**로 배포 훅을 명시적으로 실행합니다.
훅은 갱신 파일을 복사하고 `nginx -t`를 실행한 뒤 기존 프록시를 다시 불러옵니다.
훅의 0이 아닌 종료 상태를 확인하세요. Certbot은 갱신 자체를 실패시키지 않고도 훅 실패를 보고할 수 있습니다.
정상 `nginx -t` 성공 메시지도 stderr를 사용하므로 그것만으로 실패를 의미하지 않습니다.
직접 설치 도구 호출은 프록시가 실행 중인 상태에서 설치된 배포 작업도 확인합니다.
`cmp`는 내용을 출력하지 않고 두 배포 파일이 활성 계보와 일치함을 확인합니다.
갱신이 준비되었다고 판단하기 전에 실제 훅 실패를 해결하세요.
이 블록은 명령 실패 시 타이머를 활성화하기 전에 중단합니다.
단순한 `renew --dry-run`은 배포 훅을 생략하므로 완전한 배포 검사가 아닙니다.
실패는 `sudo journalctl -u certbot.service`와 `/var/log/letsencrypt/letsencrypt.log`에서 확인하고,
타이머와 제공 중인 인증서 만료일을 주기적으로 점검하세요.
다음 HTTP-01 갱신에도 TCP 80과 올바른 DNS가 필요합니다.
이 웹 루트 설정 이후에는 반복적인 프록시 종료나 수동 인증서 복사가 필요하지 않습니다.

Certbot 공식 안내서의
[standalone 발급](https://eff-certbot.readthedocs.io/en/stable/using.html#standalone),
[갱신 설정 변경](https://eff-certbot.readthedocs.io/en/stable/using.html#modifying-the-renewal-configuration-of-existing-certificates),
[테스트 중 배포 훅](https://eff-certbot.readthedocs.io/en/stable/using.html#testing)을 참조하세요.

### 공개 7. 관리 SSH와 GitLab SSH 분리

이 선택적 절차는 기존 HTTPS 설치를 다음 구성으로 변경합니다.

| 서비스 | 호스트 포트 | 의도한 수신 접근 |
| --- | --- | --- |
| Ubuntu 관리 | TCP 2222 | 신뢰할 수 있는 관리자의 공개 원본 주소만 |
| GitLab SSH | TCP 22 | 공개. GitLab이 저장소 사용자를 인증 |
| HTTP 및 HTTPS | TCP 80 및 443 | 위에서 설정한 대로 공개 |
| 직접 레지스트리 수신 | `127.0.0.1:5050` | 루프백 전용. 외부 레지스트리 클라이언트는 HTTPS 443 사용 |

`ssh -p 2222 root@server.example.com`은 호스트 관리 계정에 연결합니다.
root 로그인이 비활성화되어 있다면 sudo 계정을 사용하세요.
`git@gitlab.example.com:namespace/project.git` 같은 저장소 URL은 기본 포트 22의 GitLab에 연결합니다.
GitLab의 `git` 계정은 root 관리 셸을 제공하지 않습니다.
저장소 SSH 공개 키는 의도한 GitLab 사용자 또는 배포 키에 등록하세요.
호스트 `authorized_keys`와 GitLab 권한은 별개입니다.
두 SSH 서비스에는 별도의 호스트 키도 있습니다.
포트 변경 후 예상하지 못한 키를 수락하지 말고 지문을 독립적으로 검증하세요.

Bootstrapper는 호스트 SSH 데몬이나 방화벽을 설정하지 않습니다.
다음 OS 설정 예시는 서버에 로컬로 할당된 IPv4 `203.0.113.10`과
신뢰할 수 있는 관리자 원본 `198.51.100.25/32`를 사용하며 둘 다 바꿔야 합니다.
NAT 뒤의 서버에서는 호스트에 실제 할당된 주소를 바인드하고 외부 포워딩 규칙을 조정하세요.
변경 내내 현재 인증된 세션을 열어 두고 제공자 콘솔 복구 수단을 준비하세요.

#### 새 관리 수신기 준비 및 테스트

먼저 제공자 방화벽과 UFW에서 신뢰하는 원본의 TCP 2222를 허용하고,
현재 작동 중인 관리 포트 규칙도 유지하세요. 기존 80/443 규칙을 유지하세요.
수신 기본 거부 정책을 사용하며 2222의 더 넓은 허용 규칙은 두지 마세요.
UFW가 비활성이면 활성화하기 **전에** 작동 중인 SSH 경로를 허용하세요.
방화벽을 초기화하지 말고 기존 규칙을 검토하세요.

```bash
sudo ufw allow from 198.51.100.25/32 to any port 2222 proto tcp
sudo ufw status numbered
sudo systemctl status ssh.socket ssh.service --no-pager
sudo systemctl cat ssh.socket
sudo systemctl show ssh.service -p KillMode
sudo ss -lntp
```

Ubuntu는 보통 [SSH 소켓 활성화](https://discourse.ubuntu.com/t/sshd-now-uses-socket-based-activation-ubuntu-22-10-and-later/30189)를 사용합니다.
Ubuntu 24.04에서는 생성기가 `sshd_config`를 읽습니다.
이전에 마이그레이션한 설치나 사용자 정의 설치에는 소켓 드롭인이 있을 수도 있습니다.
SSH 설정과 실제 적용 유닛을 모두 확인하세요.
데몬 다시 불러오기만으로 수신 소켓이 교체되지는 않습니다.

`/etc/ssh/sshd_config.d/`에서 의도한 수신기를 기존 `Port`/`ListenAddress` 항목과 정리하세요.
준비 단계에서는 포트 22의 관리를 유지하고 포트 2222에는 서버의 명시적 IPv4만 추가하세요.

```text
Port 22
Port 2222
ListenAddress 203.0.113.10:22
ListenAddress 203.0.113.10:2222
```

소켓 활성화 설치에서는 예를 들어
`/etc/systemd/system/ssh.socket.d/zz-bootstrapper-admin.conf` 같은 로컬 드롭인에서
수신기가 일치하도록 설정하세요. 필요하면 디렉터리를 만들고 파일을 수정하세요.
나중 재정의가 원치 않는 수신기를 복원하지 않도록 기존 드롭인과 실제 적용 유닛을 확인하세요.

```ini
[Socket]
ListenStream=
ListenStream=203.0.113.10:22
ListenStream=203.0.113.10:2222
```

빈 할당은 상속된 수신기를 지웁니다.
Docker가 GitLab SSH를 `127.0.0.1:2222`로 공개하는 동안 2222에 와일드카드를 사용하면 바인딩이 충돌합니다.
인증 정책은 유지하고 적용 전에 `sudo sshd -t`로 검증하세요.
`sudo sshd -T`와 실제 소켓 유닛도 확인하세요.

다음 소켓 교체는 설치된 SSH 서비스가 `KillMode=process`를 보고한다고 가정합니다.
이 방식은 주 데몬이 멈춰도 기존 세션 프로세스를 유지합니다.
[systemd 프로세스 처리](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html)를 참조하세요.
그렇지 않다면 SSH 세션이 유지된다고 가정하지 말고 제공자 콘솔을 사용하세요.
설정 검증에 성공한 뒤 실행하세요.

```bash
sudo systemctl daemon-reload
sudo systemctl stop ssh.socket ssh.service
sudo systemctl start ssh.socket
sudo systemctl status ssh.socket --no-pager
sudo ss -lntp
```

서비스 기반 SSH에서는 같은 데몬 설정을 검증하고 대신 `ssh.service`를 다시 시작하세요.
계속하기 전에 실제 수신기를 확인하세요.
신뢰하는 원본에서 **새 클라이언트 연결**을 열고 연결 재사용을 비활성화하며 키 인증을 요구하세요.

```bash
ssh -S none -o PreferredAuthentications=publickey \
  -p 2222 root@server.example.com
```

예상 호스트 지문과 의도한 관리/sudo 접근이 작동하는지 확인하세요.
이 새 연결이 성공하기 전에는 이전 수신기나 방화벽 접근을 제거하지 마세요.
원본 제한을 무효화하는 광범위한 2222 허용 규칙은 제거하세요.
IPv6도 명시적으로 처리하세요. 이 예시는 제한 없는 IPv6 수신기를 남기지 않고 관리 SSH를 IPv4에만 바인드합니다.

#### 포트 22를 GitLab에 할당하고 저장 설정 정리

데몬 설정과 소켓 재정의에서 준비 단계의 포트 22 수신기를 제거하고,
`Port 2222`, `ListenAddress 203.0.113.10:2222` 및 해당 소켓 수신기만 남기세요.
빈 `ListenStream=` 초기화는 유지하세요.
`sshd -t`, 해당 다시 시작 순서 및 위의 새 키 로그인 검사를 반복하세요.
`ss -lntp`로 **IPv4와 IPv6 포트 22 모두 호스트 SSH가 점유하지 않음**을 확인하세요.
그런 다음 제공자 방화벽에서 공개 TCP 22를 허용하세요.
관리 접근 제한은 TCP 2222에 계속 적용됩니다.

다른 서비스에 필요한 접근을 검토한 뒤 다음 UFW 명령으로 이 구성의 호스트 정책을 표현할 수 있습니다.
기존 규칙을 초기화하지 마세요. IPv6를 포함한 더 넓은 2222 허용을 제거하세요.
원본 한정 허용 규칙을 추가해도 기존의 모든 원본 허용 규칙을 좁히지는 않습니다.
UFW가 비활성이면 작동 중인 2222 관리 경로를 위에서 허용하고 새 연결로 검사한 후에만 활성화하세요.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 198.51.100.25/32 to any port 2222 proto tcp
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

규칙 적용 후 새 관리 키 로그인을 반복하세요.
IPv6 정책은 실제 제공하는 주소와 일치시켜야 하며,
이 IPv4 전용 관리 예시에 광범위한 IPv6 2222 허용을 추가하면 안 됩니다.

저장된 `$PERSISTENT_DIR/configuration/.docker.env`에서 SSH 바인딩만 바꾸고
비공개 레지스트리 바인딩은 유지하세요.

```bash
export GITLAB_SSH_BIND='22'
export GITLAB_REGISTRY_BIND='127.0.0.1:5050'
```

정확한 Cube/헤더, 이미지 고정, 비밀 정보 및 다른 모든 설정을 보존하세요.
일회성 셸 재정의는 저장 설정을 대체하지 않습니다.
작업이 유휴 상태일 때 GitLab 다시 시작을 예약하세요.
이 작업은 같은 이미지와 영구 데이터를 유지하면서 컨테이너를 다시 만듭니다.
호스트에서 승인된 컨트롤러 내부의 기존 진입점을 실행하세요.

```bash
sudo docker exec -w /system/gitlab system_bootstrapper_1 bash -e ./start.sh
sudo docker exec -w /system/nginx system_bootstrapper_1 bash -e ./start.sh reload
```

GitLab 컨테이너 IP가 바뀌었으면 NGINX 다시 불러오기가 HTTPS/레지스트리 업스트림을 재생성합니다.
이미지 빌드, Seed 복원 또는 데이터베이스 버전 마이그레이션이 없는 설정 변경입니다.
GitLab 준비를 기다리고 Wizard, Sync, HTTPS 및 레지스트리 접근을 다시 검증하세요.
오래된 양식이 이전 바인딩을 되돌리지 않도록 이미 열린 Wizard에서 다음 보내기 전에 저장 설정을 가져오세요.

Docker가 공개한 브리지 포트는 UFW INPUT 규칙을 우회할 수 있습니다.
수신 기본 거부만으로 공개된 컨테이너 포트를 보호할 수는 없습니다.
이 구성에서는 공개 GitLab 22가 의도된 것입니다.
다른 바인딩, 특히 5050은 루프백에 두고 `docker port system_gitlab_1`을 확인하여 외부에서 도달 가능 여부를 검사하세요.
Docker 방화벽 관리를 유지하고 `iptables`/`ip6tables` 옵션을 false로 설정하지 마세요.
[Docker와 UFW](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw) 및
[소켓 유닛 참고 자료](https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html)를 참조하세요.

마지막으로 호스트 키 로그인이 여전히 2222를 사용하는지 확인하고 의도한 GitLab 사용자로 저장소 접근을 검사하세요.

```bash
git ls-remote git@gitlab.example.com:namespace/project.git HEAD
```

이는 저장소 읽기 접근을 검증하며 푸시 권한까지 검증하지는 않습니다.
[네이티브 실행 환경 검증기](../bootstrapper/README.md#reviewed-replacement-host-initialization)는
다른 플랫폼 애플리케이션/저장소 계약을 확인하며 이 SSH 및 방화벽 검사를 대체하지 않습니다.
