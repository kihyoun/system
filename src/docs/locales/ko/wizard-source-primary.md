# 하나의 소스 기준 Wizard 저장소

기존 Wizard 소스 저장소가 네이티브 빌드, 브라우저 테스트, Review/Beta 작업 및 운영 이미지도 소유할 수 있습니다.
개발과 배포에 하나의 프로젝트를 사용하므로 별도 애플리케이션 저장소는 필요하지 않습니다.
선택 사항인 GitHub 미러는 저장소의 일반 CI를 통해 검토된 소스를 계속 게시합니다.

이는 자동 소스 가져오기가 아니라 운영자가 명시적으로 저장소를 연결하는 절차입니다.
기본 관리형 등록과 레거시 초기화/업그레이드 절차는 이를 사용하는 설치에서 계속 이용할 수 있습니다.
연결한 후 Wizard는 정확한 GitLab ID, 네임스페이스 및 경로로 기준 프로젝트를 식별합니다.
소스 가져오기와 레거시 레시피 업그레이드는 개발 내용을 덮어쓰는 대신 이 모드를 거부합니다.

## 저장소 및 보존 상태 준비

1. 이전 프로젝트의 비공개 내보내기, 필요한 모든 Git 참조,
   소스/빌드/환경 실행 기록 및 배포 체크포인트를 보관하세요.
   필요한 작업 증거와 레지스트리 이미지는 별도로 내보내세요.
   프로젝트 내보내기는 완전한 레지스트리 또는 CI 아티팩트 백업이 아닙니다.
   비공개 배포 이력을 보존하려고 공개 소스 브랜치에 병합하지 마세요.
2. 활성 Review/Beta 환경을 중지하고 대기 중이거나 폐기된 임대를 정리하세요.
   재할당 전에 기존 중지 환경 정리 도우미를 사용하여 검증된 소유자가 이전 경로 조각을 제거하도록 하세요.
   연결 아카이브는 이전 삭제 표식을 변경 없이 보존하며 새 슬롯은 세대 하한을 유지합니다.
3. 소스 프로젝트의 `.gitlab/primary.yml`을 검토하세요. 소스 검사와 의도한 게시 역할을 유지하고,
   검토된 일반 빌드 레시피를 사용하는 필수 `build:wizard` 및 `test:wizard` 작업을 제공해야 합니다.
   `WIZARD_DELIVERY_ENABLED=true`와 필요한 Runner 접근으로 배포를 명시적으로 설정하세요.
   파이프라인 성공 및 토론 해결 조건을 활성화하고 정상 검토를 거쳐 병합하세요.
   해당 조건을 건너뛰거나 비활성화하지 마세요.
4. 정확한 결과 커밋에 대한 네이티브 기본 브랜치 **푸시** 파이프라인을 검증하세요.
   두 배포 작업은 모두 필수이고 성공해야 합니다.
   `build-evidence.json`과 `wizard-evidence.json`의 커밋, 파이프라인 ID 및 변경 불가능한 이미지 참조가 일치해야 합니다.
   검사에는 Vitest, 린트, TypeScript, 프로덕션 빌드, 렌더링된 UI, 이동,
   설정 ZIP 및 정확한 Cube 서명이 포함됩니다.
   필수 `build:source`와 `test:browser` 작업도 성공해야 합니다.
   `deploy:github` 게시 작업만 대기, 실행, 실패 또는 취소 상태인 경우에는 비공개 배포를 차단하지 않으며,
   실제 게시 상태는 계속 표시됩니다. 다른 모든 선택 사항이 아닌 작업은 성공해야 합니다.
   필수 네이티브 검사를 건너뛰거나 무시할 수 없으며 정상 병합 조건을 유지합니다.
5. 소스 기준 모드를 지원하는 일치하는 컨트롤러/도우미를 빌드하고 검토하세요.
   이전 Wizard 이미지를 데몬에 보관하고
   [환경 안내서](../wizard-environments/README.md)의 비공개 환경 변수를 준비하세요.

## 미리보기 및 연결

사용자의 프로젝트와 검증된 파이프라인에서 얻은 값으로 다음 필드를 가진 비공개 입력 JSON을 만드세요.

```json
{
  "version": 1,
  "projectId": 42,
  "projectPath": "example/system-wizard",
  "namespaceId": 7,
  "defaultBranch": "master",
  "pipelineId": 100,
  "sourceCommit": "REPLACE_WITH_THE_EXACT_40_HEX_COMMIT",
  "imageRef": "registry.example.test/example/system-wizard@sha256:REPLACE_WITH_THE_64_HEX_DIGEST",
  "helperImage": "sha256:REPLACE_WITH_THE_REVIEWED_64_HEX_SYSTEM_IMAGE_ID",
  "ciFiles": [
    {"path": ".gitlab/primary.yml", "sha256": "REPLACE_WITH_64_HEX_SHA256_OF_EXACT_COMMITTED_BYTES"}
  ]
}
```

`ciFiles`는 예시 행 하나만이 아니라 승인된 전체 CI 매니페스트입니다.
네이티브 CI 정의, 배포/환경 실행기, 일반 `.system-bootstrapper/build-v1/` 레시피 파일 및
참조하는 `.gitlab/` 스크립트를 포함하세요.
각 SHA-256은 `sourceCommit`의 정확한 바이트로 계산하세요.
도우미는 GitLab을 통해 해당 파일을 확인하고 예약된 일반 빌드 레시피를 독립적으로 검증합니다.
이 매니페스트를 나중에 변경하려면 검토된 연결 작업이 다시 필요하며,
일반 애플리케이션 변경은 기존 연결을 그대로 사용할 수 있습니다.

입력과 만료되는 GitLab API 인증 정보 파일을 영구 설정 디렉터리 아래에 권한 `0600`으로 저장하세요.
인증 정보 JSON에는 `baseUrl`과 `token`이 들어가며,
TLS 원본은 설정된 자체 GitLab 호스트와 일치해야 합니다.
인증 정보와 설정 내용은 출력하지 않습니다. 사용한 뒤 운영자 인증 정보를 취소하세요.

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-source-primary/run.js plan /state/adoption-input.json /state/adoption-credential.json
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-source-primary/run.js apply /state/adoption-input.json /state/adoption-credential.json PLAN_HASH
```

정확한 계획 해시, 이전/새 프로젝트 ID, 이전 운영 이미지,
새 파이프라인/이미지 및 설정 해시를 검토하세요.
적용은 GitLab을 다시 확인하고 기존 환경 뮤텍스를 획득하며,
`/state/wizard-source-primary/` 아래에 이전 설정/실행 기록 전체를 비공개로 저장한 뒤
프로젝트 연결만 원자적으로 변경합니다.
오래된 확인이나 동시 수정은 해당 내용을 덮어쓰지 않고 실패합니다.
완료된 같은 연결을 반복하면 검증 후 아무것도 변경하지 않습니다.

연결은 실행 중인 운영 컨테이너나 이미지 고정을 변경하지 않습니다.
이전 프로젝트가 존재하는 동안 정확한 이전 이미지 하나를 명시적 복구 별칭으로 기록합니다.
다른 다이제스트나 무관한 프로젝트는 허용하지 않습니다.
빌드 상태 작업은 파이프라인 생성이나 소스 가져오기 없이 네이티브 파이프라인 증거를 읽습니다.
현재 기본 브랜치 파이프라인이 대기 중이거나 실패하면 이전 빌드를 현재 빌드로 보여 주지 않고 미검증으로 표시합니다.

## 기존 소스 기준 빌드 레시피 새로고침

컨트롤러 업데이트는 기존 빌드 예약을 유지합니다.
이미 연결한 현대적인 Wizard에서 현재 개요, 빠른 설치 및 통합 문서 인터페이스를 배포하려면
새 연결 입력에서 `"buildProfile": "node24-vite8-quickstart-v5"`를 명시적으로 선택하세요.
이전 CA 갱신 대상인 `node24-vite8-ca-v4`도 계속 허용됩니다.
시작 프로필은 `node24-vite8`, 해당 cleanup-v2, overview-v3 및 CA-v4 프로필,
그리고 quickstart-v5 자체입니다. quickstart-v5에서 CA-v4로의 다운그레이드는 거부됩니다.
레거시 레시피와 초기 연결에서는 이 업그레이드를 선택할 수 없습니다.
`buildProfile`을 생략하면 정확한 기존 레시피와 과거 입력 해시를 유지합니다.

먼저 기준 Wizard 소스 프로젝트에서 정상 병합 요청을 만드세요.
검토된 컨트롤러의 `wizard-build/recipe.js` `generate(cube,
'node24-vite8-quickstart-v5')` 결과를 사용하여 반환된 모든 `files` 항목을
일치하는 UI 소스와 함께 설치하세요.
CA-v4에서 전환하면 `.system-bootstrapper/build-v1/smoke/check.js`만 변경됩니다.
기존 네이티브 `.gitlab/primary.yml`과 검증 조건은 동일하게 유지합니다.
네이티브 CI를 관리형 레시피의 별도 CI 문서로 교체하지 마세요.

CA-v4 신뢰 준비가 없는 이전 프로필에서 전환할 때는 기존 네이티브 소스 및 배포 작업의 부모도 갱신하고,
네트워크 작업 전에 커밋된 공개 번들을 설치하며 Node 작업에
`NODE_OPTIONS=--use-openssl-ca`를 설정하세요.
필수 소스, 브라우저 및 배포 검사, 공개 미러 및 환경 작업을 유지하세요.
배포 이미지와 브라우저/작업 이미지를 모두 다시 빌드하고 테스트하세요.
이전 성공 파이프라인은 새 신뢰 입력값의 증거가 아닙니다.

검토 후 병합하고 정확한 기본 브랜치 푸시 파이프라인을 검증하세요.
해당 커밋에서 새 전체 `ciFiles` 매니페스트, 변경 불가능한 이미지 다이제스트,
파이프라인 식별 정보 및 일치하는 검토된 도우미를 준비하세요.
Review/Beta를 중지하고 정리한 뒤 위의 동일한 `plan`/`apply` 명령을 사용하세요.
계획에는 이전 및 새 빌드 레시피 해시가 포함됩니다.
적용은 승인된 모든 CI 해시와 모든 일반 레시피 바이트를 독립적으로 검증하고,
이전 설정과 실행 기록을 새 비공개 아카이브에 보관하며,
기준 식별 정보와 환경 세대 하한을 유지합니다.
CA 파일 변경/누락, 무관한 레시피 또는 필수 CI 실패는 연결을 거부합니다.
운영 이미지 승격은 아래의 별도 단계입니다.

네이티브 CI 진입점이 같아도 스모크 파일이 바뀌면 승인된 `ciFiles` 매니페스트가 변경됩니다.
새 비공개 입력에 기준 프로젝트/네임스페이스/경로/기본 브랜치 식별 정보를 유지하고,
명시적 대상 프로필을 선택하며, 소스 커밋, 푸시 파이프라인 ID,
이미지 다이제스트 및 전체 커밋 파일 매니페스트를 새로 검증한 값으로 교체하세요.
검토된 변경 불가능한 도우미를 유지하세요.
새 프로필을 인식하는 검토된 컨트롤러/도우미에서 `plan`과 `apply`를 실행하세요.
저장된 실행 기록이나 해시를 직접 수정하지 마세요.
이 보호된 연결 새로고침을 완료하기 전에는 이전 연결의 검증이 변경된 관리형 스모크 바이트를 거부합니다.

이미 연결한 소스 기준 프로젝트의 메타데이터 전용 레시피 새로고침에는
비공개 입력에 `"action": "refresh-binding"`을 추가하세요.
지원되는 `buildProfile`을 명시해야 합니다.
이 작업은 정확한 기준 프로젝트 식별 정보, 일반 레시피 밖의 승인된 모든 네이티브 CI 파일,
저장소 메타데이터 및 복구 이미지 별칭을 유지합니다.
새 레시피 바이트, 전체 CI 매니페스트, 필수 병합 조건,
정확한 기본 브랜치 푸시 파이프라인 및 변경 불가능한 후보 아티팩트를 독립적으로 검증합니다.
Review/Beta는 중지하고 정리해야 합니다.
기존 비공개 아카이브, 확인 해시, 설정 비교 후 교체 및 환경 잠금이 계속 적용되며,
오래된 주 설정이나 프로젝트 설정으로는 새로고침할 수 없습니다.

운영 환경이 별도로 승인된 공개 릴리스 쌍을 실행 중인 경우에도
이 작업은 전체 주 설정과 운영 이미지 고정을 변경하지 않습니다.
그 고정은 보관된 설정으로 유지하며 후보 증거로 취급하거나 비공개 레지스트리 복구 별칭으로 추가하지 않습니다.
공개 쌍 검증과 운영 환경 승격에는 별도의 릴리스/업데이트 조건이 유지됩니다.
초기 연결과 재할당에는 여전히 정확한 이전 비공개 레지스트리 이미지가 필요합니다.
`refresh-binding`은 저장소를 연결하거나 다른 곳으로 전환할 수 없습니다.

일반적으로 검토된 컨트롤러에서 기존 `plan`/`apply` 명령을 실행하세요.
실행 중인 컨트롤러가 이 작업보다 오래된 경우, 운영자는 일치하는 승인된 변경 불가능한 도우미 이미지에
동일한 영구 설정을 `/state`로 마운트하여 사용할 수 있습니다.
컨트롤러를 시작하거나 Docker 소켓을 마운트할 필요는 없습니다.

```sh
docker run --rm --network host --mount type=bind,src=/operator/configuration,dst=/state --entrypoint node sha256:REPLACE_WITH_ACCEPTED_HELPER_IMAGE_ID /system/project-bootstrap/wizard-source-primary/run.js plan /state/adoption-input.json /state/adoption-credential.json
docker run --rm --network host --mount type=bind,src=/operator/configuration,dst=/state --entrypoint node sha256:REPLACE_WITH_ACCEPTED_HELPER_IMAGE_ID /system/project-bootstrap/wizard-source-primary/run.js apply /state/adoption-input.json /state/adoption-credential.json PLAN_HASH
```

설정 마운트와 이미지 ID를 독립적으로 검증한 운영자 입력값으로 바꾸세요.
적용/재시도에는 같은 입력과 도우미를 유지하세요.
이 방법은 커밋된 진입점을 직접 실행하며 서비스를 시작하거나 이미지를 승격하지 않습니다.

## 승격 및 중복 프로젝트 제거

범위가 제한된 레지스트리 인증으로 정확한 새 이미지를 미리 다운로드한 뒤
기존 [운영 환경 계획/적용 절차](../wizard-production/README.md)를 사용하세요.
소스 기준 검증기는 기준 연결, 승인된 CI 매니페스트,
정확한 현재 기본 브랜치 푸시 파이프라인, 필수 작업 및 일치하는 아티팩트를 요구합니다.
운영 환경은 운영자가 승격하며 소스 병합만으로 전환하지 않습니다.

실제 공개 UI, Review/Beta 배포/중지 동작, 설정 가져오기,
네이티브 빌드 상태 및 연결한 프로젝트에서의 콜드 이미지 복구를 검증하세요.
이전 이미지와 롤백 체크포인트를 보존하세요.
새 호스트가 새 프로젝트와 레지스트리 고정을 사용하도록 복구 안내와 설정 백업을 갱신하세요.

그 후에만 실행 중인 의존성이 없음을 확인하고 중복 프로젝트를 삭제하세요.
삭제하면 해당 레지스트리 엔드포인트도 사라집니다.
그 프로젝트의 과거 롤백 이미지는 의도적으로 준비한 로컬/오프라인 아카이브에 남겨야 합니다.
정확한 복구 별칭은 삭제된 레지스트리를 다시 만들거나 이전 백업을 그 레지스트리와 독립시키지 않습니다.
