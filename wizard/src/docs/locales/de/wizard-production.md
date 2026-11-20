# Bewusste Wizard-Production-Freigabe und Wiederherstellung

Die Production-Freigabe ist ein ausdrücklicher Betreiberbefehl im kanonischen
Controller und kein automatisch aktivierter GitLab-Job. Review/Beta bleiben
separate manuell bereitgestellte Kandidatenumgebungen.

## Voraussetzungen und exakter Plan

Verwende den geprüften passenden Controller-Quellcode und bewahre das vorherige
Wizard-Image auf dem Daemon auf. Eine private Pipeline im eigenen GitLab muss
erfolgreiche erforderliche Jobs `build:wizard` und `test:wizard` mit passenden
Quellcode-/Pipeline-/Registry-Digest-Artefakten haben. Moderne Nachweise müssen
Lint, Vitest, TypeScript/Build, dargestellte Oberfläche, Projekte, SPA, echte
Konfigurations-ZIP und exakte Cube-Prüfung enthalten. Prüfe einen separaten
Kandidaten, bevor du Production anwendest. Lade genau diesen Registry-Digest
vorab über den authentifizierten Betreiber/Runner; das Hilfsprogramm akzeptiert
niemals ein Tag und lädt nicht mit Bereitstellungszugangsdaten.

Schreibe eine Nachweis-JSON mit Modus 0600 unterhalb des persistenten
Konfigurationsverzeichnisses, zum Beispiel `/state/wizard-production-proof.json`
im Controller:

```json
{
  "version": 1,
  "projectId": 42,
  "projectPath": "example/wizard",
  "pipelineId": 100,
  "sourceCommit": "REPLACE_WITH_THE_EXACT_GITLAB_PIPELINE_SHA",
  "imageRef": "registry.example.test/example/wizard@sha256:REPLACE_WITH_THE_64_HEX_DIGEST",
  "productionHost": "bootstrapper.example.test"
}
```

Die IDs sind Beispiele; verwende die tatsächlich geprüfte Pipeline und das Image.
Hole einen schreibgeschützten Plan, prüfe seine aktuellen/Ziel-Image-IDs, Hashes
und den Host und kopiere dann seinen exakten `planHash` in den Apply-Befehl:

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js plan /state/wizard-production-proof.json
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js apply /state/wizard-production-proof.json PLAN_HASH
```

Apply prüft unabhängig das exakte private GitLab-Projekt, die erfolgreiche
Pipeline, erforderliche nicht optionale Jobs und passende Artefakte über
temporäre serverseitige API-Zugangsdaten, die widerrufen werden. Zugangsdaten
oder Konfigurationsinhalte werden nicht ausgegeben. Aktuelle Konfiguration,
Route, kanonische Containeridentität, Image und Plan-Hash müssen weiterhin
übereinstimmen. Der ursprüngliche Cube mit 1184 Zeichen bleibt unverändert;
Image-Überschreibungen werden danach als wörtliche Zuweisungen angehängt.

Für ein ausdrücklich übernommenes [quellcodeführendes Repository](../wizard-source-primary/README.md)
wird der native Pfad `.gitlab/primary.yml` nur bei exakter kanonischer Bindung von
Projekt-ID/-Pfad/-Namensraum, aktivierten Merge-Bedingungen und freigegebenen
CI-Datei-Hashes akzeptiert. Seine Pipeline muss ein nativer Push auf den
Standardbranch am aktuellen Kopf sein, mit allen erforderlichen Quellcode- und
Auslieferungsjobs erfolgreich. Ein allein nicht grüner `deploy:github`-
Veröffentlichungsjob blockiert den privaten Ablauf nicht; andere erforderliche
Fehler, übersprungene Prüfungen, fremde Jobs oder fehlende Nachweise werden abgelehnt.
Ein fremdes Projekt mit ähnlich benannten Jobs oder eine per API erzeugte Pipeline
wird abgelehnt. Die bestehende Prüfung von Legacy-`.system-bootstrapper/ci.yml`
bleibt unverändert.

## Umschaltung und aufbewahrter Zustand

Der Befehl erwirbt den bestehenden persistenten Wizard-Umgebungs-Mutex.
Sync-Übertragen/-Steuerung und andere Umgebungsjobs beachten diesen Mutex.
Er speichert atomar einen privaten Prüfpunkt unter `/state/wizard-production/`
und erstellt dann einen eindeutig markierten Kandidaten mit einer Begrenzung
auf 128 MiB/0,5 CPU im aktuellen Wizard-Netzwerk. Erst wenn dieser Kandidat gesund
ist, aktualisiert er die einzelne Adresse `upstream wizard` und prüft/lädt den
bestehenden NGINX-Prozess neu. Andere Routen bleiben bytegetreu erhalten. Der
alte kanonische Wizard läuft zu diesem Zeitpunkt noch.

Während der geprüfte Kandidat Production bedient, fixiert das Hilfsprogramm
`WIZARD_IMAGE` in der persistenten Konfiguration, erstellt ausschließlich den
kanonischen Wizard mit `--no-deps --pull never` neu, prüft sein exaktes Image und
seinen Gesundheitszustand und leitet denselben Upstream auf seine tatsächliche
Adresse um. Proxy, GitLab, Controller und Runner werden nicht neu gestartet.
Der Prüfpunkt bewahrt die vorherige unveränderliche Image-ID, private
Konfigurations-/Vorlagenbytes und die abgeschlossenen aktiven Hashes. Zugehörige
Kandidatenressourcen werden anschließend nach Prüfung ihrer Markierung über
ihre vollständige ID entfernt.

Ein fehlgeschlagener Kandidat erstellt den kanonischen Wizard nicht neu.
Ein Routen-/Neuladefehler stellt die alte Route wieder her. Ein späterer Fehler
stellt das vorherige unveränderliche Image wieder her, verwendet dessen dabei
entstandene tatsächliche Adresse und stellt die alte Konfiguration wieder her.
Bewahre das vorherige Image und den privaten Prüfpunkt auf, bis ein bewusster
Rollback getestet wurde.

## Öffentliche Betreiberangaben während der Umschaltung

Der normale Start veröffentlicht nur die sechs öffentlichen Website-Felder aus
der signierten gespeicherten Konfiguration in der persistenten Datei
`wizard-public/privacy-instance.json`. Der Controller schreibt dieses Verzeichnis;
der kanonische Wizard bindet es schreibgeschützt ein und liefert
`/privacy-instance.json` ohne Sync-Authentifizierung aus. Bearbeite diese Werte
unter **Allgemein → Website** und übertrage dann wie gewohnt. Sie bleiben Teil
der normalen JSON-/Umgebungs-/ZIP-Konfigurationssicherung. Beispielname, -adresse
und -E-Mail sind bis zu ihrer Ersetzung Beispiele; ausdrücklich gelöschte Werte
bleiben leer. Optionaler Datenschutztext, Hinweis-URL und die Aufbewahrungsdauer
von Zugriffsprotokollen haben keine erfundenen Standardwerte.

Bereite vor der Freigabe die aktualisierte persistente Struktur vor und ersetze
den Controller durch das passende geprüfte Image. Dieser Schritt erfordert
nicht, zuerst den aktuellen Wizard zu ersetzen. Der Freigabeplan prüft die
bestehende Controller-Konfiguration und die Metadaten öffentlicher Bind-Volumes,
verifiziert, dass sie Geschwisterverzeichnisse auf demselben eingehängten
Dateisystem sind, und prüft, dass die öffentliche JSON zur gespeicherten
Konfiguration passt. Ein bestehender kanonischer öffentlicher Mount muss
schreibgeschützt sein.

Der temporäre Kandidat erhält nur das geprüfte öffentliche Hostverzeichnis als
schreibgeschützten Bind-Mount. Er erhält keine private Konfiguration, Zugangsdaten
oder einen Docker-Socket. Ein fehlendes Quellverzeichnis führt zum Abbruch, statt
ein neues von Docker verwaltetes Volume auf der Root-Festplatte zu erzeugen.
Der erste Übergang unterstützt auch einen älteren kanonischen Wizard ohne diesen
öffentlichen Mount; der aktualisierte Controller ist für sein bereits
bereitgestelltes öffentliches Verzeichnis maßgeblich. Kanonische Neuerstellung
und Rollback behalten den normalen Compose-Mount. Bereite den Speicher über die
Host-Vorprüfung vor; umgehe niemals Mount-Volume-/UUID-Prüfungen, um dieses
Verzeichnis anzulegen.

## Bewusster Rollback

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js rollback-plan
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js rollback PLAN_HASH
```

Rollback erfordert, dass der abgeschlossene Prüfpunkt noch zu aktivem Image,
Konfiguration und Route passt. Er verwendet dieselbe Umschaltung mit gesundem
Kandidaten und bewahrt aktuelle Einstellungen, während er das aufbewahrte
vorherige Image auswählt. Er behauptet nicht, dass das vorherige Image von der
neuen Pipeline gebaut wurde.

## Unterbrochene oder widersprüchliche Wiederherstellung

Eine gleichzeitige Dateibearbeitung wird niemals überschrieben. Wenn ein sicherer
automatischer Rollback nicht abgeschlossen werden kann, bleiben der gesunde
zugehörige Kandidat, der private Prüfpunkt und der gemeinsame Mutex für einen
Abgleich erhalten; gewöhnliches Übertragen/Neustarten bleibt blockiert. Lösche
diesen Mutex nicht blind und entferne nicht den Kandidaten, der gerade die
Oberfläche bedient.

Prüfe nach Ende des ursprünglichen Hilfsprozesses den privaten Prüfpunkt und
löse externe Konfigurations-/Vorlagenänderungen ausdrücklich auf. Erstelle dann
eine Vorschau der Wiederherstellung und bestätige sie:

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js recover-plan
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-production/run.js recover PLAN_HASH
```

Die Wiederherstellung lehnt einen noch laufenden ursprünglichen Prozess oder
einen geänderten Sperreigentümer ab. Sie verlangt die erwarteten exakten
Dateiinhalte, stellt vorheriges Image/Route wieder her, bereinigt nur zum Vorgang
gehörende Kandidaten und löst nur ihren passenden Mutex. Prüfpunkt und Image
sind lokaler persistenter Wiederherstellungszustand und kein Ersatz für die
separate Konfigurations-ZIP und den Harvest-Seed.

## Umfang der Prüfung

Offline-Regressionen decken veraltete Bestätigungen, ungültige GitLab-Nachweise,
Kandidatengesundheit, verlorene Erstellungsantworten, Fehler beim Routen-Neuladen,
kanonische Gesundheitsfehler mit geänderter Rollback-IP, gleichzeitige
Schreibzugriffe, aufbewahrten Mutex/Abgleich und expliziten Rollback ab. Die
Ruby-Nachweis-Fixture lehnt Abweichungen bei privatem Projekt, Quellcode,
optionalen Jobs, Digest und modernen Prüfungen ab und prüft den Tokenwiderruf.
Das sind Komponentenprüfungen. Prüfe eine echte erfolgreiche Pipeline, einen
separaten Kandidaten, Production-Freigabe und Rollback auf deiner eigenen
Infrastruktur, bevor du dich bei einem verfügbar zu haltenden Dienst auf das
Verfahren verlässt.
