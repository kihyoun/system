# System 후보의 선택적 Wizard Beta

System과 Wizard는 하나의 저장소를 공유합니다. 선택적 Wizard Beta는 고정
HTTPS 주소와 승인된 System 후보의 정확한 Wizard 이미지를 사용합니다. 추가
빌드나 전체 플랫폼 파이프라인을 시작하지 않습니다. Production 승격은 별도로
명시적으로 승인합니다. 일반 애플리케이션 프로젝트는 Review, Beta, Production을
유지합니다. 격리된 플랫폼 테스트는 임시 검증 설치이며 상시 Beta 플랫폼이 아닙니다.

## 설정과 연결

GitLab의 일반 저장소 절차로 전체 System 저장소를 개인 네임스페이스에 가져오거나
포크하세요. 기본 브랜치를 보호하고 필수 파이프라인 및 토론 승인 조건과 루트
CI 설정을 유지하세요. 허용된 Docker Runner를 설정하세요. Wizard에서 Configure
System Beta를 선택하고 기존 공유 소스 프로젝트와 선택적인 정확한 HTTPS Beta
호스트, /ssl 아래 인증서 및 키 경로를 지정하세요. Review 호스트는 필요하지
않습니다. 사전 검사는 소스 트리, DNS, 인증서를 확인합니다. 확인은 설정만
예약하며 프로젝트나 파이프라인을 생성하거나 Production을 변경하지 않습니다.

System 후보가 모든 필수 검사를 통과한 후 비공개 JSON 입력 파일과 저장소의
운영자 도구를 사용하세요. 입력에는 operation, projectId, projectPath,
namespaceId, defaultBranch, pipelineId, candidateJobId, sourceCommit,
wizardSourceTree, helperImage, wizardImageId, wizardImageRef가 필요합니다.
승인된 후보 릴리스 메타데이터와 예약의 정확한 값을 사용하세요. 소스 커밋은 공유
저장소를, Wizard 트리는 커밋된 하위 디렉터리를 식별합니다. Stop을 위해 도우미
이미지를 보관하세요.

```sh
node project-bootstrap/system-beta/bind.js plan /state/beta-input.json
node project-bootstrap/system-beta/bind.js apply /state/beta-input.json PLAN_HASH
```

정확한 해시를 적용하기 전에 계획을 검토하세요. 네이티브 프로젝트 변수
SYSTEM_BETA_OPERATION과 WIZARD_BETA_HOST를 예약의 작업과 정확한 호스트로
설정하세요. Deploy와 Stop은 명시적인 수동 System 파이프라인 작업입니다.
기존 릴리스 아티팩트와 변경 불가능한 이미지를 재사용합니다. 라우팅 전에 프로젝트,
작업, 후보 파이프라인, 공유 소스 트리, 이미지 식별자, 저장소 및 업그레이드 승인과
브라우저 정리를 확인합니다. 임의 이미지 배포 엔드포인트는 없습니다. 빌드
아티팩트가 만료되어도 Stop은 가능합니다.

## 기존 설치와 복구

기존 JSON/ZIP 설정은 계속 읽을 수 있고 비활성 데이터로 취급됩니다. 백업을
열거나 가져와도 프로젝트나 배포가 생성되지 않습니다. 기존 미리보기 희망 설정은
사용자가 명시적으로 Configure System Beta를 선택할 때까지 버전 1로 유지됩니다.
Review 값을 Beta 호스트로 재해석하지 않습니다. 기존 저장소 식별자, 관리 소스
기록, 사용자 변경과 가져오기 이력도 유지됩니다.

새로운 System Review 배포와 연결은 폐지되었습니다. 기존 실행 중인 Review는
보관된 원래 작업과 연결을 사용하여 과거 실행기의 Stop 모드로 중지하세요.
그런 다음 소유권이 확인된 중지 라우트를 정리하세요. 전환 전에 대기 중이거나
퇴역한 리소스를 검사하세요. 정리는 정확한 작업, 프로젝트, 세대 및 라벨을 확인하며
Production이나 다른 프로젝트의 리소스를 삭제하지 않습니다. 충돌을 우회하려고
연결, 기록, 세대 하한선 또는 묘비를 삭제하지 마세요. Beta 설정은 활성, 대기,
퇴역 리소스나 아직 정리하지 않은 중지 라우트가 있으면 거부합니다.

```sh
node project-bootstrap/system-review/run.js stop
node project-bootstrap/wizard-environments/cleanup-stopped.js OPERATION
```

Stop 실행기에는 원래 작업 식별자와 보관된 도우미 이미지가 필요합니다. 원래
승인된 작업에서 실행하고 CI 증거를 꾸며내지 마세요. 해당 작업을 실행할 수
없다면 보관된 과거 릴리스 도구와 소유권 기록으로 복구하세요. 연결과 이력은
영구 컨트롤러 상태에 속하므로 일치하는 Harvest/Seed 복구에 함께 보관해야
합니다. 설정 백업은 서비스 데이터 백업과 별개입니다. 소스 레이아웃 필드가
없는 과거 릴리스는 별도 Wizard gitlink 식별자를 유지합니다. 그 커밋을 공유
트리로 재해석하지 마세요.

## 검증과 용량

구성 요소와 후보 검증은 계속 필수입니다. Beta 연결, 실행기 및 검증기 테스트는
다른 소유권, 오래된 작업, 이미지와 소스 불일치, 자격 증명 정리 및 아티팩트
만료 후 Stop을 검사합니다. 비교 가능한 승인 후보 실행의 시간과 리소스 사용량을
비교하세요. 선택적 Review 작업 제거만으로 격리된 전체 플랫폼 테스트가 단축되는
것은 아닙니다. 이 변경 자체가 측정된 절감 효과를 의미하지는 않습니다.
