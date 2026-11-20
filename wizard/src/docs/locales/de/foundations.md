## Die Bestandteile deiner Plattform

| Komponente | Aufgabe |
| --- | --- |
| Bootstrapper | Startet und koordiniert Container und persistenten Speicher |
| Wizard | Browseroberfläche für Konfiguration, Runner und Projekte |
| Sync | Authentifizierte API zwischen Wizard und Bootstrapper |
| GitLab | Quellcode-Repositories, Merge Requests und Pipelines |
| Runner-Manager | Führen Pipeline-Jobs in einem gemeinsamen Runner-Pool aus |
| Registry | Speichert die von Pipelines gebauten Container-Images |
| NGINX | Leitet jede konfigurierte Domain an ihren Dienst oder ihre Umgebung weiter |

## Ein sicherer Konfigurationszyklus

**Verbinden → Abrufen → bearbeiten → Sichern → Übertragen → erneut verbinden → Abrufen.**
Abrufen lädt gespeicherte Einstellungen oder bei der Ersteinrichtung gekennzeichnete
Vorschläge. Prüfe die Vorschläge vor dem Übertragen. Übertragen wendet die
Einstellungen an und startet Dienste automatisch neu.

> **Warnung:** Sicherungsdateien enthalten Zugangsdaten. Halte sie privat. Konfigurationssicherungen und abgeschlossene Dienstdaten-Seeds sind getrennte Eingaben für die Wiederherstellung.

## Was eine Änderung überdauert

Quellcode und Images beschreiben die Infrastruktur. Persistente Dienstdaten
enthalten Repositories, Datenbanken, Registry-Inhalte und Geheimnisse. Gespeicherte
Konfiguration hat Vorrang vor Beispielen der Erstinstallation.
[Aktiver Datenspeicher](#docs/storage) erklärt lokale Daten, optionale aktive
Volumes und unabhängige Sicherungsmedien.

## Bauen, prüfen, freigeben

Ein Quellcodeimport installiert Quellcode. Ein Build erzeugt einen Kandidaten.
Review und Beta sind optionale Umgebungen. Die Production-Freigabe ist ein eigener,
bewusster Vorgang mit exaktem Image-Nachweis und einem Rollback-Prüfpunkt. Folge
[Weiterentwicklung](#docs/evolution) für die gesamte Plattform und den verlinkten
Wizard-Anleitungen für die Auslieferung der Oberfläche.
