# Abnahme der gemeinsamen System Beta

Das wegwerfbare Plattformszenario verwendet den bestehenden System-Kandidaten,
seinen nativen `wizard/`-Baum und die exakt vorbereiteten Helper-/Wizard-Images.
Ein privates Git-Bundle erhält den tatsächlichen Commit. Der Import prüft Commit-
und Baumidentitäten vor dem Push mit `ci.skip` in das vorhandene eigene Testprojekt.
Es entstehen weder separates Wizard-Repository noch Quellbuild, Review-Lebenszyklus
oder doppelte vollständige System-CI. Normale Anwendungs-Review-/Beta-Abnahme bleibt
Bestandteil der Plattformsuite.

Nachweisversion 2 deklariert ausdrücklich
`acceptanceScope: native-lifecycle-with-contract-verifier` und
`verifier.mode: contract-fixture`. Native gemeinsame Einrichtung, Bindung, eigene
Docker-Beta-Deployments/Stops, Image-Labels, exaktes Host-TLS, unveränderte Production
und Bereinigung werden auf der wegwerfbaren Plattform geprüft. Positive und negative
Verträge des unveränderten Production-Ruby-Prüfers decken Pipelineautorisierung ab.
Der übergeordnete Kandidat ist noch nicht abgeschlossen und wird niemals als
abgeschlossene native Autorisierungspipeline dargestellt. Fixture-Identitäten haben
einen expliziten Namensraum. Die Veröffentlichung entfernt unbekannte Felder und
verwirft fehlende oder widersprüchliche Fakten. Historische Belege der Version 1
behalten ihren ursprünglichen Validator.

Die ausschließlich für Tests vorgesehene Helper-Unterklasse liegt im Harness.
Production-Launcher bieten weder Umgebungsvariable noch anderen Auswahlweg für
seinen Prüfer. Auch bei Fehlern versucht der Harness den exakten eigenen Beta-Stop,
prüft Entfernung von Container, Netzwerk und Helper sowie freigegebene Leases,
widerruft sein benanntes temporäres Credential und kontrolliert Production.
Unsichere Bereinigung kann keinen erfolgreichen Nachweis erzeugen. Bei der
Wiederherstellung fehlt das Wizard-Archiv im neuen Daemon. Der exakte private
Registry-Pin muss daher mit einem temporären Projekt-Deploy-Token geladen werden
und darf nicht aus dem Cache stammen. Der kanonische Beleg der gestoppten Generation
übersteht die Wiederherstellung; erneutes Deployment verlangt eine ausdrücklich
gültige System-Beta-Bindung.

## Vorprüfung durch Betreiber

`guided-preview-live.js` akzeptiert ausschließlich `--check-only` mit privater JSON-Eingabe:

```json
{
  "version": 2,
  "syncUrl": "https://sync.example.com",
  "gitlabUrl": "https://gitlab.example.com",
  "controllerImageId": "sha256:<64 independently verified hex characters>",
  "settings": {
    "version": 2,
    "namespace": "operator-team",
    "wizard": {"mode": "existing", "project": "system"},
    "review": {"enabled": false},
    "beta": {
      "enabled": true,
      "host": "beta.example.com",
      "ssl": "/ssl/live/beta.example.com/fullchain.pem",
      "sslKey": "/ssl/live/beta.example.com/privkey.pem"
    }
  },
  "reportPath": "/root/private-beta-preflight/report.json",
  "timeBudgetMilliseconds": 3600000
}
```

Bewahre die Eingabe außerhalb des Checkouts mit Modus 0600 auf. Führe auf dem
Linux-Host des Betreibers mit Node 24 und Zugriff auf den lokalen Docker-Socket aus:

```sh
node tests/e2e/guided-preview-live.js --check-only /root/private-beta-preflight/input.json
```

Der Plan prüft erhaltene Installationsidentität und native Voraussetzungen. Er
wendet keine Einrichtung an, bindet keinen Kandidaten und deployt keine Umgebung;
`--apply` wird abgelehnt. Die native Vorprüfung darf ihr übliches temporäres
API-Credential erstellen und widerrufen. Ein erfolgreicher Plan hat
`acceptancePassed: false`. Die wegwerfbare Vertragsfixture wird niemals für eine
Benutzerinstallation ausgewählt. Weder diese Vorprüfung noch Offline-Vertragstests
ersetzen einen abgeschlossenen nativen Lauf der wegwerfbaren Plattform.
