# Verwaltete Wizard-Umgebungen Review und Beta

Der Umgebungsablauf erweitert die verwalteten Quellcode-/Build-Belege.
Production-Freigabe und Rollback bleiben außerhalb dieses Rezepts. Die bestehende
öffentliche Quellcode-CI und ihre Veröffentlichungsziele bleiben erhalten.

Review verwendet einen exakten HTTPS-Host und eine einzige aktive
Merge-Request-Lease. Die Ressourcenidentität enthält Projekt und MR-IID.
Ein anderer MR muss warten, bis die aktuelle Review-Umgebung gestoppt ist;
eine neuere verifizierte Pipeline desselben MR darf sie ersetzen. Beta verwendet
einen separaten exakten Host und den aktuellen Kopf des Standardbranches.
Bereitstellen und Stoppen sind für beide Umgebungen manuelle native GitLab-Jobs.
Es gibt keine Production-Jobs oder Endpunkte zum Bereitstellen beliebiger Images.

## Konfiguration und Installation

Der authentifizierte Wizard-Umgebungsdialog zeigt eine Vorschau optionaler
Einstellungen. Jede aktivierte Zeile benötigt einen ausdrücklich angegebenen
exakten Host, Domainmodus 2 und Zertifikats-/Schlüsselpfade unter /ssl.
Platzhalter-Domainmodi werden in diesem Rezept nicht unterstützt. Deaktivierte
Zeilen dürfen leer bleiben. Einstellungen werden nicht abgeleitet und automatisch aktiviert.

Der Server prüft DNS gegen die aktuellen Production-Hostadressen, die exakte
Zertifikatsabdeckung, Gültigkeit und den passenden privaten Schlüssel. Reserviere
die Hosts getrennt von Plattform- und anderen Projektrouten. Stelle ihre
Zertifikate bereit, bevor du die Installation bestätigst. Bestehende
Production-Einstellungen und der unveränderliche System Cube einschließlich
seiner festen HTTPS-www-URL und Port 8071 bleiben unverändert.

Eine bestätigte Vorschau installiert versionierte verwaltete Dateien und die
ausgewählte CI mit einem abgesicherten Skip-CI-Commit. Sie startet keine Pipeline
und stellt keinen Container bereit. Unerwartete Bearbeitungen, belegte Pfade,
geänderte Vorschauen und Eigentumsabweichungen führen zum sicheren Abbruch.
Aktualisieren prüft denselben Vorgang, ohne einen weiteren Commit oder eine
Pipeline anzulegen. Ein ungewisser Commit-Ausgang erfordert vor einer Wiederholung
einen Abgleich. Ein verifiziert installierter Vorgang ist bereit für die manuellen CI-Jobs.

Stoppe zum Ändern der Einstellungen aktive Umgebungen und gleiche zuerst
ausstehende Arbeiten ab. Erstelle erneut eine Vorschau und bestätige die Änderung
ausdrücklich. Die Aktualisierung prüft das vorherige Rezept und die exakten
Dateiidentitäten, bevor sie verwaltete Inhalte ersetzt. Bewahre den serverseitig
verwalteten Beleg über Abrufen/Übertragen und Controller-Starts hinweg.
Frühere Build-Nachweise bleiben historisch; verwende den Umgebungsstatus für das
installierte Rezept.

## Bereitstellung des unveränderlichen Hilfs-Images

Der Betreiber muss ein sauberes System-Image aus dem getesteten eingecheckten
Quellcode und seinem passenden geprüften Wizard-Schnappschuss bauen. Nimm keine
private Konfiguration, Zugangsdaten, Git-Metadaten oder Host-Laufzeitausgaben auf.
Stelle dieses Image auf dem bestehenden Docker-Daemon des Runners bereit,
bewahre es auf, solange das Rezept installiert ist, und konfiguriere
SYSTEM_WIZARD_ENVIRONMENT_IMAGE mit seiner exakten sha256-Image-ID.
SYSTEM_WIZARD_CANONICAL_CONTROLLER muss system_bootstrapper_1 bezeichnen.
Die Oberfläche kann weder Hilfs-Image noch kanonischen Controller auswählen.

Bereite vom passenden System-Checkout mit initialisierten Submodulen das
festgelegte Quellcodepaket vor, bevor du das vollständige Hilfs-Image baust:

```sh
bash project-bootstrap/wizard-source/prepare.sh
docker build -f system/Dockerfile -t system-wizard-helper:local .
docker image inspect --format '{{.Id}}' system-wizard-helper:local
```

Halte die ausgegebene Image-ID in der privaten Controller-Konfiguration fest und
stelle genau dieses Image auf dem Docker-Daemon des Runners bereit. Die separate
Laufzeitbasis ist nicht das vollständige Hilfs-Image. Den Vertrag für festgelegte
Schnappschüsse beschreibt die [Quellcodepaketierung](../../docs/WIZARD_SOURCE.md).

CI verwendet gewöhnliche jobbezogene Registry-Zugangsdaten, um den Kandidaten-Digest
vorzuladen. Keine Sync-/Administratorzugangsdaten gelangen ins Hilfsprogramm.
Dieses verwendet das bestehende vertrauenswürdige Docker-Runner-Modell und die
ursprünglichen Controller-/GitLab-Container für kanonische Beleg- und Job-Prüfungen.
Das ist keine Isolation gegen bösartigen Repository-Code. Das Hilfsprogramm ist
begrenzt und verwendet kein Netzwerk, ein schreibgeschütztes Root-Dateisystem,
den bestehenden Docker-Socket, das Vorlagen-Volume und das schreibgeschützte
SSL-Volume; es erhält kein neues Konfigurations-Volume.

Der exakte laufende Job, Pipeline, Quellcode-Kopf, MR-Identität, ausgewählte CI
und erfolgreiche erforderliche Build-/Browser-Artefakte werden vor dem Deployment
serverseitig geprüft. Temporärer Prüfzugriff bleibt innerhalb von GitLab und
wird widerrufen. Das Hilfs-Image muss bei einem Upgrade dieses Rezepts ausdrücklich
neu bereitgestellt werden; lösche es nicht bei einer sonstigen Image-Bereinigung.

## Eigentum und Wiederherstellung

Bereitstellen/Stoppen werden über eine gemeinsame Sperre des kanonischen Controllers
und abgesicherte Belegaktualisierungen serialisiert. Kandidatencontainer, Netzwerke
und Routenfragmente haben exakte Vorgangs-/Projekt-/MR-/Generationseigentümer.
Ein Kandidat wird gesund, bevor seine HTTPS-Route umgeschaltet wird. Fehlgeschlagene
nginx-Prüfungen, Neuladevorgänge oder Belegschreibvorgänge stellen die vorherige
Route wieder her. Stoppen bewahrt eine zugehörige HTTP-410-/HTTPS-Handshake-Ablehnungs-
Tombstone-Route, damit der gestoppte Host nicht auf einen Plattformdienst zurückfällt,
auch ohne verwendbares Kandidatenzertifikat. Die Bereinigung entfernt nur die
zugehörige Generation; veraltete Jobs können kein neueres Deployment ersetzen oder stoppen.

Eine nach abruptem Host-/Prozessverlust gehaltene Sperre erfordert vor einer
gezielten Wiederaufnahme die Betreiberprüfung ihres Eigentümers und des exakten
Hilfscontainers. Lösche keine Sperre, keinen Beleg und keine Route nur deshalb,
weil eine Wiederholung fehlgeschlagen ist. Ausstehende Umschaltungen und
stillgelegte Ressourcen bleiben für einen Abgleich aufgezeichnet. Verwende
niemals globales Docker-Prune oder einen Neustart der primären Plattform zur Bereinigung.

Die Konfiguration bleibt von Harvest/Seed getrennt. Die Umgebungsinstallation
wählt weder die primäre Entwicklungsplattform noch gibt sie den laufenden
Production-Wizard frei. Production verwendet den separaten
[Freigabeablauf des Betreibers](../wizard-production/README.md).

## Zertifikate ohne Proxy-Ausfallzeit

Verwende ein vom Betreiber bereitgestelltes ACME-Webroot, das unter /ssl/acme-http01
geteilt wird. Die gelieferten HTTP-Vorlagen erlauben vor normalen
HTTPS-Weiterleitungen nur /.well-known/acme-challenge/. Ein Standard-HTTP-
Challenge-Server bedient neue Kandidatenhosts, bevor ihre optionale HTTPS-Route
installiert ist. Stoppe den gemeinsamen Proxy nicht zur Erneuerung.

Konfiguriere für jede Zertifikatslinie Certbot-Webroot-Authentifizierung und
einen Deploy-Hook, der vollständige Kette und privaten Schlüssel atomar in die
konfigurierten /ssl/live/<lineage>/-Pfade kopiert, nginx prüft und ihn schonend
neu lädt. Halte private Schlüssel privat. Entferne veraltete eigenständige
Stop-/Start-Erneuerungs-Hooks erst nach ihrer Sicherung und einer erfolgreichen
Trockenprüfung der Webroot-Erneuerung. Ausstellung und Erneuerung bleiben
Betreiberaufgaben, keine CI-Deployment-Berechtigungen.

Das isolierte Manifest deckt Umgebungs-API/-Ablauf, deterministische Rezepte,
abgesicherte GitLab-Upgrades, Eigentum/Wiederherstellung des Hilfsprogramms und
die Bewahrung des Proxys ab. Prüfe außerdem echte manuelle GitLab-Job-Ausführung,
HTTPS-/Browserverhalten und die Bewahrung von Production auf einer entbehrlichen
Plattform. Erfolgreiche Fixtures allein belegen diese Integrationsbedingungen nicht.

## Ein quellcodeführendes Repository

Ein ausdrücklich übernommenes quellcodeführendes Wizard-Projekt hält seinen
Anwendungsquellcode, normale Reviews und native Build-/Umgebungsjobs in einem
Repository. Es wählt `.gitlab/primary.yml`; es benötigt weder ein zweites
Anwendungsrepository noch instanzspezifische eingecheckte Markierungsdateien.
Der serverseitig verwaltete Übernahmebeleg bindet die exakte Projekt-ID,
Namensraum, Standardbranch und das SHA-256-Manifest der freigegebenen allgemeinen
CI- und Build-Skripte. Jobs prüfen diese Dateien unabhängig an ihrem tatsächlichen
Pipeline-Commit. Änderungen an den CI-Erzeugern erfordern eine weitere geprüfte
Übernahme; Anwendungsänderungen folgen dem normalen Merge-Request-Ablauf.

Der allgemeine Job-Starter ist `source-primary.sh`, in der Anwendung als
`.gitlab/delivery/environment.sh` installiert. Er akzeptiert `deploy review`,
`stop review`, `deploy beta` oder `stop beta`. Konfiguriere die folgenden
Projekt-CI-Variablen mit dem gewöhnlichen Umgebungsgeltungsbereich `*`, Rohwerten
und ohne Maskierung oder Schutz:

| Variable | Vom Betreiber angegebener Wert |
| --- | --- |
| `SYSTEM_WIZARD_ENVIRONMENT_IMAGE` | Exakte vorab bereitgestellte saubere System-Hilfs-Image-ID, `sha256:…` |
| `SYSTEM_WIZARD_ENVIRONMENT_OPERATION` | Neue serverseitig verwaltete hexadezimale Reservierungsidentität mit 48 Zeichen |
| `WIZARD_REVIEW_HOST` | Exakter konfigurierter Review-HTTPS-Host oder leer, wenn deaktiviert |
| `WIZARD_BETA_HOST` | Exakter konfigurierter Beta-HTTPS-Host oder leer, wenn deaktiviert |

`WIZARD_DELIVERY_ENABLED=true` aktiviert für diese Instanz den nativen Image-Build
und die Umgebungsjobs. Diese Konfigurationswerte sind keine Zugangsdaten. Sie
müssen Merge-Request-Jobs desselben Projekts zur Verfügung stehen; das kanonische
Hilfsprogramm lehnt weiterhin Jobs anderer Projekte, Forks, abgelöster Reservierungen
oder ungeprüfter Pipelines ab. Production bleibt eine separate bewusste Freigabe.

Stoppe vor der Übernahme eines bestehenden verwalteten Projekts beide optionalen
Umgebungen und verwende die bestehende zugehörige Bereinigung gestoppter Routen.
Prüfe ihren Plan und bestätige, dass sowohl alte Routenfragmente als auch die
zugehörigen Ressourcen fehlen. Die Übernahme lehnt aktive, ausstehende oder
stillgelegte Generationen ab. Bewahre den vollständigen alten Deployment-
Schnappschuss in unveränderlicher Historie und übertrage seine Generationsuntergrenzen
in die neue Reservierung. Setze Untergrenzen nicht zurück und schreibe alte
Projekt-Tombstones nicht als neue Projektaufzeichnungen um. Eine unerwartet
verbliebene Route wird vom neuen Hilfsprogramm abgelehnt.

Der authentifizierte Umgebungsdialog prüft weiterhin DNS und Zertifikate und
aktualisiert Einstellungen über eine ausdrückliche Vorschau. Für ein quellcodeführendes
Projekt aktualisiert er nur die vier zugehörigen CI-Variablen, ohne Quellcode-Commit,
neue Pipeline oder Production-Neustart. Exakte vorherige Werte und Variablenmetadaten
werden unter der bestehenden Sperre geprüft. Unterbrochene Teilaktualisierungen
behalten denselben Vorgang; Status prüft sie ohne Schreibzugriffe, und eine
explizite Bestätigung gleicht nur bekannte alte oder Zielwerte ab. Unerwartete
Variablenänderungen erfordern einen Betreiberabgleich. Die bestehende einzelne
Review-Lease, Generationsschutz, begrenzte Hilfsbereinigung, Rollback und das
Verhalten gestoppter Hosts gelten unverändert.
