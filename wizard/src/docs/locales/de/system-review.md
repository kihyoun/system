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

Lies die Reservierungsoperation am authentifizierten Sync-Statusendpunkt
/projects/wizard/preview-setup. Ordne in release.json des akzeptierten Kandidaten
sourceRevision dem Feld sourceCommit, imageId dem Feld helperImage und
wizardRegistryReference dem Feld wizardImageRef zu. Übernimm projectId, pipelineId,
candidateJobId, wizardSourceTree und wizardImageId exakt. projectPath, namespaceId
und defaultBranch stammen aus demselben ausgewählten gemeinsamen GitLab-Projekt.
Das Helper-Image muss auf dem Docker-Host des Controllers bereits mit den exakten
akzeptierten Quell-/Job-Labels vorhanden sein; bewahre es für Stop auf. Werte einer
anderen Pipeline können diese Reservierung nicht autorisieren.

```sh
system-bootstrapper system-beta bind plan /state/beta-input.json
system-bootstrapper system-beta bind apply /state/beta-input.json PLAN_HASH
```

Führe das Bindungswerkzeug aus dem geprüften Checkout auf dem Docker-Host des
kanonischen Controllers mit Node 24 und Zugriff auf dessen Docker-Socket aus.
Die private Eingabe wählt einen Kandidaten aus; sie enthält keine Zugangsdaten.
Prüfe den Plan vor Bestätigung seines exakten Hashes. Öffne anschließend die bereits
geprüfte geschützte Standardbranch-Push-Pipeline und starte deploy:wizard-beta oder
stop:wizard-beta manuell. Die optionalen Jobs sind ohne aktivierende Projektvariable
vorhanden; Einrichtung und Bindung starten keine weitere Pipeline. Der Launcher
liest die explizite persistente v2-Bindung, prüft Projekt, Pipeline und Quellcommit
des aktuellen Jobs dagegen und liest den exakten HTTPS-Host der gebundenen Reservierung.
Fehlende, veraltete oder fremde Bindungen werden abgelehnt. Deploy erstellt niemals
eine Bindung. Erhaltene Variablen SYSTEM_BETA_OPERATION und WIZARD_BETA_HOST müssen
übereinstimmen oder bewusst entfernt werden. Ein manuell bereitgestelltes API-Token
ist für diesen Startpfad nicht erforderlich. Nach Erfolg einschließlich eigener
Helper-Bereinigung liefert test-results/system-beta/environment.env die Variable
SYSTEM_BETA_URL für GitLabs Umgebungslink. Deploy und Stop verwenden vorhandene Release-Artefakte und unveränderliche
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
system-bootstrapper system-review stop
system-bootstrapper project-environments-cleanup OPERATION
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

Das wegwerfbare Plattformszenario deklariert `native-lifecycle-with-contract-verifier`.
Gemeinsame Einrichtung, Bindung, Docker-Beta-Deploy/Stop, exaktes Host-TLS, Erhalt
von Production und eigene Ressourcenbereinigung laufen nativ. Sein Autorisierungsprüfer
verwendet `contract-fixture`-Nachweise: Der übergeordnete Kandidat läuft noch und kann
sich nicht als abgeschlossene Pipeline selbst autorisieren. Positive und negative
Verträge prüfen den Production-Verifier separat. Production-Launcher besitzen keinen
Fixture-Schalter. Offline-Tests oder eine reine Vorprüfung belegen keinen abgeschlossenen
nativen Lauf.
