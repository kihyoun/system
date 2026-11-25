# 공유 System Beta 인수 검증

폐기 가능한 플랫폼 시나리오는 기존 System 후보, 네이티브 `wizard/` 트리와 정확하게
준비된 helper/Wizard 이미지를 사용합니다. 비공개 Git bundle이 실제 커밋을 보존합니다.
가져오기는 커밋과 트리 식별자를 검증한 뒤 기존 소유 테스트 프로젝트에 `ci.skip`으로
푸시합니다. 별도 Wizard 저장소, 소스 빌드, Review 수명 주기나 중복 전체 System CI는
추가하지 않습니다. 일반 애플리케이션 Review/Beta 인수 검사는 플랫폼 검사에 남아 있습니다.

증거 버전 2는 `acceptanceScope: native-lifecycle-with-contract-verifier`와
`verifier.mode: contract-fixture`를 명시적으로 선언합니다. 네이티브 공유 설정, 연결,
소유 Docker Beta 배포와 중지, 이미지 라벨, 정확한 호스트 TLS, 변경 없는 Production,
정리를 폐기 가능한 플랫폼에서 검증합니다. 파이프라인 권한 부여는 공유 네이티브 검증기의 긍정·부정 계약으로 다룹니다. 상위 후보는 아직 완료되지
않았으며 완료된 네이티브 권한 부여 파이프라인으로 표시하지 않습니다. Fixture 식별자는
명시적인 네임스페이스를 사용합니다. 게시는 알 수 없는 필드를 제거하고 누락되거나
서로 모순되는 사실을 거부합니다. 과거 버전 1 기록은 원래 검증기를 유지합니다.

테스트 전용 helper 하위 클래스는 harness 안에 있습니다. Production 실행기에는
이 검증기를 선택할 환경 변수나 다른 경로가 없습니다. 실패해도 harness는 정확한
소유 Beta 중지를 시도하고 컨테이너, 네트워크, helper 제거와 lease 해제를 검사하며,
이름이 지정된 임시 자격 증명을 철회하고 Production을 검증합니다. 불확실한 정리는
통과 증거를 만들 수 없습니다. 복구는 새 daemon에서 Wizard 아카이브를 제외하므로
정확한 비공개 registry pin을 임시 프로젝트 deploy token으로 가져와야 하며 캐시로
충족할 수 없습니다. 정식 중지 세대 기록은 복구 후에도 유지됩니다. 다시 배포하려면
명시적으로 유효한 System Beta 연결이 필요합니다.

## 운영자 사전 검사

`guided-preview-live.js`는 비공개 JSON 입력과 함께 `--check-only`만 허용합니다.

```json
{
  "version": 2,
  "syncUrl": "https://sync.example.com",
  "gitlabUrl": "https://gitlab.example.com",
  "controllerImageId": "sha256:<64 independently verified hex characters>",
  "settings": {
    "version": 2,
    "namespace": "operator-team",
    "wizard": {"mode": "existing", "project": "system"},
    "review": {"enabled": false},
    "beta": {
      "enabled": true,
      "host": "beta.example.com",
      "ssl": "/ssl/live/beta.example.com/fullchain.pem",
      "sslKey": "/ssl/live/beta.example.com/privkey.pem"
    }
  },
  "reportPath": "/root/private-beta-preflight/report.json",
  "timeBudgetMilliseconds": 3600000
}
```

입력 파일은 체크아웃 밖에 모드 0600으로 보관하세요. 운영자의 Linux 호스트에서
Node 24와 로컬 Docker 소켓 접근 권한으로 실행하세요.

```sh
node tests/e2e/guided-preview-live.js --check-only /root/private-beta-preflight/input.json
```

계획은 보존된 설치 식별 정보와 네이티브 사전 조건을 검사합니다. 설정을 적용하거나
후보를 연결하거나 환경을 배포하지 않으며 `--apply`는 거부됩니다. 네이티브 사전 검사는
일반적인 임시 API 자격 증명을 만들고 철회할 수 있습니다. 성공한 계획도
`acceptancePassed: false`입니다. 폐기 가능한 계약 fixture는 사용자 설치에서 선택하지
않습니다. 이 사전 검사나 오프라인 계약 테스트는 완료된 네이티브 폐기 가능 플랫폼
실행을 대신할 수 없습니다.
