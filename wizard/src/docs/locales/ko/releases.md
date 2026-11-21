# 승인된 제품 릴리스

System은 [Semantic Versioning](https://semver.org/)에 따라 **MAJOR.MINOR.PATCH**를 사용하고
`vX.Y.Z` 태그를 붙입니다. 공개 설정, 백업, API 또는 설치 계약의 호환성을 깨는 변경은
주 버전을 올리고, 호환되는 기능은 부 버전, 호환되는 수정 및 보안 수정은 패치 버전을 올립니다.
데이터베이스 마이그레이션은 운영자 계약이 호환되어도 중단 시간과 체크포인트가 필요할 수 있습니다.
릴리스 노트에는 마이그레이션과 복구 요구 사항을 명시해야 합니다.
SemVer만으로 임의의 업그레이드가 안전하다고 판단할 수는 없습니다.

**1.0.0은 최초의 지원 제품 기준 버전입니다.** 과거 커밋과 이미지 공개는 원래 식별 정보를 유지합니다.
`VERSION`과 [관리되는 변경 이력](https://github.com/kihyoun/system/blob/master/CHANGELOG.md)은
각 릴리스를 준비할 때 검토합니다. 실패한 후보, 재시도 및 일반 파이프라인 실행에는 새 버전을 부여하지 않습니다.
소스/이미지 시도에 이미 버전이 할당되었다면, 다른 승인 시도에는 검토를 거친 새 버전이 필요합니다.

## 공개 릴리스 구성

[GitHub Releases](https://github.com/kihyoun/system/releases)는 신뢰할 수 있는 GitLab 절차의 결과를 제공합니다.
공개 코드 미러와 Docker Hub는 각각 소스와 이미지 배포 경로로 유지됩니다.
GitHub Actions는 공개 절차에 참여하지 않습니다. 각 안정 릴리스에는 다음이 포함됩니다.

- 미러링된 정확한 승인 System 커밋을 가리키는, 생성만 가능한 GitHub 표시용 태그와
  검토된 변경 이력에서 가져온 사용자용 릴리스 노트.
- `system-release-vX.Y.Z.json` 및 SHA-256 검증 파일: 정확한 System 커밋,
  소스 트리와 Wizard 소스 식별 정보, 일치하는 공개 컨트롤러/Wizard 참조,
  변경 불가능한 매니페스트/설정 다이제스트와 승인 이미지 ID,
  동일 시도의 증거 해시와 검증된 호스트 호환성, 설치/업그레이드/복구 링크.
- 해당 릴리스 태그에 고정된 `quickstart.sh`와 `release-notes.md`.

공개 매니페스트 형식은 `system-accepted-release-v1`로 유지됩니다. 공통 저장소 릴리스는
`sourceLayout: system-monorepo-v1`과 정확한 `wizardSourceTree`를 명시합니다.
과거 릴리스는 별도 Wizard gitlink를 기록합니다. 모든 데이터는 동일 파이프라인의
승인된 후보, Docker Hub 공개 및 일치하는 소스 공개 증거로부터 생성합니다.
내부 원본 기록, 비공개 레지스트리 URL, 설정, Seed, 인증 정보 및 운영 로그는 릴리스 자산에 포함하지 않습니다.
메타데이터와 체크섬은 모두 신뢰할 수 있는 GitHub 릴리스에서 받습니다.
체크섬은 전송 불일치를 탐지하며 독립적인 서명 신원을 증명하지 않습니다.

명시적으로 선택한 버전을 가져오는 예:

```bash
curl -fLO https://github.com/kihyoun/system/releases/download/v1.0.0/system-release-v1.0.0.json
curl -fLO https://github.com/kihyoun/system/releases/download/v1.0.0/system-release-v1.0.0.json.sha256
sha256sum -c system-release-v1.0.0.json.sha256
```

과거 1.0.0 릴리스에서는 매니페스트의 `source.revision`을 체크아웃하고 고정된 서브모듈을 초기화하세요.

```bash
git clone https://github.com/kihyoun/system.git
cd system
git checkout --detach v1.0.0
git submodule update --init --recursive
git rev-parse HEAD HEAD^{tree}
git ls-tree HEAD wizard
```

출력을 매니페스트와 비교하세요. 과거 GitHub 소스 압축 파일에는 Wizard 서브모듈 내용이 없으므로
완전한 재귀 체크아웃이 아닙니다. 보존된 Wizard 릴리스 참조를 통해
Wizard 기본 브랜치를 변경하지 않고 고정된 gitlink를 공개적으로 가져올 수 있습니다.

2.0.0 이후 공통 소스 릴리스에서는 기록된 정확한 System 리비전을 체크아웃하세요.
Wizard는 해당 커밋의 일반 디렉터리입니다. `git rev-parse HEAD:wizard`를 기록된
Wizard 트리와 비교하세요. 이 레이아웃에는 별도 Wizard 복제, 소스 공개 또는
서브모듈 초기화가 필요하지 않습니다.

새 호스트는 런타임을 준비하는 [빠른 시작](QUICKSTART.md)으로 설치하세요. 명시적 경로는
먼저 [호스트 런타임 준비](../Prepare-Host.md#prepare-the-host-operations-runtime)를 완료한 뒤 매니페스트의
`images.controller.reference`와 `images.wizard.reference`를
`system-bootstrapper install --controller ... --wizard ... --release-metadata ...`에 전달하세요.
네이티브 설치 프로그램은 정확한 소스와 다운로드한 이미지 식별 정보를 검증합니다.
참조만으로 이미지 내용을 보존할 수는 없습니다. 검증된 이미지 아카이브를 보관하거나,
필요한 복구 기간 동안 공개/비공개 레지스트리를 복구할 수 있도록 준비하세요.

## 신뢰할 수 있는 공개 및 재시도 동작

필수 구성 요소, 브라우저, 후보 이미지 및 일회용 플랫폼 검사,
검토된 병합, 병합 후 검사, 공개 이미지 복사 및 소스 미러링은 GitLab에서 수행합니다.
보호된 네이티브 기본 브랜치의 `deploy:github-release` 작업은 해당 작업들이 끝난 뒤 실행됩니다.
GitLab API로 정확한 파이프라인/소스/아티팩트 소유권을 검증하고,
공개 소스와 이미지를 익명으로 가져올 수 있는지 확인합니다. 이미지를 복사하거나 다시 빌드하지 않습니다.
기존 GitLab 버전 태그 파이프라인의 검증은 그대로 유지됩니다.
GitHub 전용 표시 태그는 GitLab 태그 파이프라인을 만들지 않습니다.

게시 도구는 직렬화된 리소스 그룹을 사용합니다. 초안을 만들고 일관된 자산을 업로드한 뒤
게시하고 익명 조회를 검증합니다. 재시도는 동일 커밋의 태그, 동일한 릴리스 필드 및
바이트 단위로 동일한 자산만 재사용하며, 재할당이나 교체를 거부합니다.
중단된 초안은 같은 시도를 다시 실행하여 완료할 수 있습니다.
게시된 버전에는 누락된 자산이나 교체 자산을 추가할 수 없습니다.
이 절차 밖의 작성자로부터 추가로 보호하려면 GitHub의 변경 불가능한 릴리스와
레지스트리의 변경 불가능한 검색 태그를 활성화하세요.

신뢰할 수 있는 GitLab Runner에 다음 보호 변수를 설정하세요.

- `GITHUB_RELEASE_PUBLISH_ENABLED=true`와 기존 Docker Hub 및 GitHub 백업의
  활성화 플래그와 인증 정보. 별도 Wizard 소스 공개는 과거 gitlink 릴리스에만 필요합니다.
- `GITHUB_RELEASE_REPOSITORY=kihyoun/system` 또는 운영자의 공개 미러.
- `GITHUB_RELEASE_TOKEN_FILE`: 릴리스 저장소에만 Contents 쓰기 권한을 가진
  범위 제한 GitHub 토큰이 들어 있는 외부 mode-0600 파일.
  대체 수단은 보호되고 마스킹된 `GITHUB_RELEASE_TOKEN`입니다. 파일 선택이 우선합니다.
- `SYSTEM_RELEASE_GITLAB_TOKEN_FILE`: 소스 프로젝트용으로 범위가 제한된 GitLab `read_api`
  토큰이 들어 있는 외부 mode-0600 파일. 대체 수단은 보호되고 마스킹된
  `SYSTEM_RELEASE_GITLAB_TOKEN`입니다. SSH 미러 인증 정보는 릴리스 API 게시에 사용할 수 없습니다.

두 토큰은 신뢰할 수 없는 MR 코드가 접근할 수 없게 하고 체크아웃 및 아티팩트 경로 밖에 보관하세요.
인증 정보가 없으면 안전하게 중단됩니다. 기존 미러 SSH 키를 사용할 수 있는 API 토큰으로 간주하지 않습니다.
공개 메타데이터에는 이 인증 정보를 넣지 않습니다.

## 업그레이드와 롤백

릴리스 게시가 기존 설치를 자동으로 업그레이드하지 않습니다. Quickstart는
새 설치용이며 다시 실행하거나 Git을 가져오는 것만으로 업그레이드되지 않습니다.
Wizard Docs의 릴리스 장에서는 Sync 없이 설치 버전과 대상 버전을 직접 선택할 수
있습니다. 선택은 안내만 표시하며 명령을 실행하지 않습니다.

최초 선언된 전환은 Ubuntu 24.04 / 26.04 x86_64에서 변경되지 않은 공식
컨트롤러/Wizard 쌍의 **1.1.3 → 1.2.0**입니다. 두 이미지와 저장된 릴리스 선택이
변경됩니다. 로그 제한을 포함한 대상 Compose 정책을 적용하면서 핵심 컨테이너도
다시 생성될 수 있습니다. GitLab, 데이터베이스, Runner, NGINX, 애플리케이션 프로젝트, 도메인과
저장소 선택은 유지됩니다. CLI 사전 점검이 허용하려면 대상 릴리스에 일치하는
전환 검증 자료가 공개되어야 합니다. 알 수 없는 릴리스, 불일치하는 소스/이미지
식별 정보, 비공개 Wizard 이미지 대체, 다운그레이드와 선언되지 않은 서비스 및
데이터베이스 전환은 유지보수 전에 실패합니다. 호환되는 제품 버전 번호만으로
필수 데이터베이스 중간 단계를 생략할 수 없습니다.

다음 예시는 **과거 1.2.0 체크아웃**에 해당합니다. Python 진입점은 해당 태그에
그대로 남아 있으며 2.0 런타임에는 포함되지 않습니다. 각 필수 중간 단계에는
해당 버전의 명령을 사용하세요. 2.0에서는 기본 CLI 런타임을 준비하고 별도로
검토된 [GitLab 마이그레이션](#native-upgrade-from-120-to-200)을 완료한 뒤 릴리스 쌍 단계를 진행하세요.

1. 선택한 대상 릴리스 소스와 정확한 Wizard Git 링크를 가져옵니다. 이전
   체크아웃과 복구 입력을 별도로 보관합니다. 공개 메타데이터와 게시자를
   명시적으로 신뢰하는 버전을 사용하세요.

```bash
git clone https://github.com/kihyoun/system.git system-upgrade
cd system-upgrade
git checkout --detach v1.2.0
git submodule update --init --recursive
```

2. 유지보수 시간을 확보하고 실행 중인 작업, 플랫폼 작업과 GitLab 백그라운드
   마이그레이션이 끝날 때까지 기다립니다. 계획과 승인 사이에는 저장소나 계정을
   수정하지 마세요. 읽기 전용 운영 표본은 기존 프로젝트와 저장소 커밋, 사용자,
   이슈, 병합 요청과 레지스트리 기록을 종류별 최대 열 개씩 비교합니다. 표본은
   마운트, 이미지와 구성 검사를 보완하지만 모든 사용자 레코드를 나열하지는
   않습니다. 호스트에는 최소 8 GiB RAM과 라이브 복구 저장소 및 Docker 저장소에
   각각 추가 8 GiB 여유 공간이 필요합니다. 기본 Harvest 사전 점검은 명시적으로
   선택한 백업 파일시스템, UUID와 필요한 용량을 별도로 검사합니다.

3. 백업 미디어를 연결하고 그 안에 새 구성 ZIP 파일명을 선택합니다. 아래
   예시 경로를 모두 자신의 경로로 바꾸세요. 기존 비공개 저장소 선택 파일과
   **자신의 설치**에서 Runner와 관리자를 읽을 수 있는 모드 0600 API 토큰 파일을
   사용합니다. 게시자 GitLab의 계정, API 토큰이나 비공개 아티팩트 접근은 필요하지
   않습니다. 계획은 관련 유지보수 전에 공개 대상 이미지 쌍을 가져와 검증하고,
   소스와 이미지 식별 정보, 라우팅, 인증된 Fetch, 유휴 작업, 마이그레이션
   사전 요구 사항과 Runner 연결을 검사한 후 영향과 복구 절차를 출력합니다.

```bash
sudo python3 bootstrapper/upgrade-release.py \
  --target 1.2.0 \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0 \
  --backup-file /mnt/backup/configuration-before-1.2.0.zip \
  --token-file /root/system-api-token
```

유휴 Runner의 접속 시각은 캐시된 값일 수 있습니다. 식별 정보가 일치하는 관리자가
온라인이지만 접속 시각이 기준 상태보다 이전이면 기본 검증기는 해당 기존
컨테이너 안에서 공식 명령
`gitlab-runner verify --config /etc/gitlab-runner/config.toml`을 실행합니다.
명령은 전체 준비 기한 안에서 최대 15초로 제한됩니다. 이후 API를 다시 읽고
보존된 식별 정보, 온라인 상태와 기준 상태 이후의 접속을 계속 요구합니다.
등록이나 구성 변경 또는 새 작업 없이 저장된 구성의 인증을 검사합니다.
영수증에는 `authenticationProbeCount`와 `jobExecutionChecked=false`가 기록됩니다.
실행 중인 폴러의 활동과 작업 실행은 이 검사 범위에 포함되지 않습니다.
격리된 플랫폼 후보는 게시 전에 실제 CI 실행을 검증합니다.

실패한 읽기 전용 사전 점검은 상태 명령으로 확인할 수 있습니다. 사전 요구 사항을
해결한 후 상태가 실패이며 검토된 계획이나 업데이터 체크포인트가 없을 때만 같은
디렉터리에서 계획을 다시 만드세요. 프로세스가 사라진 뒤 점검 중으로 남아 있다면
기존 디렉터리를 보관하고 새 계획 디렉터리를 선택하세요. 기본 잠금 검사는 활성
또는 미완료 작업을 계속 거부합니다. 잠금을 삭제하지 마세요.

공식 업그레이드는 게시 시 기록된 정확한 런타임 이미지 ID를 요구합니다.
Docker 이미지 저장소는 매니페스트 또는 구성 다이제스트를 로컬 이미지 ID로
표시할 수 있으며, 두 다이제스트는 별도로 검증합니다. 로컬 ID가 기록된 승인
ID와 다르면 새 설치에서 해당 저장소의 ID를 허용했더라도 업그레이드를
거부합니다. ID가 다를 때는 문서화된 소스/복구 절차를 사용하세요.
CLI는 이미지 저장소를 변환하지 않으며, 메타데이터나 런타임 선택자를
변경해도 이 제한은 해결되지 않습니다.

4. 전체 계획과 SHA-256을 검토합니다. `PLAN_SHA256`을 출력된 정확한 해시로
   바꾸세요. Apply는 확인 해시가 없거나 다르면 거부합니다. 공개 릴리스와 저장된
   구성을 다시 검사하고 먼저 이전 컨트롤러/Wizard 이미지 파일을 보관합니다.
   이어서 기존 조정된 백업을 실행한 후 정확한 구성 ZIP을 완료된
   Seed 세대 및 매니페스트와 대조합니다. 미디어가 없으면 명시적으로 실패하며
   시스템 디스크에 대체 백업 디렉터리를 만들지 않습니다. 두 복구 입력을 독립적으로
   보관해야 합니다. 이전 컨트롤러/Wizard 이미지 파일, 공개 검증 자료, 선택 파일과
   기본 업데이트 체크포인트를 쌍 업데이트 시작 전에 선택된 라이브 복구 디렉터리
   아래에 보관합니다.

```bash
sudo python3 bootstrapper/upgrade-release.py --operation apply \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0 \
  --token-file /root/system-api-token \
  --confirm-plan PLAN_SHA256
```

5. 일치하는 콜드 백업은 GitLab을 일시 중지한 후 다시 시작합니다. 쌍 업데이트는
   컨트롤러/Sync와 Wizard를 재시작합니다. 대상 Compose 정책 변경으로 GitLab,
   프록시 및 Runner 관리자를 포함한 핵심 컨테이너도 다시 생성될 수 있습니다. 기존 작업이 먼저 끝나야 합니다.
   소요 시간은 데이터와 호스트 성능에 따라 달라지며 고정 중단 시간은 보장되지
   않습니다. 기존 업데이터가 라이브 상태 잠금과 롤백 체크포인트를 소유합니다.
   완료 조건은 저장된 구성과 인증된 Fetch의 일치, 예상 서비스 및 마운트 식별 정보,
   관리 라우팅, 레지스트리 인증, 최신 Runner 관리자 연결과 읽기 전용 데이터 표본의
   일치입니다. 비공개 작업 기록에 정확한 승인 버전과 소스가 남습니다. 결과를 승인할
   때까지 검증과 복구 입력을 보관하세요. 사용자는 자신의 설치에서 개발용 전체
   플랫폼 테스트를 실행하지 않습니다.

6. 중단되면 먼저 상태를 확인합니다. 컨트롤러 업데이터 시작 전에 백업이 실패했다면
   보관된 조정 백업 작업을 검사하고 기본 상태와 잠금을 해결한 후 새 계획을
   만드세요. 업데이터 체크포인트가 있으면 Recover가 보관된 이전 이미지 파일을
   검증하고 로드한 뒤 소유한 중단 잠금의 복구를 포함한 기존 쌍 롤백을 실행합니다.
   활성 잠금을 삭제하거나 마이그레이션된 데이터에 이전 데이터베이스 이미지를
   실행하지 마세요.

```bash
sudo python3 bootstrapper/upgrade-release.py --operation status \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0
sudo python3 bootstrapper/upgrade-release.py --operation recover \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0 \
  --token-file /root/system-api-token \
  --confirm-plan PLAN_SHA256
```

Docker 아카이브는 이미지 ID를 보존하지만 레지스트리 다이제스트 선택은 잃을 수
있습니다. 따라서 복구는 검증된 `system-bootstrapper-recovery:…` 별칭을
`BOOTSTRAPPER_IMAGE`와 `WIZARD_IMAGE`에 저장하고 비공개 이미지 ID 기록을 남깁니다.
이전 컨트롤러가 저장된 구성을 다시 읽은 뒤에도 오프라인으로 시작할 수 있습니다.
나머지 구성 바이트는 모두 유지됩니다. 원래 구성과 릴리스 선택은 컨트롤러
체크포인트에 보관됩니다. 상태는 원래 구성 경로와 명시적인 복구 선택 모드를
표시합니다. 다음 공식 업그레이드 전에는 해당 체크포인트의 원래 컨트롤러와
Wizard 다이제스트 참조를 가져와 기록된 이미지 ID와 일치하는지 확인한 후,
일반 구성 절차로 이 두 선택만 복원하세요. 다른 현재 설정을 덮어쓰거나 보관된
복구 입력을 삭제하지 마세요.

현재 그래프는 컨트롤러/Wizard 쌍 업데이트 전에 GitLab 데이터베이스를
마이그레이션하는 **1.2.0 → 2.0.0** 전환도 선언합니다. 컨테이너 롤백은 데이터베이스
마이그레이션을 되돌릴 수 없습니다. 선언된 서비스 전환은 기존
[GitLab 마이그레이션 및 콜드 체크포인트 복구](HANDBOOK.md#5-evolving-a-running-system)
절차의 필수 중간 버전과 독립적으로 보관한 복구 입력을 사용하며, 공개 CLI는
구현되지 않은 전환 종류를 거부합니다. 전체 [구성과 Seed 복구](RECOVERY_CONTRACT.md)는
새 라이브 저장소로 복구하는 절차입니다. 중간 릴리스가 있는 경로는 순서대로
표시됩니다. Apply는 먼저 첫 중간 릴리스의 체크아웃, 새 백업과 별도 승인 계획을
요구하며 다음 단계에서도 반복합니다. 최종 태그로 바로 건너뛰지 않습니다.

릴리스 선택 기록이 없는 변경되지 않은 공식 소스 빌드와 수정된 포크는 기존
후속 버전 절차를 사용합니다. 업스트림을 병합하고 충돌을 해결한 후 자신의 후속
버전을 빌드하고 검증하여 기본 검증 자료로 명시적으로 승격하세요. 공식 릴리스의
공개 검증 자료는 로컬 수정에 적용되지 않으며 누락된 소스 식별 정보를 추정하지
않습니다.

공개 매니페스트는 `system-upgrade-vX.Y.Z.json`을 SHA-256으로 연결합니다. 명시적으로
허용된 검증 자료에는 정확한 소스/이미지 식별 정보, 동일 시도의 성공한 필수 작업,
원래 검증 자료 해시, 저장소/마이그레이션 증거와 테스트된 전환이 포함됩니다.
원시 로그, 비공개 레지스트리 주소와 구성은 제외됩니다. 신뢰는 명시적으로 선택한
게시자 저장소에 대한 HTTPS 연결과 검토된 게시 절차에서 나옵니다. 해시는 게시물의
일관성을 입증하지만 파일과 함께 제공된 체크섬은 독립적인 서명이 아닙니다.
사용자 검사는 게시자의 기본 병합 및 승인 게이트를 비활성화하지 않습니다.

지원되는 각 릴리스에서 `config/releases/upgrade-paths.json`을 유지하세요. 실제로
실행한 오름차순 전환, 사전 요구 사항, 순서가 있는 단계와 명명된 후보 테스트만
추가하고 필수 중간 릴리스를 유지합니다. CLI와 오프라인 Wizard는 같은 메타데이터를
사용합니다. Docs를 내보내고 영어, 독일어, 한국어 내용을 검토하며 메타데이터/UI 및
실패/복구 검사를 실행한 다음 기존 후보에서 이전 공개 릴리스 전환을 테스트하세요.
이전 이미지는 관리자 전용 고정값이 아니라 공개 메타데이터에서 가져옵니다.
게시자는 일치하는 성공한 런타임 전환 증거가 없으면 해당 경로를 거부합니다.
메타데이터를 바꾸는 것만으로 호환성이 생기지 않습니다.

### 1.2.0에서 2.0.0으로 기본 업그레이드

지원되는 Ubuntu x86_64의 변경되지 않은 공식 1.2.0 설치와 일치하는 구성/Seed
백업을 사용하세요. 실행 중인 작업과 미완료 백그라운드 마이그레이션을 기다리세요.
이전 승인 릴리스와 복구 도구를 별도로 보관하고 자신의 저장소, 도메인 및 비공개
설치 API 토큰을 선택하세요. 아래 경로는 예시입니다. 모든 명령에 실제 영구 저장소
루트와 마운트된 백업 파일시스템을 적용하세요.

정확한 대상 버전을 가져오고 중단 전에 검증된 오프라인 런타임을 준비하세요.
현재 Wizard는 System 소스 트리에 포함되므로 이 태그에는 Wizard 서브모듈이 필요 없습니다.

```bash
git clone https://github.com/kihyoun/system.git system-upgrade-2
cd system-upgrade-2
git checkout --detach v2.0.0
sudo bash tools/quickstart/quickstart.sh --runtime-only v2.0.0
test ! -e dist && test ! -e node_modules && test ! -e assets && \
sudo cp -a /opt/system-bootstrapper-runtime/cli/node_modules/@systembootstrapper/cli/dist dist && \
sudo cp -a /opt/system-bootstrapper-runtime/cli/node_modules/@systembootstrapper/cli/node_modules node_modules && \
sudo cp -a /opt/system-bootstrapper-runtime/cli/node_modules/@systembootstrapper/cli/assets assets
```

Prepare는 공개 메타데이터/검증 자료와 설치된 릴리스를 검증하고 유지보수 전에
승인된 도우미와 여섯 개의 정확한 GitLab/Runner/Helper 이미지를 가져옵니다.
서비스를 업그레이드하지는 않습니다. 게시자 계정이나 비공개 파이프라인 아티팩트는
필요하지 않습니다. Plan이 출력한 GitLab 계획 해시를 검토하고 Promote 전에
`GITLAB_PLAN_SHA256`을 바꾸세요. 이전 컨트롤러 선택을 유지하면서 승인된 대상
도우미가 공유 Nest 마이그레이션 서비스를 실행합니다.

```bash
sudo system-bootstrapper gitlab-upgrade \
  --operation prepare --checkout "$PWD" --target 2.0.0 \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --directory /var/lib/system-bootstrapper/platform/configuration/gitlab-prerequisites/to-2.0.0
sudo system-bootstrapper gitlab-upgrade \
  --operation plan --checkout "$PWD" \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --directory /var/lib/system-bootstrapper/platform/configuration/gitlab-prerequisites/to-2.0.0
sudo system-bootstrapper gitlab-upgrade \
  --operation promote --checkout "$PWD" --confirm-plan GITLAB_PLAN_SHA256 \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --directory /var/lib/system-bootstrapper/platform/configuration/gitlab-prerequisites/to-2.0.0
```

반환된 `checkpointDir`와 `checkpointSha256`을 보관하세요. 첫 번째 값은 아래 쌍
계획에 전달할 호스트 디렉터리입니다. 계속하기 전에 Status로 GitLab 작업을 확인하세요.
쌍 계획은 완료된 체크포인트, 실제 마이그레이션 이미지/버전과 공개 전환 증거를
검증합니다. Apply는 컨트롤러/Wizard 복구 이미지를 보관하고 일치하는 조정된 백업을
만듭니다. 이 별도 계획을 검토하고 `PAIR_PLAN_SHA256`을 명시적으로 바꾸세요.

```bash
sudo system-bootstrapper upgrade \
  --checkout "$PWD" --target 2.0.0 \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-2.0.0 \
  --gitlab-checkpoint /var/lib/system-bootstrapper/platform/configuration/gitlab-upgrades/public-to-2.0.0 \
  --backup-file /mnt/backup/configuration-before-2.0.0.zip \
  --token-file /root/system-api-token
sudo system-bootstrapper upgrade \
  --operation apply --checkout "$PWD" --confirm-plan PAIR_PLAN_SHA256 \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-2.0.0 \
  --token-file /root/system-api-token
```

완료에는 위에 설명된 동일한 기본 검증이 필요합니다. 준비 디렉터리, 두 체크포인트,
구성 ZIP과 Seed를 보관하세요. 중단 후에는 상태를 먼저 확인하세요. 재시도를 위해
잠금을 삭제하지 마세요.

```bash
sudo system-bootstrapper upgrade \
  --operation status --checkout "$PWD" \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-2.0.0
sudo system-bootstrapper gitlab-upgrade \
  --operation status --checkout "$PWD" \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --directory /var/lib/system-bootstrapper/platform/configuration/gitlab-prerequisites/to-2.0.0
```

쌍 업데이트가 중단되면 `system-bootstrapper upgrade --operation recover`를 같은 계획
디렉터리, 비공개 토큰 및 `--confirm-plan PAIR_PLAN_SHA256`과 함께 사용하세요.
이전 컨트롤러/Wizard 쌍을 복구하며 GitLab은 되돌리지 않습니다. 데이터베이스 롤백도
필요하면 먼저 쌍 복구를 완료한 뒤 `system-bootstrapper gitlab-upgrade --operation rollback`을
같은 준비 디렉터리, `--confirm-checkpoint GITLAB_CHECKPOINT_SHA256` 및
`--paired-checkpoint /var/lib/system-bootstrapper/platform/recovery/controller-updates/to-2.0.0`과 함께
사용하세요. 도우미는 재생성된 이전 컨트롤러를 허용하기 전에 완료된 쌍 복구를
검증합니다. 완료된 GitLab 체크포인트가 없으면 별도의
`--operation abort --confirm-plan GITLAB_PLAN_SHA256`으로 이전 세대를 재개하세요.
데이터베이스 롤백은 콜드 체크포인트 이후 기록을 삭제합니다. 오프라인 런타임과 승인된
도우미 이미지를 보존하세요. 복구 중에는 다운로드하거나 다시 빌드하지 않습니다.
