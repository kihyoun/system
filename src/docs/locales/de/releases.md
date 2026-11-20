# Akzeptierte Produkt-Releases

System verwendet **MAJOR.MINOR.PATCH** mit Tags `vX.Y.Z` gemäß
[Semantic Versioning](https://semver.org/): Inkompatible öffentliche Konfigurations-,
Backup-, API- oder Installationsverträge erfordern eine Hauptversion; kompatible
Funktionen verwenden eine Nebenversion, kompatible Fehler-/Sicherheitskorrekturen
eine Patchversion. Eine Datenbankmigration kann auch bei kompatiblem Betreibervertrag
Ausfallzeit und Checkpoint benötigen. Versionshinweise müssen Migrations- und
Wiederherstellungsanforderungen erklären; SemVer allein beweist keine Upgrade-Sicherheit.

**1.0.0 ist die erste unterstützte Produktbasis.** Historische Commits und Image-
Veröffentlichungen behalten ihre ursprünglichen Identitäten. `VERSION` und das
[gepflegte Änderungsprotokoll](https://github.com/kihyoun/system/blob/master/CHANGELOG.md)
werden mit jedem geplanten Release geprüft. Fehlgeschlagene Kandidaten, Wiederholungen
und gewöhnliche Pipelineläufe erhalten keine neuen Versionen. Wenn ein Quellcode-/Image-
Versuch bereits eine Version belegt, benötigt ein anderer akzeptierter Versuch eine neue geprüfte Version.

## Öffentliche Release-Inhalte

[GitHub Releases](https://github.com/kihyoun/system/releases) zeigen das Ergebnis des
vertrauenswürdigen GitLab-Ablaufs. Der öffentliche Quellcodespiegel und Docker Hub
bleiben die Verteilwege für Quellcode und Images. GitHub Actions ist kein Teil der
Veröffentlichung. Jedes stabile Release liefert:

- Ein nur neu anlegbares GitHub-Präsentationstag auf dem exakt gespiegelten akzeptierten
  System-Commit sowie benutzerbezogene Hinweise aus dem geprüften Änderungsprotokoll.
- `system-release-vX.Y.Z.json` und eine SHA-256-Begleitdatei: exakter System-Commit,
  Quellcodebaum und Wizard-Gitlink; passende öffentliche Controller-/Wizard-Referenzen,
  unveränderliche Manifest-/Konfigurations-Digests und akzeptierte Image-IDs; Nachweishash
  desselben Versuchs und geprüfte Hostkompatibilität; Installations-/Upgrade-/Wiederherstellungslinks.
- `quickstart.sh`, gebunden an das Release-Tag, und `release-notes.md`.

Das öffentliche Manifestformat lautet `system-accepted-release-v1`. Alle Daten werden
aus dem akzeptierten Kandidaten derselben Pipeline, der Docker-Hub-Veröffentlichung
und den exakten Nachweisen der Wizard-Quellcodeveröffentlichung erzeugt. Interne
Rohnachweise, private Registry-URLs, Konfiguration, Seeds, Zugangsdaten und Betriebslogs
sind keine Release-Artefakte. Metadaten und Prüfsumme stammen beide aus dem vertrauten
GitHub-Release; die Prüfsumme erkennt inkonsistente Übertragung, ist aber keine unabhängige Signaturidentität.

Beispielabruf für eine ausdrücklich ausgewählte Version:

```bash
curl -fLO https://github.com/kihyoun/system/releases/download/v1.0.0/system-release-v1.0.0.json
curl -fLO https://github.com/kihyoun/system/releases/download/v1.0.0/system-release-v1.0.0.json.sha256
sha256sum -c system-release-v1.0.0.json.sha256
```

Checken Sie die `source.revision` des Manifests aus und initialisieren Sie das festgelegte Submodul:

```bash
git clone https://github.com/kihyoun/system.git
cd system
git checkout --detach v1.0.0
git submodule update --init --recursive
git rev-parse HEAD HEAD^{tree}
git ls-tree HEAD wizard
```

Vergleichen Sie die Ausgaben mit dem Manifest. GitHubs einfache Quellcodearchive enthalten
keine Wizard-Submodulinhalte und sind daher kein vollständiger rekursiver Checkout.
Aufbewahrte Wizard-Release-Referenzen machen den festgelegten Gitlink öffentlich abrufbar,
ohne den Wizard-Standardbranch zu ändern.

Installieren Sie einen frischen Host mit der [Schnellinstallation](QUICKSTART.md), oder
übergeben Sie `images.controller.reference` und `images.wizard.reference` aus dem Manifest an
`bootstrapper/install-release.py --controller ... --wizard ... --release-metadata ...`.
Das native Installationsprogramm prüft exakte Quellcode- und geladene Image-Identitäten.
Referenzen allein bewahren keine Image-Inhalte: Halten Sie geprüfte Image-Archive vor
oder stellen Sie die Wiederherstellbarkeit öffentlicher/privater Registries während des benötigten Zeitraums sicher.

## Vertrauenswürdige Veröffentlichung und Wiederholungsverhalten

Erforderliche Komponenten-, Browser-, Kandidatenimage- und kurzlebige Plattformprüfungen,
geprüfter Merge, Prüfungen nach dem Merge, öffentliche Image-Kopie und Quellcodespiegel
bleiben in GitLab. Der geschützte native Standardbranch-Job `deploy:github-release`
läuft nach diesen Jobs; er prüft deren exakte Pipeline-/Quellcode-/Artefaktzuordnung
über die GitLab-API und anonym die Verfügbarkeit öffentlichen Quellcodes und der Images.
Er kopiert keine Images und baut nichts neu. Bestehende GitLab-Versions-Tag-Pipeline-Prüfungen
bleiben unverändert. Das reine GitHub-Präsentationstag erzeugt keine GitLab-Tag-Pipeline.

Der Publisher verwendet eine serialisierte Ressourcengruppe. Er erstellt einen Entwurf,
lädt konsistente Artefakte hoch, veröffentlicht und prüft anonymen Abruf. Eine Wiederholung
verwendet nur ein Tag am identischen Commit, identische Release-Felder und bytegleiche
Artefakte; Neuzuordnung oder Austausch werden abgelehnt. Unterbrochene Entwürfe können
durch Wiederholen desselben Versuchs abgeschlossen werden. Eine veröffentlichte Version
kann keine fehlenden oder ersetzten Artefakte erhalten. Aktivieren Sie unveränderliche
GitHub-Releases und Registry-Erkennungstags als zusätzlichen serverseitigen Schutz vor
Schreibzugriffen außerhalb dieses Ablaufs.

Konfigurieren Sie diese geschützten Variablen auf vertrauenswürdigen GitLab-Runnern:

- `GITHUB_RELEASE_PUBLISH_ENABLED=true` sowie die vorhandenen Aktivierungsflags und
  Zugangsdaten für Docker Hub, GitHub-Backup und Wizard-Quellcodeveröffentlichung.
- `GITHUB_RELEASE_REPOSITORY=kihyoun/system` (oder den öffentlichen Spiegel des Betreibers).
- `GITHUB_RELEASE_TOKEN_FILE`: externe Datei mit Modus 0600 und einem GitHub-Token mit
  auf das Release-Repository begrenztem Contents-Schreibzugriff. Ein geschütztes,
  maskiertes `GITHUB_RELEASE_TOKEN` dient als Ersatz. Die Dateiauswahl hat Vorrang.
- `SYSTEM_RELEASE_GITLAB_TOKEN_FILE`: externe Datei mit Modus 0600 und einem auf das
  Quellprojekt begrenzten GitLab-`read_api`-Token; geschütztes, maskiertes
  `SYSTEM_RELEASE_GITLAB_TOKEN` dient als Ersatz. SSH-Spiegelzugangsdaten können nicht
  über die Release-API veröffentlichen.

Halten Sie beide Tokens von nicht vertrauenswürdigem MR-Code fern sowie außerhalb
von Checkout und Artefaktpfaden. Fehlende Zugangsdaten führen zum sicheren Abbruch.
Ein vorhandener SSH-Spiegelschlüssel wird nicht als nutzbares API-Token vorausgesetzt.
Öffentliche Metadaten enthalten diese Zugangsdaten niemals.

## Upgrade und Rollback

Eine Veröffentlichung aktualisiert keine bestehende Installation. Quickstart
bleibt für Neuinstallationen; erneutes Ausführen oder ein Git-Pull ist kein
Upgrade. Das Release-Kapitel der Wizard Docs bietet manuelle Auswahlfelder für
installierte und gewünschte Version ohne Sync. Die Auswahl informiert nur und
führt keinen Befehl aus.

Der erste deklarierte Übergang ist **1.1.3 → 1.2.0** für ein unverändertes
offizielles Controller-/Wizard-Paar auf Ubuntu 24.04 / 26.04 x86_64. Diese
beiden Images und die gespeicherte Release-Auswahl ändern sich. Kern-Container
können durch neue Compose-Richtlinien einschließlich Protokolllimits ebenfalls
neu erstellt werden. GitLab,
Datenbanken, Runner, NGINX, Anwendungsprojekte, Domains und Speicherauswahl bleiben
erhalten. Das Ziel muss passende Übergangsnachweise veröffentlichen, bevor die
CLI-Vorprüfung es akzeptiert. Unbekannte Releases, abweichende Quellcode-/Image-
Identitäten, private Wizard-Images, Downgrades und nicht deklarierte Service- oder
Datenbankübergänge scheitern vor Wartungsbeginn. Kompatible Produktversionsnummern
ersparen keinen vorgeschriebenen Datenbank-Zwischenstopp.

1. Den Quellcode des ausgewählten Ziel-Releases samt genauem Wizard-Gitlink
   beziehen. Den alten Checkout und die Wiederherstellungseingaben unabhängig
   verfügbar halten. Nur eine Version verwenden, deren öffentliche Metadaten
   und Herausgeber ausdrücklich als vertrauenswürdig gewählt wurden.

```bash
git clone https://github.com/kihyoun/system.git system-upgrade
cd system-upgrade
git checkout --detach v1.2.0
git submodule update --init --recursive
```

2. Ein Wartungsfenster reservieren und laufende Jobs, Plattformoperationen und
   GitLab-Hintergrundmigrationen beenden lassen. Zwischen Plan und Abnahme keine
   Repository- oder Kontodaten ändern: schreibgeschützte Betriebsstichproben
   vergleichen bis zu zehn vorhandene Projekte samt Repository-Köpfen, Benutzer,
   Issues, Merge Requests und Registry-Datensätze. Sie ergänzen Mount-, Image-
   und Konfigurationsprüfungen, erfassen aber nicht jeden Datensatz. Mindestens
   8 GiB RAM und 8 GiB zusätzlicher freier Speicher auf Wiederherstellungs- und
   Docker-Speicher sind erforderlich. Native Harvest-Prüfungen kontrollieren
   zusätzlich das ausdrücklich gewählte Sicherungsdateisystem, UUID und Kapazität.

3. Das Sicherungsmedium anschließen und dort einen neuen ZIP-Dateinamen wählen.
   Alle Beispielpfade durch eigene Pfade ersetzen. Die vorhandene private
   Speicherauswahl und eine API-Token-Datei mit Modus 0600 für **die eigene
   Installation** verwenden; das Token muss Runner und Manager lesen dürfen.
   Kein Konto, Token oder privates Artefakt des Herausgeber-GitLab ist nötig.
   Der Plan lädt und prüft das öffentliche Zielpaar vor abhängiger Wartung,
   kontrolliert Quellcode-/Image-Identitäten, Routen, authentifiziertes Fetch,
   freie Operationen, Migrationsvoraussetzungen und Runner-Kontakte und zeigt
   Auswirkungen und Wiederherstellung.

```bash
sudo python3 bootstrapper/upgrade-release.py \
  --target 1.2.0 \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0 \
  --backup-file /mnt/backup/configuration-before-1.2.0.zip \
  --token-file /root/system-api-token
```

Die Kontaktzeitpunkte inaktiver Runner können aus dem Cache stammen. Ist ein
passender Manager online, sein Kontakt aber älter als die Baseline, führt die
native Prüfung das offizielle
`gitlab-runner verify --config /etc/gitlab-runner/config.toml` in dessen vorhandenem
Container aus, begrenzt auf 15 Sekunden innerhalb des Bereitschaftszeitfensters.
Danach wird die API erneut gelesen; erhaltene Identität, Online-Status und Kontakt
nach der Baseline bleiben erforderlich. Dies prüft die Authentifizierung der
gespeicherten Konfiguration ohne Registrierung, Konfigurationsänderung oder neuen
Job. Der Beleg enthält `authenticationProbeCount` und `jobExecutionChecked=false`:
Die Aktivität des laufenden Pollers und die Job-Ausführung gehören nicht zu dieser
Prüfung. Der isolierte Plattformkandidat prüft echte CI-Ausführung vor der
Veröffentlichung.

Eine fehlgeschlagene schreibgeschützte Vorprüfung bleibt über Status prüfbar. Nach
Korrektur der Voraussetzungen darf derselbe Planpfad nur erneut verwendet werden,
wenn Status fehlgeschlagen meldet und weder geprüfter Plan noch Update-Checkpoint
vorliegt. Bei einer nach Prozessverlust weiter als prüfend markierten Vorprüfung
das Verzeichnis behalten und einen neuen Planpfad wählen. Native Lease-Prüfungen
lehnen aktive und unfertige Operationen weiterhin ab; Leases niemals löschen.

Offizielle Upgrades benötigen die exakt bei der Veröffentlichung erfassten
Laufzeit-Image-IDs. Docker-Image-Speicher können einen Manifest- oder
Konfigurations-Digest als lokale Image-ID melden; diese Digests werden getrennt
geprüft. Weicht die lokale ID von der akzeptierten ID ab, wird das Upgrade
abgelehnt, auch wenn die Neuinstallation diese Speicheridentität akzeptiert hat.
Für abweichende IDs den dokumentierten Quell-/Wiederherstellungsablauf verwenden.
Die CLI konvertiert keine Image-Speicher; Änderungen an Metadaten oder
Laufzeitselektoren beseitigen diese Einschränkung nicht.

4. Den vollständigen Plan und SHA-256 prüfen. `PLAN_SHA256` durch den genau
   ausgegebenen Hash ersetzen; Apply verweigert fehlende oder andere Bestätigung.
   Es prüft Veröffentlichung und gespeicherte Konfiguration erneut, sichert zuerst
   die bisherigen Controller-/Wizard-Images und führt danach die bestehende
   koordinierte Sicherung aus und verifiziert die genaue ZIP-Datei
   anhand abgeschlossener Seed-Generation und Manifest. Fehlende Medien ergeben
   ausdrücklich einen Fehler ohne Ausweichverzeichnis auf der Systemplatte.
   Beide Sicherungseingaben müssen unabhängig verfügbar bleiben. Bisherige
   Controller-/Wizard-Images, öffentliche Nachweise, Auswahldateien und native
   Update-Checkpoints bleiben vor Beginn des Paar-Updates im gewählten lokalen
   Wiederherstellungsverzeichnis erhalten.

```bash
sudo python3 bootstrapper/upgrade-release.py --operation apply \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0 \
  --token-file /root/system-api-token \
  --confirm-plan PLAN_SHA256
```

5. Die passende kalte Sicherung pausiert GitLab und setzt es später fort; das
   Paar-Update startet Controller/Sync und Wizard neu. Kern-Container einschließlich
   GitLab, Proxys und Runner-Manager können durch geänderte Compose-Richtlinien
   ebenfalls neu erstellt werden. Laufende Jobs müssen
   vorher enden. Die Dauer hängt von Daten und Host ab; eine feste Ausfallzeit
   wird nicht garantiert. Der bestehende Updater besitzt die Live-State-Leases
   und Rollback-Checkpoints. Abschluss verlangt identische gespeicherte
   Konfiguration und authentifiziertes Fetch, erwartete Service-/Mount-Identität,
   Managementrouten, Registry-Authentifizierung, neue Runner-Manager-Kontakte und
   unveränderte schreibgeschützte Datenstichproben. Der private Vorgang speichert
   genaue Version und Quelle. Prüf- und Wiederherstellungseingaben bis zur Abnahme
   behalten. Nutzer führen keine Entwicklungs-Plattformtests auf ihrer Installation aus.

6. Nach Unterbrechungen zuerst den Status prüfen. Wenn die Sicherung vor Beginn
   des Controller-Updaters scheitert, den erhaltenen koordinierten Sicherungsvorgang
   untersuchen und dessen Status und Leases vor einem neuen Plan auflösen. Mit
   vorhandenem Update-Checkpoint prüft und lädt Recover die gespeicherten vorherigen
   Images und ruft den bestehenden Paar-Rollback samt Wiederherstellung eigener
   unterbrochener Leases auf. Aktive Leases niemals löschen und alte Datenbank-
   Images niemals gegen migrierte Daten starten.

```bash
sudo python3 bootstrapper/upgrade-release.py --operation status \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0
sudo python3 bootstrapper/upgrade-release.py --operation recover \
  --persistence-env /root/system-storage.env \
  --plan-dir /var/lib/system-bootstrapper/platform/recovery/public-upgrades/to-1.2.0 \
  --token-file /root/system-api-token \
  --confirm-plan PLAN_SHA256
```

Docker-Archive erhalten Image-IDs, können aber Registry-Digest-Auswahlen verlieren.
Recover speichert deshalb geprüfte `system-bootstrapper-recovery:…`-Aliase in
`BOOTSTRAPPER_IMAGE` und `WIZARD_IMAGE` samt privatem Image-ID-Beleg. So startet
auch der vorherige Controller offline, nachdem er seine gespeicherte Konfiguration
neu eingelesen hat. Alle anderen Konfigurationsbytes bleiben unverändert. Die
ursprüngliche Konfiguration und Release-Auswahl bleiben im Controller-Checkpoint;
Status zeigt deren Pfad und den ausdrücklich gewählten Wiederherstellungsmodus.
Vor einem weiteren offiziellen Upgrade die ursprünglichen Controller- und Wizard-
Digest-Referenzen aus diesem Checkpoint beziehen, deren gespeicherte Image-IDs
prüfen und nur diese beiden Auswahlen über den normalen Konfigurationsablauf
wiederherstellen. Keine anderen aktuellen Einstellungen ersetzen und die
Wiederherstellungseingaben nicht löschen.

Der öffentliche Graph enthält derzeit nur Controller-/Wizard-Übergänge. Ein
Image-Rollback macht keine Datenbankmigration rückgängig. Künftige deklarierte
Service-Übergänge müssen die bestehende [GitLab-Migration und kalte Checkpoint-Wiederherstellung](HANDBOOK.md#5-evolving-a-running-system)
mit verpflichtenden Zwischenversionen und unabhängig verfügbaren Eingaben nutzen;
die öffentliche CLI lehnt nicht implementierte Übergangstypen ab. Die vollständige
[Konfigurations- und Seed-Wiederherstellung](RECOVERY_CONTRACT.md) bleibt der Weg
für frischen Livespeicher. Zwischen-Releases werden in Reihenfolge angezeigt;
Apply verlangt zuerst den eigenen Checkout, eine neue Sicherung und einen
separat bestätigten Plan für den ersten Zwischenstopp und danach für jeden
weiteren. Es gibt keinen Sprung direkt zum letzten Tag.

Unveränderte offizielle Quellbuilds ohne Release-Auswahlbeleg und veränderte
Forks verwenden den bestehenden Nachfolgerablauf: Upstream zusammenführen,
Konflikte lösen, einen eigenen Nachfolger bauen und prüfen und mit nativen
Nachweisen gezielt promoten. Öffentliche Nachweise offizieller Releases
autorisieren keine lokalen Änderungen und ersetzen keine fehlende Quellidentität.

Das öffentliche Manifest bindet `system-upgrade-vX.Y.Z.json` durch SHA-256.
Diese strikt ausgewählten Nachweise enthalten genaue Quell-/Image-Identitäten,
erfolgreiche Pflichtjobs desselben Versuchs, ursprünglichen Nachweishash,
Speicher-/Migrationsprüfungen und getesteten Übergang. Rohlogs, private Registry-
Adressen und Konfiguration fehlen bewusst. Vertrauen entsteht durch das explizit
gewählte Herausgeber-Repository über HTTPS und dessen geprüften Veröffentlichungs-
ablauf. Hashes verbinden eine konsistente Veröffentlichung; eine beigelegte
Prüfsumme ist keine unabhängige Signatur. Kein Nutzercheck deaktiviert native
Merge- oder Abnahmegates des Herausgebers.

`bootstrapper/upgrade-paths.json` mit jedem unterstützten Release pflegen. Nur
explizit ausgeführte aufsteigende Übergänge, Voraussetzungen, geordnete Schritte
und den benannten Kandidaten-Test hinzufügen; verpflichtende Zwischen-Releases
beibehalten. CLI und Offline-Wizard verwenden dieselben Metadaten. Docs exportieren,
englische, deutsche und koreanische Inhalte prüfen, Metadaten-/UI- und Fehler-/
Wiederherstellungstests ausführen und den gezielten Übergang vom bisherigen
öffentlichen Release im bestehenden Kandidaten testen. Vorherige Images stammen
aus öffentlichen Metadaten statt privaten Pins. Ohne passende erfolgreiche
Laufzeitnachweise lehnt der Publisher den Übergang ab; geänderte Metadaten
erzeugen keine Kompatibilität.
