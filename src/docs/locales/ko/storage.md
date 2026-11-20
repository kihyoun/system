# 작업 데이터와 독립적인 Seed 백업

플랫폼의 저장소에는 두 가지 역할이 있습니다.

| 역할 | 용도 | 필요 시점 |
| --- | --- | --- |
| 라이브 작업 데이터 (`PERSISTENT_DIR`) | GitLab/데이터베이스/레지스트리 데이터, 구성, 인증서 및 Runner 상태. | 플랫폼 실행 중에 필요합니다. |
| Seed 백업 (`SEED_DIR`) | Harvest가 만들고 명시적 복원 시 읽는 검증된 콜드 스냅샷. | Harvest 또는 복원 시에만 필요합니다. |

새 Ubuntu/WSL 설치는 자체 시스템 디스크를 라이브 데이터에 사용합니다. 외부 디스크,
USB 메모리 또는 클라우드 볼륨은 사전 요구사항이 아닙니다. 별도 매체에 Seed를 보관하면
시스템 디스크 손실 후 복구할 수 있습니다. 구성 백업은 별도의 Wizard 내보내기이며,
소스/이미지는 선언된 복구 입력으로 유지됩니다. Seed는 계속 동기화되는 데이터베이스
사본이 아닙니다.

## 경로와 선택자

저장소 선택자가 없으면 새 설치는 다음을 사용합니다.

```sh
PERSISTENCE_MODE=local
PERSISTENT_MOUNT=/
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
```

선택적인 root 소유 파일 `/etc/system-bootstrapper/persistence.env`로 사용자 지정
배치를 선택합니다. WSL에서는 `/mnt/c` 같은 Windows 마운트 디렉터리 대신 Linux
저장소를 사용하세요. 로컬 사전 검사는 정규 경로, 권한, 쓰기 가능한 공간 및 필요한
Unix 파일시스템 동작을 확인합니다. 파일은 모드 0600으로 보호하세요.

연결된 파일시스템에 라이브 데이터를 두려면 명시적으로 선택하세요.

```sh
PERSISTENCE_MODE=volume
PERSISTENT_MOUNT=/mnt/bootstrapper-data
PERSISTENT_DIR=/mnt/bootstrapper-data/platform
PERSISTENT_UUID=REPLACE_WITH_EXISTING_FILESYSTEM_UUID
```

`PERSISTENT_MOUNT`가 있고 모드가 없는 기존 선택자는 레거시 볼륨 계약을 유지합니다.
선택한 라이브 볼륨이 없거나 일치하지 않으면 시작이 중단됩니다. 루트 디스크의 새
디렉터리로 대체하지 않습니다. 모드나 경로 편집은 기존 데이터를 마이그레이션하지 않습니다.
배치를 바꾸기 전에 쓰기를 중지하고 의도적으로 검증된 복사본을 만드세요. 선택한 바인딩
대상이 바뀌면 기존 Docker 볼륨 메타데이터도 의도적으로 조정해야 합니다.

## 백업 매체를 독립적으로 선택하기

필요할 때 같은 비공개 선택자에 백업 대상을 추가하세요.

```sh
SEED_MOUNT=/media/bootstrapper-backup
SEED_DIR=/media/bootstrapper-backup/seed
SEED_UUID=REPLACE_WITH_BACKUP_FILESYSTEM_UUID
```

Harvest 또는 복원 전에 해당 기존 파일시스템을 의도적으로 마운트하고 `seed`
디렉터리를 만드세요. `SEED_MOUNT`는 의도한 마운트 대상을 요구합니다. 마운트가
없으면 오류이며 루트 디스크에 비슷한 백업 디렉터리를 만들어도 된다는 뜻이 아닙니다.
`SEED_UUID`는 식별 검사를 추가합니다. 로컬 모드 설치에는 다른 파일시스템에 명시적으로
마운트한 외부 Seed 대상이 필요합니다. 이는 유일한 복구 사본을 복구해야 할 VM 디스크
자체에 백업하지 않게 합니다. 레거시 볼륨 설치는 명시적으로 선택한 같은 라이브 볼륨에
서로 겹치지 않는 Seed 디렉터리를 유지할 수 있습니다. 그러나 해당 볼륨을 잃으면 두
사본을 모두 잃습니다.

라이브와 Seed 루트는 정규화된 서로 겹치지 않는 경로여야 합니다. 어느 쪽도 다른 쪽을
포함할 수 없습니다. 경로를 벗어나는 심볼릭 링크, 겹치는 루트 및 예상하지 못한 중첩
마운트는 거부됩니다. 라이브 데이터와 Seed는 다른 파일시스템에 있을 수 있습니다.
저장소 검사는 독립적이므로 백업 대상이 없어도 일반 시작, Docker 수명 주기, 구성
가져오기/보내기 또는 인증서 갱신을 차단해서는 안 됩니다.

컨트롤러와 GitLab은 `/seed` 마운트를 유지하지 않습니다. 명시적 작업은 정확한
컨트롤러 이미지에서 임시 도우미를 시작하고 호스트 경로/마운트 식별 정보를 검증하며
해당 작업에만 백업 저장소를 바인딩합니다. Harvest는 GitLab을 중지하기 전에 대상과
여유 공간을 확인합니다. 라이브 구성 디렉터리의 공유 임대가 다른 백업 대상을 선택해도
작업을 직렬화하며, 두 번째 임대는 인증서 갱신을 배제합니다. 작업과 도우미가 모두
완료된 후에만 백업 매체를 분리하세요.

## 라이브 디렉터리 배치

아래 배치는 어느 모드에서든 `PERSISTENT_DIR`을 기준으로 합니다.

```text
platform/
├── configuration/        # Main settings, project receipts and Sync auth
├── wizard-public/        # Derived public operator/privacy details only
├── gitlab/
│   ├── config/           # GitLab secrets and service configuration
│   ├── logs/
│   └── data/             # Repositories, database, registry and artifacts
├── ssl/                  # Served certificates and HTTP-01 webroot
├── templates/            # Proxy and managed environment fragments
├── synctemplates/
├── runners/
│   └── <pool>/<index>/
│       ├── config/       # Runner auth and stable manager system ID
│       └── home/
└── host/
    └── letsencrypt/      # Full Certbot account/archive/live/renewal tree
```

선택적 `recovery/` 자료에는 이미지 아카이브와 복구 매니페스트를 둘 수 있습니다.
소스는 새로 가져올 수 있으며 필수 라이브 서비스 상태가 아닙니다. 서비스 데이터를
복사할 때 숫자 소유권, 모드 및 심볼릭 링크를 보존하고, 구성, 자격 증명 및 인증서
키는 제한적인 권한으로 보호하세요.

Compose 이름 있는 데이터 볼륨은 `PERSISTENT_DIR` 아래의 명시적 local-driver 바인딩
대상을 사용하며 Runner 관리자는 각자 디렉터리를 바인딩합니다. 볼륨 이름만 믿지 말고
실제 소스와 파일시스템을 확인하세요. 컨트롤러는 구성을 `/state`에 마운트하고
`SYSTEM_CONFIG_DIR=/state`를 사용합니다. 호환성 링크 덕분에 셸 스크립트와 Sync는
같은 저장 설정과 영수증을 읽습니다. 연결된 설정이 이미지에 내장된 파일보다 우선합니다.

각 Runner 관리자는 풀의 GitLab Runner 레코드를 공유하면서 별도의 시스템 ID를
유지합니다. 축소해도 재사용을 위해 디렉터리를 보존합니다. 캐시와 작업 공간은 다시
만들 수 있으며 구성과 Seed를 함께 사용하는 복구의 입력이 아닙니다.

컨트롤러는 공개 Website 설정 6개만 `wizard-public/privacy-instance.json`으로
파생합니다. Wizard는 해당 디렉터리를 읽기 전용으로 마운트합니다. 비공개 구성,
Sync 자격 증명 및 GitLab 토큰은 절대 복사하지 않습니다. 공개 설정이 없으면 예제로
표시된 값을 사용하며 저장된 빈 값은 비워 둡니다. 파일은 구성에서 다시 생성할 수 있습니다.

## 인증서와 호스트 통합

전체 Certbot 트리를 `host/letsencrypt` 아래에 보존하세요. 계정 키,
`archive`, `live`, 갱신 구성 및 훅을 포함해야 합니다. `live` 심볼릭 링크만으로는 부족합니다.
Certbot을 별도로 설치한 다음 선택한 체크아웃에서
`sudo bash bootstrapper/install-volume-host.sh`를 실행하세요. 호환성 이름을 가진
설치 프로그램은 두 라이브 저장 모드를 모두 처리합니다. 볼륨 모드는 fstab/Docker
마운트 의존성을 유지하며 로컬 모드는 외부 저장소 사전 요구사항을 추가하지 않습니다.
두 모드 모두 분리 가능한 Seed 매체에 대한 의존성을 추가하지 않습니다.

호스트 통합은 `/etc/letsencrypt`를 보존된 라이브 상태에 연결하고 인증서 배포 훅과
갱신 임대를 설치하며 webroot 경로를 `PERSISTENT_DIR/ssl/acme-http01`로 다시
바인딩합니다. NGINX는 이 디렉터리를 `/ssl/acme-http01`에서 제공합니다. 호스트와
라이브 저장소의 활성 Certbot 상태가 충돌하면 조정해야 합니다. 사용 가능하면 설치
프로그램은 `certbot.timer`를 활성화합니다. NGINX에 접속할 수 있게 되면 다음을 실행하세요.

```sh
sudo system-certbot renew --dry-run
```

수동 갱신에도 이 래퍼를 사용하세요. Harvest 또는 복원이 진행 중일 때 관리되지 않는
Certbot 프로세스로 인증서 상태를 변경하지 마세요.

## 외부 Seed로 호스트 교체하기

로컬 라이브 데이터가 있는 머신을 삭제하기 전에 완료된 Seed, 이에 맞는 별도의 Wizard
구성 백업 및 기록된 소스/이미지 입력을 보관하세요. 해당 머신을 삭제하면 로컬 작업
데이터도 삭제됩니다. 이전 백업을 연결한다고 이후 변경의 스냅샷이 되는 것은 아닙니다.

새 호스트에서 [구성과 Seed를 함께 사용하는 복구](RECOVERY_CONTRACT.md)를 따르세요.
새 로컬 디렉터리를 선택하고 백업 대상을 연결하며, 쓰기를 시작하기 전에 완료된 Seed를
검증하고 복원한 뒤 서비스를 시작하세요. 원본 라이브 디렉터리는 복구 입력이 아닙니다.
복원과 검증 성공 후 임시 도우미를 제거하고 백업 매체를 분리하세요. 일반 작업과 TLS
갱신은 새 로컬 라이브 데이터에서 계속됩니다.

이미 데이터가 있는 라이브 볼륨을 유지하고 다시 연결하는 방식은 아래에 설명하는 별도
편의 절차입니다. 외부 Seed 복구를 입증하지는 않습니다.

## 라이브 데이터를 보존하며 VM 교체하기

1. 저장소를 분리하기 전에 쓰기를 정상 중지하세요. VM 삭제 시 볼륨을 명시적으로
   보존하고 포맷하거나 그 위에 다른 파일시스템을 초기화하지 마세요.
2. 호환되는 Ubuntu 호스트를 프로비저닝하고 볼륨을 연결하여 기존 파일시스템을
   마운트하세요. 고정 하위 모듈을 포함한 의도한 System 리비전을 가져오세요.
   `sudo bash bootstrapper/install.sh`로 Docker를 설치하고 Certbot은 별도로 설치하세요.
3. `/etc/system-bootstrapper/persistence.env`를 `PERSISTENCE_MODE=volume`과 보존된
   마운트/디렉터리/UUID 선택자로 다시 만드세요. 마운트/UUID 및 저장 구성을 확인하고
   위의 호스트 통합을 실행하세요. 보존된 라이브 데이터에 이전 Seed를 적용하지 마세요.
4. 필요한 정확한 이미지 참조를 준비하세요. 사용자 지정 컨트롤러 이미지는 의도한
   소스에서 다시 빌드하고, 공개 이미지는 기록된 버전이나 다이제스트로 가져오며,
   불변 비공개 Wizard 고정값을 유지하세요. 선택적 관리형 Review/Beta 도우미의 이전
   로컬 이미지가 없으면 각각 깨끗하게 다시 빌드하고 명시적으로 재프로비저닝해야 합니다.
   [관리형 환경 가이드](../project-bootstrap/wizard-environments/README.md)를 확인하세요.
5. 해당 체크아웃에서 `sudo bash start.sh`를 실행하세요. 저장소를 확인하고 컨트롤러를
   빌드한 뒤 보존된 구성으로 서비스를 시작합니다. 컨테이너 IP, 네트워크 및 프록시
   구성은 다시 생성됩니다. 호스트 주소가 바뀌면 구성된 도메인 이름을 유지하면서 DNS를 바꾸세요.
6. Wizard/Sync, GitLab, 레지스트리 인증, Runner 관리자 및 TLS 갱신을 확인하세요.
   보존된 모든 마운트와 이름 있는 볼륨 장치를 연결된 파일시스템과 대조하세요.

대안인 아카이브 기반 경로는 `bootstrapper/recover-volume.sh`입니다. 운영자가 준비한
`PERSISTENT_DIR/recovery/images.json`, SHA-256 값이 있는 참조 gzip 이미지 아카이브,
공개 이미지 참조 및 보존된 선택자 파일이 필요합니다. 이러한 비공개 복구 아티팩트는
소스 체크아웃에서 제공하지 않습니다. `PERSISTENCE_ENV_FILE`을 해당 선택자로 설정하고
의도한 체크아웃에서 스크립트를 호출하세요. `--verify`는 서비스를 시작하지 않고
저장소와 아카이브 체크섬을 검사합니다. 이 플래그가 없으면 아카이브를 로드하고 누락된
공개 참조를 가져오며 호스트 통합을 설치하고 다시 빌드하지 않고 시작합니다.
사용할 수 없는 로컬 태그나 선언되지 않은 아카이브를 복구 보장으로 여기지 마세요.

### 선택적 이미지 아카이브 준비하기

아카이브 기반 교체에 의존하기 전에 의도한 이미지를 사용할 수 있는 호스트에서 입력을
의도적으로 준비하세요. 비공개 `PERSISTENT_DIR/recovery/images/` 디렉터리를 만드세요.
각 사용자 지정 이미지에 대해 `docker image save <recorded-image-reference> | gzip`을
해당 디렉터리 파일로 스트리밍하고 두 명령의 성공을 확인한 다음 압축 파일의
`sha256sum`을 기록하세요. 원래 이미지 태그를 아카이브에 유지하거나, 저장 전에 기본
저장 구성에서 쓰는 선택자로 이미지를 명시적으로 태그하세요. 불변 도우미 이미지 ID의
경우 정확한 원본 이미지 내용을 보존하세요.

다음 두 목록을 담은 `PERSISTENT_DIR/recovery/images.json`을 작성하세요.
자리표시자를 아카이브의 실제 체크섬과 공개 이미지 참조로 바꾸세요.

```json
{
  "archives": [
    {
      "file": "images/controller.tar.gz",
      "sha256": "<64 hexadecimal characters from sha256sum>"
    }
  ],
  "publicImages": [
    {
      "reference": "nginx@sha256:<recorded digest>",
      "tag": "nginx:retained"
    }
  ]
}
```

보존된 설치와 호환되는 참조로 필요한 모든 사용자 지정 아카이브와 공개 GitLab, Runner
및 프록시 이미지를 포함하세요. 각 공개 항목은 없으면 가져오고 선언된 로컬 별칭을
부여합니다. 이는 저장 구성을 바꾸지 않습니다. 선택된 참조나 별칭이 해당 구성과
일치하는지 확인하세요. 비공개 Wizard 이미지는 정확한 레지스트리 다이제스트로 유지하고
시작 시 보존된 레지스트리에서 복구할 수 있습니다. 매니페스트와 아카이브를 보호하고,
예상 체크섬의 독립 기록을 보관하며, 시작 전에 `recover-volume.sh --verify`로 검증하세요.
이미지 아카이브는 라이브 파일시스템, 완전한 저장 구성 또는 Certbot 상태를 대체하지 않습니다.

로컬과 볼륨 배치 사이에서 라이브 데이터를 의도적으로 옮기기 전에 쓰기를 중지하고
데이터를 일관되게 복사하며 롤백 사본을 보관하세요. 선택자를 바꾸어도 데이터는 복사되거나
마이그레이션되지 않습니다. Docker 볼륨 메타데이터는 정확한 식별 정보와 대상을 확인한
후에만 다시 만드세요. 관련 없는 볼륨을 삭제하거나 전역 Docker prune을 실행하지 마세요.
