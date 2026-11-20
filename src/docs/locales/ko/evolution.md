## 5. 운영 중인 시스템 진화시키기

변경되지 않은 공식 릴리스는 [공개 업그레이드 안내](RELEASES.md#upgrade-and-rollback)와
버전별 Wizard Docs 체크리스트에서 시작하세요. 저장소의 공개 릴리스 명령은 선언되고
테스트된 전환만 계획하고 명시적으로 적용합니다. Quickstart는 새 설치용입니다.
소스 빌드와 포크는 아래의 승인된 후속 버전 절차를 사용합니다. 릴리스 게시가
실행 중인 설치를 자동으로 업그레이드하지 않습니다.

세대 모델, 저장소 지도, 과거 다이어그램, 현재 도구와 미래 자율 갱신의 경계는
[아키텍처, 기원, 비전](ARCHITECTURE.md)을 참조하세요.
[의존성 업데이트 운영](DEPENDENCY_UPDATES.md)은 탐색, 명시적 승인, 그룹화된 제안, 전용 봇의
복구를 설명합니다. 잠금 파일 감사와 호환되는 수정은
[의존성 보안 안내](DEPENDENCY_SECURITY.md)를 따르세요.

시스템 진화는 개발 플랫폼을 사용해 후속 세대를 빌드하는 소스를 변경하는 것입니다.
세대 **A**는 소스, 요구 사항, 병합 요청, Runner, 이미지 Registry를 호스팅합니다.
그 파이프라인이 세대 **B**를 빌드하고 테스트합니다. 검토와 명시적인 승격 이후 B가 다음
변경에 같은 기반을 제공합니다. A를 다시 시작하거나 변경 없는 이미지를 다시 빌드하는
것만으로는 개선을 입증하지 못합니다.

소스는 DNA이고 서비스 상태는 별도 입력입니다. 공개 코드 미러나 컨테이너 이미지에는 설치의
사용자, 저장소, 이슈, 병합 요청, Registry blob, 암호화 비밀 정보가 들어 있지 않습니다.
후속 세대는 컨테이너 정의를 재현하는 동시에 이 입력도 보존해야 합니다.

### 5.1 사전 조건과 소유권

아래 호스트 승격 명령은 GitLab HTTPS 원본 주소가 구성된 Ubuntu 설치를 대상으로 합니다.
로컬 WSL/HTTP 최초 설치 경로는 별개입니다. 변경을 제안하기 전에 다음을 준비하세요.

| 입력 | 요구 사항 |
| --- | --- |
| 승인된 소스 | 깨끗하고 검토된 System 리비전과 정확한 재귀 Wizard 서브모듈 커밋이 필요합니다. 모든 초기화, 복구, 검증, 배포 진입점이 그 체크아웃에 버전 관리되어야 합니다. |
| 기존 세대 | GitLab 버전과 에디션, 불변 서비스 이미지 참조, 컨트롤러/Wizard 소스 식별 정보를 기록하세요. 저장된 구성이 최초 설치 예시보다 우선합니다. |
| 후보 자원 | 이미지 아카이브와 데이터베이스 사본을 포함해 운영 환경과 별도의 폐기 가능한 플랫폼을 수용할 용량이 있는 신뢰할 수 있는 Runner/호스트가 필요합니다. 무거운 작업을 시작하기 전에 자원 임대를 얻으세요. 현재 하네스는 후보 RAM 12 GiB를 허용하지만 이는 호스트 전체 요구량이 아닙니다. |
| 격리된 상태 | 후보 컨테이너, 네트워크, Docker 데몬, 데이터 디렉터리를 분리하세요. A 실행 중에 A의 쓰기 가능한 데이터베이스나 Registry 디렉터리를 B에 연결하지 마세요. |
| 복구 체크포인트 | 완료되고 체크섬이 검증된 콜드 Harvest 또는 동등하게 일관된 지원 백업, 일치하는 구성, GitLab 비밀 정보, 정확한 이전 이미지가 필요합니다. 전체 Certbot 계정/갱신 트리와 별도로 구성한 외부 저장소도 보존하세요. |
| 독립적인 복구 접근 | 플랫폼 자체 GitLab이 중지된 동안에도 SSH/콘솔 접근, 승인된 체크아웃 또는 Git bundle, 필수 이미지 아카이브, 비공개 저장소 선택자, 자격 증명을 사용할 수 있어야 합니다. |
| 승격 권한 | 허가된 유지 관리 시간대, 지정된 운영자/조정 담당자, 정확한 후보 증거, 복구 결정 시점이 필요합니다. 병합 성공만으로 임의의 운영 환경 변경이 허가되지는 않습니다. |

자신의 도메인, 선택한 작업 저장소, 비공개 자격 증명을 사용하세요. 설치별 선택자, 백업,
로그, 기록은 Git 밖에 보관하세요. 저장소는 이를 생성하고 검증하는 로직을 소유하며 운영자의
암호나 데이터를 포함하지 않습니다. 비밀 정보는 진입점의 비공개 입력으로 전달하고 공개
파이프라인 명세나 작업 로그로 전달하지 마세요.

[후보 하네스](../tests/e2e/README.md)는 권한 있는 비공개 Docker 데몬을 사용하므로 신뢰할
수 있는 코드가 필요합니다. 자원 제한은 상한이며 예약이나 디스크 할당량이 아닙니다.
Wizard와 GitLab을 제공할 수 있는 작은 호스트가 두 번째 전체 플랫폼도 테스트할 수 있는 것은
아닙니다.

### 5.2 A의 병합 요청 절차로 B 개발

1. 설치에서 선택한 트래커에 의도한 개선과 승인 기준을 기록하세요. 승인된 기본 브랜치에서
   브랜치를 만드세요.
2. 커밋된 이미지 선택자, 빌드 레시피, 도구, 문서를 함께 변경하세요. 정확한 GitLab 에디션/버전과
   이미지 다이제스트를 고정하세요. 후속 버전 선택에 유동 태그를 사용하지 마세요.
   이전에 승인된 고정값을 유지하세요.
3. GitLab 병합 요청을 여세요. 커밋된 리비전을 테스트하세요. 커밋하지 않은 로컬 편집이나
   비공개 래퍼는 후보의 일부가 아닙니다. 빠진 작업은 라이브 호스트에서 사용하기 전에 이곳에서
   구현하고 검토해야 합니다.
4. 필수 병합 게이트를 활성화된 상태로 유지하세요. 문서 전용 변경은 짧은 문서 경로를,
   이미지, CI, 스크립트, 인프라 변경은 완전한 런타임 경로를 사용합니다. 마이그레이션 테스트를
   피하려고 업그레이드를 문서 변경으로 분류하지 마세요.
5. 구현과 증거를 검토하고 현재 필수 파이프라인이 성공했을 때만 병합한 뒤 병합된 작업
   브랜치를 삭제하세요. 병합된 기본 브랜치 리비전은 승격 전에 해당 검사를 별도로 받습니다.

파이프라인 단계와 증거는 [테스트 안내](../tests/README.md#full-system-and-platform-gates)에
설명되어 있습니다. 컴포넌트 검사는 자식 컨테이너 안에서 호스트 소켓이나 네트워크 없이
실행됩니다. `test:candidate-image`는 커밋된 입력에서 완전한 System 이미지를 빌드합니다.
`test:platform-candidate`는 자원을 많이 사용하는 실제 플랫폼 검사를 직렬화하며 런타임 게시
전에 반드시 통과해야 합니다. 파이프라인 자원 그룹은 호스트 용량 확인과 운영자의 자원 임대를
보완하지만 대신하지는 않습니다.

공개 배포를 활성화하면 Docker Hub 게시 작업은 보호된 기본 브랜치나 보호 버전 태그에서
이 필수 검사를 뒤따릅니다. 승인 후 다시 빌드하지 않고 승인된 완전한 컨트롤러와 일치하는
Wizard를 복사합니다. 각각 전체 소스 커밋 태그를 받으며, 보호된 `vX.Y.Z` 태그는 버전 별칭을
추가할 수 있습니다. 릴리스 기록은 소스 리비전/트리, Wizard gitlink, 이미지 ID, 불변 Docker
Hub 참조를 연결합니다. 기존의 충돌 별칭은 거부하며, 익명 가져오기 검증으로 게시자 자격
증명 없이 두 공개 이미지를 가져올 수 있는지 확인합니다.
[게시자 구성](../Prepare-Host.md#publish-your-own-public-releases)을 참조하세요.

공개 게시는 운영 환경을 승격하거나 서비스 데이터를 백업하지 않습니다. 새 운영자는
승인된 소스와 두 다이제스트 참조를 선택하고 새 설치 핸드북 경로에서
`bootstrapper/install-release.py`를 사용합니다. 기존 설치는 저장된 선택자를 유지하며 대신
해당하는 검토된 승격/마이그레이션 절차가 필요합니다.

안내형 미리보기와 GitLab 마이그레이션을 함께 실행할 때
`guidedPreviewAcceptance === true`와 `gitlabUpgradeAcceptance === true`가
고정된 단일 실행 예산 75분을 선택합니다. 준비된 `publicUpgrade` 픽스처를 추가하면
실제 공개 CLI 계획 및 적용, 새로 생성한 일치하는 콜드 Seed/구성 백업,
중단된 오프라인 이미지 복구, 지속적인 복구 선택자를 사용하는 별도 컨트롤러 재시작에
대해 고정 예산 110분을 선택합니다. 해당 픽스처가 없으면 결합 시나리오는 75분을 유지합니다.
안내형 미리보기 없는 업그레이드는 60분,
업그레이드 없는 ACME는 25분, 일반 스모크 검사는 20분을 유지합니다.
원본 후보, 복원된 후보, ACME 인증 기관과 모든 보조 자원 소유자는 원래의 절대 마감 시간을 공유합니다.
단계가 시작되거나 호스트가 교체되어도 마감 시간은 초기화되지 않으며,
시간을 초과하면 자동 연장 없이 인수 검사가 실패합니다.

전체 플랫폼 CI 작업은 준비, 실행, 게시 및 아티팩트 수집을 위해
115분 Runner 스크립트, 별도의 2분 `after_script`, 120분 작업 제한을 허용합니다.
결합 시나리오의 두 상한에는 모두 가져온 기본 브랜치, 병합 요청 및 병합된 기본 브랜치의
실제 네이티브 Wizard 파이프라인 세 개가 포함되며, 각각 필수 작업 네 개를 실행합니다.
수동 Review/Beta Deploy 및 Stop도 포함됩니다. 이는 상한이며 실행 시간 보장이 아닙니다.
후보의 제한은 RAM 12 GiB와 CPU 네 개로 유지됩니다.
원래 안내형 플랫폼의 단일 관리형 Docker Runner만 동시 작업 두 개를 허용하며,
각 작업은 RAM 2 GiB와 CPU 한 개로 제한됩니다. 모든 중첩 작업은 후보 상한을 공유합니다.
완료된 하위 프로세스가 실패하면 해당 단계를 즉시 중단합니다. 준비 상태 조회는 일시적인
시작 상태를 재시도하지만, 확인된 최종 컨테이너 또는 식별 정보 오류는 즉시 중단합니다.
개별 작업의 제한 시간은 그대로 적용되며 보고서는 호출 시간 초과와 프로세스 종료를 구분합니다.
전체 상한은 추가 보호 장치이며 반드시 기다려야 하는 시간이 아닙니다.
문서 전용 변경은 짧은 경로를 유지합니다. 이전에 통과한
픽스처나 MR 실행은 승격하려는 정확한 병합 소스에 필요한 승인을 대신하지 못합니다.

### 5.3 최초 시작뿐 아니라 기존 상태 마이그레이션 검증

빈 B가 성공적으로 시작되어도 A를 업그레이드할 수 있다고 입증되지는 않습니다. A의 GitLab
버전에서 만든 대표 상태로 전환을 검증하고, 일관된 사본만 격리된 후보로 옮기세요.

1. 대표적인 사용자, 저장소, 이슈, 병합 요청과 토론, 암호화된 설정, Registry 이미지를
   준비하세요. 식별 정보와 저장소/이미지 해시를 비공개 테스트 판정 기준으로 기록하세요.
2. 지원되는 백업 절차로 모든 쓰기 주체를 중지하고 복사 전에 체크포인트를 검증하세요.
   원래 세대 또는 복구 가능한 체크포인트를 후보의 쓰기 가능 데이터와 분리해 보관하세요.
3. 제안한 GitLab 이미지로 후보를 시작하고 필요한 일반 및 백그라운드 마이그레이션이
   완료되도록 기다리세요. GitLab 준비 상태와 마이그레이션 상태를 확인하세요. Docker
   컨테이너가 실행 중이라는 사실만으로는 부족합니다.
4. 보존된 식별 정보, 암호화된 설정, Registry 가져오기를 검증한 뒤 실제 Runner
   빌드/푸시/가져오기 파이프라인을 실행하세요. 의도적으로 실패하는 작업을 실행해 후속 전달이
   차단됨을 입증하세요. 인증된 Sync 가져오기, 정확한 System Cube, Wizard 라우팅,
   영구 마운트 경계를 검증하세요.
5. 실패와 복구를 실행하세요. 정확히 소유한 후보 자원만 제거하고, 민감한 정보를 제거한
   소스/이미지/단계 증거와 정리 기록을 유지하세요. 후보 데이터 아카이브와 비밀 정보가 공개
   CI 아티팩트가 되어서는 안 됩니다.

기존 구성과 Seed 시나리오는 대표 상태와 콜드 복구 검사를 제공합니다.
[검증 경계](RECOVERY_CONTRACT.md#verification-boundaries)를 참조하세요. 같은 GitLab 버전으로
복원하는 검사는 그 자체로 버전 간 마이그레이션 증거가 아닙니다. 업그레이드에는 명시적인
원본 버전과 대상 버전의 마이그레이션 결과를 요구하세요.

### 5.4 예시: GitLab 보안 패치도 시스템 진화입니다

커밋된 [보안 릴리스 프로필](../gitlab/security-release.json)은 GitLab CE
**19.4.3 → 19.5.3** 전환과 일치하는 Helper를 포함한 GitLab Runner **19.4.0 → 19.5.1**
전환을 선언합니다. 연결된 업스트림
[패치 공지](https://docs.gitlab.com/releases/patches/patch-release-gitlab-19-5-3-released/)와
[Docker 업그레이드 안내](https://docs.gitlab.com/update/docker/)가 사전 조건을 설명합니다.
필수 데이터베이스 및 배포 후 마이그레이션이 완료되어야 합니다. 더 새 이미지라면 아무거나
서로 바꿔 쓸 수 있는 패치로 취급하지 말고 원본/대상 업그레이드 경로를 확인하세요.

선택된 System/CI 이미지와 새 버전의 Wizard 레시피는 커밋된 공개 CA 번들도 설치합니다.
기존에 예약된 레시피 해시는 계속 유효하며 다른 신뢰 저장소가 몰래 추가되지 않습니다.
해당 레시피는 명시적으로 업그레이드하세요. 이 입력과 테스트도 서비스 버전과 함께 검토된
후보의 일부입니다. 설치별 비공개 인증 기관은 런타임 구성에서 계속 별도로 제공합니다.

여기서 개선은 측정 가능합니다. 승인된 대상 이미지는 지정된 업스트림 수정을 포함하고,
이전 데이터베이스는 성공적으로 마이그레이션되며, 프로젝트, 자격 증명, 플랫폼의 빌드/전달
동작이 계속 사용 가능합니다. A가 병합 요청을 호스팅하고 B를 위해 이 테스트를 실행합니다.
라이브 호스트에서 먼저 이미지를 직접 바꾸면 이 진화 과정을 우회하게 됩니다.

단일 노드 GitLab에는 이 패치의 데이터베이스 마이그레이션 동안 중단 시간이 있습니다.
Wizard의 두 컨테이너 프록시 전환은 GitLab 데이터베이스 업그레이드를 무중단 배포로 만들지
않습니다. 같은 라이브 데이터에 구 버전과 새 버전 GitLab을 실행하거나, NGINX를 되돌리면
데이터베이스 마이그레이션도 취소된다고 약속하지 마세요.

### 5.5 승인된 후속 세대 승격

A를 중지하기 전에 승인된 소스와 필수 도구를 업그레이드 대상 GitLab 서비스 밖에 보관하세요.
유지 관리 중에도 접근 가능한 저장소에 정확한 이미지 증거와 검증된 체크포인트를 보존하세요.
전환 중 Registry를 사용할 수 없다면 필수 이미지를 미리 불러오세요. 필요한 고정 서브모듈
소스를 포함하여 미리 게시된 승인 미러나 Git bundle은 GitLab 복구에 GitLab이 필요한
의존성을 끊어 줍니다. 비공개 로컬 스크립트는 그렇지 않습니다.

소스를 독립적으로 보관하려면 소스를 사용할 수 있는 동안 관리 호스트의 깨끗한 승인
체크아웃에서 다음 표준 Git 명령을 실행하세요.

```bash
umask 077
git submodule update --init --recursive
SOURCE_BUNDLE_DIR=/root/system-successor/source
install -d -m 0700 "$SOURCE_BUNDLE_DIR"
git bundle create "$SOURCE_BUNDLE_DIR/system.bundle" HEAD
git -C wizard bundle create "$SOURCE_BUNDLE_DIR/wizard.bundle" HEAD
git bundle verify "$SOURCE_BUNDLE_DIR/system.bundle"
git -C wizard bundle verify "$SOURCE_BUNDLE_DIR/wizard.bundle"
git rev-parse HEAD
```

기록한 System 리비전과 검증된 bundle을 GitLab 서비스 밖에 보관하세요. 나중에 교체
호스트는 `system.bundle`을 복제하고 기록된 리비전을 체크아웃한 뒤 GitLab이나 GitHub에
접속하지 않고 Wizard를 초기화할 수 있습니다.

```bash
git clone "$SOURCE_BUNDLE_DIR/system.bundle" /opt/system
git -C /opt/system checkout --detach "$SYSTEM_TOOLS_REVISION"
git -C /opt/system \
  -c protocol.file.allow=always \
  -c submodule.wizard.url="$SOURCE_BUNDLE_DIR/wizard.bundle" \
  submodule update --init --recursive
```

먼저 비공개 bundle을 해당 호스트로 전송하고 `SOURCE_BUNDLE_DIR`과
`SYSTEM_TOOLS_REVISION`을 명시적으로 설정하세요. 파일 프로토콜 재정의는 검증된 로컬
bundle을 사용하는 이 호출에만 적용됩니다. 이 명령은 저장소의 Wizard 서브모듈을 다룹니다.
포크에 서브모듈을 더 추가했다면 이에 상응하는 기록된 bundle도 포함하세요. 일반 소스 ZIP에는
초기화에 필요한 Git 객체가 없습니다.

운영 환경 승격은 해당 승인 체크아웃의 커밋된 운영자 진입점을 사용합니다. 작업은 검토된
소스, 이미지 고정값, 성공한 후보 결과, 정확한 기존 설치에 연결되어야 합니다. 이를 조정하는
GitLab을 중지할 때 CI 작업이 살아남으리라 의존하지 말고, 호스트나 독립적인 관리 연결에서
실행하세요.

선언된 CE 19.4.3 → 19.5.3 전환에 허용되는 이미지 고정값은
[`gitlab/security-release.json`](../gitlab/security-release.json)에 있습니다. 계획하거나 중단에
들어가기 전에 여섯 이미지 참조를 모두 가져오세요. `fromImage`, `toImage`, `runner.fromImage`,
`runner.toImage`, `runner.fromHelperImage`, `runner.helperImage`입니다. 두 GitLab 버전과
이전 및 대상 Runner/Helper 쌍이 포함됩니다. 먼저 저장된 19.4.3 GitLab 선택을 보존하면서
승인된 도구가 포함된 **정확히 테스트된 완전한 컨트롤러 이미지**를 배포하세요. 같은 태그로
다른 이미지를 다시 빌드하고 테스트된 식별 정보를 가졌다고 가정하지 마세요. 도우미는 실행 중인
컨트롤러가 승인된 후보 증거에 기록된 이미지와 일치할 것을 요구합니다. 런타임 기반 이미지만
게시해서는 이 조건을 충족하지 못합니다.

#### 호스트에서 승인된 컨트롤러 준비

고정된 서브모듈과 함께 승인된 병합 소스를 체크아웃하세요. 해당 `test:platform-candidate`
작업에서 다음 **고정된** 아티팩트를 다운로드하세요.

- `test-results/successor/release.json`
- `test-results/successor/candidate-results.json`

예를 들어 `/root/system-successor/` 같은 비공개 디렉터리에 0600 권한으로 보관하세요.
작업용 `test-results/e2e/` 기록으로 대체하지 마세요. 독립적인 정리가 게시 후 그곳에 결과를
추가할 수 있는 반면, 고정된 사본의 바이트는 릴리스 해시에 연결되어 있습니다.

소스 프로젝트의 파이프라인, 작업, 아티팩트를 읽고 비공개 Registry 이미지를 가져올 수 있는
비공개 토큰 파일을 제공하세요. 계정의 프로젝트 권한이 해당 작업을 허용하면 적절한 `read_api`와
`read_registry` 접근이면 충분합니다. 토큰 값은 명령 인수가 되지 않습니다. 호스트 도우미는
구성된 GitLab HTTPS 원본 주소, 현재 기본 브랜치 리비전, 필수 내부 작업의 성공,
정확한 후보 작업 식별 정보, 인증된 아티팩트 바이트, 게시된 이미지/소스 레이블을 확인합니다.
선택적 GitHub 미러의 실패만 있으면 별도로 기록하며 내부 런타임 테스트를 대체하거나 약화하지
않습니다. 다른 파이프라인 실패는 승격을 차단합니다.

먼저 소스/CI 입력 검사를 실행하세요.

```bash
sudo python3 bootstrapper/promote-controller.py \
  --operation promote \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/system-successor/release.json \
  --evidence /root/system-successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/system-successor/gitlab-api-token \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/REPLACE_WITH_OPERATION_ID \
  --cold-maintenance --timeout 1200 --check-only
```

원본 주소와 경로를 배포 환경의 값으로 바꾸세요. 검토 후 같은 명령을 **`--check-only` 없이**
실행해 허가된 컨트롤러 승격을 수행하세요. `--cold-maintenance`는 Sync API로 프로젝트
큐의 유휴 상태를 입증할 수 없는 이전 컨트롤러를 위한 연결 수단입니다. 커밋된 도우미는 공개
트래픽을 중지하고, 다시 시작을 비활성화한 채 이전 컨트롤러를 동결하고, 원격 작업을 모두
마무리하고, 이전 GitLab을 정상 중지하고, 검증된 콜드 체크포인트를 만든 후 승인된 컨트롤러를
시작합니다. 이는 유지 관리 중단입니다. 이전 API가 유휴 상태라는 운영자의 주장으로 이 증거를
대체하지 마세요.

필요한 유휴/임대 프로토콜을 이미 지원하는 컨트롤러에서는 도우미가 해당 프로토콜을 승인하는
경우에만 `--cold-maintenance`를 생략하세요. 일반 기본 시작은 NGINX와 Wizard를 조정할 수
있습니다. 승인 조건은 GitLab이 기록된 이전 이미지/버전을 유지하고 GitLab 마이그레이션이
시작되지 않은 상태입니다. 컨트롤러는 승인된 이미지 ID에 연결된 소스/작업별 로컬 별칭으로
선택됩니다. 불변 Registry 참조는 릴리스 메타데이터로 유지됩니다. 로컬 별칭은 플랫폼 자체
Registry를 사용할 수 있기 전에 아카이브에서 나중에 콜드 시작할 수 있게 합니다.

이 **컨트롤러** 작업이 중단되면 동일한 체크포인트와 커밋된 상태 조회를 사용하고, 적절한 경우
중단 작업을 사용하세요.

```bash
sudo python3 bootstrapper/promote-controller.py \
  --operation status \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/REPLACE_WITH_OPERATION_ID

sudo python3 bootstrapper/promote-controller.py \
  --operation abort \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/REPLACE_WITH_OPERATION_ID \
  --timeout 1200
```

작업을 선택하기 전에 상태를 검사하세요. 컨트롤러 중단은 소유한 작업을 검증하고 이전
컨트롤러 구성을 복원한 뒤 **동일한 GitLab 이미지**로 이전 컨트롤러를 재개합니다.
데이터베이스를 되돌리지 않으며 GitLab 이미지가 바뀌었으면 거부합니다. GitLab 마이그레이션이
시작된 후에는 아래의 별도 GitLab 체크포인트 복구를 사용하세요. 호스트 컨트롤러 도구에는
`resume` 작업이 없습니다. 데이터베이스 롤백에는 GitLab 업그레이드 도우미를 통한 복원이
필요합니다.

#### 승인된 컨트롤러로 GitLab 마이그레이션

고정된 `candidate-results.json`을 비공개로 복사하여 `accepted-candidate-results.json`으로
영구 구성 디렉터리에 넣으세요. 컨트롤러는 이 디렉터리를 `/state`에 마운트합니다. 그곳에 다음 필드가
있는 비공개 `upgrade-options.json`을 만들고, 예시 경로, 작업 ID, 커밋을 배포에서 승인된
값으로 바꾸세요.

```json
{
  "sourceRevision": "REPLACE_WITH_ACCEPTED_40_CHARACTER_SYSTEM_COMMIT",
  "evidence": "/state/accepted-candidate-results.json",
  "stateDir": "/state",
  "persistentDir": "/mnt/bootstrapper-data/platform",
  "checkpointDir": "/state/gitlab-upgrades/REPLACE_WITH_UNIQUE_OPERATION_ID",
  "readyTimeoutSeconds": 900
}
```

두 입력 파일을 모두 0600 권한으로 유지하세요. `sourceRevision`은 증거에 있는 정확한
승인 리비전이어야 합니다. `persistentDir`은 설치의 볼륨 바인딩에서 사용하는 **호스트** 경로이고,
`/state`와 `checkpointDir`은 컨트롤러 경로입니다. 시도마다 전체 콜드 GitLab 사본과
예비 공간을 수용할 새 체크포인트 디렉터리를 사용하세요. 이 옵션 객체에는 API 토큰이
포함되지 않습니다.

독립적인 호스트 터미널에서 읽기 전용 계획을 요청하세요.

```bash
sudo docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js plan /state/upgrade-options.json
```

반환된 계획과 `planSha256`을 검사하세요. 승인된 증거, 소스, 현재 컨테이너, 구성을 정확한
이전/새 이미지와 체크포인트 위치에 연결합니다. 계속하기 전에 실패한 사전 조건을 해결하세요.
계획을 통과시키려고 증거를 편집하지 마세요. 해당 정확한 계획에 대한 권한을 받은 뒤 해시를
확인 값으로 사용하세요.

```bash
PLAN_SHA256=REPLACE_WITH_REVIEWED_PLAN_SHA256
sudo docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js promote /state/upgrade-options.json "$PLAN_SHA256"
```

서버를 잃게 될 GitLab CI 작업 밖에서 이 호스트 명령을 실행하세요. `checkpointSha256`을
포함한 출력을 비공개로 보관하세요. 체크포인트와 단계 기록은 구성된 `checkpointDir` 아래에
작성됩니다. 셸이나 네트워크 연결 해제는 승격 성공이나 실패의 증거가 아닙니다.

운영 환경 순서는 구성 쓰기, Harvest/복원, 인증서 상태 변경, 다른 배포와 직렬화됩니다.
GitLab 도우미는 최종 유휴 작업 검사 전에 HTTP 진입 서비스를 비워, 체크포인트 생성 중 기본
Runner와 외부 Runner가 새 작업을 가져가지 못하게 합니다. 진행 중인 작업 획득이 발견되면
이전 HTTP 서비스를 복원하고 데이터베이스 종료/체크포인트 전에 중지합니다. 그렇지 않으면
쓰기 주체를 정지시키고 최종 호환 체크포인트를 캡처한 뒤, 승인된 이미지 선택을 적용하고 B를
마이그레이션 및 검증합니다. 서비스 식별 정보와 공개 라우팅을 명시적으로 유지하세요.
운영 환경에서 후보의 테스트 자격 증명이나 비공개 테스트 호스트 이름을 활성화하지 마세요.

시작 후 실제 GitLab 버전과 마이그레이션 상태, 인증, 저장소와 이슈 접근, Registry 인증과
가져오기, 최신 Runner 관리자 접속, 인증된 구성 가져오기, Wizard 라우팅, 마운트된 저장소,
인증서 갱신을 검증하세요. 승인된 커밋, 정확한 이미지 ID/다이제스트, 체크포인트 식별 정보,
검사 결과가 담긴 비공개 승격 기록을 유지하세요.

#### B에 일치하는 복구 입력 내보내기

GitLab 마이그레이션과 승인 후 같은 깨끗한 승인 체크아웃에서 커밋된 복구 내보내기 도구를
실행하세요.

```bash
sudo python3 bootstrapper/record-recovery-images.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/system-successor/release.json \
  --evidence /root/system-successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/system-successor/gitlab-api-token \
  --output /root/system-successor/recovery-export.json
```

내보내기 도구는 승인된 CI/소스 증거와 실행 중인 컨트롤러 및 GitLab 식별 정보를 검증하고,
체크섬이 있는 컨트롤러 아카이브를 쓰고, 선언된 소스, 별칭, 공개 서비스 이미지 선택자를
갱신합니다. 이전 매니페스트 이력, 버전별 컨트롤러 별칭, 기존 Wizard 복구 입력을 정리하지
않고 보존합니다. 다음 호스트에서는 검증된 이미지 아카이브에서 로컬 컨트롤러 별칭을 복원하므로
Registry 부팅에 이전 Docker 로그인이 필요하지 않습니다.

내보내기 기록을 보관하고 매니페스트 체크섬을 독립적으로 기록하세요. 특히 선택적 공개 미러를
사용할 수 없을 때는 승인된 System Git 객체와 고정된 Wizard 소스도 GitLab 서비스 밖에
보존하세요. 새 매니페스트에 의존하기 전에 검증하세요.

```bash
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/recover-volume.sh --verify
```

이 검사는 서비스를 다시 시작하지 않고 입력을 검증합니다. 다음 교체 호스트는 A를 설명하는
이전 매니페스트 대신 B의 컨트롤러와 GitLab 이미지를 선택해야 합니다. B와 일치하는 복구
입력이 승인될 때까지 업그레이드 전 체크포인트를 유지하세요. 그때에만 B가 다음 검토된 진화를
호스팅할 준비가 됩니다.

### 5.6 실패, 복구, 자율성의 경계

마이그레이션이나 승인에 실패하면 커밋된 도우미가 기록한 단계를 검사하세요.

```bash
sudo docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js status /state/upgrade-options.json
```

도우미가 승인된 체크포인트 해시를 기록하기 전에는 `abort` 작업이 검토된 계획 해시를 받아
확인된 마이그레이션 전 실패를 복구할 수 있습니다. `checkpoint.json` 파일만으로 승인이
성립하지는 않습니다. 해시가 기록되기 전에 검증이 실패했을 수 있습니다. 체크포인트 승인 후에는
기록된 해시와 함께 `rollback`을 사용해 호환되는 이전 상태를 복원하세요. 연결이 끊긴 터미널의
종료 코드로 두 작업 중 하나를 선택하지 마세요. 영구 기록을 검사하고 원래 작업이 아직
실행 중이지 않은지 확인하세요.

```bash
# Only for a confirmed failure before checkpoint acceptance:
sudo docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js abort /state/upgrade-options.json "$PLAN_SHA256"

# For a confirmed completed-checkpoint recovery:
CHECKPOINT_SHA256=REPLACE_WITH_VERIFIED_CHECKPOINT_SHA256
sudo docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js rollback /state/upgrade-options.json "$CHECKPOINT_SHA256"
```

기록된 단계에 맞는 작업만 사용하세요. 이 명령들은 선택지이며 무조건 순서대로 실행하는
절차가 아닙니다. 도우미가 조정할 수 있도록 중단된 작업 임대와 불완전 복원 마커를 유지하세요.
거부를 우회하려고 수동으로 삭제하지 마세요.

컨트롤러가 미완료 저장소 또는 업그레이드 임대를 가지고, 불완전 복원 마커 없이 다시
시작했다면 쓰기 주체를 시작하기 전에 유지 관리 상태로 대기합니다. 위의 기본 상태 조회,
중단, 롤백 명령을 위한 `docker exec`는 계속 사용할 수 있습니다. 복구로 임대가 제거되어도
자동으로 이 상태에서 벗어나지 않습니다. 선택한 복구가 성공하고 장벽이 해제된 후에만
컨트롤러 시작을 재개하세요.

```bash
sudo docker restart system_bootstrapper_1
```

승인된 컨트롤러가 준비된 채로 남아 있는데 GitLab을 이전 이미지로 복원했다면 새 병합 요청과
필수 검사로 수정을 개발하세요. 이전의 완료된 컨트롤러 체크포인트와 새 작업 디렉터리로
문서화된 [준비된 컨트롤러 교체](../bootstrapper/README.md#replacing-an-accepted-controller-before-gitlab-migration)를
사용하세요. 도구는 이전 후보를 별도로 인증하면서 새 후보의 현재 기본 브랜치 게이트를 엄격히
유지합니다. 교체를 통과시키려고 저장된 선택자나 이전 복구 매니페스트를 편집하지 마세요.

대상 GitLab이 시작되었다면 쓰기 주체를 중지하고 실패 기록을 보존하세요. B가 이미
마이그레이션한 데이터베이스에서 이전 GitLab 이미지를 그냥 시작하지 마세요. 복구에는
커밋된 복구 절차를 통해 호환되는 업그레이드 전 상태, 구성/비밀 정보, 정확한 이전 이미지가
필요합니다. 진단이 완료될 때까지 실패한 후보 데이터를 분리해 보관하고 유일하게 사용할 수
있는 체크포인트를 덮어쓰지 마세요. 콜드 스냅샷 계약과 불완전 복원 보호는
[Harvest/Seed 복구](RECOVERY_CONTRACT.md)를 참조하세요.

플랫폼은 선언되고 테스트된 순서를 자동화합니다. 에이전트에게 새로운 인프라 변경을 임의로
만들거나, 검토를 우회하거나, 병합 게이트를 약화할 권한을 부여하지 않습니다. 이 장에서 자율
실행은 저장소 소유 도구로 허가된 버전 전환과 검증을 수행하는 것을 뜻합니다. 임의의 개선을
선택하고 승인 없이 재귀적으로 승격하는 것은 별도의 기능이며, 성공적인 패치 업그레이드에서
그 기능을 추론해서는 안 됩니다.
