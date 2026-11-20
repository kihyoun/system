# 의도적인 Wizard 운영 환경 승격 및 복구

운영 환경 승격은 기준 컨트롤러의 명시적인 운영자 명령이며 자동 활성화되는 GitLab 작업이 아닙니다.
Review/Beta는 수동으로 배포하는 별도의 후보 환경으로 유지됩니다.

## 사전 조건 및 정확한 계획

검토된 일치하는 컨트롤러 소스를 사용하고 이전 Wizard 이미지를 데몬에 보관하세요.
자체 비공개 GitLab 파이프라인에는 소스/파이프라인/레지스트리 다이제스트 아티팩트가 서로 일치하는
필수 `build:wizard` 및 `test:wizard` 작업의 성공 결과가 있어야 합니다.
현대 프로필의 증거에는 린트, Vitest, TypeScript/빌드, 렌더링된 UI,
프로젝트, SPA, 실제 설정 ZIP 및 정확한 Cube 검증이 포함되어야 합니다.
운영 환경에 적용하기 전에 별도의 후보를 확인하세요.
인증된 운영자/Runner로 해당 정확한 레지스트리 다이제스트를 미리 다운로드하세요.
도우미는 태그를 수락하거나 프로비저닝 인증 정보로 다운로드하지 않습니다.

영구 설정 디렉터리 아래에 mode-0600 증명 JSON을 작성하세요.
컨트롤러 내부의 예는 `/state/wizard-production-proof.json`입니다.

```json
{
  "version": 1,
  "projectId": 42,
  "projectPath": "example/wizard",
  "pipelineId": 100,
  "sourceCommit": "REPLACE_WITH_THE_EXACT_GITLAB_PIPELINE_SHA",
  "imageRef": "registry.example.test/example/wizard@sha256:REPLACE_WITH_THE_64_HEX_DIGEST",
  "productionHost": "bootstrapper.example.test"
}
```

ID는 예시입니다. 실제로 검토한 파이프라인과 이미지를 사용하세요.
읽기 전용 계획을 받아 현재/대상 이미지 ID, 해시 및 호스트를 검토한 뒤
정확한 `planHash`를 적용 명령에 복사하세요.

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js plan /state/wizard-production-proof.json
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js apply /state/wizard-production-proof.json PLAN_HASH
```

적용은 임시 서버 측 API 인증 정보로 정확한 비공개 GitLab 프로젝트, 성공한 파이프라인,
선택 사항이 아닌 필수 작업 및 일치하는 아티팩트를 독립적으로 검증한 뒤 인증 정보를 취소합니다.
인증 정보나 설정 내용은 출력하지 않습니다. 현재 설정, 라우팅, 기준 컨테이너 식별 정보,
이미지 및 계획 해시가 여전히 일치해야 합니다.
원래의 1184자 Cube는 변경하지 않으며 이미지 재정의는 그 뒤에 리터럴 할당으로 추가합니다.

명시적으로 연결한 [소스 기준 저장소](../wizard-source-primary/README.md)는
정확한 기준 프로젝트 ID/경로/네임스페이스 연결, 활성화된 병합 검증 및 승인된 CI 파일 해시가 있을 때만
네이티브 `.gitlab/primary.yml` 경로를 허용합니다.
파이프라인은 현재 HEAD에 대한 네이티브 기본 브랜치 푸시여야 하고,
모든 필수 소스 및 배포 작업이 성공해야 합니다.
`deploy:github` 게시 작업만 실패한 경우 비공개 절차를 차단하지 않지만,
다른 필수 실패, 건너뛴 검사, 무관한 작업 또는 누락된 증거는 거부합니다.
비슷한 이름의 작업이 있는 무관한 프로젝트나 API로 생성된 파이프라인도 거부합니다.
기존 레거시 `.system-bootstrapper/ci.yml` 검증은 변경되지 않습니다.

## 전환 및 보존 상태

명령은 기존 영구 Wizard 환경 뮤텍스를 획득합니다.
Sync 보내기/제어 및 다른 환경 작업도 이 뮤텍스를 따릅니다.
`/state/wizard-production/` 아래에 비공개 체크포인트를 원자적으로 저장한 뒤,
현재 Wizard 네트워크에 고유 라벨이 있고 128 MiB/0.5 CPU로 제한된 후보를 만듭니다.
후보가 정상 상태가 된 후에만 단일 `upstream wizard` 주소를 갱신하고
기존 NGINX 프로세스를 검증한 뒤 다시 불러옵니다.
다른 라우팅은 바이트 단위로 보존되며 이 시점에도 이전 기준 Wizard는 실행 중입니다.

검사한 후보가 운영 요청을 처리하는 동안 도우미는 영구 설정에 `WIZARD_IMAGE`를 고정하고,
`--no-deps --pull never`로 기준 Wizard만 다시 만듭니다.
정확한 이미지와 상태를 검증하고 같은 업스트림을 실제 주소로 전환합니다.
프록시, GitLab, 컨트롤러 또는 Runner는 다시 시작하지 않습니다.
체크포인트는 이전의 변경 불가능한 이미지 ID, 비공개 설정/템플릿 바이트 및 완료된 활성 해시를 보존합니다.
소유한 후보 자원은 라벨을 확인한 후 전체 ID로 제거합니다.

후보가 실패하면 기준 Wizard를 다시 만들지 않습니다. 라우팅/다시 불러오기 실패 시 이전 경로를 복원합니다.
이후 단계에서 실패하면 이전의 변경 불가능한 이미지를 다시 만들고,
그 결과로 얻은 실제 주소를 사용하여 이전 설정을 복원합니다.
의도적인 롤백을 검증할 때까지 이전 이미지와 비공개 체크포인트를 보관하세요.

## 전환 중 공개 운영자 정보

정상 시작 시 서명 검증된 저장 설정에서 공개 웹사이트 필드 여섯 개만 추출하여
영구 `wizard-public/privacy-instance.json` 파일로 게시합니다.
컨트롤러가 이 디렉터리에 기록하고, 기준 Wizard는 이를 읽기 전용으로 마운트하여
Sync 인증 없이 `/privacy-instance.json`을 제공합니다.
**일반 → 웹사이트**에서 값을 수정한 뒤 정상적으로 보내기를 실행하세요.
이 값들은 일반 JSON/환경/ZIP 설정 백업에 계속 포함됩니다.
예시 운영자 이름, 주소 및 이메일은 바꾸기 전까지 예시로 취급하며 명시적으로 지운 값은 비어 있습니다.
선택 사항인 개인정보 안내문, 안내 URL 및 접속 로그 보관 기간에는 임의의 기본값이 없습니다.

승격 전에 갱신된 영구 저장소 구성을 준비하고 컨트롤러를 일치하는 검토된 이미지로 교체하세요.
이 단계에서 현재 Wizard를 먼저 교체할 필요는 없습니다.
승격 계획은 컨트롤러의 기존 설정과 공개 바인드 볼륨 메타데이터를 검사하고,
동일한 마운트 파일시스템의 형제 디렉터리인지 검증하며 공개 JSON이 저장 설정과 일치하는지 확인합니다.
기존 기준 공개 마운트는 읽기 전용이어야 합니다.

임시 후보에는 검증된 공개 호스트 디렉터리만 읽기 전용 바인드 마운트로 전달합니다.
비공개 설정, 인증 정보 또는 Docker 소켓은 전달하지 않습니다.
원본 디렉터리가 없으면 루트 디스크에 새 Docker 관리 볼륨을 만드는 대신 실패합니다.
최초 전환은 이 공개 마운트가 없는 이전 기준 Wizard도 지원하며,
이미 준비된 공개 디렉터리의 권위 있는 기준은 갱신된 컨트롤러입니다.
기준 컨테이너 재생성과 롤백은 정상 Compose 마운트를 유지합니다.
호스트 사전 검사로 저장소를 준비하세요. 이 디렉터리를 만들려고 마운트 볼륨/UUID 검사를 우회하지 마세요.

## 의도적인 롤백

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js rollback-plan
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js rollback PLAN_HASH
```

롤백하려면 완료된 체크포인트가 현재 이미지, 설정 및 경로와 여전히 일치해야 합니다.
동일한 정상 후보 전환 방식을 사용하며, 보존된 이전 이미지를 선택하면서 현재 설정은 유지합니다.
이전 이미지가 새 파이프라인에서 빌드되었다고 주장하지 않습니다.

## 중단 또는 충돌 시 복구

동시에 수정된 파일은 덮어쓰지 않습니다. 안전한 자동 롤백을 완료하지 못하면
정상 상태의 소유 후보, 비공개 체크포인트 및 공유 뮤텍스를 조정을 위해 남겨 두며,
일반 보내기/다시 시작은 차단된 상태로 유지합니다.
확인 없이 뮤텍스를 지우거나 현재 인터페이스를 제공하는 후보를 제거하지 마세요.

원래 도우미 프로세스가 종료된 후 비공개 체크포인트를 검사하고 외부 설정/템플릿 변경을 명시적으로 해결하세요.
그런 다음 복구를 미리 보고 확인하세요.

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js recover-plan
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js recover PLAN_HASH
```

복구는 원래 프로세스가 아직 실행 중이거나 잠금 소유자가 바뀐 경우 거부됩니다.
예상한 정확한 파일 내용이 필요하며 이전 이미지/경로를 복원하고,
해당 작업 소유의 후보만 정리하며 일치하는 뮤텍스만 해제합니다.
체크포인트와 이미지는 로컬 영구 복구 상태이며 별도의 설정 ZIP과 Harvest Seed를 대체하지 않습니다.

## 검증 범위

오프라인 회귀 검사는 오래된 확인, 잘못된 GitLab 증명, 후보 상태,
생성 응답 손실, 경로 다시 불러오기 실패, 롤백 IP가 바뀐 기준 컨테이너 상태 실패,
동시 쓰기, 보존된 뮤텍스/조정 및 명시적 롤백을 다룹니다.
Ruby 증명 픽스처는 비공개 프로젝트, 소스, 선택 작업, 다이제스트 및 현대 검사 불일치를 거부하고 토큰 취소를 검증합니다.
이는 구성 요소 검사입니다. 계속 사용할 수 있어야 하는 서비스에 이 절차를 적용하기 전에
사용자의 인프라에서 실제 성공 파이프라인, 별도 후보, 운영 환경 승격 및 롤백을 검증하세요.
