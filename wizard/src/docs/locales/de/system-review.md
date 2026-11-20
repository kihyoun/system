# Optionale Wizard-Beta aus dem System-Kandidaten

System und Wizard teilen ein Repository. Die optionale Wizard-Beta verwendet eine
feste HTTPS-Adresse und exakt das Wizard-Image eines akzeptierten System-Kandidaten.
Sie startet weder einen zusätzlichen Build noch eine vollständige Plattformpipeline.
Production wird getrennt und bewusst freigegeben. Normale Anwendungsprojekte behalten
Review, Beta und Production. Ein isolierter Plattformtest ist eine vorübergehende
Prüfinstallation und keine dauerhaft betriebene Beta-Plattform.

## Einrichten und binden

Importiere oder forke das vollständige System-Repository mit dem normalen
GitLab-Repository-Ablauf in deinen privaten Namensraum. Schütze den Standardbranch,
aktiviere die erforderlichen Pipeline- und Diskussionsfreigaben und verwende die
CI-Konfiguration im Repository-Stamm. Konfiguriere einen zugelassenen Docker-Runner.
Wähle im Wizard Configure System Beta, das bestehende gemeinsame Quellprojekt und
optional einen exakten HTTPS-Beta-Host mit Zertifikat und Schlüssel unter /ssl.
Ein Review-Host ist nicht erforderlich. Die Vorprüfung kontrolliert Quellbaum,
DNS und Zertifikat; die Bestätigung reserviert nur Einstellungen. Sie erstellt
keine Projekte, startet keine Pipelines und verändert Production nicht.

Nachdem der System-Kandidat alle Pflichtprüfungen bestanden hat, verwende das
Repository-Werkzeug mit einer privaten JSON-Eingabedatei. Die Eingabe enthält
operation, projectId, projectPath, namespaceId, defaultBranch, pipelineId,
candidateJobId, sourceCommit, wizardSourceTree, helperImage, wizardImageId und
wizardImageRef. Übernimm die exakten Werte aus den akzeptierten Release-Metadaten
und der konfigurierten Reservierung. Der Quellcommit bezeichnet das gemeinsame
Repository, der Wizard-Baum dessen versioniertes Unterverzeichnis. Bewahre das
Helper-Image für Stop auf.

```sh
node project-bootstrap/system-beta/bind.js plan /state/beta-input.json
node project-bootstrap/system-beta/bind.js apply /state/beta-input.json PLAN_HASH
```

Prüfe den Plan, bevor du seinen exakten Hash bestätigst. Setze die nativen
Projektvariablen SYSTEM_BETA_OPERATION und WIZARD_BETA_HOST auf die Operation und
den exakten Host der Reservierung. Deploy und Stop sind ausdrückliche manuelle
System-Pipeline-Jobs. Sie verwenden vorhandene Release-Artefakte und unveränderliche
Images. Vor dem Routing werden Projekt, Job, Kandidatenpipeline, gemeinsamer
Quellbaum, Image-Identitäten, Speicher-/Upgrade-Abnahme und Browserbereinigung
geprüft. Es gibt keinen Endpunkt für beliebige Images. Stop bleibt bei abgelaufenen
Build-Artefakten möglich.

## Bestehende Installationen und Wiederherstellung

Alte JSON-/ZIP-Konfigurationen bleiben lesbar und passiv. Öffnen oder Fetch einer
Sicherung erstellt keine Projekte oder Deployments. Alte gewünschte Vorschauwerte
bleiben Version 1, bis der Benutzer ausdrücklich Configure System Beta auswählt.
Review-Werte werden nicht als Beta-Hosts umgedeutet. Bestehende Repository-Identitäten,
verwaltete Quellenbelege, Benutzeränderungen und Importhistorie bleiben erhalten.

Neue System-Review-Deployments und Bindungen entfallen. Stoppe ein aktives altes
Review mit dem ursprünglichen aufbewahrten Job und seiner Bindung über den alten
Launcher im Stop-Modus. Verwende danach die Bereinigung eigener gestoppter Routen.
Prüfe ausstehende und ausgemusterte Ressourcen vor der Migration. Die Bereinigung
prüft exakte Operation, Projekt, Generation und Labels; Production und fremde
Projektressourcen werden nicht entfernt. Lösche niemals Bindungen, Belege,
Generationsgrenzen oder Tombstones, um einen Konflikt zu umgehen. Beta-Einrichtung
verweigert aktive, ausstehende, ausgemusterte oder unbereinigte gestoppte Routen.

```sh
node project-bootstrap/system-review/run.js stop
node project-bootstrap/wizard-environments/cleanup-stopped.js OPERATION
```

Der Stop-Launcher benötigt die ursprüngliche Jobidentität und das aufbewahrte
Helper-Image. Führe ihn im ursprünglichen autorisierten Job aus; erfinde keine
CI-Nachweise. Kann dieser Job nicht laufen, verwende die aufbewahrten historischen
Release-Werkzeuge und den Eigentumsbeleg zur Wiederherstellung. Bindungen und
Historien gehören zum persistenten Controllerzustand und müssen die passende
Harvest-/Seed-Wiederherstellung begleiten. Konfigurationssicherung und Dienstdaten
bleiben getrennt. Historische Releases ohne Quelllayout behalten ihre separate
Wizard-Gitlink-Identität; deute deren Commit niemals als gemeinsamen Baum um.

## Prüfung und Kapazität

Komponenten- und Kandidatenfreigaben bleiben verpflichtend. Fixtures für Bindung,
Launcher und Verifier prüfen fremde Eigentümer, veraltete Jobs, Image-/Quellkonflikte,
Zugangsdatenbereinigung und Stop mit abgelaufenen Artefakten. Vergleiche Laufzeiten
und Ressourcenverbrauch vergleichbarer akzeptierter Kandidatenläufe. Das Entfernen
optionaler Review-Jobs verkürzt allein nicht den vollständigen isolierten
Plattformtest; eine gemessene Einsparung wird damit nicht behauptet.
