import { useId, useState } from 'react';
import { Alert, Box, Checkbox, Link, Paper, Stack, TextField, Typography } from '@mui/material';
import { useI18n } from '../../i18n';
import {
  upgradeGraph,
  upgradePath,
  type UpgradeGraph,
  type UpgradeTransition,
} from '../../docs/upgradePaths';
import CodeBlock from './CodeBlock';

const messages = {
  en: {
    title: 'Release migration guide',
    source: 'Installed version',
    target: 'Target version',
    unknownVersion: 'Unknown / other version',
    information:
      'This guide works offline. Selecting versions only shows instructions; it does not connect to Sync or change your installation. Verify the installed release from its retained selection receipt; there is no automatic detection.',
    supported:
      'Supported transition. CLI preflight also requires the published target release’s matching candidate evidence.',
    unknown:
      'Unknown release. Do not assume compatibility. Installations without a complete official release identity need the source-build or recovery workflow.',
    unsupported:
      'No supported path is declared for this selection. Downgrades and undeclared database transitions require their own reviewed recovery or migration procedure.',
    unnecessary: 'Both versions are identical. No release upgrade is necessary.',
    intermediate: 'Required release stops, in order:',
    interruption:
      'Matching cold backup pauses GitLab. The controller/Sync and Wizard restart during the update; changed Compose policies can also recreate core containers, including GitLab, proxies and runner managers. Wait for active CI jobs first. There is no guaranteed downtime duration.',
    databasePrerequisite:
      'This transition changes GitLab and Runner images and migrates the database. First complete the documented native GitLab upgrade and retain its separate cold checkpoint. Pass that checkpoint directory to the paired release plan below. Paired recovery restores only the controller and Wizard; database rollback requires its own cold restore and discards later writes.',
    preservedImages: 'This transition preserves the selected service and database images.',
    gitlabGuide: 'GitLab migration and cold-checkpoint procedure',
    prerequisites:
      'Use an unmodified official release on supported Ubuntu x86_64, your own installation API token, idle operations and completed GitLab background migrations. Fetch the exact target tag and prepare its offline Node/CLI runtime. Current releases include Wizard sources in the System tree; initialize submodules only for historical releases that declare them. Preserve domains, storage and project settings.',
    backup:
      'Attach the explicitly selected backup filesystem. Choose a new configuration ZIP path on that filesystem. Apply first retains the previous controller/Wizard payloads, then creates and verifies a matching completed Seed and exact configuration backup. Missing media fails without fallback. Keep both recovery inputs independently accessible.',
    preflight:
      'Run preflight from this exact target release checkout. Review installed/target identities, service impact, free storage, backup path and recovery. Replace all example paths with your own; retain the plan SHA-256.',
    apply:
      'Apply only after reviewing the plan. Replace PLAN_SHA256 with the exact printed hash. Each mandatory intermediate release needs its own checkout, fresh matching backup, reviewed plan and explicit apply.',
    verify:
      'Inspect status. Completion requires authenticated Fetch, routes, preserved configuration, data checks, running GitLab and fresh runner-manager contacts. Keep the plan, verification receipt and recovery inputs until acceptance.',
    recovery:
      'Inspect status after interruption. Recover uses the existing paired updater and owned lease recovery; it restores the previous settings and retained controller/Wizard images, using verified local image aliases for offline restarts. The original digest selectors remain in the checkpoint; reconcile those two selectors before another official upgrade. Never remove active leases. A container image rollback cannot reverse a database migration. For backup failure before the updater starts, inspect the coordinated backup operation and resolve it before making a new plan.',
    steps: [
      'Prerequisites',
      'Matching backups',
      'Preflight and reviewed plan',
      'Explicit apply',
      'Verification',
      'Recovery',
    ],
    capacity: 'Minimum additional free space for images and checkpoints:',
    gib: 'GiB. Native backup preflight also checks the Seed destination.',
    fork: 'For unchanged official source builds or modified forks, merge upstream, resolve conflicts, build and test an accepted successor with the existing native workflow. Official release evidence does not cover local modifications.',
  },
  de: {
    title: 'Migrationsleitfaden für Releases',
    source: 'Installierte Version',
    target: 'Zielversion',
    unknownVersion: 'Unbekannte / andere Version',
    information:
      'Dieser Leitfaden funktioniert offline. Die Versionsauswahl zeigt nur Anweisungen; sie verbindet sich nicht mit Sync und ändert keine Installation. Die installierte Version muss anhand des gespeicherten Release-Belegs geprüft werden; es gibt keine automatische Erkennung.',
    supported:
      'Unterstützter Übergang. Die CLI-Vorprüfung verlangt zusätzlich passende Kandidaten-Nachweise des veröffentlichten Ziel-Releases.',
    unknown:
      'Unbekanntes Release. Kompatibilität darf nicht vorausgesetzt werden. Ohne vollständige offizielle Release-Identität ist der Ablauf für eigene Builds oder Wiederherstellung erforderlich.',
    unsupported:
      'Für diese Auswahl ist kein unterstützter Pfad hinterlegt. Downgrades und nicht freigegebene Datenbankübergänge benötigen ein eigenes geprüftes Verfahren.',
    unnecessary: 'Beide Versionen sind gleich. Ein Release-Upgrade ist nicht erforderlich.',
    intermediate: 'Verpflichtende Release-Zwischenstopps in dieser Reihenfolge:',
    interruption:
      'Die passende kalte Sicherung pausiert GitLab. Controller/Sync und Wizard starten beim Update neu; geänderte Compose-Richtlinien können auch Kern-Container einschließlich GitLab, Proxys und Runner-Manager neu erstellen. Laufende CI-Jobs müssen vorher enden. Es gibt keine garantierte Ausfallzeit.',
    databasePrerequisite:
      'Dieser Übergang ändert GitLab- und Runner-Images und migriert die Datenbank. Zuerst das dokumentierte native GitLab-Upgrade abschließen und dessen separaten kalten Checkpoint behalten. Sein Verzeichnis beim anschließenden Release-Plan unten angeben. Die Paar-Wiederherstellung setzt nur Controller und Wizard zurück; ein Datenbank-Rollback benötigt die eigene kalte Wiederherstellung und verwirft spätere Schreibvorgänge.',
    preservedImages: 'Dieser Übergang behält die ausgewählten Service- und Datenbank-Images bei.',
    gitlabGuide: 'GitLab-Migration und kalter Checkpoint',
    prerequisites:
      'Ein unverändertes offizielles Release auf unterstütztem Ubuntu x86_64, ein API-Token der eigenen Installation, freie Betriebsabläufe und abgeschlossene GitLab-Hintergrundmigrationen sind erforderlich. Das genaue Ziel-Tag auschecken und dessen offline verfügbaren Node-/CLI-Laufzeit vorbereiten. Aktuelle Releases enthalten den Wizard im System-Quellbaum; Submodule nur für ältere Releases initialisieren, die diese vorsehen. Domains, Speicher- und Projekteinstellungen beibehalten.',
    backup:
      'Das ausdrücklich gewählte Sicherungsdateisystem einhängen und dort einen neuen ZIP-Pfad wählen. Apply sichert zuerst die bisherigen Controller-/Wizard-Images und erzeugt und prüft danach einen passenden abgeschlossenen Seed samt exakter Konfigurationssicherung. Fehlende Medien führen zu einem Fehler ohne Ausweichverzeichnis. Beide Wiederherstellungseingaben unabhängig verfügbar halten.',
    preflight:
      'Die Vorprüfung aus dem exakten Checkout des Ziel-Releases ausführen. Identitäten, betroffene Services, freien Speicher, Sicherungspfad und Wiederherstellung prüfen. Alle Beispielpfade ersetzen und den SHA-256 des Plans aufbewahren.',
    apply:
      'Erst nach Prüfung des Plans anwenden. PLAN_SHA256 durch den genau ausgegebenen Hash ersetzen. Jeder verpflichtende Zwischenstopp braucht einen eigenen Checkout, eine neue passende Sicherung, einen geprüften Plan und eine ausdrückliche Anwendung.',
    verify:
      'Status prüfen. Abschluss verlangt authentifiziertes Fetch, Routen, erhaltene Konfiguration, Datenprüfungen, laufendes GitLab und frische Runner-Manager-Kontakte. Plan, Prüfbeleg und Wiederherstellungseingaben bis zur Abnahme aufbewahren.',
    recovery:
      'Nach Unterbrechungen den Status prüfen. Recover nutzt den bestehenden Paar-Updater und dessen Lease-Wiederherstellung für vorherige Einstellungen und gespeicherte Controller-/Wizard-Images. Geprüfte lokale Image-Aliase ermöglichen Offline-Neustarts. Die ursprünglichen Digest-Auswahlen bleiben im Checkpoint; diese beiden Auswahlen vor einem weiteren offiziellen Upgrade wiederherstellen. Aktive Leases niemals löschen. Ein Image-Rollback macht keine Datenbankmigration rückgängig. Bei Sicherungsfehlern vor dem Updater den koordinierten Sicherungsvorgang prüfen und vor einem neuen Plan beheben.',
    steps: [
      'Voraussetzungen',
      'Passende Sicherungen',
      'Vorprüfung und geprüfter Plan',
      'Ausdrücklich anwenden',
      'Verifikation',
      'Wiederherstellung',
    ],
    capacity: 'Mindestens zusätzlich freier Speicher für Images und Checkpoints:',
    gib: 'GiB. Die native Sicherungsvorprüfung prüft auch das Seed-Ziel.',
    fork: 'Für unveränderte offizielle Quellbuilds und veränderte Forks: Upstream zusammenführen, Konflikte lösen, einen Nachfolger mit dem vorhandenen nativen Ablauf bauen und prüfen. Offizielle Release-Nachweise decken lokale Änderungen nicht ab.',
  },
  ko: {
    title: '릴리스 마이그레이션 가이드',
    source: '설치된 버전',
    target: '대상 버전',
    unknownVersion: '알 수 없는 버전 / 다른 버전',
    information:
      '이 가이드는 오프라인에서 동작합니다. 버전 선택은 안내만 표시하며 Sync에 연결하거나 설치를 변경하지 않습니다. 저장된 릴리스 선택 기록으로 설치 버전을 확인하세요. 자동 감지는 제공하지 않습니다.',
    supported:
      '지원되는 전환입니다. CLI 사전 점검은 공개된 대상 릴리스의 일치하는 후보 검증 자료도 요구합니다.',
    unknown:
      '알 수 없는 릴리스입니다. 호환성을 가정하지 마세요. 공식 릴리스 식별 정보가 부족한 설치는 소스 빌드 또는 복구 절차를 따라야 합니다.',
    unsupported:
      '이 선택에 대해 지원되는 경로가 없습니다. 다운그레이드와 선언되지 않은 데이터베이스 전환에는 별도로 검토된 복구 또는 마이그레이션 절차가 필요합니다.',
    unnecessary: '두 버전이 같습니다. 릴리스 업그레이드가 필요하지 않습니다.',
    intermediate: '다음 순서로 필수 중간 릴리스를 거쳐야 합니다:',
    interruption:
      '일치하는 콜드 백업을 만들 때 GitLab이 일시 중지됩니다. 업데이트 중 컨트롤러/Sync와 Wizard가 재시작됩니다. Compose 정책 변경으로 GitLab, 프록시 및 Runner 관리자를 포함한 핵심 컨테이너도 다시 생성될 수 있습니다. 실행 중인 CI 작업이 끝날 때까지 기다리세요. 중단 시간은 보장되지 않습니다.',
    databasePrerequisite:
      '이 전환은 GitLab과 Runner 이미지를 변경하고 데이터베이스를 마이그레이션합니다. 먼저 문서화된 기본 GitLab 업그레이드를 완료하고 별도의 콜드 체크포인트를 보관하세요. 아래 릴리스 계획에 해당 체크포인트 디렉터리를 전달하세요. 쌍 복구는 컨트롤러와 Wizard만 복원합니다. 데이터베이스 롤백에는 별도의 콜드 복원이 필요하며 체크포인트 이후 기록은 삭제됩니다.',
    preservedImages: '이 전환은 선택된 서비스와 데이터베이스 이미지를 유지합니다.',
    gitlabGuide: 'GitLab 마이그레이션 및 콜드 체크포인트 절차',
    prerequisites:
      '지원되는 Ubuntu x86_64의 변경되지 않은 공식 릴리스, 이 설치의 API 토큰, 유휴 작업 상태, 완료된 GitLab 백그라운드 마이그레이션이 필요합니다. 정확한 대상 태그를 가져오고 오프라인 Node/CLI 런타임을 준비하세요. 현재 릴리스는 System 소스 트리에 Wizard를 포함합니다. 서브모듈을 선언한 과거 릴리스에서만 서브모듈을 초기화하세요. 도메인, 저장소와 프로젝트 설정을 유지하세요.',
    backup:
      '명시적으로 선택한 백업 파일시스템을 연결하고 그 안에 새 구성 ZIP 경로를 선택하세요. Apply는 먼저 이전 컨트롤러/Wizard 이미지 파일을 보관한 후 일치하는 완료된 Seed와 정확한 구성 백업을 생성하고 검증합니다. 미디어가 없으면 대체 경로 없이 실패합니다. 두 복구 입력을 독립적으로 보관하세요.',
    preflight:
      '정확한 대상 릴리스 체크아웃에서 사전 점검을 실행하세요. 설치/대상 식별 정보, 서비스 영향, 여유 공간, 백업 경로와 복구 방법을 검토하세요. 예시 경로를 모두 바꾸고 계획 SHA-256을 보관하세요.',
    apply:
      '계획을 검토한 뒤에만 적용하세요. PLAN_SHA256을 출력된 정확한 해시로 바꾸세요. 각 필수 중간 릴리스에는 별도의 체크아웃, 새로 일치하는 백업, 검토된 계획과 명시적 적용이 필요합니다.',
    verify:
      '상태를 확인하세요. 완료에는 인증된 Fetch, 라우팅, 보존된 구성, 데이터 점검, 실행 중인 GitLab과 최신 Runner 관리자 연결이 필요합니다. 승인할 때까지 계획, 검증 기록과 복구 입력을 보관하세요.',
    recovery:
      '중단 후 상태를 확인하세요. Recover는 기존 쌍 업데이트 및 소유한 잠금 복구 절차로 이전 설정과 보관된 컨트롤러/Wizard 이미지를 복원합니다. 검증된 로컬 이미지 별칭으로 오프라인 재시작이 가능합니다. 원래 다이제스트 선택은 체크포인트에 보존됩니다. 다음 공식 업그레이드 전에 이 두 선택을 복원하세요. 활성 잠금을 삭제하지 마세요. 이미지 롤백은 데이터베이스 마이그레이션을 되돌리지 않습니다. 업데이터 시작 전 백업 실패는 조정된 백업 작업을 확인하고 해결한 후 새 계획을 만드세요.',
    steps: [
      '사전 요구 사항',
      '일치하는 백업',
      '사전 점검 및 계획 검토',
      '명시적 적용',
      '검증',
      '복구',
    ],
    capacity: '이미지와 체크포인트를 위한 최소 추가 여유 공간:',
    gib: 'GiB. 기본 백업 사전 점검에서 Seed 대상도 검사합니다.',
    fork: '변경되지 않은 공식 소스 빌드나 수정된 포크는 업스트림을 병합하고 충돌을 해결한 후 기존 기본 절차로 후속 버전을 빌드하고 검증하세요. 공식 릴리스 검증 자료는 로컬 변경 사항을 보증하지 않습니다.',
  },
};

export function migrationCommand(edge: UpgradeTransition, operation: string) {
  // Historical stops run from their own release checkout, which predates the CLI.
  const command =
    Number(edge.to.split('.')[0]) >= 2
      ? 'sudo /opt/system-bootstrapper-runtime/bin/node operations/dist/cli.js upgrade \\\n  --checkout "$PWD"'
      : 'sudo python3 bootstrapper/upgrade-release.py';
  const base =
    command +
    ' \\\n  --persistence-env /root/system-storage.env \\\n  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-' +
    edge.to;
  if (operation === 'preflight')
    return (
      base +
      ' \\\n  --target ' +
      edge.to +
      ' \\\n  --backup-file /mnt/backup/configuration-before-' +
      edge.to +
      '.zip \\\n  --token-file /root/system-api-token' +
      (edge.gitlabPrerequisite
        ? ' \\\n  --gitlab-checkpoint /var/lib/system-bootstrapper/platform/configuration/gitlab-upgrades/public-to-' +
          edge.to
        : '')
    );
  return (
    base +
    ' \\\n  --operation ' +
    (operation === 'verify' ? 'status' : operation === 'recovery' ? 'recover' : 'apply') +
    (operation === 'verify'
      ? ''
      : ' \\\n  --token-file /root/system-api-token \\\n  --confirm-plan PLAN_SHA256')
  );
}

export default function MigrationGuide({ graph = upgradeGraph }: { graph?: UpgradeGraph }) {
  const { locale } = useI18n();
  const text = messages[locale];
  const id = useId();
  const [source, setSource] = useState('');
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [target, setTarget] = useState(graph.versions.at(-1) ?? '');
  const route = upgradePath(source, target, graph);
  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={`${id}-title`}
      sx={{ p: { xs: 2, sm: 3 }, my: 3 }}
    >
      <Typography id={`${id}-title`} component="h2" variant="h5" sx={{ mb: 2 }}>
        {text.title}
      </Typography>
      <Typography sx={{ mb: 2 }}>{text.information}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
        {[
          { name: 'source', label: text.source, value: source, change: setSource },
          { name: 'target', label: text.target, value: target, change: setTarget },
        ].map((control) => (
          <TextField
            key={control.name}
            id={`${id}-${control.name}`}
            label={control.label}
            value={control.value}
            select
            fullWidth
            onChange={(event) => {
              control.change(event.target.value);
              setChecked({});
            }}
            slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          >
            <option value="">{text.unknownVersion}</option>
            {graph.versions.map((version) => (
              <option key={version} value={version}>
                {version}
              </option>
            ))}
          </TextField>
        ))}
      </Stack>
      <Alert
        severity={
          route.status === 'supported'
            ? 'success'
            : route.status === 'unsupported'
              ? 'warning'
              : 'info'
        }
        role="status"
      >
        {text[route.status]}
      </Alert>
      {route.status === 'supported' && (
        <>
          <Typography sx={{ my: 2 }}>
            {text.intermediate} {source} → {route.transitions.map((edge) => edge.to).join(' → ')}
          </Typography>
          <Typography sx={{ my: 2 }}>{text.interruption}</Typography>
          {route.transitions.map((edge) => (
            <Box key={`${edge.from}-${edge.to}`}>
              <Typography component="h3" variant="h6">
                {edge.from} → {edge.to}
              </Typography>
              <Typography>
                {text.capacity} {edge.minimumFreeGiB} {text.gib}
              </Typography>
              {edge.gitlabPrerequisite ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  {text.databasePrerequisite}{' '}
                  <strong>
                    GitLab {edge.gitlabPrerequisite.fromVersion} →{' '}
                    {edge.gitlabPrerequisite.toVersion}
                  </strong>{' '}
                  <Link
                    href={`https://github.com/kihyoun/system/blob/v${edge.to}/gitlab/UPGRADE.md`}
                  >
                    {text.gitlabGuide}
                  </Link>
                </Alert>
              ) : edge.serviceImagesPreserved ? (
                <Typography sx={{ mt: 2 }}>{text.preservedImages}</Typography>
              ) : null}
              <Box component="ol" sx={{ pl: 3 }}>
                {edge.steps.map((step, index) => (
                  <Box component="li" key={step} sx={{ my: 2 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      <Checkbox
                        size="small"
                        checked={checked[`${edge.from}:${edge.to}:${step}`] ?? false}
                        onChange={(event) =>
                          setChecked((current) => ({
                            ...current,
                            [`${edge.from}:${edge.to}:${step}`]: event.target.checked,
                          }))
                        }
                        slotProps={{
                          input: {
                            'aria-label': `${edge.from} → ${edge.to}: ${text.steps[index]}`,
                          },
                        }}
                      />
                      <Typography component="h4" variant="subtitle1" sx={{ fontWeight: 700 }}>
                        {text.steps[index]}
                      </Typography>
                    </Stack>
                    <Typography>
                      {
                        text[
                          step as
                            | 'prerequisites'
                            | 'backup'
                            | 'preflight'
                            | 'apply'
                            | 'verify'
                            | 'recovery'
                        ]
                      }
                    </Typography>
                    {['preflight', 'apply', 'verify', 'recovery'].includes(step) && (
                      <CodeBlock code={migrationCommand(edge, step)} language="bash" />
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </>
      )}
      <Typography sx={{ mt: 2 }}>{text.fork}</Typography>
    </Paper>
  );
}
