# Komponenten- und Plattformtests

Tests sind nach der von ihnen geprüften Infrastrukturkomponente gruppiert. JavaScript,
Bash, Python und Ruby bleiben erhalten, wo sie nützlich sind. Der isolierte Runner führt
nur das ausdrückliche [Manifest](manifest.json) aus; er entdeckt niemals `live/`-Skripte
und startet keine Plattform automatisch.

## Isolierte Prüfungen nachbilden

Aus einem sauberen versionierten Checkout mit verfügbarem Node, Git, tar und Docker:

```sh
node project-bootstrap/wizard-source/package.js
node tests/prepare-context.js
docker build -f tests/Dockerfile -t system-component-tests - < .test-context/context.tar
docker run --rm --network none system-component-tests all
docker run --rm --network none system-component-tests sync
```

Binden Sie weder Docker-Socket noch private Konfiguration, Host-Netzwerk oder Plattform-
Volumes in dieses Kind ein. Fehlt Node auf dem vertrauenswürdigen Host,
bietet `bash project-bootstrap/wizard-source/prepare.sh` den Ersatzweg zur Quellcode-
paketierung. Der Kontext enthält nur erlaubte Blobs aus dem aktuellen versionierten
Git-Baum einschließlich des regulären `wizard/`-Baums bei `system-monorepo-v1`.
Historische Gitlink-Quellen benötigen zusätzlich den validierten separaten Wizard-Snapshot
und exakte rekursive Submodule (`git submodule update --init --recursive`). Er schließt
Git-Metadaten, private/ignorierte/unversionierte Dateien und Arbeitskopieänderungen aus. Committen Sie den
beabsichtigten Code vor der Paketierung; kein Ersatzweg sendet den gesamten Checkout.

Das Image kombiniert per Digest festgelegtes Node 24.22.0/npm 11.19.1 und Ruby 3.4.11 auf
Debian Bookworm/glibc mit Python und Shell-Werkzeugen. Es installiert die versionierte Sync-
Lockdatei und führt `npm run build` aus, dessen Prebuild ESLint ohne automatische Korrektur prüft.
Laufzeit- und gemeinsame Bibliotheksversionen werden beim Bau ausgegeben. Diese Ruby-
Testlaufzeit ist von GitLabs eingebetteter Rails-Laufzeit getrennt.

Die Vorbereitung der Kandidaten-Images führt außerdem
`tests/wizard/configuration-routing-export.js` mit dem tatsächlichen
Konfigurationsexporter des gebauten Wizards vor dem Start der vollständigen Plattform aus.
Die Prüfung umfasst den ersten Save/Fetch/Backup-Rundlauf, den exakten Erhalt des
Serverbelegs und selektives Routing, wenn Fetch die abgeleiteten Repository-Metadaten ergänzt.
Für einen separaten Lauf bauen Sie den Wizard-Exporter mit `npm run build:config-export`
im committeten `wizard/`-Verzeichnis und führen anschließend Folgendes aus:

```sh
node tests/wizard/configuration-routing-export.js --exporter wizard/build-tools/export-configuration.cjs
```

Das Image setzt `SYSTEM_TEST_ISOLATED=1` und ruft `node tests/run.js` auf. Wählen Sie
`all` oder eines von `gitlab`, `sync`, `gitlab-runner`, `bootstrapper`, `nginx`, `wizard`,
`shared` und `performance`. Prüfungen laufen nacheinander mit erzwungenen Zeitlimits je
Eintrag. Fehler, Abbruch oder Zeitüberschreitung erzeugen ein Ergebnis ungleich null. Kind-
prozessgruppen werden bei Zeitüberschreitung beendet; Berichte werden nach jeder Prüfung aktualisiert.
Ein SIGKILL kann keine neuen Berichte schreiben, daher muss die Containergrenze dessen
verbleibende Prozesse bereinigen.

API-Prüfungen binden absichtlich Port **8071** im privaten Netzwerk-Namensraum.
Der Runner verlangt das Isolationskennzeichen, lehnt private Laufzeitkonfiguration
und einen eingebundenen Docker-Socket ab und prüft, ob der Port frei ist. Dieser Schutz
ersetzt den verwerfbaren Container nicht. NGINX-Testvorlagen rendern `/templates` ausschließlich
innerhalb dieses Containers.

JSON- und JUnit-Berichte erscheinen in `test-results/<selector>/`. Um sie aufzubewahren,
binden Sie ausschließlich ein neues Ausgabeverzeichnis ein:

```sh
mkdir -p test-results
docker run --rm --network none \
  -v "$PWD/test-results:/candidate/test-results" system-component-tests all
```

Die Testumgebungen für Host-Kompatibilität und Protokollierung laufen in der
Komponente `bootstrapper`. Die Vorbereitung des Kandidaten-Images führt zusätzlich
eine kleine echte Docker-Rotationsprüfung mit zwei eigenen verwerfbaren
Container-Generationen aus. Sie prüft die tatsächlichen Dateigrößen und die
Dateianzahl sowie das erneute Lesen der Protokolle. Die native
Wiederherstellungsprüfung prüft eigene Protokollierungseinstellungen mit dem
echten Konfigurationsexporter und einer Seed-Wiederherstellung. Umfang und
Befehle stehen im [Host-Betriebsleitfaden](../docs/HOST_OPERATIONS.md).
Die ausdrücklich aktivierte Prüfung `node tests/bootstrapper/paused-controller-docker.js --allow-local-daemon`
verifiziert außerdem mit einem einzelnen ressourcenbegrenzten Container, dass das native Compose
den Controller der Public-Upgrade-Testumgebung nach manuellem Austausch und beim abschließenden Zurücksetzen erkennt und neu erstellt.

## Testorganisation

| Verzeichnis | Umfang |
| --- | --- |
| `gitlab/` | Root-Passwortinitialisierung, Start, Projekte/Vorlagen, Rails-Adapter für Quellcode/Build/Umgebung/Production, private Wiederherstellungszugangsdaten und GitHub-Backup-Transporte |
| `sync/` | Vorschläge, Authentifizierung/Token-Erneuerung, Multipart-Konfigurationsrundläufe und Push-Antwort vor automatischem Neustart |
| `gitlab-runner/` | Bereitstellung des gemeinsamen Pools, Endpunktmigration, managerspezifische persistente Konfiguration/Home und Identitätswiederverwendung |
| `bootstrapper/`, `persistence/`, `seed/` | Dienstverfügbarkeit, Mount-Schutz, persistente Konfiguration, Image-Wiederherstellung, abgeschlossener kalter Harvest/Restore und Dauerhaftigkeit unterbrochener Vorgänge |
| `nginx/` | Standard-Wizard-Routing und zugehörige Review-/Beta-Routenfragmente |
| `wizard/` | Quellcodepaketierung/-import, Build-Rezepte/Bereinigung, API-Abläufe, Upgrades, Review/Beta und bewusste Production-Freigabe/Rollback |
| `shared/` | Runner-/Kontextverträge, Bereinigung/Fehlerweitergabe, Lebenszyklus privater Daemons, Wiederherstellung nur aus Nutzdaten und lokale ACME-Testumgebungen |
| `performance/resources/` | Offline-Verträge zur Ressourcenerfassung und ausdrückliche Messwerkzeuge |

Das Manifest ist maßgeblich für exakte Prüfnamen, Voraussetzungen und Budgets.
Tests verwenden temporäre Dateien, synthetische Git-Repositorys, nachgebildete Rails-/Docker-/API-
Transporte und isolierte HTTP-Prozesse. Ein erfolgreicher Test belegt nicht,
dass ein echtes Registry-Image, ein Browser, Runner oder eine GitLab-Pipeline erfolgreich war.

`sync/push-restart-api.js` prüft eine authentifizierte Multipart-Konfigurations-ZIP:
Eine erfolgreiche Antwort endet, bevor Sync sich beendet, um den Controller-
Neustart auszulösen, während ein fehlgeschlagener Import Dienste verfügbar lässt.

Die Quellkontextverträge prüfen Binärinhalte/Ausführungsmodi, versionierte
Parameter, Snapshot-Hashes, Monorepo-Baumidentitäten und historische Gitlinks und den Ausschluss geänderter/privater Dateien. Übergeordnete
Verträge decken Prüfsummen-/Versionsprüfungen vor Docker, exakte zugehörige Bereinigung,
Erhalt des Hauptfehlers und Diagnose nicht erreichbarer Daemons ab. Wiederherstellungs-
verträge decken vollständige Nutzdatenprüfung vor destruktivem Kopieren, GitLab-Image-
Identität, sauberes Herunterfahren, Zertifikats-Leases und dauerhafte Wiederherstellungsmarker ab.

## GitLab-CI-Grenzen

Die Root-Pipeline verwendet bei Merge Requests und auf dem Standardbranch zwei Kategorien:

- **Dokumentation:** Änderungen, die auf `AGENTS.md`, `README.md`,
  `Prepare-Host.md` im Stammverzeichnis oder Markdown-/PNG-/JPG-/JPEG-/SVG-Dateien unter `docs/` beschränkt sind, führen
  `check:documentation` aus. Es prüft den versionierten Diff mit `git diff --check`
  und validiert geändertes Markdown als regulären UTF-8-Text. Es initialisiert keine
  Submodule, installiert keine Pakete, veröffentlicht keine Laufzeit-Images und startet keine Testplattform.
- **Laufzeit:** Jeder andere Pfad, gemischte Dokumentations-/Codeänderungen und unbekannte
  Pfade behalten die vollständigen nachfolgenden Komponenten-, Image- und Kaltwiederherstellungsprüfungen.
  CI-Konfiguration und Helfer, Infrastruktur, Tests und Wizard-Quellen
  gehören zu dieser Kategorie. Umbenennungen berücksichtigen alten und neuen Pfad; auch das Löschen
  von Laufzeitdateien erhält die vollständige Abdeckung.

Natives `rules:changes:regexp` verlangt GitLab ab Version 19.2. Die gemeinsame Regel erfasst
jeden Pfad außerhalb der Dokumentationsfreigabeliste; eine passende README überstimmt niemals
eine Laufzeitänderung. MR-Vergleiche verwenden die Ziel-Diff-Basis, Standardbranch-
Pushes den vorherigen Branch-Stand. Erste Pushes und Ereignisse ohne Änderungs-
vergleich wählen vorsichtshalber vollständige Prüfungen. Geplante/manuelle Standardbranch-
Durchläufe behalten ebenfalls den vollständigen Pfad. Geschützte Merges verlangen weiterhin eine erfolgreiche aktuelle
Pipeline und aufgelöste Review-Diskussionen. Ein geschützter Standardbranch-Push kann
bei Aktivierung beide Kategorien zu GitHub spiegeln; die Veröffentlichung von Laufzeit-Images bleibt
bedingt und die Production-Freigabe manuell.

`check:documentation` verwendet den bestehenden vertrauenswürdigen `docker`-Runner-Pool der Plattform;
weder ein separater Dokumentationsrunner noch eine Koordinatorregistrierung sind erforderlich. Sein
versionierter Elternprozess `tests/ci-documentation.sh` nutzt die Docker-Befugnis dieses Runners,
um ein kurzlebiges, per Digest festgelegtes Node-Kind als Benutzer 1000 ohne Netzwerk,
Host-Socket, Bind-Mounts, zusätzliche Fähigkeiten oder geerbte CI-Zugangsdaten zu starten. Dies
isoliert die eigentliche Prüfung, nicht den vertrauenswürdigen Elternprozess: Beliebiger ungeprüfter Code
darf nicht auf einem gemeinsamen Socket-Runner eingeplant werden.

Das Kind erhält nur die Git-Objekte der beiden erforderlichen versionierten Snapshots, eine
neue Repository-Konfiguration und die versionierte Prüfung. Private Remote-URLs, Git-
Zugangsdaten/-Konfiguration/-Hooks, unbeteiligte lokale Referenzen, geänderte Dateien und Elternumgebung
werden nicht kopiert. Nur ausdrückliche nicht geheime CI-Diff-Selektoren und eine feste Git-
Safe-Directory-Einstellung gelangen ins Kind; eine leere Docker-Clientkonfiguration
verhindert implizite Proxy-Variableninjektion. Die Prüfung behält ihre strenge Socket-
Ablehnung bei. Der Elternprozess lädt das festgelegte öffentliche Image mit seinen normalen Zugangsdaten,
kopiert den bestehenden Bericht `test-results/documentation/` zurück und entfernt nur seinen
identitätsgeprüften Job-Container. Ein separates `after_script` wiederholt die begrenzte Bereinigung.
Der Dokumentationspfad behält sein dreiminütiges Job-Budget und hat keine Laufzeit-
Artefakte, Builds, Plattformtests oder langlebigen Ressourcen. Bestehende `docker`-Runner-
Tags und Ressourcengrenzen bleiben für vollständige Prüfungen unverändert.

Bilden Sie Auswahl- und Dokumentationsregressionen mit vorhandenem Ruby/Psych,
Node und Git nach, ohne Docker oder zusätzliche Lint-Pakete:

```sh
ruby tests/gitlab/ci-selection.rb
node tests/gitlab/check-documentation.js
```

Diese Tests decken geänderte Pfade, Ereignis-/Veröffentlichungsrollen und echte Git-Diffs ab;
sie ersetzen weder GitLab CI Lint noch die erforderliche Laufzeitpipeline, wenn
CI selbst geändert wird. MR-Commits und zusammengeführte Standardbranch-Commits erhalten eigene Prüfungen;
die Pipeline verwendet kein früheres Kaltwiederherstellungsergebnis anhand gleicher Baumidentität wieder.

Der Laufzeitpfad bereitet den exakten gemeinsamen Wizard-Baum (bei historischen Quellen den
rekursiven Wizard-Gitlink) und die minimalen Build-Kontexte in `prepare:wizard-source` vor. Nachgelagerte Jobs verlangen, dass Archiv-
prüfsumme und aufgezeichnete Version zu `CI_COMMIT_SHA` passen; fehlende, beschädigte oder
veraltete Artefakte führen vor der Docker-Ausführung zum Fehler.

Acht Komponentenmatrix-Jobs laufen vor der Veröffentlichung. Jeder ist ein vertrauenswürdiger Elternprozess
mit festgelegter Docker CLI, `services: []` und dem bestehenden Runner-Tag `docker`.
Er ruft `sh tests/ci-isolated.sh <component>` auf, baut aus dem geprüften stdin-
Archiv und führt dann ein socketfreies, netzwerkdeaktiviertes Kind ohne geerbte CI-
Zugangsdaten aus. Berichte verlassen es über `docker cp`, da der Checkout-Pfad eines Jobs
auf dem Docker-Host nicht existieren muss.

Der bestehende Socket-Runner gibt dem Elternprozess Host-Docker-Befugnis; das Deaktivieren von
DinD-Diensten entfernt diese Befugnis nicht. Dieser Aufbau ist für vertrauenswürdigen Code,
nicht für feindliche Merge Requests auf einem gemeinsamen privilegierten Runner. Die Tests
stellen keinen zusätzlichen Runner bereit.

`prepare:wizard-source` prüft vor der Paketierung auch die gebündelten Docs gegen die vollständigen öffentlichen
Anleitungsquellen. Bearbeiten Sie zur Aktualisierung des Readers die Originalanleitungen,
führen Sie `python3 docs/export-wizard-docs.py` aus und committen Sie den erzeugten Wizard-Katalog
im selben System-Commit. `node docs/check-wizard-docs.js` prüft Quellabweichung und
Volltexterhalt; `python3 docs/test-export-wizard-docs.py` prüft Kapitel-,
Link- und Offline-Bildabdeckung während der Bearbeitung.

Der erforderliche Job `test:wizard-browser` verarbeitet einen separat prüfsummengesicherten Kontext
aus demselben versionierten Wizard-Baum; historische Gitlink-Eingaben behalten ihre getrennte Identität. Sein vertrauenswürdiger Elternprozess baut die Browser-
Werkzeuge und führt die vollständige native Playwright-Suite in einem netzwerkdeaktivierten Kind
ohne Host-Socket, private Konfiguration oder Job-Zugangsdaten aus. Das Kind hat
2 GiB Arbeitsspeicher, zwei CPUs und ein Limit von 512 Prozessen. Berichte und JUnit verlassen es über
`docker cp`; die identitätsgeprüfte Bereinigung entfernt ausschließlich Kind und Image dieses Jobs.
Dies erhält Browserabdeckung in derselben System-Pipeline, wenn ein gemeinsames Release
keine separate Wizard-Quellcodepipeline nutzt.

Namen enthalten numerische Projekt-/Job-IDs. Traps und `after_script` entfernen ausschließlich die
exakt dem Job zugehörigen Container/Images. Das achtminütige Skriptbudget lässt Bereinigungs-
reserve innerhalb des zehnminütigen Jobs und jeder Bereinigungsbefehl ist begrenzt. Separate
JSON-Belege beim Ende und nach dem Skript unterscheiden erfolgreiche Abwesenheit von Daemon-
oder Entfernungsfehlern. Ein Bereinigungsfehler lässt ein sonst erfolgreiches Skript fehlschlagen,
während ein bestehender Fehler erhalten bleibt. GitLab macht aus einem Haupterfolg nicht allein deshalb einen
Fehler, weil `after_script` fehlschlägt; bewahren Sie daher dessen separate Diagnose auf.
SIGKILL oder Host-Verlust können beide Hooks verhindern; wiederholen Sie anhand der aufbewahrten zugehörigen Belege,
sobald der Daemon erreichbar ist. Ersetzen Sie dies niemals durch globale Docker-Bereinigung.

## Schranken für Gesamtsystem und Plattform

`test:candidate-image` baut `system/Dockerfile` aus versionierten Laufzeit-Blobs
und dem validierten Wizard-Snapshot unter Verwendung von `.candidate-context/`. Beide Kontext-
paketierer unterstützen GNU- und BusyBox-tar. Das vollständige Image installiert festgelegte Sync-
Abhängigkeiten und kompiliert Sync. Ein socketfreies, netzwerkdeaktiviertes Kind prüft
Laufzeit-/Lint-/Compiler-/Compose- und Snapshot-Verträge; Artefakte verzeichnen Quellcode,
exakte Image-Identität und JUnit-Ergebnisse.

Bilden Sie Paketierung und Bau nach Vorbereitung des Wizard-Snapshots nach:

```sh
node tests/prepare-candidate.js
docker build -f system/Dockerfile -t system-candidate:local - < .candidate-context/context.tar
```

`test:platform-candidate` führt dann einen separat autorisierten privilegierten verwerfbaren
Docker-Daemon aus und blockiert die Veröffentlichungsphase. Es baut Controller/Wizard aus
versionierten Parametern und lädt festgelegte GitLab-/Runner-/Helfer-/NGINX-Images vor. Sein vollständiges
Szenario deckt echtes GitLab-/Runner-/Registry-CI, eine bewusste Fehlerschranke,
Konfigurationsexport, kalten Harvest, Entfernung des Originalhosts und Wiederherstellung aus
Konfigurations-ZIP plus abgeschlossenem Seed in andere leere Pfade ab. Es prüft
ungecachte private Wizard-Image-Wiederherstellung und tatsächliche lokale ACME-Erneuerung/-Bereitstellung.
Siehe [Integrationsanleitung](e2e/README.md) für ausdrückliche Parameter, Ressourcengrenzen,
Bereinigung und Grenzen; weder bestehende Host-Daten noch private Konfiguration sind Eingaben.

Registry-Prüfung, privates Wizard-Derivat und der Root-GitLab-Veröffentlichungsbuild
verwenden `--provenance=false --sbom=false`: Betroffene Docker-/GitLab-Kombinationen lehnen
eine vor ihrem Gegenstand hochgeladene Attestierung mit `blob unknown to registry` ab. Siehe
[Docker-Attestierungsdokumentation](https://docs.docker.com/build/metadata/attestations/).
Registry-Digest-, Pull-/Run- und Artefaktprüfungen bleiben erforderlich; diese Wege
beanspruchen keine Attestierungsprüfung. Anderes Metadatenverhalten von Kandidaten-Images bleibt
unverändert.

## Statische Sicherheitsprüfung

Merge Requests mit Laufzeitänderungen und Builds des Standardbranches führen den
erforderlichen Job `test:codeql` parallel zu den Komponentenprüfungen aus. Er prüft
den versionierten System-Quellcode und den exakten eingebetteten Wizard-Baum (oder historischen Gitlink-Snapshot) mit CodeQL 2.27.4
und dessen offizieller Standard-Code-Scanning-Suite für JavaScript/TypeScript.
Keine Regeln, Pfade oder alten Befunde werden unterdrückt. Das festgelegte
öffentliche CLI-Bundle wird vor der Verwendung anhand seiner Prüfsumme geprüft.
Der Scan-Kindcontainer hat weder Netzwerk noch Docker-Socket oder Zugangsdaten
und kann keine Anwendungs-Builds ausführen.

Für die CodeQL CLI gelten eigene [Lizenzbedingungen](https://github.com/github/codeql-cli-binaries/blob/main/LICENSE.md).
Die kostenlose automatisierte Nutzung setzt eine auf GitHub gehostete und gepflegte
Open-Source-Codebasis voraus; ein externer GitLab-Runner wird unterstützt. Ein privater
oder ausschließlich auf GitLab gepflegter Fork muss seine Lizenzberechtigung vor
Ausführung dieses Jobs klären. Die MIT-Lizenz des Projekts gewährt keine CodeQL-Lizenz,
und der Job schließt kein Abonnement ab. Rechenleistung und Speicher des Runners
liegen weiterhin in der Verantwortung des Betreibers.

`node tests/prepare-codeql.js` paketiert nach der normalen Wizard-Quellvorbereitung
die versionierten Eingaben. `sh tests/ci-codeql.sh` führt diesen geprüften Kontext
auf dem ausgewählten vertrauenswürdigen Docker-Runner mit dessen üblichen
CI-Identitätsvariablen aus. Der Kindcontainer ist auf 6 GiB RAM und zwei CPUs
begrenzt; Image-Vorbereitung und Scan haben jeweils ein Zeitlimit von 15 Minuten.
Dieser statische Job startet keine verwerfbare Plattform. SARIF-Ergebnisse,
Extraktionsabdeckung, Quellidentitäten und Bereinigungsnachweise werden unter
`test-results/codeql/` aufbewahrt. Fehlende Abdeckung oder ein beliebiger Befund
lassen den Job fehlschlagen. Breitere Qualitätssuites können getrennt zur
Einzelfallprüfung ausgeführt werden; ihre zusätzlichen Heuristiken sind nicht
mit dieser Standard-Sicherheitsprüfung gleichzusetzen.

## Ausdrückliche Live-Adapter

Skripte unter `*/live/` verlangen eine vom Betreiber vorbereitete verwerfbare Plattform. Einige
verwenden feste `system_*`-Namen, localhost-Routen, vorbereitete Nutzdaten und private
Zugangsdaten. Sie dürfen weder Production noch eine Arbeitsplatzinstallation ansprechen.
Ruby-Prüfungen laufen innerhalb von GitLabs eingebettetem Rails; Python-Treiber benötigen Python 3.
Der isolierte Runner führt sie niemals durch Glob-Suche aus.

`wizard/live/build.js` verlangt `SYSTEM_WIZARD_LIVE_ACCEPTANCE=true` und ein ausdrückliches
numerisches `SYSTEM_WIZARD_EXPECTED_PROJECT`. Übergeben Sie Sync-Zugangsdaten privat in
der Kandidatenumgebung, nicht in Befehlsargumenten oder Protokollen. Es importiert Quellcode und
aktiviert echtes CI in diesem verwalteten Repository, prüft wiederholte Quellcode-/Pipeline-
Identität und erforderliche Build-/Browser-/Digest-Nachweise und erhält die Production-
Adresse. Es ruft niemals Bereitstellungs-, Reset-, Seed-, Push- oder Neustart-Endpunkte auf.
Seine private Nachweisdatei ist `/tmp/wizard-build-live-evidence.json` und sein Gesamt-
budget beträgt 65 Minuten. Es erneuert Zugriffstoken vorbeugend und wiederholt ein
GET mit Authentifizierungsfehler einmal; verändernde POSTs werden niemals blind wiederholt.

`wizard/acceptance-driver.js` prüft diese Polling-/Erneuerungs-/Fristverträge
mit Offline-Transporten. Build-Abnahme allein belegt weder MR-Fehler,
Review/Beta noch Production-Freigabe oder Rollback. Verwenden Sie die entsprechenden
[Umgebungs-](../project-bootstrap/wizard-environments/README.md) und
[Production-Verfahren](../project-bootstrap/wizard-production/README.md) für
diese ausdrücklichen Vorgänge.
