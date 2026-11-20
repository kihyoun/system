const de: Record<string, string> = {
  title: 'Gemeinsame Sicherung',
  introduction: 'Eine Aktion erstellt einen Seed auf dem gewählten externen Medium und eine passende Konfigurations-ZIP zum separaten Herunterladen. Die ZIP enthält Geheimnisse. GitLab wird während Harvest vorübergehend angehalten.',
  start: 'Seed und Konfiguration sichern',
  close: 'Schließen',
  refresh: 'Status aktualisieren',
  download: 'Konfigurations-ZIP herunterladen',
  saved: 'ZIP sicher gespeichert',
  complete: 'Seed und heruntergeladene Konfiguration sind gesichert. Beide getrennt aufbewahren.',
  ready: 'Seed und ZIP sind fertig. Die Sicherung ist erst vollständig, wenn die ZIP heruntergeladen und unabhängig gespeichert wurde.',
  partial: 'Nur teilweise abgeschlossen. Der angezeigte Seed bleibt erhalten; eine passende Konfigurations-ZIP ist nicht verfügbar. Fehler beheben und die Sicherung wiederholen.',
  failed: 'Sicherung fehlgeschlagen. Frühere abgeschlossene Seeds bleiben erhalten. Vor einem erneuten Versuch Dienststatus und Sperren prüfen.',
  interrupted: 'Abschluss des Helfers unbestätigt. Dienststatus und Sperren durch einen Administrator prüfen lassen. Das Medium noch nicht trennen.',
  detach: 'Das Medium darf erst nach bestätigtem Helferabschluss und Dienststart sicher getrennt werden. Bei einer nur teilweise fertigen Sicherung bleibt die Wiederherstellung unvollständig.',
  seed: 'Seed auf dem Backup-Medium:',
  checksum: 'SHA-256 der Konfigurations-ZIP:',
  downloadFailed: 'Der Download ist fehlgeschlagen. Der Seed ist erhalten. Den ZIP-Download erneut versuchen.',
  working: 'Sicherung läuft. Status kann aktualisiert werden; Schließen beendet den Helfer nicht.'
};
const en: Record<string, string> = {
  title: 'Coordinated backup',
  introduction: 'One action creates a Seed on the selected external medium and a matching configuration ZIP to download separately. The ZIP contains secrets. GitLab pauses during Harvest.',
  start: 'Back up Seed and configuration', close: 'Close', refresh: 'Refresh status', download: 'Download configuration ZIP', saved: 'ZIP stored safely',
  complete: 'The Seed and downloaded configuration are saved. Keep both independently.',
  ready: 'The Seed and ZIP are ready. The backup is complete only after you download and independently store the ZIP.',
  partial: 'Partially completed. The displayed Seed is retained; a matching configuration ZIP is unavailable. Resolve the failure and repeat the backup.',
  failed: 'Backup failed. Previous completed Seeds are retained. Check services and operation locks before retrying.',
  interrupted: 'Helper completion is unconfirmed. Ask an administrator to inspect services and operation locks. Keep the medium attached.',
  detach: 'Safely detach the medium only after confirmed helper completion and service resumption. A partially completed backup still lacks its complete recovery inputs.',
  seed: 'Seed on the backup medium:', checksum: 'Configuration ZIP SHA-256:',
  downloadFailed: 'Download failed. The Seed is retained. Retry the ZIP download.',
  working: 'Backup is running. You can refresh status; closing this dialog does not stop the helper.'
};
const ko: Record<string, string> = {
  title: '통합 백업',
  introduction: '한 번의 작업으로 선택한 외부 매체에 Seed를 만들고, 별도로 다운로드할 일치하는 설정 ZIP을 생성합니다. ZIP에는 비밀 정보가 포함됩니다. Harvest 중에는 GitLab이 일시 중지됩니다.',
  start: 'Seed 및 설정 백업', close: '닫기', refresh: '상태 새로고침', download: '설정 ZIP 다운로드', saved: 'ZIP 안전하게 저장 완료',
  complete: 'Seed와 다운로드한 설정을 저장했습니다. 둘을 각각 독립적으로 보관하세요.',
  ready: 'Seed와 ZIP이 준비되었습니다. ZIP을 다운로드하여 별도로 저장해야 백업이 완료됩니다.',
  partial: '일부만 완료되었습니다. 표시된 Seed는 보존되지만 일치하는 설정 ZIP을 사용할 수 없습니다. 오류를 해결한 후 백업을 다시 실행하세요.',
  failed: '백업에 실패했습니다. 이전에 완료된 Seed는 보존됩니다. 다시 시도하기 전에 서비스와 작업 잠금을 확인하세요.',
  interrupted: '도우미의 완료 여부를 확인하지 못했습니다. 관리자에게 서비스와 작업 잠금 확인을 요청하세요. 매체를 분리하지 마세요.',
  detach: '도우미 완료와 서비스 재개가 확인된 후에만 매체를 안전하게 분리하세요. 일부만 완료된 백업에는 복구에 필요한 입력값이 모두 갖추어져 있지 않습니다.',
  seed: '백업 매체의 Seed:', checksum: '설정 ZIP SHA-256:',
  downloadFailed: '다운로드에 실패했습니다. Seed는 보존되었습니다. ZIP 다운로드를 다시 시도하세요.',
  working: '백업 진행 중입니다. 상태를 새로고침할 수 있습니다. 이 대화상자를 닫아도 도우미는 중지되지 않습니다.'
};
export function backupText(language: string, key: string): string { return (language.startsWith('ko') ? ko : language.startsWith('de') ? de : en)[key] || en[key] || key; }
