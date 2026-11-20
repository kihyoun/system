# 구성과 Seed 복구

복구 입력은 별도로 유지됩니다. Wizard 구성 백업, 완료된 Harvest Seed 및 고정된
Wizard 하위 모듈을 포함하여 새로 가져온 System 소스가 필요합니다. 구성은 Harvest에
복사되지 않으며 Wizard는 서비스 데이터 다운로드를 제공하지 않습니다.

Wizard는 작은따옴표/큰따옴표, 이스케이프된 메타 문자 및 등호를 포함하는 리터럴 셸
할당을 가져옵니다. 백업은 이미지 참조와 호스트 포트 바인딩을 포함하여 모델에 정의되지
않은 런타임 설정을 `main.runtimeOptions` / 프로젝트 `runtimeOptions`에 보존합니다.
JSON과 ZIP 내보내기에는 비밀 정보가 있습니다. 실행 중인 구성처럼 보호하세요. 확장이나
실행이 필요한 셸 표현식은 거부되므로 대신 해석이 끝난 리터럴 값을 제공하세요.
원래 Cube 헤더와 엄격한 형식 검증은 그대로 유지됩니다.

## 복구 메타데이터는 구성과 함께 전달됩니다

일반 JSON 백업은 `recovery`를 포함합니다. ZIP에는 같은 객체가 `bootstrapper.json`과
`recovery.json`에 포함되며 짧은 `RECOVERY.md` 가이드도 있습니다. 버전 형식은
`system-configuration-recovery-v1`입니다. 저장소가 관리하는
`wizard/scripts/export-configuration.ts`는 가져오기/백업과 같은 Wizard 모델을
실행하며, 사용 가능하면 인증된 가져오기 응답의 `recoveryObservation`도 포함합니다.
이 항목이 없는 기존 JSON/ZIP 백업도 계속 사용할 수 있습니다.

메타데이터는 새 백업 타임스탬프와 저장된 정확한 컨트롤러, Wizard, GitLab 및 Runner
이미지 설정을 기록하며 명시적으로 미지정된 설정도 포함합니다. 이 정보는 실행 중인
컨테이너와 해당 불변 이미지 ID/저장소 다이제스트/소스 레이블에 대한 타임스탬프가 있는
인증된 런타임 관찰과 구분됩니다. 관찰 정보가 없는 연결 해제/오프라인 내보내기는
런타임 식별 정보를 알 수 없음으로 보고합니다. `latest`로 대체하거나 리비전을 만들거나
저장 설정이 실제 실행 중인 것으로 관찰되었다고 주장하지 않습니다. 이미지 레이블/승인된
선택에 없는 소스/릴리스 식별 정보는 알 수 없음으로 남습니다. 이전에 가져온 관찰은
자체 관찰 시간을 유지하며 편집된 구성보다 오래되었을 수 있습니다.

메타데이터는 데이터일 뿐입니다. 열기은 이미지, 소스, Seed 또는 저장소 필드를 운영
구성에 적용하지 않습니다. 보내기는 기존 ENV 설정과 프로젝트 파일을 가져옵니다.
설명용 메타데이터로 마이그레이션을 시작하거나 다른 런타임을 선택할 수 없습니다.
정확한 Cube와 모든 런타임 옵션은 계속 왕복 보존됩니다. 열기 후 다시 내보내면 원본
백업 타임스탬프와 설명용 버전 증거를 가진 `importedBackup` 기록 하나가
`imported-unverified`로 표시되어 유지됩니다. 이는 새 관찰이 아닌 과거 데이터입니다.
런타임을 선택하거나 주장된 Seed 일치를 유지할 수 없습니다.

`recoveryTools.minimumSystemProductVersion`은 `1.0.0`입니다. 확장 ZIP 형식과 선택한
Seed를 명시적으로 지원하는 승인된 복구 도구 컨트롤러를 사용하세요. 이전 컨트롤러는
네이티브 복원 중 `recovery.json` / `RECOVERY.md`를 거부할 수 있습니다. 이 요구사항은
백업에 저장된 런타임 고정값과 별개입니다. 이전 구성을 가져와 새 번들로 내보내도
런타임은 업그레이드되지 않습니다. 호환 도구 체크아웃/컨트롤러를 독립적으로 확보하세요.
저장된 이전 컨트롤러를 복원 도우미로 무작정 쓰거나 구성의 이미지를 대체하지 마세요.

일반 구성 전용 내보내기는 구성된 백업 디렉터리에서 Seed 세대나 매니페스트를 추정하지
않습니다. 모든 구성 전용 내보내기는 일치하는 완료 Seed를 명시적으로 요구합니다.
복구 전에 세대, 매니페스트, 타임스탬프 및 정확히 Harvest한 GitLab 이미지를 확인하세요.
이전 Seed와 새 구성은 호환되지 않을 수 있습니다. 번들과 Seed를 독립적으로 보존하세요.
어느 한쪽도 다른 쪽의 존재나 검증을 의미하지 않습니다.

명시적인 [조정된 백업 작업 흐름](COORDINATED_BACKUP.md)은 공유 작업 임대 아래에서
안정된 구성을 캡처하고 네이티브 Harvest를 완료합니다. 일반 구성 ZIP에는 정확히 해당
완료 Seed와의 연결 정보가 포함됩니다. 그래도 두 별도의 복구 입력을 생성하므로 ZIP을
다운로드하여 독립적으로 저장해야 합니다. 가져온 메타데이터는 새로운 Seed 일치를
입증하거나 복구를 승인하지 않습니다.

기록된 승인 제품 릴리스의 경우 [공개 릴리스 메타데이터](RELEASES.md)를 가져오고
고정된 Wizard 하위 모듈과 함께 정확한 소스 커밋을 가져오세요. 소스 빌드/비공개
런타임은 소스와 검증된 이미지 페이로드를 독립적으로 보존하세요. 복구 전에 정확한
불변 참조를 가져오거나 검증된 아카이브를 로드하세요. 참조는 저장된 이미지가 아닙니다.
아래 네이티브 비공개 Wizard 복구는 복원된 레지스트리에서 일치하는 이미지를 가져올 수
있으며 그 페이로드가 일치하는 Seed에 있어야 합니다. 누락된 불변 비공개 이미지를
다시 빌드하고 같은 검증된 이미지라고 설명하지 마세요.

## 작업 디렉터리와 백업 대상 선택하기

라이브 작업 데이터와 Seed 백업 저장소는 독립적입니다. 새 설치는 시스템 디스크의
로컬 작업 데이터를 사용합니다. 외부 대상은 백업 생성 또는 읽기 중에만 필요합니다.
호스트 소유 선택자를 모드 0600 파일, 예를 들어
`/etc/system-bootstrapper/persistence.env`에 넣으세요.

```sh
PERSISTENCE_MODE=local
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
SEED_MOUNT=/media/bootstrapper-backup
SEED_DIR=/media/bootstrapper-backup/seed
SEED_UUID=REPLACE_WITH_BACKUP_FILESYSTEM_UUID
```

작업 전에 실제 기존 백업 파일시스템을 마운트하고 `seed` 디렉터리를 만드세요.
마운트/UUID 검사는 누락된 외부 디스크가 실수로 로컬 디렉터리로 대체되지 않게 합니다.
로컬 라이브 저장소에는 시스템 디스크와 다른 외부 백업 파일시스템을 선택하세요.
레거시 볼륨 배치는 선택한 보존 볼륨에 겹치지 않는 Seed를 유지할 수 있습니다.
대상은 라이브 데이터와 겹치지 않아야 합니다. [저장소 가이드](PERSISTENT_VOLUME.md)를
확인하세요. 일반 시작, 구성 변경 및 TLS 갱신은 이 매체가 필요하지 않습니다. 로컬
작업 데이터가 있는 VM을 삭제하면 데이터도 삭제되므로 교체 호스트에 의존하기 전에
완료된 외부 Seed와 일치하는 구성을 보존하세요.

## 완료된 복구 Seed 만들기

`bootstrapper/install-volume-host.sh`로 호스트 통합을 설치하여 예약된 Certbot 갱신이
`system-certbot`을 사용하게 하세요. 수동 갱신과 갱신 시험 실행에도 같은 래퍼를
사용하세요. 예: `system-certbot renew --dry-run`. 이 래퍼는 Harvest와 파일시스템
임대를 공유합니다. Harvest 중에는 관리되지 않는 Certbot 명령이나 수동 인증서 상태
변경을 수행하지 마세요.

명시적 Harvest는 정확한 컨트롤러 이미지에서 임시 도우미를 시작합니다. 일반
컨트롤러/GitLab 컨테이너에는 `/seed` 바인딩이 없습니다. 도우미는 서비스를 정지시키기
전에 백업 가용성, 호스트 마운트 식별 정보, 권한 및 여유 공간을 확인합니다.
`configuration/.storage-operation-lock`의 전역 라이브 데이터 임대와 갱신 임대를
획득하고, 한도가 있는 긴 runit 대기로 GitLab 서비스를 명시적으로 중지한 뒤,
활성화된 모든 서비스가 내려갔는지 독립적으로 확인하고 컨테이너를 중지합니다. 점검,
서비스 정지 및 컨테이너 종료는 120초 예산을 공유합니다. 최종 컨테이너 종료 코드는
0이어야 하고 Docker가 OOM 종료를 보고해서는 안 됩니다. 강제 종료는 일관된
데이터베이스 사본으로 설명하지 않고 거부합니다. GitLab 중지 중에도 인증된 Sync
상태/가져오기 API는 사용할 수 있습니다. 구성 및 기타 제어 변경은 거부됩니다. 콜드
백업 동안 GitLab/레지스트리 쓰기는 사용할 수 없습니다.

Harvest는 `/srv`, `/ssl` 및 마운트된 Certbot 계정/갱신 상태를 새 비공개 준비
디렉터리에 복사합니다. 일회성 Unix 소켓, FIFO 및 장치 노드는 제외하며 서비스가
프로세스 엔드포인트를 다시 만듭니다. 매니페스트는 모든 파일 체크섬, 소유권, 권한,
심볼릭 링크 대상 및 GitLab 버전/에디션 참조와 이미지 내용 ID를 기록합니다.
준비 페이로드를 검증한 후 `seed/current`를 게시합니다. 이는 완료된
`seed/snapshots/<generation>`에 대한 원자적 링크입니다. 이전 스냅샷과 과거 `seed/srv` / `seed/ssl` 트리는
보존됩니다. 자동 정리하지 않으므로 새 스냅샷 공간을 확보하세요. 복사 실패 시 이전
완료 스냅샷이 계속 선택됩니다. 정상 완료, 실패 또는 처리된 종료 시 GitLab을 재개합니다.
컨테이너가 실행 중인데 서비스 중지가 실패하면 Harvest는 활성화된 모든 서비스를
다시 실행하도록 요청합니다. 이미 실행 중인 컨테이너를 시작하는 것만으로는 서비스가
재개되지 않습니다. 불확실한 원격 중지는 재개 전에 제한 기한까지 기다려 이전 중지가
재시작과 경합하지 않게 합니다. 실패 시 Harvest는 컨테이너 실행 상태, 종료 코드 및
OOM 플래그만 출력합니다.

SIGKILL, 호스트 손실 또는 정전은 정리를 실행할 수 없습니다. 남은
`configuration/.storage-operation-lock`, 백업 `.operation-lock` 또는
`.system-bootstrapper-certificate-lock`은 중단된 작업의 의도적인 증거입니다.
Harvest/복원/갱신 프로세스가 남아 있지 않은지 확인하고 필요하면 GitLab을 시작하며,
재시도 전에 오래된 임대만 제거하세요. `.harvest-*` 준비 디렉터리를 `current`로
승격하지 마세요.

### Wizard 또는 호스트에서 실행하기

대상을 사용할 수 있을 때 인증된 Wizard의 **Harvest**는 `system/harvest.sh`와
같은 저장소 관리 디스패처를 사용합니다. 사용 가능한 승인된 전체 컨트롤러 이미지를
사용하여 검토된 호스트 체크아웃에서 실행할 수도 있습니다. 실제 이미지 식별 정보를
확인하고 기록한 다음 다음을 사용하세요.

```sh
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/seed-operation.sh harvest \
  --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
  --check-only
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/seed-operation.sh harvest \
  --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID
```

`--check-only`는 서비스를 중지하거나 페이로드를 복사하지 않고 입력을 검증합니다.
완료된 작업은 소유한 도우미를 제거합니다. 그 후에만 백업 매체를 분리하세요.
이에 대응하는 **Wizard 구성 백업**을 독립적으로 저장하세요. Harvest는 해당 구성을
Seed에 추가하지 않습니다.

## 외부 Seed를 새 로컬 설치에 복원하기

입력은 완료 Seed, 일치하는 Wizard `bootstrapper.zip`, 고정 하위 모듈이 있는 기록된
System 소스 및 선언된 이미지 참조나 검증된 이미지 아카이브입니다. 이전 라이브
데이터 디렉터리는 입력이 아닙니다.

1. 교체 Ubuntu 호스트에 Docker를 설치하고 의도한 소스 리비전과 고정 하위 모듈을
   체크아웃하세요. `PERSISTENCE_MODE=local`과 새 로컬 `PERSISTENT_DIR`을 선택하거나
   마운트된 라이브 볼륨을 명시적으로 선택하세요. 보존한 백업 파일시스템을 마운트하고
   비공개 호스트 선택자에 `SEED_MOUNT`, `SEED_DIR` 및 예상 UUID를 설정하세요.
   아직 GitLab을 시작하지 마세요. 이 선택자로 라이브 디렉터리와 영구 저장 마커만 준비하세요.

   ```sh
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash -euc 'set -a; source "$PERSISTENCE_ENV_FILE"; source bootstrapper/storage-env.sh; set +a; exec bash bootstrapper/persistence.sh'
   ```

   이 단계는 컨테이너를 시작하지 않으며 백업 매체도 필요하지 않습니다. 새 대상에서는
   `--check-only` 전에 수행해야 합니다. 해당 사전 검사는 경로를 생성하지 않습니다.
2. 승인된 전체 컨트롤러 이미지와 정확히 Harvest한 GitLab 이미지를 준비하세요.
   기록된 정확한 불변 참조를 가져오거나 별도로 보존한 검증 이미지 아카이브를 로드하세요.
   소스 재빌드는 새 이미지 시도이며 기록된 검증 페이로드의 대체가 아닙니다.
   사용자 지정 가변 태그는 복구 가능한 아티팩트가 아닙니다. 불변 비공개 Wizard
   레지스트리 고정값을 보존하세요. 페이로드는 다른 빌드로 대체되지 않고 Seed에 있어야 합니다.
3. 위에서 설명한 호환되는 승인 복구 도구 컨트롤러를 선택하세요. 보존된 저장 런타임
   컨트롤러와 다를 수 있습니다. 새 호스트의 비공개 절대 경로에 구성 ZIP을 두세요.
   승인된 이미지로 저장소가 관리하는 호스트 복원 진입점을 실행하세요.

   ```sh
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash bootstrapper/seed-operation.sh restore \
     --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
     --configuration-backup /root/recovery/bootstrapper.zip \
     --check-only
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash bootstrapper/seed-operation.sh restore \
     --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
     --configuration-backup /root/recovery/bootstrapper.zip
   ```

   저장소 선택은 이 호스트의 것입니다. 이전에 내보낸 작업 경로가 이를 덮어써서는
   안 됩니다. 도우미는 서비스 데이터 쓰기 전에 완료 Seed와 정확한 GitLab 이미지/
   버전/에디션을 검증합니다. 새 빈 골격 디렉터리와 명시적으로 가져온 구성은 허용하지만
   기존 라이브 GitLab/TLS 데이터는 덮어쓰지 않고 거부합니다. 손상되거나 미완료된
   Seed는 유효한 복원 소스가 되지 않습니다.
4. 복원은 검증 후에만 복사합니다. 복사 전에
   `gitlab/data/.system-bootstrapper-restore-incomplete`를 내구성 있게 만들고,
   복원 페이로드 검증 후 내구성 있게 제거합니다. 복사 실패는 보호 마커를 유지하며
   컨트롤러/GitLab 시작은 부분 복원 상태를 거부합니다. 실패 작업을 점검하고 진단을
   위해 부분 대상과 마커를 보존하세요. 도우미 종료를 확인한 뒤 다른 새 라이브
   디렉터리를 선택하여 같은 검증 Seed를 복원하세요. 네이티브 진입점은 부분 데이터
   위에서의 재개를 거부합니다. 마커를 삭제하거나 수동으로 쓰기를 시작하지 마세요.
5. 복원은 Seed 소유권과 모드를 정확히 보존합니다. 오래된 스냅샷의 SSL 루트는 모드
   `0700`일 수 있으며 이 경우 NGINX 작업자가 HTTP-01 챌린지를 제공하지 못합니다.
   쓰기나 인증서 갱신 시작 전에 1단계의 네이티브 준비 명령을 다시 실행하세요.
   공개 챌린지 디렉터리를 준비하고 SSL 루트에 탐색 권한을 추가하되 비공개 인증서
   디렉터리와 키 파일은 변경하지 않습니다. 보존 Seed도 변경하지 않습니다.
   필요하면 Certbot을 설치하고 `sudo bash bootstrapper/install-volume-host.sh`를
   실행하세요. webroot 갱신 경로를 새 라이브 디렉터리에 다시 바인딩하고 갱신/배포
   통합을 설치합니다. 필수 이미지 선택자를 설정하고 `sudo bash start.sh`로 시작하세요.
   이전 불변 이미지가 없으면 선택적 Review/Beta 도우미를 명시적으로 재프로비저닝하세요.
   [환경 절차](../project-bootstrap/wizard-environments/README.md)를 확인하세요.
   Runner 관리자/작업 공간은 구성과 복원 GitLab 상태에서 다시 만들어지므로 이전
   Runner 디렉터리는 필수 입력이 아닙니다.
6. 인증된 가져오기, Wizard/GitLab/레지스트리 접속, 복원 데이터 및 Runner CI를 확인하세요.
   도우미 완료 후 백업 매체를 마운트 해제/분리하고 구성 보내기/재시작과 TLS 갱신이
   여전히 동작하는지 확인하세요. 이들은 새 로컬 라이브 디렉터리만 사용합니다.
   구성된 DNS와 인증서 계보에 접근할 수 있으면 `sudo system-certbot renew --dry-run`을
   사용하세요.

시작은 Seed를 자동 적용하지 않습니다. 이전 라이브 데이터 볼륨을 단순히 다시 연결하는
것은 별도의 재사용 경로이며, 이 백업에서 새 로컬 저장소로의 복원이 아닙니다.

컨트롤러가 저장소 또는 업그레이드 임대를 가진 상태로 재시작하고 미완료 복원 마커가
없으면, 쓰기를 시작하기 전에 멈추고 `docker exec`를 통한 네이티브 복구가 가능하도록
유지됩니다. 임대가 사라져도 자동 재개하지 않습니다. 해당 복구를 완료하고 라이브
대상이 안전함을 확인한 후 `sudo docker restart system_bootstrapper_1`로 의도적으로
다시 시작하세요. 미완료 Seed 복원에는 여전히 위와 같이 다른 새 대상이 필요합니다.

### 복원된 비공개 Wizard 이미지 가져오기

GitLab 시작 후 `system/ensure-wizard-image.sh`는 플랫폼 자체 레지스트리에서 누락된
불변 Wizard 이미지를 복구합니다. 저장된 관리형 Wizard 영수증과 레지스트리/프로젝트
식별 정보를 검증하고 GitLab/레지스트리 전용 프록시를 렌더링하며 GitLab 내부 준비 상태
엔드포인트를 기다립니다. GitLab은 `read_registry`만 가진 프로젝트 배포 토큰을 만듭니다.
Docker는 표준 입력으로 암호를 받고 새 비공개 임시 디렉터리에 로그인을 기록합니다.
도우미는 정확한 저장 다이제스트를 가져와 검증하고 성공/실패 시 토큰을 폐기하며 임시
로그인을 제거합니다. 이전 호스트 Docker 자격 증명은 복구 입력이 아닙니다.
일반 공개 이미지 시작이나 이미 캐시된 정확한 고정값에는 토큰이 필요하지 않습니다.

배포 토큰에는 안전 한도로 GitLab의 다음 날 UTC 만료가 적용되며 보통 즉시 폐기합니다.
[GitLab 배포 토큰 문서](https://docs.gitlab.com/api/deploy_tokens/)를 확인하세요.
영수증의 정확한 프로젝트에서 예약된 복구 목적을 가진 토큰만 정리할 수 있습니다.
폐기에 실패하면 `configuration/.wizard-image-recovery.pending`을 유지하며, 이후
이미지가 캐시되었더라도 시작 과정에서 이 정리를 끝내야 합니다. 중단된 프로세스는
`configuration/.wizard-image-recovery.lock`을 남깁니다. 이전 프로세스 종료를 확인한
뒤 오래된 잠금만 제거하고 시작을 재시도하세요. 도우미가 예약된 자격 증명을 폐기할
수 있도록 pending 파일을 유지하세요. 자격 증명 오류는 다른 이미지로 대체하지 않고
Wizard와 프로젝트 서비스 전에 시작을 중단합니다.

## 검증 범위

`tests/seed/recovery-contract.py`는 픽스처 Docker 명령으로 실제 셸 스크립트와 rsync를
검사합니다. 복사 실패, 강제 종료, 버전 불일치, 손상, 완료 마커 누락, 활성 쓰기,
갱신 잠금 및 중단 복사의 내구성을 포함합니다. Wizard 모델 회귀 검사는 리터럴 할당,
JSON/ENV/ZIP 동등성 및 불변 서명을 검사합니다.

필수 [폐기 가능 플랫폼 시나리오](../tests/e2e/README.md)는 추가로 실제
GitLab/Runner/레지스트리 CI를 실행하고 실제 Wizard 모델로 구성을 내보내며, 원래의
비공개 호스트를 제거하고 선언된 새 소스 이미지, 구성 ZIP 및 완료 외부 Seed만으로
다른 빈 로컬 디렉터리에 복원합니다. 누락된 백업 저장소와 전역 라이브 임대 배제를
검사하고, 비어 있지 않은 복원 대상과 손상 페이로드를 거부한 뒤, 실제 구성 보내기/재시작,
Runner CI 및 TLS 갱신 검사 전에 백업 마운트를 분리합니다. 복원된 서비스/데이터 식별
정보, 캐시 없는 비공개 Wizard 이미지 복구 및 로컬 인증 기관을 통한 실제 ACME 계정/
갱신/배포를 확인합니다. 이 검사는 새 VM의 OS 설치나 systemd 타이머 예약을
에뮬레이션하지 않습니다.

보존 볼륨 `recover-volume.sh` 경로는 별개입니다. 이미지 아카이브가 명시적 입력인 반면,
구성과 Seed 시나리오는 선언된 사용자 지정 이미지를 소스에서 다시 빌드합니다.
어느 경로도 이전 Seed를 더 새로운 구성에 일치하는 백업으로 만들지 않습니다.
호환 입력을 확보하고 복구 전에 의도한 GitLab 이미지 식별 정보를 검증하세요.
