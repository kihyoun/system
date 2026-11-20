# System 컨트롤러 릴리스와 런타임 베이스

네이티브 호스트 설치, 시작/중지, 영구 저장소 검사 또는 복구 전에
[호스트 런타임 준비](../Prepare-Host.md#prepare-the-host-operations-runtime)를 완료하세요.
Quickstart는 Node와 operations를 자동으로 준비합니다. 수동 소스/교체 호스트 경로는
먼저 이를 준비하거나 복원해야 합니다. `--install-host`는 네이티브 호스트 의존성을
설치하며 누락된 운영 런타임은 설치하지 않습니다. 유지보수 전에 검증된 Node 설치,
`operations/dist`, `operations/node_modules`를 오프라인으로 사용할 수 있게 보관하세요.

공개 **컨트롤러 릴리스**는 `system/Dockerfile`에서 빌드한 전체 이미지로, 오케스트레이션
코드, Sync 서비스, 패키징된 Wizard 소스 및 런타임 도구를 포함합니다. 별도로 빌드한
Wizard 웹 이미지가 함께 제공됩니다. 새 호스트는 컨트롤러나 Wizard 이미지를 빌드하거나
Alpine 빌드 패키지를 해석하지 않고 승인된 이미지를 가져올 수 있습니다. 승인된 컨트롤러에는
사전 빌드된 Sync와 operations가 포함되며 시작 시 npm 설치나 TypeScript 컴파일을 하지 않습니다.
[릴리스 설치](../Prepare-Host.md#install-a-tested-public-release)를 확인하세요.

`bootstrapper/Dockerfile`에서 빌드하는 독립 실행형 **런타임 베이스**에는 공유 도구만
있습니다. 베이스 이미지가 레지스트리에 게시되어 있어도 전체 컨트롤러를 대체할 수
없습니다. 두 이미지는 CI에서 각각 유용하지만, 검증된 전체 컨트롤러와 일치하는
Wizard만이 공개 시작 릴리스를 이룹니다.

## 호스트 워크로드 호환성 및 로깅

MongoDB 이미지를 선택하거나 커널 유지보수를 계획하거나 명시적인 배포를 확인할 때
Docker 데몬 호스트에서 [기본 호스트 호환성 검사 및 로그 정책 검사기](../docs/HOST_OPERATIONS.md)를
실행하세요. 이 가이드는 제한된 로깅 계약, 보존되는 구성 및 크기 기반
보관의 한계를 설명합니다.

## 공개 이미지로 새로 설치하기

`install-release.py`는 빈 설치를 위한 호환 호스트 진입점입니다.
컴파일된 `operations/dist/host/entry.js` 구현을 실행합니다. 설치 또는 오프라인
유지보수 전에 Node.js 24.22.0과 빌드된 operations 패키지를 준비하세요.
이 진입점은 의존성을 다운로드하거나 코드를 컴파일하지 않습니다.
동일한 플래그를 사용하는 직접 호출은 `node operations/dist/host/entry.js`입니다.
`--controller IMAGE@sha256:...`와 `--wizard IMAGE@sha256:...`를 받고 선택적으로
`--persistence-env FILE`을 받습니다. `--install-host`는 필요할 때 커밋된 호스트 설치
프로그램으로 Docker/Compose를 설치합니다. [핸드북](../docs/HANDBOOK.md)은 이 플래그를
사용하는 전체 로컬 HTTP 및 공개 도메인/Certbot 절차를 제공합니다.

설치 프로그램은 깨끗한 System 체크아웃, 고정된 Wizard 리비전 및 가져온 이미지 식별
정보를 검증합니다. 이미지 선택자만 비공개 `configuration/.release-images.env`에
쓰고 소스 빌드 없이 네이티브 시작을 호출합니다. 일반 시작은 저장된 기본 구성보다
먼저 이 릴리스 프로필을 로드하므로 이후 명시한 기본 구성의 이미지 선택이 우선합니다.
프로필은 가져온 사용자 구성이 아니며 Seed를 적용하지 않습니다.

이 새 설치 전용 작업은 기존 GitLab 데이터나 저장된 기본 구성이 있으면 거부합니다.
기존 상태 복구, 컨트롤러 승격 또는 GitLab 마이그레이션 절차를 대체하지 않습니다.
공개 인스턴스를 노출하기 전에 선택한 핸드북 절차에 따라 DNS, 네트워크 접속 및 필요한
HTTPS 인증서를 준비하세요.

## 공유 런타임 베이스 빌드하기

개발자는 기존 독립 실행형 빌드 컨텍스트로 베이스를 빌드할 수 있습니다.

```sh
docker build -t system-runtime:candidate ./bootstrapper
```

전체 System 이미지도 저장소 빌드 컨텍스트에서 `bootstrapper/install-runtime.sh`를
실행합니다. 별도로 게시된 System 베이스를 요구하는 대신 같은 공식 다이제스트 고정
Node 24.22.0 / Alpine 3.24 이미지에서 시작합니다. 공유 설치 프로그램은 Node 24.22.0과
npm 11.19.1을 확인한 뒤 고정된 Docker CLI 29.9.3-r1, Compose 5.7.2, Buildx 0.38.1,
Git 2.54.1-r0 및 기존 셸 유틸리티를 설치합니다. `docker-compose`와 `docker compose`를 모두 계속
사용할 수 있습니다. 사용자 지정 `IMAGE` 재정의도 같은 런타임 검사를 통과해야 합니다.

이미지 다이제스트는 업스트림 파일시스템을 고정하고 명시적 APK 패키지 버전은 직접
도구를 고정합니다. Alpine 저장소는 여전히 전이 패키지 업데이트를 해석하므로 이 입력만으로
완전한 오프라인 패키지 스냅샷이 되지는 않습니다. APK 고정값을 사용할 수 없으면 다른
버전을 조용히 선택하지 않고 빌드가 실패합니다. 사용할 수 없는 직접 패키지 버전은
검토된 변경으로 고정 Alpine 릴리스의 공식 인덱스에 맞춰 갱신하세요. 업스트림 런타임을
바꿀 때 이미지 다이제스트와 Node/npm 단언을 함께 갱신하고 전체 후보를 다시 빌드하여
검증하세요. 승인 이미지 게시는 이 빌드 의존성을 CI로 옮길 뿐, 오래된 APK 고정값이
향후 소스 빌드에서도 유효하게 만들지는 않습니다. 최종 사용자 설치가 이미 게시된
이미지를 사용하더라도 검토된 빌드 입력을 유지 관리하세요.

과거 Alpine 3.16 이미지 내부 라이브러리를 교체하거나 glibc Node 바이너리를 복사하지
마세요. 지원되는 베이스가 완전한 런타임을 제공합니다. 빌드해도 실행 플랫폼을 다시
시작하거나 Docker 데몬을 변경하지 않습니다. Docker 클라이언트는 명시적으로 접속을
허용한 경우에만 기존 데몬과 통신합니다. 버전 확인은 배포 호환성을 입증하지 않습니다.

승격 전에 Compose 구성과 시작 계약 테스트, 빌드/린트/API/서명 회귀 검사 및 통합
Wizard 소스 패키징을 검증하세요. 라이브 재시작/복구 승인과 수동 운영 환경 승격은
별도로 조정하는 동작입니다. 이전에 동작하던 이미지와 비공개 설정을 보존하세요.

## 로컬 라이브 데이터와 필요 시 Seed 작업

새 시작은 기본적으로 `/var/lib/system-bootstrapper/platform`의 로컬 작업 데이터를
사용합니다. 명시적으로 선택한 `PERSISTENCE_MODE=volume` 배치는 실제 마운트된
파일시스템이 여전히 필요하며 로컬 저장소로 대체하지 않습니다. 모드 없이 라이브
마운트를 선언한 레거시 선택자는 해당 볼륨 계약을 유지합니다. `PERSISTENCE_MODE`,
`PERSISTENT_DIR` 및 볼륨 마운트/UUID는 호스트 소유 입력이며, 변경해도 기존 데이터를
마이그레이션하지 않습니다. [저장소 가이드](../docs/PERSISTENT_VOLUME.md)를 확인하세요.

Seed 백업 저장소는 독립적입니다. 일반 시작 중 `SEED_DIR`은 선택 사항이며,
`SEED_MOUNT`/`SEED_UUID`는 선택 시 외부 백업 매체를 식별합니다. 컨트롤러/GitLab
컨테이너는 백업 마운트를 유지하지 않습니다. 명시적 Harvest나 복원만 정확한 이미지의
임시 도우미를 시작합니다. 쓰기나 서비스 중지 전에 호스트 경로, 마운트 식별 정보 및
공간을 검증하고 공유 라이브 데이터/TLS 임대를 사용합니다. 사용할 수 없는 Seed 대상은
루트 디스크 대체 경로가 되거나 일반 서비스와 갱신을 차단할 수 없습니다.

완료된 외부 Seed와 일치하는 비공개 구성 ZIP이 있으면 쓰기 시작 전에 커밋된 호스트
진입점을 사용하세요. 먼저 [새 대상 절차](../docs/RECOVERY_CONTRACT.md#restore-an-external-seed-into-a-fresh-local-installation)에
나온 대로 `bootstrapper/persistence.sh`와 비공개 호스트 선택자로 빈 라이브 골격을
준비하세요. 읽기 전용 사전 검사는 해당 디렉터리가 이미 있어야 합니다.

```sh
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/seed-operation.sh restore \
  --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
  --configuration-backup /root/recovery/bootstrapper.zip \
  --check-only
```

사전 검사를 검토한 뒤 `--check-only` 없이 반복하여 새 라이브 서비스 데이터
디렉터리로 복원하세요. 기존 플랫폼의 백업 생성에는 `harvest --image ...`를 사용하세요.
[복구 계약](../docs/RECOVERY_CONTRACT.md)은 필수 소스/이미지 입력, 완료와 실패 보호,
구성 분리 및 복원 후 검사를 설명합니다. 작업 후 백업 매체를 분리하세요. 일반 로컬
작업은 더 이상 이에 의존하지 않습니다. 일치하는 복구 입력을 다른 곳에 보존하지
않았다면 로컬 라이브 데이터를 가진 VM 삭제는 해당 데이터를 삭제합니다.

## 검토된 교체 호스트 초기화

이 디렉터리의 호스트 도구는 System 소스의 일부입니다. 설치에 새 리비전을 실행하기
전에 MR과 관련 검사로 변경하세요. 먼저 고정 하위 모듈이 있는 검토된 체크아웃을
가져오세요. 설치의 GitLab을 사용할 수 없으면 독립적으로 사용 가능한 미러나 보존된
소스 번들로 같은 검토된 Git 객체를 제공할 수 있습니다. 도구는 초기화 중 자신을
패치하거나 업데이트하거나 복제하지 않습니다.

`initialize.sh`는 **라이브** 서비스 데이터를 유지하면서 호스트를 교체합니다.
파일시스템 포맷, 최초 인증서 발급, GitLab 버전 마이그레이션, Seed 적용 또는 빈
파일시스템을 기존 설치로 전환하는 동작은 수행하지 않습니다. 새 설치는
[핸드북](../docs/HANDBOOK.md)의 최초 설치 경로를 따르세요.

지원되는 Ubuntu의 root 접속, Git과 Python 3, 선택된 로컬 또는 명시적 볼륨 라이브
저장소, 저장 구성 및 아래 복구 매니페스트가 필요합니다. 선택된 라이브 볼륨은 이미
마운트되어야 하며 로컬 모드는 시스템 디스크를 사용합니다. 일반 호스트 설치 프로그램이
Docker를 제공하고 `--install-host` 선택 시 Certbot도 설치합니다. 인스턴스 선택자와
자격 증명은 비공개로 유지됩니다.

```sh
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/initialize.sh \
  --install-host \
  --receipt-dir /var/log/system-bootstrapper/initialize-example \
  --timeout 1200 \
  --renewal-dry-run
```

시도마다 새 영수증 디렉터리를 선택하세요. 스크립트는 시작 전 기준 상태를 덮어쓰는
대신 기존 디렉터리를 거부합니다. 기준 상태, 상태 및 로그는 체크아웃 밖에 비공개
권한으로 생성되며 실행 가능한 도우미 스크립트가 아닙니다. 해시와 결과를 기록하고
내보낸 구성이나 자격 증명은 기록하지 않습니다. 업스트림 명령이 민감 정보를 출력할
수 있으므로 원시 설치/복구 로그는 비공개로 유지합니다. 실행 실패 시 로그를 보존하고
기존 데이터와 Seed 스냅샷을 그대로 둡니다. 보고된 단계를 점검하고 검토된 소스나
운영자 입력을 수정한 뒤 새 작업 디렉터리를 선택하여 재시도하세요.

모든 호스트 저장소 검사는 패키지나 서비스 변경 전에 수행됩니다. 스크립트는 구성/인증
해시와 보존된 관리자 식별 정보를 캡처하고, 명시적으로 요청한 스왑을 선택적으로
준비하며, 호스트 도구를 설치하고 선언된 이미지와 로컬 별칭만 로드하고, 볼륨에 저장된
Certbot 상태를 연결한 뒤 다시 빌드하지 않고 컨트롤러를 시작합니다. Docker 작업은
이 호스트의 Unix 소켓에 고정합니다. 이후 컨트롤러의 기존 비공개 레지스트리 복구가
정확한 저장 Wizard 다이제스트를 가져옵니다.

선택적 플래그는 다음과 같습니다.

| 플래그/입력 | 목적 |
| --- | --- |
| `--swap-gib 8` | 활성 스왑이 없으면 루트 디스크의 `/swapfile`에 8 GiB를 명시적으로 할당합니다. 기존 파일이나 공간 부족은 실패하며 데이터 볼륨은 스왑에 사용하지 않습니다. 기본값: 스왑 변경 없음. |
| `--timeout 1200` | 선택한 준비 기간 동안 애플리케이션 승인을 재시도하며 최대 3600초입니다. 개별 네트워크/명령 시간 제한도 각 검사를 제한합니다. |
| `--gitlab-token-file /root/gitlab-read-api-token` | 일반 모드 0600 파일로 운영자가 제공하는 선택적 관리 API 토큰입니다. 권한은 `/runners/all`과 Runner 관리자 읽기를 허용해야 합니다. 보존된 관리자 식별 정보와 작업 시작 후 인증된 접속을 확인합니다. 검사 범위는 아래 설명을 참조하세요. 값은 파일에서 읽으며 명령 인수나 영수증에 넣지 않습니다. |
| `--redirect-from https://example.com` | 이 출처에서 구성된 공개 Wizard 출처로 경로/쿼리를 보존하는 영구 리디렉션도 검증합니다. 표준 도메인을 가정하지 않습니다. |
| `--renewal-dry-run` | 설치된 임대 래퍼로 무작위 지연 없이 Certbot staging 갱신을 실행합니다. 실패한 deploy hook을 거부하고 이후 승인을 반복합니다. 실제 구성된 인증서 계보, 동작하는 DNS 및 접근 가능한 ACME 엔드포인트가 필요합니다. |
| `RECOVERY_MANIFEST_SHA256` | 선택적으로 독립 보존한 `recovery/images.json`의 SHA-256이며 아카이브/소스 선언을 신뢰하기 전에 검사합니다. |

런타임 검증기는 컨테이너 상태뿐 아니라 실제 GitLab 로그인/준비 상태와 레지스트리
인증을 확인합니다. 실제 Wizard 컨테이너와 대조한 공개 Wizard 본문, 정확한 인증된
Sync 가져오기 바이트와 Cube, 구성된 서비스 이미지, 모든 핵심 서비스의 보존 데이터
마운트와 이름 있는 볼륨 바인딩 장치, HTTPS의 Certbot 상태/타이머 및 비공개 이미지
복구 정리도 검증합니다. API 토큰이 없으면 Runner 컨테이너와 보존 식별 파일을
검사하고 GitLab 측 최근 접속 검증은 명시적으로 **검사하지 않음**으로 표시합니다.

GitLab은 유휴 작업 폴링에 응답하는 동안 이전 접속 시각을 유지할 수 있습니다.
식별 정보가 일치하는 온라인 관리자의 접속 시각이 이전 값이면 검증기는 해당
기존 컨테이너 안에서 공식 명령
`gitlab-runner verify --config /etc/gitlab-runner/config.toml`을 실행합니다.
명령은 전체 준비 기한 안에서 최대 15초로 제한됩니다. 이후 같은 관리자의
식별 정보, 온라인 상태와 접속 시각을 기준 상태와 다시 비교합니다. Runner를
등록하거나 구성을 변경하거나 작업을 만들지 않고 보존된 구성의 인증을
검사합니다. 영수증에는 `authenticationProbeCount`와 `jobExecutionChecked=false`가
기록됩니다. 이 검사는 실행 중인 폴러의 활동이나 작업 실행을 증명하지 않습니다.
실제 CI 실행은 격리된 플랫폼 후보에서 검증합니다.

검증기는 핵심 서비스와 구성된 기본 Runner 풀을 다룹니다. 사용자 지정 애플리케이션
승인은 해당 애플리케이션의 책임입니다.

명령을 별도로 실행할 수도 있습니다.

```sh
sudo python3 bootstrapper/verify-runtime.py baseline \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --output /root/pre-start-baseline.json
# Start the retained platform through the committed recovery entry point.
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/recover-volume.sh
sudo python3 bootstrapper/verify-runtime.py check \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --baseline /root/pre-start-baseline.json \
  --output /root/runtime-verification.json --timeout 1200
```

## 명시적 복구 이미지/소스 매니페스트

보존 볼륨 아카이브 경로는 `PERSISTENT_DIR/recovery/images.json`과
`recovery/images/*.tar.gz`의 비공개 운영자 준비 입력을 사용합니다. 체크섬은
독립적으로 보존한 매니페스트를 기준으로 일관성을 보호하며 업스트림 출처 서명이
아닙니다. 이 복구 경로에 의존하기 전에 실제 이미지 식별 정보, 소스 커밋, 트리,
고정 Wizard gitlink 및 별칭을 채우세요. 일반 새 소스/Seed 복구 계약은 별개입니다.

매니페스트는 다음 필드를 유지합니다. 모든 기호 값을 실제 식별 정보로 바꾸세요.
이는 스키마 예시이며 바로 실행할 수 있는 매니페스트가 아닙니다.

```json
{
  "sourceCommit": "<40 lowercase hexadecimal characters>",
  "sourceTree": "<recorded source tree Git object>",
  "wizardSourceRevision": "<Wizard gitlink from that source commit>",
  "archives": [{
    "file": "images/controller.tar.gz",
    "sha256": "<compressed archive SHA-256>",
    "imageId": "sha256:<exact Docker image identity>",
    "sourceCommit": "<same source commit>",
    "sourceTree": "<same source tree>",
    "wizardSourceRevision": "<same pinned Wizard gitlink>"
  }],
  "localImages": [
    {"tag": "system_bootstrapper", "imageId": "sha256:<exact Docker image identity>"},
    {"tag": "controller:retained", "imageId": "sha256:<same exact Docker image identity>"}
  ],
  "publicImages": [{
    "reference": "nginx@sha256:<recorded repository digest>",
    "tag": "nginx:retained",
    "imageId": "sha256:<exact Docker image identity>"
  }],
  "currentController": {
    "reference": "controller:retained",
    "imageId": "sha256:<same controller image identity>",
    "sourceCommit": "<same source commit>",
    "sourceTree": "<same source tree>",
    "productionWizardReference": "registry.example.com/platform/wizard@sha256:<recorded digest>"
  }
}
```

저장 구성에서 쓰는 별칭과 함께 다이제스트 고정 공개 GitLab 및 Runner 항목도 포함하세요.
선택적 아카이브 Wizard 항목은 불변 운영 환경 참조의 `imageRef`를 선언할 수 있습니다.
`imageId`는 호환 대상 엔진에서 Docker가 실제 보고하는 식별 정보입니다. OCI 구성
다이제스트와 매니페스트/인덱스 다이제스트가 호환된다고 가정하지 마세요. 소스 Git 객체는
로컬에서 사용할 수 있어야 합니다. 더 새로운 검토된 호스트 도구 체크아웃은 이전에
기록한 컨트롤러 커밋을 검증할 수 있지만, 컨트롤러 소스/트리/gitlink 선언은 여전히
정확한 아카이브 식별 정보와 일치해야 합니다.

시작 전에 `recover-volume.sh --verify`는 소스 식별 정보 누락, Git 트리/gitlink 불일치,
선언되지 않은 이미지 선택, 손상되거나 경로를 벗어나는 아카이브, 가변 공개 이미지 참조
및 중복되거나 근거가 없는 별칭을 거부합니다. 일반 복구는 선언된 각 아카이브를 로드하고
정확한 이미지 ID를 검증하며 서비스를 시작하기 전에 **모든** `localImages` 별칭을
재구성합니다. 인스턴스의 이전 로컬 태그를 추측하지 않습니다. 누락된 이미지에 맞추려고
저장 구성을 다시 쓰지 않습니다. 이미지 태그가 생략되면 Docker의 일반적인 `:latest`
의미이므로 NGINX 대체값 `nginx`는 선언된 `nginx:latest` 별칭과 일치합니다.
다른 태그, 저장소 경로, 레지스트리 포트, 다이제스트 참조 및 정확한 이미지 ID 검사는
계속 구분됩니다.

이전 두 목록 체크섬 매니페스트는
`python3 bootstrapper/recovery.py verify --directory /path/to/recovery --checksums-only`로
명시적으로 감사할 수 있습니다. 이 호환성 감사는 이미지를 로드하거나 서비스를 시작할 수
없습니다. 먼저 일반 검토된 운영자 작업 흐름으로 소스와 별칭 선언을 완성하세요.

## 서비스가 이미 최신인 공개 컨트롤러 업데이트하기

지원되는 변경되지 않은 공식 릴리스는 `upgrade-release.py`와
[공개 업그레이드 안내](../docs/RELEASES.md#upgrade-and-rollback)를 사용하세요. 공개
검증 자료를 내려받고 정확한 전환을 검증하며 일치하는 백업을 조정한 후 아래의
쌍 업데이터를 호출하기 전에 검토된 계획 SHA-256을 요구합니다. 자신의 설치 API
토큰만 필요합니다. 상태와 복구는 같은 보관된 계획 디렉터리를 사용하며 릴리스
게시는 업그레이드를 시작하지 않습니다.

`update-controller.py`는 기존 공개 릴리스 설치가 현재 보안 프로필에서 승인한
GitLab 및 Runner 이미지를 이미 실행하고 있으며 **`recovery/images.json` 아카이브
매니페스트가 없을 때** 사용하세요. 이 명시적 경로는 끊어진 링크를 포함한 기존
매니페스트를 거부하며 만들어 내거나 교체하지 않습니다. 아카이브 기반 설치는 아래의
후속 버전 작업 흐름을 사용합니다.

기본적으로 업데이트는 저장된 기본 구성의 `BOOTSTRAPPER_IMAGE`만 변경합니다.
GitLab, Runner, NGINX 및 Wizard의 정확한 이미지 식별 정보, 관리자 식별 정보,
저장소 선택, 서비스 데이터 및 Seed는 보존합니다. 특히 기존 비공개 Wizard 선택자는
그대로 선택됩니다. 공개 컨트롤러/Wizard 쌍 게시가 구성된 Wizard를 교체하지 않습니다.
GitLab은 이미 후보의 승인된 **대상** 이미지/버전과 일치해야 하고 Runner 이미지도
승인된 대상 증거와 일치해야 합니다. 이는 데이터베이스 마이그레이션, Seed 작업 또는
재빌드 없는 컨트롤러 업데이트입니다.

승인된 보호 기본 브랜치 리비전의 깨끗한 체크아웃, 비공개로 고정한 후속 버전
`release.json` 및 `candidate-results.json`, 승인된 게시 또는 독립적으로 검증한 다른
릴리스 기록의 정확한 공개 컨트롤러 다이제스트를 준비하세요. 소스 프로젝트의 파이프라인/
아티팩트 접근과 현재 Runner 관리자에 대한 관리 `read_api` 권한을 가진 비공개 API
토큰 파일을 보관하세요. 도구는 승격과 같은 후속 버전 증거 검사로 필수 성공 작업,
활성 병합 관문, 보호된 현재 기본 브랜치 헤드 및 바이트가 동일한 CI 아티팩트를 검증합니다.
공개 다이제스트를 가져오고 정확한 승인 컨트롤러 이미지 ID, 소스 레이블 및 후보 작업
레이블도 요구합니다. 아래 명시적 쌍 옵션을 선택하지 않으면 공개 Wizard 이미지는
가져오지 않습니다.

```sh
sudo python3 bootstrapper/update-controller.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/accepted-release/release.json \
  --evidence /root/accepted-release/candidate-results.json \
  --controller docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/private-gitlab-api-token \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/example \
  --check-only
```

경로/도메인을 자신의 입력으로 바꾸고 라이브
`PERSISTENT_DIR/recovery/controller-updates` 아래에 새 체크포인트 디렉터리를
선택하세요. `--check-only`는 승인 이미지를 가져오고 현재 관리자 접속을 기다릴 수
있지만 체크포인트/구성을 쓰거나 서비스를 중지하지 않습니다. `--check-only` 없이
같은 명령을 실행하면 업데이트합니다. `--timeout`은 각 준비 대기를 제한합니다
(60~3600초, 기본값 1200). 현재 저장 구성이 이미 표준 Wizard 별칭을 요구하는 경우
`--redirect-from https://example.com`을 사용하세요.

기존 컨트롤러를 중지하기 전에 도구는 정확한 이미지 선택자/ID, 재시작 정책, 비공개
원본 구성 및 런타임 기준 상태를 보존합니다. 공유 라이브 상태, 인증서 및 환경 임대와
호스트 명령 감시자가 전환을 보호합니다. Sync는 작업 대기열의 유휴 상태를 입증해야
합니다. 기본 모드에서는 빌드와 가져오기를 비활성화한 네이티브 Compose로 컨트롤러만
다시 만듭니다. 승인은 정확한 서비스 이미지와 마운트, 컨트롤러 선택자 외에는 변경되지
않은 구성, 인증된 Sync 가져오기, 신뢰된 애플리케이션 라우팅, 갱신 통합 및 현재 Runner
관리자 모두의 최근 GitLab 접속을 확인합니다. 비공개 `operation.json`,
`baseline-after.json` 및 `verification.json`은 배포된 컨트롤러를 승인된 소스, 이미지
및 후보 작업에 연결하고 다른 서비스 이미지 보존을 별도로 보고합니다.

Wizard 별칭 활성화 같은 이후 구성 변경에는 업데이트 후 일반 검증된 구성/Sync 보내기
흐름을 사용하세요. 별도의 구성 체크포인트를 유지하세요. 업데이트 도구는 임의 구성
편집을 컨트롤러 교체와 결합하지 않습니다. 비공개 `main-after.env`는 이후 조정을 위해
업데이트 후 정확한 구성을 보존합니다.

동일한 체크아웃으로 중단되거나 완료된 업데이트를 점검하거나 롤백하세요.

```sh
sudo python3 bootstrapper/update-controller.py --operation status \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/example
sudo python3 bootstrapper/update-controller.py --operation rollback \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/example \
  --token-file /root/private-gitlab-api-token
```

롤백에는 보존된 이전 이미지와 현재 관리자 검증이 필요하지만 접근 가능한 CI API는
필요하지 않습니다. 조정자와 보호된 명령이 종료된 뒤에만 정확한 중단 임대를 인수하며,
이전 컨트롤러/구성을 복원하고 서비스 데이터를 되돌리지 않고 준비 상태를 확인합니다.
대체 컨테이너 생성 전에 이전 컨테이너를 제거한 Compose 재생성 실패도 처리합니다.
서비스 이미지 ID 변경이나 이후 구성 편집은 롤백을 차단합니다. 재시도 전에 일반
검증된 구성 흐름과 별도 체크포인트로 이후 구성 변경을 조정하세요. 도구는 다른 사람의
편집을 버리지 않습니다. 불확실한 실패는 같은 네이티브 롤백 동작을 위해 소유 임대와
비공개 영수증을 유지합니다. 승인된 버전이 더 이상 복구에 필요하지 않을 때까지
체크포인트와 두 이미지를 보존하세요.

### 승인된 컨트롤러와 Wizard를 의도적으로 함께 업데이트하기

업데이트 명령에 `--wizard docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST`를
추가하여 전체 승인 System 릴리스를 선택하세요. 같은 입력으로 `--check-only`와 이후
업데이트 모두에서 이 옵션을 사용하세요. Wizard가 활성화되어 있어야 합니다. 관리
인터페이스 중단이 발생할 수 있는 단일 유지 관리 작업이며 공유 임대와 네이티브 시작을
사용합니다. 컨트롤러 전용 경로처럼 GitLab과 Runner 이미지는 이미 최신이어야 합니다.

쌍 모드는 정확한 보호 System 기본 브랜치 **push** 파이프라인을 요구합니다.
해당 정확한 소스와 파이프라인에서 모든 일반 내부 검사와 필수 `test:wizard-browser`
작업이 통과해야 합니다. 브라우저 작업은 준비된 소스에 대해 Wizard의 전체 네이티브
Playwright 테스트를 실행합니다. 필수 성공 `deploy:dockerhub` 작업은
`test-results/dockerhub/release.json`을 제공하여 두 공개 다이제스트를 같은 승인 후보
작업, 소스 트리 및 Wizard gitlink에 연결해야 합니다. 고정된 후속 버전 증거는 해당
System 프로젝트의 `successor-wizard` 레지스트리 저장소에 게시된 Wizard 이미지를
식별해야 합니다. 유지 관리 전에 두 공개 이미지를 가져오고 정확한 이미지 ID, 소스
리비전 및 후보 작업 레이블을 검사합니다. Wizard에는 System 소스 리비전도 포함됩니다.
공개 및 비공개 게시 다이제스트가 일치해야 합니다.

이 모드에는 공개 소스 가용성이 필요합니다. 같은 파이프라인의 `deploy:github` 작업이
성공하고 `test-results/github/wizard-source.json`을 보관해야 합니다. 해당 영수증은
`refs/heads/system-release/<wizard-revision>`의 정확한 Wizard gitlink를 식별해야
합니다. 공개 Wizard 저장소는 승인된 System `.gitmodules`에 명명된 저장소여야 합니다. 검증기는 승인 리비전의 인증된 GitLab 소스에서 이 매핑을 읽습니다.
선택적 미러 실패는 컨트롤러 전용 업데이트에서 기존 동작을 유지하지만 쌍 공개 릴리스를
승인할 수는 없습니다.

쌍 System 릴리스는 Wizard 기본 브랜치를 바꾸지 않고 보존된 Wizard 의존 브랜치를
검토하고 고정할 수 있습니다. 새 재귀 체크아웃을 위해 소스와 공개 릴리스 참조를
사용 가능한 상태로 유지하세요. 이는 System 릴리스 출처 증명입니다. 네이티브 Wizard
파이프라인 증거를 만들거나 프로젝트를 채택하거나 표준 소스 기본 바인딩과 승인 CI
매니페스트를 변경하지 않습니다. 일반 소스 기본 Wizard 운영 환경 명령은 여전히
자체의 성공한 현재 기본 브랜치 push와 전달 증거를 요구합니다.

통합 체크포인트는 이전의 두 이미지 선택자와 ID 및 정확한 원본 구성을 보존합니다.
`BOOTSTRAPPER_IMAGE`와 `WIZARD_IMAGE`만 바뀔 수 있습니다. Cube, 관리형 프로젝트
영수증, 다른 설정과 서비스 이미지, 관리자 식별 정보, 저장소 및 Seed는 계속 기준
상태와 대조하여 검증됩니다. 승인된 컨트롤러의 네이티브 시작은 선택한 Wizard를
조정합니다. 두 이전 이미지를 모두 유지하세요. 위의 같은 `status`와 `rollback`
명령은 CI API 없이 서비스 데이터를 되돌리지 않고 쌍을 점검하거나 복원합니다.
관련 없는 Wizard 이미지, 사용할 수 없는 보존 이미지, 변경 구성 또는 불확실한
컨테이너 조회는 롤백을 차단합니다. 입증된 컨트롤러/Wizard 제거 중단은 소유 임대
아래에서 네이티브 재생성으로 처리합니다.

버전이 있는 공개 릴리스의 경우 사전 검사와 업데이트 모두에
`--release-metadata /root/accepted-release/system-release-vX.Y.Z.json`도 전달하세요.
선택한 [공개 릴리스](../docs/RELEASES.md)에서 메타데이터와 체크섬을 확보하세요.
이 옵션에는 `--wizard`가 필요하며 제품 버전, 소스 트리, Wizard gitlink, 두 이미지,
후보 작업 및 증거 해시를 독립적으로 검증된 승인 시도에 연결합니다. 최초 개발 미리보기
설정에 사용하는 비공개 `.release-images.json` 및 `.release-images.env` 선택을
갱신합니다. 기존 데이터에 새 호스트 설치 프로그램을 실행하지 않습니다. 이 옵션이
없으면 기존 릴리스 선택 파일은 유지됩니다.

동일한 업데이트 체크포인트는 정확한 이전 선택 바이트와 파일 메타데이터, 검증된 공개
메타데이터 및 새 선택을 보존합니다. 각 선택 파일은 유지 관리 임대 아래에서 원자적으로
교체됩니다. 롤백은 원래 없었던 상태까지 포함하여 이전 파일을 복원하고, 정확히 알려진
이전/새 파일만 포함하는 중단된 교체를 허용합니다. 관련 없는 선택 편집이나 체크포인트
페이로드 변경은 서비스를 중지하기 전에 롤백을 차단합니다. 이 영수증을 체크포인트 및
두 이미지와 함께 보관하세요.

이 설치 유형을 독립적으로 런타임 검사하려면 기준 상태와 검사 모두에 명시적인 공개
이미지 모드를 선택하세요.

```sh
sudo python3 bootstrapper/verify-runtime.py baseline --public-images \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --output /root/public-runtime-baseline.json
sudo python3 bootstrapper/verify-runtime.py check --public-images \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --baseline /root/public-runtime-baseline.json --output /root/public-runtime-check.json \
  --gitlab-token-file /root/private-gitlab-api-token --timeout 1200 \
  --redirect-from https://example.com
```

리디렉션 옵션은 구성된 별칭에만 제공하세요. 기준 상태는 저장 구성, 선택한 이미지 식별
정보 및 관리자 식별 정보를 결합합니다. 의도적인 구성 변경 후에는 새 기준 상태를
캡처하세요. Docker Hub의 선택적 `docker.io/` 접두사는 다이제스트 검증에서 정규화하며
비공개 레지스트리 이름과 포트는 정확히 유지합니다. 이 모드가 이미지 아카이브, 비공개
레지스트리 페이로드 또는 일치하는 구성과 Seed 복구 입력을 불필요하게 만들지는 않습니다.

### 이미 중지된 컨트롤러 복구하기

컨트롤러 시작 실패로 정상 상태에서의 일반 업데이트를 수행할 수 없을 때만
`--repair-stopped-controller`를 사용하세요. 이 명시적 모드에도 동일한 승인된
컨트롤러/Wizard 조합과 `--wizard`, `--release-metadata`가 필요합니다.
소스, CI, 게시, 이미지 또는 저장소 검증을 완화하거나 GitLab을 마이그레이션하거나
Seed를 적용하거나 대기 중인 프로젝트 영수증을 폐기하지 않습니다.

정확한 정식 컨트롤러가 선택된 이미지 및 마운트와 함께 여전히 존재해야 합니다.
컨트롤러는 128 미만의 0이 아닌 상태 코드로 정상 종료되었고, 실행 중인 PID나 exec 세션이
없으며, OOM이 발생하지 않았고, 재시작 정책이 `no`여야 합니다. 이 모드의 중지 상태
롤백으로 보존된, 한 번도 시작하지 않은 컨트롤러도 허용됩니다. 실행 중, 일시 정지,
재시작 중, 누락 또는 소유권이 불명확한 컨테이너는 거부됩니다. GitLab, 진입 프록시,
활성화된 Wizard 컨테이너 및 선택된 모든 러너 관리자는 예상 이미지와 마운트로 계속
실행 중이어야 합니다. 공개 GitLab 및 레지스트리 경로도 작동해야 합니다.
복구 후에는 공개 Wizard/Sync의 준비 상태가 확인되어야 합니다.

정상 컨트롤러를 강제 종료하거나 미완료 작업의 잠금을 제거하려고 이 옵션을 사용하지
마세요. 먼저 실패한 컨트롤러를 점검하세요.

```sh
sudo docker inspect --format '{{json .State}} {{json .HostConfig.RestartPolicy}} {{json .Config.Labels}}' system_bootstrapper_1
```

PID가 0인 실패한 재시작 반복 상태가 확인되면 해당 컨트롤러의 재시작 정책만
비활성화하고 이미 종료된 컨테이너를 중지하세요. 실행 중인 프로세스를 강제 종료하지
마세요. 계속하기 전에 실행 중이거나 중단된 저장소, 인증서, 이미지 복구 또는
업그레이드 작업을 해당 작업의 복구 절차로 해결하세요.

```sh
sudo docker update --restart=no system_bootstrapper_1
sudo docker stop --timeout 30 system_bootstrapper_1
```

진입 프록시가 없으면 라우팅을 복원하기 전에 생성된 템플릿과 포함된 구성 조각을
점검하세요. 여기에는 GitLab과 레지스트리뿐 아니라 애플리케이션 경로와 별칭도
포함될 수 있습니다. 예상 경로가 모두 있고 기존 서비스 주소와 인증서가 올바른지
확인하세요. 기존 라이브 디렉터리와 이미 선택된 NGINX 이미지를 사용하고 아래 예시를
검증된 값으로 바꾸세요. 수신 포트를 열지 않고 구성을 검증한 다음 커밋된 Compose
정의를 통해 `web`만 시작하세요.

```sh
sudo env PERSISTENT_DIR=/var/lib/system-bootstrapper/platform \
  NGINX_IMAGE=nginx@sha256:REPLACE_WITH_64_HEX_DIGEST \
  docker --host unix:///var/run/docker.sock compose --compatibility \
  --env-file /dev/null -p system -f system/docker-compose.yml \
  run --rm --no-deps --pull never web nginx -t
sudo env PERSISTENT_DIR=/var/lib/system-bootstrapper/platform \
  NGINX_IMAGE=nginx@sha256:REPLACE_WITH_64_HEX_DIGEST \
  docker --host unix:///var/run/docker.sock compose --compatibility \
  --env-file /dev/null -p system -f system/docker-compose.yml \
  up --no-deps --no-build --pull never -d web
```

이 라우팅 단계에서는 전체 프로젝트의 `up`, `down`, 고아 컨테이너 제거 또는 새 이미지
선택을 사용하지 마세요. 일반 인증서 검증으로 GitLab HTTPS와 레지스트리 인증 챌린지를
검증하세요. 이 작업은 점검한 템플릿에 실제로 있는 경로만 복원합니다.
플랫폼 복원이 완료되었음을 입증하지는 않습니다.

그런 다음 변경 사항이 없는 검토된 체크아웃에서 승인된 복구를 사전 점검하세요.

```sh
sudo python3 bootstrapper/update-controller.py \
  --repair-stopped-controller \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/accepted-release/release.json \
  --evidence /root/accepted-release/candidate-results.json \
  --controller docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST \
  --wizard docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST \
  --release-metadata /root/accepted-release/system-release-vX.Y.Z.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/private-gitlab-api-token \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/repair-example \
  --check-only
```

사전 점검은 여전히 실행 중인 관리 서비스를 확인하며, 사용할 수 없는 기존 컨트롤러의
Sync API에 유휴 대기열 확인을 요청하는 대신 기존 컨트롤러가 쓰기를 수행할 수 없음을
입증합니다. 공유 유지 관리 임대를 획득한 상태에서 동일한 식별 정보, 작업 및 구성
보호 조건을 다시 확인합니다. 현재 작업이 없는 대기 중 프로젝트 영수증은 이후
**가져오기 → 수정 → 저장** 복구를 위해 그대로 유지됩니다.

동일한 승인 입력값으로 `--check-only`를 제외하고 반복하세요. 두 릴리스 이미지 선택자와
해당 릴리스 메타데이터만 변경됩니다. 완료하려면 여전히 일반적인 전체 런타임 검증이
필요합니다. 인증된 Sync 가져오기, 공개 Wizard 및 구성된 별칭, 저장소/이미지 식별 정보,
인증서 통합과 현재 모든 러너 관리자의 새로운 접속을 검증해야 합니다.

일반적인 `status` 및 `rollback` 명령은 보존된 복구 체크포인트를 사용합니다.
복구 롤백은 정확한 이전 구성과 릴리스 선택자를 복원하며, 이전 컨트롤러를
**실패한 코드를 시작하지 않고** 다시 생성합니다. 정상 플랫폼이 아니라 중지 상태
롤백으로 보고되며 Wizard/Sync는 계속 사용할 수 없을 수 있습니다. GitLab 데이터는
절대 이전 시점으로 되돌리지 않습니다. 복구한 릴리스가 승인될 때까지 체크포인트,
이전 이미지 및 서로 일치하는 Seed/구성 백업을 보관하세요.

## 검증된 후속 컨트롤러 승격하기

`promote-controller.py`는 같은 성공한 전체 후보 작업이 게시한 고정된 `release.json` 및
`candidate-results.json` 아티팩트를 사용합니다. 구성된 GitLab API를 통해 정확한
바이트, 보호된 기본 브랜치와 소스 트리/gitlink, 모든 필수 내부 작업 및 정확한 후보
작업 ID를 검증합니다. 구성된 필수 병합 관문은 활성화되어 있어야 합니다. 허용되는 유일한
관련 없는 파이프라인 실패는 기존 선택적 공개 GitHub 미러 작업입니다. 내부 필수 작업이
실패, 누락, 건너뛰기 또는 실패 허용 상태이면 승격을 거부합니다. API 및 레지스트리 자격
증명은 공개 아티팩트가 아니라 비공개 운영자 토큰 파일에서 읽습니다.

아티팩트의 정확한 소스 리비전에 변경 없는 검토된 체크아웃을 준비하고 다운로드한 입력은
모드 0600으로 유지하세요. 토큰에는 프로젝트/아티팩트 읽기 권한과 게시된 레지스트리
이미지 읽기 권한이 필요합니다. 명령은 먼저 새 비공개 임시 Docker 로그인으로 게시된
불변 레지스트리 참조를 가져와 정확한 이미지 ID와 소스/작업 레이블을 검증합니다.
이후 로컬 선택자 `system-successor:<source-revision>-job<candidate-job-id>`를 기록합니다.
이 로컬 별칭 자체는 불변이 아닙니다. 승인된 CI 증거, 이미지 ID 및 기록된 아카이브
체크섬이 식별 정보를 확립합니다. 이를 사용하면 새 호스트는 컨트롤러 자체의 GitLab
레지스트리가 시작되기 전에 컨트롤러를 시작할 수 있습니다.

```sh
sudo python3 bootstrapper/promote-controller.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/successor/release.json \
  --evidence /root/successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/gitlab-operator-token \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/example \
  --cold-maintenance
```

같은 입력에 `--check-only`를 사용하면 서비스 변경 없이 소스/CI를 점검합니다.
일반 승격은 프로젝트 작업의 정지 상태를 보고하는 Sync API가 필요합니다. 이전 API에서
필드를 생략한다고 이를 입증할 수는 없습니다. 이 경우 실제 유지 관리 프로토콜을
수행하는 `--cold-maintenance`가 필요합니다.

1. 네이티브 컨트롤러, Seed, 인증서 및 환경 임대를 획득하고 현재 컨트롤러/이미지/재시작
   정책 및 정확한 저장 구성을 보존합니다.
2. 소유한 공개 프록시를 중지하고 이전 컨트롤러의 자동 재시작을 비활성화하며 프로세스를
   일시 중지합니다. 유한한 예산으로 남아 있는 원격 GitLab exec를 비웁니다.
3. GitLab NGINX, Workhorse 및 Puma 인입을 중지합니다. 서비스가 중지되었음을 확인한
   뒤에만 공유된 커밋 GitLab 사전 검사로 실행 중인 작업이나 미완료 백그라운드
   마이그레이션이 없음을 입증합니다. 작업이 첫 검사와 경합했다면 작업이나 데이터베이스를
   중지하지 않고 이전 인입/컨트롤러/프록시를 재개하고 승격을 연기합니다.
4. 소유한 기존 Runner 관리자를 중지하고 GitLab 서비스를 정상 종료하며 컨테이너 종료가
   OOM 없이 0인지 검증합니다. 명시적 일시 중지 해제 없이 동결된 이전 컨트롤러를
   종료합니다. 비활성화된 재시작 정책이 이전 코드의 복귀를 막습니다. 작은 명시적
   Docker 픽스처가 이 기본 동작을 검사합니다.
5. 승인 이미지 자체의 `rsync`로 콜드 GitLab 및 구성 상태를 복사하고 검증하며 소유권,
   권한 및 심볼릭 링크를 보존합니다. 진행 전에 복사한 파일, 디렉터리 및 체크포인트
   게시를 fsync합니다.
6. Cube와 이전 GitLab 이미지 설정을 보존하며 저장된 컨트롤러 선택자만 변경합니다.
   Compose로 정확한 승인 컨트롤러를 시작합니다. 일반 커밋된 시작 절차는 프록시,
   Wizard 및 Runner를 조정할 수 있습니다. GitLab이 여전히 이전 이미지/버전을
   실행하는 동안 저장 가져오기, 라우팅, 필수 데이터 마운트 및 보존 관리자 식별 정보를
   검증합니다. 검토된 GitLab 마이그레이션은 별도로 수행합니다.

이 작업은 중단 시간이 있는 유지 관리이며 무중단 컨트롤러 교체가 아닙니다. 콜드
체크포인트에는 GitLab 데이터 사본 하나를 더 담을 여유 공간이 필요합니다. 비우기,
중지, 복사 또는 시작이 불확실하면 복구를 위해 정확한 소유 임대와 비공개 작업 기록을
남기며 데이터베이스가 안전하다고 추측하지 않습니다.

### GitLab 마이그레이션 전에 승인 컨트롤러 교체하기

GitLab이 이전 검토 이미지를 실행하는 동안 컨트롤러 준비가 성공했다면 복구 매니페스트는
의도적으로 여전히 원래 아카이브 세대를 설명합니다. 더 새로운 승인 후보는 저장 선택자나
복구 매니페스트를 편집하지 않고 같은 진입점으로 준비된 컨트롤러를 교체할 수 있습니다.

```sh
sudo python3 bootstrapper/promote-controller.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/successor/release.json \
  --evidence /root/successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/gitlab-operator-token \
  --staged-promotion /mnt/bootstrapper-data/platform/recovery/controller-promotions/previous \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/replacement
```

서비스 변경 전에 이 입력으로 `--check-only`를 사용하여 두 후보와 현재 준비 상태를
검증하세요. 이전 디렉터리에는 완료된 네이티브 승격 기록, 원본 저장 구성과 복구
매니페스트가 있어야 하며, 이전 작업이 콜드 유지 관리를 사용했다면 검증된 콜드
체크포인트도 있어야 합니다. 도구는 인증된 후보 작업에서 이전 릴리스와 증거를 다시
다운로드하고 모든 필수 작업, 보호 기본 브랜치 및 활성 병합 관문을 확인합니다.
이후 실행 중인 컨테이너 식별 정보, 이미지, 소스/작업 레이블, 불변 레지스트리 다이제스트,
로컬 별칭 및 정확한 구성 해시를 검증합니다. 아카이브 소스는 준비된 소스의 조상이어야
하며 준비된 소스는 새 후보의 조상이어야 합니다. 이전 GitLab 이미지와 원래 복구
매니페스트는 정확히 유지되어야 합니다. 완료된 이전 후보만 과거 기록일 수 있습니다.
새 후보는 여전히 현재 보호 기본 브랜치와 모든 일반 승인 관문에 일치해야 합니다.

증거는 호스트 검증에 메모리 내 이미지 선언을 제공할 뿐 아카이브를 게시하거나
`recovery/images.json`을 변경하지 않습니다. 새 작업은 중단 작업 복구를 위해 이전
영수증 식별 정보와 이전 컨트롤러를 보존합니다. 준비된 컨트롤러가 필수 Sync 정지 상태
필드를 보고하면 `--cold-maintenance`를 생략하세요. 또 다른 전체 GitLab/구성 복사 없이
일반 네이티브 임대와 유휴 검사가 이를 대체합니다. 이전 GitLab은 계속 실행됩니다.
미완료 업그레이드, 마이그레이션, 영수증 불일치 또는 변경된 구성은 교체를 거부합니다.
최종 복구 입력은 별도로 검토된 GitLab 마이그레이션 성공 후에만 기존의 엄격한 복구
내보내기 흐름으로 게시하세요.

컨트롤러 콜드 목록에는 별도의 128 MiB JSON 제한이 있으며 원자적 게시 전과 검증/복구
읽기 시 검사합니다. 새 콜드 체크포인트를 승인하기 전에 파일, 소유권, 모드 및 심볼릭
링크를 다시 검증합니다. 일반 비공개 운영자 입력과 인증 API 응답에는 8 MiB 제한을
유지합니다. GitLab 마이그레이션 도우미는 자체 체크포인트 형식과 제한을 사용합니다.
컨트롤러 체크포인트는 해당 도우미의 롤백 동작 입력이 아닙니다.

커밋된 진입점으로 중단된 컨트롤러 작업을 점검하거나 중단하세요.

```sh
sudo python3 bootstrapper/promote-controller.py --operation status \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/example
sudo python3 bootstrapper/promote-controller.py --operation abort \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/example
```

Abort는 기록된 오래된 임대만 인수하고 제한된 원격 명령이 끝나기를 기다리며,
백업/현재 구성 해시와 이전 GitLab 이미지를 확인하고, 있으면 완료된 콜드 체크포인트를
검증합니다. 데이터베이스 종료 전에는 변경되지 않은 이전 세대를 재개합니다.
컨트롤러 시작 실패 후에는 같은 이전 GitLab 데이터에서 이전 컨트롤러와 구성을
복원할 수 있지만 데이터베이스를 되돌리지는 않습니다. GitLab 이미지가 변경되었거나
마이그레이션이 완료되면 이 경로를 거부합니다. 대신 GitLab 업그레이드 도우미의
검증된 데이터베이스 체크포인트 복구를 사용하세요. 완료된 컨트롤러 승격은 중단된
작업으로 취급하지 않습니다. 호스트 명령은 커밋된 `host-child.py` 감시자를 통해
실행됩니다. 이 감시자는 안정적인 파일시스템 보호를 상속하고 작업자 시작 장벽을 풀기
전에 PID/시작/프로세스 그룹 식별 정보를 기록하며 소유한 전체 명령 그룹을 제한하고
회수합니다. 채택은 조정자 SIGKILL 후를 포함하여 살아 있는 조정자, 감시자 또는 작업자
그룹을 거부합니다. 보호 파일은 디스크에 남으며 획득된 잠금을 우회하려고 삭제/재생성하지
않습니다.

## 다음 호스트를 위한 후속 버전 기록하기

GitLab 마이그레이션 성공 후 VM 삭제나 이후 호스트 교체에 의존하기 전에 보존 복구
입력을 갱신하세요.

```sh
sudo python3 bootstrapper/record-recovery-images.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/successor/release.json \
  --evidence /root/successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/gitlab-operator-token \
  --output /root/successor/recovery-export.json
```

내보내기 도구는 승인 CI/소스/이미지 식별 정보와 실제 마이그레이션된 GitLab 이미지/
구성을 다시 검사합니다. 제한된 Docker-save 기한 내에 정확한 실행 컨트롤러를 고유
이름의 gzip 아카이브로 스트리밍한 다음, 원자적으로 게시하기 **전에** 실제 파일과
대조하여 완전한 새 소스/이미지/별칭 매니페스트를 검증합니다. 이전 매니페스트의 정확한
바이트, 이전 아카이브/버전별 별칭 및 기존 Wizard 이미지 구성/아카이브를 보존합니다.
게시된 표준 컨트롤러 레지스트리 참조는 출처 메타데이터로 유지되며 새 호스트 복구는
검증된 오프라인 로컬 별칭을 사용합니다. 새 공개 GitLab 선언은 실행 중인 마이그레이션
이미지와 일치하므로 복구가 이전 버전을 조용히 선택할 수 없습니다.

중단된 내보내기는 이전 입력을 선택한 채로 두고 완료된 추가 아카이브를 보존합니다.
재시도는 이를 덮어쓰거나 삭제하는 대신 다른 작업 아카이브를 만듭니다. 내보내기 도구와
`recover-volume.sh --verify`가 통과할 때까지 호스트를 삭제하지 마세요.

격리 계약은 `python3 tests/bootstrapper/native-initialization.py`와
`python3 tests/bootstrapper/successor-host-tools.py`로 실행합니다. 명시적인 작은
Docker 기본 동작 테스트는 소켓 없는 구성 요소 테스트와 별도입니다.
`node tests/bootstrapper/paused-controller-docker.js --allow-local-daemon`을 사용합니다.
정확한 레이블이 있고 제한된 폐기 가능 로컬 컨테이너 하나만 사용하며 라이브 GitLab
설치는 사용하지 않습니다.

## 네이티브 호스트 런타임 준비

Quickstart는 고정된 커밋과 스크립트 해시를 확인하여 nvm **0.41.0**을 설치한 뒤,
nvm으로 Node **24.22.0**을 설치합니다. 전용 설치 경로는
`/opt/system-bootstrapper-runtime`이며 기존 사용자의 nvm 설치, 기본 버전과
셸 프로필은 변경하지 않습니다. nvm이 내려받은 Node 압축 파일의 고정 해시도
확인합니다. 컴파일된 Operations 파일과 의존성은 승인된 Controller 이미지에서
복사하며, 추출용 컨테이너는 시작하지 않습니다. 호스트에서 npm 설치를 실행할
필요가 없습니다.

수동 설치에서는 먼저 네이티브 호스트 의존성을 설치하고, 검토된 릴리스의 소스를
체크아웃한 다음 공개 메타데이터를 검증합니다. 릴리스 설치 도구를 실행하기 전에
다음 명령으로 런타임을 준비하세요.

```sh
sudo python3 bootstrapper/prepare-host-runtime.py \
  --checkout "$PWD" --release-metadata /absolute/path/release.json
```

기존 런타임 디렉터리는 덮어쓰지 않습니다. 오프라인 복구를 위해
런타임 디렉터리와 `operations/dist`, `operations/node_modules`를
보존하세요. 도구는 저장된 Node 실행 파일의 절대 경로를 사용하므로 복구 중에는
nvm, 셸 프로필이나 npm 네트워크 접근이 필요하지 않습니다. 실행 파일 경로는
`/opt/system-bootstrapper-runtime/node-executable`에 기록됩니다.
