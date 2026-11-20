# Einen Ubuntu-Host vorbereiten

Für einen frischen Ubuntu-24.04- oder 26.04-LTS-amd64-Host wählt die [Schnellinstallation mit einem Befehl](docs/QUICKSTART.md)
ein akzeptiertes öffentliches Release und übergibt an diese nativen Werkzeuge. Sie benötigt
8 GiB RAM, 40 GiB freien Speicher, curl, standardmäßiges Python 3 und Administratorzugriff.
Vorhandene Installationen, DNS/HTTPS und Wiederherstellung nutzen die folgenden expliziten Wege.

## Ein getestetes öffentliches Release installieren

Verwenden Sie für eine Endbenutzerinstallation ein geprüftes **vollständiges Controller**-Image und
das passende Wizard-Web-Image aus öffentlichen Docker-Hub-Repositorys. Der Controller
wird aus `system/Dockerfile` gebaut und enthält Sync und die Lebenszykluswerkzeuge. Die
kleinere Laufzeitbasis aus `bootstrapper/Dockerfile` ist kein startfähiger
Controller und darf nicht an dessen Stelle verwendet werden.

Wählen Sie die exakte System-Quellcodeversion eines Releases und beide unveränderlichen Image-
Referenzen, die jeweils mit `@sha256:...` enden. Die Release-Nachweise des Herausgebers verknüpfen
Quellcodeversion/-baum, festgelegte Wizard-Version und beide Image-IDs mit diesen
Referenzen. Beziehen Sie sie aus den versionierten öffentlichen Metadaten in [GitHub Releases](https://github.com/kihyoun/system/releases),
folgen Sie dem [Release-Prüfverfahren](docs/RELEASES.md), oder verwenden Sie Ihre eigene erfolgreiche Veröffentlichungsausgabe. Ein CI-Job-Artefakt ist nicht automatisch ein öffentlich
zugänglicher Download; machen Sie den ersten Start nicht vom Zugriff auf eine private
GitLab-Instanz abhängig.

Versuchs-Tags wie `sha-<full-System-commit>-job-<candidate-job-id>` und optionale
geschützte Versions-Tags wie `v1.2.3` machen Images auffindbar. Der Kandidatenjob
ist enthalten, weil sein Eigentumslabel den Image-Digest verändert: Ein späterer Build
desselben Commits ist ein separater getesteter Versuch. Ein veröffentlichter Versionsalias wird
niemals einem anderen Versuch zugewiesen. Installieren Sie anhand des aufgezeichneten Digests,
statt anzunehmen, ein Tag einschließlich `latest` sei unveränderlich. Öffentliche Downloads benötigen kein Docker-
Hub-Konto; anonyme Ratenlimits und die Verfügbarkeit von Docker Hub gelten weiterhin.
Das deklarierte öffentliche Release ist für `linux/amd64` vorgesehen; es weist keine ARM64-
Unterstützung für die vollständige Plattform nach.
Kein Image enthält Ihre private Hauptkonfiguration, Dienstdatenbanken oder einen Seed.
Der öffentliche Release-Beleg verknüpft die beiden Projekt-Images; er legt nicht jeden
Drittanbieterdienst fest. Prüfen Sie die nativen GitLab-, Runner- und NGINX-Image-Auswahlen
für Ihre Bereitstellung separat.

Die Host-Vorbereitung installiert weiterhin Docker Engine/Compose aus Ubuntu-/Docker-APT-
Repositorys. Release-Images ersparen Controller-/Wizard-Quellcode-Builds und
Alpine-Paketauflösung auf dem neuen Host; sie beseitigen weder Host-Abhängigkeiten
noch GitLabs Erstinitialisierung oder die Pflicht, Build-Parameter in CI zu pflegen.
Siehe die vollständige [lokale](docs/HANDBOOK.md#0-getting-started) oder
[Domain-/HTTPS-Anleitung](docs/HANDBOOK.md#public-server-own-domain-and-https).

## Host-Abhängigkeiten vorbereiten

Führen Sie das Host-Installationsprogramm aus einem lokalen Checkout unter Ubuntu aus, einschließlich Ubuntu in
WSL2 mit aktiviertem systemd. Es installiert Docker Engine aus Dockers APT-
Repository, Buildx und das Compose-Plugin, startet Docker und führt `hello-world` aus.
Es aktualisiert keine unbeteiligten Betriebssystempakete.

```bash
SYSTEM_REVISION='REPLACE_WITH_40_CHARACTER_RELEASE_COMMIT'
git clone https://github.com/kihyoun/system.git
cd system
git checkout --detach "$SYSTEM_REVISION"
git submodule update --init --recursive
CONTROLLER_RELEASE='docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST'
WIZARD_RELEASE='docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST'
sudo bash bootstrapper/install.sh
```

Das Installationsprogramm stellt einen `docker-compose`-Wrapper für die Orchestrierungsskripte bereit.
Dieser verwendet `docker compose --compatibility`, um die erwarteten,
durch Unterstriche getrennten Containernamen zu erhalten. Dienstkonfiguration, Persistenz und
Plattformabnahme sind separate Schritte.

## Eigene öffentliche Releases veröffentlichen

Belassen Sie Quellcodeentwicklung, Merge-Prüfung und erforderliche Kandidatenprüfungen in GitLab.
Die öffentliche Docker-Hub-Veröffentlichung ist ein Verteilungsschritt nach den maßgeblichen
Prüfungen; sie macht Docker Hub weder zur Entwicklungs- noch zur Production-Steuerungsebene.
Die Veröffentlichung kopiert die exakten freigegebenen vollständigen Controller- und Wizard-Image-
Identitäten, statt nach dem Test ein anderes Image neu zu bauen.

Konfigurieren Sie die CI-Variablen des System-GitLab-Projekts für Ihren Docker-Hub-Namespace:

| Variable | Wert / Handhabung |
| --- | --- |
| `DOCKERHUB_PUBLISH_ENABLED` | Geschützte Variable; `true` aktiviert die öffentliche Release-Veröffentlichung |
| `DOCKERHUB_REPOSITORY` | Geschützte Variable; Ihr öffentliches Controller-Repository, beispielsweise `your-namespace/system` |
| `DOCKERHUB_WIZARD_REPOSITORY` | Geschützte Variable; Ihr öffentliches Wizard-Repository, beispielsweise `your-namespace/wizard` |
| `DOCKERHUB_USER` | Geschützte und maskierte Veröffentlichungsidentität mit Schreibzugriff auf diese Repositorys |
| `DOCKERHUB_TOKEN` | Begrenztes Schreib-Token; geschützt und maskiert, niemals im Quellcode gespeichert |

Erstellen Sie die öffentlichen Repositorys und konfigurieren Sie Regeln für geschützte Standardbranches und Release-Tags,
bevor Sie die Veröffentlichung aktivieren. Machen Sie Veröffentlichungszugangsdaten nicht für
nicht vertrauenswürdigen Merge-Request-Code verfügbar. Der öffentliche Release-Beleg verzeichnet Quellcode- und Image-
Identitäten, keine Zugangsdaten oder Installationsdaten. Teilen Sie diesen Beleg oder dessen
Quellcode-/Digest-Auswahlen über einen öffentlichen Release-Kanal, wenn andere Betreiber
das Release installieren sollen; die Veröffentlichung von Container-Images allein veröffentlicht keine privaten
GitLab-Job-Artefakte.

Beschränken Sie Repository-Schreibzugriffe auf die Veröffentlichungsidentität. Aktivieren Sie, soweit verfügbar,
Docker Hubs repositoryseitige Richtlinie für unveränderliche Tags für die Aliasse `sha-*` und `v*`.
CI führt Veröffentlichungen nacheinander aus und lehnt einen bereits widersprüchlichen Alias ab, aber diese
Prüfung kann den gleichzeitigen Push eines anderen externen Herausgebers nicht atomar ausschließen.
Der aufgezeichnete Digest bleibt anstelle eines Alias maßgeblich für die Installation.

## Container-Host-Kompatibilität und Protokollierung

Führen Sie vor der Auswahl von Datenbank-Images für Anwendungen oder geplanter
Kernel-Wartung die [native Host-Kompatibilitätsprüfung](docs/HOST_OPERATIONS.md) aus.
Container teilen Kernel und CPU des Daemon-Hosts; Ubuntus ABI-Nummer allein reicht
nicht aus. Derselbe Leitfaden beschreibt die begrenzten Docker-Protokollvorgaben,
den Konfigurationssicherungsvertrag und die Prüfung nach bewusster Container-Neuerstellung.

## Lokaler Integrationstest

Wählen Sie kompatible GitLab- und Runner-Releases ausdrücklich aus. Das folgende Beispiel verwendet
GitLab CE 19.5.3 und Runner 19.5.1, festgelegt durch das Sicherheitsrelease-Profil und
die verwerfbare Integrationssuite. Lassen Sie keine neue Hauptversion auf bestehende GitLab-Daten zugreifen, ohne
GitLabs unterstützten Upgrade-Pfad einzuhalten.

Ergänzen Sie für den lokalen Integrationsaufbau diese optionalen Exporte in der vollständigen
privaten Hauptkonfiguration unter `PERSISTENT_DIR/configuration/.docker.env`, bevor
Sie GitLab starten. Erstellen Sie keine unvollständige Hauptkonfiguration, die nur
diese Optionen enthält. Innerhalb des Controllers ist `system/.docker.env` ein Kompatibilitäts-
link auf die gespeicherte Konfiguration; die persistente Kopie hat Vorrang vor
in einem Image eingebetteter Konfiguration:

```bash
export GITLAB_IMAGE=gitlab/gitlab-ce:19.6.1-ce.0@sha256:d3727f8b1a1ee6de44916bb9113f3dc40339dba2d6a6ad6ef331d0f239004056
export GITLAB_RUNNER_IMAGE=gitlab/gitlab-runner:v19.6.0@sha256:fb454a097fd26ea329b0234d6d82b53ae25f672bd625c278eaaee683a00f2507
export GITLAB_SSH_BIND=127.0.0.1:2222
export GITLAB_REGISTRY_BIND=127.0.0.1:5050
```

Verwenden Sie `gitlab.localhost`, `registry.localhost`, `sync.localhost` und `localhost`
als GitLab-, Registry-, Sync- bzw. Wizard-Host mit Domain-Modus 0
(HTTP) und passenden externen URLs. Führen Sie `sudo bash bootstrapper/prepare-local.sh` aus,
um die lokalen Hostnamen und die Docker-HTTP-Ausnahme für
`registry.localhost:5050` zu ergänzen. Dieser Helfer wird für lokale Tests ausdrücklich aktiviert; Production
sollte ihre konfigurierten Domains und Zertifikate verwenden. Er erhält andere Docker-
Daemon-Einstellungen. Die obigen Port-Überschreibungen gelten für GitLab-SSH und Registry,
nicht für den Web-Listener der Plattform.

Setzen Sie für das verwaltete lokale GitLab die Runner-Anzahl auf 1 und lassen Sie das Token leer:
Der Bootstrapper erstellt den gemeinsamen Pool automatisch oder verwendet ihn erneut. Ein anschließendes Abrufen
lädt sein Runner-Token. Siehe [Handbuch](docs/HANDBOOK.md#2-setting-up-gitlab-runners).
Alternativ erstellen Sie einen Runner in GitLab und übergeben dessen `glrt-`-Authentifizierungs-
token als `GITLAB_RUNNER_TOKEN` mit `GITLAB_RUNNER_SCALE=1`.
Das Registrierungsskript akzeptiert auch alte Registrierungs-Token und prüft
bestehende Registrierungen, statt sie zu duplizieren.

Kopieren Sie `tests/registry/registry-smoke.gitlab-ci.yml` als
`.gitlab-ci.yml` in ein verwerfbares GitLab-Projekt, um den Integrationstest nachzubilden. Er nutzt den
Docker-Socket-Runner dieser Plattform und deckt ein Image für eine einzelne Architektur ohne
Attestierungen ab. Die Testvorlage deaktiviert BuildKit-Attestierungen, da betroffene
Docker-/GitLab-Versionen deren Manifeste mit `blob unknown to registry` ablehnen können.
Siehe die [GitLab-Kompatibilitätsumgehung](https://support.gitlab.com/hc/en-us/articles/29426166749596-Push-to-Container-Registry-Fails-Error-error-from-registry-blob-unknown-to-registry).

Halten Sie Token und erzeugte `.docker.env`-Dateien aus Git heraus. Nutzen Sie die
[verwerfbare Integrationssuite](tests/e2e/README.md) für eine isolierte Plattform-
abnahme, statt Testprojekte gegen erhaltene Benutzerdaten auszuführen.

## Start

Eine Neuinstallation verwendet lokale Arbeitsdaten unter
`/var/lib/system-bootstrapper/platform` auf dem Ubuntu-/WSL-Systemlaufwerk. Weder ein angeschlossenes
Volume noch ein Seed sind erforderlich. Erstellen Sie zur ausdrücklichen Wahl des Aufbaus einen privaten
Host-Selektor:

```bash
sudo install -d -m 0700 /etc/system-bootstrapper
sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<'EOF'
PERSISTENCE_MODE=local
PERSISTENT_MOUNT=/
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
EOF
sudo chmod 0600 /etc/system-bootstrapper/persistence.env
sudo env GITLAB_SSH_BIND=127.0.0.1:2222 GITLAB_REGISTRY_BIND=127.0.0.1:5050 \
  python3 bootstrapper/install-release.py \
  --controller "$CONTROLLER_RELEASE" --wizard "$WIZARD_RELEASE" \
  --persistence-env /etc/system-bootstrapper/persistence.env
```

Verwenden Sie unter WSL das Linux-Dateisystem, kein unter Windows eingebundenes Datenverzeichnis.
Der Start prüft freien Speicherplatz, Berechtigungen und Dateisystemverhalten. Bestehende
`PERSISTENT_MOUNT`-Selektoren ohne Modus behalten ihre Volume-Semantik.
Wählen Sie für ein ausdrückliches Live-Volume `PERSISTENCE_MODE=volume` und dessen tatsächlichen
Einhängepunkt bzw. UUID; fehlt ein ausgewähltes Volume, wird sicher abgebrochen, statt lokale
Ersatzdaten anzulegen. Ein Moduswechsel migriert niemals eine bestehende Installation.
Siehe [Arbeitsdatenspeicher und Backup-Medien](docs/PERSISTENT_VOLUME.md).

Installieren Sie auf HTTPS-Hosts Certbot separat und führen Sie dann
`sudo bash bootstrapper/install-volume-host.sh` für persistenten TLS-Zustand und
Erneuerungsintegration aus. Der lokale Modus benötigt keine zusätzliche Mount-Abhängigkeit. Weder Docker
noch normaler Dienststart oder Zertifikatserneuerung hängen von einem externen Seed-Ziel ab.

`install-release.py` prüft den sauberen Checkout und die festgelegte Wizard-Version
gegen die Identitäten der geladenen öffentlichen Images. Es lehnt eine bestehende Haupt-
konfiguration oder GitLab-Daten ab, statt eine Neuinstallation als Upgrade zu behandeln.
Es verzeichnet nur die beiden Release-Image-Selektoren in der privaten Datei
`configuration/.release-images.env` und ruft den nativen Start mit deaktivierten
Builds auf. Normale spätere Aufrufe von `sudo bash start.sh` verwenden dieses Profil erneut;
ausdrückliche Selektoren in der gespeicherten Hauptkonfiguration haben weiterhin Vorrang. `--install-host`
kann die Docker-Installation ausführen, wenn sie noch nicht erfolgt ist. Dieses
Installationsprogramm stellt keinen Seed wieder her, importiert keine Konfigurations-ZIP und stellt keine Zertifikate aus.

Öffnen Sie bei einer neuen lokalen Installation `http://localhost/` auf dem Host. Der geladene
Bootstrapper startet den Konfigurations-Wizard und den Sync-Proxy. Planen Sie Zeit für
Image-Downloads und Dienststart ein. Lesen Sie die erzeugten Sync-Zugangsdaten der Ersteinrichtung privat aus
`PERSISTENT_DIR/configuration/sync-auth.env` aus, im Controller unter `/state/sync-auth.env`
eingebunden. Die gespeicherte Hauptkonfiguration in `configuration/.docker.env` wird
anschließend geladen und kann `SYNC_USER` und `SYNC_PASS` überschreiben; verwenden Sie diese gespeicherten
Werte, wenn vorhanden. Startprotokolle geben das Passwort nicht aus.

Lassen Sie unter WSL während der Plattformnutzung eine Ubuntu-Shell offen: systemd-Dienste
allein halten die WSL-Instanz nicht am Leben. Siehe
[Microsofts WSL-systemd-Dokumentation](https://learn.microsoft.com/en-us/windows/wsl/systemd).

## Seed-Lebenszyklus

### Vorschläge für die Ersteinrichtung im Wizard

`Synchronize → Fetch` (in der deutschen Oberfläche **Synchronisieren → Abrufen**) fordert zuerst die gespeicherte Konfiguration an. Nur eine fehlende Haupt-
konfiguration (HTTP 404) löst den authentifizierten Endpunkt `GET /config/suggestions` aus. Authentifizierungs- und
andere Serverfehler lösen keine Vermutungen aus.

Vorschläge verwenden, soweit verfügbar, die erzeugten NGINX-Routing-Vorlagen. Fehlende
Diensthostnamen können aus dem Verbindungs-/Serverhostnamen vorgeschlagen werden. Dies
sind ausschließlich Vorschläge: Sie prüfen kein DNS, stellen keine Domains bereit und belegen
nicht, dass HTTPS verfügbar ist. IP-Adressen, Container-IDs im Docker-Stil und die
Platzhalterdomains example.com/org/net werden nicht zum Erfinden von Hostnamen verwendet.
Unbekannte Werte bleiben im Wizard leer. Passwörter und Runner-Token werden
nicht abgeleitet. Der Benutzer muss das Formular vor **Übertragen** vervollständigen und prüfen.

Der Wizard kennzeichnet abgeleitete Werte mit `*` und einem Tooltip, der zur Prüfung
auffordert. Eine gespeicherte Konfiguration hat immer Vorrang, einschließlich Werten, die der
Benutzer möglicherweise ändern möchte. Das Lesen von Vorschlägen erstellt oder ändert niemals eine
Konfiguration, startet keine Dienste und wendet keinen Seed an.

Dadurch bleibt der Konfigurationsablauf (`Open` / `Backup`, `Push` / `Fetch`)
unabhängig vom Ablauf für persistente Daten (`Harvest` / `Seed`).
Die zugehörigen deutschen Konfigurationsaktionen heißen **Öffnen / Sichern** und
**Übertragen / Abrufen**. Konfiguration
wird separat unter `platform/configuration` gespeichert und unter `/state` eingebunden;
Vorschläge selbst speichern oder übernehmen Konfiguration niemals automatisch.

Führen Sie nach dem Kompilieren von Sync `node tests/sync/config-suggestions.js` aus. Der API-Test
`node tests/sync/config-suggestions-api.js` muss in einem verwerfbaren Container laufen: Er
startet einen eigenen Sync-Prozess auf Port 8071 mit einem temporären Konfigurationsbaum.

### Erste GitLab-Administratoranmeldung

Der Benutzername ist `root`. Für eine neue Datenbank erzeugt der Bootstrapper ein eindeutiges
Anfangspasswort oder akzeptiert `GITLAB_INITIAL_ROOT_PASSWORD` mit mindestens 12 Zeichen
aus der vollständigen privaten Hauptkonfiguration unter
`PERSISTENT_DIR/configuration/.docker.env`. Der Controller liest dies über
seinen Kompatibilitätslink `system/.docker.env`; die persistent gespeicherte Konfiguration
hat Vorrang vor in einem Image eingebetteter Konfiguration. Das versionierte Beispiel
enthält bewusst kein gemeinsames Standardpasswort.

Lesen Sie das Passwort nach dem Start lokal aus:

```bash
sudo docker exec system_gitlab_1 cat /etc/gitlab/bootstrapper_initial_root_password
```

Diese für root lesbare Datei liegt im persistenten GitLab-Konfigurationsvolume und
bleibt über Neustarts hinweg erhalten, anders als GitLabs temporäre Anfangspasswortdatei.
Sie ist auch enthalten, wenn die GitLab-Konfiguration mit Harvest in einen Seed aufgenommen wird: Behandeln
Sie diesen Seed als Zugangsdaten enthaltend. Speichern Sie das Passwort privat und ändern Sie es
nach der Anmeldung. Die aufbewahrte Datei verzeichnet das Anfangspasswort, keine späteren Änderungen.
Eine bestehende Datei wird niemals überschrieben und ein bestehendes PostgreSQL-Verzeichnis
ohne diese Datei führt dazu, dass die Erzeugung übersprungen wird. Diese Option setzt
kein bestehendes GitLab-Konto zurück; nutzen Sie stattdessen GitLabs Passwortzurücksetzung.

Sync- und GitLab-Administratorzugangsdaten sind getrennt. Die aufbewahrte Passwort-
datei darf nicht in einem Repository oder Diagnoseprotokoll veröffentlicht werden.

Führen Sie `node tests/gitlab/root-password.js` aus, um das Initialisierungsverhalten
mit temporären Verzeichnissen zu prüfen, ohne eine laufende GitLab-Installation zu berühren.

### Persistenter Zustand

`SEED_DIR` ist ein unabhängig ausgewähltes Backup-Ziel. Seine optionalen Angaben
`SEED_MOUNT`/`SEED_UUID` identifizieren Wechselmedien und werden nur beim
Erstellen oder Lesen eines Seeds geprüft. Der lokale Live-Modus erfordert ein externes Backup-
Dateisystem; der alte Volume-Modus kann einen getrennten Seed auf seinem erhaltenen Volume speichern. Ein vorübergehender Vorgangshelfer bindet dieses Ziel ein;
normale Controller-/GitLab-Container behalten keinen `/seed`-Mount. Harvest
erstellt einen abgeschlossenen Wiederherstellungssnapshot mit Dienstdaten aus `/srv`, TLS-
Dateien aus `/ssl` und vollständigem Certbot-Konto-/Erneuerungszustand. Es stoppt GitLab,
verlangt ein sauberes Ende, prüft ein Prüfsummen-/Eigentumsmanifest und
wählt den neuen Snapshot atomar über `seed/current` aus. Frühere Snapshots bleiben erhalten.

Die Seed-Wiederherstellung erfolgt ausdrücklich; der Start überschreibt Live-Daten nicht automatisch.
Eine Wiederherstellung erfordert neue Live-Dienstdatenverzeichnisse, ein nicht vorhandenes oder gestopptes GitLab,
ein abgeschlossenes Manifest und dieselbe GitLab-Image-Identität. Ein unvollständiger oder
alter unmarkierter Seed wird vor dem Kopieren abgelehnt. Ein fehlender Seed lässt vorhandene Zieldaten unangetastet.
Die Konfiguration bleibt ein separates Wizard-Backup und der Wizard lädt keine
Dienstdaten-Seeds herunter. Siehe [Wiederherstellungsvertrag](docs/RECOVERY_CONTRACT.md) für
Sperren, Fehlerbehandlung und Wiederherstellung auf leerem Speicher.

Die Shell-/rsync-Regressionsprüfung verwendet temporäre Daten und einen Docker-Testbefehl:

```bash
python3 tests/seed/recovery-contract.py
```

Führen Sie die [vollständige verwerfbare Abnahmesuite](tests/e2e/README.md) aus, um echtes
GitLab, Registry, Runner-CI, Konfigurationsexport und TLS-Erneuerung gemeinsam zu prüfen.

## Herunterfahren
```bash
bash stop.sh
```

## Native Host-Laufzeit vorbereiten

Quickstart installiert nvm **0.41.0** aus dem festgelegten Commit mit geprüftem
Skript-Hash und installiert darüber Node **24.22.0**. Die eigene Installation liegt
unter `/opt/system-bootstrapper-runtime`; vorhandene nvm-Installationen,
Standardversionen und Shell-Profile der Benutzer bleiben erhalten. Auch der Hash
des von nvm geladenen Node-Archivs wird geprüft. Kompilierte Operations-Dateien
und Abhängigkeiten stammen aus dem akzeptierten Controller-Image; der dafür
angelegte Container wird nicht gestartet. Ein npm-Installationslauf auf dem Host
ist nicht erforderlich.

Beim manuellen Weg zuerst die nativen Host-Abhängigkeiten installieren, den
geprüften Release-Checkout wählen und die öffentlichen Metadaten verifizieren.
Danach vor dem Release-Installer ausführen:

```sh
sudo python3 bootstrapper/prepare-host-runtime.py \
  --checkout "$PWD" --release-metadata /absolute/path/release.json
```

Ein vorhandenes Laufzeitverzeichnis wird nicht überschrieben. Für Offline-Recovery
müssen das Laufzeitverzeichnis sowie `operations/dist` und
`operations/node_modules` erhalten bleiben. Die Werkzeuge nutzen den gespeicherten
absoluten Node-Pfad ohne nvm, Shell-Profil oder npm-Zugriff. Die Datei
`/opt/system-bootstrapper-runtime/node-executable` enthält diesen Pfad.
