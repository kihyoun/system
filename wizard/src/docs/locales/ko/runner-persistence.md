# Runner 데이터 영속성

`start.sh`는 플랫폼의 `PERSISTENT_DIR`를 읽고 각 Runner 관리자에 대한 Compose
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
`stop.sh`도 등록 정보와 데이터를 보존합니다. 등록을 의도적으로 제거할 때만
`unregister.sh`를 직접 실행하세요. 생성된 Compose 파일은 임시 파일이지만 경로는
결정적이며, 호출할 때마다 다시 구성됩니다.

Bootstrapper 안에서 이 스크립트들을 호출할 때는 호스트의 `PERSISTENT_DIR`를
컨테이너 안에서도 같은 절대 경로에 마운트하세요. 호스트 Docker 데몬이 마운트하기
전에 그 위치에 Runner 디렉터리를 준비합니다. 플랫폼은 시작 전에 영구 볼륨이
마운트되어 있는지 확인해야 합니다. 익명 볼륨에서 이전할 경우, 컨테이너를
교체하기 전에 기존 관리자 각각의 설정과 홈을 해당 디렉터리로 복사해야 합니다.

`provision.js`는 `SYSTEM_CONFIG_DIR`가 지정되어 있으면 그 아래에 기본 설정을
씁니다. Controller는 `/state`를 사용합니다. 이 방식은 새로 준비한 Runner 토큰을
원자적으로 기록할 때 기존 설정 심볼릭 링크를 보존합니다.

빌드한 Controller 이미지에서도 수명 주기 회귀 검사를 실행하세요. 해당 이미지의
BusyBox 유틸리티는 Debian 구성 요소 검사 이미지의 유틸리티와 다릅니다.
`BOOTSTRAPPER_IMAGE`를 직접 빌드한 정확한 Controller 이미지로 지정하세요.

```sh
docker run --rm --network none --read-only --tmpfs /tmp:exec \
  -v "$PWD:/work:ro" -w /work --entrypoint node \
  "$BOOTSTRAPPER_IMAGE" tests/gitlab-runner/persistence.js
```

이 검사는 Docker 접근이나 운영 상태 없이 런타임의 실제 `mktemp`를 사용합니다.
