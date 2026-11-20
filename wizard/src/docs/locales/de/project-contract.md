# Projekt-Bootstrap

Projekt-Bootstrap verbindet die Anwendungskonfiguration mit einem privaten
GitLab-Repository, verwalteter CI, Umgebungsnetzwerken und NGINX-Routing. Der Ablauf
**Projekte → Projekt hinzufügen → Speichern** des Wizards führt die Bereitstellung
über den authentifizierten Sync-Dienst aus. Das Vorgehen im Browser beschreibt
die [Betriebsanleitung](PROJECT_BOOTSTRAP_GUIDE.md).

## Anwendungsvorlagen

| Vorlage | Erzeugte Anwendung |
| --- | --- |
| React | TypeScript-/Vite-Anwendung, festgeschriebene Abhängigkeiten, Node-24-Build und NGINX-Laufzeit. |
| Angular | TypeScript-/Angular-CLI-Anwendung, festgeschriebene Abhängigkeiten, Node-24-Build und NGINX-Laufzeit. |
| Allgemeines Webprojekt | Frameworkfreies HTML, CSS und JavaScript, ohne Node-Build von NGINX ausgeliefert. |
| Leeres Repository | README und verwaltete CI; Anwendungsquellcode und ein Dockerfile im Wurzelverzeichnis müssen separat bereitgestellt werden. |

Vorlagendateien werden unter `project-bootstrap/templates/` versioniert. Quellcode,
Dockerfile, Laufzeitkonfiguration und CI bleiben nach der Erstellung bearbeitbar.
Erzeugte Anwendungspipelines bauen ein Image, veröffentlichen es in der
Instanz-Registry, führen einen HTTP-Kurztest aus und stellen aktivierte Umgebungen
entsprechend ihren konfigurierten automatischen/manuellen Einstellungen bereit.
Die Pipeline verwendet `CI_DEFAULT_BRANCH`, statt einen Branchnamen anzunehmen.

## Repository-Identität und Kollisionen

Anzeigename und Pfad des Repositories entsprechen exakt dem Projektschlüssel:
Schlüssel `mywebapp` erstellt `<selected-namespace>/mywebapp`. Neue Schlüssel
müssen `^[a-z0-9]+$` entsprechen. Oberfläche und Backend lehnen Leerzeichen,
Satzzeichen, Großbuchstaben und leere Schlüssel ab; sie normalisieren die Eingabe
nicht stillschweigend. Bestehende gespeicherte Schlüssel bleiben importierbar.
GitLab-Fehler wegen reservierter Namen oder Namensraumberechtigungen werden
separat gemeldet.

Production-, Beta- und Review-Domains sind unabhängige Einstellungen. Eine
Domainänderung benennt das Repository nicht um. Ein belegtes Ziel blockiert die
Erstellung; der Bootstrapper überschreibt es nicht, verknüpft es nicht stillschweigend
und erfindet keinen Namen mit Zusatz. Der gespeicherte Vorgang erkennt eine
erfolgreiche Wiederholung derselben Anfrage.

Die verzögerte Verfügbarkeitsprüfung verwendet den vollständigen Namensraum-/Repository-Pfad.
Doppelte lokale Schlüssel blockieren die Erstellung ebenfalls. Fehler beim
Nachschlagen bedeuten ungeprüfte Verfügbarkeit; veraltete Antworten werden nach
einer Änderung von Schlüssel oder Namensraum ignoriert. Speichern prüft GitLab
erneut und behandelt die tatsächliche Erstellungsantwort als maßgeblich, auch
bei konkurrierenden Zugriffen nach einer früher erfolgreichen Prüfung.

## Bereitstellung und Wiederaufnahme

Der Sync-Dienst reserviert den lokalen Schlüssel vor der asynchronen Bereitstellung
und speichert den Vorgangsbeleg in `.projects.env/.<key>.env`. Repository-Erstellung,
Vorlageninstallation und CI-Auswahl laufen über den GitLab-Rails-Adapter der
Instanz. Eine temporäre API-Berechtigung mit eingeschränktem Geltungsbereich bleibt
serverseitig und wird nach Ende des Vorgangs widerrufen. Keine GitLab-
Administrationszugangsdaten gelangen in den Browser oder Konfigurationsexport.

Die Repository-Identität wird gespeichert, bevor das Routing angewendet wird.
Eine Wiederholung kann deshalb das Routing reparieren oder die erste Pipeline
wiederaufnehmen, ohne ein weiteres Repository anzulegen. Statusabfragen liefern
Abschluss oder einen sicheren Fehler über authentifizierte kurze Anfragen.
Ausstehende Vorgänge schließen widersprechende Konfigurations-/Dienständerungen
aus. Ein fremdes Repository, eine bearbeitete verwaltete Datei oder ein ungewisses
externes Ergebnis müssen geprüft werden, statt sie durch Zurücksetzen ihres
Belegs zu umgehen.

Der ausgewählte CI-Pfad ist `.system-bootstrapper/ci.yml`. Upstream-Dateien zur
Veröffentlichung bleiben separat erhalten. Umgebungseinstellungen und erzeugtes
Routing müssen mit der verwalteten Pipeline übereinstimmen. Die Projektbereitstellung
lässt GitLab weiterlaufen.

## Den Wizard selbst verwalten

Bei aktiviertem und konfiguriertem Wizard registriert der Start automatisch das
private Systemprojekt `root/wizard`. Es repräsentiert die bestehende Oberfläche;
sein Production-Host, HTTP-/HTTPS-Modus und seine Zertifikatseinstellungen stammen
aus Allgemein. Wiederholtes Starten behält Repository-Identität, Ablaufbelege und
installierte optionale Umgebungseinstellungen. Ein belegter lokaler Schlüssel
oder ein fremdes Repository wird gemeldet, ohne überschrieben zu werden.

Die Registrierung erstellt ein deaktiviertes README-/CI-Grundgerüst. Weitere
Aktionen erfolgen ausdrücklich und unabhängig:

1. [Quellcode initialisieren](WIZARD_SOURCE.md) aus dem eingecheckten System-Wizard-Gitlink.
2. [Bauen und prüfen](WIZARD_BUILD.md) der importierten Anwendung und des unveränderlichen
   Registry-Kandidaten.
3. [Review und Beta](../project-bootstrap/wizard-environments/README.md) auf separaten
   HTTPS-Hosts konfigurieren und über manuelle GitLab-Jobs bereitstellen/stoppen.
4. Einen geprüften Kandidaten über das abgesicherte
   [Verfahren für Production-Freigabe und Rollback](../project-bootstrap/wizard-production/README.md) anwenden.

Quellcodeimport, Kandidaten-Builds und Review-/Beta-Deployment ersetzen die laufende
Verwaltungsoberfläche nicht. Die Production-Freigabe ist eine vom Betreiber
bestätigte Aktion. Der Quellcodeimport ändert weder das Upstream-Repository noch
macht er diese Instanz zur maßgeblichen Entwicklungsquelle; die Auswahl von
Primär-/Sicherungsrepository ist eine separate
[Konfigurationsentscheidung](GITLAB_GITHUB_BACKUP.md).

## Konfiguration und Dienstdaten

Projektidentität und Ablaufbelege bleiben beim authentifizierten Abrufen,
Sichern/Öffnen, Übertragen und Neustarten erhalten. Der verwaltete Wizard-Eintrag
hält seine Production-Einstellungen unter Allgemein, während optionale verwaltete
Umgebungen ihren eigenen Dialog verwenden. Harvest/Seed verarbeitet Dienstdaten
und Zertifikate; Konfigurationssicherungen bleiben separat. Halte Geheimnisse aus
Repository-Dateien und aufbewahrten Build-Nachweisen heraus.
