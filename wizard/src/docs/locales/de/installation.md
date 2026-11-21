## 0. Erste Schritte

### Schnellinstallation auf einem frischen Ubuntu-Host

Führen Sie auf Ubuntu 24.04 / 26.04 LTS x86_64 mit sudo-Zugriff, curl, Internet,
mindestens 8 GiB RAM, 40 GiB freiem Speicher für Daten plus 1 GiB für Quellcode und
freien Ports 80/443 diesen Befehl im Terminal des Hosts aus:

```bash
curl -fsSL https://github.com/kihyoun/system/releases/latest/download/quickstart.sh | sudo bash
```

Das schlanke Installationsprogramm lädt das getestete öffentliche Release,
bereitet den Host vor und startet den ersten Wizard. Folgen Sie seinen lokalen
Anweisungen für den ersten Zugriff; verwenden Sie bei einem entfernten Host einen
SSH-Tunnel und setzen Sie die Konfiguration anschließend im Browser fort.
Downloads und Dienststart benötigen Zeit. Der Befehl richtet weder öffentliches
DNS/HTTPS ein noch restauriert er einen Seed oder migriert eine vorhandene Installation.
Die [Schnellinstallation](QUICKSTART.md) beschreibt Voraussetzungen, Release-Auswahl
und Fehlerbehandlung, die [öffentlichen Releases](RELEASES.md) die Quellcode-/Image-Prüfung.

Die folgende manuelle lokale Installation bleibt für Ubuntu/WSL2 verfügbar.
Für einen öffentlichen Dienst verwenden Sie den [Domain-und-HTTPS-Weg](#public-server-own-domain-and-https).

Dies ist die Installation mit **lokalem Ubuntu / WSL2 und HTTP**. Betreiben Sie sie auf einem vertrauenswürdigen lokalen
Rechner; stellen Sie diesen unverschlüsselten Aufbau nicht als öffentlichen Dienst bereit. Kubernetes-Erfahrung ist nicht
nötig. Führen Sie Befehle in Ubuntu aus und konfigurieren Sie die Plattform anschließend
im Browser. Wer Ubuntu nativ nutzt, kann die Windows-Installation überspringen.

Der **Bootstrapper** startet und verwaltet die Dienste. Der **Wizard** ist seine
React-Oberfläche. Der **Sync-Dienst** verbindet die Oberfläche mit der Bootstrapper-
Instanz. GitLab, Registry und Runner kommen nach der Konfiguration hinzu.

### 0.1 Ubuntu öffnen und das Projekt auschecken

Öffnen Sie unter Windows eine Ubuntu-WSL2-Konsole. Falls Ubuntu noch nicht installiert ist, führen Sie zuerst
diesen Befehl in PowerShell aus:

```powershell
wsl --install -d Ubuntu
```

Folgen Sie den Installationsschritten und starten Sie Windows bei Aufforderung neu. Öffnen Sie anschließend Ubuntu.
Führen Sie alle weiteren Shell-Befehle in der **Ubuntu-Konsole** statt in PowerShell aus.

Wählen Sie ein getestetes öffentliches Release und notieren Sie dessen exakte System-Quellcodeversion,
vollständigen Controller-Digest und passenden Wizard-Digest aus den vertrauenswürdigen
Release-Nachweisen des Herausgebers. Dies sind Betreiberparameter: Ersetzen Sie die Platzhalter
unten durch die Werte dieses Releases. Öffentliche Docker-Hub-Downloads benötigen kein
Konto. Das deklarierte Release ist für `linux/amd64` vorgesehen.

Installieren Sie Git und checken Sie genau dieses Release einschließlich Wizard-Quellcode aus.
Neue Releases enthalten wizard/ direkt; die folgende Submodulinitialisierung gilt nur
für historische Releases mit gespeichertem Wizard-Gitlink:

```bash
sudo apt-get update
sudo apt-get install -y git
SYSTEM_REVISION='REPLACE_WITH_40_CHARACTER_RELEASE_COMMIT'
git clone https://github.com/kihyoun/system.git
cd system
git checkout --detach "$SYSTEM_REVISION"
git submodule update --init --recursive
CONTROLLER_RELEASE='docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST'
WIZARD_RELEASE='docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST'
```

Die Bildschirmfotos zeigen einen lokalen Aufbau. Die Oberfläche läuft als Container-
Image: Eine Aktualisierung des Git-Checkouts allein aktualisiert dieses Image nicht. Das Release-
Installationsprogramm prüft Quellcode-/Image-Identitäten und lädt die getesteten Images; es
kompiliert weder Controller noch Wizard auf dem neuen Host. Unter
[Auswahl eines öffentlichen Releases](../Prepare-Host.md#install-a-tested-public-release)
finden Sie den Unterschied zwischen einem vollständigen Controller und einer Laufzeitbasis.

### 0.2 Docker und lokale Hostnamen vorbereiten

Installieren Sie die erforderlichen Docker-Werkzeuge:

```bash
sudo node bootstrapper/install.js
```

Das Installationsprogramm installiert Docker und Compose und prüft Docker mit einem Test-
Container. Konfigurieren Sie für den lokalen HTTP-Test außerdem die lokalen Hostnamen und die
HTTP-Ausnahme der Registry:

```bash
sudo node bootstrapper/prepare-local.js
```

WSL kann `/etc/hosts` beim Start neu erzeugen. Falls die Registry oder andere lokale
Hostnamen später nicht mehr aufgelöst werden, wiederholen Sie diesen Vorbereitungsschritt. Er lädt die
Docker-Konfiguration neu, ohne die Container neu zu starten. Die HTTP-Ausnahme
bleibt auf den lokalen Test beschränkt.

Diese Anleitung verwendet HTTP ausschließlich für lokale Tests. Eine öffentlich zugängliche
Instanz benötigt eine eigene Domain und HTTPS-Konfiguration.

Controller und Wizard wurden in der Pipeline des Herausgebers gebaut und getestet.
Ihr Quellcode bleibt in diesem Checkout zur Prüfung und Entwicklung verfügbar;
die Erstinstallation führt weder ihre Dockerfiles aus noch löst sie Alpine-APK-Pakete auf.
Der Build einer geänderten Version bleibt ein separater, geprüfter Entwicklungsvorgang.

### 0.3 Bootstrapper erstmals starten

Bereiten Sie vor nativer Hostinstallation, Start/Stopp, Persistenzprüfung oder
Wiederherstellung die [Host-Laufzeit](../Prepare-Host.md#prepare-the-host-operations-runtime)
vor. Quickstart bereitet Node und operations automatisch vor. Manuelle Quell- und
Ersatzhostwege müssen sie zuerst vorbereiten oder wiederherstellen; `--install-host`
installiert native Host-Abhängigkeiten, nicht die fehlende Betriebslaufzeit.
Halten Sie die geprüfte Node-Installation, `operations/dist` und
`operations/node_modules` vor Wartungsbeginn offline verfügbar.

Neue Ubuntu-/WSL-Installationen verwenden lokale Arbeitsdaten unter
`/var/lib/system-bootstrapper/platform` auf dem Systemlaufwerk. Für den ersten Start sind weder eine zweite Festplatte, ein USB-
Stick, ein Cloud-Volume noch ein Seed-Backup nötig. Speichern Sie WSL-Daten
innerhalb des Linux-Dateisystems statt in einem unter Windows eingebundenen Pfad wie
`/mnt/c`, damit Unix-Eigentumsrechte und Dateisystemverhalten verfügbar sind.

Erstellen Sie einen root-eigenen Speicherselektor, den Release-Installationsprogramm und
Lebenszykluswerkzeuge gemeinsam verwenden. Dieses Beispiel wählt das standardmäßige lokale Arbeitsverzeichnis:

```bash
sudo install -d -m 0700 /etc/system-bootstrapper
sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<'EOF'
PERSISTENCE_MODE=local
PERSISTENT_MOUNT=/
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
EOF
sudo chmod 0600 /etc/system-bootstrapper/persistence.env
```

Der native Lebenszyklus unterstützt auch den standardmäßigen lokalen Speicher ohne Selektor;
diese Anleitung verwendet einen ausdrücklichen Selektor. Bestehende Selektoren mit
`PERSISTENT_MOUNT` und ohne Modus behalten die Volume-Semantik; sie
fallen niemals auf lokalen Speicher zurück, wenn ein erforderliches Volume fehlt. Lesen Sie die
[Persistenzanleitung](PERSISTENT_VOLUME.md), bevor Sie einen bestehenden Aufbau ändern.
Konfigurieren Sie unabhängigen Backup-Speicher, wenn Sie Harvest ausführen oder einen Seed wiederherstellen möchten.
Normalbetrieb und Zertifikatserneuerung benötigen dieses Backup-Medium nicht.

Führen Sie dann diesen Befehl im Stammverzeichnis des Projekts aus:

```bash
sudo env GITLAB_SSH_BIND=127.0.0.1:2222 GITLAB_REGISTRY_BIND=127.0.0.1:5050 \
  /opt/system-bootstrapper-runtime/bin/node operations/dist/cli.js install --checkout "$PWD" \
  --controller "$CONTROLLER_RELEASE" --wizard "$WIZARD_RELEASE" \
  --persistence-env /etc/system-bootstrapper/persistence.env
```

Das Installationsprogramm verlangt sauberen Quellcode, der zum Controller-Release und dessen
festgelegtem Wizard-Commit passt. Es lehnt vorhandene GitLab-Daten oder eine gespeicherte Hauptkonfiguration ab;
verwenden Sie bei einer bestehenden Installation das Austausch-/Wiederherstellungsverfahren. Es verzeichnet
die gewählten öffentlichen Images im privaten Arbeitskonfigurationsverzeichnis und
startet mit deaktivierten Builds. Spätere normale Starts verwenden dieses Release-Profil erneut;
ausdrückliche Image-Selektoren in der gespeicherten Hauptkonfiguration haben Vorrang.

Der Bootstrapper startet zunächst den Wizard und den Sync-Zugangspunkt. GitLab ist zu
diesem Zeitpunkt noch nicht vollständig konfiguriert. Image-Downloads und die spätere GitLab-Initialisierung
brauchen weiterhin Zeit; ein öffentliches Release erspart den Quellcode-Build, nicht den Dienststart.

Prüfen Sie die Container und sehen Sie sich die Startausgabe an mit:

```bash
sudo docker ps
sudo docker logs system_bootstrapper_1
```

**Lassen Sie unter WSL eine Ubuntu-Konsole geöffnet**, während Sie die Plattform verwenden. Ein laufender
systemd-Dienst allein hält die WSL-Instanz nicht am Leben.

### 0.4 Signatur, Serveradresse und tatsächliche Zugangsdaten ermitteln

Der originale System Cube und die Listener-Adresse erscheinen in der Bootstrapper-Ausgabe:

```text
server listening on http://<internal-container-ip>:8071
Sync authentication is configured.
```

Zugangsdaten werden nicht protokolliert. Beim ersten Start werden erzeugte Zugangsdaten
privat in `PERSISTENT_DIR/configuration/sync-auth.env` gespeichert. Sobald eine Haupt-
konfiguration besteht, überschreiben deren `SYNC_USER` und `SYNC_PASS` diese Anfangswerte.

Führen Sie diesen Befehl lokal auf Ihrem eigenen Docker-Host aus, um ausschließlich den aktiven Sync-
Benutzernamen und das Passwort anzuzeigen. Er verwendet dieselbe Rangfolge wie der Start:

```bash
sudo bash -c '
  set -euo pipefail
  PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
  if [[ -f /etc/system-bootstrapper/persistence.env ]]; then
    source /etc/system-bootstrapper/persistence.env
  fi
  source "$PERSISTENT_DIR/configuration/sync-auth.env"
  if [[ -f "$PERSISTENT_DIR/configuration/.docker.env" ]]; then
    source "$PERSISTENT_DIR/configuration/.docker.env"
  fi
  printf "Username: %s\nPassword: %s\n" "$SYNC_USER" "$SYNC_PASS"
'
```

Verwenden Sie die ausgegebenen Werte im Verbindungsdialog. Halten Sie diese Terminalausgabe
privat. Falls Sie beim Start eine eigene `PERSISTENCE_ENV_FILE` gewählt haben, verwenden Sie
stattdessen diese Selektordatei im Befehl. Bildschirmfotos und Platzhalter liefern keine
gültigen Zugangsdaten für Ihre Installation.

Die angezeigte Container-IP und Port `8071` sind die interne Node-Adresse. Beim
lokalen ersten Start erreichen Sie Sync im Browser unter **`http://localhost/sync`**.
NGINX leitet diese Adresse an den Node-Dienst weiter. Die interne IP kann sich
bei jedem Container-Neustart ändern.

### 0.5 Wizard im Browser öffnen

Die folgenden Bildschirmfotos zeigen die englische Oberfläche. Die Bedienpfade im Text nennen die aktuellen deutschen Beschriftungen; beispielsweise entspricht **Verbinden** dem englischen **Connect**.

Öffnen Sie [http://localhost/](http://localhost/).

Die **Übersicht** öffnet sich mit einer kurzen Projektvorstellung, den Karten
**So funktioniert’s** und der **Schnellinstallation**. Die Installationsschaltfläche
führt zu einem Befehl für das Terminal des Hosts. Wählen Sie oben den Reiter **Wizard**,
um den unten gezeigten Konfigurationsbereich zu erreichen. Der Wechsel zwischen Übersicht, Wizard und
den rechtlichen Seiten im Fußbereich erhält Ihre Verbindung und nicht gesendete Formularwerte;
ein Neuladen des Browsers setzt diesen lokalen Zustand zurück.

![Übersicht mit Plattformvorstellung und Schnellinstallation](images/getting-started/00-overview.png)

Falls bereits eine ältere Version geöffnet ist, laden Sie die Seite neu. Nutzen Sie **Ctrl+F5**, wenn die
Oberfläche veraltet aussieht; der Browsercache kann noch die vorherige Version enthalten.

![Wizard vor der Verbindung: Stiftsymbol und Connect-Schaltfläche oben rechts](images/getting-started/01-wizard-start.png)

Vor dem Laden einer Konfiguration kann das Formular Beispielwerte enthalten. Dies
bedeutet nicht, dass GitLab unter diesen Adressen bereits konfiguriert wurde. Klicken Sie
noch nicht auf Übertragen oder Seed.

### 0.6 Zuerst „Verbindung bearbeiten“ öffnen und die Verbindungsdaten eingeben

Klicken Sie auf das **Stiftsymbol unmittelbar links neben Verbinden** mit der Beschriftung **Verbindung bearbeiten**. Es öffnet den
**Verbinden**-Dialog mit drei Eingabefeldern.

![Edit-Dialog mit Server Address und leeren Feldern Username und Password](images/getting-started/03-edit-connection.png)

Geben Sie Folgendes ein:

| Feld im Dialog „Verbinden“ | Herkunft des Werts |
| --- | --- |
| **Serveradresse** | Für diesen lokalen ersten Start: `http://localhost/sync` |
| **Benutzername** | Der aktive Sync-Benutzername aus dem privaten lokalen Befehl in Abschnitt 0.4 |
| **Passwort** | Das aktive Sync-Passwort aus demselben Befehl |

**Diese Zugangsdaten stammen aus Ihrer eigenen persistenten Konfiguration.** Sie sind
von den GitLab-Zugangsdaten getrennt. Kopieren Sie sie nicht aus dem Bildschirmfoto.

### 0.7 Nach dem Ausfüllen aller drei Felder verbinden

Bestätigen Sie den Dialog mit **Übernehmen**, nachdem Sie alle drei Felder ausgefüllt haben. Diese
Schaltfläche meldet Sie an; Sie müssen danach nicht erneut auf Verbinden klicken.

Die Verbinden-Schaltfläche im Hauptfenster ist eine Abkürzung mit den dort bereits
gespeicherten Verbindungseinstellungen. Nutzen Sie für Ihre erste Anmeldung den oben beschriebenen Verbindungsdialog.

![Erfolgreich verbunden: Serveradresse, Disconnect und Synchronize sind sichtbar](images/getting-started/04-connected.png)

Die Serveradresse, der grüne Punkt, die geänderte Farbe der **Trennen**-Schaltfläche und das zusätzliche
Menü **Synchronisieren** zeigen eine erfolgreiche Verbindung zur Bootstrapper-Instanz an.

### 0.8 Konfiguration mit Abrufen laden

Öffnen Sie **Synchronisieren** und wählen Sie **Abrufen**.

![Synchronize-Menü mit dem Eintrag Fetch](images/getting-started/05-fetch-menu.png)

Es gibt zwei Fälle:

- **Die Instanz hat eine gespeicherte Konfiguration:** Abrufen lädt genau diese Einstellungen
  und die vorhandenen Projekte in den Wizard.
- **Es wurde noch keine Hauptkonfiguration übertragen:** Die aktuelle Version fordert
  abgeleitete Vorschläge vom verbundenen Bootstrapper an und lädt sie ins Formular.

![Erster Start nach Fetch: vorgeschlagene lokale Hostnamen mit Sternchen](images/getting-started/06-derived-settings.png)

Ein **Sternchen** kennzeichnet einen abgeleiteten Wert. Bewegen Sie den Mauszeiger darüber oder fokussieren Sie es mit der Tab-Taste.
Der Tooltip erklärt die Herkunft und fordert Sie auf, den Wert vor der Übertragung zu prüfen.

![Sternchen-Tooltip mit dem Hinweis, abgeleitete Daten zu prüfen](images/getting-started/07-derived-tooltip.png)

Vorhandene NGINX-Routen haben bei der Ableitung von Vorschlägen Vorrang. Andernfalls
können Hostnamen aus der Verbindungsadresse vorgeschlagen werden. Vorschläge richten kein
DNS ein und belegen nicht, dass ein Zertifikat existiert. Unbekannte Werte bleiben leer;
Passwörter und Runner-Token werden nicht geraten.

Abrufen schreibt keine neue Konfiguration auf den Server, ersetzt aber Werte
im Browserformular. Nutzen Sie zuvor **Sichern**, wenn Sie nicht gesendete Änderungen bewahren möchten.

### 0.9 Vorschläge für den lokalen Test vervollständigen

Prüfen Sie unter **Allgemein** die Abschnitte **Start**, **SSL**, **Sync** und **Wizard**:

| Einstellung | Wert für diesen lokalen Test |
| --- | --- |
| `SEED_DIR` | Optionales unabhängiges Backup-Ziel; bis zur Wahl des Seed-Speichers leer lassen |
| `GITLAB_HOST` | `gitlab.localhost` |
| `GITLAB_REGISTRY_HOST` | `registry.localhost` |
| GitLab-Runner | Anfangs `0`; Runner nach der Anmeldung bei GitLab konfigurieren |
| GitLab und Registry unter SSL | **Standard, HTTP** |
| Synchronisierungsserver aktivieren | Aktivieren |
| `SYNC_HOST` | `sync.localhost` |
| `SYNC_USER` und `SYNC_PASS` | Eigene Zugangsdaten für spätere Verbindungen wählen und merken |
| Sync-Modus | **Standard, HTTP** |
| Wizard aktivieren | Aktivieren |
| `WIZARD_HOST` | `localhost` |
| Wizard-Modus | **Standard, HTTP** |

Der Seed-Pfad ist ein Backup-Ziel auf dem Docker-Host, nicht das aktive Arbeits-
verzeichnis. Der erste Start stellt nichts automatisch wieder her. Ein externes
Backup-Ziel wird nur bei einem ausdrücklichen Harvest- oder Seed-Vorgang benötigt;
konfigurieren Sie dessen Einbindung und Identität vor der Verwendung im Host-Selektor.

#### Öffentliche Website und Betreiberinformationen

Prüfen Sie in **Allgemein → Website** die Angaben, die auf den Seiten
**Impressum** und **Datenschutz** im Fußbereich angezeigt werden. Betreibername, Postanschrift und Kontakt-E-Mail
beginnen mit den sichtbaren Einrichtungsbeispielen **Max Mustermann**, **Musterstraße 1,
12345 Musterstadt, Deutschland** und **kontakt@example.com**. Diese sind tatsächliche
Formularwerte und Eingabeplatzhalter: Ersetzen Sie sie durch Ihre eigenen öffentlichen
Angaben oder leeren Sie die Felder. Die öffentlichen Seiten kennzeichnen unveränderte Beispiele entsprechend.
Ein ausdrücklich geleertes Feld bleibt leer; fehlende Felder älterer Konfigurationen
erhalten die Einrichtungsbeispiele.

![Website-Einstellungen mit öffentlichen Betreiberbeispielen und optionalen Datenschutzfeldern](images/getting-started/08-website-settings.png)

Optionale Felder bieten einen Link zu einer zusätzlichen Datenschutzerklärung, die bei Ihrer Bereitstellung
tatsächlich verwendete Aufbewahrungsdauer der Zugriffsprotokolle und zusätzlichen Datenschutztext. Die
Beschreibung der Aufbewahrung ändert weder Protokollierung noch Rotation. Alle sechs Felder sind
öffentlich; geben Sie dort keine Passwörter, Token oder anderen vertraulichen Informationen ein.

**Sichern**, **Öffnen**, **Abrufen** und **Übertragen** schließen diese Einstellungen ein. Ein erfolgreiches
Übertragen wendet sie über den normalen Plattformneustart an, ohne Image-Neubau
oder CI-Pipeline. Der Start schreibt nur diese sechs öffentlichen Zeichenfolgen in
`privacy-instance.json` auf dediziertem persistentem Speicher. Der Wizard liest diese
Veröffentlichung, ohne die authentifizierte Sync-Konfiguration abzurufen.

### 0.10 Konfiguration sichern, übertragen und anwenden

1. Wählen Sie **Sichern → bootstrapper.json → Herunterladen**, um die bearbeitbare
   Konfiguration zu speichern, oder **Sichern → bootstrapper.zip** für JSON plus erzeugte
   Umgebungsdateien. Beide enthalten Zugangsdaten; bewahren Sie sie privat auf.
2. Wählen Sie **Synchronisieren → Übertragen** und bestätigen Sie die Übertragung. Dies sendet die Wizard-
   Einstellungen an die Instanz. Prüfe die angezeigten Auswirkungen: Bestehende
   Anwendungsrouten laden den Proxy neu, während GitLab verfügbar bleibt;
   weitergehende Änderungen starten die Dienste neu. Die Oberfläche ist
   während eines Plattformneustarts vorübergehend nicht verfügbar.
3. Warten Sie, bis die Oberfläche zurückkehrt, verbinden Sie sich erneut und prüfen Sie die Einstellungen mit Abrufen.

**Übertragen sendet Einstellungen an die Instanz und wendet sie an. Ein zusätzlicher Klick auf Neustarten ist nicht erforderlich.**
Öffnen lädt eine zuvor heruntergeladene JSON-Datei in den Wizard; das Laden der Datei
allein ändert die Serverkonfiguration nicht.

### 0.11 GitLab öffnen und erstmals anmelden

GitLabs erster Start kann mehrere Minuten dauern. Prüfen Sie den Status in Ubuntu:

```bash
sudo docker ps
```

Der GitLab-Container sollte schließlich `healthy` melden. Öffnen Sie dann
[http://gitlab.localhost/](http://gitlab.localhost/).

Der GitLab-Administratorname ist **`root`**. Für eine neue Datenbank erzeugt der
Bootstrapper ein zufälliges Anfangspasswort. Bei einer mit vollständiger privater
Konfiguration vorbereiteten Installation kann stattdessen `GITLAB_INITIAL_ROOT_PASSWORD`
vor GitLabs erstem Start in `PERSISTENT_DIR/configuration/.docker.env` auf mindestens 12 Zeichen
festgelegt werden. Der Wizard hat kein eigenes Feld für diesen optionalen Wert.

Lesen Sie das Anfangspasswort nach dem ersten Start lokal aus:

```bash
sudo docker exec system_gitlab_1 cat /etc/gitlab/bootstrapper_initial_root_password
```

Diese für root lesbare Datei liegt in GitLabs persistentem Konfigurationsvolume
und übersteht Neustarts. Melden Sie sich als `root` an und halten Sie die Zugangsdaten privat. Die
Datei verzeichnet das Anfangspasswort; spätere Passwortänderungen werden nicht in sie
zurückgeschrieben. Harvest nimmt sie über das GitLab-Konfigurationsvolume ebenfalls in den
Seed auf; halten Sie daher auch den Seed privat.

Eine bestehende Datenbank bleibt unverändert. Wurde sie ohne diesen Mechanismus eingerichtet,
wird nachträglich keine Datei mit einem angenommenen Anmeldepasswort erstellt. Sie können
GitLabs eigene temporäre Datei prüfen, falls sie noch vorhanden ist:

```bash
sudo docker exec system_gitlab_1 grep 'Password:' /etc/gitlab/initial_root_password
```

GitLab kann diese eigene Datei nach 24 Stunden bei einem Container-Neustart entfernen. Ist kein
gültiges Passwort bekannt, muss das GitLab-Passwort gezielt zurückgesetzt werden. Sync-
Zugangsdaten sind von der GitLab-Anmeldung unabhängig.

### 0.12 Später erneut verbinden und Einstellungen ändern

Öffnen Sie den Wizard erneut unter [http://localhost/](http://localhost/). Nach Abschluss
der obigen Einrichtung lautet die Sync-Adresse **`http://sync.localhost`** und ersetzt den
Pfad `/sync` des ersten Starts.

Nutzen Sie **Verbindung bearbeiten** und die in Abschnitt 0.9 gewählten Sync-Zugangsdaten. Laden Sie die
gespeicherte Konfiguration mit **Synchronisieren → Abrufen**. Sie können sie ändern, über **Sichern** eine lokale
Sicherung speichern und anschließend mit **Übertragen** anwenden, das automatisch neu startet.

Konfigurieren Sie für öffentliche Nutzung Ihr eigenes DNS, HTTPS-Zertifikate und die Zertifikats-
erneuerung auf dem Host. Die Wiederverwendung einer Datenbank oder das Verschieben persistenten Speichers erfordert das separate
[Wiederherstellungsverfahren](RECOVERY_CONTRACT.md).
