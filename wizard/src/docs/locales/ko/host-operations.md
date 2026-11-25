# 컨테이너 호환성과 크기가 제한된 로그

## MongoDB를 선택하기 전에 실제 Docker 호스트 확인하기

컨테이너는 Docker 데몬 호스트의 커널과 노출된 CPU 명령어를 공유합니다.
Ubuntu 릴리스 이름이나 이미지 사용자 공간의 배포판만으로는 호환성을 입증할 수
없습니다. MongoDB 이미지를 선택하거나 호스트 커널을 변경하거나 CI 데이터베이스를
활성화하기 전에 **해당 Linux x86_64 호스트에서** 저장소의 사전 검사를 실행하세요.
Quickstart가 준비한 고정 Node 런타임을 사용하세요. 소스 체크아웃에서는 먼저 `npm ci`와 `npm run build`로 공유 서비스를 준비하세요.

```sh
system-bootstrapper host-bootstrap container-preflight --checkout "$PWD" --mongodb-version 8.0.37
# Pull the exact reviewed digest separately, then test its executable as well:
system-bootstrapper host-bootstrap container-preflight --checkout "$PWD" --mongodb-version 8.0.37 \
  --image 'docker.io/library/mongo@sha256:REPLACE_WITH_64_HEX_DIGEST'
```

JSON 보고서는 `uname`, `/proc/version_signature`, 도출한 업스트림 커널,
아키텍처 및 AVX 노출 여부를 기록합니다. Ubuntu의 ABI 릴리스(예:
`7.0.0-30-generic`)는 서명에 기록된 업스트림 안정 버전(예: `7.0.12`)과
다릅니다. Ubuntu 서명이 없거나 일치하지 않으면 검사를 거부합니다. 로컬 소켓을
명시적으로 사용하므로 원격 Docker 컨텍스트에서 원격 호스트의 커널이나 CPU를
확인할 수 없습니다. 이 보고서를 애플리케이션에서 선택한 서버 버전, 불변 이미지
식별 정보 및 운영 기록과 함께 보관하세요. System Bootstrapper 자체는 MongoDB를
프로비저닝하지 않으며, 애플리케이션 소유자가 데이터베이스를 선택합니다.

유지 관리되는 규칙은 MongoDB 7.0, 8.0, 8.3 및 9.0을 대상으로 다음을 구분합니다.

- 노출된 x86_64 CPU 중 하나라도 AVX가 없음: 하드웨어 및 VM의 CPU 기능
  전달 설정을 확인하세요.
- Linux 업스트림 6.19~7.0.13과 MongoDB 8/9 조합: TCMalloc/rseq 비호환입니다.
  오래된 이미지는 시작한 뒤 나중에 충돌할 수도 있습니다. `--version` 성공이
  이 조합을 안전하게 만들지는 않습니다. MongoDB 7.0은 이 특정 커널 결함의
  영향을 받지 않습니다.
- 수정된 업스트림 커널에서 오래된 서버 시작 감지 로직을 사용함: Ubuntu 감지
  수정을 포함한 보수적인 검토 최소 버전은 8.0.37, 8.3.16 및 9.0.4입니다.
- 알려지지 않은 릴리스 계열, 커널 근거 누락, 실행 파일 버전 불일치, 이미지의
  명시적인 커널 거부, 잘못된 CPU 명령, 시간 초과 및 기타 Docker 또는 실행 파일
  오류: 모두 별도로 진단하며 단순히 “AVX 없음”으로 처리하지 않습니다.

선택적인 이미지 검사는 앞의 검사가 성공한 후에만 실행됩니다. 이미 가져온
다이제스트와 `mongod --version`을 사용하며 네트워크나 영구 마운트를 사용하지
않습니다. 루트 파일 시스템은 읽기 전용이고 자원과 실행 시간도 제한됩니다.
데이터베이스를 실행하거나 애플리케이션 데이터에 연결하거나 커널을 변경하지
않습니다. 실행 파일 시작과 보고된 버전을 검증하지만, 성공해도 데이터베이스
워크로드 테스트나 전체 공급업체 지원 인증이 **아닙니다**. AVX는 공급업체 CPU
지원 표의 필요조건일 뿐 충분조건이 아닙니다.

계획을 위해 `--planned-kernel X.Y.Z`는 명시적으로 입력한 미래의 **업스트림**
커널을 현재 CPU와 함께 평가합니다. 이미지는 여전히 현재 커널에서 실행되므로
이 모드에서는 이미지 검사를 허용하지 않습니다. 명시적인 커널 유지보수 전에
영향받는 모든 워크로드, 버전 및 이미지를 기록하고 현재 공급업체 지원을 확인하세요.
일치하는 구성 및 데이터 백업, 독립적으로 사용 가능한 복구 이미지, 유지보수 시간과
부팅 복구 절차도 준비하세요. 부팅 후 사용을 재개하기 전에 현재 호스트 사전 검사와
애플리케이션 검사를 반복하세요. 여기의 도구는 커널을 업그레이드하거나 재부팅하거나
서버 버전을 변경하거나 MongoDB 안전 검사를 우회하지 않습니다. 데이터베이스 버전
변경에는 별도의 지원되는 마이그레이션 및 복구 절차가 필요합니다.

서버 계열을 추가하거나 커널을 변경할 때는 최신 일차 자료를 기준으로 규칙을
검토해야 합니다. 현재 검사의 근거는
[MongoDB 프로덕션 참고 사항](https://www.mongodb.com/docs/v8.0/administration/production-notes/),
[업스트림 커널 호환성 표](https://jira.mongodb.org/browse/SERVER-125742) 및
[Ubuntu 커널 감지 수정](https://jira.mongodb.org/browse/SERVER-131779)입니다.
이는 호환성 근거이며 실행 중인 호스트를 업데이트하라는 지시가 아닙니다.

## 로깅 경로와 보관 규칙

플랫폼의 외부 System NGINX는 공개 요청을 애플리케이션 프록시와 웹/API
컨테이너로 전달합니다. 기본 NGINX 이미지는 접근/오류 로그를 stdout/stderr에
연결하며 Docker는 각 컨테이너의 스트림을 독립적으로 수집합니다. NGINX의 기본
접근 형식에는 원격 주소, 요청 시각, 메서드와 URL/쿼리, 상태, 바이트 수,
Referrer, User-Agent 및 전달된 주소가 포함될 수 있습니다. 오류 로그에도 클라이언트
주소와 요청 정보가 들어갈 수 있습니다. API 로그 내용은 애플리케이션이 정하며
계정 식별자나 요청 본문을 포함할 수도 있습니다. 비밀, 민감한 쿼리 매개변수 또는
불필요한 개인정보를 기록하지 마세요. 애플리케이션 소유자는 실제 이미지와 로그
형식을 확인해야 합니다.

기본 로컬 진단 보관 예산은 `json-file`, **파일당 10 MiB, 컨테이너당 파일
3개**입니다. 새 출력이 예산을 채우면 가장 오래된 파일을 순환 삭제합니다.
이는 컨테이너당 약 30 MiB에 Docker 관리 정보 및 개별 로그 레코드의 초과분이
더해지는 크기/개수 정책이며 디스크 할당량이 아닙니다. 새로 생성한 System 컨트롤러,
웹, Sync 프록시, Wizard, GitLab stdout/stderr, 프로젝트 Review/Beta/Production
프록시 및 Runner 관리자에 적용됩니다. 관리되는 Wizard Review/Beta 컨테이너에도
같은 고정 기본값을 사용합니다. 생성된 React, Angular 및 웹 스타터 CI는 스모크
테스트와 배포한 애플리케이션 컨테이너에 이를 적용합니다.

**최대 보관 기간은 보장하지 않습니다**. 출력이 적은 컨테이너에는 오래된 항목이
무기한 남을 수 있고, 출력이 많은 컨테이너는 더 짧은 이력만 보관합니다.
14일 후 자동 삭제는 구성되어 있지 않습니다. 개인정보 처리방침은 이 크기/개수
동작과 별도로 운영하는 로그 수집을 설명해야 합니다. 달력 기준 삭제 기간이 필요한
운영자는 해당 기간을 약속하기 전에 적절한 로깅/수집 서비스와 그 백업을 구성하고
검증해야 합니다. 각 애플리케이션과 사고 대응의 필요에 맞춰 진단 예산을 재검토하세요.

Docker 파일 순환은 stdout/stderr에만 적용됩니다. 애플리케이션이 직접 쓰는 파일,
원격 로그 수집기, 호스트 저널, CI 작업 로그 및 GitLab 내부 파일에는 별도의
보관 제어가 필요합니다. GitLab 내부 로그는 선택한 영구 디렉터리에 저장되며
완료된 Seed에도 보존될 수 있습니다. 이 정책은 해당 파일이나 보관 중인 백업을
삭제하지 않습니다. Docker가 관리하는 로그 파일에 logrotate, `truncate`, `rm`
또는 정리 작업을 사용하지 마세요.
[Docker 드라이버 계약](https://docs.docker.com/engine/logging/drivers/json-file/)을 참고하세요.

## 구성, 배포 및 검증

Compose 정책은 명시적이며 `/etc/docker/daemon.json`을 수정하거나 관련 없는
컨테이너를 변경하지 않습니다. 핵심 서비스, 프록시 및 Runner의 예산을 구성하려면
변경하지 않은 Cube 서명 뒤의 **완전한** 비공개 기본 구성에 다음 리터럴 export를
추가하세요.

```sh
export SYSTEM_LOG_MAX_SIZE='10m'
export SYSTEM_LOG_MAX_FILES='3'
```

`k`, `m` 또는 `g` 단위를 붙인 양의 정수 크기와 1~100의 파일 개수를 사용하세요.
적용 전에 원하는 값을 검증하세요.

```sh
system-bootstrapper host-bootstrap log-policy --checkout "$PWD" --max-size 10m --max-files 3
```

Wizard의 기존 추가 런타임 옵션은 Fetch/Push와 JSON/ZIP Backup/Open에서
이 export를 보존합니다. 일치하는 구성 백업을 Harvest와 별도로 보관하세요.
Seed는 GitLab 프로젝트, 변수 및 애플리케이션 소스를 보존하지만 Docker 자체의
데몬 로그 디렉터리는 Seed 입력에 포함되지 않습니다. 기본 복구 도구를 통해
일치하는 구성과 Seed를 복원하세요. 로깅 재정의는 비공개 호스트 스크립트나
데몬 기본값에 의존하지 않습니다.

스타터 프로젝트 소유자는 `APP_LOG_MAX_SIZE`와 `APP_LOG_MAX_FILES`를 생성된
`.gitlab-ci.yml` 또는 구성한 GitLab CI 변수에서 수정할 수 있습니다. 이 값은 프로젝트
소유의 설정이며 GitLab 서비스 데이터 백업과 소스 이력에 보존됩니다. 이미 편집할
수 있는 파이프라인을 자동으로 덮어쓰지 않습니다. 사용자 정의 API, 데이터베이스
또는 여러 컨테이너로 구성된 프로젝트에서는 프로젝트 소스의 **각** 소유 서비스에
동등한 로깅 옵션을 명시적으로 적용하세요.

```sh
docker run --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  YOUR_OTHER_REVIEWED_CREATE_OPTIONS YOUR_IMMUTABLE_IMAGE
```

Docker 재시작, NGINX 새로고침 또는 데몬 기본값 변경은 기존 컨테이너를 소급하여
구성하지 않습니다. 명시적인 통합 배포 중에는 영향을 받는 플랫폼 서비스에 대해
Compose가 계획한 재생성과 중단/복구 요구 사항을 검토하세요. 애플리케이션 소유의
파이프라인은 별도로 업데이트하고, 다음 정상 배포에서 해당 소유 컨테이너만
재생성하도록 하세요. 이전 설정으로 실행 중인 애플리케이션에는 재생성을 검증하기
전까지 새 보장이 적용되지 않습니다. 로깅 설정 적용을 위해 볼륨, 데이터베이스
파일, Seed 또는 다른 프로젝트의 자원을 삭제하지 마세요.

배포 후 데몬 호스트에서 정확한 컨테이너 이름을 검사하고, 이후 정상 배포 후에도
반복하세요. 실제 배포의 이름을 사용하세요.

```sh
system-bootstrapper host-bootstrap log-policy --checkout "$PWD" system_web_1 system_sync_1
system-bootstrapper host-bootstrap log-policy --checkout "$PWD" --max-size 10m --max-files 3 YOUR_APP_CONTAINER
```

불일치는 종료 코드 1을 반환하고 실제 `HostConfig.LogConfig`를 표시합니다.
Docker를 사용할 수 없거나 입력이 잘못되면 종료 코드 2를 반환합니다. 컨테이너는
변경하지 않습니다. 기본값만 출력하는 명령은 Docker에 접속하지 않고 예상 정책을
표시합니다. 사용자 정의 핵심 설정에는 일치하는 옵션을 명시하거나 두
`SYSTEM_LOG_*` 값을 export하세요. 비공개 기본 구성을 진단 보고서에 출력하지 마세요.

소켓을 사용하지 않는 구성 요소 테스트는 `node --test tests/bootstrapper/host-operations.js`입니다.
기존 템플릿, 환경 도우미, Runner 및 구성 왕복 테스트도 정책 전달을 검증합니다.
후보 이미지 준비는 `tests/bootstrapper/log-rotation-docker.js`를 실행합니다.
폐기 가능한 컨테이너 두 세대가 합성 데이터를 출력하고, Docker 로그를 다시 읽어
순환을 검증하며, 자신의 크기가 제한된 로그 파일 세 개의 메타데이터만 확인합니다.
기존 기본 내보내기/Seed 복구 검사는 사용자 정의 기본 구성 로깅 값이 복구 후에도
보존되는지 확인합니다. 이 검사가 보관 중인 프로덕션 컨테이너의 재생성 완료를
의미하지는 않습니다.
