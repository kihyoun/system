# Verwaltetes Wizard-Upgrade v1

Dieser Betreiberablauf aktualisiert Quellcode und Werkzeugkette eines bestehenden
privaten verwalteten Wizard-Projekts. Er registriert niemals ein weiteres Projekt
und ändert weder Production-Oberfläche, Proxy, Image-Fixierung, Runner-Zugangsdaten
noch Umgebungsrouten.

## Migrationsvertrag

1. Lies die signierte kanonische Projektkonfiguration und prüfe ihr Eigentum,
   die Quellcodemarkierung, das ursprüngliche Quellcodemanifest, verwaltete Build-/
   Umgebungsdateien und den exakten aktuellen Kopf des Standardbranches. Verlange
   gestoppte Review- und Beta-Leases.
2. Zeige eine Vorschau eines deterministischen Migrationsbranches in diesem
   Projekt, des geprüften öffentlichen Quellcode-Schnappschusses, des modernen
   Rezepts, des unveränderlichen sauberen Hilfs-Images und der betroffenen Pfade.
   Bewahre unbekannte Projektdateien; lehne bearbeiteten verwalteten Quellcode
   ab, statt lokale Entwicklung stillschweigend zu verwerfen.
3. Sichere nach ausdrücklicher Bestätigung die alte Konfiguration privat auf dem
   Volume als Prüfpunkt. Ein Vorbereitungskommit mit übersprungener CI entfernt
   nur verifizierte verwaltete Pfade auf dem isolierten Branch; Quellcode-, Build-
   und Umgebungscommits erstellen sie mit ihrer erforderlichen dateibezogenen
   Aktivierungsidentität neu. Bewahre ihre ursprüngliche verifizierbare
   Abstammung. Erstelle einen Migrations-MR vor dem letzten Commit, dessen normale
   MR-Pipeline die erforderlichen modernen Build- und Browserprüfungen ausführt.
4. Gleiche verlorene GitLab-Antworten durch Prüfung desselben Branches und der
   Markierungen ab; wiederhole niemals blind eine ungewisse Commit- oder MR-Anfrage.
   Lass Hauptbranch und kanonischen Beleg während des Reviews unverändert.
5. Prüfe nach einem geprüften Fast-Forward, der alle vier Commits bewahrt, die
   aktuellen Hauptbranchdateien und exakten erfolgreichen Pipeline-Artefakte und
   übernimm den neuen Beleg dann atomar. Bewahre bisherige Ablaufmetadaten,
   gestoppte Generationen und Tombstones. Eine zweite Übernahme ist ein verifiziertes Nichtstun.
6. Führe die normalen kanonischen Abläufe Review, Stoppen, Hauptbranch/Beta,
   Stoppen sowie abgesicherte Production-Freigabe/Rollback separat aus. Prüfe
   ihre tatsächlichen Pipeline- und Laufzeitergebnisse; Komponententests ersetzen sie nicht.

Der passende moderne Controller/das Hilfs-Image muss zuerst gebaut und geprüft
werden. Verwende kein altes Hilfs-Image wieder: Es kann das moderne Build-Rezept
nicht prüfen.

## Betreiberverfahren

Führe den geprüften Quellcode im kanonischen Controller mit Node 24 aus. Bereite
seine geprüfte `project-bootstrap/wizard-source/snapshot.json` passend zum geprüften
System-Gitlink vor. Speichere ablaufende GitLab-API-Zugangsdaten privat auf dem
Volume mit Modus 0600 als `{ "baseUrl": "https://gitlab.example/api/v4", "token": "..." }`.
Der API-Token wird ausschließlich aus dieser Datei gelesen, niemals aus einem
Befehlsargument, Protokoll, einer CI-Variablen, einem Beleg oder Prüfpunkt.
Widerrufe ihn nach dem Vorgang. Er muss zum eigenen GitLab der Plattform gehören;
die TLS-Prüfung bleibt aktiviert.

Erstelle eine Optionsdatei mit Modus 0600, die `credentialFile` und das exakte
unveränderliche `helperImage` (`sha256:...`) des geprüften sauberen Controller-Images
enthält. Die optionalen Pfade `config`, `mainConfig` und `directory` verwenden
standardmäßig `/state/.projects.env/.wizard.env`, `/state/.docker.env` und
`/state/wizard-upgrades`. Der eigene GitLab-Host und die Registry der
Hauptkonfiguration werden erzwungen. Sie wird gelesen und per Hash geprüft,
aber von diesem Ablauf niemals umgeschrieben. Vor dem Vorbereiten eines
Schreibzugriffs prüft ein begrenzter Container ohne Netzwerk, ob das gewählte
Hilfs-Image die exakten geprüften Umgebungs-/Build-Abhängigkeitsdateien enthält.
Er erhält keinen Docker-Socket, Zustand, Zertifikate oder Zugangsdaten. Der
Betreiber muss außerdem beim Ausrollen des geprüften Controllers dessen
`SYSTEM_WIZARD_ENVIRONMENT_IMAGE` auf dasselbe Image setzen. Bewahre das vorab
geladene Hilfs-Image auf dem gemeinsamen Runner-Daemon auf.

```sh
node project-bootstrap/wizard-upgrade/run.js plan /state/upgrade-options.json
# Review source revision, project identity, branch, current head and path diff.
# Reserve a bounded CI slot before stage: its last commit starts CI.
node project-bootstrap/wizard-upgrade/run.js stage /state/upgrade-options.json PLAN_HASH
```

Prüfe den zurückgegebenen MR des bestehenden Projekts und die erforderlichen
Jobs `build:wizard` und `test:wizard`. Der Betreiber muss bei Bedarf
`merge_method=ff` des bestehenden Projekts prüfen und vorübergehend auswählen;
dieses Hilfsprogramm ändert niemals die Projektrichtlinien. Merge erst nach
Review und Erfolg, **per Fast-Forward ohne Squash oder Rebase**, und bewahre alle
vier durch Prüfpunkte gesicherten Commits. Der Hauptbranch muss unmittelbar vor
diesem Merge noch dem angezeigten Kopf entsprechen und bei der Übernahme exakt
dem letzten Umgebungscommit. Bearbeite die verwalteten Dateien dazwischen nicht.
Identische Dateiinhalte benötigen diese Historie, um ihren neuen
`last_commit_id`-Nachweis zu bewahren. Stelle die vorherige Merge-Richtlinie nach
der Übernahme bei Bedarf wieder her. Der alte Beleg bleibt bis zur Übernahme aktiv.

```sh
node project-bootstrap/wizard-upgrade/run.js adoption-plan /state/upgrade-options.json
node project-bootstrap/wizard-upgrade/run.js adopt /state/upgrade-options.json ADOPTION_HASH
```

Die Übernahme verlangt eine grüne exakte vorbereitete MR-Pipeline, beide
Prüfungen als erforderlich, passende moderne Nachweise und Registry-Digest,
einen gemergten MR und jede vorbereitete Quellcode-/verwaltete Datei am aktuellen
Hauptbranch passend zu ihrem verifizierten Commit. Sie zeichnet ursprüngliche
Quellcode-Revision, Import-/Build-/Umgebungsbelege und gestoppte Leases in
`wizardWorkflow.upgradeHistory` auf und bewahrt andere Registrierungsfelder und
Konfigurationsbytes. Ihr privater Prüfpunkt bewahrt außerdem die ursprüngliche
signierte Projektkonfiguration auf dem Volume.

Erstelle einen normalen kleinen Folge-MR im **selben** Projekt, um manuelles
Review-Bereitstellen/-Stoppen mit dem neuen Hilfsprogramm zu prüfen. Merge ihn,
prüfe manuelles Beta-Bereitstellen/-Stoppen und verwende dann das separate
Plan-/Apply-/Rollback-Verfahren von `wizard-production/run.js` mit dem
verifizierten Digest dieses kanonischen Projekts. Migration oder Übernahme
führen keine Production-Freigabe aus.

Wenn eine Anfrage ihre Antwort verliert, führe `stage` mit dem ursprünglichen
Plan-Hash erneut aus. Es übernimmt nur einen exakt bereits erstellten Commit/MR.
Eine Absicht ohne beobachtbares Ergebnis erfordert eine Administratorprüfung;
ein weiterer blinder POST wird absichtlich verweigert. Lösche niemals Prüfpunkte
und verwende keinen Force-Push, um diesen Schutz zu umgehen. Eine gleichzeitige
Konfigurations-/Hauptbranchänderung oder aktive Lease erfordert ein neues Review,
kein automatisches Überschreiben. Gib vor der Übernahme eine ungemergte Migration
durch Schließen ihres MR auf; Hauptbranch und alter Beleg bleiben gültig. Nach
der Übernahme reicht ein reines Zurücksetzen des Quellcodes nicht: Verwende eine
separat geprüfte inverse Migration. Production-Rollback verwendet sein unabhängig
aufbewahrtes Image und seinen Prüfpunkt.

## Build- und Umgebungsrezepte ohne erneuten Quellcodeimport

Verwende die ausdrücklichen `build-`-Aktionen, wenn ein bereits modernes
verwaltetes Projekt die versionierte Bereinigungskorrektur, mit der Übersicht
kompatible Browserprüfungen oder aktualisiertes CA-Vertrauen in seinen
Job-Images benötigt. Die normalen Quellcode-Upgrade-Aktionen lehnen bearbeiteten
importierten Quellcode weiterhin ab. Dieser separate Weg akzeptiert bestehende
Entwicklung einschließlich hinzugefügter oder entfernter Quellcodedateien und
ändert nur die reservierten Build-Dateien, das Umgebungshilfsprogramm, den
verwalteten CI-Einstiegspunkt und ihre beiden Belege. Ohne eine Option
`buildProfile` behält er das Ziel `node24-vite8-cleanup-v2` und die Vorgangsidentität
für bestehende Prüfpunkte. Setze zur Vorbereitung der Auslieferung von Quellcode
mit oberster Übersicht-/Wizard-Navigation vor der Vorschau
`"buildProfile": "node24-vite8-overview-v3"` in der privaten Optionsdatei. Dieses
Profil prüft auch früheren modernen Quellcode, der direkt im Arbeitsbereich
öffnet, sodass die Rezeptmigration vor der Oberflächenänderung erfolgen kann.
Behalte dasselbe ausdrückliche Ziel für Vorbereitung, Übernahme und Wiederholungen.
Unbekannte Ziele und versehentliche Downgrades vom Overview-Profil werden abgelehnt.

Wähle für die aktuelle öffentliche CA-Aktualisierung ausdrücklich
`"buildProfile": "node24-vite8-ca-v4"` und das akzeptierte unveränderliche
Hilfs-Image vor der Vorschau. Dieses Profil übernimmt Übersichts- und
Bereinigungsprüfungen und baut die betroffenen Build-/Browser-Images mit den
geprüften mitgelieferten Vertrauensdaten neu. Behalte das ausdrückliche Profil
für Vorbereitung, Übernahme und Wiederholungen; das historische Ziel bei
fehlender Option wird nicht automatisch geändert. Diese abgesicherte reine
Build-Migration akzeptiert moderne Profile. `legacy-ca-v4` steht für neue
Reservierungen mit altem Quellcode zur Verfügung; ein bestehendes Legacy-Projekt
folgt der Quellcode-/Werkzeugkettenmigration zum unterstützten modernen Profil.
Legacy-Projekte benötigen weiterhin das separat geprüfte Quellcode-/Werkzeugketten-
Upgrade. Historische Rezept-Hashes und bestehende Prüfpunkte bleiben verifizierbar.

Wähle für Quellcode mit **So funktioniert’s**, **Schnellinstallation** und integrierten
Docs ausdrücklich `"buildProfile": "node24-vite8-quickstart-v5"`. Es behält alle CA-v4-
Dateien und Prüfungen bei und aktualisiert den Browservertrag einschließlich Scroll-/
Fokusaktion für die Installation, Docs-Navigation und erhaltener Arbeitsbereichsauswahl.
Liefere den passenden Oberflächenquellcode aus, bevor die vorgelagerte Browserprüfung
läuft. Dieses Ziel akzeptiert frühere moderne Profile und sich selbst; anschließende
Downgrades auf ältere Browserprofile werden abgelehnt. Quellcodeführende Projekte
verwenden ihren [nativen Quellcode-Merge und die Bindungsaktualisierung](../wizard-source-primary/README.md#refresh-an-existing-source-primary-build-recipe)
anstelle dieser Migrationsaktionen für bisherige Importe.

```sh
node project-bootstrap/wizard-upgrade/run.js build-plan /state/upgrade-options.json
# Review scope=build-environment, exact head, managed paths and preservedTreeHash.
# Reserve a bounded CI slot before this final MR commit starts CI.
node project-bootstrap/wizard-upgrade/run.js build-stage /state/upgrade-options.json PLAN_HASH
# Review required build/browser jobs; fast-forward the MR without squash/rebase.
node project-bootstrap/wizard-upgrade/run.js build-adoption-plan /state/upgrade-options.json
node project-bootstrap/wizard-upgrade/run.js build-adopt /state/upgrade-options.json ADOPTION_HASH
```

Der private Prüfpunkt und Migrationsvorgang unterscheiden sich von einem
Quellcode-Upgrade. Die drei beibehaltenen Commits sind Vorbereitung, Build und
Umgebung. Die Vorbereitung löscht nur verifizierte verwaltete Rezeptdateien und
ersetzt die Build-Markierung vorübergehend; sie schreibt niemals die
Quellcode-/Importmarkierung. Build und Umgebung erstellen unveränderte Dateien
neu, damit ihre exakten Aktivierungscommit-Nachweise gültig bleiben.
Quellcode-Importrevision, Manifest, Import-Commit und Quellcodemarkierung behalten
ihre ursprünglichen Identitäten. Jede andere Repository-Datei wird durch einen
deterministischen Fingerabdruck aus Bytes, Git-Modus und letztem Änderungscommit
geschützt, der bei jedem vorbereiteten Commit und erneut vor der Übernahme
geprüft wird. Unerwartete Ergänzungen, Entfernungen sowie Inhalts-, Modus- oder
Historienänderungen lassen denselben Vorgang fehlschlagen, statt erneut importiert
oder überschrieben zu werden.

Bestehendes Eigentum, Prüfung des unveränderlichen Hilfs-Images, Umgebungs-Mutex,
Konfigurations-/Hauptbranch-Compare-and-Swap, Prüfpunkte für ungewisse
Schreibzugriffe, Fast-Forward-Abstammung und exakte erforderliche Pipeline-/
Artefaktprüfungen gelten weiter. Review und Beta müssen vor der Planung vollständig
gestoppt sein; ihre Generationsuntergrenzen, Tombstones und anderen Einstellungen
bleiben exakt erhalten. Die Vorbereitung hält den alten kanonischen Beleg aktiv.
Die Übernahme ändert nur dessen verwaltete Ablaufbelege und ergänzt die
Upgrade-Historie; Konfigurationsbytes außerhalb des Belegs bleiben unverändert.
Sie gibt niemals den Kandidaten frei und ändert nicht die Production-Image-Fixierung.
Wenn die Konfiguration übernommen, das Schreiben des Prüfpunkts aber unterbrochen
wurde, repariert eine verifizierte erneute Übernahme diesen Prüfpunkt, ohne die
Konfiguration umzuschreiben. Ersetze `build-stage` nicht durch einen
Quellcode-Neuimport, um einen widersprüchlichen Plan zu umgehen.
