# System 승격 전에 번들 Wizard 검토

System 변경이 새 Wizard gitlink를 고정하면 System 파이프라인은 기존 관리형 Review HTTPS 호스트에서
정확히 그 Wizard를 제공할 수 있습니다. 운영 환경 승격 전에 UI를 인수 검사하는 단계입니다.
운영 환경을 마이그레이션하지 않으며, 페이지가 정상 표시된다는 사실만으로 플랫폼 전체의 안전성을 증명하지 않습니다.

선택 사항인 `deploy:wizard-review`와 `stop:wizard-review` 작업은
`test:platform-candidate`가 이미 빌드하여 게시한 두 개의 변경 불가능한 이미지를 재사용합니다.
두 번째 Wizard 파이프라인이나 추가 빌드는 필요하지 않습니다. 모든 필수 System 검사는 계속 필수입니다.
Review 작업은 제안된 System 체크아웃에서 실행하므로 운영 컨트롤러를 먼저 업그레이드할 필요가 없습니다.

## 준비 사항

정상적인 파이프라인 성공 및 토론 해결 병합 조건을 활성화하고,
보호된 기본 브랜치를 대상으로 하는 신뢰할 수 있는 동일 프로젝트 MR을 사용하세요.
관리형 배포 전에 전체 후보, 브라우저 및 구성 요소 검사가 성공해야 합니다.
정확한 호스트, DNS, 인증서, 템플릿 및 SSL 볼륨을 포함하여 기존
[Wizard Review 환경](../project-bootstrap/wizard-environments/README.md)을 준비하세요.
공유 호스트를 할당하기 전에 기존 Review 임대를 중지하고 정리하세요.
Beta와 기준 네이티브 Wizard 배포 예약은 변경되지 않습니다.

동일 프로젝트 MR 작업에서 읽을 수 있도록 다음 비밀이 아닌 프로젝트 변수를
환경 범위 `*`의 원시 값, 보호되지 않은 변수로 설정하세요.

| 변수 | 값 |
| --- | --- |
| `SYSTEM_REVIEW_ENABLED` | `true` |
| `SYSTEM_REVIEW_OPERATION` | 서버가 소유한 기존 환경 예약의 48자리 16진수 |
| `WIZARD_REVIEW_HOST` | 해당 예약에서 활성화된 정확한 Review HTTPS 호스트 |

포크 파이프라인, 일반 브랜치 푸시 및 문서만 변경한 경우에는 이 작업들이 생성되지 않습니다.
변수는 작업을 선택하고 URL을 표시할 뿐 임의의 프로젝트나 이미지에 권한을 부여하지 않습니다.

## 후보 하나를 명시적으로 연결

후보 작업이 성공하면 해당 작업의 `test-results/successor/release.json`을 읽으세요.
관리 호스트에 비공개 입력 파일을 준비하고 모든 예시를 실제 프로젝트, MR 및 릴리스 아티팩트의 값으로 바꾸세요.

```json
{
  "operation": "REPLACE_WITH_EXISTING_48_HEX_RESERVATION",
  "projectId": 42,
  "projectPath": "example/system",
  "namespaceId": 7,
  "defaultBranch": "master",
  "mrIid": 12,
  "pipelineId": 100,
  "sourceCommit": "REPLACE_WITH_40_HEX_SYSTEM_REVISION",
  "candidateJobId": 300,
  "helperImage": "sha256:REPLACE_WITH_64_HEX_RELEASE_IMAGE_ID",
  "wizardImageId": "sha256:REPLACE_WITH_64_HEX_WIZARD_IMAGE_ID",
  "wizardImageRef": "registry.example.test/example/system/successor-wizard@sha256:REPLACE_WITH_64_HEX_DIGEST",
  "wizardRevision": "REPLACE_WITH_40_HEX_WIZARD_GITLINK"
}
```

`helperImage = release.imageId`와 일치하는 Wizard 필드를 사용하세요.
별도로 관리하는 운영자 접근 권한으로 릴리스의 컨트롤러 레지스트리 참조를 다운로드하고
로컬 이미지 ID를 검증하세요. 아티팩트가 만료된 뒤 중지할 경우까지 포함하여
환경이 존재하는 동안 이 이미지를 보관하세요.
인증 정보는 체크아웃 밖에 두고 도우미에 전달하지 마세요.

운영자가 지정한 절대 경로에 입력 파일을 권한 `0600`으로 저장한 뒤 실행하세요.

```sh
docker run --rm --network none --read-only --memory 256m --cpus 1 --pids-limit 128 \
  --tmpfs /tmp:rw,nosuid,noexec,size=16m \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --mount type=bind,source=/PRIVATE/ABSOLUTE/candidate.json,target=/input.json,readonly \
  --entrypoint node sha256:EXACT_RELEASE_IMAGE_ID \
  /system/project-bootstrap/system-review/bind.js plan /input.json
```

프로젝트/MR/파이프라인/소스, 두 이미지 및 기존 예약을 포함하여 반환된 계획을 검토하세요.
명령을 `apply /input.json PLAN_HASH`로 반복하여 정확한 선택을 기준 컨트롤러의 설정 디렉터리에 저장하세요.
도구는 기존 환경 뮤텍스를 사용하며 변경된 계획, 점유된 임대 및 설정 경합을 거부합니다.
이전 연결 기록은 비공개로 보존합니다. 라우팅, 소스 기준 CI 매니페스트,
운영 이미지 선택자 또는 서비스 데이터는 변경하지 않습니다.

## 배포, 확인 및 중지

같은 MR 파이프라인에서 수동 `deploy:wizard-review` 작업을 실행하고 GitLab 환경 URL을 여세요.
도우미는 실제 실행 작업, 현재 MR HEAD와 최신 MR 파이프라인, 성공한 필수 작업,
고정된 후보 증거, System gitlink 및 정확한 로컬 소스/작업/이미지 라벨을
기준 GitLab을 통해 독립적으로 검증합니다.
작업 범위의 레지스트리 인증 정보는 두 이미지를 미리 다운로드하는 데만 사용하며,
도우미, 설정 실행 기록 또는 후보 컨테이너로 전달하지 않습니다.

기존 관리형 환경 수명 주기가 상태, DNS 및 인증서 검사, 내부 네트워크,
공유 Review 임대, 라우팅 전환, 롤백, 세대 하한, 소유권 및 중지된 호스트의 삭제 표식을 처리합니다.
후보에는 설정 또는 서비스 데이터 마운트가 없습니다. 운영 환경은 계속 실행됩니다.

같은 원본 파이프라인의 `stop:wizard-review`로 중지하세요.
중지는 실행 중인 작업과 정확히 보존된 연결을 검증하지만 현재 MR HEAD,
다운로드 가능한 후보 아티팩트 또는 레지스트리 접근은 요구하지 않습니다.
따라서 닫히거나 병합된 MR도 정리할 수 있습니다.
중지와 소유 자원 정리가 끝날 때까지 도우미 이미지를 보관하세요.
다른 프로젝트, MR 또는 파이프라인은 선택한 임대를 교체하거나 중지할 수 없습니다.
같은 호스트에 관리형 배포를 하기 전에 별도로 준비한 임시 미리보기 경로와
정확히 소유권이 확인된 자원을 제거하세요.

직접 UI를 인수 검사한 후 모든 필수 System 검사와 검토를 완료하고,
정상적으로 병합한 뒤 병합 파이프라인을 검증하여 기존의 명시적 운영 환경 승격 절차를 사용하세요.
Review 배포는 운영 환경 승인을 부여하지 않습니다.
