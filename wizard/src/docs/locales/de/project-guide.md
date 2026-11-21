# Ein Anwendungsprojekt erstellen

Verbinde den Wizard mit Sync, rufe die gespeicherte Konfiguration ab und öffne
**Projekte → Projekt hinzufügen**. Gib einen nicht leeren Projektschlüssel ein,
der nur ASCII-Kleinbuchstaben und Ziffern enthält. Wähle einen GitLab-Namensraum
und eine Anwendungsvorlage und konfiguriere anschließend Production-, Beta- und
Review-App-Hosts mit ihren HTTP-/HTTPS-, Zertifikats- und Deployment-Einstellungen.
Das Ziel unterhalb des Schlüssels ist der exakte Repository-Pfad; Domains ändern
ihn nicht. Bestehende gespeicherte Schlüssel werden nicht umbenannt.

Das Schlüsselfeld unterscheidet zwischen Prüfung, verfügbar, belegt und ungeprüft.
Ein lokales Duplikat oder ein belegtes GitLab-Ziel blockiert die Erstellung.
Ein API-Fehler bedeutet nicht, dass ein Name frei ist. Speichern prüft GitLab erneut;
eine konkurrierende Erstellung wird gemeldet, ohne sie zu verknüpfen, zu überschreiben
oder einen Namenszusatz anzuhängen.

## Speichern und die erste Pipeline prüfen

Speichern erstellt ein privates Repository, verwendet dessen konfigurierten
Standardbranch, installiert verwaltete CI unter `.system-bootstrapper/ci.yml`
und wählt diesen CI-Pfad aus. Vor der Installation fehlender verwalteter CI im
privaten Repository dieses Bereitstellungsvorgangs erhält das Automatisierungskonto
des Controllers ausdrücklich die Projektrolle Maintainer, um auf den geschützten
Standardbranch schreiben zu können. Bei der Wiederaufnahme einer bereits gültigen
Repository-Zuordnung wird GitLab nur gelesen; Branchschutz und Benutzerdateien bleiben erhalten.
Die Bereitstellung läuft serverseitig über einen
authentifizierten Hintergrundjob; der Browser fragt mit kurzen Anfragen nach.
Lass das Formular bis zum Abschluss geöffnet. Eine fehlgeschlagene Anfrage kann
mit Speichern wiederholt werden. Rufe nach einem Browser-/Dienstneustart die
ausstehende Konfiguration ab und verwende **Bearbeiten → Speichern**, um denselben
Vorgang fortzusetzen.

Der private Vorgangsbeleg wird in `.projects.env/.<key>.env` gespeichert. Während
der Bereitstellung sind widersprechende Konfigurations-/Dienständerungen ausgeschlossen.
Ersetze keine ausstehende Konfiguration und lösche nicht ihren Beleg, um die
Wiederaufnahme zu umgehen.

React-, Angular- und allgemeine Webprojekte erhalten bearbeitbaren
Anwendungsquellcode, Dockerfile, NGINX-Konfiguration und passende CI. React verwendet
TypeScript/Vite; Angular verwendet seinen CLI-Build. Beide verwenden Node 24 mit
festgelegten Abhängigkeiten und Lockdateien. Allgemeines Web beginnt mit statischem
HTML/CSS/JavaScript und benötigt keinen Node-Build. `GETTING_STARTED.md` im erstellten
Repository enthält die lokalen Befehle.

Sobald das Routing bereit ist, startet Speichern die erste Pipeline. Sie baut und
veröffentlicht ein Image, führt einen HTTP-Kurztest aus und stellt automatische
Umgebungen bereit. Starte manuelle Deployment-Jobs in GitLab. Prüfe den Pipeline-Link
auf das tatsächliche Ergebnis: Ein wartender Build bedeutet nicht, dass eine
Anwendung läuft. Erneutes Speichern nimmt die erste Pipeline wieder auf, statt
Duplikate zu starten.

Ein **Leeres Repository** enthält README und erzeugte CI, aber keine laufende
Anwendung. Ergänze vor Build oder Deployment Quellcode und ein Dockerfile im
Wurzelverzeichnis, das mit dem erzeugten Docker-/Cypress-Ablauf kompatibel ist.
Umgebungs-URLs sind konfigurierte Ziele, keine Zustandsprüfungen.

Repository-ID, Pfad, URLs, Standardbranch, verwalteter CI-Pfad und Vorgangszustand
bleiben beim Abrufen und bei Konfigurations-Sichern/Öffnen erhalten. Gewöhnliche
Umgebungsänderungen verwenden den Konfigurations-/Übertragen-Ablauf; sie benennen
das Repository nicht um und schreiben eingecheckte CI nicht automatisch neu.
Prüfe Pipeline-Änderungen ausdrücklich im Repository.

## Einer Anwendung einen vertrauenswürdigen HTTPS-Hostnamen zuweisen

Der Wizard speichert den gewählten Host, das Protokoll und die Zertifikatspfade;
er fordert kein Zertifikat an. Eine Umgebungs-URL oder ein erfolgreiches
HTTP-Deployment belegt weder eine vertrauenswürdige HTTPS-Zertifikatskette noch
ein Zertifikat, das den Host abdeckt. Das Plattformzertifikat lässt sich nur
wiederverwenden, wenn seine Subject Alternative Names den Hostnamen der Anwendung
tatsächlich abdecken.

Dieses Verfahren verwendet eine separate Certbot-Zertifikatslinie für genau
einen Anwendungshost. Wiederhole es für weitere Production-, Beta- oder
Review-Hosts. Wildcard-HTTPS erfordert ein vom Betreiber konfiguriertes
DNS-01-Zertifikat; HTTP-01 kann keine Wildcard-Zertifikate ausstellen. Für die
verwalteten System-Wizard-Umgebungen gibt es ein eigenes
[Aktivierungsverfahren](../project-bootstrap/wizard-environments/README.md).

Bereite diese betreiberseitigen Angaben und Voraussetzungen vor:

- Eine laufende Plattform aus einem geprüften Release mit ihrer nativen
  HTTP-01-Route und öffentlich erreichbaren TCP-Ports 80/443. Ihr Eingangsproxy
  muss das gemeinsame Challenge-Webroot für den gewählten Hostnamen ausliefern,
  auch für einen bereits konfigurierten HTTP-Host. In älteren Releases kann diese
  HTTP-Host-Route fehlen; der folgende Challenge-Test muss vor der Ausstellung
  erfolgreich sein. Aktualisiere über das unterstützte Release-Verfahren oder
  verwende einen neuen, noch nicht zugewiesenen exakten Hostnamen, dessen Anfragen
  die Standard-ACME-Route erreichen.
- Öffentliche A-/AAAA-Einträge für die Anwendung, die ausschließlich auf den
  vorgesehenen Host zeigen. Prüfe beide Adressfamilien; ein veralteter AAAA-Eintrag
  kann die Validierung verhindern.
- Die bestehende Auswahl des Live-Speichers unter
  `/etc/system-bootstrapper/persistence.env` und die über die
  [öffentliche HTTPS-Einrichtung](HANDBOOK.md#public-2-select-working-storage-and-install-certificate-integration)
  installierte Host-Integration. Diese installiert `/usr/local/sbin/system-certbot`,
  den Zertifikats-Deploy-Hook und `certbot.timer`. Verwende die gespeicherte
  Speicherauswahl weiter; ersetze sie nicht durch das Neuinstallationsbeispiel des
  Handbuchs. Certbot verwendet das Distributionspaket unter `/usr/bin/certbot`.
- Eine echte ACME-Kontakt-E-Mail-Adresse und einen unbenutzten Namen für die
  Zertifikatslinie. Hier ist der exakte Hostname zugleich der Name der
  Zertifikatslinie. Prüfe vor der Auswahl `sudo system-certbot certificates`;
  ersetze nicht den Zertifikatszustand einer anderen Anwendung.

Setze auf dem Server deine eigenen Werte ein:

```bash
APP_HOST='app.example.com'
ACME_EMAIL='you@example.com'
dig +short A "$APP_HOST"
dig +short AAAA "$APP_HOST"
sudo env APP_HOST="$APP_HOST" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  install -d -m 0755 "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge"
  printf "%s\n" bootstrapper-application-acme-check > "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/$APP_HOST-check"
  chmod 0644 "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/$APP_HOST-check"
'
```

Verwende außerhalb des Servers denselben Anwendungshostnamen:

```bash
APP_HOST='app.example.com'
curl --fail --silent --show-error --include \
  "http://$APP_HOST/.well-known/acme-challenge/$APP_HOST-check"
```

Erforderlich sind HTTP **200**, der exakte Antwortinhalt
`bootstrapper-application-acme-check` und keine Weiterleitung. Eine Anwendungsseite,
404 oder Weiterleitung bedeutet, dass die Challenge das gemeinsame Webroot nicht
erreicht. Behebe DNS-, Firewall-, Release- oder Routing-Probleme, bevor du
Zertifikate anforderst; wiederholte Ausstellungsversuche dienen nicht der
Routing-Diagnose. Die Standard-ACME-Route unterstützt einen noch nicht zugewiesenen
Hostnamen. Deshalb muss eine neue HTTPS-Umgebung nicht zuerst mit fehlenden
Zertifikatsdateien aktiviert werden.

Führe nach erfolgreichem Test auf dem Server Folgendes mit den oben gesetzten Werten aus:

```bash
sudo env APP_HOST="$APP_HOST" ACME_EMAIL="$ACME_EMAIL" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  /usr/local/sbin/system-certbot certonly --webroot \
    --webroot-path "$PERSISTENT_DIR/ssl/acme-http01" \
    --non-interactive --agree-tos --email "$ACME_EMAIL" \
    --cert-name "$APP_HOST" -d "$APP_HOST"
  RENEWED_LINEAGE="/etc/letsencrypt/live/$APP_HOST" /usr/local/sbin/system-install-certificate
  cmp "/etc/letsencrypt/live/$APP_HOST/fullchain.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/fullchain.pem"
  cmp "/etc/letsencrypt/live/$APP_HOST/privkey.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/privkey.pem"
'
```

Dies fordert ein Zertifikat von der produktiven Zertifizierungsstelle an. Der
installierte Hook kopiert die Zertifikatslinie in den Live-Speicher, validiert
NGINX und lädt den laufenden Eingangsproxy neu. Der ausdrückliche Aufruf des
Installationsprogramms überprüft diese Bereitstellung direkt. Bei der
Webroot-Ausstellung läuft der Proxy weiter, und die Webroot-Authentifizierung
wird für künftige Erneuerungen gespeichert. Halte NGINX nicht an und verwende
keine Standalone-Ausstellung auf seinem belegten Port 80. Schlägt die
Zertifikatsausstellung oder Bereitstellung fehl, behebe den Fehler, bevor du die
HTTPS-Einstellungen der Anwendung änderst.

Rufe im Wizard die gespeicherte Konfiguration ab und bewahre eine private
Konfigurationssicherung auf. Ist die Projektbereitstellung noch ausstehend,
schließe denselben Vorgang **Bearbeiten → Speichern** ab oder nimm ihn wieder auf,
bevor du gewöhnliche Konfigurationsänderungen vornimmst. Bewahre seinen
serverseitig verwalteten Beleg auf; lösche und erstelle das Projekt nicht neu,
ändere nicht seinen Schlüssel und bearbeite nicht den Beleg, um die Wiederaufnahme
zu umgehen. Bearbeite bei einer fertig bereitgestellten Anwendung die gewünschte
Umgebung mit diesen Werten und verwende den tatsächlichen Namen deiner Zertifikatslinie:

| Einstellung | Beispiel |
| --- | --- |
| Aktivierter Host | `app.example.com` |
| Domain-Modus | HTTPS für exakten Hostnamen, Modus `2` |
| SSL-Zertifikat | `/ssl/live/app.example.com/fullchain.pem` |
| Privater SSL-Schlüssel | `/ssl/live/app.example.com/privkey.pem` |

Speichere die Umgebungsänderung und wende die Konfiguration über **Übertragen** an.
Verwende die innerhalb der `/ssl`-Einbindung der Plattform sichtbaren Pfade statt
der `/etc/letsencrypt`-Pfade des Hosts. Prüfe die vor Übertragen angezeigten
Auswirkungen. Eine reine Routingänderung einer bestehenden Anwendung hält GitLab
verfügbar; weitergehende Änderungen starten die Plattform neu. Verbinde dich danach
erneut und rufe die Konfiguration ab. Dabei wird weder ein Zertifikat ausgestellt noch das
Repository umbenannt oder eingecheckte Umgebungs-URLs in CI neu geschrieben.
Prüfe diese URLs im Anwendungsrepository, wenn sich das Protokoll geändert hat.

Prüfe den gewählten Hostnamen und das Anwendungsverhalten von einem externen
Client mit seinem normalen CA-Vertrauensspeicher aus. Wähle eine tatsächliche
clientseitige Route und eine vorhandene statische Datei mit mehr als 16 Bytes
aus deiner bereitgestellten Anwendung:

```bash
APP_HOST='app.example.com'
APP_ROUTE='/your/spa/deep-link'
APP_FILE='/path/to/existing-file.ext'
curl --fail --silent --show-error --dump-header - --output /dev/null "https://$APP_HOST/"
curl --fail --silent --show-error --dump-header - --output /dev/null "https://$APP_HOST$APP_ROUTE"
curl --fail --silent --show-error --range 0-15 --dump-header - --output /dev/null \
  "https://$APP_HOST$APP_FILE"
```

Diese Anfragen prüfen die Zertifikatskette des Servers und den URL-Hostnamen
mittels normaler TLS-Validierung. Deaktiviere die Zertifikatsprüfung nicht.
Erforderlich sind die erwartete Anwendungsantwort für `/`, HTTP 200 mit HTML für
die SPA-Route und HTTP 206 mit `Content-Range: bytes 0-15/<file-size>` für die
statische Datei. Öffne die HTTPS-URL und den Deep Link in einem Browser, um zu
prüfen, ob die Anwendung und ihre Ressourcen korrekt dargestellt werden. Verwende
bei einer Anwendung ohne SPA deren dokumentiertes Routenverhalten, statt einen
HTML-Fallback zu erwarten.

Prüfe abschließend auf dem Server die Erneuerung und den Deploy-Hook für diese Zertifikatslinie:

```bash
sudo env APP_HOST="$APP_HOST" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  /usr/local/sbin/system-certbot renew --cert-name "$APP_HOST" --dry-run --run-deploy-hooks
  RENEWED_LINEAGE="/etc/letsencrypt/live/$APP_HOST" /usr/local/sbin/system-install-certificate
  cmp "/etc/letsencrypt/live/$APP_HOST/fullchain.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/fullchain.pem"
  cmp "/etc/letsencrypt/live/$APP_HOST/privkey.pem" "$PERSISTENT_DIR/ssl/live/$APP_HOST/privkey.pem"
  docker exec system_web_1 nginx -t
'
```

Die simulierte Erneuerung muss erfolgreich sein, und kein Deploy-Hook darf
fehlschlagen. Certbot kann einen Hook-Fehler melden, ohne einen Fehlerstatus für
die Erneuerung zurückzugeben; prüfe deshalb seine Ausgabe. Der Testlauf stellt
das aktive vertrauenswürdige Zertifikat bereit, nicht das Staging-Zertifikat.
Wiederhole anschließend die externen HTTPS-Prüfungen, aktiviere/prüfe den
geteilten Timer und entferne nur diese Testdatei:

```bash
sudo systemctl enable --now certbot.timer
systemctl list-timers certbot.timer
sudo env APP_HOST="$APP_HOST" bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  rm -- "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/$APP_HOST-check"
'
```

Halte DNS und den öffentlichen TCP-Port 80 für die Erneuerung funktionsfähig.
Bewahre den gesamten Certbot-Verzeichnisbaum einschließlich Konten, Archiven und
Erneuerungskonfiguration über den normalen
[Harvest-/Seed-Wiederherstellungsablauf](RECOVERY_CONTRACT.md) auf. Bei einem
Sperrfehler muss der aktive oder unterbrochene Zertifikats-/Harvest-Vorgang
geklärt werden; lösche nicht seine Sperre, um die Ausstellung zu erzwingen.
Hinweise zur Diagnose von Deploy-Hooks und zum erneuten Zuordnen des Webroots
bei der Wiederherstellung findest du in den
[Erneuerungshinweisen](HANDBOOK.md#public-6-switch-unattended-renewal-to-the-running-proxy).

### Browserdaten beim Wechsel von HTTP zu HTTPS

`http://app.example.com` und `https://app.example.com` sind unterschiedliche
Browser-Origins. Ihre localStorage-Daten werden nicht automatisch übertragen,
auch nicht bei gleichem Hostnamen und Anwendungsimage. Verwende vor der
Umgebungsänderung die Export-/Sicherungsfunktion der Anwendung für alle benötigten
Daten im Browser und importiere sie anschließend über die Anwendung am
HTTPS-Origin. Folge ihrem eigenen Wiederherstellungsverfahren, wenn sie keine
Export-/Importfunktion hat. Eine Plattform-Konfigurationssicherung oder
Harvest/Seed kopiert den localStorage der Benutzer im Browser nicht.

## Das Systemprojekt Wizard verwalten

Beim Start mit aktiviertem konfiguriertem Wizard wird dieser als erstes
Systemprojekt registriert. Allgemein liefert seinen bestehenden Production-Host
und die Zertifikate, sodass die Registrierung keinen zweiten Proxy für diesen
Host erzeugt. Bearbeiten/Löschen und normale Umgebungsschalter sind für diesen
verwalteten Eintrag deaktiviert. Wiederholtes Starten behält das Repository und
seine serverseitig verwalteten Ablaufmetadaten. Behebe einen lokalen Schlüssel-
oder Repository-Eigentumskonflikt, bevor du den Start erneut versuchst.

Die Registrierung allein installiert ein deaktiviertes Grundgerüst. Verwende
die verwalteten Projektaktionen zum [Initialisieren des festgelegten Quellcodes](WIZARD_SOURCE.md),
[Bauen und Prüfen eines Kandidaten](WIZARD_BUILD.md) und Konfigurieren von
[Review-/Beta-Umgebungen](../project-bootstrap/wizard-environments/README.md).
Die optionalen Umgebungen sind anfangs deaktiviert und erfordern eine ausdrückliche
Host-/Zertifikatskonfiguration. Ihre Deploy-/Stop-Jobs sind manuell. Ein Kandidat
ersetzt die Production-Oberfläche nur durch das separate abgesicherte
[Freigabeverfahren des Betreibers](../project-bootstrap/wizard-production/README.md).

Übertragen/Abrufen und Öffnen/Sichern verwalten die Konfiguration unabhängig von
Harvest/Seed, das persistente Dienstdaten und Zertifikate verarbeitet. Bewahre
echte Konfigurationssicherungen privat auf; erzeugte Quellcode-Repositories sind
kein Ort für Zugangsdaten oder exportierte Konfigurationen.

## Prüfung

Baue Sync mit `cd sync && npm run build`. Die isolierte API-Regression
`node tests/gitlab/project-bootstrap.js` verwendet Port 8071 und muss in einem
entbehrlichen Container/Netzwerk-Namensraum laufen. Sie prüft Validierung,
Authentifizierung, Namensraumkonflikte, konkurrierendes Speichern, Wiederaufnahme,
Statusabfragen, den Ausschluss von Konfigurationsschreibvorgängen und Abrufen-Rundläufe.
Die Vorlagenerzeugung wird durch `node tests/gitlab/application-templates.js` geprüft. Dieselbe Fixture prüft native Namespace-Seitennavigation, die Erstellung eigener Repositories, schreibgeschützte Nachweiswiederherstellung nach Benutzeränderungen, unterbrochene API-Schreibvorgänge und idempotente initiale Pipeline-Erstellung.

Verwende für Wizard-Prüfungen die in `wizard/package.json` deklarierten Node-/npm-Versionen,
installiere mit `npm ci` und führe dann `npm run lint`, `npm test`, `npm run build`
und `npm run test:config-export` im Wizard-Verzeichnis aus. Die Tests prüfen
Metadaten, Zertifikats-/Deployment-Einstellungen, Schlüsselvalidierung und das
Ignorieren veralteter Antworten.

`tests/gitlab/live/project-bootstrap.js` ist ein ausdrücklich aktivierter Test für eine verwerfbare Plattform. Er erhält Sync-Zugangsdaten über die Umgebung und eine `PROJECT_PAYLOAD`-JSON-Datei mit `{projectKey, namespaceId, data, ci}` aus dem Wizard-Generator. Er erstellt sein Projekt `bootstrapdemo` oder setzt es fort, prüft gleichzeitiges/wiederholtes Save und Fetch und lässt es zur Inspektion bestehen. Richte ihn nicht auf einen fremden bestehenden Schlüssel. Live-Vorlagenprüfungen sind `tests/gitlab/live/application-templates.js` und `tests/gitlab/live/application-templates-audit.js --projects-file /tmp/template-live-results.json --timeout 720`. Führe die Prüfung nach normaler Einrichtung im geprüften Controller aus. Sie liest die bestehende einsatzbereite Automatisierungskennung und prüft die exakten privaten Repositories, Starter-Dateien, die eindeutige initiale Pipeline und erfolgreiche Review-/Production-Umgebungen. Fehlgeschlagene Jobs werden nicht automatisch wiederholt. Die separate Prüfung `tests/gitlab/live/project-bootstrap-audit.js --project root/bootstrapdemo` prüft private Projektidentität, verwalteten CI-Pfad, exakten Cube und offizielles CI-Lint. Keine Prüfung initialisiert Zugangsdaten oder ruft Rails auf; übergib deinen eigenen ausdrücklichen Testprojektpfad oder deine Metadatendatei.

`tests/wizard/default-wizard.js` und
`tests/nginx/typed-routing.js` prüfen die verwaltete Registrierung und
das Verhalten mit genau einer Route; `tests/wizard/live/default-wizard.js` ist
die zugehörige authentifizierte Live-Prüfung. Lokale HTTP-Fixtures belegen weder
echtes DNS noch Zertifikatsausstellung/-erneuerung, GitLab-Job-Ausführung oder
einen erfolgreichen Production-Rollout. Prüfe diese Freigabebedingungen separat
auf einer ausdrücklich zugeordneten Testplattform.


## Anwendungsaliase und Routingänderungen

Jede gewöhnliche Anwendungsumgebung bietet optional `PROD_ALIASES`,
`BETA_ALIASES` oder `REVIEW_ALIASES`. Trage zusätzliche exakte DNS-Hosts durch
Leerzeichen getrennt ein. Der vorhandene Host der Umgebung ist das kanonische
Ziel; verwende den exakten Domainmodus 0 oder 2. Beim kanonischen Host
`www.example.com` ergänze beispielsweise `example.com` als Production-Alias.
Deaktivierte Umgebungen behalten ihre Aliase, ohne eine Route zu veröffentlichen.

HTTP- und HTTPS-Aliase antworten mit einer dauerhaften 308-Weiterleitung zum
kanonischen Host mit dessen Protokoll und behalten Pfad und Abfrage bei.
Zertifikat und passender privater Schlüssel der Umgebung müssen unter
`/ssl` verfügbar und aktuell gültig sein. Die alternativen Antragstellernamen
müssen den kanonischen Host und alle Aliase abdecken. Das gilt auch für ein
kanonisches HTTP-Ziel, weil die Aliase HTTPS annehmen. Bereite DNS und Zertifikate
vor der Aktivierung vor. ACME-HTTP-01-Prüfdateien bleiben unter
`/.well-known/acme-challenge/` direkt erreichbar; Weiterleitungen und Erneuerungen
erfordern keinen Proxy-Stopp. Platzhalter, Selbstweiterleitungen, doppelte Aliase
und Konflikte mit Plattformhosts, Wizard-Aliasen oder aktiven Anwendungsrouten
werden abgelehnt.

Rufe die Konfiguration vor Änderungen ab. Sichere sie privat, speichere das
Projekt und öffne Übertragen. Der Server vergleicht gespeicherte und vorgeschlagene
Konfiguration und zeigt vor der Bestätigung die Auswirkungen. Host-, Protokoll-,
Aktivierungs-, Zertifikats-, Alias- und Deploymentmodus-Änderungen bestehender
gewöhnlicher Anwendungen verwenden den nativen Routingpfad. Nur benötigte
Proxys/Netzwerke betroffener Projekte werden vorbereitet, der Eingangsproxy wird
validiert und sanft neu geladen. GitLab sowie laufende Anwendungscontainer und
Images bleiben erhalten. Änderungen an Haupteinstellungen, Projektbestand,
Eigentümerschaft, Runnern oder unbekannten Einstellungen verwenden den
Plattformneustart. Eine geänderte Konfiguration macht die geprüfte Übertragung
ungültig; prüfe sie erneut. Unveränderte wirksame Einstellungen erfordern keinen
Dienstneustart.

Routing bewahrt servereigene Belege und den System Cube. Fehlgeschlagene
Proxyvalidierung oder Neuladung stellt vorherige generierte und aktive
Proxykonfiguration wieder her; ein fehlgeschlagenes Anwenden stellt die vorherige
gespeicherte Konfiguration wieder her. Prüfe den gemeldeten Fehler und rufe die
Konfiguration vor dem Wiederholen ab. Bearbeite keine generierten Proxydateien
und setze Projektbelege nicht zurück. Deploymentmodus-Änderungen schreiben keine
bereits eingecheckte Anwendungs-CI um; prüfe deren Umgebungsjobs gesondert.

Aliase und ihre Umgebungszuordnung überstehen Abrufen/Übertragen und JSON- oder
ZIP-Sichern/Öffnen. Bewahre für die Wiederherstellung die passende
Konfigurationssicherung und einen abgeschlossenen Seed mit Zertifikaten und
Dienstdaten auf. Ein frischer Konfigurationsimport darf der Seed-Wiederherstellung
vorausgehen; der Start prüft die Zertifikatsabdeckung vor Veröffentlichung eines
Alias. Folge dem normalen Wiederherstellungsablauf und prüfe anschließend
kanonische und Alias-URLs mit Pfad/Abfrage und einer HTTP-01-Prüfdatei.

Die isolierten Routing-, Multipart-Übertragungs-, Rollback- und
Wizard-Konfigurationsprüfungen gehören zum festgeschriebenen Komponentenmanifest.
Der vorhandene entbehrliche Plattformkandidat erstellt eine gewöhnliche Anwendung
über Sync, wendet Review- und Aliasänderungen über den Abrufen/ZIP/Übertragen-Pfad
des Wizards an und prüft durchgängige GitLab-Bereitschaft und Containeridentität,
bestehende Production-/Beta-Images und -Routen, HTTP-/HTTPS-Weiterleitungen,
HTTP-01, Proxyneustart, Seed-Wiederherstellung und erneuerte Zertifikate. Führe das
verpflichtende Kandidaten-Gate für die vollständige geprüfte Änderung aus; es ist
kein Schritt eines Betreiber-Upgrades.
