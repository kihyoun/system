# 정식 Wizard 별칭

설치 환경에서는 구성된 Wizard 원본 주소로 영구 리디렉션되는 추가 DNS 이름을 명시적으로
예약할 수 있습니다. `WIZARD_HOST=www.example.com`과 `WIZARD_DOMAIN_MODE=2`일 때,
별칭 `example.com`은 `http://example.com/a?x=1`과 `https://example.com/a?x=1`을 모두
`https://www.example.com/a?x=1`로 리디렉션합니다. HTTP 308을 사용하며 원래 경로와
쿼리를 보존합니다. 대상은 저장된 구성에서 가져오며, 수신한 Host 헤더에서 가져오지 않습니다.
`www` 접두사에서 별칭을 추론하지 않습니다.

| 설정 | 의미 |
| --- | --- |
| `WIZARD_ALIASES` | 공백으로 구분한 정확한 DNS 이름을 선택적으로 지정합니다. 비어 있거나 없으면 별칭 라우트가 비활성화됩니다. |
| `WIZARD_ALIAS_SSL` | NGINX 내부의 `/ssl` 아래 인증서 경로를 선택적으로 지정합니다. 기본값은 `WIZARD_SSL`입니다. |
| `WIZARD_ALIAS_SSL_KEY` | `/ssl` 아래 개인 키 경로를 선택적으로 지정합니다. 기본값은 `WIZARD_SSL_KEY`입니다. 두 재정의 값을 함께 설정하세요. |

Wizard가 활성화되어 있어야 하며, 도메인 모드가 `0`(HTTP 대상) 또는 `2`(HTTPS 대상)인
정확한 정식 호스트가 있어야 합니다. 정식 대상이 HTTP여도 별칭은 HTTP와 HTTPS를 모두
제공하므로 별칭 TLS에도 인증서가 필요합니다. 선택한 인증서는 **모든 별칭**을 포함해야 하고
키가 일치해야 합니다. 별칭을 활성화하기 전에 공개 서버 설치 절차에 따라 DNS, 인증서 발급,
갱신을 구성하세요. 이 설정은 인증서를 발급하지 않습니다. 핸드북에서 설명하는 전체 Certbot
계정 및 갱신 트리를 보존하세요.

이름은 유효한 DNS 레이블로 구성되어야 하며 스킴, 포트, IP 리터럴, 와일드카드, 끝의 점은
포함할 수 없습니다. 비교 시 대소문자는 무시합니다. 중복 별칭과 정식 호스트로의 루프는
거부됩니다. 할당된 GitLab, Registry, Sync 이름은 해당 와일드카드 모드를 포함해 예약됩니다.
활성화된 운영 환경, Beta, Review 프로젝트 이름과 관리형 Wizard의 선택적 환경 이름도
예약됩니다. 와일드카드 서비스 `*.apps.example.com`은 하위 도메인을 예약하지만,
`apps.example.com` 자체는 예약하지 않습니다. 별칭 구성을 비워 두면 기존 도메인 모드와
라우팅 계약이 그대로 유지됩니다.

## 지원되는 구성 절차로 설정하기

Wizard에서 현재 저장된 구성을 가져오고 비공개 ZIP 백업을 다운로드하세요. 비공개 디렉터리에
압축을 풀고 `.docker.env`와 `.projects.env/`를 함께 보관하세요. 검토된 체크아웃의 도우미로
새 구성 파일을 만드세요. 컨트롤러 이미지에는 Node가 이미 포함되어 있습니다. Node가 설치된
워크스테이션에서도 도우미를 실행할 수 있습니다.

```sh
private_config_dir="$HOME/private-bootstrapper-config"
node nginx/wizard-aliases.js configure \
  --config "$private_config_dir/.docker.env" \
  --projects "$private_config_dir/.projects.env" \
  --alias example.com \
  --output "$private_config_dir/candidate.docker.env"
```

추가 이름마다 `--alias HOST`를 반복하세요. 별칭에서 다른 인증서를 사용한다면
`--certificate /ssl/live/aliases.example.com/fullchain.pem`과
`--key /ssl/live/aliases.example.com/privkey.pem`을 모두 추가하세요. 인수를 생략하면
기존 재정의 설정을 유지합니다. 모든 리디렉션을 제거하려면
`--clear`를 사용하여 `--alias` 인수를 대신하세요.

도우미는 Cube 서명, 호스트 충돌, 인증서 경로 구문을 검증한 뒤, 기존 파일을 덮어쓰지 않는
0600 권한의 출력 파일을 만듭니다. 별칭 할당만 변경하고 Cube와 관련 없는 모든 구성 바이트를
보존합니다. 입력 파일을 대체하거나, 자격 증명을 출력하거나, 라이브 NGINX 구성을 쓰거나,
서비스를 다시 시작하지 않습니다. 이전 구성과 결과 파일을 모두 비공개로 보관하세요.
설치 환경에 할당된 프로젝트 이름까지 검증할 수 있도록 최신의 완전한 프로젝트 내보내기를 사용하세요.

Wizard에서 **열기**를 선택하고 `candidate.docker.env`를 여세요. 열기가 기본 구성으로
인식할 수 있도록 파일 이름에 `.docker.env`를 유지하세요. 정식 Wizard 설정과 기존 프로젝트를
검토한 다음, **백업**으로 갱신된 JSON/ZIP을 보관하고 **동기화 → 보내기**로 적용하세요.
다른 브라우저나 오래된 폼에서 편집하기 전에는 다시 가져오기를 실행하세요.

이 설정은 Wizard의 기존 추가 `runtimeOptions` 지원을 사용합니다. 가져오기/열기는
알 수 없는 기본 환경 키를 그곳에 보존하며, JSON 백업/열기와 ZIP/보내기는 관련 없는 폼을
편집한 후에도 해당 키를 계속 전달합니다. 전용 별칭 폼 필드는 없습니다. 의도적으로 JSON을
편집하려면 값을 `main.runtimeOptions` 아래에 넣으세요. 예:

```json
{
  "WIZARD_ALIASES": "example.com",
  "WIZARD_ALIAS_SSL": "/ssl/live/example.com/fullchain.pem",
  "WIZARD_ALIAS_SSL_KEY": "/ssl/live/example.com/privkey.pem"
}
```

이 조각으로 전체 구성 백업을 대체하지 마세요. 일반적인 보내기와 프로젝트 변경은 저장된
구성을 바꾸기 전에 충돌을 검증합니다. 시작/다시 불러오기는 템플릿을 교체하기 전에 저장된
별칭 라우팅을 다시 검증합니다.

## 렌더링, 다시 시작, 복구

`nginx/start.sh`는 시작하거나 다시 불러올 때마다 저장된 기본 구성과 프로젝트 구성으로
`zz-wizard-aliases.conf.template`을 재구성합니다. 별칭이 비활성화되면 템플릿을 빈 내용으로
덮어쓰므로, 이전에 생성한 라우트가 제거 후에도 남지 않습니다. Registry 전용 복구 단계에서도
이를 비우며, 정상 시작에서는 Wizard가 사용 가능해진 뒤 재구성합니다. 비공개 도우미나 보관된
템플릿은 필요하지 않습니다.

구성 백업과 서비스 데이터 백업은 계속 별개입니다. 갱신된 Wizard JSON/ZIP을 일치하는 완료된
Harvest/Seed와 함께 보존하세요. 복구 절차에 따라 둘 다 새 라이브 저장소에 복원하세요.
Seed는 인증서와 서비스 상태를 유지하며, 별도 구성이 별칭 설정을 복원합니다. 일치하는 구성이
없는 Seed는 완전한 설치 백업이 아닙니다. 정상 운영에서는 백업 매체가 연결되어 있을 필요가 없습니다.

## 구성된 설치 검증

일반적인 구성 서비스 검사에 더해, 운영자가 제공한 별칭 원본 주소로 기본 검증기를 실행하세요.

```sh
sudo python3 bootstrapper/verify-runtime.py check \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --baseline "$private_config_dir/pre-start-baseline.json" \
  --output "$private_config_dir/runtime-check.json" \
  --redirect-from https://example.com
```

수행하는 작업에 맞는 검증기의 일반 기준선, 체크아웃, 자격 증명 인수를 사용하세요.
별칭이 필요한 설치라면 준비 상태 호출에 `--redirect-from`을 유지하세요. HTTP와 HTTPS 모두,
쿼리가 있는 인코딩된 경로, 공개 TLS 신뢰를 검증하세요. 저장소 소유 NGINX 다시 불러오기,
서비스 다시 시작, 폐기 가능한 구성과 Seed의 복원을 수행한 뒤에도 반복하세요. 번들 플랫폼
테스트는 일반 테스트 도메인과 로컬 ACME 발급자를 사용해 이러한 수명 주기 검사를 수행합니다.

두 별칭 가상 호스트는 모두 `/.well-known/acme-challenge/`를 `/ssl/acme-http01`에서
직접 제공합니다. 존재하는 챌린지는 리디렉션 없이 내용을 반환하고, 없는 챌린지는 Location
헤더 없이 404를 반환합니다. NGINX 구성 검증과 다시 불러오기를 포함하여, 문서화된
webroot/deploy-hook 절차로 인증서 갱신을 확인하세요. 리디렉션 응답만으로 인증서 발급이나
갱신이 작동한다고 입증할 수는 없습니다.
