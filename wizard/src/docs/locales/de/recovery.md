## Einen Host ersetzen und dabei sein Datenvolume behalten

Dieser Abschnitt beschreibt ausdrücklich die Wiederverwendung eines vorhandenen
Datenvolumes. Wenn Sie stattdessen einen frischen lokalen Arbeitsspeicher aus einer
externen Sicherung befüllen möchten, verwenden Sie das
[Verfahren zum Wiederherstellen von Konfiguration und Seed](RECOVERY_CONTRACT.md#restore-an-external-seed-into-a-fresh-local-installation).
Eine lokale Standardinstallation behält ihre Arbeitsdaten nicht, wenn die VM
gelöscht wird; führen Sie vorher Harvest auf einen externen Speicher aus und
sichern Sie die dazu passende Konfiguration.

Dieses Verfahren verwendet die aktuellen produktiven Daten einschließlich GitLab,
Konfiguration und Zertifikaten weiter. Es stellt **keinen** älteren Seed wieder her
und aktualisiert auch nicht die gespeicherte GitLab-Version. Behalten Sie das
Volume beim Entfernen der alten VM und stoppen Sie seine schreibenden Prozesse
nach Möglichkeit sauber, bevor Sie es abtrennen. Verwenden Sie stattdessen das
[Verfahren für Konfiguration und Seed](RECOVERY_CONTRACT.md), wenn nur ein
abgeschlossener Seed und eine Konfigurationssicherung vorhanden sind. Ein
Versionswechsel folgt dem gesonderten [Evolutionsverfahren](#5-evolving-a-running-system).

Beschaffen Sie vor Beginn die freigegebene Revision der Host-Werkzeuge, die
aufgezeichneten Quellcode- und Image-Identitäten der Laufzeit, die Dateisystem-UUID,
Mount- und Datenpfade sowie die vollständige gespeicherte Konfiguration. Das
Wiederherstellungsmanifest und die deklarierten Image-Archive müssen bereits nach
dem [Image-Wiederherstellungsverfahren](PERSISTENT_VOLUME.md#replacing-a-vm-while-retaining-live-data)
vorbereitet worden sein. Wählen Sie ausreichend Host-Ressourcen für GitLab und
alle gleichzeitig laufenden Builds oder Wegwerftests. Behalten Sie die
konfigurierten DNS-Namen bei; aktualisieren Sie ihre A/AAAA-Einträge, falls sich
die öffentliche Adresse ändert. Für öffentliches HTTPS müssen die Ports 80 und
443 diesen Host erreichen. Wenden Sie die lokale HTTP-Vorbereitung aus Abschnitt
0.2 nicht auf diese Installation an.

1. Laden Sie auf dem neuen Ubuntu-Host den Quellcode wie in Abschnitt 0.1.
   Wählen Sie eine geprüfte Werkzeugrevision mit dem Initialisierungseinstieg und
   initialisieren Sie ihre exakten Submodule. Ein zuvor veröffentlichter,
   freigegebener Quellcodespiegel oder ein Git-Bundle mit den benötigten Commits
   kann diesen Checkout bereitstellen, solange das plattformeigene GitLab nicht
   verfügbar ist:

   ```bash
   SYSTEM_TOOLS_REVISION=REPLACE_WITH_REVIEWED_TOOLS_COMMIT
   git checkout --detach "$SYSTEM_TOOLS_REVISION"
   git submodule update --init --recursive
   ```

   Ein einfaches Quellcode-ZIP ohne Git-Historie genügt der Commit-/Tree-Prüfung
   des Initialisierungswerkzeugs nicht. Halten Sie den Checkout unverändert. Der
   im Image-Manifest aufgezeichnete Controller-Quellcode kann eine frühere
   freigegebene Revision sein; das Werkzeug prüft dessen Tree und den
   Wizard-Gitlink separat und zeichnet zusätzlich die Revision der Host-Werkzeuge
   auf. Aktualisieren Sie ein Submodul nicht auf seinen neuesten Branch und
   ändern Sie gespeicherte Dienstversionen nicht, um sie den Beispielen für eine
   Neuinstallation anzugleichen.

2. Prüfen Sie `lsblk -f` und hängen Sie das **vorhandene** Dateisystem an seinem
   bisherigen absoluten Mount-Pfad ein. Ersetzen Sie diese Beispielzuweisungen
   durch die Werte Ihrer Installation. Formatieren Sie das angeschlossene Volume
   nicht:

   ```bash
   PERSISTENCE_MODE=volume
   PERSISTENT_MOUNT=/mnt/bootstrapper-data
   PERSISTENT_DIR=/mnt/bootstrapper-data/platform
   SEED_DIR=/mnt/bootstrapper-data/seed
   PERSISTENT_UUID=REPLACE_WITH_EXISTING_UUID
   sudo install -d -m 0755 "$PERSISTENT_MOUNT"
   sudo mount "UUID=$PERSISTENT_UUID" "$PERSISTENT_MOUNT"
   findmnt --mountpoint "$PERSISTENT_MOUNT"
   ```

   Falls es bereits eingehängt ist, prüfen Sie seine UUID und sein Ziel, statt es
   erneut einzuhängen. Erstellen Sie die private Auswahldatei ausschließlich mit
   diesen Speichereinstellungen neu; unabhängige alte Image-Überschreibungen
   könnten die falschen Dienste auswählen:

   ```bash
   sudo install -d -m 0700 /etc/system-bootstrapper
   sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<EOF
   PERSISTENCE_MODE=volume
   PERSISTENT_MOUNT=$PERSISTENT_MOUNT
   PERSISTENT_DIR=$PERSISTENT_DIR
   SEED_DIR=$SEED_DIR
   PERSISTENT_UUID=$PERSISTENT_UUID
   EOF
   sudo chmod 0600 /etc/system-bootstrapper/persistence.env
   ```

3. Prüfen Sie, ob `platform/recovery/images.json` den aufgezeichneten Quellcode,
   die exakten Image-IDs, lokalen Aliase und Archive mit Prüfsummen beschreibt.
   Das vollständige Manifestschema und die Eingabeanforderungen stehen in der
   [Dokumentation des Initialisierungswerkzeugs](../bootstrapper/README.md).
   Fehlende Quellcode-Identitäten oder Aliase sind ein Vorbereitungsfehler und
   keine Erlaubnis, ein anderes Image einzusetzen oder ein privates
   Wiederherstellungsskript auf den Host zu kopieren.

4. Falls die aufbewahrte Konfiguration `GITLAB_SSH_BIND='22'` verwendet, bereiten
   Sie zuerst wie unter [Public 7](#public-7-separate-administrative-and-gitlab-ssh)
   beschrieben die Administration über Port 2222 vor und testen Sie den Zugang
   mit einer neuen Verbindung. Geben Sie anschließend Port 22 des Hosts frei.
   Ein frischer Ubuntu-Host reserviert Port 22 üblicherweise für seinen eigenen
   SSH-Dienst; der Initialisierer verlegt diesen Listener nicht für Sie. Führen
   Sie die Host-/Firewall-Schritte vor der Initialisierung aus und lassen Sie
   den Initialisierer GitLab starten. Die Abgleichbefehle innerhalb des
   Controllers aus Public 7 gelten für eine bereits laufende Installation.
   Behalten Sie die gespeicherte GitLab-Bindung bei, statt die gespeicherte
   Konfiguration auf ein Erstinstallationsbeispiel zurückzusetzen.

   Führen Sie den eingecheckten Initialisierungskoordinator aus diesem geprüften
   Checkout aus:

   ```bash
   sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
     bash bootstrapper/initialize.sh \
       --install-host \
       --receipt-dir /var/log/system-bootstrapper/initialize-REPLACE_WITH_OPERATION_ID \
       --timeout 1200
   ```

   Wählen Sie für jeden Versuch ein neues Belegverzeichnis. `--install-host`
   installiert die dokumentierten Ubuntu-Abhängigkeiten, Docker und Certbot.
   Lassen Sie die Option weg, falls der Host bereits vorbereitet ist. Der
   Koordinator prüft Speicher, Quellcode und Archive, erfasst einen
   Ausgangszustand, lädt die deklarierten Images, installiert die
   Volume-/TLS-Hostintegration, startet die Dienste und prüft ihre tatsächliche
   Anwendungsbereitschaft. Er formatiert niemals ein Dateisystem, stellt keinen
   Seed wieder her und verändert die gespeicherte Konfiguration nicht.

   Für einen kleinen Host mit ausreichend Platz auf der **Root-Festplatte**
   fügen Sie ausdrücklich `--swap-gib 8` hinzu, wenn das Werkzeug Swap anlegen
   soll. Es verweigert den Vorgang bei vorhandener `/swapfile` oder unzureichendem
   freien Speicher; Swap ersetzt nicht den RAM für gleichzeitige Kandidatentests.
   Fügen Sie bei einer aufbewahrten öffentlichen HTTPS-Installation
   `--renewal-dry-run` hinzu, um Certbot über die gemeinsame Erneuerungssperre zu
   testen, ohne den Proxy anzuhalten. Ergänzen Sie
   `--redirect-from https://example.com` nur, wenn dieser Ursprung für die
   Weiterleitung zum öffentlichen Wizard konfiguriert ist.

   Für eine aktuelle Kontaktprüfung der GitLab-Runner-Manager übergeben Sie
   `--gitlab-token-file /root/REPLACE_WITH_PRIVATE_API_TOKEN_FILE`. Die Datei muss
   privat sein (Modus 0600) und ein Token mit dem dokumentierten administrativen
   Zugriff `read_api` enthalten. Dies ist kein Tokenwert auf der Befehlszeile.
   Ohne diese Eingabe kennzeichnet der Beleg die API-Kontaktprüfung als
   übersprungen; laufende Container allein dürfen nicht als Nachweis für online
   erreichbare Manager ausgegeben werden.

5. Prüfen Sie den privaten Vorgangsstatus und den strukturierten Prüfbeleg.
   Die Prüfungen umfassen die unveränderte gespeicherte Konfiguration, exakte
   Dienst-Images und den Cube, die zugrunde liegende persistente Einhängung,
   authentifiziertes Sync-Abrufen, Wizard-/GitLab-/Registry-Routing und die
   konfigurierte Host-TLS-Integration. Fehlende private Wizard-Images werden am
   gespeicherten unveränderlichen Digest über die
   [vorübergehende Registry-Wiederherstellung mit begrenztem Zugriff](RECOVERY_CONTRACT.md#pulling-a-restored-private-wizard-image)
   abgerufen. Veröffentlichen Sie weder die private Konfiguration noch die
   Tokendatei oder Rohprotokolle.

   Um die Laufzeitprüfung gegen den erfassten Ausgangszustand zu wiederholen,
   verwenden Sie denselben eingecheckten Prüfer und ergänzen Sie bei Bedarf die
   optionalen Token-/Weiterleitungsargumente:

   ```bash
   sudo python3 bootstrapper/verify-runtime.py check \
     --persistence-env /etc/system-bootstrapper/persistence.env \
     --baseline /var/log/system-bootstrapper/initialize-REPLACE_WITH_OPERATION_ID/baseline.json \
     --output /var/log/system-bootstrapper/initialize-REPLACE_WITH_OPERATION_ID/recheck.json \
     --timeout 1200
   ```

Wenn ein erforderlicher Einstieg wegen fehlenden Verhaltens scheitert, beheben
Sie dieses Verhalten über einen Merge Request mit den zugehörigen Prüfungen,
bevor Sie die korrigierten Werkzeuge bereitstellen. Bewahren Sie Markierungen
unvollständiger Vorgänge und Belege für die Diagnose auf; umgehen Sie keine
Schutzprüfungen und stellen Sie keinen veralteten Seed wieder her, nur damit ein
Hostwechsel fortgesetzt werden kann.
