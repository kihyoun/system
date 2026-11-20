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

Der Start erhält das verwaltete Wizard-Projekt und seine Production-Identität.
Fetch liest vorhandene Repository- und Routing-Einstellungen. Adresse und
Zertifikate des laufenden Wizards bleiben unter General konfiguriert; erneuter
Start ersetzt weder die Oberfläche noch ein fremdes Repository.

System und Wizard teilen ein Repository mit regulärem Anwendungscode unter
wizard/. Entwicklung, Review und Prüfung erfolgen gemeinsam in der System-Pipeline.
Die System-Zeile bietet keinen separaten Quellimport, keine eigenständige
Build-Aktivierung und kein System-Review-Deployment mehr. Normale
Anwendungsprojekte behalten ihre eigenen Review-, Beta- und Production-Umgebungen.

Wähle **System Beta konfigurieren**, um ein bestehendes privates System-Projekt,
einen geschützten Standardbranch, einen geeigneten Runner und optional eine feste
HTTPS-Beta-Adresse mit gültigen Zertifikaten auszuwählen. Die Vorprüfung liest nur;
die Bestätigung reserviert Einstellungen, ohne Projekte, Builds oder Deployments
zu starten. Die [System-Beta-Anleitung](SYSTEM_CANDIDATE_REVIEW.md) beschreibt die
Bindung an den bereits geprüften System-Kandidaten und seine bewussten manuellen
Deploy-/Stop-Jobs. Beta verwendet genau dessen Wizard-Image ohne zusätzlichen Build.

Alte JSON-/ZIP-Konfigurationen und abgerufene Einstellungen bleiben lesbar.
Migriere Vorschau-Einstellungen der Version 1 ausdrücklich über System Beta
konfigurieren; ein gespeicherter Review-Hostname wird niemals automatisch zur
Beta-Adresse. Repository-/Importhistorie, Quelländerungen, Bindungen,
Generationsuntergrenzen und Tombstones bleiben erhalten. Stoppe Altressourcen vor
der Migration mit ihrem ursprünglichen eigenen Job und Helper. Aktive, ausstehende,
ausgemusterte oder noch nicht bereinigte gestoppte Routen blockieren die Einrichtung.
Lösche keine Belege zur Umgehung dieser Prüfungen. Konfigurationsbackup und passende
Harvest-/Seed-Wiederherstellung bleiben getrennte Anforderungen.

#### Den gemeinsamen Kandidaten prüfen

Öffne die Pipeline des ausgewählten System-Projekts und warte auf alle Pflichtprüfungen
für Komponenten, Images, Browser und die wegwerfbare Plattform. Ein grüner Job reicht
nicht: Die Beta-Bindung prüft Release-Artefakt, gemeinsamen Commit, Wizard-Quellbaum,
exakte Images und Eigentum. Abgelaufene oder widersprüchliche Artefakte verhindern
neue Deployments. Stop verwendet die erhaltene Bindung samt Helper. Production bleibt
bis zur gesonderten bewussten und geprüften Freigabe ausgewählt.

Der wegwerfbare Plattformtest führt gemeinsame Einrichtung, Bindung, Beta-Container,
TLS, Stop und Bereinigung tatsächlich aus. Sein Autorisierungsprüfer verwendet
explizite Vertragsfixtures, weil der übergeordnete Kandidat noch läuft. Das belegt
den Lebenszyklus sowie positive und negative Verträge des Production-Prüfers,
nicht die Autorisierung durch eine abgeschlossene native Kandidatenpipeline.
Siehe die [Abnahmegrenze](../tests/e2e/GUIDED_PREVIEW_ACCEPTANCE.md).


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
