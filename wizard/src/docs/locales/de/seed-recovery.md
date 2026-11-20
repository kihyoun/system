# Konfiguration und Seed wiederherstellen

Die Wiederherstellungseingaben bleiben getrennt: eine
Wizard-Konfigurationssicherung, ein abgeschlossener Harvest-Seed und frisch
geladener System-Quellcode einschließlich seines festgelegten Wizard-Submoduls.
Konfiguration wird nicht in Harvest kopiert, und der Wizard bietet keinen
Download von Dienstdaten an.

Der Wizard importiert wörtliche Shell-Zuweisungen einschließlich einfacher und
doppelter Anführungszeichen, maskierter Metazeichen und Gleichheitszeichen.
Sicherungen erhalten nicht modellierte Laufzeiteinstellungen in
`main.runtimeOptions` / Projekt-`runtimeOptions`, einschließlich Image-Referenzen
und Host-Port-Bindungen. JSON- und ZIP-Exporte enthalten Geheimnisse; schützen Sie
sie wie die laufende Konfiguration. Shell-Ausdrücke, die Expansion oder Ausführung
benötigen, werden abgewiesen; übergeben Sie stattdessen ihre wörtlichen,
aufgelösten Werte. Der ursprüngliche Cube-Kopf und seine strenge Formatprüfung
bleiben unverändert.

## Wiederherstellungsmetadaten begleiten die Konfiguration

Eine gewöhnliche JSON-Sicherung enthält `recovery`; ZIP enthält dasselbe Objekt in
`bootstrapper.json` und `recovery.json` sowie eine kurze Anleitung `RECOVERY.md`.
Das versionierte Format lautet `system-configuration-recovery-v1`. Das repositoryeigene
`wizard/scripts/export-configuration.ts` führt dasselbe Wizard-Modell wie Fetch/Backup aus,
einschließlich der `recoveryObservation` einer authentifizierten Fetch-Antwort, sofern
verfügbar. Vorhandene JSON-/ZIP-Sicherungen ohne diese Einträge bleiben nutzbar.

Die Metadaten halten einen neuen Sicherungszeitpunkt sowie die exakt gespeicherten
Image-Einstellungen für Controller, Wizard, GitLab und Runner fest, einschließlich explizit
nicht festgelegter Werte. Davon getrennt stehen zeitgestempelte authentifizierte
Laufzeitbeobachtungen laufender Container mit unveränderlichen Image-IDs, Repository-
Digests und Quellcodelabels. Ein getrennter/Offline-Export ohne begleitende Beobachtung
meldet unbekannte Laufzeitidentität; er ersetzt nichts durch `latest`, erfindet keinen
Quellcodestand und behauptet nicht, gespeicherte Einstellungen laufend beobachtet zu haben.
In Image-Labels/akzeptierter Auswahl fehlende Quellcode-/Release-Identitäten bleiben
unbekannt. Eine zuvor abgerufene Beobachtung behält ihren eigenen Zeitpunkt und kann
älter als die bearbeitete Konfiguration sein.

Metadaten sind nur Daten. Öffnen wendet ihre Image-, Quellcode-, Seed- oder Speicherfelder
nicht auf die Betriebskonfiguration an. Push importiert vorhandene ENV-Einstellungen und
Projektdateien; beschreibende Metadaten starten keine Migration und wählen keine andere
Laufzeit. Der exakte Cube und alle Laufzeitoptionen bleiben beim Hin- und Rückweg erhalten.
Ein erneuter Export nach Öffnen behält einen Datensatz `importedBackup` bei, der als
`imported-unverified` gekennzeichnet ist und den ursprünglichen Sicherungszeitpunkt sowie
beschreibende Versionsnachweise enthält. Dies sind historische Daten, keine neue Beobachtung. Sie können
weder eine Laufzeit auswählen noch eine behauptete Seed-Übereinstimmung beibehalten.

`recoveryTools.minimumSystemProductVersion` ist `1.0.0`: Verwenden Sie einen akzeptierten
Controller für Wiederherstellungswerkzeuge mit ausdrücklicher Unterstützung für dieses
erweiterte ZIP-Format und den ausgewählten Seed. Ältere Controller können `recovery.json` /
`RECOVERY.md` bei nativer Wiederherstellung zurückweisen. Diese Anforderung ist von den
gespeicherten Laufzeitfestlegungen getrennt: Der Import alter Konfiguration und Export
eines neuen Pakets aktualisieren deren Laufzeit nicht. Beziehen Sie kompatiblen Werkzeug-
Checkout und Controller unabhängig; verwenden Sie nicht blind einen alten gespeicherten
Controller als Wiederherstellungshelfer und ersetzen Sie keine Images in der Konfiguration.

Gewöhnliche reine Konfigurationsexporte leiten weder Seed-Generation noch Manifest aus dem konfigurierten Backupverzeichnis ab.
Jeder reine Konfigurationsexport verlangt ausdrücklich einen passenden vollständigen Seed:
Prüfen Sie vor der Wiederherstellung Generation, Manifest, Zeitstempel und genaues
geharvestetes GitLab-Image. Ein älterer Seed und neuere Konfiguration können inkompatibel sein.
Bewahren Sie Paket und Seed unabhängig auf; keines belegt das Vorhandensein oder die Prüfung des anderen.

Der ausdrücklich gestartete [gemeinsame Sicherungsablauf](COORDINATED_BACKUP.md) erfasst
stabile Konfiguration und führt nativen Harvest unter gemeinsamen Betriebssperren aus.
Seine gewöhnliche Konfigurations-ZIP enthält die Zuordnung zu genau diesem abgeschlossenen Seed.
Es bleiben zwei getrennte Wiederherstellungseingaben; das Herunterladen und unabhängige
Aufbewahren der ZIP ist weiterhin notwendig. Importierte Metadaten belegen keine neue
Seed-Übereinstimmung und autorisieren keine Wiederherstellung.

Für ein dokumentiertes akzeptiertes Produkt-Release rufen Sie dessen
[öffentliche Release-Metadaten](RELEASES.md) ab und laden den exakten Quellcode-Commit mit
festgelegtem Wizard-Submodul. Für eine aus Quellcode gebaute/private Laufzeit bewahren Sie
Quellcode und geprüfte Image-Inhalte unabhängig auf. Laden Sie vor der Wiederherstellung
exakte unveränderliche Referenzen oder geprüfte Archive; eine Referenz ist kein gesichertes
Image. Der nachfolgende native Wiederherstellungsweg für private Wizard-Images kann ein
passendes Image aus der restaurierten Registry laden, dessen Inhalt im passenden Seed
liegen muss. Bauen Sie ein fehlendes unveränderliches privates Image nicht neu und
bezeichnen Sie es anschließend als dasselbe geprüfte Image.

## Arbeitsverzeichnis und Sicherungsziel auswählen

Produktive Arbeitsdaten und Seed-Sicherungsspeicher sind unabhängig. Neue
Installationen verwenden lokale Arbeitsdaten auf der Systemfestplatte; ein
externes Ziel ist nur beim Erstellen oder Lesen einer Sicherung erforderlich.
Speichern Sie die hosteigenen Auswahlwerte in einer Datei mit Modus 0600,
beispielsweise `/etc/system-bootstrapper/persistence.env`:

```sh
PERSISTENCE_MODE=local
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
SEED_MOUNT=/media/bootstrapper-backup
SEED_DIR=/media/bootstrapper-backup/seed
SEED_UUID=REPLACE_WITH_BACKUP_FILESYSTEM_UUID
```

Hängen Sie vor einem Vorgang das tatsächliche vorhandene Sicherungsdateisystem
ein und erstellen Sie sein Verzeichnis `seed`. Die Mount-/UUID-Prüfungen
verhindern, dass eine fehlende externe Festplatte versehentlich durch ein lokales
Verzeichnis ersetzt wird. Wählen Sie bei lokalem produktivem Speicher ein
externes Sicherungsdateisystem, das sich von der Systemfestplatte unterscheidet.
Bisherige Volume-Strukturen dürfen einen getrennten Seed auf ihrem ausgewählten,
aufbewahrten Volume behalten. Das Ziel muss von produktiven Daten getrennt sein;
siehe [Speicherleitfaden](PERSISTENT_VOLUME.md). Normaler Start,
Konfigurationsänderungen und TLS-Erneuerung benötigen dieses Medium nicht. Das
Löschen einer VM mit lokalen Arbeitsdaten löscht diese Daten. Bewahren Sie daher
einen abgeschlossenen externen Seed und die passende Konfiguration auf, bevor
Sie sich auf einen Ersatzhost verlassen.

## Einen abgeschlossenen Wiederherstellungs-Seed erstellen

Installieren Sie die Hostintegration mit `bootstrapper/install-volume-host.sh`,
damit geplante Certbot-Erneuerungen `system-certbot` verwenden. Verwenden Sie für
manuelle Erneuerungen und Erneuerungs-Probeläufe denselben Wrapper, etwa
`system-certbot renew --dry-run`. Er teilt sich eine Dateisystemsperre mit
Harvest. Führen Sie während Harvest keine unverwalteten Certbot-Befehle aus und
ändern Sie den Zertifikatszustand nicht manuell.

Ein ausdrücklicher Harvest-Vorgang startet einen vorübergehenden Helfer aus dem
exakten Controller-Image; normale Controller-/GitLab-Container behalten keine
`/seed`-Bindung. Der Helfer prüft Sicherungsverfügbarkeit, Host-Mount-Identität,
Berechtigungen und freien Speicher, bevor er einen Dienst stilllegt. Er erwirbt
die globale Sperre für produktive Daten unter
`configuration/.storage-operation-lock` und die Erneuerungssperre, stoppt
GitLabs Dienste ausdrücklich mit einer begrenzten längeren runit-Wartezeit,
prüft unabhängig, dass jeder aktivierte Dienst beendet ist, und stoppt dann den
Container. Inspektion, Stilllegen der Dienste und Herunterfahren des Containers
teilen sich ein Zeitbudget von 120 Sekunden. Der endgültige Exit-Code des
Containers muss null sein und Docker darf keine OOM-Beendigung melden. Ein
erzwungenes Herunterfahren wird abgewiesen, statt als konsistente Datenbankkopie
beschrieben zu werden. Während GitLab gestoppt ist, bleibt die authentifizierte
Sync-Status-/Abruf-API verfügbar; Änderungen an Konfiguration und anderen
Steuerungsdaten werden abgewiesen. GitLab-/Registry-Schreibvorgänge sind während
dieser Kaltsicherung nicht verfügbar.

Harvest kopiert `/srv`, `/ssl` und den eingehängten Certbot-Konto-/Erneuerungszustand
in ein neues privates Zwischenverzeichnis. Flüchtige Unix-Sockets, FIFOs und
Geräteknoten werden ausgeschlossen; Dienste erstellen ihre Prozessendpunkte
neu. Ein Manifest zeichnet alle Dateiprüfsummen, Eigentümer, Berechtigungen,
Symlink-Ziele sowie die GitLab-Versions-/Editionsreferenz und die
Image-Inhalts-ID auf. Die zwischengespeicherten Nutzdaten werden geprüft, bevor
`seed/current`, ein atomarer Link auf einen abgeschlossenen
`seed/snapshots/<generation>`, veröffentlicht wird. Frühere Snapshots und alte
`seed/srv`- / `seed/ssl`-Bäume bleiben erhalten. Sie werden nicht automatisch
bereinigt; stellen Sie Platz für den neuen Snapshot bereit. Ein Kopierfehler
lässt den vorherigen abgeschlossenen Snapshot ausgewählt. GitLab wird bei
normalem Abschluss, Fehlern oder behandelter Beendigung fortgesetzt. Falls das
Stoppen eines Dienstes bei noch laufendem Container scheitert, fordert Harvest
alle aktivierten Dienste erneut zum Start auf; das Starten eines bereits
laufenden Containers würde diese Dienste nicht fortsetzen. Ein Remote-Stopp
mit ungewissem Ergebnis darf vor dem Fortsetzen sein begrenztes Zeitlimit
erreichen, damit ein alter Stopp nicht mit dem Neustart konkurrieren kann.
Bei Fehlern gibt Harvest ausschließlich Laufzustand, Exit-Code und OOM-Flag
des Containers aus.

SIGKILL, der Verlust eines Hosts oder ein Stromausfall können keine Bereinigung
ausführen. Eine verbleibende `configuration/.storage-operation-lock`,
Sicherungs-`.operation-lock` oder `.system-bootstrapper-certificate-lock` ist ein
bewusster Nachweis eines unterbrochenen Vorgangs. Prüfen Sie, dass kein
Harvest-/Wiederherstellungs-/Erneuerungsprozess mehr läuft, starten Sie GitLab
bei Bedarf und entfernen Sie vor einem erneuten Versuch ausschließlich die
veraltete Sperre. Erheben Sie kein Zwischenverzeichnis `.harvest-*` zu `current`.

### Aus dem Wizard oder auf dem Host ausführen

Bei verfügbarem Ziel verwendet **Harvest** im authentifizierten Wizard denselben
repositoryeigenen Dispatcher wie `system/harvest.sh`. Alternativ können Sie den
Vorgang aus einem geprüften Host-Checkout mit einem verfügbaren, freigegebenen,
vollständigen Controller-Image ausführen. Ermitteln und dokumentieren Sie seine
tatsächliche Image-Identität und verwenden Sie dann:

```sh
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/seed-operation.sh harvest \
  --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
  --check-only
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/seed-operation.sh harvest \
  --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID
```

`--check-only` prüft die Eingaben, ohne Dienste zu stoppen oder Nutzdaten zu
kopieren. Ein abgeschlossener Vorgang entfernt seinen eigenen Helfer. Trennen
Sie erst danach das Sicherungsmedium. Speichern Sie die entsprechende
**Wizard-Konfigurationssicherung** unabhängig davon; Harvest fügt diese
Konfiguration dem Seed nicht hinzu.

## Einen externen Seed in einer frischen lokalen Installation wiederherstellen

Die Eingaben sind der abgeschlossene Seed, das passende Wizard-`bootstrapper.zip`,
der aufgezeichnete System-Quellcode mit seinem festgelegten Submodul sowie
deklarierte Image-Referenzen oder geprüfte Image-Archive. Das frühere produktive
Datenverzeichnis ist keine Eingabe.

1. Installieren Sie Docker auf dem neuen Ubuntu-Host und checken Sie die
   vorgesehene Quellcoderevision mit festgelegten Submodulen aus. Wählen Sie
   `PERSISTENCE_MODE=local` und ein frisches lokales `PERSISTENT_DIR` oder wählen
   Sie ausdrücklich ein eingehängtes Datenvolume. Hängen Sie das aufbewahrte
   Sicherungsdateisystem ein und setzen Sie dessen `SEED_MOUNT`, `SEED_DIR`
   und erwartete UUID in der privaten Host-Auswahldatei. Starten Sie GitLab noch
   nicht. Bereiten Sie ausschließlich die produktiven Verzeichnisse und die
   Persistenzmarkierung aus dieser Auswahldatei vor:

   ```sh
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash -euc 'set -a; source "$PERSISTENCE_ENV_FILE"; source bootstrapper/storage-env.sh; set +a; exec bash bootstrapper/persistence.sh'
   ```

   Dieser Schritt startet keine Container und benötigt kein Sicherungsmedium.
   Er muss auf einem frischen Ziel vor `--check-only` ausgeführt werden: Diese
   Vorprüfung legt keine Pfade an.
2. Stellen Sie das freigegebene vollständige Controller-Image und das exakte bei
   Harvest aufgezeichnete GitLab-Image bereit. Laden Sie exakte unveränderliche
   Referenzen oder gesondert aufbewahrte geprüfte Image-Archive. Der Neubau aus
   Quellcode ist ein neuer Versuch und kein Ersatz für die aufgezeichneten geprüften
   Image-Inhalte. Ein eigenes veränderliches Tag ist kein wiederherstellbares Artefakt. Behalten Sie unveränderliche
   private Wizard-Registry-Festlegungen bei: Deren Nutzdaten müssen im Seed
   enthalten sein, statt durch einen anderen Build ersetzt zu werden.
3. Wählen Sie wie oben beschrieben einen kompatiblen akzeptierten Controller für Wiederherstellungswerkzeuge;
   er darf vom erhaltenen gespeicherten Laufzeitcontroller abweichen. Bewahren Sie das Konfigurations-ZIP unter einem privaten absoluten Pfad auf
   dem neuen Host auf. Führen Sie den repositoryeigenen
   Host-Wiederherstellungseinstieg mit dem freigegebenen Image aus:

   ```sh
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash bootstrapper/seed-operation.sh restore \
     --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
     --configuration-backup /root/recovery/bootstrapper.zip \
     --check-only
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash bootstrapper/seed-operation.sh restore \
     --image sha256:REPLACE_WITH_ACCEPTED_CONTROLLER_IMAGE_ID \
     --configuration-backup /root/recovery/bootstrapper.zip
   ```

   Die Speicherauswahl gehört zu diesem Host; alte exportierte Arbeitspfade
   dürfen sie nicht überschreiben. Der Helfer prüft den abgeschlossenen Seed
   und das exakte GitLab-Image, dessen Version und Edition, bevor er Dienstdaten
   schreibt. Frische leere Gerüstverzeichnisse und eine ausdrücklich importierte
   Konfiguration sind zulässig; vorhandene produktive GitLab-/TLS-Daten werden
   abgewiesen und nicht überschrieben. Ein beschädigter oder unvollständiger
   Seed wird dadurch nicht zu einer gültigen Wiederherstellungsquelle.
4. Die Wiederherstellung kopiert erst nach der Prüfung. Sie legt vor dem Kopieren
   `gitlab/data/.system-bootstrapper-restore-incomplete` dauerhaft an und entfernt
   die Datei nach Prüfung der wiederhergestellten Nutzdaten dauerhaft. Ein
   Kopierfehler behält diese Sperre bei; der Controller-/GitLab-Start verweigert
   teilweise wiederhergestellten Zustand. Prüfen Sie den fehlgeschlagenen
   Vorgang und bewahren Sie sein Teilziel und die Markierung für die Diagnose
   auf. Nachdem Sie das Ende seines Helfers bestätigt haben, wählen Sie ein
   anderes frisches produktives Verzeichnis und stellen denselben geprüften
   Seed dort wieder her. Der native Einstieg verweigert das Fortsetzen über
   Teildaten; löschen Sie seine Markierung nicht und starten Sie schreibende
   Prozesse nicht manuell.
5. Die Wiederherstellung erhält Eigentümer und Dateimodi des Seeds exakt.
   Ältere Snapshots können ein SSL-Wurzelverzeichnis mit Modus `0700` enthalten,
   was NGINX-Worker am Ausliefern von HTTP-01-Challenges hindert. Wiederholen Sie
   vor dem Start schreibender Prozesse oder der Zertifikatserneuerung den nativen
   Vorbereitungsbefehl aus Schritt 1. Er bereitet das öffentliche
   Challenge-Verzeichnis vor und ergänzt die Durchquerungsberechtigung des
   SSL-Wurzelverzeichnisses, während private Zertifikatsverzeichnisse und
   Schlüsseldateien unverändert bleiben. Der aufbewahrte Seed bleibt
   unverändert. Installieren Sie Certbot bei Bedarf und führen Sie
   `sudo bash bootstrapper/install-volume-host.sh` aus. Dies bindet
   Webroot-Erneuerungspfade an das neue produktive Verzeichnis und installiert
   die Erneuerungs-/Deploy-Integration. Setzen Sie die erforderlichen
   Image-Auswahlwerte und starten Sie dann mit `sudo bash start.sh`.
   Stellen Sie optionale Review-/Beta-Helfer ausdrücklich erneut bereit, falls
   ihr altes unveränderliches Image fehlt; siehe
   [Umgebungsverfahren](../project-bootstrap/wizard-environments/README.md).
   Runner-Manager und Arbeitsverzeichnisse werden aus Konfiguration und
   wiederhergestelltem GitLab-Zustand neu erstellt; alte Runner-Verzeichnisse
   sind keine erforderlichen Eingaben.
6. Prüfen Sie authentifiziertes Abrufen, Wizard-/GitLab-/Registry-Zugang,
   wiederhergestellte Daten und Runner-CI. Hängen Sie das Sicherungsmedium nach
   Abschluss des Helfers aus und trennen Sie es. Prüfen Sie, dass das Übertragen
   von Konfiguration mit Neustart und die TLS-Erneuerung weiter funktionieren.
   Sie verwenden ausschließlich das neue lokale produktive Verzeichnis.
   Verwenden Sie `sudo system-certbot renew --dry-run`, wenn konfigurierte
   DNS-Einträge und Zertifikatslinien erreichbar sind.

Der Start wendet niemals automatisch einen Seed an. Das bloße Wiederanschließen
eines alten Datenvolumes ist ein gesonderter Wiederverwendungsweg und keine solche
Wiederherstellung aus einer Sicherung in eine frische lokale Installation.

Wenn ein Controller mit einer Speicher- oder Upgrade-Sperre und ohne
Markierung einer unvollständigen Wiederherstellung neu startet, pausiert er vor
dem Start schreibender Prozesse und bleibt für native Wiederherstellung über
`docker exec` verfügbar. Er setzt sich nicht automatisch fort, wenn die Sperre
verschwindet. Starten Sie ihn nach Abschluss der jeweiligen Wiederherstellung
und Bestätigung eines sicheren produktiven Ziels bewusst mit
`sudo docker restart system_bootstrapper_1` neu. Eine unvollständige
Seed-Wiederherstellung erfordert weiterhin wie oben ein anderes frisches Ziel.

### Ein wiederhergestelltes privates Wizard-Image abrufen

Nach dem Start von GitLab stellt `system/ensure-wizard-image.sh` ein fehlendes
unveränderliches Wizard-Image aus der plattformeigenen Registry wieder her.
Es prüft den gespeicherten verwalteten Wizard-Beleg und die
Registry-/Projektidentität, rendert einen ausschließlich für GitLab/Registry
bestimmten Proxy und wartet auf GitLabs internen Bereitschaftsendpunkt. GitLab
erstellt ein Projekt-Deploy-Token ausschließlich mit `read_registry`; Docker
erhält das Passwort über die Standardeingabe und schreibt seine Anmeldung in
ein neues privates temporäres Verzeichnis. Der Helfer ruft den exakten
gespeicherten Digest ab und prüft ihn, widerruft das Token bei Erfolg oder
Fehlschlag und entfernt die temporäre Anmeldung. Alte Docker-Zugangsdaten des
Hosts sind keine Wiederherstellungseingaben. Normaler Start mit öffentlichen
Images und bereits zwischengespeicherte exakte Festlegungen benötigen kein Token.

Das Deploy-Token besitzt als Sicherheitsgrenze GitLabs Ablaufdatum am nächsten
UTC-Tag und wird normalerweise sofort widerrufen. Siehe
[GitLab-Dokumentation zu Deploy-Tokens](https://docs.gitlab.com/api/deploy_tokens/).
Nur Tokens mit dem reservierten Wiederherstellungszweck im exakten Projekt des
Belegs kommen für die Bereinigung infrage. Ein gescheiterter Widerruf behält
`configuration/.wizard-image-recovery.pending` bei; der Start muss diese
Bereinigung abschließen, auch wenn das Image inzwischen zwischengespeichert
wurde. Ein unterbrochener Prozess hinterlässt
`configuration/.wizard-image-recovery.lock`. Entfernen Sie nach Prüfung, dass
der alte Prozess beendet ist, nur diese veraltete Sperre und wiederholen Sie
den Start; behalten Sie die Pending-Datei bei, damit der Helfer den reservierten
Zugang widerrufen kann. Zugangsdatenfehler stoppen den Start vor Wizard und
Projektdiensten, statt ein anderes Image einzusetzen.

## Prüfgrenzen

`tests/seed/recovery-contract.py` prüft die tatsächlichen Shell-Skripte und rsync
mit einem Docker-Testbefehl, einschließlich gescheiterter Kopien, erzwungenem
Herunterfahren, Versionskonflikten, Beschädigungen, fehlenden
Abschlussmarkierungen, aktiven schreibenden Prozessen, Erneuerungssperren und
der dauerhaften Absicherung unterbrochener Kopien. Wizard-Modellregressionen
decken wörtliche Zuweisungen, JSON-/ENV-/ZIP-Äquivalenz und die unveränderliche
Signatur ab.

Das erforderliche [Wegwerf-Plattformszenario](../tests/e2e/README.md) führt
zusätzlich echte GitLab-/Runner-/Registry-CI aus, exportiert die Konfiguration
über das tatsächliche Wizard-Modell, entfernt den ursprünglichen privaten Host
und stellt ausschließlich deklarierte Images aus frischem Quellcode, das
Konfigurations-ZIP und einen abgeschlossenen externen Seed in einem anderen
leeren lokalen Verzeichnis wieder her. Es prüft fehlenden Sicherungsspeicher
und den Ausschluss durch die globale Sperre für produktive Daten, verweigert
nicht leere Wiederherstellungsziele und beschädigte Nutzdaten und trennt dann
Sicherungseinhängungen vor den echten Prüfungen für Konfigurationsübertragung
mit Neustart, Runner-CI und TLS-Erneuerung. Es prüft wiederhergestellte
Dienst-/Datenidentitäten, die Wiederherstellung eines nicht zwischengespeicherten
privaten Wizard-Images und tatsächliches ACME-Konto, Erneuerung und
Bereitstellung über eine lokale Zertifizierungsstelle. Diese Prüfungen bilden
weder die Betriebssysteminstallation einer neuen VM noch die Planung durch
systemd-Timer nach.

Der Weg mit aufbewahrtem Volume über `recover-volume.sh` ist gesondert:
Seine Image-Archive sind explizite Eingaben, während das Szenario mit
Konfiguration und Seed deklarierte eigene Images aus Quellcode neu erstellt.
Keiner der Wege macht einen älteren Seed zu einer passenden Sicherung für eine
neuere Konfiguration. Erfassen Sie kompatible Eingaben und prüfen Sie vor der
Wiederherstellung die vorgesehene GitLab-Image-Identität.
