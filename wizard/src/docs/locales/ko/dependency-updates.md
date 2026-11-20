# 승인으로 제어하는 의존성 업데이트

Renovate OSS는 기존 Docker Runner 풀에서 예약된 `renovate:discover` GitLab 작업으로
실행됩니다. 검토된 안정 버전 `44.222.5-full` 이미지는 `.gitlab-ci.yml`에서 다이제스트로
고정됩니다. 다른 의존성처럼 검토를 거쳐 업데이트하세요. 상시 실행 봇 서비스는 없습니다.
[저장소 구성](../renovate.json)과 [자체 호스팅 구성](../gitlab/renovate/config.cjs)은 운영자가
제공한 두 System 및 Wizard 소스 프로젝트만 선택하며, GitHub 미러나 프로젝트 자동 탐색은
선택하지 않습니다.

## 운영자 설정

구성을 두 프로젝트의 보호된 기본 브랜치에 병합한 후 검토된 체크아웃을 사용하세요.
일반 HTTPS CA 신뢰를 갖춘 Python 3이면 충분합니다. GitLab 관리자 API 토큰은 체크아웃
밖의 0600 권한 파일에 보관하세요. 운영자 프로비저닝 명령에서만 사용하며 CI에는 절대로
들어가지 않습니다. 전용 계정에는 운영자가 실제로 관리하는 이메일 주소를 사용하세요.

체크아웃 밖에 0600 권한의 JSON 입력을 만드세요. 예:

```json
{
  "endpoint": "https://gitlab.example.com/api/v4",
  "admin_token_file": "/secure/operator/gitlab-admin-token",
  "username": "dependency-bot",
  "email": "dependency-bot@example.com",
  "project_ids": [10, 11],
  "state_file": "/secure/operator/renovate-state.json",
  "cron": "0 4 * * 1",
  "timezone": "UTC"
}
```

모든 값을 바꾸세요. System이 첫 번째이고 Wizard가 두 번째입니다. 네임스페이스 경로는
이 ID로 확인합니다. 도구는 인식하지 못하는 계정, 관리자 신분, 관련 없는 멤버십/토큰,
두 보호 기본 브랜치 중 하나에 대한 Developer 푸시 접근을 거부합니다. 비공개 소유권 저널은
봇의 사용자 ID를 엔드포인트, 사용자 이름, 비공개 이메일, 프로젝트 선택에 연결합니다.
계정을 만들기 전에 무작위 nonce를 기록하고 관리자 전용 사용자 메모에도 쓰므로, 생성이
중단되어도 안전하게 재개할 수 있습니다. 공개 표시 이름이 일치하는 것만으로 채택을 허가하지
않습니다. 기존 사용자 API 쓰기 전에는 항상 기존 사용자 식별 정보, 제한, 멤버십, 토큰을
먼저 확인합니다. 봇에는 암호 재설정 이메일 없이 알려지지 않은 무작위 암호를 부여하고,
작업에는 PAT를 사용합니다. 두 기본 브랜치는 Developer 푸시를 차단하도록 보호하세요.
전용 계정은 이 두 프로젝트에만 Developer 멤버십을 가지며 그룹 멤버십, 그룹 생성 권한,
개인 프로젝트 허용량은 없습니다. 비공개 저장소 브랜치, MR, 대시보드 이슈에 필요한 `api`
개인 접근 토큰을 사용합니다. 프로젝트 멤버십이 토큰의 프로젝트 접근을 제한하며, 관리자 토큰이
아닙니다.

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json --apply
```

첫 호출은 API 변경 없이 비공개 파일 처리를 검증합니다. 두 번째는 계정, Developer 멤버십,
보호된 CI 변수, **일시 중지된** 주간 일정 하나를 조정합니다. `RENOVATE_TOKEN`은 보호 및
마스킹되며, `RENOVATE_REPOSITORIES`는 보호되고 명시한 두 경로만 포함합니다. 일정은
`RENOVATE_ENABLED=true`로 보호된 System 기본 브랜치를 실행합니다. 프로비저닝 운영자가
일정의 소유자가 되며 해당 브랜치에서 파이프라인을 실행할 권한이 있어야 합니다. Developer
봇에는 보호 브랜치 병합/푸시 권한을 부여하지 않습니다. 구성된 Runner가 보호 브랜치를
처리하는지 확인하세요.

활성화 전에 최초 실행의 브랜치/MR 목록을 기록하세요. 비공개 상태의 범위 제한 봇 토큰을
사용하며 GitLab에 쓰지는 않습니다.

```sh
python3 gitlab/renovate/verify.py --config /secure/operator/renovate.json \
  --baseline /secure/operator/renovate-first-discovery.json
```

두 저장소 구성을 검토한 뒤 활성화하세요.

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json --apply --enable
```

명령은 반복 실행할 수 있습니다. 0600 권한 상태 파일에는 중단 후 안전한 조정을 위한 봇
토큰이 있으므로 비공개로 보관하세요. 토큰이나 API 응답 본문을 출력하지 않습니다. 주간 cron과
시간대는 입력에서 구성할 수 있습니다. `--enable` 없이 실행하면 소유한 일정을 일시 중지하고
대시보드, 브랜치, 보고서는 삭제하지 않습니다. `--enable`로 다시 실행하면 재개합니다.
일반 파이프라인에 전역 `RENOVATE_ENABLED` 선택자를 추가하지 마세요. 보호된 예약
파이프라인만 봇 작업을 선택합니다. 일반 병합 요청, 기본 브랜치 푸시, 보호 버전 태그는
각각 해당 필수 게이트와 게시자를 유지합니다.

## 탐색, 승인, 그룹화

최초 실행은 각 소스 프로젝트에서 Dependency Dashboard를 만들거나 갱신합니다.
`dependencyDashboardApproval=true`가 보안 제안과 잠금 파일 유지 관리를 포함해 전역으로
강제됩니다. **대시보드 승인 전에는 업데이트 브랜치나 MR을 생성하지 않습니다.** 최초 실행에
대시보드만 있고 새 `renovate/` 브랜치/MR이 없는지 확인하세요. 소유한 일정의 첫 실행이
성공하면 두 대시보드, 변경 없는 브랜치/MR 목록, 예약 파이프라인에 성공한 봇 작업만
포함되었는지 검증하세요.

```sh
python3 gitlab/renovate/verify.py --config /secure/operator/renovate.json \
  --baseline /secure/operator/renovate-first-discovery.json --verify
```

최초 탐색은 조용한 시간대에 수행하세요. 사람이 동시에 브랜치/MR을 생성해도 이 엄격한 비교가
실패하므로 조사해야 합니다. 표시된 특정 배치의 확인란을 선택해 승인한 뒤 다음 예약 탐색을
실행하거나 기다리세요. 일괄 "모두 생성" 확인란은 많은 제안을 승인할 수 있습니다. 전달 작업을
조정할 때는 개별 배치를 선택하세요.

호환되는 npm 패치/부 버전/고정 변경은 프로젝트별 npm 배치 하나로 묶습니다. 호환되는
런타임 이미지/다이제스트 변경은 런타임 배치로 묶습니다. 주 버전 변경은 분리합니다.
Npm은 매니페스트와 npm 잠금 파일을 함께 관리하며 잠금 파일 갱신도 승인이 필요합니다.
기본 Dockerfile, Compose, GitLab CI 관리자가 이미지 참조를 처리합니다. 좁은 범위의
정규식 관리자가 `ARG IMAGE=node:...@sha256:...` 고정을 `system/Dockerfile`에서 처리하고,
Runner 등록의 Docker CLI 기본값, 현재 Wizard 빌드/검증 BuildKit 드라이버 고정을 처리합니다.
그룹화는 저장소별이며 프로젝트 간 트랜잭션이 아닙니다. 관리자는 승인된 Wizard 변경을
System gitlink 및 합의된 다른 작업과 결합해 검토된 System 후보를 만듭니다.

업데이트는 안정 릴리스만 사용하며 Node와 Docker는 검토된 주 버전 계열을 유지합니다.
일반 봇 규칙에서는 GitLab, Runner, Helper 이미지 업데이트를 의도적으로 비활성화합니다.
짝을 이루는 [GitLab 업그레이드 절차](HANDBOOK.md#migrate-gitlab-through-the-accepted-controller)와
필수 중간 버전, 마이그레이션 증거, 롤백 체크포인트를 사용하세요. 과거 빌드 레시피, 기록된
보안 릴리스 전환, 복구 식별 정보, 저장된 운영자 선택 운영 환경 이미지는 의존성 업데이트
대상이 아닙니다. 봇은 이러한 기록을 새 업스트림 릴리스로 몰래 바꿀 수 없습니다. 제안은
실행 중인 설치를 바꾸지 않습니다. 자동 병합은 비활성화되어 있습니다. 병합과 운영 환경
승격은 기존 게이트와 도구를 사용하는 관리자/운영자의 별도 결정으로 유지됩니다.

## 만료, 교체, 복구

토큰은 90일 후 만료됩니다. 만료 전에 운영자 알림을 마련하세요. 설정 명령은 남은 기간이
15일 미만이면 토큰을 교체하며, 명시적으로 다음과 같이 실행할 수도 있습니다.

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json --apply --rotate --enable
```

새 토큰을 비공개로 저장하고 보호 변수를 갱신한 다음, 이 도구가 소유한 오래된 토큰을
폐기합니다. 중단되면 다시 실행하세요. 관련 없는 토큰은 폐기하지 않습니다. 실패 시 비밀
정보가 포함된 API 본문을 출력하지 않습니다. 일정의 다음 실행 시간을 검토하고 다음 실행이
두 대시보드를 갱신하는지 확인하세요.

GitLab 데이터를 유지하거나 일치하는 완료된 Seed를 사용하는 일반 호스트 교체는 GitLab의
데이터베이스 기반 계정, 멤버십, 보호 변수, 일정, 대시보드 이슈, MR을 복원합니다.
[복구 계약](RECOVERY_CONTRACT.md)에 따라 데이터베이스 값을 복호화하는 데 필요한 일치하는
GitLab 구성과 비밀 정보를 복원하세요. 새 Runner 관리자/캐시/작업 공간은 봇 상태로
백업하지 않고 재구성합니다. 검토된 체크아웃이 CI/구성/도구를 복원합니다. 복구 중에는 일정을
일시 중지하고, 활성화 전에 Runner 접근 가능성과 CA 신뢰를 복원하세요.

운영자 입력/토큰 상태 파일은 체크아웃 밖에 있으며 구성 전용 Wizard 내보내기에 포함되지
않습니다. 보호된 운영자 저장소에 보관하세요. 복원된 계정은 남아 있고 토큰 상태만 유실되었다면
가능한 경우 비공개 저널을 복원하세요. 그렇지 않으면 관리자가 의도한 봇 사용자 ID, 구성된
비공개 이메일, 제한된 계정을 검증한 뒤 명시적으로 복구해야 합니다.

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json \
  --apply --recover-user-id 123 --rotate
```

`123`을 독립적으로 검증한 사용자 ID로 바꾸세요. 이 작업은 일시 중지 상태를 유지하고,
API 쓰기 전에 일치하지 않는 식별 정보, 추가 멤버십/토큰, 제한되지 않은 계정 속성을 거부하며,
새 비공개 소유권 저널을 확립하고 토큰을 교체한 뒤 오래된 소유 토큰을 폐기합니다. 최초 실행
기준선을 다시 기록하고 검토 후 활성화하세요. 이름만으로 계정을 채택하지 않습니다. 새로운 빈
GitLab 인스턴스에는 두 소스 프로젝트, 보호 브랜치, 전용 식별 정보, 멤버십, 토큰 변수,
일정을 다시 프로비저닝해야 하며 숫자 ID가 바뀔 수 있습니다. 만료/폐기된 토큰은 데이터베이스
복원 후에도 사용할 수 없습니다. 현재 관리자 토큰을 봇 CI 비밀 정보로 재사용하지 마세요.
일정 소유자를 잃으면 실행 전에 다른 권한 있는 관리자가 소유권을 가져와야 할 수 있습니다.

## 검증

컴포넌트 테스트 모음으로 일반적인 가벼운 구성/설정 테스트를 실행하세요. 실제로 고정된
Renovate 엔진에 대해서는 격리된 기능 픽스처를 실행하세요.

```sh
docker run --rm --network none --entrypoint node \
  -v "$PWD:/work:ro" -w /work \
  ghcr.io/renovatebot/renovate:44.222.5-full@sha256:1e5baa47058a74b5f41e425838862f6728b4351790d8278f1356df2e56e8df62 \
  tests/gitlab/renovate-functional.mjs /usr/local/renovate/dist
```

가상의 의존성과 메모리 내 플랫폼을 사용하며 라이브 자격 증명이나 저장소는 사용하지 않습니다.
실제 엔진의 규칙 일치, 그룹화, 미승인 브랜치 게이트, 대시보드 출력을 검사합니다. 해당
이미지에서 `renovate-config-validator --strict --no-global renovate.json wizard/renovate.json`으로
두 구성도 검증하세요. 병합 후 운영자는 최초 라이브 탐색을 별도로 검증합니다.
`renovate:discover`만 선택되고, 두 대시보드가 존재하며, 명시적 승인 전까지 브랜치/MR 목록이
변경되지 않아야 합니다.

업스트림 참조: [GitLab 플랫폼](https://docs.renovatebot.com/modules/platform/gitlab/),
[대시보드 승인](https://docs.renovatebot.com/configuration-options/#dependencydashboardapproval),
[자체 호스팅](https://docs.renovatebot.com/getting-started/running/).
