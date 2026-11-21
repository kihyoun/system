# System Bootstrapper 핸드북

네이티브 호스트 설치, 시작/중지, 영구 저장소 검사 또는 복구 전에
[호스트 런타임 준비](../Prepare-Host.md#prepare-the-host-operations-runtime)를 완료하세요.
Quickstart는 Node와 operations를 자동으로 준비합니다. 수동 소스/교체 호스트 경로는
먼저 이를 준비하거나 복원해야 합니다. `--install-host`는 네이티브 호스트 의존성을
설치하며 누락된 운영 런타임은 설치하지 않습니다. 유지보수 전에 검증된 Node 설치,
`operations/dist`, `operations/node_modules`, `operations/assets`를 오프라인으로 사용할 수 있게 보관하세요.

환경에 맞는 전체 설치 경로를 선택하세요.

- [빠른 설치](QUICKSTART.md): 새로 준비한 지원 대상 Ubuntu 호스트에서 명령 하나를 실행한 뒤
  브라우저에서 구성합니다.

- [HTTP를 사용하는 로컬 Ubuntu / WSL2](#0-getting-started): 공개 DNS나 인증서 없이
  자신의 컴퓨터에서 플랫폼을 체험합니다.
- [자체 도메인과 HTTPS를 사용하는 공개 Ubuntu 서버](#public-server-own-domain-and-https):
  DNS를 준비하고 Certbot으로 인증서를 발급한 뒤 서비스를 구성합니다.
- [외부 Seed를 사용하는 교체 호스트](RECOVERY_CONTRACT.md#restore-an-external-seed-into-a-fresh-local-installation):
  완료된 백업을 새 로컬 작업 저장소에 복원합니다.
- [데이터 볼륨을 유지하는 교체 호스트](#replace-a-host-while-retaining-its-data-volume):
  기존 설치를 다시 초기화하지 않고 재사용합니다.
- [측정된 설치 및 복구 시간](#measured-installation-and-recovery-times):
  관찰된 소요 시간, 검증 범위, 반복 가능한 측정 방법을 설명합니다.
- [운영 중인 시스템의 진화](#5-evolving-a-running-system): 한 세대로 검토된 후속 세대를
  빌드하고 테스트한 다음, 복구 경로를 확보한 상태에서 승격합니다.
