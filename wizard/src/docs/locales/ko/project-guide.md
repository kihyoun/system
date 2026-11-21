# 애플리케이션 프로젝트 만들기

Wizard를 Sync에 연결하고 저장된 구성을 가져온 다음 **프로젝트 → 프로젝트 추가**를
여세요. 소문자 ASCII 문자와 숫자로만 이루어진 비어 있지 않은 프로젝트 키를 입력하세요.
GitLab 네임스페이스와 애플리케이션 템플릿을 선택한 뒤 운영 환경, Beta 및 Review 앱
호스트의 HTTP/HTTPS, 인증서 및 배포 설정을 구성하세요. 키 아래의 대상은 정확한 저장소
경로입니다. 도메인은 이 경로를 바꾸지 않습니다. 기존에 저장된 키의 이름은 변경되지 않습니다.

키 필드는 확인 중, 사용 가능, 사용 중 및 미확인 상태를 구분합니다. 로컬 중복 키나 이미
사용 중인 GitLab 대상은 생성을 차단합니다. API 실패는 이름을 사용할 수 있다는 뜻이
아닙니다. 저장은 GitLab을 다시 확인하며, 경합하는 생성이 있으면 해당 저장소에 연결하거나
덮어쓰거나 접미사를 붙이지 않고 보고합니다.

## 저장하고 첫 파이프라인 확인하기

저장은 비공개 저장소를 생성하고 구성된 기본 브랜치를 사용하며, 관리형 CI를
`.system-bootstrapper/ci.yml`에 설치하고 해당 CI 경로를 선택합니다. 이 프로비저닝 작업이
소유한 비공개 저장소에 누락된 관리형 CI를 설치하기 전에 컨트롤러 자동화 계정은 보호된
기본 브랜치에 쓸 수 있도록 명시적인 프로젝트 Maintainer 권한을 받습니다. 이미 유효한
저장소 연결을 재개할 때는 GitLab에서 읽기만 하며 브랜치 보호와 사용자 파일을 보존합니다.
프로비저닝은 인증된
백그라운드 작업을 통해 서버에서 실행되며 브라우저는 짧은 요청으로 상태를 폴링합니다.
완료될 때까지 양식을 열어 두세요. 실패한 요청은 저장으로 재시도할 수 있습니다.
브라우저/서비스 재시작 후에는 대기 중인 구성을 가져오고 **수정 → 저장**으로 동일한 작업을 재개하세요.

비공개 작업 영수증은 `.projects.env/.<key>.env`에 저장됩니다. 프로비저닝 실행 중에는
충돌하는 구성/서비스 변경이 차단됩니다. 복구를 우회하려고 대기 중인 구성을 교체하거나
영수증을 삭제하지 마세요.

React, Angular 및 일반 웹 프로젝트에는 편집 가능한 애플리케이션 소스,
Dockerfile, NGINX 구성 및 일치하는 CI가 제공됩니다. React는 TypeScript/Vite를,
Angular는 CLI 빌드를 사용합니다. 둘 다 고정된 의존성과 잠금 파일로 Node 24를 사용합니다.
일반 웹은 정적 HTML/CSS/JavaScript로 시작하며 Node 빌드가 필요하지 않습니다.
생성된 저장소의 `GETTING_STARTED.md`에 로컬 명령이 안내되어 있습니다.

라우팅이 준비되면 저장은 초기 파이프라인을 시작합니다. 이미지를 빌드하여 푸시하고 HTTP
스모크 검사를 수행하며 자동 환경을 배포합니다. 수동 배포 작업은 GitLab에서 시작하세요.
실제 결과는 파이프라인 링크에서 확인하세요. 대기열에 있는 빌드는 애플리케이션이 실행 중임을
뜻하지 않습니다. 저장을 다시 시도하면 중복 실행 대신 초기 파이프라인을 복구합니다.

**빈 저장소**에는 README와 생성된 CI가 있으며 실행 중인 애플리케이션은 없습니다.
빌드 또는 배포 전에 생성된 Docker/Cypress 작업 흐름과 호환되는 소스 및 루트 Dockerfile을
추가하세요. 환경 URL은 구성된 대상이며 상태 검사가 아닙니다.

저장소 ID, 경로, URL, 기본 브랜치, 관리형 CI 경로 및 작업 상태는 가져오기와 구성 백업/열기
이후에도 유지됩니다. 일반 환경 편집은 구성/보내기 흐름을 사용합니다. 저장소 이름을 바꾸거나
커밋된 CI를 자동으로 다시 작성하지 않습니다. 파이프라인 변경은 저장소에서 명시적으로 검토하세요.

## 애플리케이션에 신뢰할 수 있는 HTTPS 호스트 이름 설정하기

Wizard는 선택한 호스트, 프로토콜 및 인증서 경로를 저장하지만 인증서를 요청하지는 않습니다.
환경 URL이나 성공적인 HTTP 배포만으로는 HTTPS 인증서 체인을 신뢰할 수 있는지,
인증서가 해당 호스트를 포함하는지 입증할 수 없습니다. 플랫폼 인증서를 재사용하려면
인증서의 주체 대체 이름에 실제로 애플리케이션 호스트 이름이 포함되어야 합니다.

이 절차는 정확히 지정한 애플리케이션 호스트 하나에 별도의 Certbot 계보를 사용합니다.
운영 환경, Beta 또는 Review 호스트를 추가하려면 반복하세요. 와일드카드 HTTPS에는
운영자가 구성한 DNS-01 인증서가 필요합니다. HTTP-01로는 와일드카드 인증서를
발급할 수 없습니다. 관리형 시스템 Wizard 환경에는 별도의
[활성화 절차](../templates/project-bootstrap/wizard-environments/README.md)가 있습니다.

운영자는 다음 입력값과 사전 조건을 준비하세요.

- 검토된 릴리스로 실행 중인 플랫폼, 네이티브 HTTP-01 경로 및 외부에서 접근 가능한
  TCP 80/443 포트가 필요합니다. 진입 프록시는 이미 구성된 HTTP 호스트를 포함하여
  선택한 호스트 이름에 대해 공유 챌린지 웹 루트를 제공해야 합니다.
  이전 릴리스에는 이 HTTP 호스트 경로가 없을 수 있으므로 발급 전에 아래 챌린지
  검사가 통과해야 합니다. 지원되는 릴리스 절차로 업그레이드하거나 요청이 기본 ACME
  경로에 도달하는 새 미할당 호스트 이름을 정확히 지정하여 사용하세요.
- 애플리케이션의 공개 A/AAAA 레코드는 의도한 호스트만 가리켜야 합니다.
  두 주소 계열을 모두 확인하세요. 오래된 AAAA 레코드는 검증을 실패하게 할 수 있습니다.
- `/etc/system-bootstrapper/persistence.env`의 기존 라이브 저장소 선택 정보와
  [공개 HTTPS 설정](HANDBOOK.md#public-2-select-working-storage-and-install-certificate-integration)을
  통해 설치한 호스트 통합이 필요합니다. 이 설정은 `/usr/local/sbin/system-certbot`,
  인증서 배포 훅 및 `certbot.timer`를 설치합니다. 저장된 저장소 선택을 재사용하세요.
  안내서의 신규 설치 예시로 대체하지 마세요. Certbot은 `/usr/bin/certbot`에 있는
  배포판 패키지를 사용합니다.
- 실제 ACME 연락처 이메일과 사용하지 않는 계보 이름이 필요합니다. 여기서는 정확한
  호스트 이름을 계보 이름으로도 사용합니다. 선택 전에 `sudo system-certbot certificates`를
  확인하세요. 다른 애플리케이션의 인증서 상태를 덮어쓰지 마세요.

서버에서 다음 값을 자신의 값으로 바꾸세요.

```bash
APP_HOST='app.example.com'
ACME_EMAIL='you@example.com'
dig +short A "$APP_HOST"
dig +short AAAA "$APP_HOST"
sudo env APP_HOST="$APP_HOST" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  install -d -m 0755 "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge"
  printf "%s\n" bootstrapper-application-acme-check > "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/$APP_HOST-check"
  chmod 0644 "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/$APP_HOST-check"
'
```

서버 외부에서 같은 애플리케이션 호스트 이름을 사용하세요.

```bash
APP_HOST='app.example.com'
curl --fail --silent --show-error --include \
  "http://$APP_HOST/.well-known/acme-challenge/$APP_HOST-check"
```

리디렉션 없이 HTTP **200**과 정확한 `bootstrapper-application-acme-check` 본문이
반환되어야 합니다. 애플리케이션 페이지, 404 또는 리디렉션이 반환되면 챌린지가 공유
웹 루트에 도달하지 않는 것입니다. 인증서를 요청하기 전에 DNS, 방화벽, 릴리스 또는
라우팅 설정을 해결하세요. 발급을 반복해서 시도하는 것은 라우팅 진단 방법이 아닙니다.
기본 ACME 경로는 미할당 호스트 이름을 지원하므로 인증서 파일이 없는 새 HTTPS 환경을
먼저 활성화할 필요는 없습니다.

검사를 통과하면 위에서 설정한 값으로 서버에서 실행하세요.

```bash
sudo env APP_HOST="$APP_HOST" ACME_EMAIL="$ACME_EMAIL" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  /usr/local/sbin/system-certbot certonly --webroot \
    --webroot-path "$PERSISTENT_DIR/ssl/acme-http01" \
    --non-interactive --agree-tos --email "$ACME_EMAIL" \
    --cert-name "$APP_HOST" -d "$APP_HOST"
  RENEWED_LINEAGE="/etc/letsencrypt/live/$APP_HOST" /usr/local/sbin/system-install-certificate
  cmp "/etc/letsencrypt/live/$APP_HOST/fullchain.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/fullchain.pem"
  cmp "/etc/letsencrypt/live/$APP_HOST/privkey.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/privkey.pem"
'
```

이 명령은 운영 CA 인증서를 요청합니다. 설치된 훅은 계보를 라이브 저장소에 복사하고
NGINX를 검증한 뒤 실행 중인 진입 프록시의 설정을 다시 불러옵니다. 설치 프로그램을
명시적으로 호출하여 해당 배포를 직접 검증합니다. 웹 루트 발급은 프록시를 계속 실행하며
향후 갱신을 위해 웹 루트 인증 방식을 저장합니다. NGINX를 중지하거나 NGINX가 사용 중인
포트 80에서 standalone 발급을 사용하지 마세요. 인증서 작업이나 배포 작업이 실패하면
애플리케이션의 HTTPS 설정을 변경하기 전에 해결하세요.

Wizard에서 저장된 구성을 가져오고 비공개 구성 백업을 보관하세요. 프로젝트 프로비저닝이
아직 대기 중이면 일반 구성 변경 전에 동일한 **수정 → 저장** 작업을 완료하거나 재개하세요.
서버 소유의 영수증을 유지하세요. 복구를 우회하려고 프로젝트를 삭제/재생성하거나 키를
변경하거나 영수증을 편집하지 마세요. 완료된 애플리케이션은 실제 계보 이름을 사용하여
대상 환경을 다음 값으로 편집하세요.

| 설정 | 예시 |
| --- | --- |
| 활성화할 호스트 | `app.example.com` |
| 도메인 모드 | 정확한 호스트의 HTTPS, 모드 `2` |
| SSL 인증서 | `/ssl/live/app.example.com/fullchain.pem` |
| SSL 비공개 키 | `/ssl/live/app.example.com/privkey.pem` |

환경 편집 내용을 저장하고 **보내기**로 구성을 적용하세요. 플랫폼의 `/ssl` 마운트 내부에서
보이는 경로를 사용하고 호스트의 `/etc/letsencrypt` 경로는 사용하지 마세요. 보내기 전에
표시된 영향을 검토하세요. 기존 애플리케이션의 라우팅만 바꾸면 GitLab은 계속 실행되며
더 넓은 변경은 플랫폼을 재시작합니다. 이후 다시 연결하여 구성을 가져오세요.
이 작업은 인증서를 발급하거나 저장소 이름을 바꾸거나 CI에 커밋된 환경 URL을 다시
작성하지 않습니다. 프로토콜이 바뀌었다면 애플리케이션 저장소에서 해당 URL을 검토하세요.

일반 CA 신뢰 저장소를 사용하는 외부 클라이언트에서 선택한 호스트 이름과 애플리케이션
동작을 검증하세요. 배포된 애플리케이션에서 실제 클라이언트 측 경로와 16바이트보다 큰
기존 정적 파일을 선택하세요.

```bash
APP_HOST='app.example.com'
APP_ROUTE='/your/spa/deep-link'
APP_FILE='/path/to/existing-file.ext'
curl --fail --silent --show-error --dump-header - --output /dev/null "https://$APP_HOST/"
curl --fail --silent --show-error --dump-header - --output /dev/null "https://$APP_HOST$APP_ROUTE"
curl --fail --silent --show-error --range 0-15 --dump-header - --output /dev/null \
  "https://$APP_HOST$APP_FILE"
```

이 요청은 일반 TLS 검증을 통해 서버 인증서 체인과 URL 호스트 이름을 검증합니다.
인증서 검증을 비활성화하지 마세요. `/`에는 예상 애플리케이션 응답이, SPA 경로에는
HTML과 HTTP 200이, 정적 파일에는 HTTP 206과
`Content-Range: bytes 0-15/<file-size>`가 반환되어야 합니다. 브라우저에서 HTTPS URL과
딥 링크를 열어 애플리케이션과 자산이 올바르게 표시되는지 검증하세요. SPA가 아닌
애플리케이션에서는 HTML 폴백을 기대하는 대신 문서에 명시된 경로 동작을 확인하세요.

마지막으로 서버에서 이 계보의 갱신과 배포 훅을 시험하세요.

```bash
sudo env APP_HOST="$APP_HOST" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  /usr/local/sbin/system-certbot renew --cert-name "$APP_HOST" --dry-run --run-deploy-hooks
  RENEWED_LINEAGE="/etc/letsencrypt/live/$APP_HOST" /usr/local/sbin/system-install-certificate
  cmp "/etc/letsencrypt/live/$APP_HOST/fullchain.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/fullchain.pem"
  cmp "/etc/letsencrypt/live/$APP_HOST/privkey.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/privkey.pem"
  docker exec system_web_1 nginx -t
'
```

모의 갱신이 성공하고 배포 훅 실패가 없어야 합니다. Certbot은 갱신 종료 상태가 성공이어도
훅 실패를 보고할 수 있으므로 출력을 확인하세요. 시험 실행은 스테이징 인증서가 아니라
현재 사용 중인 신뢰할 수 있는 인증서를 배포합니다. 이후 외부 HTTPS 검사를 반복하고
공유 타이머를 활성화/확인한 다음 이 확인 파일만 제거하세요.

```bash
sudo systemctl enable --now certbot.timer
systemctl list-timers certbot.timer
sudo env APP_HOST="$APP_HOST" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  rm -- "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/$APP_HOST-check"
'
```

갱신을 위해 DNS와 공개 TCP 80을 계속 작동 상태로 유지하세요. 일반적인
[Harvest/Seed 복구 흐름](RECOVERY_CONTRACT.md)을 통해 계정, 아카이브 및 갱신 구성을
포함한 전체 Certbot 트리를 보존하세요. 잠금 오류가 발생하면 실행 중이거나 중단된
인증서/Harvest 작업을 해결해야 합니다. 강제로 발급하려고 잠금을 삭제하지 마세요.
배포 훅 진단과 복구 시 웹 루트 재연결은
[갱신 안내](HANDBOOK.md#public-6-switch-unattended-renewal-to-the-running-proxy)를 참조하세요.

### HTTP에서 HTTPS로 변경할 때의 브라우저 데이터

`http://app.example.com`과 `https://app.example.com`은 서로 다른 브라우저 출처입니다.
호스트 이름과 애플리케이션 이미지가 같아도 localStorage 데이터는 자동으로 이전되지
않습니다. 환경을 변경하기 전에 애플리케이션의 내보내기/백업 기능으로 필요한 브라우저
데이터를 보관한 뒤 HTTPS 출처의 애플리케이션에서 가져오세요. 내보내기/가져오기 기능이
없다면 해당 애플리케이션의 복구 절차를 따르세요. 플랫폼 구성 백업이나 Harvest/Seed는
사용자의 브라우저 localStorage를 복사하지 않습니다.

## 시스템 Wizard 프로젝트 관리하기

구성된 Wizard가 활성화된 상태에서 시작하면 첫 번째 시스템 프로젝트로 등록됩니다.
일반의 설정이 기존 운영 환경 호스트와 인증서를 제공하므로 등록 시 해당 호스트의 두 번째
프록시를 만들지 않습니다. 이 관리형 항목에서는 편집/삭제 및 일반 환경 전환이 비활성화됩니다.
반복 시작해도 저장소와 서버 소유의 작업 흐름 메타데이터가 유지됩니다. 로컬 키나 저장소
소유권 충돌을 해결한 후 시작을 다시 시도하세요.

등록만으로는 비활성 골격이 설치됩니다. 관리형 프로젝트 동작을 사용하여
[고정 소스를 초기화](WIZARD_SOURCE.md)하고 [후보를 빌드 및 검증](WIZARD_BUILD.md)하며
[Review/Beta 환경](../templates/project-bootstrap/wizard-environments/README.md)을 구성하세요.
선택적 환경은 처음에는 비활성화되어 있으며 호스트/인증서를 명시적으로 구성해야 합니다.
배포/중지 작업은 수동입니다. 후보가 운영 환경 인터페이스를 교체하려면 별도의 보호된
[운영자 승격 절차](../templates/project-bootstrap/wizard-production/README.md)를 거쳐야 합니다.

보내기/가져오기와 열기/백업은 구성을 관리하며, 영구 서비스 데이터와 인증서를 처리하는
Harvest/Seed와 독립적입니다. 실제 구성 백업은 비공개로 보관하세요. 생성된 소스 저장소에
자격 증명이나 내보낸 구성을 넣지 마세요.

## 검증

저장소 루트에서 `npm run build`로 Sync를 빌드하세요. 격리된 API 회귀 검사
`node tests/gitlab/project-bootstrap.js`는 포트 8071을 사용하므로 폐기 가능한
컨테이너/네트워크 네임스페이스에서 실행해야 합니다. 검증, 인증, 네임스페이스 충돌,
경합하는 저장, 복구, 폴링, 구성 쓰기 차단 및 가져오기 왕복을 검사합니다.
템플릿 생성은 `node tests/gitlab/application-templates.js`에서 검사합니다. 같은 픽스처는 네이티브 네임스페이스 페이지 순회, 소유한 저장소 생성, 사용자 수정 후 읽기 전용 영수증 복구, 중단된 API 쓰기 및 멱등적인 초기 파이프라인 생성도 검사합니다.

Wizard 검사는 `wizard/package.json`에 선언된 Node/npm 버전을 사용하고
`npm ci`로 설치한 뒤 Wizard 디렉터리에서 `npm run lint`, `npm test`,
`npm run build` 및 `npm run test:config-export`를 실행하세요. 테스트는 메타데이터,
인증서/배포 설정, 키 검증 및 오래된 응답 무시를 검사합니다.

`tests/gitlab/live/project-bootstrap.js`는 폐기 가능한 플랫폼에 대한 명시적 선택 검사입니다. Sync 자격 증명을 환경에서 받고 `PROJECT_PAYLOAD` JSON 파일에 담긴 Wizard 생성기의 `{projectKey, namespaceId, data, ci}`를 사용합니다. 자신의 `bootstrapdemo` 프로젝트를 생성하거나 이어서 실행하고 동시/반복 Save와 Fetch를 확인한 뒤 검토를 위해 프로젝트를 남깁니다. 관련 없는 기존 키를 대상으로 하지 마세요. 템플릿 라이브 검사는 `tests/gitlab/live/application-templates.js`와 `tests/gitlab/live/application-templates-audit.js --projects-file /tmp/template-live-results.json --timeout 720`에 있습니다. 정상 설정 후 검토한 컨트롤러 안에서 감사를 실행하세요. 기존의 준비된 자동화 자격 증명을 읽고 정확한 비공개 저장소, 스타터 파일, 고유한 초기 파이프라인 및 성공한 Review/Production 환경을 확인합니다. 실패한 작업을 자동으로 재시도하지 않습니다. 별도 `tests/gitlab/live/project-bootstrap-audit.js --project root/bootstrapdemo`는 비공개 프로젝트 식별 정보, 관리되는 CI 경로, 정확한 Cube와 공식 CI lint를 검사합니다. 두 감사 모두 자격 증명을 초기화하거나 Rails를 호출하지 않습니다. 직접 선택한 명시적 테스트 프로젝트 경로나 메타데이터 파일을 제공하세요.

`tests/wizard/default-wizard.js`와
`tests/nginx/typed-routing.js`는 관리형 등록과 단일 경로 동작을 검사합니다.
`tests/wizard/live/default-wizard.js`는 이에 대한 인증된 라이브 검사입니다.
로컬 HTTP 픽스처는 실제 DNS, 인증서 발급/갱신, GitLab 작업 실행 또는 성공적인 운영 환경
롤아웃을 입증하지 않습니다. 명시적으로 소유한 테스트 플랫폼에서 이러한 관문을 별도로 검증하세요.


## 애플리케이션 별칭과 라우팅 변경

일반 애플리케이션의 각 환경에는 선택적인 `PROD_ALIASES`,
`BETA_ALIASES` 또는 `REVIEW_ALIASES` 필드가 있습니다. 추가할 정확한 DNS
호스트를 공백으로 구분하세요. 환경에 이미 설정한 호스트가 기본 대상이며
정확한 호스트용 도메인 모드 0 또는 2를 사용합니다. 예를 들어 기본 호스트가
`www.example.com`이면 Production 별칭에 `example.com`을 추가합니다.
비활성화된 환경은 별칭 설정을 보관하지만 경로를 공개하지 않습니다.

HTTP와 HTTPS 별칭은 기본 호스트의 구성된 프로토콜로 영구 308 리디렉션하며
원래 경로와 쿼리를 보존합니다. 환경의 인증서와 일치하는 개인 키는
`/ssl` 아래에 있어야 하고 현재 유효해야 합니다. 인증서의 주체 대체 이름은
기본 호스트와 모든 별칭을 포함해야 합니다. 별칭이 HTTPS를 받으므로 기본
대상이 HTTP인 경우에도 필요합니다. 별칭을 켜기 전에 DNS와 인증서를
준비하세요. ACME HTTP-01 검증 파일은
`/.well-known/acme-challenge/`에서 직접 접근할 수 있습니다. 리디렉션이나
갱신을 위해 프록시를 중지할 필요가 없습니다. 와일드카드, 자기 자신으로의
리디렉션, 중복 별칭, 플랫폼 호스트 및 Wizard 별칭 또는 활성 애플리케이션
경로와 충돌하는 별칭은 거부합니다.

편집 전에 구성을 가져오세요. 개인 구성 백업을 보관하고 프로젝트를 저장한
다음 보내기를 여세요. 서버는 저장된 구성과 제안한 구성을 비교하여 확인 전에
영향을 표시합니다. 기존 일반 애플리케이션의 호스트, 프로토콜, 활성화,
인증서, 별칭, 배포 모드 변경은 기본 라우팅 적용 경로를 사용합니다. 영향을
받는 프로젝트의 필요한 프록시와 네트워크만 준비하고 진입 프록시를 검증한
뒤 정상적으로 다시 로드합니다. GitLab 및 기존 애플리케이션 컨테이너와
이미지는 계속 실행됩니다. 주요 설정, 프로젝트 목록, 소유권, Runner 또는
알 수 없는 설정 변경은 플랫폼 재시작 경로를 사용합니다. 구성이 바뀌면
검토한 보내기 계획은 무효가 되므로 다시 검토하세요. 실제 설정에 변화가
없으면 서비스를 재시작할 필요가 없습니다.

라우팅 적용은 서버 소유 기록과 System Cube를 보존합니다. 프록시 검증이나
다시 로드가 실패하면 이전의 생성된 구성 및 활성 프록시 구성을 복원합니다.
적용 실패 시 이전에 저장된 구성도 복원합니다. 오류를 확인하고 다시 시도하기
전에 구성을 가져오세요. 생성된 프록시 파일을 수정하거나 프로젝트 기록을
초기화하지 마세요. 배포 모드 필드를 바꿔도 애플리케이션에 이미 커밋된 CI는
다시 작성되지 않습니다. 저장소의 환경 작업을 별도로 검토하세요.

별칭과 환경 소유권은 가져오기/보내기 및 JSON 또는 ZIP 백업/열기를 거쳐
유지됩니다. 복구를 위해 일치하는 구성 백업과 인증서 및 서비스 데이터가
포함된 완료된 Seed를 보관하세요. 새 구성 가져오기는 Seed 복원보다 먼저
실행할 수 있으며, 시작 시 별칭을 제공하기 전에 인증서 범위를 검증합니다.
정상 복구 절차를 따르고 복구 후 경로/쿼리가 포함된 기본 URL과 별칭 URL,
HTTP-01 검증 파일을 확인하세요.

격리된 라우팅, multipart 보내기, 롤백 및 Wizard 구성 검사는 커밋된
컴포넌트 목록에 포함됩니다. 기존 일회용 플랫폼 후보는 Sync를 통해 일반
애플리케이션을 만들고 Wizard의 가져오기/ZIP/보내기 경로로 Review 및 별칭
변경을 적용합니다. GitLab 준비 상태와 컨테이너 식별자의 연속성, 기존
Production/Beta 이미지와 경로, HTTP/HTTPS 리디렉션, HTTP-01, 프록시 재시작,
Seed 복구와 갱신된 인증서 사용을 검증합니다. 전체 검토 변경에 대해 필수
후보 검사를 실행하세요. 이는 운영자의 업그레이드 단계가 아닙니다.
