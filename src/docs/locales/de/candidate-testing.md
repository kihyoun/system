# Plattformabnahme in einer verwerfbaren Umgebung

`candidate.js` führt ein ausdrückliches Smoke- oder vollständiges Plattformszenario mit privatem Daemon aus.
Es ist vom isolierten Manifest getrennt; Offline-Transporte prüfen seinen
Lebenszyklusvertrag, ohne Docker zu starten. Die erforderliche Root-CI-Plattformschranke
führt das vollständige Szenario aus, einschließlich nativer geführter
Quelleinrichtung/Übernahme und Review-/Beta-Lebenszyklen,
Konfigurations-plus-Seed-Wiederherstellung, ungecachter Beschaffung privater
Wizard-Images und lokaler ACME-Erneuerung.

## Grenze und Voraussetzungen

Verwenden Sie einen vertrauenswürdigen Linux-Treiber mit Node 24 und Docker-CLI-Zugriff auf den vorgesehenen
äußeren Docker-Daemon. Weder eine bestehende System-Installation noch ein WSL-Konto, lokaler Seed,
private Konfiguration, global benannter Plattformcontainer oder Arbeitsplatzpfad sind
Eingaben. Der Treiber kann innerhalb eines CI-Containers laufen: HTTP-Anfragen werden durch
Node im privaten Kandidaten-Bootstrapper ausgeführt, nicht über das
Loopback des CI-Containers. Auf dem äußeren Daemon wird kein Port veröffentlicht. HTTP-Prüfungen laufen durch Node innerhalb
des zugehörigen Kandidaten über dessen privates Bridge-Gateway und privates NGINX.

Der Treiber erstellt einen zufällig benannten, mit Eigentumslabel versehenen **privilegierten DinD**-
Container, ein zugehöriges Netzwerk und ein Docker-Datenvolume. DinD hat seinen eigenen Unix-
Socket; der Host-Socket wird niemals hinein eingebunden. Feste `system_*`-Namen, innere
Docker-Netzwerke, Ports 80/8071/5050 und Dienst-Volumes bleiben auf diesen Daemon beschränkt.
Der innere Bootstrapper erhält diesen **inneren** Socket, weil der normale System-
Start ihn benötigt. Verwenden Sie dieses Testgerüst niemals für nicht vertrauenswürdigen Kandidatencode:
Privilegierte Docker-Ausführung teilt den Host-Kernel und garantiert keine Host-
Isolation. Auf der äußeren Plattform wird kein zusätzlicher GitLab-Runner bereitgestellt.

Prüfen Sie vor jedem echten Durchlauf den exakten Kandidaten und das DinD-Image, beschaffen Sie die
Ressourcen-Lease des Koordinators und vereinbaren Sie ein Testfenster. Der DinD-Container ist
auf vier CPUs und 12 GiB RAM begrenzt. Planen Sie zusätzliche Reserve auf dem äußeren
Host, für Image-Archive, Image-Entpackung und GitLabs Datenvolume ein; Dockers Volume
erzwingt keine Speicherplatzquote. Speicherplatz-/RAM-Prüfungen und eine Lease müssen außerhalb
dieses Treibers vor dessen Aufruf erfolgen. Smoke-Szenarien verwenden ein internes
äußeres Netzwerk. Das vollständige geführte Szenario erlaubt ausdrücklich ausgehenden
Zugriff auf seiner eigenen Bridge für den öffentlichen HTTPS-Git-Ursprung sowie native
Paket-, Browser- und Image-Downloads; es veröffentlicht weiterhin keine äußeren Ports.
Dienst-Images bleiben deklariert und vorgeladen. Das vollständige Runner-/Registry-
Szenario benötigt außerdem seine deklarierten Helfer- und Build-Eingaben.

Das geführte Szenario verwendet den öffentlichen Ursprung des festgelegten
Submoduls aus `.gitmodules`; ein Betreiber-Fork kann `SYSTEM_TEST_WIZARD_ORIGIN`
auf seine öffentliche HTTPS-Git-URL setzen. Die nativen Prüfungen öffentlicher
Adressen und freigegebener Erzeuger bleiben aktiv. Ein geänderter Upstream-Erzeuger
ist eine fehlerhafte Eingabe und keine Erlaubnis, andere CI in das Quellprojekt zu
kopieren. Private Ursprünge werden für diese Importabnahme nicht unterstützt.
GitLab, Sync, Wizard, Review und Beta verwenden TLS für exakte Hosts über die
vorhandene lokale ACME-Stelle. Die Registry bleibt der vorhandene private
HTTP-Endpunkt auf Port 5050; dieses Szenario behauptet keine HTTPS-Registry-Prüfung.

Die vollständige Prüfschranke führt die geführte Einrichtung einmal auf ihrer
frischen ursprünglichen Plattform aus und nutzt dann deren normale Pipelines
für den importierten Standardbranch, den Merge-Request und den Standardbranch
nach dem Merge. Sie startet die echten manuellen Review-/Beta-Deploy- und Stop-Jobs
und erhält die ursprüngliche Hauptkonfiguration und das laufende Wizard-Image
während der gesamten Einrichtung. Die Veröffentlichungsschranke verlangt diese
nativen Phasen und Identitäten; bestandene Offline-Testfälle können sie nicht
ersetzen. Diese Phasen teilen die unten beschriebene feste absolute Szenariofrist.
Die Phasenlaufzeiten enthalten die Arbeit; eine Zeitüberschreitung lässt die
Abnahme ohne automatische Verlängerung scheitern.

Nur der einzelne verwaltete Docker-Runner der ursprünglichen geführten Testplattform
erlaubt zwei gleichzeitige Jobs mit jeweils höchstens 2 GiB RAM und einer CPU.
Dadurch kann die native Quellpipeline Browserprüfungen parallel zur Image-Auslieferung
ausführen. Die Testumgebung lehnt widersprüchliche Runner-Einstellungen ab und erhält
registrierte Identität, Endpunkte, öffentliches Vertrauen und Quell-CI-Bytes.
Der bestehende Auslieferungs-Builder mit 4 GiB und zwei CPUs sowie der
Verifier-Browser mit 1 GiB und einer CPU behalten ihre eigenen Grenzen; sämtliche
verschachtelten Vorgänge teilen weiterhin die feste Kandidatengrenze von 12 GiB
und vier CPUs. Dies sind Obergrenzen, keine Reservierungen. Nur der abschließende
vollständige Plattform-CI-Lauf belegt Abnahme und tatsächliche Laufzeitverbesserungen;
Offline-Verträge messen diese nicht.

Verwerfbare GitLab-Instanzen verwenden `puma['worker_processes'] = 2` über die
offizielle Umgebungsvariable `GITLAB_OMNIBUS_CONFIG`. Verschachtelte Container können
die Ressourcen des äußeren Hosts statt der Grenzen des privaten Daemons erkennen.
Der ursprüngliche und der wiederhergestellte Controller übergeben dieselbe Einstellung;
der native GitLab-Start reicht sie bei der ersten Erstellung, beim Upgrade und beim Rollback weiter.
Dabei werden die deklarierten unveränderten GitLab-Images verwendet. Der gewöhnliche Start
bleibt unverändert, wenn die Variable nicht gesetzt oder leer ist. Die Einstellung wird vor
`gitlab.rb` ausgewertet und nicht in diese Datei geschrieben. Deshalb muss sie bei jeder
Controller-Erstellung übergeben werden. Siehe GitLabs [Docker-Konfiguration](https://docs.gitlab.com/install/docker/configuration/#pre-configure-docker-container)
und [Puma-Dimensionierung](https://docs.gitlab.com/administration/operations/puma/).

## Ausdrückliche Parameter

Erstellen Sie eine öffentliche JSON-Spezifikation mit `daemonImage` als exaktem Docker-DinD-
Release **und geprüftem sha256-Digest**. Es gibt bewusst keinen beweglichen oder
erfundenen Standardwert. `images` muss genau diese Rollen enthalten:

| Rolle | Eingabe | Tag im privaten Daemon |
| --- | --- | --- |
| `candidate` | Vollständiges System-Kandidaten-Image einschließlich seiner festgelegten Wizard-Dateien und installierten Sync-Abhängigkeiten | `system-candidate:under-test` |
| `wizard` | Vorbereitetes Wizard-Web-Image | `systembootstrapper/wizard` |
| `gitlab` | Ausgewähltes unterstütztes GitLab-Image | `candidate-gitlab:under-test` |
| `runner` | Kompatibles GitLab-Runner-Image | `candidate-runner:under-test` |
| `nginx` | Ausgewähltes NGINX-Image | `nginx:latest` (nur ein innerer Kompatibilitätsalias) |

Jede Rolle besitzt `archive`, eine absolute treiberlokale reguläre Image-Archivdatei,
erstellt mit `docker image save`, und `id`, die exakte `sha256:`-Image-ID, ermittelt
mit `docker image inspect --format '{{.Id}}' IMAGE`. Dies sind **Image-IDs**,
keine Registry-Manifest-Digests. Der Daemon wird per Registry-Digest festgelegt; jede
geladene Rolle wird anhand der Image-ID geprüft, bevor ihr erwarteter lokaler Alias zugewiesen wird.
Die Archive müssen alle erforderlichen Schichten der Dienst-Images enthalten. Der Treiber streamt
nur diese ausdrücklichen Dateien, nicht Checkout, Host-Docker-Speicher oder vorhandene Daten.
Der Bootstrap ruft den versionierten Speicherschutz `prepare-local` mit dem
zugehörigen privaten Host-Stammverzeichnis auf, erstellt Live-Verzeichnisse unter `/candidate-data/platform`
im Stammdateisystem dieses Daemons und bindet Konfiguration unter `/state` ein. Ein separater
journalisierter leichtgewichtiger Eigentümer liefert ein externes Backup-Volume unter `/seed-device`;
der konfigurierte Backup-Mount `/external-seed` fehlt beim normalen Start. Dies sind verwerfbare Kandidatenpfade, niemals das
angeschlossene Production-Volume. Jeder Docker-Vorgang wird sowohl durch das verbleibende
Gesamtbudget als auch sein eigenes Zeitlimit begrenzt.
Verwenden Sie Kandidaten-Images, die ohne private Konfiguration oder Zugangsdaten gebaut wurden.

Beispielsweise hat eine Rolle diese Form:

```json
{"archive":"/job/images/candidate.tar","id":"sha256:<64 verified hexadecimal characters>"}
```

`readinessMilliseconds` ist optional: 1.000–1.200.000, Standard 1.200.000 pro Smoke-
Bereitschaftsschranke. Normale Smoke-Tests haben ein zwanzigminütiges Budget;
ACME ohne GitLab-Upgrade teilt ein fünfundzwanzigminütiges Budget unter allen
Eigentümern. Ein GitLab-Upgrade ohne geführte Vorschauen hat sechzig Minuten.
Nur `guidedPreviewAcceptance === true` und `gitlabUpgradeAcceptance === true`
zusammen wählen fünfundsiebzig Minuten. Jedes Szenario verwendet eine absolute
Frist, die zwischen begrenzten Docker-/HTTP-Vorgängen geprüft wird. Jeder gestreamte Archivimport ist auf
zehn Minuten begrenzt;
andere Docker-Vorgänge auf zwei Minuten und einzelne HTTP-Anfragen auf zehn
Sekunden. Ein ausdrückliches Abgeben der Ereignisschleife vor jedem Docker-Vorgang liefert
wartende Signal-Callbacks aus. Abbruch wird zwischen Vorgängen beachtet, sodass ein
Archivimport einen kooperativen Abbruch um bis zu zehn Minuten verzögern kann. CI muss
Bereinigung nach dieser Grenze zulassen und den Beleg für erzwungene Beendigung aufbewahren.

Aus einem versionierten LF-Checkout; das signierte Beispiel muss unverändert validieren:

```sh
SYSTEM_DISPOSABLE_CANDIDATE=I_ACCEPT_PRIVILEGED_DISPOSABLE_EXECUTION \
  node tests/e2e/candidate.js /job/candidate-spec.json
```

Temporäre zufällige GitLab-root- und Sync-Zugangsdaten werden im Speicher erzeugt und
nur über stdin in den verwerfbaren Daemon/Kandidaten geschrieben. Sie fehlen
in Befehlsargumenten, öffentlicher Spezifikation und Berichten. Konfiguration wird
aus dem öffentlichen Beispiel erzeugt, wobei nur benannte Zuweisungen nach der
Signatur geändert werden; ein ungültiger Cube führt zum sicheren Abbruch. Private Host-Konfiguration wird nicht gelesen.

## Nachweise und Bereinigung

Die ersten Smoke-Schranken verlangen eine geroutete HTML-Antwort vom Wizard, eine echte
Sync-Anmeldung und authentifizierten Fetch der signierten Hauptkonfiguration mit
denselben temporären Sync-Zugangsdaten. Dies belegt weder Browserdarstellung noch
GitLab-/Runner-/Registry-Betriebsbereitschaft. Es aktiviert keine Wizard-Quellcode-/Build-Abläufe,
erstellt keine Bereitstellungspipelines und führt keinen Production-Rollout aus. Die normale
standardmäßige Wizard-Registrierung beim Bootstrap erfolgt nur im verwerfbaren Kandidaten.

`test-results/e2e/<run-id>/results.json` verzeichnet begrenzte Phasenergebnisse, exakte
zugehörige Ressourcenidentitäten und Image-IDs; `junit.xml` liefert CI-Testnachweise.
Weder rohe Docker-Protokolle noch rohe HTTP-Antwortinhalte, Token, Zugangsdaten oder Fehlerausgaben von Unterprozessen
werden veröffentlicht. Nutzen Sie die bereinigten Phasen-/Fehlercodes zur Diagnose. Der
Beleg wird als Checkpoint
vor jeder Erstellung einer äußeren Ressource gespeichert, damit eine unterbrochene Erstellung abgeglichen werden kann.
Jeder Beleg wird vollständig in eine eindeutige temporäre Datei im selben Verzeichnis geschrieben,
per fsync synchronisiert, geschlossen und atomar über den vorherigen Beleg umbenannt. Ein unterbrochener
oder durch volles Laufwerk gescheiterter Schreibvorgang erhält den vorherigen vollständigen Beleg einschließlich eines ausstehenden
Erstellungsnamens, falls der folgende Checkpoint mit vollständiger ID scheiterte. Ein abrupter Prozessabbruch
kann eine kleine unvollständige `.tmp`-Datei hinterlassen; die Bereinigung liest nur `results.json`.
Auf dem Linux-Treiber synchronisiert ein Checkpoint nach jedem Umbenennen auch das enthaltende Verzeichnis per fsync.
Berichtsverzeichnisse und ihre Vorfahren werden vom
Blatt bis zur Dateisystemwurzel vor der Ressourcenerstellung synchronisiert, einschließlich bestehender
Pfade, die ein früherer fehlgeschlagener Checkpoint möglicherweise ohne dauerhafte Speicherung erstellt hat.
Jeder Synchronisierungsfehler bricht den Checkpoint ab. Diese Garantien hängen davon ab,
dass Dateisystem und Speicher fsync einhalten; bewahren Sie Belege auf persistentem Speicher auf.
Native Windows-Tests prüfen atomaren Ersatz bei Prozessabsturz, aber Nodes
Windows-Dateisystem-API bietet nicht dieselbe Verzeichnis-fsync-Garantie.
Erfolgreiche Windows-Tests dürfen nicht als Nachweis für Dauerhaftigkeit bei Stromausfall dargestellt werden.

Bereinigung läuft bei Erfolg, Fehler und kooperativem SIGINT/SIGTERM. Sie listet auch gestoppte
Container auf, unterscheidet fehlende Ressourcen von einem unerreichbaren Daemon und
prüft vor Entfernung exakte Namen, Eigentumslabels und vollständige IDs. Ein fehlgeschlagener oder
fremder Container blockiert den Abbau abhängiger Volumes/Netzwerke. Ein Bereinigungsfehler
macht Erfolg zu Fehler und niemals einen Hauptfehler zu Erfolg.
Sie verwendet kein globales Prune und berührt keine Ressourcen anderer Durchläufe.

Bewahren Sie nach SIGKILL, Stromausfall oder nicht verfügbarem Daemon den Beleg auf und wiederholen Sie
nur diesen Bereinigungseinstiegspunkt, sobald der vorgesehene äußere Daemon verfügbar ist:

```sh
SYSTEM_DISPOSABLE_CANDIDATE=I_ACCEPT_PRIVILEGED_DISPOSABLE_EXECUTION \
  node tests/e2e/candidate.js cleanup test-results/e2e/RUN_ID/results.json
```

Eine ausstehende Erstellung ohne ID wird anhand ihres eindeutigen journalisierten Namens geprüft;
Eigentümerschaft und resultierende vollständige ID müssen vor dem Löschen nachgewiesen sein. Unbekannte oder
fremde Instanzen werden abgelehnt. Die Bereinigung übernimmt, kopiert oder zerstört keine
bestehende System-Installation. Erzwungene Prozessbeendigung kann keine
sofortige Bereinigung garantieren; CI muss Belege aufbewahren und einen unabhängigen Bereinigungs-Hook ausführen.

## Offline-Lebenszyklusverträge

Native Node-Offline-Tests decken Befehlsaufbau, Socket-
Grenze des privaten Daemons, Loopback-Bindung, exakte Image-Identität, erfolgreichen und abgelehnten Fetch,
Signaturerhalt, Trennung temporärer Zugangsdaten und Berichte, Zeitlimit und
Abbruch, gestoppte/fehlende Ressourcen, Wiederherstellung ausstehender Erstellung, Ablehnung fremder Ressourcen
und Daemon-/Entfernungsfehler ab. Regressionen beenden außerdem einen Kindprozess während
eines teilweisen Belegschreibens, lassen den ID-Checkpoint nach Erstellung scheitern, stellen den vorherigen
ausstehenden Beleg wieder her und liefern zwischen Kopieren und Laden einen Makrotask-SIGTERM-Handler aus.
Geordnete Tests mit injizierter Ein-/Ausgabe prüfen zusätzlich Linux-Verzeichnispersistenz und die
Ablehnung der Ressourcenerstellung nach Synchronisierungsfehlern bei Vorfahren oder nach dem Umbenennen.
Sie rufen weder Docker noch Live-HTTP auf:

```sh
node tests/shared/disposable-candidate-contract.js
```

Diese Offline-Tests belegen weder privilegierte Kandidatenausführung noch eine echte
GitLab-Pipeline. Führen Sie für dieses Verhalten die erforderliche vollständige Plattformschranke aus. Bestehende
`*/live/`-Skripte werden nicht automatisch importiert; ihre Annahmen fester Namen
müssen ausdrücklich an den zugehörigen privaten Daemon angepasst werden.

## Erforderliches vollständiges Plattform-CI

`test:platform-candidate` läuft nach jedem isolierten/Image-Test und blockiert die
bestehende Veröffentlichungsphase. Sein vertrauenswürdiger Node-24-/Alpine-Elternprozess installiert dieselben
festgelegten CLI-Werkzeuge wie System, baut den vollständigen System-Kontext und den Wizard
aus dem validierten festgelegten Snapshot und lädt die festgelegten Dienst-Images vor.
Der Job wird mit einer GitLab-Ressourcengruppe serialisiert. Die Image-Vorbereitung
hat ein separates begrenztes Budget. Die kombinierte Ausführung geführter Vorschauen
und des GitLab-Upgrades hat ein festes gemeinsames Limit von fünfundsiebzig Minuten
für ursprünglichen Host, wiederhergestellten Host, ACME-Stelle und weitere
Ressourceneigentümer. Das Runner-Skript erlaubt achtzig Minuten, die separate
Bereinigung zwei Minuten und der gesamte Job fünfundachtzig Minuten.
Der Runner-Host benötigt zwölf GiB Kandidaten-RAM zusätzlich zu seiner bestehenden Plattform-/Job-
Reserve und genügend freien Speicher für Image-Archive, Entpackung und GitLab-Zustand.

Die CI-Spezifikation setzt ausdrücklich `fullAcceptance: true` und liefert ein
passendes festgelegtes Runner-Helfer-Image über `supportImages.helper`. Zusätzlich
zu geroutetem HTML und authentifiziertem signiertem Fetch prüft der vollständige Treiber ein neues
GitLab und einen Runner, wiederholt die Registrierung ohne doppelte Pools oder aktive Einrichtungs-
Zugangsdaten, erstellt ein zugehöriges privates Projekt, führt eine echte Docker-Build-/Push-/
Pull-/Run-Pipeline mit Artefaktlieferung aus und belegt, dass ein bewusst fehlgeschlagener Job
den nachgelagerten Lieferjob blockiert. Er widerruft seine temporären API-Zugangsdaten
und bestätigt HTTP 401, bevor Dienste für den Seed-Zyklus stoppen. Der nachfolgende Konfigurations-plus-Seed-Wiederherstellungsadapter prüft den Lebenszyklus vom externen
Backup zu neuem lokalem Speicher und dessen Fehlerschutz innerhalb desselben Durchlaufs.
Ein Production-Rollout erfolgt nicht.

Das Manifest verzeichnet einzelne Phasenergebnisse und bereinigte numerische Pipeline-/
Job-/Projektidentitäten. Fehlgeschlagene Pipelines erhalten bereinigte Job-Status/-Gründe,
ohne rohe Traces, Zugangsdaten, Konfiguration oder Docker-Ausgaben. Sowohl Shell-
Traps als auch GitLab-`after_script` wiederholen eigentumsgeprüfte Bereinigungsbelege. Nur
gebaute Image-Tags mit Job-Label werden entfernt; gemeinsame festgelegte öffentliche Image-Caches
bleiben erhalten. Es wird kein globales Prune verwendet. Erzwungener Host-Verlust verlangt weiterhin die Wiederholung anhand
des aufbewahrten Belegs, sobald der Daemon erreichbar ist.


## Kalte Wiederherstellung aus Konfiguration plus Seed

Die Image-Vorbereitung verlangt `recovery.js`, wenn der versionierte Quellcode die
Seed-Manifestimplementierung enthält, aktiviert `recoveryAcceptance` und extrahiert
das tatsächliche Wizard-Konfigurationsexport-Modellbundle aus dem frisch gebauten Wizard-
Image. Der Exporter ist eine ausdrückliche private Dateieingabe, geprüft anhand von SHA-256 und der
festgelegten Wizard-Quellcodeversion. Seine ZIP verwendet dasselbe Modell und denselben Generator wie die Aktion **Sichern**;
sie enthält ausschließlich Konfiguration.

Der Adapter verzeichnet synthetische GitLab-Benutzer, Repository-Stand, ein Issue, eine verschlüsselte
CI-Variable und einen bestehenden Registry-Digest. Er erstellt außerdem einen separaten Quell-
branch und Entwurfs-MR mit Diskussion und Antwort; der Standardbranch bleibt unverändert
und sein kleiner Test-Commit überspringt CI. Ohne lokales ACME erstellt er ein
synthetisches TLS-Zertifikat und Konto-/Erneuerungsstruktur; mit dieser Phase verwendet er ein
echtes von der Testumgebung ausgestelltes Zertifikat. Er lädt gespeicherte Haupt-/Projektkonfiguration
über die authentifizierte API, exportiert sie über das Wizard-Modell und führt den echten kontrollierten
kalten Harvest aus. Nur diese ZIP und der abgeschlossene markierte Seed verlassen den ursprünglichen zugehörigen
DinD-Daemon. Binärübertragungen verwenden Dateideskriptoren und Prüfsummen begrenzte Puffer.
Private Archive haben Modus 0600 unter einem temporären Verzeichnis mit Modus 0700; sie gelangen niemals
in öffentliche CI-Artefakte oder Berichte.

Ursprünglicher Daemon, Docker-Datenvolume und zugehöriges Backup-Volume werden entfernt, bevor ein neuer zugehöriger
Daemon startet. Die Wiederherstellung verwendet ein anderes leeres Datenstammverzeichnis und lädt nur die
aus versioniertem Quellcode gebauten ausdrücklichen Images und festgelegten öffentlichen Abhängigkeiten erneut.
Sie bereitet neuen lokalen Live-Speicher über den versionierten Host-Stammverzeichnisschutz vor,
importiert die echte ZIP vor Bereitstellung und extrahiert nur den abgeschlossenen Seed
auf einen separat zugehörigen Backup-Mount. Fehlender Backup-Speicher muss laufende
Dienste unverändert lassen. Die globale Live-Lease schließt Vorgänge unabhängig vom
Backup-Ziel aus, und Wiederherstellung lehnt ein nicht leeres Ziel und beschädigte Nutzdaten
vor Datenschreibzugriffen ab. Sie wendet den echten Seed über den vorübergehenden Helfer an,
führt den Erneuerungspfad-Umschreiber aus neuem Quellcode aus und trennt beide Backup-Mounts
vor dem Dienststart. Ein authentifizierter echter ZIP-Push löst dann einen tatsächlichen
Controller-Neustart ohne Backup-Speicher aus, gefolgt von Fetch und Dienstprüfungen. Weder vorheriges aktives Konfigurationsverzeichnis noch Runner-
Arbeitsbereich oder nicht deklariertes Image-Archiv werden eingebunden oder gelesen. Erwartete Zugangsdaten und
Identitäten bleiben Prüforakel; sie werden niemals als Wiederherstellungseingaben geschrieben.

Die wiederhergestellte Instanz muss CA-geprüftes HTTPS mit erwartetem Host/SNI,
authentifizierten Konfigurations-Fetch, Erhalt von Konto/Zertifikat/Erneuerungspfad
und GitLab-Benutzer-/Projekt-/Repository-/Issue-/Verschlüsselungseinstellungs-/Registry-Identitätsprüfungen bestehen.
Die Testumgebung exportiert eine ausdrückliche Einstellung `WIZARD_ALIASES`. Ihr Alias muss
HTTP- und CA-geprüfte HTTPS-`308`-Weiterleitungen zum konfigurierten kanonischen Wizard liefern,
wobei kodierter Pfad, wiederholte Abfrageschlüssel und kodierte Abfragewerte exakt erhalten bleiben.
Beide Protokolle müssen die zugehörige HTTP-01-Challenge direkt bedienen, mit `404` und
ohne `Location` bei fehlender Challenge. Diese Prüfungen laufen vor **Sichern**, nach
Neurendern/Neuladen und Neustart des Eingangsproxys, erneut auf dem wiederhergestellten Host und nachdem
der wiederhergestellte Konfigurations-Push den Controller neu gestartet hat. Das synthetische
Zertifikat enthält den Alias-SAN; eine Weiterleitung allein kann einen Hostnamen-
Prüffehler nicht verbergen.
Die MR-Wiederherstellung prüft den exakten Quellbranch-Commit, MR-Identität, Titel, Beschreibung,
Zustand, Autor und Erstellungszeitstempel sowie IDs, Text, Autoren,
Zeitstempel und Auflösungskennzeichen beider Diskussionsnotizen. Der Bericht gibt nur den booleschen Wert
`mergeRequestRecoveryVerified` aus; privater Testinhalt ist kein öffentliches Artefakt.
Der wiederhergestellte Beleg veröffentlicht sechs begrenzte boolesche Werte unter `evidence.storage`:
`localLiveVerified`, `externalSeedRestored`, `backupDetached`,
`missingBackupGuardVerified`, `globalLeaseVerified` und
`invalidRestoreGuardVerified`. Ihre erforderlichen wiederhergestellten Phasen sind
`storage-global-live-lease`, `storage-refuse-nonempty-and-corrupt-restore` und
`storage-detached-backup-normal-operation`. Dies sind tatsächliche native Schranken, keine
aus der gewählten Speicherkonfiguration abgeleiteten Behauptungen.

Er wiederholt echtes Runner-/Registry-CI und dessen Fehlerschranke und führt anschließend einen weiteren echten
CI-Job aus, der den vor Harvest erfassten ursprünglichen Registry-Blob lädt und ausführt.
Beide Lebenszyklen teilen ursprüngliche Gesamtfrist und Abbruchkennzeichen. Jeder hat
einen unabhängigen Eigentums-/Checkpoint-Beleg und eine Bereinigung; ein Bereinigungsfehler lässt die
Abnahme fehlschlagen und erhält private Eingaben zur gezielten Wiederherstellung.

Ein ausschließlich synthetisches TLS verwendender Durchlauf meldet bewusst `acmeRenewalVerified: false`:
Wiederhergestellte Erneuerungsdateien sind kein Nachweis einer Certbot-/ACME-Erneuerung. Das lokale ACME-
Szenario unten muss ebenfalls erfolgreich sein, um tatsächliche Erneuerung/Bereitstellung nachzuweisen.
Die Offline-Adaptertests enthalten tatsächliches kurzlebiges HTTPS mit einer vertrauenswürdigen CA,
Ablehnung falscher Hosts und fremder CAs, Lebenszyklusreihenfolge, Abbruch, Stream-
Grenzen und Behandlung fehlgeschlagener Bereinigung. Sie belegen keinen erfolgreichen kalten Durchlauf.


Der kalte Basistest verwendet sein ausdrücklich aus Quellcode gebautes lokales Wizard-Image.
Die Erfassung erhält bestehende `WIZARD_IMAGE`-, GitLab-/Runner-Versions- und Host-
Bindungszuweisungen, statt diese Entscheidungen durch Teststandardwerte zu ersetzen.
Ohne das ausdrückliche Szenario `privateWizardRecovery` scheitert eine wiederhergestellte private Wizard-
Registry-Festlegung mit `wizard-pin-recovery-artifact-not-declared`; sie wird niemals
still auf das lokale Test-Image geändert.

Im vollständigen geführten Szenario verwendet die Wiederherstellung privater Images
das tatsächliche Wizard-Artefakt aus der geprüften Standardbranch-Pipeline nach dem
Merge erneut. Sie prüft unabhängig den kanonischen Quellbeleg, native Pflichtjobs
und Artefakte, Registry-Digest, Image-ID und Quelllabel. Ein zusätzlicher Build für
ein privates Image ist nicht nötig. Sein Image darf in keinem vorbereiteten Archiv
vorhanden sein. Der nicht geführte Testfall veröffentlicht stattdessen ein Derivat
über seinen bestehenden eigenen CI-Branch und eine eindeutige Markerschicht.
Die tatsächlich exportierte Konfiguration legt den per CI veröffentlichten Registry-Digest fest.
Der neue Daemon darf vor dem Start weder dessen Digest-Referenz noch dessen private Image-ID
besitzen. Nach der Seed-Wiederherstellung beschafft der Starthelfer aus neuem Quellcode
das exakte Image mit einem temporären projektbegrenzten `read_registry`-Deploy-Token.
Der Adapter prüft die exakte Image-ID und Quellrevision des laufenden Wizards
(oder den Marker des älteren Testfalls) und bestätigt, dass
kein aktives reserviertes Wiederherstellungs-Token verbleibt. Erst dann darf der Bericht
`privateWizardPinVerified: true` melden. Die Testumgebung liefert weder eine alte Docker-Anmeldung
noch ein privates Image-Archiv oder Ersatz-Image. Dieses Szenario erfordert tatsächlich erfolgreiche
Kandidatenausführung; Komponentenverträge sind kein Integrationsnachweis. Ein neuer Host darf nicht von einer alten Docker-Anmeldung abhängen,
und erfolgreiche Wiederherstellung eines lokalen Images allein prüft den privaten Festlegungsfall nicht.

## Lokale ACME-Ausstellung und -Erneuerung

`local-acme.js` implementiert die Phase `acmeRenewalAcceptance`, aktiviert durch die Image-
Vorbereitung, wenn vollständiger Adapter, Vertrauensdateien und Host-Skripte vorhanden sind.
Ein unvollständiger Vertrag scheitert vor der Plattformerstellung.
`prepare-acme-images.js` bereitet ausschließlich die drei exakten öffentlichen Image-Festlegungen vor,
die dieses Modul deklariert; sein Rückgabewert ist das erforderliche `spec.acmeImages`. Das festgelegte
Certbot-Archiv hat eine ausdrückliche Image-ID und SHA-256. Das versionierte öffentliche Pebble-
TLS-Vertrauenszertifikat besitzt separate Herkunfts-/Hash-Dokumentation in
`acme-fixture/README.md`; es wird niemals in einem allgemeinen Truststore installiert.

Zertifizierungsstelle und DNS-Server verwenden 192 MiB bzw. 64 MiB auf einer unabhängig zugehörigen
internen Docker-Bridge ohne veröffentlichten Port. Sie überstehen die Löschung des ursprünglichen Plattform-
Daemons. Jeder verwendet bestehendes Eigentumsjournal und geschützte Bereinigung
mit höchstens einem Container/Netzwerk/Volume je Eigentümer. Ein kurzer Initialisierer läuft
ohne Netzwerk und überschreibt im Image deklarierte Volumes mit tmpfs. Jeder Eigentümer
erbt absolute Frist und Abbruch des ursprünglichen Kandidaten. Ein Szenario
`acmeRenewalAcceptance: true` ohne GitLab-Upgrade hat ein gemeinsames
Lebenszyklusbudget von 1.500 Sekunden einschließlich beider Plattformhosts und
dieser Testeigentümer. GitLab-Upgrades verwenden das sechzigminütige Budget oder
fünfundsiebzig Minuten, wenn geführte Vorschauen ebenfalls aktiviert sind.
Normale Smoke-Tests behalten 1.200 Sekunden. Weder eine neue Phase noch ein
Hostwechsel setzt die Frist zurück oder verlängert sie automatisch.
Äußere Skript- und CI-Job-Limits müssen darüber hinaus Reserve für Vorbereitung, Veröffentlichung
und unabhängige Bereinigung erhalten. Bereinigung nach erzwungenem Beenden
muss schwere Plattformeigentümer vor diesen Testeigentümern entfernen.

Die DNS-Testumgebung lässt Testdomains auf die private Bridge-
Adresse jedes zugehörigen Daemons zeigen. Pebble validiert echte HTTP-01-Anfragen gegen NGINX-Port 80; die Wiederverwendung von Autorisierungen
ist deaktiviert und Validierung wird niemals umgangen. Ein echtes Zertifikat/Konto wird
vor Konfigurations-Backup und kaltem Harvest erstellt. Nach dem Hostwechsel werden
derselbe Kontoschlüssel und dasselbe Zertifikat geprüft; ein ungültiges DNS-Ziel muss die
Erneuerung scheitern lassen, anschließend muss das korrekte neue Ziel tatsächliche Erneuerung erlauben und
eine andere Zertifikatsseriennummer erzeugen. Die Erstausstellung umfasst Wizard-, Sync- und
konfigurierte Aliasnamen, sodass Pebble auch die HTTP-01-Route des Alias validiert. Nach
Erneuerung müssen Wizard und Alias beide die neue Seriennummer ausliefern; der Alias muss weiterhin
die exakten HTTP-/HTTPS-Weiterleitungs- und direkten Challenge-Prüfungen bestehen, bevor die Erneuerungs-
abnahme verzeichnet wird. Geprüftes HTTPS verwendet die unabhängig erzeugte
Ausstellungswurzel, geladen über den authentifizierten Teststeuerungskanal.

Die tatsächliche Erneuerungs-Lease sowie Zertifikatsinstallations-/Neuladeskripte aus neuem Quellcode
laufen in einem ausschließlich Shell verwendenden GitLab-Image-Host-Testgerüst mit echten Bind-Mounts und Mount-
Werkzeugen. Sein einziger Clientadapter transportiert Certbot über Docker; das echte
Certbot-Deploy-Ereignis löst den unveränderten Installations-Hook aus dem Quellcode aus. Docker-
CLI und deren musl-Lader stammen aus dem deklarierten neuen Controller-Image. Weder alte
Host-Programme noch Paketinstallation, Production-Pfad oder Production-Socket werden
verwendet. Dies bildet weder systemd-Timerplanung noch öffentliches Let's Encrypt nach.

Offline-Verträge prüfen Parameter/Vertrauen, kleine Ressourcengrenzen, Eigentümerschaft, Bereinigung,
negative Validierungsschranken und echtes HTTPS-Vertrauen/SNI. Sie belegen keine erfolgreiche
ACME-Wiederherstellung. `acmeRenewalVerified` kann erst wahr werden, wenn alle tatsächlichen Phasen für wiederhergestelltes
Konto, Erneuerung, Bereitstellung und CA-geprüftes HTTPS erfolgreich sind. Die Bereinigung entfernt schwere Plattformeigentümer vor kleinen Clients und der Zertifizierungsstelle,
die gemeinsame Testressourcen besitzt.

Konfigurationsvergleiche dekodieren literale Shell-Zuweisungen, ohne sie auszuführen.
Zitierte und unzitierte Exporte werden nach exakten Werten verglichen; Teilzeichenfolgen,
doppelte Zuweisungen, Shell-Erweiterung und Shell-Befehle können eine
Prüfbedingung nicht erfüllen. Nur ausdrückliche quellcodeeigene Fehlercodes überstehen wiederholte Bereinigung.


## GitLab-Nachfolger-Migrationsabnahme

Das versionierte Sicherheitsrelease-Profil ergänzt `supportImages.previousGitlab`,
`supportImages.previousRunner` und `supportImages.previousHelper` als ausdrückliche
Archiveingaben. `images.gitlab`, `images.runner` und `supportImages.helper`
identifizieren den gepatchten Nachfolger. Die isolierten Ausgangs- und Kaltwiederherstellungsphasen
starten bewusst die vorherigen festgelegten GitLab-, Runner- und Helfer-Images.
Unabhängige `:target`-Aliasse halten die neuen Images vor, ohne sie anstelle der
Ausgangsversion einzusetzen. Alle Archive werden über unveränderliche öffentliche Referenzen geladen,
geprüft und importiert, bevor der interne Daemon erstellt wird. Weder Production-Daten
noch Netzwerk, Socket oder Zugangsdaten sind Eingaben für die Kandidatenplattform.

Nach erfolgreichen bestehenden Runner-, Registry-, Kaltwiederherstellungs- und ACME-Szenarien
erstellt `gitlab-upgrade.js` zusätzliche synthetische Benutzer-/Projekt-/Issue-,
Merge-Request-/Diskussions- und verschlüsselte Variablenidentitäten vor dem Upgrade. Es ruft dieselbe
Repository-Upgrade-Engine wie Production auf und verwendet ausschließlich archivgeprüfte Aliasse
innerhalb des privaten Daemons. Die Production-CLI akzeptiert diese Aliasse nicht.
Es erstellt einen Checkpoint der sauber gestoppten alten Datenbank, migriert den echten Zustand auf die
gepatchte Version und prüft diese Identitäten. Ein neuer Runner-Job lädt einen vor dem Upgrade veröffentlichten
Image-Blob und führt ihn aus. Abschließend stellt es den exakten kalten
Checkpoint und das alte Image wieder her und wiederholt die Identitätsprüfungen.

Der Beleg des wiederhergestellten Kandidaten enthält die drei erforderlichen Phasen
`gitlab-upgrade-migrated-data`, `gitlab-upgrade-registry-ci` und
`gitlab-upgrade-restored-checkpoint` sowie begrenzte Image-Identitäten und Abschlusskennzeichen unter `evidence.gitlabUpgrade`.
Auch seine abschließende Bereinigung muss erfolgreich sein.
Der äußere Beleg kopiert den begrenzten Migrationsnachweis; die detaillierten Migrations-
phasen gehören zum Beleg des wiederhergestellten Kandidaten. Weder rohe private Checkpoints
noch Konfiguration, Zugangsdaten oder Datenbankprotokolle werden jemals öffentliche CI-Artefakte.

Das Nachfolgerszenario verwendet nur dann ein festes Gesamt-Kandidatenbudget von
75 Minuten, wenn sowohl `guidedPreviewAcceptance === true` als auch
`gitlabUpgradeAcceptance === true` gelten. Das Budget umfasst drei echte native
Wizard-Push-/MR-/Push-Pipelines mit jeweils vier erforderlichen Jobs, manuelles
Review/Beta Deploy und Stop, Kaltwiederherstellung und beide GitLab-Versionsübergänge.
Es ist eine Obergrenze, keine Laufzeitgarantie. Ein Upgrade ohne geführte Vorschauen
behält sein Budget von 60 Minuten. Ursprünglicher und wiederhergestellter Kandidat,
ACME-Stelle und alle weiteren Ressourceneigentümer teilen die ursprüngliche absolute
Frist; weder eine Phase noch ein Hostwechsel setzt sie zurück, und eine
Zeitüberschreitung verlängert sie nicht automatisch. Native Upgrade- und
Rollback-Bereitschaft erlauben jeweils 900 Sekunden innerhalb
eines Aufruflimits von 1.200 Sekunden und derselben absoluten Kandidatenfrist. Bereitschaft
verlangt weiterhin abgeschlossene Hintergrundmigrationen; ein erfolgreicher Migrationsbatch allein
erfüllt diese Bedingung nicht. Das Szenario verwendet die bestehende serialisierte Ressourcen-
gruppe und Grenze des privaten Daemons von 12 GiB und vier CPUs; prüfen Sie vor
dem Start die tatsächliche Host-Reserve. Der Plattformjob erlaubt ein 80-minütiges
Skript und eine separate zweiminütige Bereinigung innerhalb eines 85-minütigen
Job-Limits und lässt Zeit für Vorbereitung, Veröffentlichung und Artefakt-
sammlung. Normale Smoke- und reine ACME-Lebenszyklusbudgets bleiben unverändert. Ein
erfolgreicher nachgebildeter Adaptervertrag ist keine erfolgreiche echte Migration; verwenden Sie die
vollständige Plattform-CI-Schranke für diesen Nachweis.

## Abnahme des öffentlichen Release-Upgrades über die CLI

`public-upgrade.js` erweitert denselben wiederhergestellten Kandidaten nach der
GitLab-Migration und vor dem bestehenden kalten Datenbank-Rollback. Die Vorbereitung
wählt das ausdrücklich vorherige öffentliche Release aus dem Upgrade-Graphen,
prüft dessen unveränderliche Images und Quell-/Job-Labels und hält einen sauberen
Ziel-Checkout mit Git-Objekten und Wizard-Gitlinks beider Releases vor. Es wird
keine zweite Plattform angelegt.

Die Phase führt tatsächlich `plan`, abgelehntes unbestätigtes `apply`, erfolgreiches
bestätigtes `apply` und `status` der eingecheckten öffentlichen CLI aus. Apply
sichert unabhängige vorherige Image-Archive und erstellt eine native passende
Konfigurations-ZIP samt abgeschlossenem Seed. Dafür ist eine zusätzliche kalte
Sicherung des aktuellen Servicezustands nötig: Der frühere GitLab-Migrations-
Checkpoint enthält die alte Datenbank und kann dieses passende Paar nicht ersetzen.
Die Phase verbindet dasselbe eigene Sicherungsgerät erneut und trennt es vor der
Wiederherstellung vollständig. Sie verwendet den vorherigen Registry-CI-Job weiter; schreibgeschützte
Identitäts-, Registry-Tag-, Datenstichproben- und Runner-Prüfungen erzeugen keine
weiteren Jobs oder Repository-Commits.

Vor `recover` werden beide vorherigen Image-IDs entfernt und der Transport über
ihre ursprünglichen Digests abgeschaltet. Ein einmaliger Compose-Fehler
unterbricht den ersten nativen Rollback, nachdem dessen kritischer Journal- und
Lease-Zustand gesichert wurde. Status muss diesen Checkpoint anzeigen. Die nächste
Wiederherstellung muss ihn übernehmen, geprüfte Archive laden und dauerhafte
Wiederherstellungsaliase wählen. Ein Neustart des vorherigen Controllers in einem
separaten Prozess muss diese Auswahl erhalten und Status- sowie Datenprüfungen
bestehen. Vor dem anschließenden bestehenden Datenbank-Rollback werden die genaue
ursprüngliche Testkonfiguration und die Release-Profile wiederhergestellt.
Der abschließende normale Controller startet nach vollständiger physischer Trennung
des Sicherungsgeräts und besteht authentifiziertes Fetch. Fehlgeschlagene Schritte
veröffentlichen keinen Upgrade-Erfolg.

Ein auf 512 MiB und eine CPU begrenzter Helfer verwendet das eingebettete Python
des angegebenen GitLab-Images sowie Docker-/Compose-Binärdateien und den
musl-Loader des vorbereiteten Controllers. Seine Mounts gehören ausschließlich
zum privaten Daemon. Eingecheckte Testadapter bilden Ubuntu/systemd und die
Host-Mountansicht sowie die öffentlichen Metadaten des noch unveröffentlichten
Ziels und den genauen Transport vom Digest zum vorbereiteten Image nach. Die echte
öffentliche Autoritätsprüfung, Quellprüfung, Sicherung, der Updater, Leases,
Journale und Wiederherstellung laufen unverändert. Die Zuordnung vorheriger
Digests bleibt während der Archivwiederherstellung abgeschaltet. Synthetische
zukünftige Veröffentlichungseingaben werden niemals als Release-Nachweis exportiert.
Dieser Test belegt weder tatsächliche systemd-Zeitplanung noch einen zukünftigen
öffentlichen Upload; Host- und Veröffentlichungsprüfungen bleiben verpflichtend.
Offline-Vertragstests prüfen die Adaptergrenzen; erst die vollständige native
Kandidatenphase liefert den Upgrade-Abnahmenachweis.

## Geführte Vorschau-Abnahme nach dem Deployment

Das [native Werkzeug zur geführten Vorschau-Abnahme](GUIDED_PREVIEW_ACCEPTANCE.md)
prüft den frischen Quellimport, die tatsächlich erforderlichen Wizard-Push-/MR-Pipelines,
die Source-Primary-Übernahme und Review-Deploy/Stop nach dem bewussten Deployment
eines akzeptierten Controllers. Es verwendet ausdrücklich bereitgestellte private
Betreibereingaben und den nativen lokalen Docker-Socket. Weder die Spezifikation
der isolierten Testplattform noch eine zusätzliche CI-Pipeline aktiviert es.
Ein reiner Prüfplan oder ein erfolgreicher Offline-Fixture-Test belegt nicht,
dass die echte Betreiberabnahme durchgeführt wurde.
