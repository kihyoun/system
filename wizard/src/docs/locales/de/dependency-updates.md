# Abhängigkeitsaktualisierungen mit ausdrücklicher Freigabe

Renovate OSS läuft als geplanter GitLab-Job `renovate:discover` im vorhandenen
Docker-Runner-Pool. Sein geprüftes stabiles Image `44.222.5-full` ist per Digest
in `.gitlab-ci.yml` festgelegt; aktualisieren Sie es wie andere Abhängigkeiten durch Review.
Ein dauerhafter Botdienst besteht nicht. Die [Repository-Konfiguration](../renovate.json)
und [Selbsthosting-Konfiguration](../gitlab/renovate/config.cjs) wählen ausschließlich die
zwei vom Betreiber angegebenen System- und Wizard-Quellprojekte, niemals GitHub-Spiegel
oder automatische Projektentdeckung.

## Einrichtung durch den Betreiber

Verwenden Sie einen geprüften Checkout, nachdem die Konfiguration in die geschützten
Standardbranches beider Projekte gemergt wurde. Python 3 mit normalem HTTPS-CA-Vertrauen
genügt. Halten Sie ein GitLab-Administrator-API-Token in einer Datei mit Modus 0600
außerhalb des Checkouts. Es wird nur durch den Provisionierungsbefehl des Betreibers
verwendet und gelangt nie in CI. Nutzen Sie eine echte, vom Betreiber kontrollierte
E-Mail-Adresse für das dedizierte Konto.

Erstellen Sie außerhalb des Checkouts eine JSON-Eingabe mit Modus 0600, beispielsweise:

```json
{
  "endpoint": "https://gitlab.example.com/api/v4",
  "admin_token_file": "/secure/operator/gitlab-admin-token",
  "username": "dependency-bot",
  "email": "dependency-bot@example.com",
  "project_ids": [10, 11],
  "state_file": "/secure/operator/renovate-state.json",
  "cron": "0 4 * * 1",
  "timezone": "UTC"
}
```

Ersetzen Sie alle Werte: System steht zuerst, Wizard an zweiter Stelle. Die Namespace-
Pfade werden aus diesen IDs ermittelt. Das Werkzeug weist ein unbekanntes Konto,
Administratoridentität, fremde Mitgliedschaften/Tokens oder Developer-Push-Zugriff auf
einen der beiden geschützten Standardbranches zurück. Ein privates Eigentumsjournal
bindet die Benutzer-ID des Bots an Endpunkt, Benutzername, private E-Mail-Adresse und
Projektauswahl. Vor der Kontoerstellung speichert es eine zufällige Nonce, die auch in
der ausschließlich für Administratoren sichtbaren Benutzernotiz hinterlegt wird,
damit eine unterbrochene Erstellung sicher fortgesetzt werden kann. Ein übereinstimmender
öffentlicher Anzeigename allein erlaubt niemals eine Übernahme. Bei vorhandenen Benutzern
werden Identität, Einschränkungen, Mitgliedschaften und Tokens vor jeglichen schreibenden
API-Zugriffen auf diesen Benutzer geprüft. Der Bot erhält ein zufälliges unbekanntes
Passwort ohne E-Mail zum Zurücksetzen; für Vorgänge verwendet er sein PAT. Schützen Sie
beide Standardbranches vor Developer-Pushes. Das dedizierte Konto hat nur Developer-
Mitgliedschaften in diesen zwei Projekten, keine Gruppenmitgliedschaft, Gruppenerstellung oder Erlaubnis für persönliche
Projekte. Es verwendet ein persönliches Zugriffstoken mit `api`, erforderlich für private
Repository-Branches, MRs und Dashboard-Issues. Projektmitgliedschaft begrenzt dessen
Projektzugriff; es ist kein Administratortoken.

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json --apply
```

Der erste Aufruf prüft private Dateibehandlung ohne API-Änderungen. Der zweite gleicht
Konto, Developer-Mitgliedschaften, geschützte CI-Variablen und einen **pausierten**
wöchentlichen Zeitplan ab. `RENOVATE_TOKEN` ist geschützt und maskiert;
`RENOVATE_REPOSITORIES` ist geschützt und enthält nur die zwei expliziten Pfade.
Der Zeitplan nutzt den geschützten System-Standardbranch mit `RENOVATE_ENABLED=true`.
Der provisionierende Betreiber übernimmt den Zeitplan und muss Pipelines auf diesem
Branch ausführen dürfen; ein Developer-Bot erhält keine Merge-/Push-Rechte auf geschützte
Branches. Stellen Sie sicher, dass der konfigurierte Runner den geschützten Branch bedient.

Erfassen Sie vor der Aktivierung die Branch-/MR-Bestände für den ersten Lauf. Dies nutzt
das begrenzte Bot-Token im privaten Zustand und schreibt nichts nach GitLab:

```sh
python3 gitlab/renovate/verify.py --config /secure/operator/renovate.json \
  --baseline /secure/operator/renovate-first-discovery.json
```

Aktivieren Sie den Zeitplan nach Prüfung beider Repository-Konfigurationen:

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json --apply --enable
```

Der Befehl ist wiederholbar. Halten Sie seine Zustandsdatei mit Modus 0600 privat:
Sie enthält das Bot-Token für unterbrechungssicheren Abgleich. Token oder API-Antworttexte
werden nie ausgegeben. Wöchentlicher Cron-Ausdruck und Zeitzone sind in der Eingabe
konfigurierbar. Ohne `--enable` wird der eigene Zeitplan pausiert, ohne Dashboards,
Branches oder Berichte zu löschen. Ein erneuter Aufruf mit `--enable` setzt ihn fort.
Fügen Sie gewöhnlichen Pipelines keinen globalen Selektor `RENOVATE_ENABLED` hinzu.
Nur die geschützte geplante Pipeline wählt den Botjob; gewöhnliche Merge-Requests,
Standardbranch-Pushes und geschützte Versionstags behalten ihre passenden erforderlichen
Prüfungen und Veröffentlichungsjobs.

## Erkennung, Freigabe und Gruppierung

Der erste Lauf erstellt oder aktualisiert in jedem Quellprojekt ein Dependency Dashboard.
`dependencyDashboardApproval=true` wird global erzwungen, auch für Sicherheitsvorschläge
und Lockfilepflege: **Vor Dashboard-Freigabe entsteht kein Update-Branch oder MR**.
Prüfen Sie, dass der erste Lauf nur diese Dashboards und keinen neuen Branch/MR unter
`renovate/` erzeugt. Prüfen Sie nach dem ersten erfolgreichen eigenen Zeitplanlauf
beide Dashboards, unveränderte Branch-/MR-Bestände und dass die geplante Pipeline
nur den erfolgreichen Botjob enthielt:

```sh
python3 gitlab/renovate/verify.py --config /secure/operator/renovate.json \
  --baseline /secure/operator/renovate-first-discovery.json --verify
```

Verwenden Sie ein ruhiges Zeitfenster für die erste Erkennung: Gleichzeitig von Menschen
erstellte Branches/MRs lassen diesen strengen Vergleich ebenfalls fehlschlagen und müssen
untersucht werden. Genehmigen Sie ein bestimmtes angezeigtes Paket über sein Kontrollkästchen
und starten oder erwarten Sie die nächste geplante Erkennung. Das pauschale Kontrollkästchen
„alle erstellen“ kann viele Vorschläge freigeben; wählen Sie für koordinierte Auslieferung einzelne Pakete.

Kompatible npm-Patch-/Minor-/Pin-Änderungen bilden ein npm-Paket je Projekt. Kompatible
Laufzeitimage-/Digest-Änderungen bilden ein Laufzeitpaket. Hauptversionsänderungen bleiben
getrennt. Npm verwaltet Manifeste mit ihren npm-Lockfiles; auch deren Aktualisierung
benötigt Freigabe. Native Dockerfile-, Compose- und GitLab-CI-Manager erfassen Image-
Referenzen; eng begrenzte Regex-Manager erfassen den Pin `ARG IMAGE=node:...@sha256:...`
in `system/Dockerfile`, den Docker-CLI-Standard für die Runner-Registrierung und die
aktuellen BuildKit-Treiber-Pins für Wizard-Build/-Prüfung. Gruppierung erfolgt pro Repository,
nicht als projektübergreifende Transaktion. Maintainer bündeln akzeptierte Wizard-
Änderungen mit dem System-Gitlink und weiteren vereinbarten Änderungen in einem geprüften System-Kandidaten.

Updates bleiben auf stabile Versionen begrenzt; Node und Docker behalten geprüfte Hauptversionslinien.
GitLab-, Runner- und Helper-Image-Updates sind in gewöhnlichen Botregeln bewusst deaktiviert.
Verwenden Sie das gekoppelte [GitLab-Upgrade-Verfahren](HANDBOOK.md#migrate-gitlab-through-the-accepted-controller)
mit erforderlichen Zwischenstopps, Migrationsnachweisen und Rollback-Checkpoint. Historische
Build-Rezepte, aufgezeichnete Sicherheitsrelease-Übergänge, Wiederherstellungsidentitäten
und gespeicherte vom Betreiber ausgewählte Production-Images sind keine Updateziele.
Der Bot darf diese Aufzeichnungen nicht stillschweigend auf ein neues Upstream-Release
umstellen. Seine Vorschläge ändern keine laufende Installation. Automatisches Mergen ist
deaktiviert; Merge und Production-Freigabe bleiben getrennte Entscheidungen von Maintainer
und Betreiber mit bestehenden Prüfungen und Werkzeugen.

## Ablauf, Rotation und Wiederherstellung

Tokens laufen nach 90 Tagen ab. Planen Sie vorher eine Betreibererinnerung; der
Einrichtungsbefehl rotiert bei weniger als 15 verbleibenden Tagen oder ausdrücklich mit:

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json --apply --rotate --enable
```

Er speichert das neue Token privat, aktualisiert die geschützte Variable und widerruft
anschließend veraltete, von diesem Werkzeug verwaltete Tokens. Wiederholen Sie ihn nach
einer Unterbrechung; fremde Tokens werden nicht widerrufen. Bei Fehlern gibt er keine
geheimnishaltigen API-Antworttexte aus. Prüfen Sie den nächsten Lauf des Zeitplans und
bestätigen Sie, dass der nächste Lauf beide Dashboards aktualisiert.

Ein normaler Hostwechsel mit erhaltenen GitLab-Daten oder passendem vollständigem Seed
stellt GitLabs datenbankgestützte Konten, Mitgliedschaften, geschützte Variablen,
Zeitpläne, Dashboard-Issues und MRs wieder her. Stellen Sie passende GitLab-Konfiguration
und zur Entschlüsselung von Datenbankwerten nötige Geheimnisse gemäß dem
[Wiederherstellungsvertrag](RECOVERY_CONTRACT.md) wieder her. Neue Runner-Manager,
Caches und Arbeitsverzeichnisse werden rekonstruiert und nicht als Botzustand gesichert.
Der geprüfte Checkout stellt CI, Konfiguration und Werkzeuge bereit. Pausieren Sie Zeitpläne
während der Wiederherstellung; stellen Sie vor ihrer Aktivierung Runner-Erreichbarkeit und CA-Vertrauen wieder her.

Betreibereingaben und Token-Zustandsdateien liegen außerhalb des Checkouts und sind nicht
in einem reinen Wizard-Konfigurationsexport enthalten. Halten Sie sie in geschütztem
Betreiberspeicher. Wenn nur der Tokenzustand verloren ist, das wiederhergestellte Konto
aber weiterhin besteht, stellen Sie möglichst dessen privates Journal wieder her.
Andernfalls muss ein Administrator die vorgesehene Bot-Benutzer-ID, konfigurierte private
E-Mail-Adresse und Kontoeinschränkungen prüfen und dann ausdrücklich wiederherstellen:

```sh
python3 gitlab/renovate/setup.py --config /secure/operator/renovate.json \
  --apply --recover-user-id 123 --rotate
```

Ersetzen Sie `123` durch die unabhängig geprüfte Benutzer-ID. Der Zeitplan bleibt dabei
pausiert. Abweichende Identität, zusätzliche Mitgliedschaften/Tokens oder uneingeschränkte
Kontoeigenschaften werden vor schreibenden API-Zugriffen zurückgewiesen. Der Vorgang legt
ein neues privates Eigentumsjournal an und rotiert das Token, bevor er veraltete eigene
Tokens widerruft. Erfassen Sie einen neuen Ausgangsbestand für den ersten Lauf und
aktivieren Sie nach Prüfung. Ein Konto wird niemals allein anhand seines Namens übernommen.
Eine frische leere GitLab-Instanz benötigt ihre zwei Quellprojekte, geschützten
Branches, dedizierte Identität, Mitgliedschaften, Token-Variablen und den Zeitplan erneut;
numerische IDs können sich ändern. Ein abgelaufenes/widerrufenes Token bleibt auch nach
Datenbankwiederherstellung unbrauchbar. Verwenden Sie nie ein aktuelles Administratortoken
als Bot-CI-Geheimnis. Bei verlorenem Zeitplanbesitzer muss möglicherweise ein anderer
autorisierter Maintainer den Zeitplan übernehmen, bevor er wieder läuft.

## Verifikation

Führen Sie die üblichen leichten Konfigurations-/Einrichtungstests über die Komponenten-
Testsuite aus. Für die tatsächlich festgelegte Renovate-Engine starten Sie die isolierte Funktions-Testumgebung:

```sh
docker run --rm --network none --entrypoint node \
  -v "$PWD:/work:ro" -w /work \
  ghcr.io/renovatebot/renovate:44.222.5-full@sha256:1e5baa47058a74b5f41e425838862f6728b4351790d8278f1356df2e56e8df62 \
  tests/gitlab/renovate-functional.mjs /usr/local/renovate/dist
```

Sie verwendet erfundene Abhängigkeiten und eine Plattform im Arbeitsspeicher, niemals
echte Zugangsdaten oder Repositorys. Sie prüft Regelzuordnung, Gruppierung, die Sperre
nicht genehmigter Branches und Dashboard-Ausgaben der echten Engine. Validieren Sie
beide Konfigurationen außerdem mit
`renovate-config-validator --strict --no-global renovate.json wizard/renovate.json` aus diesem Image.
Nach dem Merge prüfen Betreiber die erste echte Erkennung getrennt: Nur
`renovate:discover` wird gewählt, beide Dashboards existieren und Branch-/MR-Bestände
bleiben bis zur ausdrücklichen Freigabe unverändert.

Upstream-Referenzen: [GitLab-Plattform](https://docs.renovatebot.com/modules/platform/gitlab/),
[Dashboard-Freigabe](https://docs.renovatebot.com/configuration-options/#dependencydashboardapproval),
[Selbsthosting](https://docs.renovatebot.com/getting-started/running/).
