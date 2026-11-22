# 구성 요소 및 플랫폼 테스트

테스트는 검증하는 인프라 구성 요소별로 나뉩니다. 네이티브 TypeScript 서비스는 Node 픽스처로 검사합니다. 격리 실행기는 명시적인 [매니페스트](manifest.json)만 실행하며 `live/` 스크립트를 검색하거나 플랫폼을 자동으로 시작하지 않습니다.

## 격리 검사 재현하기

Node, Git, tar 및 Docker를 사용할 수 있는 깨끗한 커밋 체크아웃에서 실행하세요.

```sh
system-bootstrapper source-prepare
system-bootstrapper ci prepare-context "$PWD"
docker build -f tests/Dockerfile -t system-component-tests - < .test-context/context.tar
docker run --rm --network none system-component-tests all
docker run --rm --network none system-component-tests sync
```

이 자식 컨테이너에 Docker 소켓, 비공개 설정, 호스트 네트워크 또는 플랫폼 볼륨을 마운트하지 마세요. 소스 패키징 전에 고정 Node 런타임과 operations 패키지를 준비하세요. 최초 Quickstart만 Node 이전 셸 진입점입니다. 컨텍스트에는 현재 커밋된 Git 트리의 허용 목록에 있는 블롭만 포함되며, 일반 `wizard/` 트리도 `system-monorepo-v1`에서 포함합니다. 과거 gitlink 소스는 검증된 별도 Wizard 스냅샷과 정확한 재귀 하위 모듈(`git submodule update --init --recursive`)도 필요합니다. Git 메타데이터, 비공개/무시된/추적되지 않은 파일 및 작업 사본 수정은 제외합니다. 패키징 전에 의도한 코드를 커밋하세요. 전체 체크아웃을 보내는 대체 경로는 없습니다.

이미지는 Debian Bookworm/glibc에서 다이제스트로 고정한 Node 24.22.0/npm 11.19.1을 사용하며, 독립적인 ZIP/TOML 픽스처 오라클용 Python과 프로세스 및 과거 형식 검사용 셸/네이티브 도구를 포함합니다. Ruby 테스트 런타임은 설치하지 않습니다. 커밋된 루트 잠금 파일로 의존성을 설치하고 공유 NestJS 애플리케이션을 빌드합니다. 빠른 검사는 자동 수정 없이 ESLint와 Prettier를 실행합니다. 빌드 중 런타임과 공유 라이브러리 버전을 출력합니다. 이 픽스처 의존성은 플랫폼 작업을 구현하지 않습니다.

후보 이미지 준비 과정은 전체 플랫폼을 시작하기 전에 빌드된 Wizard의 실제
구성 내보내기 도구로 `tests/wizard/configuration-routing-export.js`도 실행합니다.
첫 Save/Fetch/Backup 왕복 과정, 서버 확인 기록의 정확한 보존, Fetch가 파생된
저장소 메타데이터를 채울 때 선택적 라우팅이 유지되는지를 검증합니다.
별도로 실행하려면 `npm run build:config-export` 명령을 커밋된 `wizard/`
체크아웃에서 실행하여 Wizard 내보내기 도구를 빌드한 다음 아래 명령을 실행하세요.

```sh
node tests/wizard/configuration-routing-export.js --exporter wizard/build-tools/export-configuration.cjs
```

이미지는 `SYSTEM_TEST_ISOLATED=1`을 설정하고 `node tests/run.js`를 호출합니다.
`all` 또는 `gitlab`, `sync`, `gitlab-runner`, `bootstrapper`, `nginx`, `wizard`,
`shared`, `performance` 중 하나를 선택하세요. 검사는 항목별 제한 시간을 강제하며
순차 실행됩니다. 실패, 취소 또는 시간 초과는 0이 아닌 결과를 냅니다. 시간 초과 시
자식 프로세스 그룹을 종료하며 각 검사 후 보고서를 갱신합니다. SIGKILL은 새 보고서를
쓸 수 없으므로 컨테이너 경계에서 남은 프로세스를 정리해야 합니다.

API 검사는 의도적으로 비공개 네트워크 네임스페이스에서 포트 **8071**에 바인딩합니다.
실행기는 격리 플래그를 요구하고 비공개 런타임 구성과 마운트된 Docker 소켓을 거부하며
포트가 비어 있는지 검사합니다. 이 보호 장치는 폐기 가능한 컨테이너를 대체하지 않습니다.
NGINX 픽스처는 해당 컨테이너 안에서만 `/templates`를 렌더링합니다.

JSON 및 JUnit 보고서는 `test-results/<selector>/`에 생성됩니다. 보존하려면 새 출력
디렉터리만 마운트하세요.

```sh
mkdir -p test-results
docker run --rm --network none \
  -v "$PWD/test-results:/candidate/test-results" system-component-tests all
```

호스트 호환성 및 로깅 픽스처는 `bootstrapper` 구성 요소에서 실행됩니다.
후보 이미지 준비 시 소유권이 있는 폐기 가능한 컨테이너 두 세대를 사용하는
작은 실제 Docker 로그 순환 검사도 실행합니다. 실제 파일 크기와 개수 및 로그를
다시 읽은 결과를 검증합니다. 기본 복구 검사는 실제 구성 내보내기 도구와 Seed
복원을 통해 사용자 정의 로깅 설정을 검사합니다. 범위와 명령은
[호스트 운영](../docs/HOST_OPERATIONS.md)을 참고하세요.
명시적으로 활성화하는 `node tests/bootstrapper/paused-controller-docker.js --allow-local-daemon`
검사는 리소스가 제한된 컨테이너 하나를 사용하여 네이티브 Compose가 공개 업그레이드 픽스처의
수동 교체 및 최종 초기화 단계에서 컨트롤러를 찾고 다시 생성하는지도 검증합니다.

## 테스트 구성

| 디렉터리 | 범위 |
| --- | --- |
| `gitlab/` | 루트 암호 초기화, 시작, 프로젝트/템플릿, 소스/빌드/환경/운영 환경 Rails 어댑터, 비공개 복구 자격 증명 및 GitHub 백업 전송 |
| `sync/` | 제안, 인증/토큰 갱신, multipart 구성 왕복 및 자동 재시작 전 보내기 응답 |
| `gitlab-runner/` | 공유 풀 프로비저닝, 엔드포인트 마이그레이션, 관리자별 영구 config/home 및 식별 정보 재사용 |
| `bootstrapper/`, `persistence/`, `seed/` | 서비스 가용성, 마운트 보호, 영구 구성, 이미지 복구, 완료된 콜드 Harvest/복원 및 중단 작업의 내구성 |
| `nginx/` | 기본 Wizard 라우팅 및 소유권이 있는 Review/Beta 경로 조각 |
| `wizard/` | 소스 패키징/가져오기, 빌드 레시피/정리, API 작업 흐름, 업그레이드, Review/Beta 및 의도적인 운영 환경 승격/롤백 |
| `shared/` | Runner/컨텍스트 계약, 정리/실패 전파, 비공개 데몬 수명 주기, 페이로드 전용 복구 및 로컬 ACME 픽스처 |
| `performance/resources/` | 오프라인 리소스 수집기 계약 및 명시적 측정 도구 |

콜드 복사/복원 오류 사례는 `tests/operations/storage-copy.test.cjs`에 통합되어 기존 operations 런타임 검사로 실행됩니다. 실제 rsync, 네이티브 find/runit 명령 픽스처 및 하위 프로세스 시간 제한을 사용하며 Docker/GitLab은 제어된 전송으로 유지합니다.
operations 런타임 검사는 독립된 임시 디렉터리를 사용하는 격리된 테스트 파일
프로세스를 최대 두 개까지 병렬로 실행합니다. 검사 범위와 매니페스트의 시간 예산은
변경하지 않으며 상위 실행기는 매니페스트 항목을 계속 순서대로 실행합니다.

정확한 검사 이름, 사전 요구사항 및 예산은 매니페스트가 기준입니다. 테스트는 임시 파일,
합성 Git 저장소, 가상 Rails/Docker/API 전송 및 격리된 HTTP 프로세스를 사용합니다.
픽스처 통과는 실제 레지스트리 이미지, 브라우저, Runner 또는 GitLab 파이프라인 통과를
입증하지 않습니다.

`sync/push-restart-api.js`는 인증된 multipart 구성 ZIP을 검사합니다. 성공 응답은
컨트롤러 재시작을 유발하는 Sync 종료 전에 완료되며, 가져오기 실패 시 서비스는
계속 사용 가능합니다.

소스 컨텍스트 계약은 바이너리 내용/실행 모드, 커밋 입력, 스냅샷 해시, 모노레포 트리 식별 정보와 과거 gitlink 및
변경된 파일/비공개 파일 제외를 검증합니다. 부모 계약은 Docker 실행 전 체크섬/리비전
검사, 정확한 소유 대상 정리, 주 실패 보존 및 접근 불가능한 데몬 진단을 검사합니다.
복구 계약은 파괴적 복사 전 전체 페이로드 검증, GitLab 이미지 식별 정보, 정상 종료,
인증서 임대 및 내구성 있는 복원 마커를 검사합니다.

이미지 빌드의 표준 출력과 오류 출력은 크기를 제한하여 작업의 `build.log`
아티팩트에 보관하며, 비공개 환경에 알려진 자격 증명은 가립니다.
빌드 실패 시 진단의 마지막 부분을 작업 로그에도 표시합니다. 정리 과정은
원래 빌드 실패를 보존합니다. 비공개 구성은 커밋된 소스로 만드는 빌드
컨텍스트에 포함되지 않습니다.

## GitLab CI 경계

루트 파이프라인은 Merge Request와 기본 브랜치에서 두 범주를 사용합니다.

- **문서:** 루트의 `AGENTS.md`, `README.md`, `Prepare-Host.md` 또는 `docs/` 아래의
  Markdown/PNG/JPG/JPEG/SVG 파일로 제한된 변경은 `check:documentation`을 실행합니다.
  커밋된 diff를 `git diff --check`로 검사하고 변경된 Markdown이 일반 UTF-8 텍스트인지
  검증합니다. 하위 모듈 초기화, 패키지 설치, 런타임 이미지 게시 또는 테스트 플랫폼
  시작은 수행하지 않습니다.
- **런타임:** 그 외 모든 경로, 문서/코드 혼합 변경 및 알 수 없는 경로는 아래의 전체
  구성 요소, 이미지 및 콜드 복구 검사를 유지합니다. CI 구성과 도우미, 인프라, 테스트 및
  Wizard 소스는 이 범주입니다. 이름 변경은 이전과 새 경로를 모두 포함하며 런타임
  파일 삭제도 전체 검사를 유지합니다.

네이티브 `rules:changes:regexp`에는 GitLab 19.2 이상이 필요합니다. 공유 규칙은 문서
허용 목록 밖의 모든 경로와 일치합니다. 일치하는 README가 런타임 변경을 무효화하지
않습니다. MR 비교는 대상 diff 기준점을, 기본 브랜치 푸시는 이전 브랜치 헤드를 사용합니다.
첫 푸시와 변경 비교가 없는 이벤트는 보수적으로 전체 검사를 선택합니다. 예약/수동 기본
브랜치 실행도 전체 경로를 유지합니다. 보호된 병합에는 여전히 성공한 현재 파이프라인과
해결된 검토 토론이 필요합니다. 활성화되면 보호된 기본 브랜치 푸시가 어느 범주든 GitHub로
미러링할 수 있습니다. 런타임 이미지 게시는 조건부이며 운영 환경 승격은 수동입니다.

`check:documentation`은 플랫폼의 기존 신뢰된 `docker` Runner 풀을 사용합니다.
별도 문서 Runner나 조정자 등록은 필요하지 않습니다. 커밋된
`node dist/modules/ci/entry.js documentation "$CI_PROJECT_DIR"` 부모는 해당 Runner의 Docker 권한으로 다이제스트 고정
Node 자식을 사용자 1000으로 짧게 실행합니다. 네트워크, 호스트 소켓, 바인드 마운트,
추가 capability 및 상속된 CI 자격 증명은 없습니다. 실제 검사기를 격리하는 것이며
신뢰된 부모까지 격리하는 것은 아닙니다. 임의의 미검토 코드를 공유 소켓 Runner에
예약해서는 안 됩니다.

자식은 필수 커밋 스냅샷 두 개의 Git 객체, 새 저장소 구성 및 커밋된 검사기만 받습니다.
비공개 원격 URL, Git 자격 증명/구성/훅, 관련 없는 로컬 ref, 변경 파일 및 부모 환경은
복사하지 않습니다. 명시적인 비밀이 아닌 CI diff 선택자와 고정 Git safe-directory
설정만 자식에 전달됩니다. 빈 Docker 클라이언트 구성은 암묵적 프록시 변수 주입을
막습니다. 검사기는 엄격한 소켓 거부를 유지합니다. 부모는 일반 자격 증명으로 고정
공개 이미지를 가져오고 기존 `test-results/documentation/` 보고서를 복사해 회수하며
식별 정보를 확인한 작업 컨테이너만 제거합니다. 별도 `after_script`가 제한된 정리를
반복합니다. 문서 경로는 3분 작업 예산을 유지하며 런타임 아티팩트, 빌드, 플랫폼 테스트
또는 장기 리소스가 없습니다. 전체 검사에는 기존 `docker` Runner 태그와 리소스
제한이 그대로 유지됩니다.

Docker나 추가 lint 패키지 없이 고정된 operations YAML 파서, Node와 Git으로 선택 및 문서 회귀 검사를 재현하세요:

```sh
npm ci --ignore-scripts --no-audit --no-fund
node tests/gitlab/ci-selection.js
node tests/gitlab/check-documentation.js
```

이 픽스처는 변경 경로, 이벤트/게시 역할 및 실제 Git diff를 검사합니다. GitLab CI Lint나
CI 자체 변경 시 필수 런타임 파이프라인을 대체하지 않습니다. MR과 병합된 기본 브랜치
커밋은 각각 자체 검사를 받습니다. 파이프라인은 트리 식별 정보를 근거로 이전 콜드
복구 결과를 재사용하지 않습니다.

런타임 경로는 `prepare:wizard-source`에서 정확한 공통 Wizard 트리(과거 소스는 재귀 Wizard gitlink)와 최소 빌드
컨텍스트를 준비합니다. 후속 작업은 아카이브 체크섬과 기록된 리비전이 `CI_COMMIT_SHA`와
일치해야 합니다. 누락, 손상 또는 오래된 아티팩트는 Docker 실행 전에 실패합니다.

게시 전에 8개 구성 요소 매트릭스 작업이 실행됩니다. 각각 고정 Docker CLI,
`services: []` 및 기존 `docker` Runner 태그를 사용하는 신뢰된 부모입니다.
`node dist/modules/ci/entry.js isolated "$CI_PROJECT_DIR" "$COMPONENT"`를 호출하고 검증된 stdin 아카이브로 빌드한 뒤,
CI 자격 증명을 상속하지 않는 소켓 없는/네트워크 비활성 자식을 실행합니다. 작업의
체크아웃 경로가 Docker 호스트에 없을 수도 있으므로 보고서는 `docker cp`로 가져옵니다.

기존 소켓 Runner는 부모에게 호스트 Docker 권한을 줍니다. DinD 서비스를 비활성화해도
권한은 사라지지 않습니다. 이 구성은 신뢰된 코드를 위한 것이며 공유된 권한 있는
Runner의 악의적인 Merge Request를 위한 것이 아닙니다. 테스트는 추가 Runner를
프로비저닝하지 않습니다.

`prepare:wizard-source`는 패키징 전에 번들 Docs와 전체 공개 가이드 소스도 대조합니다.
리더를 갱신하려면 원본 가이드를 편집하고 고정된 operations 패키지를 빌드한 다음 `system-bootstrapper docs export`를 실행한
뒤 생성된 Wizard 카탈로그를 동일한 System 커밋에 포함하세요.
`system-bootstrapper docs check`는 소스 불일치와 전체 텍스트 보존을 검사하며,
`node tests/wizard/docs-source.js`는 공통 네이티브 내보내기 서비스와 장, 링크 및
오프라인 이미지 범위도 검사합니다. `system-bootstrapper docs export --check`는
생성된 전체 카탈로그를 비교합니다.

필수 `test:wizard-browser` 작업은 동일하게 커밋된 Wizard 소스 트리에서 별도로 체크섬을
계산한 컨텍스트를 사용합니다. 신뢰된 부모는 브라우저 도구를 빌드하고 호스트 소켓,
비공개 구성 또는 작업 자격 증명이 없는 네트워크 비활성 자식에서 전체 네이티브
Playwright 테스트를 실행합니다. 자식 제한은 메모리 2 GiB, CPU 2개, 프로세스 512개입니다.
보고서와 JUnit은 `docker cp`로 가져오며 식별 정보를 확인한 정리는 해당 작업의 자식과
이미지만 제거합니다. 통합 릴리스가 별도 Wizard 소스 파이프라인을 사용하지 않을 때도
브라우저 검사를 같은 System 파이프라인에 유지합니다.

이름에는 숫자 프로젝트/작업 ID가 포함됩니다. trap과 `after_script`는 정확히 해당
작업이 소유한 컨테이너/이미지만 제거합니다. 8분 스크립트 예산은 10분 작업 안에서 정리
여유를 남기며 각 정리 명령에는 제한이 있습니다. 별도 종료 시/after-script JSON
영수증은 성공적인 부재 확인과 데몬/제거 오류를 구분합니다. 정리 실패는 기존 실패를
보존하면서, 그 외에는 성공한 스크립트를 실패시킵니다. GitLab은 `after_script` 실패만으로
주 성공을 실패로 바꾸지 않으므로 별도 진단을 보관하세요. SIGKILL 또는 호스트 손실은
두 훅을 막을 수 있습니다. 데몬에 다시 접근할 수 있으면 보존한 소유 영수증으로 재실행하세요.
이를 전역 Docker 정리로 대체하지 마세요.

## 전체 System 및 플랫폼 관문

`test:candidate-image`는 커밋된 런타임 blob과 검증된 Wizard 스냅샷으로
`containers/controller/Dockerfile`을 빌드하며 `.candidate-context/`를 사용합니다. 두 컨텍스트 패키저는
GNU와 BusyBox tar를 지원합니다. 전체 이미지는 고정 Sync 의존성을 설치하고 Sync를
컴파일합니다. 소켓 없는 네트워크 비활성 자식은 런타임/린트/컴파일러/Compose 및
스냅샷 계약을 검사합니다. 아티팩트는 소스, 정확한 이미지 식별 정보 및 JUnit 결과를
기록합니다.

Wizard 스냅샷을 준비한 후 패키징과 빌드를 재현하세요.

```sh
node tests/prepare-candidate.js
docker build -f containers/controller/Dockerfile -t system-candidate:local - < .candidate-context/context.tar
```

이후 `test:platform-candidate`가 별도로 승인된 권한 있는 폐기 가능 Docker 데몬을
실행하며 게시 단계를 차단합니다. 커밋 입력으로 컨트롤러/Wizard를 빌드하고 고정된
GitLab/Runner/도우미/NGINX 이미지를 미리 로드합니다. 전체 시나리오는 실제
GitLab/Runner/레지스트리 CI, 의도적 실패 관문, 구성 내보내기, 콜드 Harvest,
원래 호스트 제거 및 구성 ZIP과 완료 Seed만으로 서로 다른 빈 경로에 복구하기를
검사합니다. 캐시 없는 비공개 Wizard 이미지 복구 및 실제 로컬 ACME 갱신/배포를
확인합니다. 명시적 입력, 리소스 제한, 정리 및 한계는 [통합 가이드](e2e/README.md)를
확인하세요. 기존 호스트 데이터나 비공개 구성은 입력이 아닙니다.

레지스트리 검사, 비공개 Wizard 파생 이미지 및 루트 GitLab 게시 빌드는
`--provenance=false --sbom=false`를 사용합니다. 영향받는 Docker/GitLab 조합은 대상보다
먼저 업로드된 attestation을 `blob unknown to registry`로 거부합니다.
[Docker attestation 문서](https://docs.docker.com/build/metadata/attestations/)를 확인하세요.
레지스트리 다이제스트, 가져오기/실행 및 아티팩트 검사는 여전히 필수입니다. 해당 경로는
attestation 검증을 주장하지 않습니다. 다른 후보 이미지 메타데이터 동작은 그대로입니다.

## 정적 보안 검사

런타임 Merge Request와 기본 브랜치 빌드는 구성 요소 검사와 나란히 필수
`test:codeql` 작업을 실행합니다. CodeQL 2.27.4와 공식 기본 JavaScript/TypeScript
코드 스캐닝 모음으로 커밋된 System 소스와 정확한 내장 Wizard 트리(또는 과거 gitlink 스냅샷)를 검사합니다.
억제되거나 기준선에 있는 결과를 포함해 출력된 모든 발견 사항은 작업을 실패시킵니다.
쿼리나 심각도에 대한 예외는 적용하지 않습니다. 고정된 공개 CLI 번들은
사용 전에 체크섬을 검증합니다. 검사 자식 컨테이너에는 네트워크, Docker 소켓
또는 자격 증명이 없으며 애플리케이션 빌드를 실행할 수 없습니다.

스캔은 원본 자체 작성 소스를 분석합니다. 현재 v3 컨텍스트는 고정 SHA-256,
일반 파일 모드와 라이선스 해시를 검증한 뒤 변경 불가능한 과거 아티팩트
`templates/project-bootstrap/wizard-build/typed-v6/runtime/project-ci.cjs`만
제외합니다. 경로와 해시는 `scan-source.json`에 남으며 일반 CLI와 모든 자체 작성
TypeScript는 분석합니다. 과거 v2 컨텍스트는 세 복사본, Producer 및 라이선스의
엄격한 검증을 유지합니다. 누락, 변경 또는 링크된 아티팩트는 거부하며 다른 생성
경로에는 이 예외를 적용하지 않습니다.

`tests/operations/project-ci-artifact.test.cjs`는 일반 npm 패키지, 영수증, 체크섬 및
소스 바인딩을 독립적으로 검증하며 소스와 아카이브 변경의 거부도 포함합니다.
CLI 어댑터 테스트는 HTTP 서비스 없이 호출을 검증합니다. 실제 브라우저 실행은
별도의 필수 게이트로 유지합니다.

이것은 생성된 코드와 포함된 외부 라이브러리 코드에 대한 중복 SAST 검사를 의도적으로
제거하는 범위 경계입니다. 포함된 타사 의존성 코드는 이 번들을 통해 다시 분석하지
않습니다. 정확한 재생성은 일치함을 입증할 뿐 취약점이 없음을 입증하지 않습니다.
고정된 의존성에 대한 [의존성 감사](../docs/DEPENDENCY_SECURITY.md)는 유지하세요.

CodeQL CLI에는 별도의 [라이선스 조건](https://github.com/github/codeql-cli-binaries/blob/main/LICENSE.md)이 적용됩니다.
무료 자동 분석은 GitHub에 호스팅되고 유지 관리되는 오픈 소스 코드베이스를
전제로 하며 외부 GitLab Runner도 지원됩니다. 비공개 포크나 GitLab에서만
관리되는 포크는 이 작업을 실행하기 전에 자체 라이선스 사용 자격을 확인해야
합니다. 프로젝트의 MIT 라이선스는 CodeQL 라이선스를 부여하지 않으며 이 작업은
유료 구독을 구매하지 않습니다. Runner의 연산 및 저장 공간은 운영자가 부담합니다.

`node tests/prepare-codeql.js`는 일반적인 Wizard 소스 준비 후 커밋된 입력을
패키징합니다. `node dist/modules/ci/entry.js codeql-parent "$CI_PROJECT_DIR"`는 선택한 신뢰된 Docker Runner에서 일반 CI
식별 변수와 함께 검증된 컨텍스트를 실행합니다. 자식 컨테이너는 RAM 6 GiB와
CPU 두 개로 제한하며 이미지 준비와 검사는 각각 최대 15분입니다. 이 정적
작업은 폐기 가능한 플랫폼을 시작하지 않습니다. SARIF 결과, 추출 범위, 소스
식별 정보 및 정리 근거는 `test-results/codeql/` 아래에 보존합니다. 추출 범위가
누락되거나 발견 사항이 하나라도 있으면 작업이 실패합니다. 더 넓은 품질 검사
모음은 별도로 실행하여 검토할 수 있지만, 추가 휴리스틱은 이 기본 보안 게이트와
동일하지 않습니다.

## 명시적 라이브 어댑터

`*/live/` 아래 스크립트는 운영자가 준비한 폐기 가능한 플랫폼이 필요합니다. 일부는 고정 `system_*` 이름, localhost 경로, 준비된 페이로드와 비공개 자격 증명을 사용합니다. Production이나 워크스테이션 설치를 대상으로 하면 안 됩니다. 네이티브 감사는 검토한 컨트롤러 내부에서 기존의 준비된 자동화 자격 증명을 초기화하거나 갱신하지 않고 재사용합니다. Runner 변경에는 폐기 가능한 프로젝트에 대한 명시적 동의와 불변 작업 이미지가 필요합니다. 격리 실행기는 glob 검색으로 이들을 실행하지 않습니다.

`wizard/live/build.js`에는 `SYSTEM_WIZARD_LIVE_ACCEPTANCE=true`와 명시적 숫자
`SYSTEM_WIZARD_EXPECTED_PROJECT`가 필요합니다. Sync 자격 증명은 명령 인수나 로그가
아닌 후보 환경에 비공개로 제공하세요. 이 스크립트는 해당 관리형 저장소에 소스를
가져오고 실제 CI를 활성화하며 반복 소스/파이프라인 식별 정보와 필수 빌드/브라우저/
다이제스트 증거를 검증하고 운영 환경 주소를 보존합니다. 배포, 초기화, Seed, 보내기 또는
재시작 엔드포인트를 호출하지 않습니다. 비공개 증거 파일은
`/tmp/wizard-build-live-evidence.json`이며 전체 예산은 65분입니다. 액세스 토큰을
미리 갱신하고 인증 실패한 GET은 한 번 재시도합니다. 변경 POST는 무작정 재실행하지 않습니다.

`wizard/acceptance-driver.js`는 오프라인 전송으로 해당 폴링/갱신/기한 계약을 검증합니다.
빌드 승인만으로 MR 실패, Review/Beta, 운영 환경 승격 또는 롤백을 입증하지 않습니다.
해당 명시적 작업에는 각 [환경](../templates/project-bootstrap/wizard-environments/README.md) 및
[운영 환경](../templates/project-bootstrap/wizard-production/README.md) 절차를 사용하세요.

호스트 릴리스 회귀 검사는 `tests/bootstrapper/paired-native-fixture.cjs`와 기존 `tests/operations/host-*.test.cjs` 모음을 통해 컴파일된 공유 Nest 서비스를 호출합니다. Docker/Git 및 준비 포트는 제어된 픽스처이며 실제 파일 시스템, Git, 프로세스 소유권 및 advisory 잠금은 계속 로컬에서 검사합니다. 오류 행렬은 거부마다 플랫폼을 새로 만들지 않고 소스/이미지 권한, 변경 전 거부, 중단된 소유권, 설정 드리프트, 콜드 체크포인트와 복구 실패를 검사합니다.

`tests/bootstrapper/public-controller-update.cjs`와 `public-upgrade.cjs`는 공유 서비스를 통해 쌍 업데이트, 계획/적용/복구 및 API에 의존하지 않는 롤백을 검사합니다. 정지한 컨트롤러의 전체 행렬은 `tests/operations/host-runtime-inspection.test.cjs`에 있습니다. 공개 업그레이드 픽스처는 과거 게시도 포함해 일치하는 릴리스 체크아웃 버전을 선택하며, 더 새로운 체크아웃에서 데이터베이스 마이그레이션 증거를 추론하지 않습니다.

쌍의 고정 이미지 보존 시나리오는 정확히 보관한 쌍을 롤백하므로 별도 롤백 스모크 검사에서 동일한 성공 업데이트를 다시 만들지 않습니다. 중지 상태 복구 성공 검사는 시작 후 경로, 인증된 Sync, Runner 연결이 모두 실행되는지 확인합니다. 시작 후 준비 실패 한 건은 보존된 lease/저널 경계를 검사합니다. 직접 네이티브 런타임 검사는 원격 준비 포트마다 전체 복구를 반복하지 않고 잘못된 Wizard 경로와 오래된 Runner 연결을 검사합니다.
