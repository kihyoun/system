## 3. Anwendungen und Umgebungen konfigurieren

Der Bereich **Projekte** des Wizards hieß früher **Proxy**. Er beschreibt eine
Anwendung mit ihren Umgebungen **Produktion**, **Beta** und **Review-Apps**.
Verwende **Projekt hinzufügen**, um ihre Deployment-Konfiguration anzulegen.
Ein NGINX-Proxy leitet Anfragen für konfigurierte Domains an die zugehörigen
Anwendungscontainer weiter. Der Proxy ist ein Teil der Anwendungskonfiguration.

Einige Bilder in Kapitel 0 zeigen noch die frühere Bezeichnung **Proxy**. Die
aktuelle Oberfläche verwendet an derselben Stelle **Projekte**.

Bei neuen Projekten ist der **Projektschlüssel** exakt der GitLab-Name und -Pfad.
Nur Kleinbuchstaben a–z und Ziffern sind erlaubt; bestehende gespeicherte Schlüssel
werden nicht umbenannt.

Verbinde den Wizard mit Sync und verwende zuerst **Abrufen**. Wähle unter
**Projekte → Projekt hinzufügen** den Namensraum, prüfe die Verfügbarkeit und
konfiguriere die aktivierten Umgebungen mit ihren HTTP-/HTTPS-Einstellungen.
**Speichern** erstellt ein privates GitLab-Repository mit README und erzeugter
CI. Die Einrichtung meldet ihren Fortschritt asynchron. Belegte Repositories
werden weder übernommen noch überschrieben; wiederholtes Speichern erzeugt
keine Duplikate.

### 3.1 Eine Anwendung aus einer Vorlage starten

Wähle im Erstellungsdialog eine **Anwendungsvorlage**:

| Auswahl | Erzeugter Ausgangspunkt |
| --- | --- |
| React + TypeScript + Vite | React-Quellcode, Vite-Build, Lockdatei und Dockerfile |
| Angular + TypeScript | Angular-Quellcode, CLI-Build, Lockdatei und Dockerfile |
| Allgemeines Webprojekt | HTML, CSS und JavaScript ohne Framework-Build, mit Dockerfile |
| Leeres Repository | Nur Repository und CI; eigenen Quellcode später ergänzen |

Die ersten drei Optionen enthalten ein Dockerfile. Speichern erzeugt die Dateien
und passende CI und startet nach der Routing-Einrichtung die erste Pipeline.
Die Pipeline baut und veröffentlicht das Image, prüft seine HTTP-Antwort und
startet automatische Deployments. Starte für ein manuelles Deployment den
zugehörigen Job selbst in GitLab.

Öffne den Pipeline-Link und warte auf erfolgreiche Build- und Deployment-Jobs,
bevor du die Anwendungsdomain prüfst. Ein Repository-Link allein belegt nicht,
dass eine Anwendung läuft. Anschließend kannst du direkt am erzeugten Quellcode
arbeiten; auch Dockerfile und Pipeline bleiben bearbeitbar. GETTING_STARTED.md
im neuen Repository erklärt die lokalen Befehle. Neue Angular- und React-Projekte
bauen mit Node 24, ebenso wie der System Wizard selbst.

Ein leeres Repository ist noch keine laufende Anwendung. In diesem Ablauf wartet
die Pipeline auf Anwendungsquellcode mit einem Dockerfile. Repository-Metadaten
bleiben beim Abrufen und bei JSON-Sichern/Öffnen erhalten. Die vollständige
Anleitung einschließlich der Wiederaufnahme nach Fehlern findest du im
[Projektleitfaden](PROJECT_BOOTSTRAP_GUIDE.md).

### 3.2 Der automatisch registrierte System Wizard

Sobald die Plattform eine Hauptkonfiguration hat und GitLab verfügbar ist,
registriert der Start automatisch **wizard** als erstes Projekt, wenn der Wizard
aktiviert ist. Verwende nach Abschluss der Registrierung Abrufen. Seine
Production-URL, der HTTP-/HTTPS-Modus und die Zertifikatspfade stammen aus den
tatsächlichen Wizard-Einstellungen unter Allgemein; lokal bleibt die bestehende
Oberfläche unter `http://localhost` erreichbar.

Das Projekt beginnt mit einem privaten Repository-Grundgerüst `root/wizard`, das
README und verwaltete CI enthält. Klappe seine Zeile auf und wähle
**Wizard-Quellcode initialisieren**, um den festgelegten Anwendungsquellcode in
einer Vorschau zu prüfen und ausdrücklich zu importieren. Vorbereitung und
sicheres Wiederholen beschreibt die [Anleitung zur Quellcode-Initialisierung](WIZARD_SOURCE.md).
Diese reine Quellcode-Aktion startet keine Pipeline und stellt keine andere
Oberfläche bereit. Nach der Initialisierung öffnet **Wizard erstellen und prüfen**
eine eigene schreibgeschützte Vorschau. **Build-Pipeline aktivieren** installiert
ausdrücklich das verwaltete Rezept und startet seine erste Pipeline oder nimmt
sie wieder auf. Erforderliche zueinander passende Versionen, geprüfte
Kandidatennachweise und die sichere Wiederaufnahme beschreibt die
[Anleitung zum Build-Ablauf](WIZARD_BUILD.md). Die Build-Aktivierung stellt den
Kandidaten nicht bereit. Optionale Review- und Beta-Umgebungen erfordern eine
explizite Konfiguration und manuelle GitLab-Deployment-Jobs; die Freigabe für
Production verwendet ihren eigenen abgesicherten Betreiberablauf. Der bestehende
Wizard-Container und die Production-Route werden ohne zusätzlichen Projekt-Proxy
wiederverwendet. Verwalte die Oberflächeneinstellungen unter Allgemein; das
Systemprojekt ist in der Projektliste schreibgeschützt. Seine Repository-Links
und Konfiguration bleiben beim Abrufen, Sichern, Öffnen, Übertragen und Neustarten
erhalten. Wiederholtes Starten verwendet dasselbe Repository.

Wenn bereits ein lokaler Schlüssel `wizard` oder ein fremdes GitLab-Repository
existiert, meldet der Bootstrapper den Konflikt, ohne es zu überschreiben. Ein
Registrierungsfehler ersetzt oder stoppt die funktionierende Oberfläche nicht.
Prüfe die Bootstrapper-Ausgabe, behebe den gemeldeten Konflikt oder das
Bereitschaftsproblem und starte erneut, um es noch einmal zu versuchen.

#### Den Wizard manuell bauen und prüfen

Verwende vor dem Start zueinander passende System- und Wizard-Versionen, die die
Quellcode- und Build-Aktionen anbieten. Das System-Image muss sein vorbereitetes,
festgelegtes Wizard-Quellcodepaket enthalten. GitLab, seine Projekt-Registry und
ein gemeinsamer Runner, der das Tag `docker` akzeptiert, müssen verfügbar sein.
Der Runner benötigt die geprüfte Docker-Executor-Einrichtung des verwalteten
Rezepts einschließlich Docker-/Buildx-Zugriff und Registry-Verbindung. Prüfe,
dass genügend physischer Speicherplatz und RAM für den Build verfügbar sind;
vermeide konkurrierende Infrastruktur-Builds zur selben Zeit. Neue Importe
verwenden den festgelegten Quellcode mit Node 24/React 19/Vite 8 und das passende
moderne Build-Rezept. Bestehende ältere Importe erfordern das ausdrückliche
[Upgrade-Verfahren](../project-bootstrap/wizard-upgrade/README.md); ein erneuter
Quellcodeimport ist kein Upgrade-Verfahren.

Führe bei der lokalen WSL-Einrichtung nach einem WSL-Neustart erneut
`sudo bash bootstrapper/prepare-local.sh` aus, falls `registry.localhost` nicht
mehr aufgelöst wird. WSL kann `/etc/hosts` neu erzeugen. Die Vorbereitung lädt
die Docker-Konfiguration neu, ohne die laufenden Container neu zu starten;
wiederhole danach den fehlgeschlagenen Job in derselben Pipeline.

1. Öffne die bestehende Wizard-Adresse. Gib über das Stiftsymbol neben
   **Verbinden** die konfigurierte Sync-Adresse und deine aktuellen Sync-Zugangsdaten
   ein und wähle **Übernehmen**. Verwende nach der Ersteinrichtung die konfigurierte
   Sync-Domain, statt anzunehmen, dass der anfängliche Pfad `http://localhost/sync`
   weiterhin stimmt.
2. Wähle **Synchronisieren → Abrufen**. Klappe unter **Projekte** den ersten
   Eintrag **wizard** auf. Prüfe seinen Repository-Link und die bestehende
   Production-Adresse. Falls der verwaltete Eintrag fehlt, behebe zuerst die
   Registrierung; erstelle mit **Projekt hinzufügen** kein zweites Wizard-Projekt.
3. Wenn der Quellcode bereits initialisiert ist, bewahre seinen Beleg auf und
   gehe zu Schritt 4; importiere nach der Aktivierung des verwalteten Builds
   nicht erneut. Wähle andernfalls **Wizard-Quellcode initialisieren**. Prüfe
   in der Vorschau **Repository**, **Quellcoderevision** und **Dateien** und
   wähle dann **Quellcode importieren**. Warte auf den Abschluss. Dies importiert
   den durch diese System-Version festgelegten Quellcode, ohne eine Pipeline
   zu starten. Falls der Quellcode bereits importiert war, bewahre diesen Beleg
   auf; erneutes Importieren ist kein Verfahren zur Quellcode-Aktualisierung.
4. Schließe den Quellcode-Dialog und wähle **Wizard erstellen und prüfen**. Prüfe
   **Repository**, **Importierter Commit** und **Rezeptversion**. Die Vorschau
   allein erzeugt keine Pipeline und ändert das Repository nicht.
5. Wähle **Build-Pipeline aktivieren** einmal. Warte auf den Abschluss des
   Controller-Vorgangs; dieser speichert das verwaltete Rezept und die erste
   Pipeline. Eine unterbrochene Browserantwort ist ein Anlass, den gespeicherten
   Vorgang zu prüfen/aktualisieren, nicht seinen Beleg zu löschen oder ein
   weiteres Projekt zu erstellen.
6. Wähle im Build-Dialog **Pipeline öffnen**. Prüfe in GitLab die Jobs
   `build:wizard` und `test:wizard` derselben Pipeline. Der erste führt die
   festgelegten Anwendungsprüfungen und den Production-Build aus und veröffentlicht
   dann ein Kandidaten-Image. Der zweite lädt das unveränderliche Image und
   prüft HTTP, die dargestellte Oberfläche, Projekte und SPA-Navigation in
   einem isolierten Browser-Kandidaten. Ein wartender Runner oder laufender
   Job hat diese Prüfungen noch nicht bestanden.
7. Kehre zum Wizard zurück und wähle nach Abschluss der Jobs **Status aktualisieren**.
   Warte auf **Die Kandidatenprüfungen und das unveränderliche Artefakt sind verifiziert. Die Produktionsumgebung bleibt unverändert.**
   und **Geprüftes Kandidaten-Image**. Halte die Pipeline und die auf
   `@sha256:…` endende Image-Referenz fest. Eine grüne Pipeline allein ersetzt
   nicht die Controller-Prüfung der erforderlichen Jobs und passenden Artefakte.
8. Prüfe bei Bedarf die GitLab-Job-Artefakte als Nachweise: `build-evidence.json`
   aus `build:wizard` sowie `wizard-evidence.json` und `browser-evidence/` aus
   `test:wizard`. Die Nachweise gehören zu dieser Pipeline und diesem Commit.
   Das Rezept bewahrt diese Artefakte derzeit sieben Tage lang auf; ein
   abgelaufenes Artefakt kann eine spätere Prüfung verhindern, selbst wenn
   ein früherer Job grün war.
9. Bestätige, dass sich der bestehende Wizard weiterhin unter seiner
   ursprünglichen Adresse öffnet. Rufe erneut ab und prüfe, dass dasselbe
   Projekt/Repository und dieselbe Production-Adresse erhalten sind. Die
   Build-Prüfung ersetzt die laufende Oberfläche nicht. Konfiguriere zum
   Bereitstellen des Kandidaten die [verwalteten Review- und Beta-Umgebungen](../project-bootstrap/wizard-environments/README.md)
   und verwende ihre manuellen GitLab-Jobs. Production-Freigabe und Rollback
   verwenden das eigene [abgesicherte Betreiberverfahren](../project-bootstrap/wizard-production/README.md).

Verwende bei Fehlern die [Tabelle zu Build-Status und Wiederaufnahme](WIZARD_BUILD.md#status-and-safe-continuation).
Wiederhole fehlgeschlagene Jobs in derselben GitLab-Pipeline und aktualisiere
anschließend den Status. Setze nur fort, wenn der Dialog **Aktivierung fortsetzen**
anbietet, nachdem **Vorschau aktualisieren** den aktuellen Zustand bestätigt hat.
**Das Ergebnis der Pipeline-Erstellung ist ungewiss. Aktualisieren Sie nur den Status.** erlaubt
nur Aktualisieren und erfordert eine Administratorprüfung; lösche niemals den
dauerhaften Prüfpunkt, um eine weitere Pipeline zu erzwingen. Halte Zugangsdaten
aus Bildschirmfotos, Aufgabenkommentaren und Auszügen aus Job-Protokollen heraus.

### 3.3 Gemeinsame und zusätzliche Runner

Die Runner-Einstellungen erfüllen zwei unterschiedliche Zwecke:

| Stelle im Wizard | Bedeutung |
| --- | --- |
| Allgemein → GitLab-Runner | Gemeinsamer Instanz-Runner-Pool für mehrere GitLab-Projekte |
| Projekte → Zusätzliche Runner (optional) | Zusätzliche Runner-Container für diese Anwendungskonfiguration mit einem separat angegebenen Token |

Beginne mit **0** zusätzlichen Projekt-Runnern. Deine Pipelines können den
gemeinsamen Pool verwenden, wenn Instanz-Runner für das GitLab-Projekt aktiviert
sind und die Job-Tags passen. Ein Wert von 0 deaktiviert die gemeinsamen Runner
nicht; er startet lediglich keine zusätzlichen Container für diese Anwendung.

Bei zusätzlichen Runnern bestimmen ihre GitLab-Registrierung und ihr Token,
welche Projekte sie verwenden können. Die Zuordnung eines Runners zu einem
Projektschlüssel allein beschränkt ihn nicht auf dieses GitLab-Projekt. Die
automatische Token-Erstellung in Kapitel 2 gilt für den gemeinsamen Instanz-Pool.
