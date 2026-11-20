# Ein quellcodeführendes Wizard-Repository

Ein bestehendes Wizard-Quellcode-Repository kann auch seinen nativen Build,
Browsertests, Review-/Beta-Jobs und Production-Images verwalten. Entwicklung und
Auslieferung verwenden dann ein Projekt; ein separates Anwendungsrepository ist
nicht erforderlich. Ein optionaler GitHub-Spiegel veröffentlicht geprüften
Quellcode weiterhin über die normale CI des Repositories.

Dies ist eine ausdrückliche Betreiberübernahme, kein automatischer Quellcodeimport.
Die standardmäßige verwaltete Registrierung und ihre bisherigen Initialisierungs-/
Upgrade-Abläufe bleiben für Installationen verfügbar, die sie verwenden. Nach
der Übernahme erkennt der Wizard das kanonische Projekt anhand seiner exakten
GitLab-ID, seines Namensraums und Pfads. Quellcodeimport und alte Rezept-Upgrades
lehnen diesen Modus ab, statt Entwicklung zu überschreiben.

## Repository und aufbewahrten Zustand vorbereiten

1. Bewahre einen privaten Export des alten Projekts, alle erforderlichen
   Git-Referenzen, seine Quellcode-/Build-/Umgebungsbelege und Deployment-Prüfpunkte
   auf. Exportiere erforderliche Job-Nachweise und Registry-Images separat:
   Ein Projektexport ist keine vollständige Registry- oder CI-Artefaktsicherung.
   Merge private Deployment-Historie nicht in den öffentlichen Quellcodebranch,
   um sie aufzubewahren.
2. Stoppe aktive Review-/Beta-Umgebungen und gleiche ausstehende oder stillgelegte
   Leases ab. Verwende vor der Neuzuordnung das bestehende Hilfsprogramm zur
   Bereinigung gestoppter Umgebungen, damit alte Routenfragmente durch ihren
   verifizierten Eigentümer entfernt werden. Das Übernahmearchiv bewahrt alte
   Tombstones unverändert; neue Plätze behalten ihre Generationsuntergrenzen.
3. Prüfe `.gitlab/primary.yml` des Quellcodeprojekts. Sie muss ihre
   Quellcodeprüfungen und vorgesehene Veröffentlichungsrolle bewahren und
   erforderliche Jobs `build:wizard` und `test:wizard` mit dem geprüften allgemeinen
   Build-Rezept bereitstellen. Konfiguriere die Auslieferung ausdrücklich mit
   `WIZARD_DELIVERY_ENABLED=true` und dem erforderlichen Runner-Zugriff. Merge
   über normale Reviews mit aktivierten Bedingungen für erfolgreiche Pipelines
   und Diskussionen. Überspringe oder deaktiviere diese Bedingungen nicht.
4. Prüfe eine native **Push**-Pipeline des Standardbranches für genau den
   resultierenden Commit. Beide Auslieferungsjobs müssen erforderlich und
   erfolgreich sein. Ihre `build-evidence.json` und `wizard-evidence.json` müssen
   bei Commit, Pipeline-ID und unveränderlicher Image-Referenz übereinstimmen.
   Die Prüfungen enthalten Vitest, Lint, TypeScript, Production-Build, dargestellte
   Oberfläche, Navigation, Konfigurations-ZIP und exakte Cube-Signatur.
   Erforderliche Jobs `build:source` und `test:browser` müssen ebenfalls erfolgreich
   sein. Ein allein ausstehender, laufender, fehlgeschlagener oder abgebrochener
   `deploy:github`-Veröffentlichungsjob blockiert die private Auslieferung nicht;
   sein tatsächlicher Veröffentlichungsstatus bleibt sichtbar. Jeder andere
   nicht optionale Job muss erfolgreich sein. Keine erforderliche native Prüfung
   darf übersprungen oder ignoriert werden; normale Merge-Bedingungen bleiben aktiv.
5. Baue und prüfe einen passenden Controller/ein Hilfs-Image mit Unterstützung
   für den quellcodeführenden Modus. Bewahre das vorherige Wizard-Image auf dem
   Daemon auf. Bereite die im [Umgebungsleitfaden](../wizard-environments/README.md)
   beschriebenen privaten Umgebungsvariablen vor.

## Vorschau und Übernahme

Erstelle eine private Eingabe-JSON mit diesen Feldern und Werten aus deinem
eigenen Projekt und der verifizierten Pipeline:

```json
{
  "version": 1,
  "projectId": 42,
  "projectPath": "example/system-wizard",
  "namespaceId": 7,
  "defaultBranch": "master",
  "pipelineId": 100,
  "sourceCommit": "REPLACE_WITH_THE_EXACT_40_HEX_COMMIT",
  "imageRef": "registry.example.test/example/system-wizard@sha256:REPLACE_WITH_THE_64_HEX_DIGEST",
  "helperImage": "sha256:REPLACE_WITH_THE_REVIEWED_64_HEX_SYSTEM_IMAGE_ID",
  "ciFiles": [
    {"path": ".gitlab/primary.yml", "sha256": "REPLACE_WITH_64_HEX_SHA256_OF_EXACT_COMMITTED_BYTES"}
  ]
}
```

`ciFiles` ist ein vollständiges freigegebenes CI-Manifest, nicht nur die eine
beispielhafte Zeile. Nimm die native CI-Definition, ihren Auslieferungs-/
Umgebungsstarter, die allgemeinen Rezeptdateien unter
`.system-bootstrapper/build-v1/` und referenzierte `.gitlab/`-Skripte auf.
Berechne jeden SHA-256 aus den exakten Bytes bei `sourceCommit`. Das Hilfsprogramm
prüft diese Dateien über GitLab und validiert das reservierte allgemeine
Build-Rezept unabhängig. Künftige Änderungen an diesem Manifest erfordern einen
weiteren geprüften Bindungsvorgang; normale Anwendungsänderungen können die
bestehende Bindung unverändert verwenden.

Speichere die Eingabe und eine ablaufende GitLab-API-Zugangsdaten-Datei mit Modus
`0600` unterhalb des persistenten Konfigurationsverzeichnisses. Die Zugangsdaten-JSON
enthält `baseUrl` und `token`; ihr TLS-Ursprung muss zum konfigurierten eigenen
GitLab-Host passen. Zugangsdaten und Konfigurationsinhalte werden niemals
ausgegeben. Widerrufe die Betreiberzugangsdaten nach der Verwendung.

```sh
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-source-primary/run.js plan /state/adoption-input.json /state/adoption-credential.json
docker exec system_bootstrapper_1 node /system/project-bootstrap/wizard-source-primary/run.js apply /state/adoption-input.json /state/adoption-credential.json PLAN_HASH
```

Prüfe den exakten Plan-Hash, alte/neue Projekt-IDs, das vorherige Production-Image,
neue Pipeline/Image und Konfigurations-Hashes. Apply prüft GitLab erneut,
erwirbt den bestehenden Umgebungs-Mutex, speichert die vollständige alte
Konfiguration/den Beleg privat unter `/state/wizard-source-primary/` und ändert
atomar nur die Projektbindung. Eine veraltete Bestätigung oder gleichzeitige
Bearbeitung schlägt fehl, ohne sie zu überschreiben. Dieselbe abgeschlossene
Übernahme erneut auszuführen ist ein verifiziertes Nichtstun.

Die Übernahme ändert weder den laufenden Production-Container noch die
Image-Fixierung. Genau das eine vorherige Image wird als ausdrücklicher
Wiederherstellungsalias aufgezeichnet, solange das alte Projekt noch existiert.
Ein anderer Digest oder ein fremdes Projekt wird nicht akzeptiert. Die
Build-Status-Aktion liest native Pipeline-Nachweise, ohne Pipelines zu erzeugen
oder Quellcode zu importieren. Eine ausstehende oder fehlgeschlagene aktuelle
Standardbranch-Pipeline wird als ungeprüft angezeigt, statt einen älteren Build
als aktuell darzustellen.

## Ein bestehendes quellcodeführendes Build-Rezept aktualisieren

Eine Controller-Aktualisierung bewahrt die bestehende Build-Reservierung. Wähle für
einen bereits übernommenen modernen Wizard in einer neuen Übernahmeeingabe ausdrücklich
`"buildProfile": "node24-vite8-quickstart-v5"`, um die aktuelle Oberfläche mit Übersicht,
Schnellinstallation und integrierten Docs auszuliefern. Das frühere CA-Aktualisierungsziel
`node24-vite8-ca-v4` bleibt akzeptiert. Ausgangsprofile sind `node24-vite8`, seine
Cleanup-v2-, Overview-v3- und CA-v4-Profile sowie Quickstart-v5 selbst. Ein Downgrade
von Quickstart-v5 auf CA-v4 wird abgelehnt. Legacy-Rezepte und die erste Übernahme können
dieses Upgrade nicht auswählen. Fehlt `buildProfile`, bleiben das exakte bestehende
Rezept und historische Eingabe-Hashes erhalten.

Öffne zuerst einen normalen Merge Request im kanonischen Wizard-Quellcodeprojekt.
Verwende das Ergebnis von `wizard-build/recipe.js` aus dem geprüften Controller mit
`generate(cube,
'node24-vite8-quickstart-v5')`, um jeden zurückgegebenen Eintrag `files` zusammen mit
dem passenden Oberflächenquellcode zu installieren. Beim Wechsel von CA-v4 ändert sich
nur `.system-bootstrapper/build-v1/smoke/check.js`; die bestehende native
`.gitlab/primary.yml` und ihre Prüfbedingungen bleiben identisch. Ersetze die native
CI niemals durch das separate CI-Dokument des verwalteten Rezepts.

Aktualisiere beim Wechsel von einem früheren Profil ohne CA-v4-Vertrauensvorbereitung
auch die bestehenden Eltern der nativen Quellcode- und Auslieferungsjobs, installiere
das eingecheckte öffentliche Paket vor Netzwerkvorgängen und setze
`NODE_OPTIONS=--use-openssl-ca` für Node-Jobs. Behalte erforderliche Quellcode-, Browser-
und Auslieferungsprüfungen, den öffentlichen Spiegel und Umgebungsjobs. Baue und prüfe
sowohl das Auslieferungsimage als auch Browser-/Job-Images neu; eine alte erfolgreiche
Pipeline ist kein Nachweis für die neuen Vertrauenseingaben.

Merge nach dem Review und prüfe die exakte Push-Pipeline des Standardbranches.
Bereite das neue vollständige Manifest `ciFiles` aus diesem Commit, seinen
unveränderlichen Image-Digest, die Pipeline-Identität und das passende geprüfte
Hilfs-Image vor. Stoppe Review/Beta und gleiche sie ab; verwende dieselben
Befehle `plan`/`apply` wie oben. Der Plan enthält alte und neue Build-Rezept-Hashes.
Apply prüft unabhängig jeden freigegebenen CI-Hash und alle allgemeinen
Rezeptbytes, bewahrt die vorherige Konfiguration und den Beleg in einem neuen
privaten Archiv und erhält kanonische Identität sowie Umgebungs-Generationsuntergrenzen.
Eine geänderte oder fehlende CA-Datei, ein fremdes Rezept oder ein erforderlicher
CI-Fehler verweigern die Bindung. Die Production-Image-Freigabe bleibt der separate
Schritt unten.

Eine geänderte Smoke-Datei ändert das freigegebene Manifest `ciFiles`, auch wenn der
native CI-Einstiegspunkt unverändert ist. Bewahre die kanonische Projekt-/Namespace-/
Pfad-/Standardbranch-Identität in der neuen privaten Eingabe, wähle das ausdrückliche
Zielprofil und ersetze Quellcode-Commit, Push-Pipeline-ID, Image-Digest und das vollständige
Manifest eingecheckter Dateien durch die neu geprüften Werte. Behalte das geprüfte
unveränderliche Hilfs-Image. Führe `plan` und `apply` aus einem geprüften Controller/
Hilfsprogramm aus, das das neue Profil erkennt. Bearbeite den gespeicherten Beleg oder
seine Hashes nicht manuell. Bis diese abgesicherte Bindungsaktualisierung abgeschlossen
ist, lehnt die Verifizierung über die alte Bindung die geänderten verwalteten Smoke-Bytes ab.

Füge für ein bereits übernommenes quellcodeführendes Projekt
`"action": "refresh-binding"` zu dieser privaten Eingabe hinzu, um ausschließlich
Rezeptmetadaten zu aktualisieren. Ein ausdrückliches unterstütztes `buildProfile` ist
erforderlich. Diese Aktion erhält die exakte kanonische Projektidentität, jede freigegebene
native CI-Datei außerhalb des generischen Rezepts, Repository-Metadaten und Aliasse für
Wiederherstellungsimages. Sie prüft unabhängig die neuen Rezeptbytes, das vollständige
CI-Manifest, erforderliche Merge-Prüfbedingungen sowie die exakte Push-Pipeline des
Standardbranches und unveränderliche Kandidatenartefakte. Review/Beta müssen gestoppt
und abgeglichen sein. Das bestehende private Archiv, der Bestätigungshash, der atomare
Konfigurationsvergleich und -austausch sowie die Umgebungssperre gelten weiterhin;
eine veraltete Haupt- oder Projektkonfiguration führt zur Ablehnung der Aktualisierung.

Die Aktion lässt die vollständige Hauptkonfiguration und ihre Production-Image-Fixierung
unverändert, auch wenn Production mit einem separat akzeptierten öffentlichen Release-Paar
läuft. Diese Fixierung bleibt als archivierte Konfiguration erhalten; sie wird niemals
als Kandidatennachweis behandelt oder als Wiederherstellungsalias einer privaten Registry
hinzugefügt. Die Prüfung des öffentlichen Paars und die Production-Freigabe behalten ihre
getrennten Release-/Update-Prüfbedingungen. Die erste Übernahme und eine Neuzuordnung
benötigen weiterhin das exakte vorherige Image aus der privaten Registry;
`refresh-binding` kann weder ein Repository übernehmen noch auf ein anderes umleiten.

Führe normalerweise die vorhandenen Befehle `plan`/`apply` im geprüften Controller aus.
Wenn der laufende Controller diese Aktion noch nicht kennt, kann ein Betreiber das
passende akzeptierte unveränderliche Hilfs-Image verwenden und dieselbe persistente
Konfiguration unter `/state` einbinden, ohne einen Controller zu starten oder einen
Docker-Socket einzubinden:

```sh
docker run --rm --network host --mount type=bind,src=/operator/configuration,dst=/state --entrypoint node sha256:REPLACE_WITH_ACCEPTED_HELPER_IMAGE_ID /system/project-bootstrap/wizard-source-primary/run.js plan /state/adoption-input.json /state/adoption-credential.json
docker run --rm --network host --mount type=bind,src=/operator/configuration,dst=/state --entrypoint node sha256:REPLACE_WITH_ACCEPTED_HELPER_IMAGE_ID /system/project-bootstrap/wizard-source-primary/run.js apply /state/adoption-input.json /state/adoption-credential.json PLAN_HASH
```

Ersetze Konfigurationseinbindung und Image-ID durch unabhängig geprüfte Betreibereingaben.
Behalte dieselbe Eingabe und dasselbe Hilfs-Image für Apply und Wiederholungen. Dies führt
den eingecheckten Einstiegspunkt direkt aus, startet keine Dienste und gibt keine Images frei.

## Freigeben und das Duplikat entfernen

Lade genau das neue Image vorab über eingeschränkte Registry-Authentifizierung
und verwende den bestehenden [Production-Plan-/Apply-Ablauf](../wizard-production/README.md).
Sein Prüfer für quellcodeführende Projekte verlangt die kanonische Bindung, das
freigegebene CI-Manifest, die exakte aktuelle Push-Pipeline des Standardbranches,
erforderliche Jobs und passende Artefakte. Production bleibt eine Betreiberfreigabe;
ein Quellcode-Merge allein schaltet sie nicht um.

Prüfe die tatsächliche öffentliche Oberfläche, Review-/Beta-Bereitstellen/-Stoppen,
Konfigurationsabruf, nativen Build-Status und die kalte Image-Wiederherstellung
aus dem übernommenen Projekt. Bewahre das vorherige Image und den Rollback-
Prüfpunkt auf. Aktualisiere Wiederherstellungsanleitungen und Konfigurationssicherung,
damit ein neuer Host das neue Projekt und die Registry-Fixierung verwendet.

Lösche erst dann das doppelte Projekt, nachdem bestätigt ist, dass keine aktive
Abhängigkeit mehr besteht. Löschen entfernt seinen Registry-Endpunkt; ein
historisches Rollback-Image aus diesem Projekt muss in einem bewusst angelegten
lokalen/Offline-Archiv erhalten bleiben. Der exakte Wiederherstellungsalias
erstellt keine gelöschte Registry neu und macht alte Sicherungen nicht unabhängig davon.
