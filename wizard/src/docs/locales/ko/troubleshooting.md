## 4. 문제 해결

| 증상 | 다음 단계 |
| --- | --- |
| `localhost`가 열리지 않음 | Ubuntu 콘솔을 열어 둔 채 `sudo docker ps`를 확인하세요 |
| 연결에서 Network Error 표시 | 수정에서 주소를 확인하세요. 로컬 최초 시작 시에는 `http://localhost/sync`, 이후에는 구성한 Sync 도메인을 사용합니다 |
| 로그인 거부 | 0.4절의 비공개 로컬 명령으로 활성 값을 확인하세요. 저장된 기본 설정이 최초 시작 자격 증명보다 우선합니다 |
| 양식에 Example 값이 표시됨 | 먼저 연결하고 가져오기를 실행하세요. 연결되지 않은 양식은 서버 구성이 아닙니다 |
| 새 인스턴스에서 가져오기가 404 반환 | Wizard를 새로고침하세요. Wizard와 Sync 모두 제안 기능을 지원하는 버전이어야 합니다 |
| 저장한 Example 값이 다시 나타남 | 가져오기는 저장된 설정을 우선합니다. Wizard에서 명시적으로 수정하세요. 제안은 기존 구성을 덮어쓰지 않습니다 |
| 아직 GitLab에 접근할 수 없음 | 보내기가 자동 재시작을 시작한 뒤 `healthy`가 될 때까지 기다리고, 필요하면 GitLab 로그를 확인하세요 |
| 구성한 Runner 컨테이너 4개가 GitLab Runner 하나로 표시됨 | Runner 상세 페이지에서 **Runner managers**를 확인하세요. 공유 풀은 하나의 항목에 독립적인 관리자 시스템 ID를 둡니다 |
| 시작 시 영구 저장소 누락 보고 | 선택한 모드와 디렉터리를 확인하세요. 보호 장치를 우회하려고 모드를 바꾸지 말고, 명시적으로 선택한 라이브 볼륨을 마운트하세요 |
| GitLab 재시작 후 파이프라인이 Runner를 기다림 | Register는 풀을 확인하고 관리되는 내부 IP 엔드포인트를 안정적인 Docker 서비스 이름으로 갱신합니다 |
| 파이프라인에서 `registry.localhost`를 해석하지 못함 | Ubuntu에서 `sudo system-bootstrapper host-bootstrap prepare-local --checkout "$PWD"`를 다시 실행하세요. WSL은 시작 시 로컬 hosts 항목을 재설정할 수 있습니다 |
| 데이터베이스 초기화 전에 MongoDB가 실패함 | 데몬 호스트에서 `system-bootstrapper host-bootstrap container-preflight --checkout "$PWD"`를 실행하세요. [호스트 운영 가이드](HOST_OPERATIONS.md)를 따라 CPU, Ubuntu 업스트림 커널 및 이미지 실행 문제를 구분하세요 |
| 컨테이너 로그 순환이 검증되지 않음 | `system-bootstrapper host-bootstrap log-policy --checkout "$PWD"`로 정확한 컨테이너를 검사하세요. 명시적인 배포를 통해 크기가 제한된 정책을 적용하고 확인하며, 최대 보관 기간을 가정하지 마세요 |
| `docker ps`에 별도 Sync Node 컨테이너가 없음 | 정상입니다. Node는 Bootstrapper 컨테이너 안에서 실행됩니다. 최초 시작 시 `system_sync_1`은 NGINX 접속 지점입니다 |

추가 기술 정보는 [Prepare-Host.md](../Prepare-Host.md)를 확인하세요.
