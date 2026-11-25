## 신뢰할 수 있는 Codex 호스트의 선택적 주간 호스트 유지 관리

운영자는 신뢰할 수 있고 상시 가동되는 관리 호스트가 다음 Ubuntu 유지 관리 절차를 매주
실행하도록 허가할 수 있습니다. Codex는 선택 사항이며 플랫폼이 이에 의존하지 않습니다.
호스트 패키지를 업데이트하고 `/var/run/reboot-required`가 있을 때만 재부팅합니다.
서비스 이미지, 소스, 저장된 구성, Seed는 변경하지 않습니다. 복구 가능한 백업과 제공자
콘솔 접근을 유지하세요.

비공개 운영자 입력을 제공하세요. 대상 호스트 이름, 관리 SSH 포트
([공개 7](#public-7-separate-administrative-and-gitlab-ssh)의 경우 2222), 키 경로,
독립적으로 검증한 호스트 키 파일, 승인된 깨끗한 원격 도구 체크아웃과 리비전, 영구 저장
선택자와 예상 마운트/UUID, 비공개 기록 루트, 선택적으로 검증기의 관리자 `read_api`
토큰 파일 선택자가 필요합니다. 허가된 패키지 소스와 재부팅 정책을 기록하세요.
작업 텍스트나 공개 문서에는 자격 증명을 넣지 마세요.

매 실행은 다음과 같이 수행하고, 기록은 소스 체크아웃 밖에 보존하세요.

1. `BatchMode=yes`, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes`와 제공된
   `UserKnownHostsFile`, 포트, 키로 SSH를 사용하세요. 원격 체크아웃, 영구 마운트/UUID,
   여유 공간을 검증하고 `/proc/sys/kernel/random/boot_id`, 커널, 보류 패키지, 기존 실패
   유닛을 기록하세요. 예상하지 못한 식별 정보, 저장소, 패키지 잠금, `dpkg --audit` 문제나
   완료되지 않은 플랫폼 작업 상태가 있으면 연기하세요.
2. 원격의 승인된 체크아웃에서 새 비공개 기준선을 캡처하고, 변경 전에 그 기준선에 대해
   `system-bootstrapper host-bootstrap verify-runtime check`를 실행하세요.
   [문서화된 옵션](BOOTSTRAPPER.md#reviewed-replacement-host-initialization)을 사용하세요.
   저장된 구성/인증 해시와 정확한 이미지 식별 정보를 그대로 유지하세요.
   `sudo apt-get update`로 인덱스를 갱신한 뒤
   `sudo apt-get -s --with-new-pkgs --no-remove upgrade`를 검사하세요. 패키지 보류와
   Ubuntu 단계적 배포를 존중하세요. 단계적 업데이트를 강제하거나, 패키지를 제거하거나,
   Ubuntu 릴리스를 업그레이드하지 마세요. Docker/containerd, OpenSSH, 방화벽 패키지는
   특히 검토해야 합니다. 업그레이드나 재부팅이 필요하지 않으면 보고하고 종료하세요.
3. 서비스를 다시 시작할 수 있는 설치를 하기 전에는 Sync에 인증하고 `/status`를 검사하세요.
   `needRestart`, `harvestInProgress`, `runnerSetupInProgress`, `defaultWizardSetupInProgress`,
   `projectOperationInProgress`가 명시적으로 false여야 합니다. 환경 임대를 포함해 기존 기본
   작업 임대가 없어야 합니다. 커밋된 GitLab 검사를 실행하세요.

   ```bash
   GITLAB_CONTAINER_ID="$(sudo docker inspect --format '{{.Id}}' system_gitlab_1)"
   sudo docker exec system_bootstrapper_1 system-bootstrapper gitlab-preflight "$GITLAB_CONTAINER_ID"
   ```

   JSON에 승인된 CE 버전, `runningJobs: 0`, `unfinishedBackgroundMigrations: 0`이
   표시되어야 합니다. 종료 코드 0만으로는 부족합니다. 작업 중이면 실행 중인 작업을 그대로
   두고 업그레이드나 재부팅 없이 이번 유지 관리를 연기하세요.
4. 다른 운영자와 조정해 중단 시간을 확보하고 소유한 공개 웹 프록시를 중지하세요.
   기존 GitLab 컨테이너에서 `gitlab-ctl stop`을 `sshd`, `nginx`, `gitlab-workhorse`,
   `puma`, `sidekiq` 각각에 실행하세요. 중지되었는지 확인한 뒤 데이터베이스를 중지하기 전에
   사전 검사를 반복하세요. 경합으로 작업이 시작되었다면 같은 GitLab 서비스/프록시를 재개하고
   Runner/컨트롤러는 그대로 둔 채 연기하세요. 이 최종 작업 수 0 증거를 확보한 뒤에만
   `docker exec system_bootstrapper_1 system-bootstrapper lifecycle runner-stop /system main`으로
   기본 Runner 풀을 중지하고 등록은 보존하세요. 원래 컨트롤러/GitLab 다시 시작 정책을
   비공개로 기록한 다음 `docker update --restart=no system_bootstrapper_1 system_gitlab_1`을
   실행해 패키지에 의해 Docker가 다시 시작되어도 이 쓰기 주체들이 살아나지 않도록 하세요.
   ([다시 시작 정책 의미](https://docs.docker.com/engine/containers/start-containers-automatically/)).
   `docker stop --time 30 system_bootstrapper_1`으로 보존된 컨트롤러를 중지하고,
   진행 중인 GitLab Docker exec가 모두 끝날 때까지 기다리세요.
   이 유지 관리에서는 Host CLI의 `stop` 명령을 사용하지 마세요. 이 명령은
   Controller 컨테이너를 보존하지 않고 제거합니다.
   `gitlab-ctl stop`으로 모든 GitLab 서비스를 중지하고 모든 runit 서비스가 내려갔는지
   검증한 뒤 `docker stop --time 60 system_gitlab_1`을 실행하세요. 종료 코드 0이며
   OOM이 없어야 합니다.
5. 수정한 패키지 구성 파일을 유지하면서 검토된 계획만 설치하세요.

   ```bash
   sudo env DEBIAN_FRONTEND=noninteractive apt-get -y --with-new-pkgs --no-remove \
     -o Dpkg::Options::=--force-confold upgrade
   ```

   `dpkg --audit`와 패키지 관리자 완료 상태를 다시 확인하세요. Docker의 마운트 볼륨
   의존성, SSH 소켓 재정의, 방화벽 정책을 보존하세요. 허가된 재부팅이나 명시적인 컨테이너
   시작 전에 기록한 다시 시작 정책을 정확히 복원하세요. 마커가 있을 때만 재부팅하세요.
   그렇지 않으면 보존된 GitLab/컨트롤러 컨테이너를 시작하여 기본 시작이 Runner와 라우팅을
   조정하도록 하세요. 실패하면 복구를 위해 중지 상태와 정책 기록을 유지하고, 무작정
   재부팅하지 마세요. 다시 빌드하거나, Seed를 복원하거나, 코드를 패치하거나, 이미지 선택자를
   바꾸지 마세요. [APT 업그레이드 옵션](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html)과
   [Ubuntu 단계적 배포](https://ubuntu.com/server/docs/explanation/software/about-apt-upgrade-and-phased-updates/)를 참조하세요.
6. 재부팅했다면 새로 고정된 SSH 연결과 변경된 부팅 ID를 기다리세요. 원래 마운트와
   Docker/컨트롤러 자동 시작을 요구하세요. 재부팅한 경우와 하지 않은 경우 모두 원래
   기준선에 대해 `--timeout 1200`으로 기본 검증기를 실행하고, 최신 Runner 접속 증거를
   위해 선택적 토큰 파일을 사용하세요. `dpkg --audit`, 실패 유닛, SSH/방화벽, Docker
   바인딩을 별도로 확인하세요. 관리용 2222는 계속 소스 제한, GitLab SSH 22는 공개,
   HTTP/HTTPS 80/443은 변경 없음, 직접 Registry 5050은 루프백이어야 합니다.
   실패와 연기/단계적 배포 패키지를 정확히 기록하세요.

이름 변경 중 cloud-init이 기본 인터페이스를 찾지 못하면 저널, `ip -br link`, Netplan의 실제
`match`/`set-name`, udev 속성을 검사하세요. 잘못된 네트워크 정의를 먼저 수정하세요.
시작 경합이 확인되면 설치된 유닛이 `cloud-init-main.service`이고 systemd가 `udevadm wait`를
지원하는지 검증한 뒤
`/etc/systemd/system/cloud-init-main.service.d/10-wait-for-primary-interface.conf`를 추가하세요.

```ini
[Unit]
Wants=systemd-udev-trigger.service
After=systemd-udev-trigger.service
[Service]
ExecStartPre=/usr/bin/udevadm wait --timeout=30 --initialized=yes /sys/class/net/REPLACE_WITH_CONFIGURED_INTERFACE
```

인터페이스 선택자를 Netplan에 구성된 최종 이름으로 바꾼 뒤 systemd를 다시 불러오고 다음
부팅을 검증하세요. 이는 해당 특정 장치가 초기화되기를 기다리는 방식입니다. 전역 udev settle을
추가하지 않으며, 기존 설치에서 `cloud-init clean`을 정당화하지도 않습니다.
[udevadm wait](https://www.freedesktop.org/software/systemd/man/latest/udevadm.html)를 참조하세요.

절차를 예약하려면 먼저 읽기 전용 실행으로 Codex 인증을 테스트하고 실제 cron 계정에서
고정된 SSH를 테스트하세요. 비공개 작업 파일은 이 절을 참조하고 입력, 권한 부여, 실패 정책을
제공해야 합니다. 디렉터리는 0700, 입력/보고서는 0600 권한으로 만드세요. 각 원격 실행마다
새 기록 디렉터리를 만들고 결과를 보관하세요. `latest.md`는 요약일 뿐입니다. 아래의 선택적
**root 사용자 crontab** 항목은 cron 시간대가 UTC인 호스트에서 일요일 03:00에 실행됩니다.
CLI, 체크아웃, 비공개 경로를 실제 절대 경로로 바꾸세요. `TZ`가 cron을 바꾼다고 가정하지
말고 스케줄러 시간대를 확인하세요.

```cron
0 3 * * 0 umask 077; /usr/bin/flock -n /private/maintenance/weekly.lock /usr/bin/timeout --kill-after=2m 90m /absolute/path/codex exec -C /path/to/reviewed/checkout --sandbox danger-full-access -c 'approval_policy="never"' --color never -o /private/maintenance/latest.md - < /private/maintenance/task.txt >> /private/maintenance/cron.log 2>&1
```

이는 무인 셸/네트워크 접근 권한을 명시적으로 부여합니다. 신뢰할 수 있는 작업, 체크아웃,
호스트에만 사용하세요. 잠금은 cron 실행의 중첩을 방지하며 플랫폼 임대는 아닙니다. 시간 초과가
원격 APT 작업의 중지를 입증하지는 못합니다. 복구 전에 상태를 검사하고, 재시도를 강제하려고
패키지 관리자를 종료하거나 잠금을 삭제하지 마세요. cron은 별도의 에이전트 실행을 시작하고
로컬 보고서를 저장합니다. 기존 채팅으로 메시지를 보낸다고 보장하지 않습니다. 각 실행의 시간,
종료 결과, 로그를 확인하세요. 오래된 `latest.md`는 새 실행 성공의 증거가 아닙니다. 공식
[Codex 비대화형 문서](https://learn.chatgpt.com/docs/non-interactive-mode)를 참조하세요.

### 호스트 호환성 및 컨테이너 로그

MongoDB 이미지를 선택하거나 커널 유지보수를 계획하기 전, 그리고 Docker 로그 보관을
구성하거나 확인할 때 [컨테이너 호환성과 크기가 제한된 로그](HOST_OPERATIONS.md)를
참고하세요. Ubuntu 업스트림 커널 근거, CPU 및 이미지 오류 진단, 크기와 파일 수에
따른 순환, 구성 보존 및 명시적인 재생성을 설명합니다.
