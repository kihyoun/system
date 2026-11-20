# Container-Kompatibilität und begrenzte Protokolle

## Tatsächlichen Docker-Host vor der Auswahl von MongoDB prüfen

Container teilen Kernel und bereitgestellte CPU-Befehle des Docker-Daemon-Hosts.
Weder der Ubuntu-Release-Name noch die Userspace-Distribution eines Images belegen
Kompatibilität. Führen Sie die Repository-Vorprüfung **auf diesem Linux-x86_64-Host**
aus, bevor Sie ein MongoDB-Image auswählen, den Host-Kernel ändern oder eine
CI-Datenbank aktivieren:

```sh
python3 bootstrapper/container-preflight.py --mongodb-version 8.0.37
# Pull the exact reviewed digest separately, then test its executable as well:
python3 bootstrapper/container-preflight.py --mongodb-version 8.0.37 \
  --image 'docker.io/library/mongo@sha256:REPLACE_WITH_64_HEX_DIGEST'
```

Der JSON-Bericht erfasst `uname`, `/proc/version_signature`, den abgeleiteten
Upstream-Kernel, Architektur und AVX-Sichtbarkeit. Ubuntus ABI-Release, beispielsweise
`7.0.0-30-generic`, unterscheidet sich von der stabilen Upstream-Version,
beispielsweise `7.0.12` in der Signatur. Fehlende oder widersprüchliche
Ubuntu-Signaturen führen zur Ablehnung. Der lokale Socket ist ausdrücklich
festgelegt; ein entfernter Docker-Kontext kann Kernel oder CPU des entfernten
Hosts nicht nachweisen. Bewahren Sie den Bericht mit der ausgewählten
Serverversion, der unveränderlichen Image-Identität und Ihren Betriebsunterlagen
auf. System Bootstrapper stellt selbst kein MongoDB bereit; Anwendungseigentümer
wählen ihre Datenbanken.

Die gepflegten Regeln gelten für MongoDB 7.0, 8.0, 8.3 und 9.0 und unterscheiden:

- Fehlendes AVX auf einer bereitgestellten x86_64-CPU: Hardware und
  CPU-Durchreichung der VM untersuchen.
- Linux-Upstream 6.19 bis 7.0.13 mit MongoDB 8/9: inkompatibles TCMalloc/rseq;
  ältere Images können starten und später abstürzen. Ein erfolgreiches
  `--version` macht diese Kombination nicht sicher. MongoDB 7.0 ist von diesem
  konkreten Kernel-Fehler nicht betroffen.
- Korrigierte Upstream-Kernel mit älterer Server-Startprüfung: die konservativen
  geprüften Mindeststände sind 8.0.37, 8.3.16 und 9.0.4 einschließlich der
  Korrekturen zur Ubuntu-Erkennung.
- Unbekannte Release-Linien, fehlende Kernel-Nachweise, eine abweichende
  Programmversion, ausdrückliche Kernel-Ablehnung durch das Image, unzulässige
  CPU-Befehle, Zeitüberschreitung sowie sonstige Docker-/Programmfehler:
  getrennte Diagnosen statt einer pauschalen Meldung „AVX fehlt“.

Die optionale Image-Prüfung läuft erst nach erfolgreicher Vorprüfung. Sie verwendet
einen zuvor geladenen Digest, `mongod --version`, kein Netzwerk, keine persistenten
Mounts, ein schreibgeschütztes Root-Dateisystem und begrenzte Ressourcen sowie
Laufzeit. Sie startet keine Datenbank, greift nicht auf Anwendungsdaten zu und
ändert keinen Kernel. Sie prüft Programmstart und gemeldete Version; ihr Erfolg
ist **kein** Datenbank-Workload-Test oder vollständiger Herstellersupport-Nachweis.
AVX ist für die CPU-Matrix des Herstellers notwendig, aber nicht hinreichend.

Zur Planung bewertet `--planned-kernel X.Y.Z` einen ausdrücklich angegebenen
künftigen **Upstream**-Kernel mit der aktuellen CPU. Die Image-Prüfung ist dabei
verboten, da das Image weiterhin den aktuellen Kernel verwendet. Erfassen Sie vor
bewusster Kernel-Wartung alle betroffenen Workloads, Versionen und Images, prüfen
Sie den aktuellen Herstellersupport, erstellen Sie passende Konfigurations- und
Datensicherungen, halten Sie Wiederherstellungs-Images unabhängig verfügbar und
planen Sie Wartungsfenster sowie Boot-Wiederherstellung. Wiederholen Sie nach dem
Booten die Vorprüfung auf dem aktuellen Host und die Anwendungsprüfungen, bevor
Sie den Betrieb fortsetzen. Keines dieser Werkzeuge aktualisiert einen Kernel,
startet neu, ändert Serverversionen oder umgeht MongoDBs Sicherheitsprüfung. Eine
Datenbankversionsänderung benötigt ein eigenes unterstütztes Migrations- und
Wiederherstellungsverfahren.

Prüfen Sie die Regeln beim Hinzufügen von Serverlinien oder Ändern der
Kernel-Auswahl anhand aktueller Primärquellen. Grundlage der aktuellen Prüfungen
sind die [MongoDB-Produktionshinweise](https://www.mongodb.com/docs/v8.0/administration/production-notes/),
die [Upstream-Kernel-Kompatibilitätsmatrix](https://jira.mongodb.org/browse/SERVER-125742)
und die [Korrektur der Ubuntu-Kernel-Erkennung](https://jira.mongodb.org/browse/SERVER-131779).
Diese Quellen belegen Kompatibilität; sie sind kein Auftrag, einen laufenden Host
zu aktualisieren.

## Protokollierungskette und Aufbewahrungskonvention

Das äußere System-NGINX leitet öffentliche Anfragen an einen Anwendungsproxy und
Web-/API-Container weiter. Standard-NGINX-Images verknüpfen Zugriffs-/Fehlerprotokolle
mit stdout/stderr; Docker erfasst diese Ströme je Container unabhängig.
NGINXs Haupt-Zugriffsformat kann Remoteadresse, Anfragezeit, Methode und URL mit
Query, Status, Bytezahl, Referrer, User-Agent und weitergereichte Adressen enthalten.
Auch Fehlerprotokolle können Clientadressen und Anfragedetails enthalten. API-Logs
werden von der Anwendung bestimmt und können Kontokennungen oder Anfrageinhalte
erfassen. Vermeiden Sie Geheimnisse, sensible Query-Parameter und unnötige
personenbezogene Daten in Protokollen; Anwendungseigentümer müssen ihr tatsächliches
Image und Format prüfen.

Das Standardbudget für lokale Diagnoseprotokolle ist `json-file`, **10 MiB je
Datei und drei Dateien je Container**. Neue Ausgabe verdrängt bei Erreichen des
Budgets die ältesten Dateien. Die Größen-/Anzahlrichtlinie ergibt ungefähr 30 MiB
zuzüglich Docker-Verwaltungsdaten und Überhang einzelner Protokolleinträge je
Container; sie ist keine Plattenquote. Sie gilt für neu erstellte System-Controller,
Web-, Sync-Proxy-, Wizard- und GitLab-stdout/stderr-Container, die Review-/Beta-/
Production-Proxys der Projekte und Runner-Manager. Verwaltete Wizard-Review-/Beta-
Container verwenden denselben festen Standard. Die generierte React-, Angular-
und Web-Starter-CI wendet ihn auf Smoke-Tests und ausgelieferte App-Container an.

Es gibt **keine garantierte maximale Aufbewahrungsdauer**: Ruhige Container können
alte Einträge unbegrenzt behalten, stark protokollierende Container weniger
Historie. Eine geplante Löschung nach 14 Tagen ist nicht konfiguriert.
Datenschutzhinweise müssen dieses Größen-/Anzahlverhalten und gesondert betriebene
Logsammlung beschreiben. Betreiber, die eine kalendarische Löschfrist benötigen,
müssen zuvor einen geeigneten Protokollierungs-/Sammeldienst einschließlich seiner
Sicherungen konfigurieren und prüfen. Bewerten Sie das Diagnosebudget anhand der
Bedürfnisse jeder Anwendung und der Vorfallbearbeitung neu.

Dockers Dateirotation betrifft nur stdout/stderr. Von Anwendungen geschriebene
Dateien, entfernte Logsammler, Host-Journal, CI-Jobprotokolle und interne
GitLab-Dateien benötigen eigene Aufbewahrungsregeln. Interne GitLab-Protokolle
liegen im gewählten persistenten Verzeichnis und können auch in abgeschlossenen
Seeds erhalten bleiben. Diese Richtlinie löscht weder diese Dateien noch
aufbewahrte Sicherungen. Richten Sie logrotate, `truncate`, `rm` oder einen
Bereinigungsjob niemals auf Docker-verwaltete Protokolldateien. Siehe
[Dockers Treibervertrag](https://docs.docker.com/engine/logging/drivers/json-file/).

## Konfiguration, Auslieferung und Prüfung

Die Compose-Richtlinie ist ausdrücklich festgelegt. Sie ändert weder
`/etc/docker/daemon.json` noch fremde Container. Fügen Sie zum Konfigurieren des
Budgets für Kernkomponenten, Proxys und Runner diese literalen Exporte in die
**vollständige** private Hauptkonfiguration nach ihrer unveränderten Cube-Signatur ein:

```sh
export SYSTEM_LOG_MAX_SIZE='10m'
export SYSTEM_LOG_MAX_FILES='3'
```

Verwenden Sie positive ganzzahlige Größen mit den Einheiten `k`, `m` oder `g`
und eine Dateianzahl von 1 bis 100. Validieren Sie gewünschte Werte vor Anwendung:

```sh
python3 bootstrapper/log-policy.py --max-size 10m --max-files 3
```

Die vorhandenen zusätzlichen Laufzeitoptionen des Wizards erhalten diese Exporte
bei Fetch/Push sowie JSON-/ZIP-Backup/Open. Bewahren Sie eine passende
Konfigurationssicherung getrennt vom Harvest auf. Der Seed erhält GitLab-Projekte,
Variablen und Anwendungsquellcode; Dockers eigenes Daemon-Protokollverzeichnis ist
kein Seed-Eingang. Stellen Sie passende Konfiguration und Seed mit den nativen
Wiederherstellungswerkzeugen wieder her. Kein Protokollierungs-Override hängt von
einem privaten Host-Skript oder einer Daemon-Standardeinstellung ab.

Eigentümer von Starter-Projekten können `APP_LOG_MAX_SIZE` und `APP_LOG_MAX_FILES`
in ihrer generierten `.gitlab-ci.yml` oder konfigurierten GitLab-CI-Variablen ändern.
Diese bleiben projekteigene Einstellungen und werden in GitLab-Dienstdatensicherungen
sowie der Quellhistorie erhalten. Bereits bearbeitbare Pipelines werden nicht
automatisch überschrieben. Wenden Sie bei eigenen APIs, Datenbanken oder
Mehrcontainer-Projekten gleichwertige Optionen ausdrücklich auf **jeden** eigenen
Dienst im Projektquellcode an:

```sh
docker run --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  YOUR_OTHER_REVIEWED_CREATE_OPTIONS YOUR_IMMUTABLE_IMAGE
```

Ein Docker-Neustart, NGINX-Reload oder geänderter Daemon-Standard konfiguriert
bestehende Container nicht nachträglich. Prüfen Sie bei der bewussten gebündelten
Auslieferung die von Compose geplante Neuerstellung betroffener Plattformdienste
sowie deren Ausfall- und Wiederherstellungsanforderungen. Aktualisieren Sie
eigene App-Pipelines getrennt; deren nächstes normales Deployment erstellt nur
die eigenen Container neu. Eine laufende Anwendung mit alten Einstellungen
bleibt bis zur verifizierten Neuerstellung außerhalb der neuen Zusicherung.
Löschen Sie niemals Volumes, Datenbankdateien, Seeds oder Ressourcen anderer
Projekte, um Protokollierungseinstellungen anzuwenden.

Prüfen Sie nach der Auslieferung exakte Containernamen auf dem Daemon-Host und
wiederholen Sie dies nach einem weiteren normalen Deployment. Verwenden Sie die
tatsächlichen Namen Ihrer Auslieferung:

```sh
python3 bootstrapper/log-policy.py system_web_1 system_sync_1
python3 bootstrapper/log-policy.py --max-size 10m --max-files 3 YOUR_APP_CONTAINER
```

Eine Abweichung liefert Exit 1 und zeigt das tatsächliche `HostConfig.LogConfig`.
Nicht verfügbares Docker oder ungültige Eingaben liefern Exit 2. Kein Container
wird verändert. Der Aufruf nur mit Standardwerten zeigt die erwartete Richtlinie
ohne Docker-Zugriff. Geben Sie bei eigenen Kerneinstellungen passende Optionen
an oder exportieren Sie beide `SYSTEM_LOG_*`-Werte. Schreiben Sie keine private
Hauptkonfiguration in einen Diagnosebericht.

Der socketfreie Komponententest lautet `python3 tests/bootstrapper/host-operations.py`.
Bestehende Vorlagen-, Environment-Helper-, Runner- und Konfigurations-Roundtrip-Tests
prüfen zusätzlich die Weitergabe der Richtlinie. Die Kandidaten-Image-Vorbereitung
führt `tests/bootstrapper/log-rotation-docker.js` aus: Zwei verwerfbare
Container-Generationen erzeugen synthetische Daten, prüfen Dockers rotierten
Lesezugriff und lesen ausschließlich Metadaten ihrer eigenen drei begrenzten
Protokolldateien. Die vorhandene native Exporter-/Seed-Wiederherstellungsprüfung
weist nach, dass eigene Protokollierungswerte der Hauptkonfiguration die
Wiederherstellung überstehen. Daraus folgt nicht, dass irgendein bestehender
Production-Container bereits neu erstellt wurde.
