# Runner 데이터 영속성

준비된 네이티브 진입점 `dist/modules/lifecycle/entry.js runner-start CHECKOUT`는 공유 `RunnerLifecycleService`를 호출합니다. 이 서비스는
플랫폼의 `PERSISTENT_DIR`를 읽고 각 Runner 관리자에 대한 Compose
서비스를 생성합니다. `runner_docker_1` 관리자는 다음 경로를 바인드합니다.

- `PERSISTENT_DIR/runners/runner/1/config`를 `/etc/gitlab-runner`에 연결합니다.
- `PERSISTENT_DIR/runners/runner/1/home`을 `/home/gitlab-runner`에 연결합니다.

프로젝트 풀은 대신 `runners/<project>_runner/<index>/`를 사용합니다. 각 관리자는
자신의 `config.toml`, Runner 시스템 ID와 홈 디렉터리를 유지합니다. 따라서 Runner
이미지에 선언된 볼륨 때문에 익명 저장소가 생성되지는 않습니다. 템플릿 서비스를
직접 확장하지 마세요. 그 바인드 마운트는 개별 관리자를 구별할 수 없습니다.

각 풀은 하나의 GitLab Runner 레코드와 인증 토큰을 사용합니다. 관리자는 서로
다른 시스템 ID를 가지며, GitLab은 이들을 별도의 Runner 레코드가 아니라 해당
Runner의 **Runner managers** 항목에 표시합니다. 관리자별 설정을 저장하므로
다시 시작해도 이 식별 정보가 유지됩니다.

지원하는 관리자 수는 0개부터 50개까지입니다. 축소하면 초과 컨테이너는
제거하지만 해당 디렉터리는 보관하며, 확장하면 그 디렉터리를 다시 사용합니다.
`runner-stop`도 등록 정보와 데이터를 보존합니다. 등록을 의도적으로 제거할 때만
`runner-unregister`를 직접 실행하세요. 생성된 Compose 파일은 임시 파일이지만 경로는
결정적이며, 호출할 때마다 다시 구성됩니다.

Bootstrapper 안에서 이 명령을 호출할 때는 호스트의 `PERSISTENT_DIR`를
컨테이너 안에서도 같은 절대 경로에 마운트하세요. 호스트 Docker 데몬이 마운트하기
전에 그 위치에 Runner 디렉터리를 준비합니다. 플랫폼은 시작 전에 영구 볼륨이
마운트되어 있는지 확인해야 합니다. 익명 볼륨에서 이전할 경우, 컨테이너를
교체하기 전에 기존 관리자 각각의 설정과 홈을 해당 디렉터리로 복사해야 합니다.

`provision.js`는 `SYSTEM_CONFIG_DIR`가 지정되어 있으면 그 아래에 기본 설정을
씁니다. Controller는 `/state`를 사용합니다. 이 방식은 새로 준비한 Runner 토큰을
원자적으로 기록할 때 기존 설정 심볼릭 링크를 보존합니다.

등록은 Docker의 이름 있는 환경 변수 옵션으로 토큰을 전달하며, 토큰은 프로세스 인수에 포함되지 않습니다. 엔드포인트 이전은 모드 600의 비공개 파일을 복사한 뒤 관리되는 Runner 안에서 원자적으로 이름을 바꿉니다. 복사가 실패하면 기존 설정을 보존합니다. 원격 복사나 이름 변경이 중단되면 소유권이 확인될 때까지 고유한 임시 파일과 시작 복구 장벽을 유지합니다.

빌드한 Controller 이미지에서도 수명 주기 회귀 검사를 실행하세요. 해당 이미지의
BusyBox 유틸리티는 Debian 구성 요소 검사 이미지의 유틸리티와 다릅니다.
`BOOTSTRAPPER_IMAGE`를 직접 빌드한 정확한 Controller 이미지로 지정하세요.

```sh
docker run --rm --network none --read-only --tmpfs /tmp:exec \
  -v "$PWD:/work:ro" -w /work --entrypoint node \
  "$BOOTSTRAPPER_IMAGE" tests/gitlab-runner/persistence.js
```

이 검사는 Docker 접근이나 운영 상태 없이 런타임의 실제 임시 파일 시스템을 사용합니다.
호환성 명령을 실행하기 전에 operations 패키지를 빌드하세요. Runner 설정은 영구
컨트롤러 lease를 공유합니다. 상속된 업그레이드는 정확한 작업 식별 정보를 제공하고
Runner 명령의 살아 있는 상위 프로세스로 유지되어야 합니다.

네이티브 프로비저닝은 공유 GitLab 컨트롤러 자격 증명과 REST API를 사용합니다. 기존 인스턴스 Runner는 정책과 정확히 소유한 관리자 설정/토큰 또는 비공개로 저장한 자격 증명 영수증을 확인한 뒤에만 보존합니다. 영수증은 Harvest/Seed에 포함되는 GitLab 설정 볼륨의 `/srv/gitlab/config/system-bootstrapper-auth/runner.json`에 있습니다. 비공개로 유지하고 설정 ZIP에 복사하지 마세요. 기존에 설정한 Runner 토큰도 지원합니다. 정상 시작은 사용할 수 없는 토큰을 재설정하지 않습니다.

이전 토큰을 복구할 수 없다면 준비된 컨트롤러 마운트 네임스페이스에서 정확한 Runner ID의 토큰을 명시적으로 교체하세요.

```sh
node dist/modules/lifecycle/entry.js runner-rotate "$PWD" RUNNER_ID ROTATION_OPERATION
```

`RUNNER_ID`를 기존 인스턴스 Runner의 숫자 ID로, `ROTATION_OPERATION`을 소문자 16진수 48자로 된 새 작업 ID로 바꾸세요. 복구가 끝날 때까지 ID를 보관하고 모든 재시도에 **같은** 값을 사용하세요. 컨트롤러에는 정상적인 `PERSISTENT_DIR`, GitLab 설정, `SYSTEM_CONFIG_DIR` 마운트가 있어야 합니다. 이 명령은 영구 시작 장벽과 Runner 등록 잠금을 공유합니다. 정확히 소유한 기존 기본 풀 관리자 컨테이너를 중지하고 토큰을 한 번 재설정한 뒤 비공개 영수증, 관리자 토큰, 기본 설정을 갱신하며 관리자를 중지 상태로 둡니다. 작업 중단이 허용되는 시간에 실행하세요. Runner 레코드, 설정 필드와 관리자 시스템 ID를 보존하며 관리자 등록을 해제하지 않습니다. 성공하면 `node dist/modules/lifecycle/entry.js runner-start "$PWD" main`으로 다시 시작하세요.

중단된 요청은 정확한 Docker exec ID와 비공개 응답 파일을 보존합니다. 시작 장벽이 남지 않은 일반 오류 응답이라면 같은 작업을 반복하세요. 중단 후 시작 장벽이 남았다면 다음을 사용하세요.

```sh
node dist/modules/lifecycle/entry.js runner-reconcile "$PWD" STARTUP_OPERATION ROTATION_OPERATION
```

`STARTUP_OPERATION`은 `startup-` 뒤에 비공개 `SYSTEM_CONFIG_DIR/.storage-operation-lock/startup-owner.json` 영수증의 작업 값을 붙인 것입니다. 이 파일에는 자격 증명이 아닌 소유권 메타데이터가 있습니다. 최초 Runner 프로비저닝이 중단된 경우 마지막 인수에 교체 작업 대신 리터럴 `provision`을 사용하세요. 조정은 일치하는 Runner 저널과 정확한 Docker exec를 확인하고 부팅, PID 시작 시점, PID 네임스페이스 식별 정보로 이전 소유자가 종료되었음을 요구합니다. 기존 장벽을 재사용하며 다른 소유자의 저장소/업그레이드 잠금을 삭제하지 않습니다. 프로세스 증거가 없는 이전 영수증과 같은 부팅 내 네임스페이스 변경도 거부합니다. 다시 재설정하지 않고 저장된 응답을 복구합니다. 작업이 대기 중이면 다른 작업을 거부합니다. curl이 완전한 응답 없이 끝나거나 결과 복구 전에 기록된 exec가 사라지면 안전하게 실패하고 영수증을 보존합니다. 재시도 전에 일치하는 Harvest/Seed 스냅샷을 복원하세요. 대기 저널 삭제나 무조건적인 재설정은 복구가 아닙니다. 충돌하거나 읽을 수 없는 관리자 설정도 채택하거나 덮어쓰지 않고 거부합니다.
