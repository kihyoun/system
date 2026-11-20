## 1. Hauptaktionen

| Aktion | Was geschieht |
| --- | --- |
| Verbindung bearbeiten (Stift) | Öffnet den Dialog für Serveradresse und Sync-Zugangsdaten |
| Übernehmen / Verbinden | Meldet den Wizard beim Sync-Dienst an |
| Trennen | Trennt die Verbindung des Wizards |
| Öffnen | Lädt eine Konfigurationsdatei von deinem Computer in den Wizard |
| Sichern | Lädt Konfiguration als JSON oder als ZIP mit JSON, erzeugten Umgebungsdateien, `recovery.json` und `RECOVERY.md` herunter |
| Abrufen | Ruft gespeicherte Instanzeinstellungen ab; ohne Konfiguration lädt die aktuelle Version gekennzeichnete Vorschläge |
| Übertragen | Prüft und überträgt die Konfiguration; bestehendes Anwendungsrouting lädt den Proxy neu, weitergehende Änderungen starten die Instanz neu |
| Neustarten | Startet die Dienste mit der übertragenen Konfiguration neu |
| Registrieren / Registrierung aufheben | Prüft/registriert die konfigurierten Runner-Manager oder hebt ihre Registrierung auf |
| Harvest | Veröffentlicht einen kalten Schnappschuss der GitLab-Daten, Zertifikate und des Zertifikatserneuerungszustands im Seed-Verzeichnis |
| Harvest und Konfigurationssicherung | Koordiniert einen nativen Harvest mit einer passenden Konfigurations-ZIP zum getrennten Herunterladen und Aufbewahren |
| System Beta konfigurieren | Reserviert ausdrücklich ein bestehendes gemeinsames Quellprojekt und eine optionale feste Beta-Adresse; kein zusätzlicher Build und keine Production-Änderung |
| Ablauf von Zugangsdaten | Liest Metadaten ausgewählter Automatisierungszugänge und zeigt bekannte Daten, Warnungen und unbekannte Zustände |
| Systemdiagnose | Prüft die konfigurierte Registry-Verbindung; eine optionale getrennte Aktion lädt das exakte Helper-Image über den ausgewählten Runner-Daemon |
| Seed | Prüft einen abgeschlossenen Seed und stellt ihn in frischen Verzeichnissen für die aktiven Dienstdaten wieder her |
| Zurücksetzen | Löscht die Haupt- und Projektkonfigurationen über den Ablauf zum Zurücksetzen |
| Aktualisieren | Aktualisiert den Quellcode über den bestehenden Aktualisierungsablauf |

Voraussetzungen und Grenzen erklären [Entwicklungsvorschauen](DEVELOPMENT_PREVIEWS.md),
[gemeinsame Sicherungen](COORDINATED_BACKUP.md), [Ablauf von Zugangsdaten](TOKEN_EXPIRY.md)
und [Systemdiagnose](SYSTEM_DIAGNOSTICS.md).

**Konfiguration und persistente Dienstdaten werden getrennt verwaltet.** Öffnen/Sichern
und Übertragen/Abrufen verwalten die Konfiguration. Harvest/Seed verarbeiten Dienstdaten.
Keiner der Konfigurationsdownloads enthält den Seed, Datenbanken oder Registry-Inhalte.
Harvest und Seed werden nicht benötigt, um eine Konfiguration mit Abrufen anzuzeigen.

Eine neue Konfigurations-ZIP enthält `recovery.json` und `RECOVERY.md`. Diese halten
verfügbare gespeicherte und beobachtete Release-/Quellcode-/Image-Identitäten fest
und erklären ihre Vollständigkeit. Eine exportierte Referenz bewahrt kein Image:
Halte zugängliche Images, passende private Konfiguration und einen getrennten
vollständigen Seed vor, bevor du auf Wiederherstellung vertraust. Ältere Konfigurations-
sicherungen lassen sich weiterhin öffnen; fehlende Wiederherstellungsmetadaten belegen
keinen geprüften Wiederherstellungssatz. Erweiterte ZIPs verlangen kompatible akzeptierte
Wiederherstellungswerkzeuge ab 1.0.0; das aktualisiert nicht die gespeicherten
Laufzeit-Images. Folge dem
[Leitfaden für Wiederherstellungseingaben](RECOVERY_CONTRACT.md), um alle passenden Eingaben zu prüfen.

Detail der aktuellen Implementierung: Die bestehende Wizard-Aktion **Seed**
überträgt vor der Datenwiederherstellung auch die Hauptkonfiguration aus dem Formular.
Prüfe das Formular vor dem Aufruf. Die Vorschläge für den ersten Start haben diese
Kopplung nicht verändert. Verwende Übertragen für die Ersteinrichtung in Kapitel 0.

Harvest stoppt GitLab und verlangt ein sauberes Herunterfahren, bevor dessen Daten
kopiert werden. Der Vorgang stimmt sich mit der Zertifikatserneuerung ab und
veröffentlicht erst nach erfolgreichem Kopieren ein Abschlussmanifest mit Prüfsummen;
frühere abgeschlossene Schnappschüsse bleiben verfügbar. Seed prüft den Schnappschuss
und verlangt vor der Wiederherstellung das passende GitLab-Image. Sichere eine passende
Konfiguration separat und folge dem [Wiederherstellungsvertrag](RECOVERY_CONTRACT.md).
Bei lokalen aktiven Datenverzeichnissen ist ein separates externes Seed-Dateisystem
nötig. Ältere Volume-Aufteilungen können ihren getrennten Seed auf dem aufbewahrten
aktiven Volume halten; das schützt nicht vor dem Verlust dieses Volumes.
