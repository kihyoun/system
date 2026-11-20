# System-Controller-Releases und Laufzeitbasis

Ein öffentliches **Controller-Release** ist das vollständige Image aus
`system/Dockerfile`: Orchestrierungscode, Sync-Dienst, paketierter Wizard-Quellcode
und Laufzeitwerkzeuge. Dazu gehört ein separat gebautes Wizard-Web-Image.
Ein neuer Host kann diese freigegebenen Images laden, ohne Controller- oder
Wizard-Images zu bauen oder ihre Alpine-Build-Pakete aufzulösen. Der bestehende Sync-
Start führt weiterhin seinen vorgeschalteten TypeScript-Build innerhalb des Controllers aus. Siehe
[Release-Installation](../Prepare-Host.md#install-a-tested-public-release).

Die eigenständige **Laufzeitbasis** aus `bootstrapper/Dockerfile` enthält nur die
gemeinsamen Werkzeuge. Sie kann den vollständigen Controller nicht ersetzen, auch wenn ein Basis-
Image in einer Registry veröffentlicht wurde. Beide Images haben nützliche Aufgaben in CI;
nur ein getesteter vollständiger Controller und der passende Wizard bilden das öffentliche Start-
Release.

## Host-Workload-Kompatibilität und Protokollierung

Führen Sie die [native Host-Kompatibilitätsprüfung und den Protokollrichtlinien-Inspektor](../docs/HOST_OPERATIONS.md)
auf dem Docker-Daemon-Host aus, wenn Sie MongoDB-Images auswählen, Kernel-Wartung
planen oder eine bewusste Auslieferung prüfen. Der Leitfaden beschreibt den Vertrag
zur begrenzten Protokollierung, die erhaltene Konfiguration und die Grenzen größenbasierter Aufbewahrung.

## Neuinstallation aus öffentlichen Images

`install-release.py` ist der Host-Einstiegspunkt für eine leere Installation. Es erwartet
`--controller IMAGE@sha256:...` und `--wizard IMAGE@sha256:...` sowie optional
`--persistence-env FILE`. `--install-host` installiert Docker/Compose bei Bedarf über das
versionierte Host-Installationsprogramm. Das [Handbuch](../docs/HANDBOOK.md) beschreibt
vollständige lokale HTTP- und öffentliche Domain-/Certbot-Verfahren mit diesen Optionen.

Das Installationsprogramm prüft den sauberen System-Checkout, die festgelegte Wizard-Version und
die Identitäten der geladenen Images. Es schreibt ausschließlich die Image-Selektoren in die private Datei
`configuration/.release-images.env` und ruft den nativen Start ohne Quellcode-
Build auf. Der normale Start lädt dieses Release-Profil vor einer gespeicherten Haupt-
konfiguration, sodass ausdrückliche spätere Image-Auswahlen in der Hauptkonfiguration Vorrang haben. Das
Profil ist keine importierte Benutzerkonfiguration und wendet keinen Seed an.

Dieser ausschließlich für Neuinstallationen vorgesehene Vorgang lehnt vorhandene GitLab-Daten oder gespeicherte Haupt-
konfiguration ab. Er ersetzt weder die Verfahren zur Wiederherstellung vorhandenen Zustands noch zur Controller-
Freigabe oder GitLab-Migration. Bereiten Sie DNS, Netzwerkzugriff und gegebenenfalls
HTTPS-Zertifikate über den gewählten Handbuchweg vor, bevor Sie eine öffentliche
Instanz zugänglich machen.

## Gemeinsame Laufzeitbasis bauen

Entwickler können die Basis mit dem bestehenden eigenständigen Build-Kontext bauen:

```sh
docker build -t system-runtime:candidate ./bootstrapper
```

Das vollständige System-Image führt ebenfalls `bootstrapper/install-runtime.sh` aus seinem
Repository-Build-Kontext aus. Es beginnt mit demselben offiziellen, per Digest festgelegten Node-
24.22.0-/Alpine-3.24-Image, statt eine separat veröffentlichte System-
Basis zu verlangen. Das gemeinsame Installationsprogramm prüft Node 24.22.0 und npm 11.19.1, bevor es
die festgelegten Versionen Docker CLI 29.9.3-r1, Compose 5.7.2, Buildx 0.38.1, Git 2.54.1-r0
und die bestehenden Shell-Werkzeuge installiert.
Sowohl `docker-compose` als auch `docker compose` bleiben verfügbar. Eigene `IMAGE`-
Überschreibungen müssen dieselben Laufzeitprüfungen erfüllen.

Der Image-Digest legt das ursprüngliche Dateisystem fest; ausdrückliche APK-Paketversionen
legen direkte Werkzeuge fest. Alpine-Repositorys lösen weiterhin transitive Paketaktualisierungen auf,
sodass diese Parameter allein keinen vollständigen Offline-Paketsnapshot bilden. Wird eine APK-Festlegung
nicht mehr verfügbar, schlägt der Build fehl, statt still eine andere
Version zu wählen. Aktualisieren Sie nicht verfügbare direkte Paketversionen anhand des offiziellen Index
für das festgelegte Alpine-Release in einer geprüften Änderung. Aktualisieren Sie Image-Digest und
Node-/npm-Prüfungen gemeinsam, wenn Sie die ursprüngliche Laufzeit ändern, und bauen
und validieren Sie dann den vollständigen Kandidaten neu. Die Veröffentlichung eines freigegebenen Images verlagert diese
Build-Abhängigkeiten in CI; sie macht veraltete APK-Festlegungen nicht für zukünftige
Quellcode-Builds gültig. Pflegen Sie die geprüften Build-Parameter auch dann, wenn die Endbenutzer-
installation ein bereits veröffentlichtes Image verwendet.

Ersetzen Sie keine Bibliotheken innerhalb des historischen Alpine-3.16-Images und kopieren Sie keine glibc-
Node-Binärdateien hinein. Die unterstützte Basis liefert die vollständige Laufzeit.
Ihr Build startet weder die laufende Plattform neu noch verändert er deren Docker-Daemon.
Der Docker-Client kommuniziert nur bei ausdrücklich gewähltem Zugriff mit dem bestehenden
Daemon; eine Versionsprüfung belegt keine Bereitstellungskompatibilität.

Validieren Sie vor der Freigabe die Compose-Konfiguration und Startvertragsprüfungen,
Build-/Lint-/API-/Signaturregressionen und die integrierte Wizard-Quellcodepaketierung.
Live-Neustart-/Wiederherstellungsabnahme und manuelle Production-Freigabe bleiben separate,
koordinierte Aktionen. Erhalten Sie das vorherige funktionierende Image und die privaten Einstellungen.

## Lokale Live-Daten und Seed-Vorgänge bei Bedarf

Ein neuer Start verwendet standardmäßig lokale Arbeitsdaten unter
`/var/lib/system-bootstrapper/platform`. Ein ausdrücklich ausgewählter
`PERSISTENCE_MODE=volume`-Aufbau verlangt weiterhin sein tatsächlich eingebundenes Dateisystem
und fällt niemals auf lokalen Speicher zurück. Alte Selektoren, die einen Live-Mount
ohne Modus deklarieren, behalten diese Volume-Zusage. `PERSISTENCE_MODE`, `PERSISTENT_DIR`
und gegebenenfalls Volume-Einhängepunkt bzw. UUID sind hostseitige Parameter; Änderungen daran migrieren
bestehende Daten nicht. Siehe [Speicheranleitung](../docs/PERSISTENT_VOLUME.md).

Seed-Backup-Speicher ist unabhängig. `SEED_DIR` ist beim normalen
Start optional; `SEED_MOUNT`/`SEED_UUID` identifizieren externe Backup-Medien, wenn ausgewählt.
Controller-/GitLab-Container behalten keine Backup-Mounts. Nur ein ausdrücklicher Harvest-
oder Wiederherstellungsvorgang startet den vorübergehenden Helfer mit exaktem Image. Er prüft Host-Pfade,
Mount-Identität und Speicherplatz vor Schreibzugriffen oder Dienstabschaltung und verwendet die gemeinsamen
Live-Daten-/TLS-Leases. Ein nicht verfügbares Seed-Ziel kann weder zum Rückfall auf das Systemlaufwerk führen
noch normale Dienste und Erneuerung blockieren.

Verwenden Sie für einen abgeschlossenen externen Seed und die passende private Konfigurations-ZIP den
versionierten Host-Einstiegspunkt, bevor schreibende Dienste starten. Bereiten Sie zuerst die leeren Live-
Grundverzeichnisse mit `bootstrapper/persistence.sh` und dem privaten Host-Selektor vor, wie
im [Verfahren für neue Ziele](../docs/RECOVERY_CONTRACT.md#restore-an-external-seed-into-a-fresh-local-installation) gezeigt.
Die schreibgeschützte Vorprüfung verlangt, dass diese Verzeichnisse existieren:

```sh
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/seed-operation.sh restore \
  --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
  --configuration-backup /root/recovery/bootstrapper.zip \
  --check-only
```

Prüfen Sie die Vorprüfung und wiederholen Sie sie dann ohne `--check-only`, um in neue
Live-Dienstdatenverzeichnisse wiederherzustellen. Verwenden Sie `harvest --image ...`, um ein Backup einer
bestehenden Plattform zu erstellen. Der [Wiederherstellungsvertrag](../docs/RECOVERY_CONTRACT.md) nennt
erforderliche Quellcode-/Image-Parameter, Abschluss- und Fehlerschutz, Konfigurations-
trennung und Prüfungen nach der Wiederherstellung. Trennen Sie Backup-Medien nach dem Vorgang;
der normale lokale Betrieb hängt dann nicht mehr davon ab. Das Löschen einer VM mit lokalen Live-
Daten löscht diese Daten, sofern passende Wiederherstellungsdaten nicht andernorts aufbewahrt wurden.

## Geprüfte Initialisierung eines Ersatzhosts

Die Host-Werkzeuge in diesem Verzeichnis gehören zum System-Quellcode. Ändern Sie sie über
einen MR und die maßgeblichen Prüfungen, bevor Sie die neue Version gegen eine
Installation ausführen. Beschaffen Sie zuerst einen geprüften Checkout mit seinen festgelegten Submodulen. Ist das
GitLab der Installation nicht verfügbar, kann ein unabhängig verfügbarer Spiegel oder ein aufbewahrtes
Quellcode-Bundle dieselben geprüften Git-Objekte liefern. Das Werkzeug patcht,
aktualisiert oder klont sich während der Initialisierung niemals selbst.

`initialize.sh` behandelt den Austausch eines Hosts bei Erhalt **aktiver** Dienstdaten.
Es formatiert kein Dateisystem, stellt keine ersten Zertifikate aus, migriert keine GitLab-Versionen,
wendet keinen Seed an und macht aus einem leeren Dateisystem keine bestehende Installation. Folgen Sie
bei einer Neuinstallation dem Erstinstallationsweg im [Handbuch](../docs/HANDBOOK.md).

Erforderlich sind root-Zugriff unter unterstütztem Ubuntu, Git und Python 3, ausgewählter
lokaler oder ausdrücklich volumegestützter Live-Speicher, gespeicherte Konfiguration und das
unten beschriebene Wiederherstellungsmanifest. Ein ausgewähltes Live-Volume muss bereits
eingebunden sein; der lokale Modus verwendet das Systemlaufwerk. Das normale Host-Installationsprogramm liefert
Docker; Certbot wird ebenfalls installiert, wenn
`--install-host` gewählt ist. Instanzselektoren und Zugangsdaten bleiben privat.

```sh
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/initialize.sh \
  --install-host \
  --receipt-dir /var/log/system-bootstrapper/initialize-example \
  --timeout 1200 \
  --renewal-dry-run
```

Wählen Sie für jeden Versuch ein neues Belegverzeichnis. Das Skript lehnt ein vorhandenes
Verzeichnis ab, statt dessen Ausgangszustand vor dem Start zu ersetzen. Ausgangszustände, Status und Protokolle
werden mit privaten Berechtigungen außerhalb des Checkouts erstellt; keines davon ist ein ausführbares Hilfs-
skript. Sie verzeichnen Hashes und Ergebnisse, niemals exportierte Konfiguration oder Zugangsdaten.
Rohe Installations-/Wiederherstellungsprotokolle bleiben privat, weil zugrunde liegende Befehle
vertrauliche Informationen ausgeben können. Ein fehlgeschlagener Durchlauf erhält seine Protokolle und lässt bestehende Daten und
Seed-Snapshots unverändert. Prüfen Sie die gemeldete Phase und korrigieren Sie den geprüften Quellcode oder
Betreiberparameter, bevor Sie ein neues Vorgangsverzeichnis wählen und erneut versuchen.

Alle Host-Speicherprüfungen laufen vor Paket- oder Dienständerungen. Das Skript erfasst
Konfigurations-/Authentifizierungshashes und erhaltene Manager-Identitäten, bereitet optional
ausdrücklich angeforderten Swap vor, installiert Host-Werkzeuge, lädt nur deklarierte Images und lokale
Aliasse, verbindet den volumegestützten Certbot-Zustand und startet den Controller ohne
Neubau. Es bindet Docker-Vorgänge an den Unix-Socket dieses Hosts. Die bestehende
Wiederherstellung aus der privaten Registry des Controllers beschafft dann den exakt gespeicherten Wizard-Digest.

Optionale Optionen sind:

| Option/Parameter | Zweck |
| --- | --- |
| `--swap-gib 8` | Ausdrücklich 8 GiB unter `/swapfile` auf dem Systemlaufwerk reservieren, wenn kein Swap aktiv ist. Eine vorhandene Datei oder zu wenig Platz führen zum Fehler; das Datenvolume wird niemals für Swap verwendet. Standard: keine Swap-Änderung. |
| `--timeout 1200` | Anwendungsabnahme bis zum gewählten Bereitschaftszeitfenster wiederholen, höchstens 3600 Sekunden. Einzelne Netzwerk-/Befehlszeitlimits begrenzen zusätzlich jeden Prüfaufruf. |
| `--gitlab-token-file /root/gitlab-read-api-token` | Ein optionales, vom Betreiber bereitgestelltes administratives API-Token in einer regulären Datei mit Modus 0600. Seine Berechtigungen müssen das Lesen von `/runners/all` und Runner-Managern erlauben. Prüft erhaltene Manager-Identitäten und authentifizierten Kontakt nach Beginn dieses Vorgangs; der Prüfumfang wird unten erläutert. Der Wert wird aus der Datei gelesen und niemals in ein Befehlsargument oder einen Beleg geschrieben. |
| `--redirect-from https://example.com` | Zusätzlich eine permanente Weiterleitung von diesem Ursprung zum konfigurierten öffentlichen Wizard-Ursprung unter Erhalt von Pfad und Abfrage prüfen. Es wird keine kanonische Domain angenommen. |
| `--renewal-dry-run` | Certbots Staging-Erneuerung ohne zufällige Verzögerung durch den installierten Lease-Wrapper ausführen; einen fehlgeschlagenen Deploy-Hook ablehnen und die Abnahme anschließend wiederholen. Erfordert echte konfigurierte Zertifikatslinien, funktionierendes DNS und erreichbare ACME-Endpunkte. |
| `RECOVERY_MANIFEST_SHA256` | Optionaler unabhängig aufbewahrter SHA-256 für `recovery/images.json`, geprüft vor dem Vertrauen in dessen Archiv-/Quellcodedeklarationen. |

Die Laufzeitprüfung untersucht tatsächliche GitLab-Anmeldung/Betriebsbereitschaft und Registry-
Authentifizierung, nicht nur Containerzustand. Sie prüft außerdem den öffentlichen Wizard-Inhalt
gegen den tatsächlichen Wizard-Container, exakte authentifizierte Sync-Fetch-Bytes und Cube,
konfigurierte Dienst-Images, den erhaltenen Daten-Mount und das Bind-Gerät des benannten Volumes jedes Kerndienstes,
Certbot-Zustand/-Timer für HTTPS und die Bereinigung der privaten Image-Wiederherstellung.
Ohne API-Token werden Runner-Container und erhaltene Identitätsdateien geprüft;
das Ergebnis kennzeichnet die GitLab-seitige Prüfung frischen Kontakts ausdrücklich als **nicht geprüft**.

GitLab kann beim Beantworten inaktiver Job-Abfragen einen älteren Kontaktzeitpunkt
beibehalten. Für einen passenden Online-Manager mit älterem Zeitstempel führt die
Prüfung das offizielle `gitlab-runner verify --config /etc/gitlab-runner/config.toml`
in dessen vorhandenem Container aus, begrenzt auf 15 Sekunden innerhalb des
Bereitschaftszeitfensters. Danach werden dieselbe Manager-Identität, der Online-Status
und der Kontaktzeitpunkt erneut gegen die Baseline geprüft. Dies authentifiziert
die erhaltene Konfiguration, ohne einen Runner zu registrieren, die Konfiguration
zu ändern oder einen Job anzulegen. Der Beleg enthält `authenticationProbeCount`
und `jobExecutionChecked=false`; diese Prüfung belegt weder die Aktivität des
laufenden Pollers noch die Job-Ausführung. Echte CI-Ausführung wird im isolierten
Plattformkandidaten geprüft.

Die Prüfung deckt Kerndienste und den konfigurierten Haupt-Runner-Pool ab; individuelle
anwendungsspezifische Abnahme bleibt Aufgabe der jeweiligen Anwendung.

Die Befehle können auch separat ausgeführt werden:

```sh
sudo python3 bootstrapper/verify-runtime.py baseline \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --output /root/pre-start-baseline.json
# Start the retained platform through the committed recovery entry point.
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/recover-volume.sh
sudo python3 bootstrapper/verify-runtime.py check \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --baseline /root/pre-start-baseline.json \
  --output /root/runtime-verification.json --timeout 1200
```

## Ausdrückliches Wiederherstellungsmanifest für Images und Quellcode

Der Archivweg für erhaltene Volumes verwendet private, vom Betreiber vorbereitete Daten unter
`PERSISTENT_DIR/recovery/images.json` und `recovery/images/*.tar.gz`. Prüfsummen
schützen die Konsistenz gegenüber einem unabhängig aufbewahrten Manifest; sie sind keine
Herkunftssignatur des ursprünglichen Herausgebers. Tragen Sie tatsächliche Image-Identitäten, Quellcode-Commit,
Baum, festgelegten Wizard-Gitlink und Aliasse ein, bevor Sie sich auf diesen Wiederherstellungsweg verlassen.
Der normale Vertrag für neue Quellcode-/Seed-Wiederherstellung ist separat.

Das Manifest enthält diese Felder; ersetzen Sie jeden symbolischen Wert durch seine tatsächliche
Identität. Dies ist eine Schemadarstellung, kein ausführungsfertiges Manifest:

```json
{
  "sourceCommit": "<40 lowercase hexadecimal characters>",
  "sourceTree": "<recorded source tree Git object>",
  "wizardSourceRevision": "<Wizard gitlink from that source commit>",
  "archives": [{
    "file": "images/controller.tar.gz",
    "sha256": "<compressed archive SHA-256>",
    "imageId": "sha256:<exact Docker image identity>",
    "sourceCommit": "<same source commit>",
    "sourceTree": "<same source tree>",
    "wizardSourceRevision": "<same pinned Wizard gitlink>"
  }],
  "localImages": [
    {"tag": "system_bootstrapper", "imageId": "sha256:<exact Docker image identity>"},
    {"tag": "controller:retained", "imageId": "sha256:<same exact Docker image identity>"}
  ],
  "publicImages": [{
    "reference": "nginx@sha256:<recorded repository digest>",
    "tag": "nginx:retained",
    "imageId": "sha256:<exact Docker image identity>"
  }],
  "currentController": {
    "reference": "controller:retained",
    "imageId": "sha256:<same controller image identity>",
    "sourceCommit": "<same source commit>",
    "sourceTree": "<same source tree>",
    "productionWizardReference": "registry.example.com/platform/wizard@sha256:<recorded digest>"
  }
}
```

Nehmen Sie auch per Digest festgelegte öffentliche GitLab- und Runner-Einträge mit den Aliasnamen
aus der gespeicherten Konfiguration auf. Optionale archivierte Wizard-Einträge können
`imageRef` für die unveränderliche Production-Referenz deklarieren. `imageId` ist die Identität, die Docker
auf der kompatiblen Ziel-Engine tatsächlich meldet; nehmen Sie nicht an, dass ein OCI-Konfigurationsdigest
mit dessen Manifest-/Index-Digest austauschbar ist. Die Git-Objekte des Quellcodes müssen
lokal verfügbar sein. Ein neuerer geprüfter Host-Werkzeug-Checkout kann einen älteren
aufgezeichneten Controller-Commit validieren; die Quellcode-/Baum-/Gitlink-Deklarationen des Controllers müssen
weiterhin zu dessen exakter archivierter Identität passen.

Vor dem Start lehnt `recover-volume.sh --verify` fehlende Quellcodeidentität,
einen abweichenden Git-Baum/-Gitlink, nicht deklarierte Image-Auswahlen, beschädigte oder ausbrechende Archive,
veränderliche öffentliche Image-Referenzen und doppelte oder nicht abgesicherte Aliasse ab. Die normale Wiederherstellung
lädt jedes deklarierte Archiv, prüft dessen exakte Image-ID und rekonstruiert **alle**
`localImages`-Aliasse, bevor Dienste starten. Sie errät niemals den alten
lokalen Tag einer Instanz. Die gespeicherte Konfiguration wird nicht umgeschrieben, um ein fehlendes Image auszugleichen.
Ein ausgelassener Image-Tag hat Dockers normale Bedeutung `:latest`, sodass der NGINX-Rückfall
`nginx` zu einem deklarierten Alias `nginx:latest` passt. Andere Tags, Repository-Pfade,
Registry-Ports, Digest-Referenzen und exakte Image-ID-Prüfungen bleiben verschieden.

Ein älteres Prüfsummenmanifest mit zwei Listen kann ausdrücklich geprüft werden mit
`python3 bootstrapper/recovery.py verify --directory /path/to/recovery --checksums-only`.
Diese Kompatibilitätsprüfung kann weder Images laden noch Dienste starten; vervollständigen Sie zuerst die Quellcode-
und Alias-Deklarationen über den normalen geprüften Betreiberablauf.

## Öffentlichen Controller bei bereits aktuellen Diensten aktualisieren

Für ein unterstütztes unverändertes offizielles Release `upgrade-release.py` mit dem
[öffentlichen Upgrade-Leitfaden](../docs/RELEASES.md#upgrade-and-rollback) verwenden.
Der Befehl lädt öffentliche Nachweise, prüft den genauen Übergang, koordiniert
eine passende Sicherung und verlangt vor dem Paar-Updater den geprüften Plan-SHA-256.
Nur das API-Token der eigenen Installation ist nötig. Status und Wiederherstellung
verwenden denselben gespeicherten Planpfad; eine Veröffentlichung startet kein Upgrade.

Verwenden Sie `update-controller.py`, wenn eine bestehende öffentliche Release-Installation bereits
die vom aktuellen Sicherheitsprofil freigegebenen GitLab- und Runner-Images ausführt und
**kein Archivmanifest `recovery/images.json` besitzt**. Dieser ausdrückliche Weg lehnt ein
bestehendes Manifest einschließlich eines ins Leere zeigenden Links ab; er erfindet oder ersetzt
niemals eines. Eine archivgestützte Installation verwendet den nachfolgenden Nachfolgerablauf.

Standardmäßig ändert die Aktualisierung nur `BOOTSTRAPPER_IMAGE` in der gespeicherten Haupt-
konfiguration.
Sie erhält exakte GitLab-, Runner-, NGINX- und Wizard-Image-Identitäten, Manager-
Identitäten, Speicherauswahl, Dienstdaten und Seed. Insbesondere bleibt ein bestehender
privater Wizard-Selektor ausgewählt: Die Veröffentlichung eines öffentlichen Controller-/Wizard-
Paars ersetzt diesen konfigurierten Wizard nicht. GitLab muss bereits dem freigegebenen
**Ziel**-Image bzw. der Zielversion des Kandidaten entsprechen und Runner-Images müssen zu dessen
freigegebenen Zielnachweisen passen. Dies ist eine Controller-Aktualisierung ohne Datenbank-
migration, Seed-Vorgang oder Neubau.

Bereiten Sie einen sauberen Checkout der freigegebenen geschützten Standardbranch-Version,
die privaten eingefrorenen Nachfolgerdateien `release.json` und `candidate-results.json` sowie den
exakten öffentlichen Controller-Digest aus der freigegebenen Veröffentlichung oder einer anderen
unabhängig geprüften Release-Aufzeichnung vor. Bewahren Sie eine private API-Token-Datei mit Zugriff
auf Pipeline/Artefakte des Quellprojekts und administrativem `read_api`-Zugriff
auf aktuelle Runner-Manager auf. Das Werkzeug prüft erforderliche erfolgreiche Jobs,
aktivierte Merge-Schranke, geschützten aktuellen Standardbranch-Stand und bytegleiche CI-
Artefakte mit denselben Nachfolgernachweisprüfungen wie bei der Freigabe. Es lädt den
öffentlichen Digest und verlangt zusätzlich exakte freigegebene Controller-Image-ID,
Quellcodelabel und Kandidatenjoblabel. Das öffentliche Wizard-Image wird nur geladen,
wenn die unten beschriebene ausdrückliche Paaroption gewählt ist.

```sh
sudo python3 bootstrapper/update-controller.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/accepted-release/release.json \
  --evidence /root/accepted-release/candidate-results.json \
  --controller docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/private-gitlab-api-token \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/example \
  --check-only
```

Ersetzen Sie Pfade/Domains durch Ihre Parameter und wählen Sie ein neues Checkpoint-Verzeichnis
unter Ihrem aktiven `PERSISTENT_DIR/recovery/controller-updates`. `--check-only` kann
das freigegebene Image laden und auf aktuelle Manager-Kontakte warten, schreibt aber
keinen Checkpoint und keine Konfiguration und stoppt keine Dienste. Führen Sie denselben Befehl ohne
`--check-only` aus, um zu aktualisieren. `--timeout` begrenzt jede Bereitschaftswartezeit auf 60–3600 Sekunden,
Standard 1200. Nutzen Sie `--redirect-from https://example.com`, wenn die derzeit gespeicherte
Konfiguration diesen kanonischen Wizard-Alias bereits verlangt.

Bevor der alte Controller stoppt, erhält das Werkzeug dessen exakten Image-Selektor/-ID,
Neustartrichtlinie, private Originalkonfiguration und Laufzeitausgangszustand. Gemeinsame
Live-Zustands-, Zertifikats- und Umgebungs-Leases sowie der Host-Befehlswächter schützen
den Übergang. Sync muss eine leere Vorgangswarteschlange nachweisen. Im Standardmodus
wird nur der Controller über natives Compose mit deaktivierten Builds und Downloads neu erstellt. Die Abnahme
prüft exakte Dienst-Images und Mounts, unveränderte Konfiguration abgesehen vom
Controller-Selektor, authentifizierten Sync-Fetch, vertrauenswürdiges Anwendungsrouting,
Erneuerungsintegration und kürzlichen GitLab-Kontakt jedes aktuellen Runner-Managers.
Die privaten Dateien `operation.json`, `baseline-after.json` und `verification.json` verknüpfen
den bereitgestellten Controller mit freigegebenem Quellcode, Image und Kandidatenjob und
berichten die Erhaltung anderer Dienst-Images separat.

Nutzen Sie für eine spätere Konfigurationsänderung wie die Aktivierung von Wizard-Aliassen den normalen
validierten Konfigurationsablauf mit **Synchronisieren → Übertragen** nach dieser Aktualisierung. Bewahren Sie dessen separaten
Konfigurationscheckpoint auf. Das Aktualisierungswerkzeug verbindet keine beliebigen
Konfigurationsänderungen mit dem Controller-Austausch. Seine private Datei `main-after.env`
erhält die exakte Konfiguration nach der Aktualisierung für diesen späteren Abgleich.

Prüfen Sie eine unterbrochene oder abgeschlossene Aktualisierung oder rollen Sie sie mit demselben Checkout zurück:

```sh
sudo python3 bootstrapper/update-controller.py --operation status \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/example
sudo python3 bootstrapper/update-controller.py --operation rollback \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/example \
  --token-file /root/private-gitlab-api-token
```

Rollback benötigt das aufbewahrte vorherige Image und eine Prüfung aktueller Manager,
aber keine erreichbare CI-API. Es übernimmt nur die exakt unterbrochene Lease,
nachdem Koordinator und geschützte Befehle beendet sind, stellt vorherigen
Controller und Konfiguration wieder her und prüft Betriebsbereitschaft, ohne Dienstdaten zurückzusetzen.
Es behandelt auch eine fehlgeschlagene Compose-Neuerstellung, die den alten Container vor
Erstellung seines Ersatzes entfernt hat. Geänderte Dienst-Image-IDs oder spätere Konfigurationsänderungen
blockieren Rollback. Gleichen Sie spätere Konfigurationsänderungen vor einem erneuten Versuch über den normalen
validierten Konfigurationsablauf und dessen separaten Checkpoint ab;
das Werkzeug verwirft niemals Änderungen anderer Personen. Ein unklarer Fehler erhält die
zugehörigen Leases und privaten Belege für dieselbe native Rollback-Aktion. Bewahren Sie
Checkpoint und beide Images auf, bis die freigegebene Version nicht mehr
für Wiederherstellung benötigt wird.

### Freigegebenen Controller und Wizard bewusst gemeinsam aktualisieren

Ergänzen Sie `--wizard docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST`
im Aktualisierungsbefehl, um das vollständige freigegebene System-Release auszuwählen. Verwenden Sie diese
Option sowohl bei `--check-only` als auch bei der anschließenden Aktualisierung mit denselben Parametern.
Der Wizard muss aktiviert sein. Dies ist ein Wartungsvorgang mit möglicher
Ausfallzeit der Verwaltungsoberfläche; er verwendet gemeinsame Leases und nativen Start.
GitLab- und Runner-Images müssen wie beim reinen Controller-Weg bereits aktuell sein.

Der Paarmodus verlangt die exakte geschützte System-Standardbranch-**Push**-
Pipeline. Alle normalen internen Prüfungen und der erforderliche Job `test:wizard-browser`
müssen für exakt diesen Quellcode und diese Pipeline erfolgreich sein. Der Browserjob führt die
vollständige native Playwright-Suite des Wizards gegen dessen vorbereiteten Quellcode aus.
Sein erforderlicher erfolgreicher
Job `deploy:dockerhub` muss `test-results/dockerhub/release.json` liefern und damit
beide öffentlichen Digests an denselben freigegebenen Kandidatenjob, Quellcodebaum und Wizard-
Gitlink binden. Die eingefrorenen Nachfolgernachweise müssen das Wizard-Image identifizieren, das
im Registry-Repository `successor-wizard` dieses System-Projekts veröffentlicht wurde. Beide öffentlichen
Images werden vor der Wartung geladen und auf exakte Image-IDs,
Quellcodeversionen und Kandidatenjoblabels geprüft; der Wizard trägt außerdem die System-
Quellcodeversion. Öffentliche und private Veröffentlichungsdigests müssen übereinstimmen.

Öffentliche Quellcodeverfügbarkeit ist für diesen Modus erforderlich. Der Job `deploy:github`
derselben Pipeline muss erfolgreich sein und
`test-results/github/wizard-source.json` aufbewahren. Dieser Beleg muss den exakten
Wizard-Gitlink auf `refs/heads/system-release/<wizard-revision>` im öffentlichen
Wizard-Repository identifizieren, das die freigegebene System-Datei `.gitmodules` nennt. Die Prüfung
liest diese Zuordnung aus authentifiziertem GitLab-Quellcode der freigegebenen Version.
Ein optionaler Spiegelfehler behält sein bestehendes Verhalten bei reinen Controller-
Aktualisierungen; er kann kein gepaartes öffentliches Release autorisieren.

Ein gepaartes System-Release kann einen aufbewahrten Wizard-Abhängigkeitsbranch prüfen und festlegen,
ohne den Standardbranch des Wizards zu ändern. Halten Sie dessen Quellcode- und öffentliche Release-
Referenzen für neue rekursive Checkouts verfügbar. Dies ist die Herkunftszuordnung des System-Releases.
Es erzeugt keine nativen Wizard-Pipeline-Nachweise, bindet kein Projekt ein
und verändert weder die kanonische Quellprimärbindung noch das genehmigte CI-Manifest. Der
normale Production-Befehl des quellenprimären Wizards verlangt weiterhin seine eigenen
erfolgreichen aktuellen Standardbranch-Push- und Liefernachweise.

Der gemeinsame Checkpoint erhält beide vorherigen Image-Selektoren und IDs sowie die
exakte Originalkonfiguration. Nur `BOOTSTRAPPER_IMAGE` und `WIZARD_IMAGE` dürfen
sich ändern; Cube, Belege verwalteter Projekte, andere Einstellungen, andere Dienst-Images,
Manager-Identitäten, Speicher und Seed werden weiterhin gegen den Ausgangszustand geprüft.
Der native Start des freigegebenen Controllers gleicht den ausgewählten Wizard ab. Halten Sie
beide vorherigen Images verfügbar. Dieselben obigen Befehle `status` und `rollback`
prüfen oder restaurieren das Paar, ohne eine CI-API zu benötigen oder Dienstdaten zurückzusetzen.
Ein unbeteiligtes Wizard-Image, nicht verfügbares aufbewahrtes Image, geänderte Konfiguration oder
unklare Containersuche blockiert Rollback. Eine nachgewiesene unterbrochene Entfernung des
Controllers oder Wizards wird durch native Neuerstellung unter der zugehörigen Lease behandelt.

Übergeben Sie für ein versioniertes öffentliches Release außerdem
`--release-metadata /root/accepted-release/system-release-vX.Y.Z.json` sowohl an
Vorprüfung als auch Aktualisierung. Beziehen Sie Metadaten und Prüfsumme aus dem ausgewählten
[public release](../docs/RELEASES.md). Diese Option verlangt `--wizard` und bindet
Produktversion, Quellbaum, Wizard-Gitlink, beide Images, Kandidatenjob und
Nachweishash an den unabhängig geprüften freigegebenen Versuch. Sie aktualisiert die
private Auswahl in `.release-images.json` und `.release-images.env`, die bei der ersten
Einrichtung von Entwicklungsvorschauen verwendet wird. Sie führt das Neuinstallationsprogramm
nicht auf vorhandenen Daten aus. Ohne diese Option bleiben die vorhandenen Release-Auswahldateien unverändert.

Derselbe Aktualisierungscheckpoint erhält die exakten vorherigen Auswahlbytes und Datei-
Metadaten, die geprüften öffentlichen Metadaten und die neue Auswahl. Jede Auswahldatei
wird unter der Wartungslease atomar ersetzt. Rollback stellt die
vorherigen Dateien einschließlich ihrer ursprünglichen Abwesenheit wieder her und akzeptiert eine unterbrochene
Ersetzung, die nur die exakt bekannten alten/neuen Dateien enthält. Unbeteiligte Auswahl-
änderungen oder geänderte Checkpoint-Inhalte blockieren Rollback, bevor Dienste gestoppt werden.
Bewahren Sie diese Belege zusammen mit Checkpoint und beiden Images auf.

Wählen Sie für unabhängige Laufzeitprüfungen dieses Installationstyps den ausdrücklichen
Modus für öffentliche Images sowohl für Ausgangszustand als auch Prüfung:

```sh
sudo python3 bootstrapper/verify-runtime.py baseline --public-images \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --output /root/public-runtime-baseline.json
sudo python3 bootstrapper/verify-runtime.py check --public-images \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --baseline /root/public-runtime-baseline.json --output /root/public-runtime-check.json \
  --gitlab-token-file /root/private-gitlab-api-token --timeout 1200 \
  --redirect-from https://example.com
```

Übergeben Sie die Weiterleitungsoption nur für einen konfigurierten Alias. Ausgangszustände binden die gespeicherte
Konfiguration, ausgewählte Image-Identitäten und Manager-Identitäten; erfassen Sie nach einer
beabsichtigten Konfigurationsänderung einen neuen. Docker Hubs optionales Präfix `docker.io/`
wird für die Digest-Prüfung normalisiert; private Registry-Namen und Ports
bleiben exakt. Dieser Modus macht weder Image-Archive, private Registry-Nutzdaten
noch die passenden Konfigurations-plus-Seed-Wiederherstellungsdaten entbehrlich.

### Einen bereits gestoppten Controller reparieren

Verwenden Sie `--repair-stopped-controller` nur, wenn ein Fehler beim Start des
Controllers die gewöhnliche Aktualisierung aus einem funktionsfähigen Zustand
verhindert. Dieser ausdrückliche Modus erfordert dasselbe freigegebene
Controller-/Wizard-Paar sowie `--wizard` und `--release-metadata`. Er lockert
weder die Prüfung von Quellcode, CI, Veröffentlichung, Images oder Speicher noch
migriert er GitLab, wendet einen Seed an oder verwirft ausstehende Projektbelege.

Der exakte kanonische Controller muss mit seinem ausgewählten Image und seinen
Einbindungen noch vorhanden sein. Er muss regulär mit einem Fehlerstatus ungleich
null und unter 128 beendet worden sein, ohne aktive PID oder Exec-Sitzungen,
ohne OOM und mit der Neustartrichtlinie `no`. Ein nie gestarteter Controller,
der beim Rollback dieses Modus im gestoppten Zustand erhalten wurde, wird
ebenfalls akzeptiert. Laufende, pausierte, neu startende oder fehlende Container
sowie Container mit unklarer Eigentumszuordnung werden abgelehnt. GitLab, der
Eingangsproxy, der aktivierte Wizard-Container und alle ausgewählten
Runner-Manager müssen weiterhin mit den erwarteten Images und Einbindungen
laufen. Die öffentlichen GitLab- und Registry-Routen müssen funktionieren.
Nach der Reparatur müssen der öffentliche Wizard und Sync betriebsbereit sein.

Verwenden Sie diese Option nicht, um einen funktionsfähigen Controller zu beenden
oder die Sperren eines noch nicht abgeschlossenen Vorgangs zu entfernen. Prüfen
Sie zuerst den fehlgeschlagenen Controller:

```sh
sudo docker inspect --format '{{json .State}} {{json .HostConfig.RestartPolicy}} {{json .Config.Labels}}' system_bootstrapper_1
```

Bei einer bestätigten fehlgeschlagenen Neustartschleife mit PID null deaktivieren
Sie ausschließlich seine Neustartrichtlinie und stoppen Sie den bereits
beendeten Container. Beenden Sie keinen aktiven Prozess gewaltsam. Klären Sie
alle aktiven oder unterbrochenen Speicher-, Zertifikats-, Image-Wiederherstellungs-
oder Upgrade-Vorgänge über deren jeweiliges Wiederherstellungsverfahren, bevor
Sie fortfahren.

```sh
sudo docker update --restart=no system_bootstrapper_1
sudo docker stop --timeout 30 system_bootstrapper_1
```

Falls der Eingangsproxy fehlt, prüfen Sie die erzeugten Vorlagen und eingebundenen
Fragmente, bevor Sie das Routing wiederherstellen. Sie können neben GitLab und
Registry auch Anwendungsrouten und Aliase enthalten. Verlangen Sie vollständige
erwartete Routen sowie korrekte bestehende Dienstadressen und Zertifikate.
Verwenden Sie das bestehende Live-Verzeichnis und das bereits ausgewählte
NGINX-Image; ersetzen Sie die folgenden Beispiele durch die überprüften Werte.
Validieren Sie die Konfiguration, ohne einen Listener zu starten, und starten
Sie anschließend ausschließlich `web` über die eingecheckte Compose-Definition:

```sh
sudo env PERSISTENT_DIR=/var/lib/system-bootstrapper/platform \
  NGINX_IMAGE=nginx@sha256:REPLACE_WITH_64_HEX_DIGEST \
  docker --host unix:///var/run/docker.sock compose --compatibility \
  --env-file /dev/null -p system -f system/docker-compose.yml \
  run --rm --no-deps --pull never web nginx -t
sudo env PERSISTENT_DIR=/var/lib/system-bootstrapper/platform \
  NGINX_IMAGE=nginx@sha256:REPLACE_WITH_64_HEX_DIGEST \
  docker --host unix:///var/run/docker.sock compose --compatibility \
  --env-file /dev/null -p system -f system/docker-compose.yml \
  up --no-deps --no-build --pull never -d web
```

Verwenden Sie für diesen Routing-Schritt weder `up` für das gesamte Projekt noch
`down`, die Entfernung verwaister Container oder eine neue Image-Auswahl. Prüfen
Sie GitLab-HTTPS und die Authentifizierungs-Challenge der Registry mit normaler
Zertifikatsvalidierung. Damit werden nur die tatsächlich in den geprüften
Vorlagen vorhandenen Routen wiederhergestellt; eine abgeschlossene
Plattformwiederherstellung ist damit nicht belegt.

Führen Sie anschließend die Vorabprüfung der freigegebenen Reparatur aus deren
sauberem, geprüftem Checkout aus:

```sh
sudo python3 bootstrapper/update-controller.py \
  --repair-stopped-controller \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/accepted-release/release.json \
  --evidence /root/accepted-release/candidate-results.json \
  --controller docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST \
  --wizard docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST \
  --release-metadata /root/accepted-release/system-release-vX.Y.Z.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/private-gitlab-api-token \
  --checkpoint-dir /var/lib/system-bootstrapper/platform/recovery/controller-updates/repair-example \
  --check-only
```

Die Vorabprüfung prüft die verbliebenen Verwaltungsdienste und weist nach, dass
der alte Controller nicht schreiben kann, statt seine nicht verfügbare Sync-API
nach einer leeren Warteschlange zu fragen. Dieselben Schutzprüfungen für
Identitäten, Vorgänge und Konfiguration werden unter der gemeinsamen
Wartungssperre erneut ausgeführt. Passive Belege ausstehender Projekte bleiben
für die spätere Wiederaufnahme über **Abrufen → Bearbeiten → Speichern** unverändert.

Wiederholen Sie den Aufruf ohne `--check-only` mit denselben freigegebenen
Eingaben. Nur die beiden Release-Image-Selektoren und ihre Release-Metadaten
ändern sich. Der Abschluss erfordert weiterhin die gewöhnliche vollständige
Laufzeitprüfung: authentifiziertes Sync-Abrufen, öffentlicher Wizard und
konfigurierte Aliase, Speicher-/Image-Identitäten, Zertifikatsintegration und
erneuter Kontakt durch jeden aktuellen Runner-Manager.

Die üblichen Befehle `status` und `rollback` verwenden den aufbewahrten
Reparatur-Checkpoint. Ein Reparatur-Rollback stellt die exakte vorherige
Konfiguration und die Release-Selektoren wieder her und erstellt den vorherigen
Controller erneut, **ohne seinen fehlerhaften Code zu starten**. Er meldet einen
Rollback im gestoppten Zustand, keine funktionsfähige Plattform; Wizard/Sync
können weiterhin nicht verfügbar sein. GitLab-Daten werden niemals zurückgesetzt.
Bewahren Sie den Checkpoint, die vorherigen Images und die passende
Seed-/Konfigurationssicherung auf, bis das reparierte Release freigegeben ist.

## Einen getesteten Nachfolger-Controller freigeben

`promote-controller.py` verarbeitet die eingefrorenen Artefakte `release.json` und
`candidate-results.json`, die derselbe erfolgreiche vollständige Kandidaten-
job veröffentlicht hat. Es prüft ihre exakten Bytes über die konfigurierte GitLab-API, den geschützten
Standardbranch und Quellcodebaum/-Gitlink, alle erforderlichen internen Jobs und die exakte
Kandidatenjob-ID. Die konfigurierte erforderliche Merge-Schranke muss aktiviert bleiben. Der einzige
zulässige unbeteiligte Pipelinefehler ist der bestehende optionale öffentliche GitHub-Spiegel-
job; ein interner fehlgeschlagener, fehlender, übersprungener oder fehlertolerierter erforderlicher Job verhindert
die Freigabe. API- und Registry-Zugangsdaten werden aus der privaten Betreiber-Token-
Datei gelesen, niemals aus einem öffentlichen Artefakt.

Bereiten Sie einen unveränderten geprüften Checkout der exakten Quellcodeversion des Artefakts vor und
halten Sie heruntergeladene Daten im Modus 0600. Das Token benötigt Lesezugriff auf Projekt/Artefakte
und das veröffentlichte Registry-Image. Der Befehl lädt zuerst die
veröffentlichte unveränderliche Registry-Referenz über eine neue private temporäre Docker-Anmeldung
und prüft deren exakte Image-ID und Quellcode-/Joblabels. Anschließend verzeichnet er den lokalen
Selektor `system-successor:<source-revision>-job<candidate-job-id>`. Dieser lokale Alias
ist für sich genommen nicht unveränderlich: Freigegebener CI-Nachweis, Image-ID und aufgezeichnete Archiv-
prüfsumme belegen seine Identität. Dadurch kann ein neuer Host den Controller starten,
bevor die eigene GitLab-Registry des Controllers läuft.

```sh
sudo python3 bootstrapper/promote-controller.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/successor/release.json \
  --evidence /root/successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/gitlab-operator-token \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/example \
  --cold-maintenance
```

Nutzen Sie `--check-only` mit denselben Parametern zur Quellcode-/CI-Prüfung ohne Änderung von
Diensten. Die normale Freigabe verlangt eine Sync-API, die Ruhe der Projektvorgänge
meldet. Eine ältere API kann dies nicht durch Auslassen eines Feldes belegen; sie verlangt
`--cold-maintenance`, das ein tatsächliches Wartungsprotokoll ausführt:

1. Native Controller-, Seed-, Zertifikats- und Umgebungs-Leases erwerben; aktuellen
   Controller samt Image und Neustartrichtlinie sowie exakte gespeicherte Konfiguration erhalten.
2. Den zugehörigen öffentlichen Proxy stoppen, automatischen Neustart des alten Controllers deaktivieren und
   dessen Prozesse pausieren. Ausstehende entfernte GitLab-Execs mit endlichem Zeitbudget abarbeiten lassen.
3. GitLab-NGINX-, Workhorse- und Puma-Eingang stoppen. Erst nach bestätigtem
   Stopp dieser Dienste mit der gemeinsamen versionierten GitLab-Vorprüfung nachweisen, dass keine laufenden
   Jobs oder unvollendeten Hintergrundmigrationen verbleiben. Ist ein Job der ersten Prüfung zuvorgekommen,
   alten Eingang/Controller/Proxy fortsetzen, ohne Job oder Datenbank zu stoppen, und
   die Freigabe verschieben.
4. Die zugehörigen erhaltenen Runner-Manager stoppen, GitLabs Dienste sauber stoppen und
   Container-Exit null ohne OOM bestätigen. Den eingefrorenen alten Controller
   ohne ausdrückliches Fortsetzen beenden; seine deaktivierte Neustartrichtlinie verhindert die Rückkehr
   alten Codes. Ein kleiner ausdrücklicher Docker-Test deckt diesen Grundmechanismus ab.
5. Kalten GitLab- und Konfigurationszustand mit dem eigenen `rsync` des freigegebenen Images
   kopieren und prüfen, unter Erhalt von Eigentümerschaft, Berechtigungen und Symlinks. Kopierte Dateien,
   Verzeichnisse und Checkpoint-Veröffentlichung vor dem Fortfahren per fsync synchronisieren.
6. Nur den gespeicherten Controller-Selektor ändern, unter Erhalt von Cube und alter GitLab-
   Image-Einstellung. Den exakt freigegebenen Controller über Compose starten. Sein normaler
   versionierter Start kann Proxy, Wizard und Runner abgleichen. Gespeicherten Fetch,
   Routing, erforderliche Daten-Mounts und erhaltene Manager-Identitäten prüfen, während GitLab weiterhin
   sein altes Image bzw. seine alte Version ausführt. Die geprüfte GitLab-Migration separat durchführen.

Dies ist ein Wartungsvorgang mit Ausfallzeit, kein unterbrechungsfreier Controller-
Austausch. Ein kalter Checkpoint verlangt freien Platz für eine weitere Kopie der GitLab-Daten.
Unklares Abarbeiten, Stoppen, Kopieren oder Starten hinterlässt die exakten zugehörigen Leases und die private
Vorgangsaufzeichnung zur Wiederherstellung; es wird niemals geraten, ob die Datenbank sicher ist.

### Freigegebenen Controller vor der GitLab-Migration ersetzen

Wurde ein Controller erfolgreich vorbereitet, während GitLab noch das alte geprüfte
Image ausführt, beschreibt das Wiederherstellungsmanifest bewusst weiterhin die ursprüngliche archivierte
Generation. Ein neuerer freigegebener Kandidat kann diesen vorbereiteten Controller über
denselben Einstiegspunkt ersetzen, ohne gespeicherte Selektoren oder Wiederherstellungsmanifest zu bearbeiten:

```sh
sudo python3 bootstrapper/promote-controller.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/successor/release.json \
  --evidence /root/successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/gitlab-operator-token \
  --staged-promotion /mnt/bootstrapper-data/platform/recovery/controller-promotions/previous \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/replacement
```

Verwenden Sie `--check-only` mit diesen Parametern, um beide Kandidaten und den aktuellen vorbereiteten
Zustand vor Dienständerungen zu prüfen. Das vorherige Verzeichnis muss eine abgeschlossene native
Freigabeaufzeichnung, deren ursprüngliche gespeicherte Konfiguration und Wiederherstellungsmanifest sowie den
geprüften kalten Checkpoint enthalten, wenn der vorherige Vorgang kalte Wartung nutzte. Das Werkzeug
lädt vorheriges Release und Nachweise erneut aus dessen authentifiziertem Kandidaten-
job, prüft alle erforderlichen Jobs, den geschützten Standardbranch und die aktivierte Merge-Schranke
und dann laufende Containeridentität, Image, Quellcode-/Joblabels, unveränderlichen
Registry-Digest, lokalen Alias und exakte Konfigurationshashes. Der archivierte Quellcode
muss ein Vorfahr des vorbereiteten Quellcodes sein, der wiederum Vorfahr des neuen
Kandidaten sein muss. Altes GitLab-Image und ursprüngliches Wiederherstellungsmanifest müssen exakt bleiben.
Nur dieser abgeschlossene vorherige Kandidat darf historisch sein: Der neue Kandidat muss
weiterhin zum aktuellen geschützten Standardbranch und allen normalen Abnahmeschranken passen.

Der Nachweis liefert eine Image-Deklaration im Speicher für die Host-Validierung; er
veröffentlicht kein Archiv und verändert `recovery/images.json` nicht. Der neue Vorgang erhält
die vorherige Belegidentität und den vorherigen Controller zur Wiederherstellung unterbrochener Vorgänge.
Wenn der vorbereitete Controller die erforderlichen Sync-Ruhefelder meldet,
lassen Sie `--cold-maintenance` weg: Normale native Leases und Leerlaufprüfungen ersetzen ihn ohne
eine weitere vollständige GitLab-/Konfigurationskopie. Das alte GitLab läuft weiter. Ein
unvollendetes Upgrade, eine Migration, abweichende Belege oder geänderte Konfiguration verhindern
den Austausch. Veröffentlichen Sie endgültige Wiederherstellungsdaten erst nach erfolgreicher separater geprüfter GitLab-
Migration über den bestehenden strengen Wiederherstellungsexport-Ablauf.

Kalte Controller-Inventare haben eine separate JSON-Grenze von 128 MiB, geprüft vor
atomarer Veröffentlichung und beim Lesen für Prüfung/Wiederherstellung. Dateien, Eigentümerschaft, Modi und
Symlinks werden erneut geprüft, bevor ein neuer kalter Checkpoint akzeptiert wird. Gewöhnliche private
Betreiberparameter und authentifizierte API-Antworten behalten ihre Grenzen von 8 MiB. Der
GitLab-Migrationshelfer verwendet sein eigenes Checkpoint-Format und eigene Grenzen; der Controller-
Checkpoint ist kein Parameter für dessen Rollback-Aktion.

Prüfen oder brechen Sie einen unterbrochenen Controller-Vorgang mit dem versionierten Einstiegspunkt ab:

```sh
sudo python3 bootstrapper/promote-controller.py --operation status \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/example
sudo python3 bootstrapper/promote-controller.py --operation abort \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/example
```

Abort übernimmt ausschließlich die aufgezeichneten veralteten Leases, wartet zeitlich begrenzte entfernte Befehle ab,
prüft Backup-/aktuelle Konfigurationshashes und das alte GitLab-Image und bestätigt einen
abgeschlossenen kalten Checkpoint, soweit vorhanden. Vor Datenbankabschaltung setzt es die
unveränderte alte Generation fort. Nach einem fehlgeschlagenen Controller-Start kann es den
vorherigen Controller und die Konfiguration auf denselben alten GitLab-Daten wiederherstellen; es setzt
niemals diese Datenbank zurück. Ein geändertes GitLab-Image oder eine abgeschlossene Migration verhindern diesen Weg:
Nutzen Sie stattdessen die geprüfte Datenbankcheckpoint-Wiederherstellung des GitLab-Upgrade-Helfers.
Abgeschlossene Controller-Freigaben werden nicht als unterbrochene Vorgänge behandelt.
Host-Befehle laufen durch den versionierten Wächter `host-child.py`: Er erbt einen
stabilen Dateisystemschutz, verzeichnet PID-/Start-/Prozessgruppenidentität vor Freigabe
einer Worker-Startbarriere und begrenzt und beendet die gesamte zugehörige Befehlsgruppe.
Die Übernahme lehnt lebende Koordinatoren, Wächter oder Worker-Gruppen ab, auch nach einem
SIGKILL des Koordinators. Die Schutzdatei bleibt auf dem Laufwerk und wird niemals gelöscht und neu angelegt,
um eine gehaltene Sperre zu umgehen.

## Nachfolger für den nächsten Host aufzeichnen

Aktualisieren Sie nach erfolgreicher GitLab-Migration die aufbewahrten Wiederherstellungsdaten, bevor Sie
die VM löschen oder auf einen späteren Hostaustausch vertrauen:

```sh
sudo python3 bootstrapper/record-recovery-images.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/successor/release.json \
  --evidence /root/successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/gitlab-operator-token \
  --output /root/successor/recovery-export.json
```

Der Exporter prüft freigegebene CI-/Quellcode-/Image-Identitäten und tatsächliches migriertes
GitLab-Image samt Konfiguration erneut. Er streamt den exakt laufenden Controller mit begrenzter
Docker-Save-Frist in ein eindeutig benanntes gzip-Archiv und validiert dann das vollständige
neue Quellcode-/Image-/Alias-Manifest gegen tatsächliche Dateien, **bevor** er es atomar veröffentlicht.
Er erhält die exakten Bytes des vorherigen Manifests, alte Archive/versionierte Aliasse
sowie bestehende Wizard-Image-Konfiguration und -Archiv. Die kanonische veröffentlichte
Controller-Registry-Referenz bleibt Herkunftsmetadatum; die Wiederherstellung eines neuen Hosts verwendet
den geprüften lokalen Offline-Alias. Die neue öffentliche GitLab-Deklaration entspricht dem
laufenden migrierten Image, sodass Wiederherstellung nicht still die vorherige Version wählen kann.

Ein unterbrochener Export lässt vorherige Daten ausgewählt und erhält jedes abgeschlossene zusätzliche Archiv.
Ein erneuter Versuch erzeugt ein weiteres Vorgangsarchiv, statt es zu überschreiben oder zu löschen.
Löschen Sie den Host erst, wenn Exporter und `recover-volume.sh --verify` erfolgreich sind.

Isolierte Vertragsprüfungen laufen mit `python3 tests/bootstrapper/native-initialization.py` und
`python3 tests/bootstrapper/successor-host-tools.py`. Der ausdrückliche kleine Docker-
Grundmechanismustest ist von der socketfreien Komponentensuite getrennt:
`node tests/bootstrapper/paused-controller-docker.js --allow-local-daemon`.
Er verwendet einen einzigen exakt markierten, begrenzten, verwerfbaren lokalen Container und niemals eine laufende
GitLab-Installation.
