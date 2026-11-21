## 2. GitLab-Runner einrichten

Ein Runner führt Jobs in deinen GitLab-Pipelines aus. Für die eigene GitLab-Instanz
des Bootstrappers kann er automatisch eingerichtet werden. Die automatische
Einrichtung erfordert GitLab 16 oder neuer; das historische Standard-Image GitLab 12
unterstützt diesen Ablauf nicht. Verwende für den lokalen Test die Image-Einstellungen
aus Kapitel 0.

### 2.1 Anzahl festlegen und Runner starten

1. Öffne den Wizard und verbinde dich über **Verbindung bearbeiten → Übernehmen** mit Sync.
2. Lade die bestehende Konfiguration mit **Synchronisieren → Abrufen**, damit das
   nächste Übertragen deine konfigurierten Hosts bewahrt.
3. Gib unter **GitLab-Runner** die gewünschte Anzahl ein, zunächst **1**. Der
   erlaubte Bereich ist 0 bis 50; wähle eine Anzahl, die zu Arbeitsspeicher und CPU
   deines Computers passt.
4. Lass **Runner-Authentifizierungstoken** für die automatische Einrichtung leer.
   Ein bereits durch Abrufen geladener Token kann stehen bleiben: Er wird wiederverwendet.
5. Übertrage und übernimm die Einstellungen mit **Synchronisieren → Übertragen**;
   der Neustart erfolgt automatisch. Warte auf den GitLab-Start und die Runner-Registrierung.
6. Prüfe in der Ubuntu-Konsole:

   ```bash
   sudo docker ps
   ```

   Bei einer Anzahl von 1 sollte `runner_docker_1` vorhanden sein. Ein laufender
   Container allein bestätigt keine erfolgreiche Registrierung. Nach der Registrierung
   meldet der Bootstrapper `Runner runner-docker-1 registered.` oder beim Prüfen
   einer bestehenden Registrierung `Runner runner-docker-1 verified.`.
7. Melde dich als Administrator bei GitLab an und prüfe **System Bootstrapper Docker
   pool** unter **Admin → CI/CD → Runners**. Die verbundenen Runner-Manager müssen
   online sein. Projekte können diesen Instanz-Runner verwenden, wenn Instanz-Runner
   für das jeweilige Projekt aktiviert sind.

Die Anzahl bezeichnet **Runner-Container in einem gemeinsamen Instanz-Runner-Pool**.
GitLab zeigt einen Runner-Eintrag mit mehreren Managern statt eines eigenen globalen
Runner-Eintrags pro Container. Öffne die Detailseite des Runners und prüfe unter
**Runner managers** die System-ID und den Online-Status jedes Containers. Der
automatisch erzeugte Pool hat die Tags `docker` und `aws` und akzeptiert auch
Jobs ohne Tags.

### 2.2 Token anzeigen und Konfiguration herunterladen

1. Verbinde den Wizard nach dem Neustart bei Bedarf erneut mit der konfigurierten
   Sync-Adresse, lokal zum Beispiel `http://sync.localhost`.
2. Wähle **Synchronisieren → Abrufen**. Der Wizard lädt jetzt auch den erzeugten
   Runner-Token aus der Bootstrapper-Konfiguration.
3. Der Token ist standardmäßig verborgen. Verwende **Anzeigen**, um ihn im
   Eingabefeld anzuzeigen und zu kopieren; **Ausblenden** blendet ihn wieder aus.
4. Wähle **Sichern**, um die Konfiguration einschließlich des Runner-Tokens als
   Bootstrapper-JSON herunterzuladen. Halte diese Datei privat.

Der Export speichert den Token unter `gitlabRunnerToken` und die Anzahl unter
`gitlabRunnerScale`. Der Token gehört zu dieser GitLab-Instanz; eine unabhängige
neue GitLab-Datenbank erkennt ihn nicht. Lass das Feld für die automatische
Ersteinrichtung mit einer neuen Datenbank erneut leer. Manuell angegebene Tokens
werden ebenfalls unterstützt und nicht durch automatisch erzeugte ersetzt.

### 2.3 Was intern geschieht

Der Bootstrapper wartet auf die Bereitschaftsprüfung von GitLab und verwendet
seinen bestehenden Docker-Zugriff auf den eigenen GitLab-Container. Darin erzeugt
er einen vorübergehenden Administrator-Zugriffstoken mit dem Geltungsbereich
`create_runner`, erstellt den Instanz-Runner über die GitLab-API und widerruft den
Zugriffstoken sofort, auch bei einem API-Fehler. Der Zugriffstoken bleibt innerhalb
des GitLab-Prozesses und erscheint weder im Wizard noch in der JSON-Sicherung.
Als Absicherung gegen einen abrupten Prozessabbruch läuft er am folgenden Tag ab;
eine spätere Einrichtung widerruft außerdem übrig gebliebene Einrichtungstokens.

Nur der Runner-Authentifizierungstoken wird in der Bootstrapper-Konfiguration
gespeichert. Eine erneute Registrierung verwendet den bestehenden Pool wieder.
Jeder Manager hält seine eigene `config.toml` und System-ID unter
`PERSISTENT_DIR/runners/<pool>/<index>/` dauerhaft vor. Neustarts verwenden diese
Identitäten wieder. Beim Verkleinern bleiben die Verzeichnisse erhalten, damit
eine spätere Vergrößerung sie wiederverwenden kann. Gestoppte Manager können als
Offline-Einträge in GitLab sichtbar bleiben. Lösche nicht den gesamten Runner-Pool,
um einen einzelnen alten Manager zu entfernen. Runner verwenden den Dienstnamen
`gitlab` im gemeinsamen Docker-Netzwerk, damit ein GitLab-Neustart mit einer
anderen internen IP ihre Verbindung nicht unterbricht. Registrieren aktualisiert
alte interne IP-Endpunkte in verwalteten Runnern, ohne ihre Tokens oder extern
konfigurierte Adressen zu ändern. Die Wiederaufnahme nach einer unterbrochenen
Konfigurationsspeicherung findet den verwalteten Pool anhand seines Namens.
Lass den Namen dieses Eintrags unverändert, wenn du dieses Wiederherstellungsverhalten
nutzen möchtest.

**Registrieren** startet oder skaliert Runner mit der gespeicherten Konfiguration
und prüft ihre Registrierung. **Registrierung aufheben** hebt die Registrierung
der Manager auf. Bei moderner Token-Registrierung bleibt der globale Runner-Eintrag
in GitLab erhalten. Die Anzahl **0** stoppt die Runner-Container, ohne den Pool oder
Token zu löschen. Wizard-Änderungen werden erst mit Übertragen übertragen.

Diese Einrichtung verändert den Harvest-/Seed-Zyklus nicht. Die Bootstrapper-
Konfiguration wird weiterhin über Übertragen/Abrufen und Öffnen/Sichern verwaltet.

### 2.4 Lokaler Funktionstest

Für eine ausdrücklich verwerfbare Testinstanz erzeugt die native Runner-Prüfung ein privates, eindeutig markiertes Testprojekt samt Pipeline, prüft den tatsächlichen Runner, lädt dessen Ergebnis herunter und prüft authentifiziertes Fetch. Sie liest die bestehende einsatzbereite Automatisierungskennung, ohne Rails-Tokens auszustellen oder Zugangsdaten zu erneuern. Die Prüfung erstellt einen kurzlebigen Projekttoken, widerruft genau diesen Token und beantragt nur die Löschung ihres eigenen markierten Projekts; GitLab löscht asynchron.

Führe sie nach normaler Einrichtung im geprüften Controller aus, mit einem unveränderlichen Job-Image, das du ausgewählt und für dessen Runner verfügbar gemacht hast:

```bash
sudo docker exec -w /system system_bootstrapper_1 node tests/gitlab-runner/live/runner.js \
  --allow-disposable-project \
  --job-image 'alpine@sha256:REPLACE_WITH_64_HEX_DIGEST' --timeout 720
```

Dieser ausdrücklich aktivierte Vorgang darf Production nicht ansprechen. Ein privater Nachweis ausschließlich mit Metadaten im Controller-Zustand hält das genaue zugeordnete Projekt und den Bereinigungsstatus fest. Prüfe nach einer Unterbrechung den gemeldeten Nachweis und verwende denselben Einstieg mit `--allow-disposable-project --cleanup-record /state/live-runner-audit-OPERATION.json`. Die Bereinigung löscht kein Projekt, dessen Identität oder Eigentumsmarkierung geändert wurde. Der bestehende verwerfbare Kandidat prüft ebenfalls echte Runner-/Registry-Jobs; diese optionale manuelle Prüfung fügt keine Pipeline-Stufe hinzu.

Wenn die Runner-Einrichtung fehlschlägt, wird der Plattformstart fortgesetzt, damit
du die Konfiguration im Wizard korrigieren kannst. Prüfe die Bootstrapper-Ausgabe,
korrigiere die Einstellungen und versuche **Registrieren** erneut.
