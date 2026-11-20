## 데이터 볼륨을 유지하면서 호스트 교체하기

이 절은 명시적으로 볼륨을 사용하는 재사용 절차입니다. 외부 백업에서 데이터를 채운
새 로컬 작업 저장소를 사용하려면
[구성과 Seed를 함께 복원하는 절차](RECOVERY_CONTRACT.md#restore-an-external-seed-into-a-fresh-local-installation)를
따르세요. 기본 로컬 설치는 VM을 삭제하면 작업 데이터를 보존하지 못합니다.
먼저 외부 저장소로 Harvest하고 이에 일치하는 구성을 저장하세요.


이 절차는 GitLab, 구성 및 인증서를 포함한 현재 라이브 데이터를 재사용합니다.
이전 Seed를 복원하거나 저장된 GitLab 버전을 업그레이드하지 **않습니다**. 이전 VM을
제거할 때 볼륨을 유지하고, 가능하면 분리 전에 쓰기 작업을 정상적으로 중지하세요.
완료된 Seed와 구성 백업만 있다면 대신
[구성과 Seed를 함께 복원하는 절차](RECOVERY_CONTRACT.md)를 사용하세요.
버전 변경은 별도의 [진화 절차](#5-evolving-a-running-system)를 따릅니다.

시작 전에 승인된 호스트 도구 리비전, 기록된 런타임 소스/이미지 식별 정보, 파일시스템
UUID, 마운트/데이터 경로 및 완전한 저장 구성을 확보하세요. 복구 매니페스트와 선언된
이미지 아카이브는 이미 [이미지 복구 절차](PERSISTENT_VOLUME.md#replacing-a-vm-while-retaining-live-data)에
따라 준비되어 있어야 합니다. GitLab과 동시에 실행할 빌드 또는 폐기 가능한 테스트에
충분한 호스트 리소스를 선택하세요. 구성된 DNS 이름을 유지하고 공개 주소가 바뀌면
A/AAAA 레코드를 갱신하세요. 공개 HTTPS를 사용하려면 포트 80과 443이 이 호스트에
도달해야 합니다. 이 배포에는 0.2절의 로컬 HTTP 준비를 적용하지 마세요.

1. 교체 Ubuntu 호스트에서 0.1절에 따라 소스를 가져오세요. 초기화 진입점이 포함된 검토된
   도구 리비전을 선택하고 정확한 하위 모듈을 초기화하세요. 플랫폼 자체의 GitLab이
   중단된 동안에는 필요한 커밋을 담은 사전에 게시된 승인 소스 미러나 Git 번들로
   이 체크아웃을 제공할 수 있습니다.

   ```bash
   SYSTEM_TOOLS_REVISION=REPLACE_WITH_REVIEWED_TOOLS_COMMIT
   git checkout --detach "$SYSTEM_TOOLS_REVISION"
   git submodule update --init --recursive
   ```

   Git 이력이 없는 일반 소스 ZIP은 초기화 도구의 커밋/트리 검증을 충족하지 못합니다.
   체크아웃을 깨끗하게 유지하세요. 이미지 매니페스트에 기록된 컨트롤러 소스는 이전에
   승인된 리비전일 수 있습니다. 도구는 해당 트리와 Wizard gitlink를 별도로 검사하고
   호스트 도구 리비전도 기록합니다. 하위 모듈을 최신 브랜치로 갱신하거나 새 설치
   예제에 맞추기 위해 저장된 서비스 버전을 변경하지 마세요.

2. `lsblk -f`를 확인하고 **기존** 파일시스템을 이전 절대 마운트 경로에 마운트하세요.
   다음 예제 할당값을 자신의 설치 값으로 바꾸세요. 연결된 볼륨을 포맷하지 마세요.

   ```bash
   PERSISTENCE_MODE=volume
   PERSISTENT_MOUNT=/mnt/bootstrapper-data
   PERSISTENT_DIR=/mnt/bootstrapper-data/platform
   SEED_DIR=/mnt/bootstrapper-data/seed
   PERSISTENT_UUID=REPLACE_WITH_EXISTING_UUID
   sudo install -d -m 0755 "$PERSISTENT_MOUNT"
   sudo mount "UUID=$PERSISTENT_UUID" "$PERSISTENT_MOUNT"
   findmnt --mountpoint "$PERSISTENT_MOUNT"
   ```

   이미 마운트되어 있으면 다시 마운트하는 대신 UUID와 대상을 확인하세요. 비공개 선택자
   파일을 다음 저장소 설정만으로 다시 만드세요. 관련 없는 이전 이미지 재정의는
   잘못된 서비스를 선택할 수 있습니다.

   ```bash
   sudo install -d -m 0700 /etc/system-bootstrapper
   sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<EOF
   PERSISTENCE_MODE=volume
   PERSISTENT_MOUNT=$PERSISTENT_MOUNT
   PERSISTENT_DIR=$PERSISTENT_DIR
   SEED_DIR=$SEED_DIR
   PERSISTENT_UUID=$PERSISTENT_UUID
   EOF
   sudo chmod 0600 /etc/system-bootstrapper/persistence.env
   ```

3. `platform/recovery/images.json`이 기록된 소스, 정확한 이미지 ID, 로컬 별칭 및
   체크섬이 있는 아카이브를 설명하는지 확인하세요. 전체 매니페스트 스키마와 입력
   요구사항은 [초기화 도구 문서](../bootstrapper/README.md)에 있습니다. 소스 식별 정보나
   별칭 누락은 준비 실패이며, 다른 이미지로 대체하거나 비공개 복구 스크립트를
   호스트에 복사해도 된다는 뜻이 아닙니다.

4. 보존한 구성에서 `GITLAB_SSH_BIND='22'`를 사용한다면, 먼저
   [Public 7](#public-7-separate-administrative-and-gitlab-ssh)에 따라 포트 2222의
   관리 접속을 준비하고 새로 확인한 다음 호스트 포트 22를 비우세요. 새 Ubuntu 호스트는
   대개 자신의 SSH 서비스에 22를 예약합니다. 초기화 도구는 이 리스너를 대신 옮기지
   않습니다. 초기화 전에 호스트/방화벽 단계를 수행하고 초기화 도구가 GitLab을 시작하게
   하세요. Public 7의 컨트롤러 내부 조정 명령은 이미 실행 중인 설치를 위한 것입니다.
   저장된 구성을 최초 설치 예제로 되돌리는 대신 보존된 GitLab 바인딩을 유지하세요.

   이 검토된 체크아웃에서 커밋된 초기화 조정 도구를 실행하세요.

   ```bash
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash bootstrapper/initialize.sh \
       --install-host \
       --receipt-dir /var/log/system-bootstrapper/initialize-REPLACE_WITH_OPERATION_ID \
       --timeout 1200
   ```

   시도할 때마다 새 영수증 디렉터리를 선택하세요. `--install-host`는 문서화된 Ubuntu
   의존성, Docker 및 Certbot을 설치합니다. 호스트 준비가 끝났다면 생략하세요.
   조정 도구는 저장소, 소스 및 아카이브를 검증하고 기준 상태를 캡처하며 선언된 이미지를
   로드하고 볼륨/TLS 호스트 통합을 설치한 뒤 서비스를 시작하여 실제 애플리케이션 준비
   상태를 확인합니다. 파일시스템 포맷, Seed 복원 또는 저장 구성 변경은 수행하지 않습니다.

   **루트 디스크** 공간이 충분한 작은 호스트에서 도구가 스왑을 만들게 하려면
   `--swap-gib 8`을 명시적으로 추가하세요. 기존 `/swapfile`이 있거나 여유 공간이
   부족하면 거부합니다. 스왑은 동시 후보 테스트에 필요한 RAM을 대체하지 않습니다.
   보존된 공개 HTTPS 설치에서는 `--renewal-dry-run`을 추가하여 프록시를 중지하지
   않고 공유 갱신 임대를 통해 Certbot을 테스트하세요.
   `--redirect-from https://example.com`은 해당 출처가 공개 Wizard로 리디렉션하도록
   구성된 경우에만 추가하세요.

   GitLab Runner 관리자의 새 접속을 확인하려면
   `--gitlab-token-file /root/REPLACE_WITH_PRIVATE_API_TOKEN_FILE`을 제공하세요.
   파일은 비공개(모드 0600)여야 하며 문서화된 관리자 `read_api` 권한의 토큰을 담아야
   합니다. 명령줄 토큰 값이 아닙니다. 이 입력이 없으면 영수증은 API 접속 검사를
   건너뛴 것으로 표시합니다. 컨테이너가 실행된다는 사실만으로 관리자가 온라인이라고
   보고해서는 안 됩니다.

5. 비공개 작업 상태와 구조화된 검증 영수증을 확인하세요. 검사는 저장 구성 불변,
   정확한 서비스 이미지와 Cube, 영구 마운트 기반, 인증된 Sync 가져오기,
   Wizard/GitLab/레지스트리 라우팅 및 구성된 호스트 TLS 통합을 다룹니다.
   누락된 비공개 Wizard 이미지는
   [임시 범위 지정 레지스트리 복구](RECOVERY_CONTRACT.md#pulling-a-restored-private-wizard-image)를
   통해 저장된 불변 다이제스트로 가져옵니다. 비공개 구성, 토큰 파일 또는 원시 로그를
   공개하지 마세요.

   캡처한 기준 상태를 대상으로 런타임 검증을 반복하려면 동일한 커밋된 검증기를 사용하고
   필요에 따라 선택적 토큰/리디렉션 인수를 추가하세요.

   ```bash
   sudo python3 bootstrapper/verify-runtime.py check \
     --persistence-env /etc/system-bootstrapper/persistence.env \
     --baseline /var/log/system-bootstrapper/initialize-REPLACE_WITH_OPERATION_ID/baseline.json \
     --output /var/log/system-bootstrapper/initialize-REPLACE_WITH_OPERATION_ID/recheck.json \
     --timeout 1200
   ```

필수 진입점에서 동작이 누락되어 실패하면, 수정된 도구를 배포하기 전에 해당 동작을
Merge Request와 관련 검사로 수정하세요. 진단을 위해 미완료 작업 마커와 영수증을
보존하세요. 호스트 교체를 계속하려고 보호 장치를 우회하거나 오래된 Seed를 복원하지 마세요.
