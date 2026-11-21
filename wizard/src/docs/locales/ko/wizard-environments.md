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

인증된 Sync 상태 엔드포인트 /projects/wizard/preview-setup에서 예약 작업 값을
읽으세요. 승인된 후보의 release.json에서 sourceRevision은 sourceCommit으로,
imageId는 helperImage로, wizardRegistryReference는 wizardImageRef로 옮기고
projectId, pipelineId, candidateJobId, wizardSourceTree, wizardImageId는 정확히
복사하세요. projectPath, namespaceId, defaultBranch는 같은 선택된 공유 GitLab
프로젝트에서 가져옵니다. Helper 이미지는 정확한 승인 소스/작업 라벨과 함께
컨트롤러의 Docker 호스트에 이미 있어야 하며 Stop을 위해 보존해야 합니다.
다른 파이프라인의 값은 이 예약에 권한을 부여할 수 없습니다.

```sh
system-bootstrapper system-beta bind plan /state/beta-input.json
system-bootstrapper system-beta bind apply /state/beta-input.json PLAN_HASH
```

정식 컨트롤러가 실행 중인 Docker 호스트의 검토된 체크아웃에서 Node 24와 해당
Docker 소켓 접근 권한으로 연결 도구를 실행하세요. 비공개 입력은 후보 선택이며
자격 증명 파일이 아닙니다. 정확한 해시를 적용하기 전에 계획을 검토하세요.
그다음 이미 승인된 보호 기본 브랜치 push 파이프라인을 열고 deploy:wizard-beta 또는
stop:wizard-beta를 수동으로 실행하세요. 이 선택적 작업은 활성화 프로젝트 변수 없이
존재하며 설정과 연결은 다른 파이프라인을 시작하지 않습니다. 실행기는 명시적으로
저장된 v2 연결을 읽고 현재 작업의 프로젝트, 파이프라인, 소스 커밋이 일치하는지
검사한 뒤 연결된 예약에서 정확한 HTTPS 호스트를 읽습니다. 연결이 없거나 오래되거나
다른 소유자이면 거부합니다. Deploy 클릭은 연결을 생성하지 않습니다. 기존에 남은
SYSTEM_BETA_OPERATION 및 WIZARD_BETA_HOST 변수는 일치해야 하며 불필요한 값은
의도적으로 제거하세요. 이 실행 경로에는 수동으로 준비한 API 토큰이 필요하지 않습니다.
성공한 실행과 소유 helper 정리 후 test-results/system-beta/environment.env가
GitLab 환경 링크용 SYSTEM_BETA_URL을 제공합니다. Deploy와 Stop은 기존 릴리스 아티팩트와 변경 불가능한 이미지를 재사용합니다. 라우팅 전에 프로젝트,
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
system-bootstrapper system-review stop
system-bootstrapper project-environments-cleanup OPERATION
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

폐기 가능한 플랫폼 시나리오는 `native-lifecycle-with-contract-verifier`를 선언합니다.
공유 설정, 연결, Docker Beta 배포와 중지, 정확한 호스트 TLS, Production 보존,
소유 리소스 정리는 실제로 실행됩니다. 권한 검증기는 `contract-fixture` 증거를
사용합니다. 상위 후보가 아직 실행 중이므로 완료된 파이프라인으로 자기 자신에게 권한을
부여할 수 없습니다. 긍정·부정 계약은 production 검증기를 별도로 검사합니다.
Production 실행기에는 fixture 선택 스위치가 없습니다. 오프라인 테스트나 읽기 전용
사전 검사만으로 완료된 네이티브 실행이 입증되지는 않습니다.

## 배포 서비스 경계

컴파일된 운영 모듈 `ProjectLifecycleModule`은 배포 전환, 라우트 렌더링,
상태 조정, 롤백, 퇴역 및 중지된 리소스 정리를 담당합니다. 타입이 지정된
포트는 기록의 compare-and-swap, 소유권이 확인된 Docker 접근, 상태 검사와
라우트 I/O를 제공합니다. 호환 환경 도우미가 이 포트를 제공하며 정식
컨트롤러 잠금과 제한된 취소 시간을 유지합니다. 각 호출은 HTTP 리스너 없이
독립형 Nest 컨텍스트를 만들고 닫습니다. 호환 도우미나 상태 모듈을 가져오기
전에 operations를 빌드하세요.

상태 정책은 파이프라인 하한선과 중지 표식을 유지합니다. 전환이 실패하면
소유한 후보 리소스를 제거하기 전에 이전 라우트를 복원합니다. 완료된 전환은
남은 퇴역 작업을 상태 조정을 위해 보존합니다. Stop은 리소스를 삭제하기 전에
중지 표식을 저장합니다. 과거 레시피 바이트와 GitLab Ruby 검증 형식은
변경하지 않습니다.

Operations와 Sync를 빌드한 후 `node tests/wizard/environment-helper.js`로
상태, 소유권, CAS, 다시 로드, 오래된 세대 및 중단된 전환 오류를 주입하여
검사합니다. `node tests/wizard/environment-canonical.js`는 기존 정식 잠금과
기록 어댑터를 검사합니다. 이러한 로컬 검사는 실제 후보의 승인을 입증하지 않습니다.

`CanonicalModule`은 예약 조회, 토큰 소유 잠금과 취소, 정확한 바이트 단위의
기록 CAS, DNS 일관성 및 보관된 Beta 바인딩 교체를 담당합니다. 깨끗한 도우미는
원래 컨트롤러에서 컴파일된 stdin 어댑터를 호출하며 소스 텍스트를 정식 구현으로
평가하지 않습니다. 어댑터는 기존 공개 응답 형식과 고정된 실패 진단만 반환합니다.

`EnvironmentModule`은 도우미 호출, 정식 예약 검사, 이미지/소스/작업 식별 정보,
TLS 준비 상태, 네이티브 Ruby 검증기 선택과 중지된 경로 유지보수를 담당합니다.
제한된 프로세스 어댑터는 자식 프로세스를 추적하고 별도의 정리 예산을 유지합니다.
취소는 다른 소유자의 정리를 허용하지 않습니다. 기본 소스 예약 정책은 정확한
CI 식별 정보, 이전 기록, 중지 tombstone 및 세대 하한을 보존합니다. 기존 오프라인
테스트와 폐기 가능한 검증기 fixture를 위한 호환성 export도 유지합니다.

`SystemBetaModule`은 명시적 후보 바인딩을 검증하고 저장하며, 작업과 정리에 별도
예산을 적용하여 소유한 CI 도우미 수명 주기를 실행합니다. 기존 System Review
진입점은 Stop만 허용합니다. 새 Review 바인딩은 정식 잠금을 얻기 전에 거부합니다.
보존된 Review 바인딩 및 리소스 검사는 소유한 리소스 정리에만 사용할 수 있습니다.

보존된 관리 애플리케이션 저장소는 `ManagedEnvironmentService`를 Sync와 operations CLI `managed-recipe`를 통해 사용합니다. 기존 프로젝트별 PostgreSQL advisory 키를 보존하고 기록한 빌드와 이전 레시피를 확인하며 배포가 진행 또는 대기 중이면 설정 갱신을 거부합니다. 커밋 요청은 결과가 확인될 때까지 GitLab 설정 볼륨에 비공개로 크기를 제한한 내용/부모 증거를 보존합니다. 응답이 중단되면 같은 예약을 새로 조회하세요. 증거가 없으면 변경 장벽을 유지하고 다른 쓰기를 허용하지 않습니다. 레시피 커밋은 파이프라인을 시작하지 않으며 예약된 과거 빌드 파일을 변경하지 않습니다. `node tests/gitlab/environment-upgrade.js`는 주입한 저장소와 잠금 공급자로 이 계약을 검사합니다.
