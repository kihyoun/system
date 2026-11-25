# Gemeinsame Seed- und Konfigurationssicherung

Im authentifizierten Wizard **Gemeinsame Sicherung** öffnen und ausdrücklich
**Seed und Konfiguration sichern** starten. Der Ablauf prüft Backup-Dateisystem,
Mount-Identität und freien Speicher über den nativen Harvest-Einstieg, bevor
Dienste angehalten werden. Ein fehlendes oder falsches Medium ist ein Fehler;
es wird kein Ersatzverzeichnis auf dem Systemlaufwerk angelegt. Der Normalbetrieb
verwendet weiterhin den unabhängig ausgewählten Live-Speicher.

## Zwei Wiederherstellungseingaben

Der fertige Seed verbleibt unter `SEED_DIR/snapshots/<generation>` auf dem
gewählten externen Medium. Der Link `current` wählt den jüngsten fertigen Snapshot.
Der Wizard bietet die gewöhnliche Konfigurationssicherung `bootstrapper.zip` als
separaten authentifizierten Download an. Sie enthält Einstellungen und Geheimnisse;
sie muss sicher und unabhängig vom gesicherten Server aufbewahrt werden. Eine
temporäre Serverkopie ermöglicht weitere Downloadversuche und darf niemals die
einzige verlässliche Kopie sein. Fertige Downloads verbleiben im privaten
Konfigurationsverzeichnis des Servers, bis der Betreiber sie ausdrücklich löscht.
Aktive Vorgänge und ihre Sperren dürfen nicht zur Speicherbereinigung entfernt werden.

Die normalen versionierten Wiederherstellungsmetadaten in `bootstrapper.json` und
`recovery.json` enthalten die genaue Seed-Generation, den SHA-256 der Manifestdatei,
die native Abschlusszeit, GitLab-Image-Identität, Konfigurationserfassungszeit und
SHA-256 jeder erfassten ENV-Datei. Diese Angaben vor einer Wiederherstellung mit
dem aufbewahrten Seed-Manifest und den ZIP-Einträgen vergleichen. Der ZIP-Download
hat zusätzlich einen angezeigten SHA-256. Konfigurationsgeheimnisse und
Konfigurationsdateien werden nicht in das Seed-Manifest übernommen.

## Fortschritt und Fehler

Die globale Speichersperre und die Konfigurationshelfersperre verhindern gleichzeitige
Konfigurationsänderungen während Erfassung, Harvest und Export. Auch die
Zertifikatssperre umfasst Erfassung und Harvest. Die ZIP verwendet das normale
Wizard-Modell und dessen ZIP-Exporter und bewahrt die exakt erfassten Haupt- und
Projekt-ENV-Bytes. Ungespeicherte Browseränderungen werden nicht exportiert.
Harvest führt weiterhin seine vorgeschriebenen Prüfungen der kalten Sicherung aus
und setzt GitLab nach Abschluss oder behandeltem Fehler fort. Es werden keine
Pipeline und keine automatische Wiederherstellungsprobe gestartet.

Status aktualisieren, um Vorprüfung, Erfassung, Harvest und ZIP-Export zu verfolgen.
Das Schließen des Dialogs beendet den nativen Helfer nicht. Der letzte Vorgang
kann in derselben Browsersitzung wieder geöffnet werden. Nach dem Browserdownload
bestätigen, dass die ZIP sicher gespeichert wurde; das Starten des Downloads allein
beweist dies nicht. Das Paar ist erst mit beiden unabhängig aufbewahrten
Wiederherstellungseingaben vollständig.

Ein Harvest-Fehler erhält den vorherigen fertigen Seed. Wurde ein neuer Seed fertig,
aber der Export schlug fehl, ist das Ergebnis teilweise abgeschlossen und nennt
die neue Generation. Eine ältere ZIP wird nicht als passend bezeichnet. Fehler
beheben und den Vorgang wiederholen. Nach einem fehlgeschlagenen Browserdownload
kann die gespeicherte ZIP erneut heruntergeladen werden. Bei ungewissem Helferabschluss
oder Dienstneustart zuerst den nativen Vorgang und verbleibende Sperren prüfen.
Aktive Sperren niemals entfernen, Zwischenverzeichnisse nicht freigeben und
unbestätigte Vorgänge nicht als abgeschlossen bezeichnen.

Das Backup-Medium erst nach Helferabschluss und erfolgreicher GitLab-Fortsetzung
trennen. Unterbrochene oder ungewisse Vorgänge müssen zuerst geprüft werden.
Historische Snapshots bleiben erhalten; Aufbewahrung und Löschung bleiben ausdrücklich.

## Kompatibilität und Wiederherstellung

Gewöhnliches Öffnen, Backup, Push und Fetch sowie separates Harvest und Restore
behalten ihr bisheriges Verhalten. Alte Backups ohne Paarmetadaten bleiben mit
dem bisherigen manuellen Abgleich nutzbar. Das Öffnen einer gepaarten JSON-Sicherung
bewahrt historische Metadaten als ungeprüften Nachweis und entfernt deren behauptete
Seed-Zuordnung. Bearbeiten und erneutes Exportieren erzeugen kein neues Sicherungspaar.

Dem [Wiederherstellungsvertrag](RECOVERY_CONTRACT.md) mit passendem fertigem Seed,
Konfigurations-ZIP, kompatiblen Wiederherstellungswerkzeugen und frisch bezogenen
Quellen folgen. Ein passender Prüfsummenwert belegt Zuordnung und Integrität,
aber erteilt keine automatische Wiederherstellungserlaubnis und beweist nicht,
dass Image-Inhalte unabhängig verfügbar sind.
