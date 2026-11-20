# Optionale Entwicklungsvorschauen nach Quickstart

Quickstart startet den akzeptierten öffentlichen System-Controller und Wizard.
Entwicklungsvorschauen sind ein optionaler Folgeschritt. Schließe zuerst die
allgemeine Konfiguration, die GitLab-Initialisierung, dessen Registry und die
Runner-Registrierung ab. Normale Installationen können ohne Vorschauen fortfahren.

## Voraussetzungen und ausdrückliche Eingaben

Gib einen GitLab-Namensraum und ein kanonisches Wizard-Quellprojekt an. Wähle ein
vorhandenes privates Projekt oder importiere einen öffentlichen HTTPS-Upstream
beziehungsweise Fork in ein neues privates Projekt. Importe erhalten die Historie
von Branches und Tags; ein belegtes Ziel oder geänderte importierte Referenzen
stoppen die Einrichtung. Importiere private Quellen separat mit deinen normalen
GitLab-Zugangsdaten und wähle anschließend das vorhandene Projekt. Zugangsdaten
für die Quelle gehören nicht in die gespeicherten Einstellungen.

Der Klon beginnt beim Standardbranch der ausgewählten Quelle und erhält deren
Branches und Tags. Der Production-Imagepin wählt keinen Quellbranch und
verspricht nicht, dass der Standardbranch einer öffentlichen Quelle der
Wizard-Revision der akzeptierten Version entspricht. Wähle vor dem Import den
gewünschten Standardbranch in deinem eigenen Fork und prüfe den tatsächlichen
Standardbranch des neuen GitLab-Projekts: Die Einrichtung prüft dessen echten
Commit und native Push-Pipeline. Für einen exakten Quellstand importiere ihn
zuerst in GitLab, wähle dort seinen Standardbranch und anschließend
**Vorhandenes privates Quellprojekt verwenden**. Die Einrichtung erhält diese
bestehende Auswahl.

Die Wizard-Quelle muss die geprüfte native Delivery-CI, das aktuelle generische
Build-Rezept und den Umgebungsstarter enthalten. Die geführte Einrichtung prüft
native CI-Erzeugerdateien anhand des festgelegten Wizard-Quellsnapshots des
akzeptierten Controllers, einschließlich Browser- und Umgebungsstarter. Ein Fork
mit geprüften Änderungen an diesen Erzeugern verwendet stattdessen den
ausdrücklichen Source-Primary-Manifestpfad; die geführte Einrichtung genehmigt
nicht ihre eigenen gemeldeten Hashes. Vorhandene Projekte müssen
`.gitlab/primary.yml` auswählen, erfolgreiche Pipelines und geklärte Diskussionen
als Merge-Voraussetzungen erhalten und einem verfügbaren Docker-Runner die
benötigten Tags `docker` und `wizard-source-primary` gewähren. Die Einrichtung
aktiviert die private Auslieferung. Bestehende Veröffentlichungsrollen bleiben
erhalten. Neue Importe deaktivieren ausdrücklich die Optionen für öffentliche
Veröffentlichungen, damit ein Fork keine Upstream-Ziele übernimmt.

Stelle einen unveränderlichen geprüften System-Helfer auf dem Runner-Daemon
bereit und konfiguriere `SYSTEM_WIZARD_ENVIRONMENT_IMAGE` sowie
`SYSTEM_WIZARD_CANONICAL_CONTROLLER` anhand der
[Umgebungsanleitung](../project-bootstrap/wizard-environments/README.md).
Verwende getrennte exakte Review-/Beta-HTTPS-Hosts, öffentliches DNS mit den
vorhandenen Wizard-Adressen und gültige zusammengehörige Zertifikate und private
Schlüssel unter `/ssl`. Die Vorprüfung kontrolliert DNS, exakte
Zertifikatsidentität und Gültigkeit, passende Schlüssel, Quellenverfügbarkeit und
Runner-Zugriff vor der Quellprojektbereitstellung. Die Einrichtung stellt keine
Zertifikate aus und ändert kein DNS.

## Geführte Einrichtung und Wartezeit

Verbinde den Wizard und wähle **Entwicklungsvorschauen einrichten**. Wähle
Namensraum, Quellprojekte, Importquellen und ausdrückliche HTTPS-Eingaben. Review
verwendet einen gemeinsamen Host mit der vorhandenen einzelnen
Merge-Request-Reservierung. Beta ist optional. **Gewünschte Einstellungen
speichern** ändert nur die Einrichtungsvorgabe für die Konfigurationssicherung.

Wähle **Voraussetzungen prüfen**, kontrolliere die Eingaben und bestätige die
Einrichtung ausdrücklich. Quellübertragungen verwenden native Git-Pushes in neu
zugeordnete leere Projekte mit ablaufenden Projekt-Zugangsdaten. Die Zugangsdaten
werden nach der Übertragung widerrufen und gelangen nie in Konfigurationsexporte.
Der Quellimport startet seine echte Push-Pipeline des Standardbranches.
Vorhandene Projekte benötigen einen normalen Quell-Push, wenn keine aktuelle
native Push-Pipeline vorhanden ist.

Build, Quellprüfungen und unabhängige Browserprüfungen können je nach
Runner-Warteschlangen, Downloads und Host-Kapazität mehrere zusätzliche Minuten
oder länger dauern. Eine wartende Einrichtung zeigt den Pipeline-Link. Prüfe nach
deren Abschluss die Voraussetzungen erneut und setze die Einrichtung fort.
Fehlgeschlagene Pflichtprüfungen, fehlende Artefakte, geänderte CI oder ein
abweichendes unveränderliches Image können keine akzeptierte Bindung erzeugen.
Die native [Source-Primary-Prüfung](../project-bootstrap/wizard-source-primary/README.md)
prüft exakten Commit, Pipeline, freigegebene Erzeugerdateien und Digest erneut.

Die Ersteinrichtung erfordert eine unveränderte verwaltete Registrierung und eine
aufbewahrte Installationsidentität. Eine öffentliche Installation bewahrt den
akzeptierten Release-Beleg für das Controller-/Wizard-Paar auf. Sie archiviert die
alte Konfiguration und bindet private Vorschauen, ohne die Hauptkonfiguration oder
die Production-Imageauswahl zu ändern. Vorhandene verwaltete Quellhistorie muss ihren
nativen Übernahme- oder Upgrade-Pfad verwenden. Die Freigabe für Production bleibt separat.

Nachweisabfragen werden innerhalb jeder Prüfphase in begrenzten Gruppen gebündelt.
Dabei bleiben dieselben Projekt-, Pipeline-, Artefakt- und Erzeugerprüfungen erhalten;
das Anwenden eines Plans beschafft neue veränderliche Nachweise, statt einer
zwischengespeicherten Vorschau zu vertrauen. Dadurch sind weniger einzelne
Rails-Starts nötig. Downloads, native Builds und Browserprüfungen benötigen weiterhin
ihre tatsächliche Ausführungszeit; eine feste Einrichtungsdauer wird nicht zugesagt.

### Identität einer aus Quellcode gebauten Installation aufbewahren

Eine aus Quellcode gebaute Installation kann ihr tatsächlich laufendes Image-Paar
aufbewahren, ohne damit ein akzeptiertes öffentliches Release zu behaupten.
Beide konfigurierten Image-Auswahlen müssen unveränderliche `sha256:`-Image-IDs sein.
Controller und Wizard müssen übereinstimmende Labels
`org.system-bootstrapper.test-job` und `org.system-bootstrapper.source-tree`,
ihre jeweiligen Labels `org.opencontainers.image.revision` und beim Wizard das
passende `org.system-bootstrapper.source-revision` tragen. Der paketierte
Wizard-Snapshot muss zur angegebenen Wizard-Revision passen. Die native
System-Kandidatenvorbereitung erzeugt diese zusammengehörigen Herkunftsnachweise
aus dem eingecheckten Quellstand.

Entnehmen Sie die erwarteten Image-IDs, den System-Commit und -Tree sowie den
Wizard-Gitlink unabhängig den geprüften Quell-/Build-Aufzeichnungen. Erfassen Sie
das bereits laufende Paar über den eingecheckten Controller-Einstiegspunkt:

```sh
docker exec system_bootstrapper_1 node /system/bootstrapper/record-source-installation.js \
  --controller sha256:REPLACE_WITH_CONTROLLER_IMAGE_ID \
  --wizard sha256:REPLACE_WITH_WIZARD_IMAGE_ID \
  --source-revision REPLACE_WITH_SYSTEM_COMMIT \
  --source-tree REPLACE_WITH_SYSTEM_TREE \
  --wizard-revision REPLACE_WITH_WIZARD_GITLINK
```

Der Befehl prüft die tatsächlich laufenden Container und die exakte Image-Herkunft
und erstellt dann die Root gehörende Datei `/state/.source-installation.json` mit
Modus 0600. Er installiert, startet, befördert oder akzeptiert keine Images,
ändert keine Hauptkonfiguration, erstellt keinen Release-Beleg und behauptet
keine bestandenen Tests. Die spätere Einrichtung prüft die laufende Identität erneut.
Eine vorhandene ungültige oder unvollständige öffentliche Release-Auswahl darf
nicht auf diesen Quelldatensatz zurückfallen. Bewahren Sie nach einer
Wiederherstellung die Quellherkunft auf oder erfassen Sie sie ausdrücklich erneut
anhand unabhängig aufbewahrter Build-Eingaben, bevor Sie eine neue Ersteinrichtung
starten; Konfigurationsmetadaten allein berechtigen nicht dazu.

## Bereitstellen, stoppen und System-Kandidaten

Eine bereite Einrichtung zeigt die reservierte Review-URL. Sie wird nach einem
erfolgreichen ausdrücklichen nativen **Deploy**-Job nutzbar; **Stop** erhält die
vorhandene zugeordnete Stilllegungsroute. Der kanonische Helfer erzwingt weiterhin
Review-Zuordnung, Generationsuntergrenzen, erfolgreiche Kandidatennachweise und
die getrennten Beta-Steuerungen. Die Einrichtung stellt keinen Kandidaten
automatisch bereit.

Wähle optional ein separates System-Quellprojekt im selben Namensraum. Dies
aktiviert dessen vorhandene Wizard-Vorschaujobs für Merge-Requests auf dem
kanonischen Review-Host. Jeder geprüfte System-Kandidat benötigt weiterhin die
vorhandene ausdrückliche [System-Kandidatenbindung](../project-bootstrap/system-review/bind.js)
vor seiner manuellen Bereitstellung. Das temporäre Netzwerk für die vollständige
Plattformmigration bleibt eine getrennte Prüfanforderung.

## Sicherung, Neuerstellung und sichere Fortsetzung

Normale JSON-/ZIP-Exporte enthalten versionierte Einrichtungsvorgaben in
`previewSetup`. Sie enthalten Namensraum- und Projektnamen, Quellenauswahl und
HTTPS-Pfade. Sie enthalten keine Projekt-IDs der neuen Instanz,
Übertragungszugangsdaten, Pipeline-Nachweise oder laufenden Bereitstellungsbelege.
Ältere Sicherungen ohne dieses Feld bleiben verwendbar. Öffnen, Importieren oder
Abrufen von Einstellungen startet keine Einrichtung und ändert Production nicht.

Führe die Einrichtung nach einer Neuerstellung ohne passenden Seed ausdrücklich
gegen die neue Instanz aus, um neue IDs, Zugangsdaten und Nachweise zu erzeugen.
Eine Konfigurationssicherung allein stellt keine GitLab-Repositories,
Registry-Images oder CI-Artefakte wieder her. Harvest/Seed bleibt der
Wiederherstellungspfad für Dienstdaten.

Die Einrichtung hält während Quellen-, Bindungs- und Umgebungsänderungen die
nativen Projekt- und Live-Zustandssperren. Dadurch können Konfigurations-Push,
Harvest und Host-Wartung nicht gleichzeitig laufen. Lesender Einrichtungsstatus
und Jobabfragen bleiben verfügbar.

Wiederhole innerhalb einer Instanz dieselbe Aktion, um wartende Arbeit
fortzusetzen. Die private Operation erhält zugeordnete Projekt-IDs und
Konfigurationshashes. Geänderte Quellen, Bedieneränderungen, Zuordnungskonflikte
oder eine andere Production-Konfiguration stoppen die Fortsetzung. Ein
unbestätigter Rails-Abschluss, etwa nach Zeitüberschreitung, Verlust der
Docker-Verbindung oder unvollständiger Abschlussantwort, vermerkt
`needs-inspection` und erhält beide exakt zugeordneten Sperren. Status liest nur;
Vorprüfung und Apply können diese Operation nicht fortsetzen. Ein Administrator
muss das Ende der vermerkten Änderung bestätigen und Projekt-, Referenz- und
Variablenergebnisse vor gezielter Wiederherstellung prüfen. Ein fehlgeschlagener
lokaler Job allein beweist nicht, dass Rails beendet wurde. Eine vollständig
beantwortete native Ablehnung gibt ihre eigenen Sperren frei und erlaubt die
gewöhnliche ausdrückliche Fortsetzung.

Eine nach
einem abrupten Prozessverlust verbleibende Operationssperre erfordert die Prüfung
ihres genauen Eigentümers vor gezielter Wiederherstellung. Lösche keine Projekte,
setze keine Belege zurück, entferne keine Reservierungen und erzwinge keinen
Push, um einen Konflikt zu umgehen.

Derselbe Repository-eigene Controller-Einstiegspunkt steht für Bediener bereit,
die eine private Einstellungsdatei bevorzugen:

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/preview-setup/run.js status
docker exec system_bootstrapper_1 node /system/project-bootstrap/preview-setup/run.js preflight /state/preview-settings.json
docker exec system_bootstrapper_1 node /system/project-bootstrap/preview-setup/run.js apply /state/preview-settings.json PREFLIGHT_HASH
```

Verwende Dateimodus `0600`. Gib den exakt bestätigten Hash und dieselben
versionierten Einstellungen wie im Wizard an. Status liest nur; die Vorprüfung
erstellt keine Projekte, Pipelines oder Bereitstellungen. Apply führt nur die
ausdrücklich bestätigte native Einrichtung aus. Die zurückgegebene Review-URL
reserviert einen Host und behauptet vor einer erfolgreichen manuellen
Bereitstellung keine laufende Vorschau.
