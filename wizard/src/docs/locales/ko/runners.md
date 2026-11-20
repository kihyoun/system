## 2. GitLab Runner 설정

Runner는 GitLab 파이프라인의 작업을 실행합니다. Bootstrapper 자체 GitLab 인스턴스에
맞게 자동 설정할 수 있습니다. 자동 설정에는 GitLab 16 이상이 필요하며, 과거 기본값인
GitLab 12 이미지는 이 절차를 지원하지 않습니다. 로컬 테스트에는 0장의 이미지 설정을 사용하세요.

### 2.1 개수를 설정하고 Runner 시작하기

1. Wizard를 열고 **수정 → 적용**로 Sync에 연결합니다.
2. 다음 보내기에서 구성된 호스트를 유지하도록 **동기화 → 가져오기**로 기존 구성을 불러옵니다.
3. **GitLab Runner**에서 원하는 개수를 입력합니다. 처음에는 **1**로 시작하세요.
   허용 범위는 0~50입니다. 컴퓨터의 메모리와 CPU에 맞는 개수를 선택하세요.
4. 자동 설정을 사용하려면 **Runner 인증 토큰**을 비워 두세요. 가져오기로 이미 불러온
   토큰은 그대로 두어도 됩니다. 해당 토큰을 재사용합니다.
5. **동기화 → 보내기**로 설정을 전송하고 적용합니다. 다시 시작은 자동입니다.
   GitLab 시작과 Runner 등록이 끝날 때까지 기다리세요.
6. Ubuntu 콘솔을 확인하세요.

   ```bash
   sudo docker ps
   ```

   개수가 1이면 `runner_docker_1`이 있어야 합니다. 컨테이너가 실행 중이라는 사실만으로
   등록 성공이 확인되지는 않습니다. 등록 후 Bootstrapper는 `Runner runner-docker-1 registered.`를,
   기존 등록을 확인할 때는 `Runner runner-docker-1 verified.`를 보고합니다.
7. 관리자로 GitLab에 로그인하고 **Admin → CI/CD → Runners**에서 **System Bootstrapper Docker
   pool**을 확인하세요. 연결된 Runner 관리자는 온라인 상태여야 합니다. 프로젝트에서
   인스턴스 Runner를 활성화하면 이 인스턴스 Runner를 사용할 수 있습니다.

개수는 **공유 인스턴스 Runner 풀의 Runner 컨테이너 수**를 뜻합니다. GitLab은 컨테이너마다
별도의 전역 Runner 항목을 표시하는 대신, 여러 관리자를 가진 Runner 항목 하나를 표시합니다.
Runner 상세 페이지를 열고 **Runner managers**에서 각 컨테이너의 시스템 ID와 온라인 상태를
확인하세요. 자동 생성된 풀에는 `docker`와 `aws` 태그가 있으며 태그 없는 작업도 받습니다.

### 2.2 토큰 표시 및 구성 다운로드

1. 다시 시작한 후 필요한 경우 Wizard를 구성된 Sync 주소에 다시 연결하세요.
   예를 들어 로컬에서는 `http://sync.localhost`를 사용합니다.
2. **동기화 → 가져오기**를 선택하세요. 이제 Wizard는 Bootstrapper 구성에서 생성된
   Runner 토큰도 불러옵니다.
3. 토큰은 기본적으로 숨겨집니다. **표시**를 사용해 입력 필드에 표시하고 복사하세요.
   **숨기기**를 누르면 다시 숨겨집니다.
4. **백업**을 선택하면 Runner 토큰을 포함한 구성을 Bootstrapper JSON으로 다운로드합니다.
   이 파일은 비공개로 보관하세요.

내보내기에서는 토큰을 `gitlabRunnerToken`에, 개수를 `gitlabRunnerScale`에 저장합니다.
토큰은 해당 GitLab 인스턴스에 속하므로 독립적인 새 GitLab 데이터베이스에서는 인식되지 않습니다.
새 데이터베이스에 대한 자동 최초 설정을 하려면 필드를 다시 비워 두세요. 수동으로 제공한
토큰도 지원하며, 자동 생성 토큰으로 대체하지 않습니다.

### 2.3 내부 동작

Bootstrapper는 GitLab 준비 상태 검사를 기다린 뒤, 기존 Docker 접근 권한으로 자체 GitLab
컨테이너에 접근합니다. 컨테이너 안에서 `create_runner` 범위의 임시 관리자 접근 토큰을 만들고,
GitLab API로 인스턴스 Runner를 생성한 후, API 실패 시를 포함해 접근 토큰을 즉시 폐기합니다.
접근 토큰은 GitLab 프로세스 내부에만 존재하며 Wizard나 JSON 백업에는 나타나지 않습니다.
프로세스가 갑자기 종료되는 경우에 대비해 다음 날 만료되며, 이후 설정에서도 남은 설정용 토큰을
폐기합니다.

Bootstrapper 구성에는 Runner 인증 토큰만 저장합니다. 등록을 반복하면 기존 풀을 재사용합니다.
각 관리자는 자체 `config.toml`과 시스템 ID를 `PERSISTENT_DIR/runners/<pool>/<index>/` 아래에
영구 저장합니다. 다시 시작할 때 이 식별 정보를 재사용합니다. 축소 시에도 디렉터리를 유지하므로
나중에 확장할 때 재사용할 수 있습니다. 중지된 관리자는 GitLab에 오프라인 항목으로 계속 보일 수
있습니다. 이전 관리자 하나를 제거하려고 전체 Runner 풀을 삭제하지 마세요. Runner는 공유 Docker
네트워크에서 `gitlab` 서비스 이름을 사용하므로, GitLab이 다른 내부 IP로 다시 시작해도 연결이
끊어지지 않습니다. 등록은 관리형 Runner의 오래된 내부 IP 엔드포인트를 갱신하며 토큰이나 외부에
구성된 주소는 변경하지 않습니다. 구성 영구 저장이 중단된 후의 복구는 이름으로 관리형 풀을
찾습니다. 이 복구 동작을 사용하려면 해당 항목의 이름을 유지하세요.

**등록**은 저장된 구성으로 Runner를 시작하거나 확장하고 등록 상태를 확인합니다.
**등록 해제**는 관리자들의 등록을 해제합니다. 현대적인 토큰 등록 방식에서는 전역 Runner 항목이
GitLab에 남습니다. 개수 **0**은 풀이나 토큰을 삭제하지 않고 Runner 컨테이너를 중지합니다.
Wizard의 변경 사항은 보내기를 사용할 때만 전송됩니다.

이 설정은 Harvest/Seed 주기를 변경하지 않습니다. Bootstrapper 구성은 계속 보내기/가져오기와
열기/백업으로 관리합니다.

### 2.4 로컬 기능 테스트

명시적으로 폐기 가능한 로컬 테스트 인스턴스에서는 `tests/gitlab-runner/live/runner.py`가
비공개 테스트 프로젝트와 파이프라인을 만들고, Runner를 확인하고, 생성된 결과 파일을
다운로드합니다. 별도의 `api` 범위 임시 테스트 접근 토큰을 만들고 이후 폐기합니다.
이것은 테스트 도우미이며, 실제 Runner 설정에는 `create_runner`만 필요합니다.

Runner 설정에 실패해도 플랫폼 시작은 계속되므로 Wizard에서 구성을 수정할 수 있습니다.
Bootstrapper 출력을 확인하고 설정을 수정한 뒤 **등록**을 다시 시도하세요.

```bash
sudo python3 tests/gitlab-runner/live/runner.py
```

실행 중인 로컬 서비스, Docker 접근 권한, 로컬 HTTP 프록시의 `gitlab.localhost`와
`sync.localhost` 주소가 사전 조건입니다.
