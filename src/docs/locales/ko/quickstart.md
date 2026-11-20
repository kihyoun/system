# 새 Ubuntu 호스트에서 빠르게 시작하기

자신의 **새 Ubuntu 24.04 또는 26.04 LTS amd64** 호스트에서 실행하세요. root/sudo,
curl, 표준 Python 3, 인터넷 연결, **최소 8 GiB RAM**, 시스템/라이브 데이터 파일시스템의
여유 공간 40 GiB 및 소스용 1 GiB가 필요합니다. 저장소, 레지스트리 이미지, 빌드 및
백업을 위해 추가 공간을 확보하세요. 포트 80과 443은 비어 있어야 합니다.
SSH 세션이나 로컬 콘솔을 계속 사용할 수 있어야 합니다. 메모리 사전 검사는
8 GiB 호스트에서 커널/펌웨어가 예약한 최대 512 MiB를 허용합니다(표시 용량 7.5 GiB).

```bash
curl -fsSL https://github.com/kihyoun/system/releases/latest/download/quickstart.sh | sudo bash
```

이 명령은 저장소가 관리하는 설치 프로그램을 다운로드하여 root로 실행합니다. 실행 전
릴리스의 `quickstart.sh`를 검토할 수 있습니다. 설치 중 `latest`가 바뀌어도 게시된
스크립트는 자신의 릴리스 태그에 고정됩니다. 해당 릴리스의 공개 버전 메타데이터와
체크섬, 정확한 System 소스/트리 및 고정된 Wizard 소스를 가져온 다음, 이에 맞는 공개
이미지를 다이제스트로 가져옵니다. 비공개 GitLab 계정, 작업 아티팩트, Docker Hub 로그인,
로컬 버전 목록은 필요하지 않습니다. 공개 레지스트리와 GitHub는 익명 요청을 제한할 수 있습니다.

설치 프로그램은 호스트 패키지를 변경하기 전에 OS, 아키텍처, 권한, 리소스, 포트 및 기존
설치 경로를 확인합니다. 의존성 설치는 `bootstrapper/install.sh`에, 시작은
`bootstrapper/install-release.py`에 위임합니다. 대체 이미지를 빌드하거나 브라우저 구성
전에 GitLab을 시작하지 않습니다. 네이티브 릴리스 설치 프로그램은 깨끗한 소스, 이미지
레이블, 불변 다이제스트, 승인된 이미지 ID, 동일한 후보 시도 및 새로운 영구 상태를 다시 확인합니다.

패키지 설치, 소스 다운로드, 이미지 가져오기 및 초기 시작은 각각 몇 분이 걸릴 수 있습니다.
소요 시간은 네트워크와 호스트 리소스에 따라 달라집니다. 시작 준비 상태 확인이 시간
초과되면 점검을 위해 체크아웃과 상태를 보존합니다. 상태를 삭제하거나 새 설치로 다시
실행하지 마세요. 전체 설치 가이드에 따라 네이티브 작업을 점검하고 재개하세요.

## 최초 접속

설치 프로그램은 준비된 Wizard 주소와 생성된 고유 Sync 사용자 이름/암호를 읽는 로컬
방법을 출력합니다. 자격 증명은 root만 읽을 수 있는 다음 파일에 보관됩니다.

```bash
sudo cat /var/lib/system-bootstrapper/platform/configuration/sync-auth.env
```

호스트에서 `http://127.0.0.1/configuration`을 여세요. 초기 Sync 주소는
`http://127.0.0.1/sync`입니다. 원격 워크스테이션에서는 보호된 SSH 터널을 사용하세요.

```bash
ssh -N -L 8080:127.0.0.1:80 <your-user>@<your-host>
```

그런 다음 `http://127.0.0.1:8080/configuration`을 열고 Sync 연결 주소를
`http://127.0.0.1:8080/sync`로 설정하세요. 호스트에서 자격 증명을 로컬로 읽어 터널을
통해 입력하세요. 초기 HTTP는 호스트의 포트 80에서 수신하며 공개 TLS를 제공하지 않습니다.
관리 접속을 유지하고, 구성한 서비스를 노출하거나 신뢰할 수 없는 네트워크로 자격 증명을
보내기 전에 공개 서버 가이드 전체를 따르세요.

기존 Wizard에서 계속 진행하세요. GitLab/레지스트리/Wizard/Sync 주소와 서비스 포트를
구성하고 저장소 및 이미지 선택을 검토한 뒤 보내기를 실행하세요. 구성 보내기가 구성된
플랫폼을 시작합니다. 관리용 SSH 서비스를 계속 사용할 수 있도록 GitLab SSH 바인딩
포트를 선택하세요. 설치 프로그램은 SSH나 방화벽 구성을 다시 작성하지 않습니다.

## 기존 설치와 고급 설정

Quickstart는 저장된 구성, 보존된 라이브 상태, 기존 System 컨테이너/볼륨 및 기존
`/opt/system-bootstrapper` 체크아웃이 있으면 실행을 거부합니다. 이를 이동하거나
삭제하지 않습니다. 실패한 부분 설치도 보존합니다. 기존 설치, WSL, 사용자 지정 경로,
DNS/공개 HTTPS, Seed 복원, 보존된 볼륨, 마이그레이션 및 고급 호스트 구성은
[호스트 준비](../Prepare-Host.md), [핸드북](HANDBOOK.md),
[복구](RECOVERY_CONTRACT.md) 또는 [영구 저장소](PERSISTENT_VOLUME.md)를 참고하세요.

Quickstart는 `/opt/system-bootstrapper`에 설치하며, 일반 로컬 라이브 데이터는
`/var/lib/system-bootstrapper/platform` 아래에 둡니다. 호스트 선택자 파일은
`/etc/system-bootstrapper/persistence.env`입니다. DNS 자동 설정, 인증서 발급,
Seed 작업, 데이터 마이그레이션 또는 운영 환경 승격은 수행하지 않습니다.
공개 릴리스 게시 역시 기존 플랫폼을 변경하지 않습니다.

공개 메타데이터 계약, 명시한 버전 설치 및 업데이트/롤백 요구사항은
[릴리스 정책과 정확한 소스 체크아웃](RELEASES.md)을 확인하세요.
