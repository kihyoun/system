# 관리형 Wizard 업그레이드 v1

이 운영자 작업 흐름은 기존 비공개 관리형 Wizard 프로젝트의 소스와 도구 체인을
업그레이드합니다. 다른 프로젝트를 등록하거나 운영 환경 UI, 프록시, 이미지 고정값,
Runner 자격 증명 또는 환경 경로를 변경하지 않습니다.

## 마이그레이션 계약

1. 서명된 표준 프로젝트 구성을 읽고 소유권, 소스 마커, 원본 소스 매니페스트, 관리형
   빌드/환경 파일 및 정확한 현재 기본 브랜치 헤드를 검증합니다. Review와 Beta 임대는
   중지 상태여야 합니다.
2. 해당 프로젝트의 결정적 마이그레이션 브랜치, 검증된 공개 소스 스냅샷, 최신 레시피,
   불변의 깨끗한 도우미 및 영향받는 경로를 미리 봅니다. 알 수 없는 프로젝트 파일은
   보존하고, 로컬 개발 내용을 조용히 버리는 대신 편집된 관리형 소스를 거부합니다.
3. 명시적 확인 후 이전 구성을 볼륨에 비공개 체크포인트로 저장합니다. CI를 건너뛰는
   준비 커밋은 격리된 브랜치에서 검증된 관리 경로만 제거합니다. 소스, 빌드 및 환경
   커밋은 필수 파일별 활성화 식별 정보를 사용하여 이를 다시 만듭니다. 원래의 검증
   가능한 조상을 보존합니다. 최종 커밋 전에 마이그레이션 MR 하나를 생성하며, 최종
   커밋의 일반 MR 파이프라인이 필수 최신 빌드 및 브라우저 검사를 실행합니다.
4. GitLab 응답을 잃으면 같은 브랜치와 마커를 점검하여 조정합니다. 불확실한 커밋 또는
   MR 요청을 무작정 반복하지 않습니다. 검토 중 main과 표준 영수증은 변경하지 않습니다.
5. 네 커밋을 모두 유지한 검토된 fast-forward 후 현재 main 파일과 정확한 성공
   파이프라인 아티팩트를 확인하고 새 영수증을 원자적으로 채택합니다. 이전 작업 흐름
   메타데이터, 중지된 세대 및 tombstone을 보존합니다. 두 번째 채택은 검증된 무동작입니다.
6. 일반 표준 Review, 중지, main/Beta, 중지 및 보호된 운영 환경 승격/롤백 흐름을
   별도로 실행합니다. 실제 파이프라인과 런타임 결과를 확인하며 구성 요소 테스트로
   이를 대체하지 않습니다.

일치하는 최신 컨트롤러/도우미를 먼저 빌드하고 검토해야 합니다. 이전 도우미 이미지는
최신 빌드 레시피를 검증할 수 없으므로 재사용하지 마세요.

## 운영자 절차

표준 컨트롤러에서 Node 24로 검토된 코드를 실행하세요. 검토된 System gitlink와
일치하는 검증된 `project-bootstrap/wizard-source/snapshot.json`을 준비하세요.
만료되는 GitLab API 자격 증명을 볼륨에 모드 0600으로 비공개 저장하세요. 형식은
`{ "baseUrl": "https://gitlab.example/api/v4", "token": "..." }`입니다. API 토큰은
이 파일에서만 읽으며 명령 인수, 로그, CI 변수, 영수증 또는 체크포인트에 넣지 않습니다.
작업 후 폐기하세요. 플랫폼 자체 GitLab의 토큰이어야 하며 TLS 검증은 활성 상태로 유지됩니다.

`credentialFile`과 검토된 깨끗한 컨트롤러 이미지의 정확한 불변 `helperImage`
(`sha256:...`)를 담은 모드 0600 옵션 파일을 만드세요. 선택적 `config`, `mainConfig`
및 `directory` 경로 기본값은 `/state/.projects.env/.wizard.env`, `/state/.docker.env`
및 `/state/wizard-upgrades`입니다. 기본 구성 자체의 GitLab 호스트와 레지스트리가
강제됩니다. 이 작업 흐름은 이를 읽고 해시를 검사하며 다시 작성하지 않습니다.
어떤 쓰기든 준비하기 전에 네트워크 없는 제한된 컨테이너가 선택한 도우미 이미지에
정확히 검토된 환경/빌드 의존 파일이 있는지 확인합니다. 이 컨테이너는 Docker 소켓,
상태, 인증서 또는 자격 증명을 받지 않습니다. 운영자는 검토된 컨트롤러를 배포할 때
표준 컨트롤러의 `SYSTEM_WIZARD_ENVIRONMENT_IMAGE`도 같은 이미지로 설정해야 합니다.
미리 가져온 도우미를 공유 Runner 데몬에 유지하세요.

```sh
node project-bootstrap/wizard-upgrade/run.js plan /state/upgrade-options.json
# Review source revision, project identity, branch, current head and path diff.
# Reserve a bounded CI slot before stage: its last commit starts CI.
node project-bootstrap/wizard-upgrade/run.js stage /state/upgrade-options.json PLAN_HASH
```

반환된 기존 프로젝트 MR과 필수 `build:wizard` 및 `test:wizard` 작업을 확인하세요.
필요하면 운영자가 기존 프로젝트의 `merge_method=ff`를 검토하고 일시 선택해야 합니다.
이 도우미는 프로젝트 정책을 변경하지 않습니다. 검토와 성공 후에만 **squash나 rebase
없이 fast-forward로** 병합하여 네 체크포인트 커밋을 모두 보존하세요. 병합 직전 main은
여전히 미리 본 헤드와 같아야 하며, 채택 시 정확히 최종 환경 커밋이어야 합니다.
그 사이 관리 파일을 편집하지 마세요. 파일 내용이 같더라도 새 `last_commit_id`
증거를 보존하려면 이 이력이 필요합니다. 원하면 채택 후 이전 병합 정책을 복원하세요.
채택할 때까지 이전 영수증이 활성 상태로 남습니다.

```sh
node project-bootstrap/wizard-upgrade/run.js adoption-plan /state/upgrade-options.json
node project-bootstrap/wizard-upgrade/run.js adopt /state/upgrade-options.json ADOPTION_HASH
```

채택하려면 정확히 준비된 MR 파이프라인이 성공하고 두 검사 모두 필수여야 하며,
최신 증거와 레지스트리 다이제스트가 일치하고 MR이 병합되어야 합니다. 현재 main의
모든 준비된 소스/관리 파일도 검증된 커밋과 일치해야 합니다. 원본 소스 리비전,
가져오기/빌드/환경 영수증 및 중지된 임대는 `wizardWorkflow.upgradeHistory`에
기록하고, 관련 없는 등록 필드와 구성 바이트는 보존합니다. 비공개 체크포인트도
원래 서명된 프로젝트 구성을 볼륨에 보존합니다.

**같은** 프로젝트에 일반적인 작은 후속 MR을 만들어 새 도우미로 수동 Review 배포/중지를
확인하세요. 병합하고 수동 Beta 배포/중지를 확인한 뒤, 해당 표준 프로젝트의 검증된
다이제스트로 별도의 `wizard-production/run.js` plan/apply/rollback 절차를 사용하세요.
마이그레이션이나 채택의 일부로 운영 환경 승격이 수행되지는 않습니다.

요청 응답을 잃으면 원래 계획 해시로 `stage`를 다시 실행하세요. 정확히 이미 생성된
커밋/MR만 채택합니다. 관찰 가능한 결과가 없는 의도 기록은 관리자 점검이 필요하며,
의도적으로 또 다른 무작정 POST를 거부합니다. 이 보호를 우회하려고 체크포인트를
삭제하거나 force-push하지 마세요. 동시 구성/main 편집이나 활성 임대가 있으면 자동
덮어쓰기가 아닌 새 검토가 필요합니다. 채택 전에는 MR을 닫아 미병합 마이그레이션을
포기할 수 있으며 main과 이전 영수증은 계속 유효합니다. 채택 후에는 소스만 되돌려서는
충분하지 않습니다. 별도로 검토된 역방향 마이그레이션을 사용하세요. 운영 환경 롤백은
독립적으로 보존된 이미지/체크포인트를 사용합니다.

## 소스를 다시 가져오지 않는 빌드 및 환경 레시피

이미 최신인 관리형 프로젝트에 버전 관리되는 정리 수정, 개요 호환 브라우저 검사 또는
작업 이미지의 CA 신뢰 갱신이 필요하면 명시적 `build-` 동작을 사용하세요.
일반 소스 업그레이드 동작은 여전히 편집된 가져온 소스를 거부합니다. 이 별도 경로는
추가/삭제한 소스 파일을 포함한 기존 개발을 허용하며 예약된 빌드 파일, 환경 도우미,
관리형 CI 진입점 및 두 영수증만 바꿉니다. `buildProfile` 옵션이 없으면 기존
체크포인트의 `node24-vite8-cleanup-v2` 대상과 작업 식별 정보를 유지합니다.
최상위 개요 / Wizard 탐색이 있는 소스를 전달하려면 미리보기 전에 비공개 옵션
파일에 `"buildProfile": "node24-vite8-overview-v3"`를 설정하세요. 이 프로필은 작업
공간으로 바로 열리는 이전 최신 소스도 검증하므로 UI 변경 전에 레시피를 마이그레이션할
수 있습니다. stage, 채택 및 재시도에서 같은 명시적 대상을 유지하세요. 알 수 없는 대상과
개요 프로필에서의 실수에 의한 다운그레이드는 거부됩니다.

현재 공개 CA 갱신에는 미리보기 전에 `"buildProfile": "node24-vite8-ca-v4"`와 승인된
불변 도우미를 명시적으로 선택하세요. 이 프로필은 개요 및 정리 검사를 계승하고,
검토된 번들 신뢰 데이터로 영향받는 빌드/브라우저 이미지를 다시 빌드합니다.
stage, 채택 및 재시도 내내 명시적 프로필을 유지하세요. 옵션 생략 시의 과거 대상은
자동 변경되지 않습니다. 이 보호된 빌드 전용 마이그레이션은 최신 프로필을 허용합니다.
`legacy-ca-v4`는 새 레거시 소스 예약에 사용할 수 있습니다. 기존 레거시 프로젝트는
소스/도구 체인 마이그레이션을 거쳐 지원되는 최신 프로필로 이동해야 합니다.
레거시 프로젝트에는 여전히 별도로 검토된 소스/도구 체인 업그레이드가 필요합니다.
과거 레시피 해시와 기존 체크포인트는 계속 검증 가능합니다.

**작동 방식**, **빠른 설치** 및 통합 Docs가 있는 소스에는
`"buildProfile": "node24-vite8-quickstart-v5"`를 명시적으로 선택하세요. 모든 CA-v4
파일과 관문을 유지하면서 **System Bootstrapper 설치**의 스크롤/포커스, Docs 탐색 및 작업 공간 선택 보존을
포함한 브라우저 계약을 갱신합니다. 준비된 브라우저 관문이 실행되기 전에 일치하는 UI
소스를 전달하세요. 이 대상은 이전 최신 프로필과 자신을 허용하며, 이후 더 오래된
브라우저 프로필로의 다운그레이드는 거부합니다. 소스 기본 프로젝트는 이 레거시 가져오기
마이그레이션 동작 대신
[네이티브 소스 병합과 바인딩 갱신](../wizard-source-primary/README.md#refresh-an-existing-source-primary-build-recipe)을
사용합니다.

```sh
node project-bootstrap/wizard-upgrade/run.js build-plan /state/upgrade-options.json
# Review scope=build-environment, exact head, managed paths and preservedTreeHash.
# Reserve a bounded CI slot before this final MR commit starts CI.
node project-bootstrap/wizard-upgrade/run.js build-stage /state/upgrade-options.json PLAN_HASH
# Review required build/browser jobs; fast-forward the MR without squash/rebase.
node project-bootstrap/wizard-upgrade/run.js build-adoption-plan /state/upgrade-options.json
node project-bootstrap/wizard-upgrade/run.js build-adopt /state/upgrade-options.json ADOPTION_HASH
```

비공개 체크포인트와 마이그레이션 작업은 소스 업그레이드와 별개입니다. 보존되는 세 커밋은
준비, 빌드 및 환경입니다. 준비는 검증된 관리형 레시피 파일만 삭제하고 빌드 마커를
일시 교체하며 소스/가져오기 마커를 쓰지 않습니다. 빌드와 환경은 변경되지 않은 파일도
다시 만들어 정확한 활성화 커밋 증거를 유효하게 유지합니다. 소스 가져오기 리비전,
매니페스트, 가져오기 커밋 및 소스 마커는 원래 식별 정보를 유지합니다. 나머지 모든
저장소 파일은 바이트, Git 모드 및 마지막 변경 커밋의 결정적 지문으로 보호되며, 각
준비 커밋과 채택 직전에 검사합니다. 예상하지 못한 추가, 삭제, 내용, 모드 또는 이력
변경은 다시 가져오거나 덮어쓰지 않고 같은 작업을 실패시킵니다.

기존 소유권, 불변 도우미 검증, 환경 뮤텍스, 구성/main compare-and-swap, 불확실한
쓰기 체크포인트, fast-forward 조상 및 정확한 필수 파이프라인/아티팩트 검사가 적용됩니다.
계획 전에 Review와 Beta를 완전히 중지해야 하며 세대 하한, tombstone 및 다른 설정은
정확히 보존됩니다. Stage는 이전 표준 영수증을 활성 상태로 둡니다. 채택은 관리형
작업 흐름 영수증만 바꾸고 업그레이드 이력을 추가하며 영수증 밖의 구성 바이트는
유지합니다. 후보를 승격하거나 운영 환경 이미지 고정값을 바꾸지 않습니다. 구성을
채택했지만 체크포인트 쓰기가 중단된 경우 검증된 반복 채택이 구성을 다시 쓰지 않고
체크포인트를 복구합니다. 충돌하는 계획을 우회하려고 `build-stage`를 소스 다시
가져오기로 대체하지 마세요.
