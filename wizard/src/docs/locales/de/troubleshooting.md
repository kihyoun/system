## 4. Fehlerbehebung

| Beobachtung | Nächster Schritt |
| --- | --- |
| `localhost` öffnet sich nicht | Halte eine Ubuntu-Konsole geöffnet und prüfe `sudo docker ps` |
| Verbinden meldet Network Error | Prüfe die Adresse über Bearbeiten: beim ersten lokalen Start `http://localhost/sync`, danach die konfigurierte Sync-Domain |
| Die Anmeldung wird abgelehnt | Lies die aktiven Werte mit dem privaten lokalen Befehl aus Abschnitt 0.4 aus; gespeicherte Haupteinstellungen haben Vorrang vor Zugangsdaten des ersten Starts |
| Das Formular enthält Beispielwerte | Verbinde dich und verwende zuerst Abrufen; ein unverbundenes Formular ist nicht die Serverkonfiguration |
| Abrufen liefert auf einer frischen Instanz 404 | Lade den Wizard neu; sowohl Wizard als auch Sync müssen Versionen verwenden, die Vorschläge unterstützen |
| Gespeicherte Beispielwerte kehren zurück | Abrufen bevorzugt gespeicherte Einstellungen. Korrigiere sie ausdrücklich im Wizard; Vorschläge überschreiben keine bestehende Konfiguration |
| GitLab ist noch nicht erreichbar | Warte nach dem durch Übertragen ausgelösten automatischen Neustart auf `healthy` und prüfe bei Bedarf die GitLab-Protokolle |
| Vier konfigurierte Runner-Container erscheinen als ein GitLab-Runner | Öffne die Runner-Detailseite und prüfe **Runner managers**; der gemeinsame Pool hat einen Eintrag mit unabhängigen Manager-System-IDs |
| Der Start meldet fehlenden persistenten Speicher | Prüfe den gewählten Modus und das Verzeichnis; hänge ein ausdrücklich ausgewähltes aktives Volume ein, statt durch einen Moduswechsel dessen Schutz zu umgehen |
| Eine Pipeline wartet nach einem GitLab-Neustart auf ihren Runner | Registrieren prüft den Pool und aktualisiert verwaltete interne IP-Endpunkte auf den stabilen Docker-Dienstnamen |
| Eine Pipeline kann `registry.localhost` nicht auflösen | Führe in Ubuntu erneut `sudo system-bootstrapper host-bootstrap prepare-local --checkout "$PWD"` aus; WSL kann lokale Hosts-Einträge beim Start zurücksetzen |
| MongoDB scheitert vor der Datenbankinitialisierung | Führen Sie `system-bootstrapper host-bootstrap container-preflight --checkout "$PWD"` auf dem Daemon-Host aus; unterscheiden Sie CPU, Ubuntu-Upstream-Kernel und Image-Ausführung anhand des [Host-Betriebsleitfadens](HOST_OPERATIONS.md) |
| Für Container-Protokolle ist keine Rotation nachgewiesen | Prüfen Sie die exakten Container mit `system-bootstrapper host-bootstrap log-policy --checkout "$PWD"`; wenden Sie die begrenzte Richtlinie durch eine bewusste Auslieferung an und prüfen Sie sie, ohne ein Höchstalter anzunehmen |
| `docker ps` zeigt keinen separaten Sync-Node-Container | Erwartetes Verhalten: Node läuft im Bootstrapper-Container. `system_sync_1` ist beim ersten Start der NGINX-Zugangspunkt |

Weitere technische Einzelheiten findest du in [Prepare-Host.md](../Prepare-Host.md).
