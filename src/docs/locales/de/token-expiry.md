# Ablauf von Zugangsdaten

Öffne **Ablauf von Zugangsdaten** im verbundenen Wizard, um Metadaten für die vom
Betreiber ausgewählten Automatisierungsprojekte zu prüfen. Die Übersicht liest
nur: Sie erneuert keine Zugangsdaten, erstellt keinen Administrator-Token, ändert
keine CI-Variable und testet kein Geheimnis gegen einen externen Dienst. Geheime
Werte und private Token-Abfragen bleiben in GitLab Rails; der Browser erhält nur
gefilterte Angaben zu Zweck, Anbieter, Projekt, Ablauf und Status.

## Projekte auswählen und Überwachung speichern

Trage jeden genauen Namespace/Projekt-Pfad in einer eigenen Zeile ein. Nur diese
Projekte werden geprüft; es gibt weder einen installationsabhängigen Projektnamen
noch einen umfassenden Projektscan. Erlaubt sind höchstens acht unterschiedliche
Pfade. Der Warnzeitraum muss eine ganze Zahl zwischen 1 und 90 Tagen sein;
Standard sind 14 Tage.

**Überwachungseinstellungen im Formular speichern** ändert nur das lokale
Formular. Verwende anschließend regulär **Backup** und **Übertragen**, verbinde
dich erneut und aktualisiere die Übersicht, um die Einstellungen zu sichern und
anzuwenden. Öffnen des Dialogs, Ändern eines Datums und **Metadaten aktualisieren**
übertragen keine Konfiguration automatisch. Der Server liest die gespeicherte
Konfiguration und kann ein Ergebnis bis zu fünf Minuten zwischenspeichern.

Die Laufzeitoptionen heißen `SYSTEM_CREDENTIAL_PROJECT_PATHS`, ein JSON-Array
genauer Pfade, und `SYSTEM_CREDENTIAL_WARNING_DAYS`, der Warnzeitraum. Der
Projektpfadwert könnte beispielsweise so aussehen:

```json
["example/system", "example/wizard"]
```

Die optionale Einstellung `SYSTEM_CREDENTIAL_EXPIRY_METADATA` hält externe
Ablaufdaten fest. Ihre JSON-Array-Einträge enthalten nur `projectPath`, `key` und
`expiresAt`. Jeder Eintrag muss ein ausgewähltes Projekt, einen unterstützten
externen Schlüssel und ein echtes Kalenderdatum nennen. Die Datumsfelder erzeugen
diesen Wert; pro Projekt und Schlüssel ist höchstens ein Eintrag erlaubt. Ein
Wert könnte so aussehen:

```json
[{"projectPath":"example/system","key":"DOCKERHUB_TOKEN","expiresAt":"2027-01-01"}]
```

## Was die Übersicht belegt

Der Server liest nur vier feste CI-Variablenschlüssel in den ausgewählten
Projekten: `RENOVATE_TOKEN`, `SYSTEM_RELEASE_GITLAB_TOKEN`, `GITHUB_RELEASE_TOKEN`
und `DOCKERHUB_TOKEN`. Ihre Werte werden nicht ausgegeben. Bei den ersten beiden
Schlüsseln ermittelt GitLab Rails vorhandene lokale Metadaten persönlicher
GitLab-Zugriffstokens, ohne einen neuen Administrator-Token zu erstellen oder
aufzubewahren. Vorhandene GitLab-Metadaten können Ablaufdatum und Widerruf melden.

Bei GitHub und Docker Hub bleibt der Ablauf **unbekannt**, solange der Betreiber
kein Datum einträgt. Ein solches Datum ist als **vom Betreiber erfasst** markiert;
es ist eine Angabe zum vorgesehenen externen Zugang, keine bestätigte
Anbieterantwort. Ein fehlender oder nicht erkannter Token, ein nicht verfügbares
Ablaufdatum oder unzugängliche Metadaten bleiben ebenfalls **unbekannt**.
Unbekannt bedeutet niemals gültig oder unbegrenzt haltbar.

| Status | Bedeutung |
| --- | --- |
| Ablauf gültig | Das beobachtete oder erfasste Datum liegt außerhalb des Warnzeitraums. |
| Läuft bald ab | Das Ablaufdatum liegt im eingestellten Warnzeitraum. |
| Abgelaufen | Das Ablaufdatum ist erreicht. |
| Widerrufen | Lokale GitLab-Tokenmetadaten melden einen Widerruf. |
| Ablauf unbekannt | Es ist kein verwendbares Ablaufdatum verfügbar. |

Ablaufdaten gelten ausschließlich ab **00:00 UTC an diesem Datum**: Ein Zugang
mit heutigem Ablaufdatum ist bereits abgelaufen. Ein zukünftiges Datum belegt
weder Existenz noch erfolgreiche Anmeldung, erforderliche Berechtigungen oder
Zugriff auf das vorgesehene Projekt. Erfasste externe Daten können nach einer
unabhängigen Erneuerung veralten; aktualisiere oder entferne sie bewusst.

## Zugangsdaten mit den zuständigen Werkzeugen erneuern

Verwende den Erneuerungslink zum betroffenen Zweck und folge dem zugehörigen
repositoryeigenen Verfahren. Für Renovate unterstützt der vorhandene Ablauf
`gitlab/renovate/setup.py` die Optionen `--apply --rotate --enable` mit der privaten
Konfiguration des Betreibers.
Erstelle für den Zugriff auf Release-Metadaten einen projektgebundenen
GitLab-Ersatztoken mit der Reporter-Rolle, dem Geltungsbereich `read_api` und einem
ausdrücklichen Ablaufdatum. Ersetze dann die geschützte maskierte Variable
`SYSTEM_RELEASE_GITLAB_TOKEN` im zuständigen System-Projekt. Dateibasierte
Zugangsdaten haben Vorrang: Ist eine entsprechende private Tokendatei eingerichtet,
ersetze diese Datei über den Geheimnisspeicher des Betreibers. Befolge die
dokumentierte [Konfiguration der Release-Zugangsdaten](RELEASES.md#trusted-publication-and-retry-behavior)
für GitHub-Contents-Zugriff und die ausgewählten Quellen der Zugangsdaten.

Erstelle für GitHub- oder Docker-Hub-Veröffentlichungen den Ersatz beim Anbieter,
beschränke den Zugriff auf die vorgesehenen Release- beziehungsweise
Image-Repositories und aktualisiere die passende geschützte CI-Zugangseinstellung
im zuständigen Projekt. Behalte Maskierung und Beschränkung auf geschützte
Referenzen bei; verwende eine eingerichtete private Datei, wenn diese Vorrang hat.
Aktualisiere oder entferne gleichzeitig das vom Betreiber erfasste Ablaufdatum.
Bestätige die nächste autorisierte Veröffentlichung mit den neuen Zugangsdaten,
bevor du die bisherigen widerrufst. Die reine Ablaufübersicht kann funktionierende
Veröffentlichungsberechtigungen nicht belegen. Fehlende Daten oder Metadaten
bleiben während dieses Verfahrens unbekannt.

Halte
geheime Werte aus Browserformularen, öffentlichen Konfigurationsexporten,
Repositorydateien, Chats und Logs heraus. Führe keinen dauerhaften
Administrator-Token nur zur Ablaufüberwachung ein.

Das Importieren normaler Konfiguration oder von Überwachungsmetadaten erstellt
oder erneuert keine Zugangsdaten. Bei einer frischen Installation ohne passenden
Seed beschreiben ausgewählte Projektpfade nur gewünschte Überwachungsziele.
Erstelle die tatsächlichen Projekte und richte ihre erforderlichen geschützten
CI-Variablen mit den zuständigen Einrichtungswerkzeugen ein, bevor du laufende
Automatisierung erwartest. Ein Metadatenimport stellt keine Geheimnisse wieder her.
