## 5. Ein laufendes System weiterentwickeln

Für ein unverändertes offizielles Release mit dem [öffentlichen Upgrade-Leitfaden](RELEASES.md#upgrade-and-rollback)
und der versionsabhängigen Wizard-Docs-Checkliste beginnen. Der Repository-Befehl
plant und bestätigt ausschließlich deklarierte getestete Übergänge. Quickstart
bleibt für Neuinstallationen. Eigene Quellbuilds und Forks nutzen den unten
beschriebenen Nachfolgerablauf; eine Veröffentlichung aktualisiert keine Installation.

[Architektur, Ursprung und Vision](ARCHITECTURE.md) erläutert das Generationenmodell,
den Repository-Wegweiser, das historische Diagramm und die Grenze zwischen heutigen
Werkzeugen und künftiger autonomer Erneuerung.
[Abhängigkeitsaktualisierungen im Betrieb](DEPENDENCY_UPDATES.md) erläutern Erkennung,
ausdrückliche Freigabe, gruppierte Vorschläge und Wiederherstellung des dedizierten Bots.
Der [Sicherheitsleitfaden für Abhängigkeiten](DEPENDENCY_SECURITY.md) erläutert Lockfile-Prüfungen und kompatible Korrekturen.

Systementwicklung verwendet die Entwicklungsplattform, um den Quellcode zu ändern,
aus dem ihr Nachfolger erstellt wird. Generation **A** beherbergt Quellcode,
Anforderungen, Merge Request, Runner und Image-Registry. Ihre Pipeline erstellt
und prüft Generation **B**. Nach Prüfung und bewusster Freigabe stellt B dieselben
Werkzeuge für die nächste Änderung bereit. Ein bloßer Neustart von A oder der
Neuaufbau eines unveränderten Images weist keine Verbesserung nach.

Der Quellcode ist die DNA; der Dienstzustand ist eine gesonderte Eingabe. Weder
ein öffentlicher Codespiegel noch ein Container-Image enthält Benutzer,
Repositories, Issues, Merge Requests, Registry-Blobs oder
Verschlüsselungsgeheimnisse einer Installation. Ein Nachfolger muss diese
Eingaben erhalten und die Containerdefinitionen reproduzieren.

### 5.1 Voraussetzungen und Zuständigkeit

Die folgenden Host-Freigabebefehle richten sich an eine Ubuntu-Installation mit
konfiguriertem GitLab-HTTPS-Ursprung. Der lokale WSL-/HTTP-Weg für die
Erstinstallation ist gesondert. Bereiten Sie vor dem Anlegen der Änderung
Folgendes vor:

| Eingabe | Anforderung |
| --- | --- |
| Freigegebener Quellcode | Eine unveränderte, geprüfte Systemrevision und ihr exakter rekursiver Wizard-Submodul-Commit. Jeder Einstieg für Initialisierung, Wiederherstellung, Prüfung und Bereitstellung muss in diesem Checkout versioniert sein. |
| Vorhandene Generation | Zeichnen Sie GitLab-Version und -Edition, unveränderliche Dienst-Image-Referenzen und die Quellcode-Identitäten von Controller/Wizard auf. Gespeicherte Konfiguration hat Vorrang vor Erstinstallationsbeispielen. |
| Kandidatenressourcen | Ein vertrauenswürdiger Runner/Host mit Kapazität für die Produktionsumgebung und eine gesonderte Wegwerfplattform einschließlich Image-Archiven und Datenbankkopien. Erwerben Sie vor dem Start des aufwendigen Jobs die Ressourcensperre. Der aktuelle Testrahmen erlaubt 12 GiB Kandidaten-RAM; dies ist nicht der gesamte Host-Bedarf. |
| Isolierter Zustand | Getrennte Kandidatencontainer, Netzwerke, Docker-Daemon und Datenverzeichnisse. Binden Sie niemals beschreibbare Datenbank- oder Registry-Verzeichnisse von A in B ein, während A läuft. |
| Wiederherstellungsprüfpunkt | Ein abgeschlossener, per Prüfsumme verifizierter kalter Harvest oder eine gleichwertig konsistente unterstützte Sicherung, passende Konfiguration, GitLab-Geheimnisse und die exakten bisherigen Images. Bewahren Sie den vollständigen Certbot-Konto-/Erneuerungsbaum und jeden gesondert konfigurierten externen Speicher auf. |
| Unabhängiger Wiederherstellungszugang | SSH-/Konsolenzugang, freigegebener Checkout oder Git-Bundle, benötigte Image-Archive, private Speicherauswahl und Zugangsdaten bleiben verfügbar, während das plattformeigene GitLab nicht läuft. |
| Freigabeberechtigung | Ein autorisiertes Wartungsfenster, ein benannter Betreiber/Koordinator, die exakten Kandidatennachweise und ein Entscheidungspunkt für die Wiederherstellung. Ein erfolgreicher Merge allein autorisiert keine beliebigen Produktionsänderungen. |

Verwenden Sie Ihre eigenen Domains, Ihren ausgewählten Arbeitsspeicher und private
Zugangsdaten. Bewahren Sie installationsspezifische Auswahldateien, Sicherungen,
Protokolle und Belege außerhalb von Git auf. Das Repository enthält die Logik,
die sie erzeugt und prüft; es enthält keine Betreiberpasswörter oder -daten.
Übertragen Sie Geheimnisse über die privaten Eingaben des Einstiegs, niemals über
eine öffentliche Pipeline-Spezifikation oder ein Jobprotokoll.

Der [Kandidaten-Testrahmen](../tests/e2e/README.md) verwendet einen privilegierten
privaten Docker-Daemon und erfordert deshalb vertrauenswürdigen Code. Seine
Ressourcenlimits sind Obergrenzen, keine Reservierung oder Festplattenquote.
Ein kleiner Host, der Wizard und GitLab bedienen kann, kann nicht unbedingt eine
zweite vollständige Plattform testen.

### 5.2 B über den Merge-Request-Ablauf von A entwickeln

1. Erfassen Sie die beabsichtigte Verbesserung und ihre Abnahmekriterien im
   ausgewählten Tracker der Installation. Erstellen Sie einen Branch vom
   freigegebenen Standardbranch.
2. Ändern Sie eingecheckte Image-Auswahl, Build-Rezepte, Werkzeuge und
   Dokumentation gemeinsam. Legen Sie die exakte GitLab-Edition/-Version und den
   Image-Digest fest. Verwenden Sie kein veränderliches Tag zur Auswahl des
   Nachfolgers. Bewahren Sie die bisherigen freigegebenen Festlegungen auf.
3. Öffnen Sie einen GitLab-Merge-Request. Testen Sie die eingecheckte Revision;
   nicht eingecheckte lokale Änderungen oder private Wrapper gehören nicht zum
   Kandidaten. Ein fehlender Vorgang muss hier implementiert und geprüft werden,
   bevor er auf einem produktiven Host verwendet wird.
4. Lassen Sie die erforderlichen Merge-Schranken aktiviert. Reine
   Dokumentationsänderungen verwenden den kurzen Dokumentationspfad;
   Image-, CI-, Skript- und Infrastrukturänderungen verwenden den vollständigen
   Laufzeitpfad. Stufen Sie ein Upgrade nicht als Dokumentation ein, um
   Migrationstests zu umgehen.
5. Prüfen Sie Implementierung und Nachweise, mergen Sie nur bei erfolgreicher
   erforderlicher aktueller Pipeline und löschen Sie den gemergten Arbeitsbranch.
   Die gemergte Standardbranch-Revision erhält vor der Freigabe ihre eigenen
   jeweils erforderlichen Prüfungen.

Die Pipeline-Stufen und ihre Nachweise beschreibt der
[Testleitfaden](../tests/README.md#full-system-and-platform-gates).
Komponentenprüfungen laufen ohne Host-Socket oder Netzwerk in ihren
Kindcontainern. `test:candidate-image` erstellt das vollständige System-Image
aus eingecheckten Eingaben. `test:platform-candidate` serialisiert die
ressourcenintensiven realen Plattformprüfungen und muss vor der
Laufzeitveröffentlichung erfolgreich sein. Die Ressourcengruppe der Pipeline
ergänzt Host-Kapazitätsprüfungen und die Ressourcensperre des Betreibers,
ersetzt sie aber nicht.

Wenn die öffentliche Verteilung aktiviert ist, folgt der Docker-Hub-Publikationsjob
diesen erforderlichen Prüfungen auf dem geschützten Standardbranch oder einem
geschützten Versionstag. Er kopiert den freigegebenen vollständigen Controller
und den passenden Wizard, statt einen von beiden nach der Abnahme neu zu
erstellen. Beide erhalten ein Tag mit dem vollständigen Quellcode-Commit;
ein geschütztes Tag `vX.Y.Z` kann einen Versionsalias ergänzen. Der Release-Beleg
bindet Quellcoderevision/Tree, Wizard-Gitlink, Image-IDs und unveränderliche
Docker-Hub-Referenzen. Vorhandene widersprüchliche Aliase werden abgewiesen;
eine Prüfung durch anonymes Abrufen kontrolliert, dass beide öffentlichen
Images ohne Publikationszugangsdaten abgerufen werden können. Siehe
[Publikationskonfiguration](../Prepare-Host.md#publish-your-own-public-releases).

Die öffentliche Veröffentlichung schaltet keine Produktionsumgebung um und
sichert keine Dienstdaten. Ein neuer Betreiber wählt den freigegebenen Quellcode
und die beiden Digest-Referenzen und verwendet `bootstrapper/install-release.py`
über den Neuinstallationsweg des Handbuchs. Vorhandene Installationen behalten
ihre gespeicherten Auswahlwerte und benötigen stattdessen das passende geprüfte
Freigabe-/Migrationsverfahren.

Für die Kombination aus geführten Vorschauen und GitLab-Migration wählen
`guidedPreviewAcceptance === true` und `gitlabUpgradeAcceptance === true` ein
festes gemeinsames Ausführungsbudget von 75 Minuten. Ein Upgrade ohne geführte
Vorschauen behält 60 Minuten; ACME ohne Upgrade behält 25 Minuten; normale
Smoke-Tests behalten 20 Minuten. Der ursprüngliche Kandidat, der wiederhergestellte
Kandidat, die ACME-Stelle und alle weiteren Ressourceneigentümer teilen die
ursprüngliche absolute Frist. Weder eine neue Phase noch ein Hostwechsel setzt
sie zurück; eine Zeitüberschreitung lässt die Abnahme ohne automatische Verlängerung scheitern.

Der vollständige Plattform-CI-Job erlaubt ein 80-minütiges Runner-Skript, ein
separates zweiminütiges `after_script` und ein Job-Limit von 85 Minuten für
Vorbereitung, Ausführung, Veröffentlichung und Artefaktsammlung. Die Grenze von
75 Minuten umfasst drei echte native Wizard-Pipelines für den importierten
Standardbranch, den Merge Request und den gemergten Standardbranch mit jeweils
vier erforderlichen Jobs sowie manuelles Review/Beta Deploy und Stop. Diese Grenze
ist eine Obergrenze, keine Laufzeitgarantie. Der Kandidat bleibt auf 12 GiB RAM
und vier CPUs begrenzt. Nur der einzelne verwaltete Docker-Runner der ursprünglichen
geführten Plattform erlaubt zwei gleichzeitige Jobs mit jeweils höchstens 2 GiB
RAM und einer CPU; alle verschachtelten Vorgänge teilen die Kandidatengrenze.
Reine Dokumentationsänderungen behalten ihren kurzen Pfad. Kein früherer
erfolgreicher Fixture- oder MR-Lauf ersetzt die erforderliche Abnahme des exakten
gemergten Quellcodes, der freigegeben wird.

### 5.3 Die Migration vorhandenen Zustands prüfen, nicht nur den Erststart

Ein erfolgreicher Start eines leeren B beweist nicht, dass A aktualisiert werden
kann. Prüfen Sie den Übergang mit repräsentativem Zustand, der auf der
GitLab-Version von A angelegt wurde, und übertragen Sie ausschließlich eine
konsistente Kopie in den isolierten Kandidaten:

1. Legen Sie repräsentative Benutzer, Repositories, Issues, Merge Requests und
   Diskussionen, verschlüsselte Einstellungen und ein Registry-Image an. Halten
   Sie Identitäten und Repository-/Image-Hashes als private Testreferenzen fest.
2. Stoppen Sie alle schreibenden Prozesse über das unterstützte
   Sicherungsverfahren und prüfen Sie den Prüfpunkt vor dem Kopieren. Halten Sie
   die ursprüngliche Generation oder ihren wiederherstellbaren Prüfpunkt
   getrennt von den beschreibbaren Daten des Kandidaten.
3. Starten Sie den Kandidaten mit dem vorgeschlagenen GitLab-Image und lassen
   Sie die erforderlichen regulären und Hintergrundmigrationen abschließen.
   Prüfen Sie GitLabs Bereitschaft und Migrationszustand; ein laufender
   Docker-Container allein reicht nicht aus.
4. Prüfen Sie erhaltene Identitäten, verschlüsselte Einstellungen und
   Registry-Abrufe und führen Sie dann eine echte Runner-Pipeline mit
   Build/Push/Pull aus. Prüfen Sie mit einem absichtlich scheiternden Job, dass
   die nachgelagerte Auslieferung blockiert wird. Prüfen Sie authentifiziertes
   Sync-Abrufen, den exakten System Cube, Wizard-Routing und die Grenzen
   persistenter Einhängungen.
5. Prüfen Sie Fehler und Wiederherstellung. Entfernen Sie ausschließlich exakt
   zugeordnete Kandidatenressourcen; bewahren Sie bereinigte Quellcode-/Image-/Stufennachweise
   und Bereinigungsbelege auf. Archive der Kandidatendaten und Geheimnisse dürfen
   keine öffentlichen CI-Artefakte werden.

Das vorhandene Szenario für Konfiguration und Seed stellt repräsentativen Zustand
und Kaltwiederherstellungsprüfungen bereit; siehe seine
[Prüfgrenze](RECOVERY_CONTRACT.md#verification-boundaries). Eine Prüfung, die
auf dieselbe GitLab-Version wiederherstellt, ist für sich allein kein Nachweis
einer versionsübergreifenden Migration. Verlangen Sie für ein Upgrade explizite
Migrationsergebnisse für Quell- und Zielversion.

### 5.4 Beispiel: Ein GitLab-Sicherheitspatch ist eine Systemweiterentwicklung

Das eingecheckte [Sicherheitsrelease-Profil](../gitlab/security-release.json)
deklariert einen Übergang von GitLab CE **19.4.3 → 19.5.3** sowie von GitLab
Runner **19.4.0 → 19.5.1** mit passendem Helfer. Die verlinkte
[Patch-Mitteilung](https://docs.gitlab.com/releases/patches/patch-release-gitlab-19-5-3-released/)
und die [Docker-Upgrade-Anleitung](https://docs.gitlab.com/update/docker/)
beschreiben die Voraussetzungen. Erforderliche Datenbank- und
Nachbereitstellungsmigrationen müssen abschließen; prüfen Sie den Upgrade-Pfad
von Quell- zu Zielversion, statt jedes neuere Image als austauschbaren Patch
zu behandeln.

Die ausgewählten System-/CI-Images und neuen versionierten Wizard-Rezepte
installieren auch das eingecheckte öffentliche CA-Bundle. Vorhandene reservierte
Rezept-Hashes bleiben gültig und erhalten nicht stillschweigend einen anderen
Vertrauensspeicher: Aktualisieren Sie solche Rezepte ausdrücklich. Diese Eingaben
und ihre Tests gehören neben den Dienstversionen zum geprüften Kandidaten.
Die Laufzeitkonfiguration liefert weiterhin separat alle installationsspezifischen
privaten Zertifizierungsstellen.

Die Verbesserung ist hier messbar: Das freigegebene Ziel-Image enthält die
angegebenen Upstream-Korrekturen, die bisherige Datenbank migriert erfolgreich,
und Projekte, Zugangsdaten sowie Build-/Auslieferungsverhalten der Plattform
bleiben nutzbar. A beherbergt den Merge Request und führt diese Tests für B aus;
das Image zuerst direkt auf dem produktiven Host zu ändern, würde diesen
Entwicklungsprozess umgehen.

Ein GitLab mit einem einzelnen Knoten hat während der Datenbankmigration dieses
Patches eine Ausfallzeit. Der Proxy-Wechsel des Wizards mit zwei Containern macht
ein GitLab-Datenbank-Upgrade nicht zu einer Bereitstellung ohne Ausfallzeit.
Betreiben Sie alte und neue GitLab-Versionen nicht auf denselben produktiven
Daten und versprechen Sie nicht, dass das Zurückschalten von NGINX eine
Datenbankmigration rückgängig macht.

### 5.5 Den freigegebenen Nachfolger übernehmen

Bewahren Sie vor dem Stoppen von A den freigegebenen Quellcode und die benötigten
Werkzeuge außerhalb des GitLab-Dienstes auf, der aktualisiert wird. Sichern Sie
die exakten Image-Nachweise und einen geprüften Prüfpunkt auf Speicher, der
während der Wartung zugänglich bleibt. Laden Sie benötigte Images vorab, falls
ihre Registry während des Wechsels nicht verfügbar sein wird. Ein zuvor
veröffentlichter freigegebener Spiegel oder ein Git-Bundle einschließlich der
erforderlichen festgelegten Submodulquellen löst die Abhängigkeit, GitLab zur
Wiederherstellung von GitLab zu benötigen; ein privates lokales Skript tut das
nicht.

Um Quellcode unabhängig aufzubewahren, führen Sie diese Standard-Git-Befehle aus
dem unveränderten freigegebenen Checkout auf Ihrem Administrationshost aus,
solange seine Quellen verfügbar sind:

```bash
umask 077
git submodule update --init --recursive
SOURCE_BUNDLE_DIR=/root/system-successor/source
install -d -m 0700 "$SOURCE_BUNDLE_DIR"
git bundle create "$SOURCE_BUNDLE_DIR/system.bundle" HEAD
git -C wizard bundle create "$SOURCE_BUNDLE_DIR/wizard.bundle" HEAD
git bundle verify "$SOURCE_BUNDLE_DIR/system.bundle"
git -C wizard bundle verify "$SOURCE_BUNDLE_DIR/wizard.bundle"
git rev-parse HEAD
```

Bewahren Sie die aufgezeichnete Systemrevision und die geprüften Bundles außerhalb
des GitLab-Dienstes auf. Ein späterer Ersatzhost kann `system.bundle` klonen,
diese aufgezeichnete Revision auschecken und den Wizard ohne Kontakt zu GitLab
oder GitHub initialisieren:

```bash
git clone "$SOURCE_BUNDLE_DIR/system.bundle" /opt/system
git -C /opt/system checkout --detach "$SYSTEM_TOOLS_REVISION"
git -C /opt/system \
  -c protocol.file.allow=always \
  -c submodule.wizard.url="$SOURCE_BUNDLE_DIR/wizard.bundle" \
  submodule update --init --recursive
```

Übertragen Sie zuerst die privaten Bundles auf diesen Host und setzen Sie
`SOURCE_BUNDLE_DIR` und `SYSTEM_TOOLS_REVISION` bewusst. Die
Dateiprotokollfreigabe gilt ausschließlich für diesen Aufruf mit den geprüften
lokalen Bundles. Diese Befehle decken das Wizard-Submodul des Repositorys ab;
nehmen Sie gleichwertige aufgezeichnete Bundles auf, falls Ihr Fork weitere
Submodule ergänzt. Ein einfaches Quellcode-ZIP enthält nicht die für die
Initialisierung benötigten Git-Objekte.

Die Produktionsfreigabe verwendet den eingecheckten Betreibereinstieg aus diesem
freigegebenen Checkout. Er muss seine Aktionen an den geprüften Quellcode,
Image-Festlegungen, erfolgreiche Kandidatenergebnisse und die exakte vorhandene
Installation binden. Führen Sie ihn vom Host oder einer unabhängigen
Administrationsverbindung aus, statt darauf zu vertrauen, dass ein CI-Job das
Stoppen des GitLab überlebt, das ihn koordiniert.

Für den deklarierten Übergang CE 19.4.3 → 19.5.3 enthält
[`gitlab/security-release.json`](../gitlab/security-release.json) die zulässigen
Image-Festlegungen. Rufen Sie vor der Planung oder dem Beginn der Ausfallzeit
alle sechs Image-Referenzen ab: `fromImage`, `toImage`, `runner.fromImage`,
`runner.toImage`, `runner.fromHelperImage` und `runner.helperImage`. Diese
umfassen beide GitLab-Versionen sowie die bisherigen und die Zielpaare aus
Runner/Helfer. Stellen Sie zuerst das **exakte getestete vollständige
Controller-Image** mit den freigegebenen Werkzeugen bereit und behalten Sie dabei
die gespeicherte GitLab-Auswahl 19.4.3 bei. Bauen Sie nicht ein anderes Image aus
demselben Tag neu und nehmen Sie dann seine getestete Identität an. Der Helfer
verlangt, dass der laufende Controller dem Image entspricht, das in den
freigegebenen Kandidatennachweisen aufgezeichnet wurde; die Veröffentlichung
einer bloßen Laufzeitbasis erfüllt diese Bedingung nicht.

#### Den freigegebenen Controller vom Host aus vorbereiten

Checken Sie den freigegebenen gemergten Quellcode mit seinen festgelegten
Submodulen aus. Laden Sie diese **eingefrorenen** Artefakte aus seinem Job
`test:platform-candidate` herunter:

- `test-results/successor/release.json`
- `test-results/successor/candidate-results.json`

Bewahren Sie sie in einem privaten Verzeichnis, etwa `/root/system-successor/`,
mit Modus 0600 auf. Ersetzen Sie sie nicht durch den Arbeitsbeleg unter
`test-results/e2e/`: Eine unabhängige Bereinigung kann dort nach der
Veröffentlichung Ergebnisse anhängen, während die Bytes der eingefrorenen Kopie
an den Release-Hash gebunden sind.

Stellen Sie eine private Tokendatei bereit, die Pipeline, Jobs und Artefakte des
Quellprojekts lesen und dessen privates Registry-Image abrufen kann. Passender
Zugriff mit `read_api` und `read_registry` genügt, wenn die Projektberechtigungen
des Kontos diese Vorgänge erlauben. Der Tokenwert ist niemals ein Befehlsargument.
Der Host-Helfer prüft den konfigurierten GitLab-HTTPS-Ursprung, die aktuelle
Standardbranch-Revision, erforderliche erfolgreiche interne Jobs, die exakte
Kandidatenjob-Identität, authentifizierte Artefaktbytes und veröffentlichte
Image-/Quellcode-Labels. Das alleinige Scheitern eines optionalen GitHub-Spiegels
wird separat aufgezeichnet; es ersetzt keinen internen Laufzeittest und schwächt
ihn nicht. Andere Pipeline-Fehler blockieren die Freigabe.

Führen Sie zuerst die Quellcode-/CI-Eingabeprüfung aus:

```bash
sudo python3 bootstrapper/promote-controller.py \
  --operation promote \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/system-successor/release.json \
  --evidence /root/system-successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/system-successor/gitlab-api-token \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/REPLACE_WITH_OPERATION_ID \
  --cold-maintenance --timeout 1200 --check-only
```

Ersetzen Sie Ursprung und Pfade durch die Werte Ihrer Installation. Führen Sie
nach der Prüfung denselben Befehl **ohne `--check-only`** aus, um die autorisierte
Controller-Freigabe durchzuführen. `--cold-maintenance` ist die Brücke für einen
älteren Controller, dessen Sync-API nicht beweisen kann, dass die Projektwarteschlange
ruht: Der eingecheckte Helfer stoppt öffentlichen Verkehr, friert den alten
Controller bei deaktiviertem Neustart ein, lässt dessen Remote-Arbeit auslaufen,
stoppt das alte GitLab sauber und erstellt einen geprüften kalten Prüfpunkt,
bevor er den freigegebenen Controller startet. Dies ist eine Wartungsunterbrechung.
Ersetzen Sie diesen Nachweis nicht durch die bloße Betreiberbehauptung, eine alte
API sei untätig.

Lassen Sie bei einem Controller, der das erforderliche Untätigkeits-/Sperrprotokoll
bereits unterstützt, `--cold-maintenance` nur weg, wenn der Helfer dieses Protokoll
akzeptiert. Der normale native Start kann NGINX und den Wizard abgleichen;
Abnahmebedingung ist, dass GitLab beim aufgezeichneten alten Image und der alten
Version bleibt und keine GitLab-Migration begonnen hat. Der Controller wird über
einen quellcode-/jobspezifischen lokalen Alias ausgewählt, der an die freigegebene
Image-ID gebunden ist. Seine unveränderliche Registry-Referenz bleibt
Release-Metadatum; der lokale Alias ermöglicht einen späteren Kaltstart aus einem
Archiv, bevor die plattformeigene Registry verfügbar ist.

Wird dieser **Controller**-Vorgang unterbrochen, verwenden Sie denselben Prüfpunkt
mit den eingecheckten Status- und gegebenenfalls Abbruchaktionen:

```bash
sudo python3 bootstrapper/promote-controller.py \
  --operation status \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/REPLACE_WITH_OPERATION_ID

sudo python3 bootstrapper/promote-controller.py \
  --operation abort \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --checkpoint-dir /mnt/bootstrapper-data/platform/recovery/controller-promotions/REPLACE_WITH_OPERATION_ID \
  --timeout 1200
```

Prüfen Sie vor der Auswahl einer Aktion den Status. Der Controller-Abbruch prüft
seinen eigenen Vorgang, stellt die bisherige Controller-Konfiguration wieder her
und setzt den alten Controller mit dem **gleichen GitLab-Image** fort. Er setzt
die Datenbank nicht zurück und verweigert ein geändertes GitLab-Image. Nachdem
die GitLab-Migration begonnen hat, verwenden Sie die unten beschriebene gesonderte
GitLab-Prüfpunktwiederherstellung. Das Host-Controller-Werkzeug besitzt keine
Aktion `resume`; ein Datenbank-Rollback erfordert die Wiederherstellung über den
GitLab-Upgrade-Helfer.

#### GitLab über den freigegebenen Controller migrieren

Kopieren Sie die eingefrorene `candidate-results.json` privat als
`accepted-candidate-results.json` in das persistente Konfigurationsverzeichnis,
das der Controller unter `/state` einhängt. Erstellen Sie dort eine private
`upgrade-options.json` mit folgenden Feldern und ersetzen Sie Beispielpfad,
Vorgangs-ID und Commit durch die freigegebenen Werte Ihrer Installation:

```json
{
  "sourceRevision": "REPLACE_WITH_ACCEPTED_40_CHARACTER_SYSTEM_COMMIT",
  "evidence": "/state/accepted-candidate-results.json",
  "stateDir": "/state",
  "persistentDir": "/mnt/bootstrapper-data/platform",
  "checkpointDir": "/state/gitlab-upgrades/REPLACE_WITH_UNIQUE_OPERATION_ID",
  "readyTimeoutSeconds": 900
}
```

Bewahren Sie beide Eingabedateien mit Modus 0600 auf. `sourceRevision` muss die
exakte freigegebene Revision in den Nachweisen sein. `persistentDir` ist der
**Host**-Pfad, den die Volume-Bindungen der Installation verwenden; `/state` und
`checkpointDir` sind Controller-Pfade. Verwenden Sie für jeden Versuch ein neues
Prüfpunktverzeichnis mit Platz für eine vollständige kalte GitLab-Kopie und
Reserve. Kein API-Token gehört in dieses Optionsobjekt.

Fordern Sie von einem unabhängigen Host-Terminal den schreibgeschützten Plan an:

```bash
sudo docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js plan /state/upgrade-options.json
```

Prüfen Sie den zurückgegebenen Plan und `planSha256`. Er bindet die freigegebenen
Nachweise, Quellcode, aktuellen Container und die Konfiguration an die exakten
alten und neuen Images und den Prüfpunktort. Beheben Sie fehlgeschlagene
Vorbedingungen, bevor Sie fortfahren; bearbeiten Sie nicht die Nachweise, um
einen Plan erfolgreich zu machen. Verwenden Sie nach der Autorisierung dieses
exakten Plans seinen Hash als Bestätigung:

```bash
PLAN_SHA256=REPLACE_WITH_REVIEWED_PLAN_SHA256
sudo docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js promote /state/upgrade-options.json "$PLAN_SHA256"
```

Führen Sie diesen Host-Befehl außerhalb des GitLab-CI-Jobs aus, der seinen Server
verlieren wird. Bewahren Sie die Ausgabe einschließlich `checkpointSha256`
privat auf. Prüfpunkt und Phasenbeleg werden unter dem konfigurierten
`checkpointDir` geschrieben; eine Shell- oder Netzwerkunterbrechung ist kein
Nachweis für Erfolg oder Fehlschlag der Freigabe.

Die Produktionsabfolge serialisiert gegen Konfigurationsschreibvorgänge,
Harvest/Wiederherstellung, Zertifikatszustandsänderungen und andere
Bereitstellungen. Der GitLab-Helfer nimmt vor der letzten Prüfung auf ruhende
Jobs seine HTTP-Eingangsdienste aus dem Verkehr, sodass native und externe
Runner während der Prüfpunkterstellung keine neue Arbeit annehmen können.
Entdeckt er eine laufende Jobannahme, stellt er den alten HTTP-Dienst wieder her
und stoppt vor dem Herunterfahren der Datenbank und dem Prüfpunkt. Andernfalls
legt er schreibende Prozesse still, erfasst den letzten kompatiblen Prüfpunkt,
wendet die freigegebene Image-Auswahl an, migriert und prüft B. Halten Sie
Dienstidentität und öffentliches Routing explizit. Aktivieren Sie keine
Kandidaten-Testzugangsdaten oder privaten Testhostnamen in der Produktionsumgebung.

Prüfen Sie nach dem Start die tatsächliche GitLab-Version und den
Migrationszustand, Authentifizierung, Repository- und Issue-Zugriff,
Registry-Authentifizierung und -Abrufe, frischen Runner-Manager-Kontakt,
authentifiziertes Konfigurationsabrufen, Wizard-Routing, eingehängten Speicher und
Zertifikatserneuerung. Bewahren Sie den privaten Freigabebeleg mit freigegebenem
Commit, exakten Image-IDs/Digests, Prüfpunktidentität und Prüfergebnissen auf.

#### Die passenden Wiederherstellungseingaben von B exportieren

Führen Sie nach GitLab-Migration und Abnahme den eingecheckten
Wiederherstellungsexporter aus demselben unveränderten freigegebenen Checkout
aus:

```bash
sudo python3 bootstrapper/record-recovery-images.py \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --release /root/system-successor/release.json \
  --evidence /root/system-successor/candidate-results.json \
  --gitlab-url https://gitlab.example.com \
  --token-file /root/system-successor/gitlab-api-token \
  --output /root/system-successor/recovery-export.json
```

Der Exporter prüft die freigegebenen CI-/Quellcodenachweise und die Identitäten des
laufenden Controllers und GitLab, schreibt ein Controller-Archiv mit Prüfsumme
und aktualisiert deklarierten Quellcode, Aliase und die Auswahl öffentlicher
Dienst-Images. Er erhält bisherige Manifest-Historie, versionierte
Controller-Aliase und vorhandene Wizard-Wiederherstellungseingaben, statt sie
zu bereinigen. Der lokale Controller-Alias wird auf dem nächsten Host aus seinem
geprüften Image-Archiv wiederhergestellt; zum Starten der Registry ist keine
alte Docker-Anmeldung erforderlich.

Bewahren Sie den Exportbeleg auf und zeichnen Sie seine Manifestprüfsumme
unabhängig auf. Bewahren Sie auch die freigegebenen System-Git-Objekte und
festgelegten Wizard-Quellen außerhalb des GitLab-Dienstes auf, insbesondere wenn
dessen optionaler öffentlicher Spiegel nicht verfügbar ist. Prüfen Sie das neue
Manifest, bevor Sie sich darauf verlassen:

```bash
sudo env PERSISTENCE_ENV_FILE=/etc/system-bootstrapper/persistence.env \
  bash bootstrapper/recover-volume.sh --verify
```

Diese Prüfung validiert Eingaben, ohne Dienste neu zu starten. Der nächste
Ersatzhost muss die Controller- und GitLab-Images von B auswählen, statt ein
altes Manifest, das A beschreibt. Behalten Sie den Prüfpunkt vor dem Upgrade,
bis B und seine passenden Wiederherstellungseingaben abgenommen wurden. Erst
dann ist B bereit, die nächste geprüfte Weiterentwicklung zu beherbergen.

### 5.6 Fehler, Wiederherstellung und die Grenze der Autonomie

Falls Migration oder Abnahme scheitert, prüfen Sie die aufgezeichnete Phase des
eingecheckten Helfers:

```bash
sudo docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js status /state/upgrade-options.json
```

Bevor der Helfer einen freigegebenen Prüfpunkt-Hash aufzeichnet, akzeptiert seine
Aktion `abort` den geprüften Plan-Hash und kann einen bestätigten Fehler vor der
Migration beheben. Eine Datei `checkpoint.json` allein belegt keine Freigabe:
Ihre Prüfung kann gescheitert sein, bevor dieser Hash aufgezeichnet wurde.
Verwenden Sie nach der Prüfpunktfreigabe `rollback` mit dem aufgezeichneten Hash,
um den kompatiblen alten Zustand wiederherzustellen. Wählen Sie zwischen diesen
Aktionen nicht anhand des Exit-Codes eines getrennten Terminals; prüfen Sie den
dauerhaften Beleg und stellen Sie sicher, dass kein ursprünglicher Vorgang
mehr läuft.

```bash
# Only for a confirmed failure before checkpoint acceptance:
sudo docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js abort /state/upgrade-options.json "$PLAN_SHA256"

# For a confirmed completed-checkpoint recovery:
CHECKPOINT_SHA256=REPLACE_WITH_VERIFIED_CHECKPOINT_SHA256
sudo docker exec -w /system system_bootstrapper_1 \
  node gitlab/upgrade.js rollback /state/upgrade-options.json "$CHECKPOINT_SHA256"
```

Verwenden Sie ausschließlich die zur aufgezeichneten Phase passende Aktion;
die Befehle sind Alternativen und keine bedingungslos auszuführende Abfolge.
Behalten Sie Sperren unterbrochener Vorgänge und Markierungen unvollständiger
Wiederherstellungen für den Abgleich durch den Helfer bei. Löschen Sie keine
manuell, um eine Verweigerung zu umgehen.

Wenn der Controller mit einer unvollendeten Speicher- oder Upgrade-Sperre und
ohne Markierung einer unvollständigen Wiederherstellung neu gestartet wurde,
wartet er vor dem Start schreibender Prozesse im Wartungsmodus. `docker exec`
bleibt für die obigen nativen Status-, Abbruch- oder Rollback-Befehle verfügbar.
Er verlässt diesen Zustand nicht automatisch, wenn die Wiederherstellung die
Sperre entfernt. Setzen Sie den Controller-Start erst fort, nachdem die gewählte
Wiederherstellung erfolgreich war und ihre Schranken freigegeben wurden:

```bash
sudo docker restart system_bootstrapper_1
```

Wenn GitLab auf das alte Image wiederhergestellt wurde, während ein freigegebener
Controller vorbereitet bleibt, entwickeln Sie jede Korrektur über einen neuen
Merge Request mit seinen erforderlichen Prüfungen. Verwenden Sie den
dokumentierten [Ersatz eines vorbereiteten Controllers](../bootstrapper/README.md#replacing-an-accepted-controller-before-gitlab-migration)
mit dem bisherigen abgeschlossenen Controller-Prüfpunkt und einem neuen
Vorgangsverzeichnis. Das Werkzeug authentifiziert den bisherigen Kandidaten
gesondert und hält gleichzeitig die Schranken des aktuellen Standardbranchs
für den neuen Kandidaten streng. Bearbeiten Sie weder gespeicherte Auswahlwerte
noch das alte Wiederherstellungsmanifest, um den Ersatz erfolgreich zu machen.

Falls das Ziel-GitLab gestartet ist, stoppen Sie seine schreibenden Prozesse und
bewahren Sie den Fehlerbeleg auf. Starten Sie nicht einfach das alte GitLab-Image
auf einer bereits von B migrierten Datenbank. Die Wiederherstellung benötigt
den kompatiblen Zustand vor dem Upgrade, Konfiguration/Geheimnisse und die
exakten alten Images über das eingecheckte Wiederherstellungsverfahren.
Halten Sie die Daten des gescheiterten Kandidaten bis zum Abschluss der Diagnose
getrennt; überschreiben Sie nicht den einzigen nutzbaren Prüfpunkt. Siehe
[Harvest-/Seed-Wiederherstellung](RECOVERY_CONTRACT.md) für die
Kaltsicherungsvereinbarung und die Schutzprüfung gegen unvollständige
Wiederherstellungen.

Die Plattform automatisiert die deklarierte, getestete Abfolge. Sie gewährt einem
Agenten keine Berechtigung, neue Infrastrukturänderungen zu erfinden, Prüfungen
zu umgehen oder Merge-Schranken zu schwächen. Autonome Ausführung bedeutet in
diesem Kapitel, den autorisierten Versionsübergang und seine Prüfung mit
repositoryeigenen Werkzeugen durchzuführen. Beliebige Verbesserungen auszuwählen
und sie ohne Abnahme rekursiv freizugeben, bleibt eine gesonderte Fähigkeit, die
nicht aus einem erfolgreichen Patch-Upgrade abgeleitet werden darf.
