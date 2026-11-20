# Native geführte Vorschau-Abnahme nach dem Deployment

Der gemeinsame Adapter `guided-preview.js` prüft die erstmalige geführte Einrichtung
über die native Wizard-Einrichtung, die Source-Primary-Übernahme, GitLab-Pipelines
und Umgebungshelfer. Die vollständige isolierte Plattform-Prüfschranke führt ihn
auf ihrem eigenen Kandidaten mit aktiviertem Review und Beta aus. Die Veröffentlichung
eines Nachfolgers erfordert seine abgeschlossenen Phasen und native Nachweise für
Pipeline, Merge, Umgebungen und unveränderte Production.

Der optionale Einstieg `guided-preview-live.js` kann diesen Adapter auch auf einem
ausdrücklich ausgewählten, lokal laufenden Controller ausführen. Seine private
Eingabe bezeichnet eine Betreiberinstanz; er hat keinen Standardhost, installiert
keinen Controller und führt keine Production-Promotion durch. Diese optionale
Betreiberprüfung ist für gewöhnliche Releases nicht erforderlich und kann die
vorgeschriebene isolierte Plattform-Prüfschranke nicht ersetzen. Offline-Transportverträge
belegen das Adapterverhalten, aber keinen echten Durchlauf. Ein erfolgreicher
reiner Prüfbericht ist ein Plan und keine bestandene Funktionsabnahme.

## Voraussetzungen

Verwenden Sie eine frische anfängliche verwaltete Wizard-Registrierung mit ihrem
exakten aufbewahrten Controller-/Wizard-Image-Paar. Bewahren Sie den öffentlichen
Release-Installationsbeleg oder den nativen Quellinstallations-Herkunftsnachweis
für die ausgewählte Installation auf. Ein Quellherkunftsnachweis belegt die
Image-/Quellidentität, keine bestandene Abnahme oder öffentlichen Release-Status.
Allgemeine Konfiguration, verwaltete Wizard-Registrierung, HTTPS für GitLab,
Registry-Zugriff, Runner-Registrierung sowie vertrauenswürdige DNS-Einträge und
Zertifikate für die exakten Hosts müssen bereits funktionieren. Der akzeptierte
unveränderliche System-Umgebungshelfer muss über das native Verfahren bereitgestellt
worden sein. Der ausgewählte Runner muss die normalen nativen Wizard-Jobs zulassen,
einschließlich der Tags `docker` und `wizard-source-primary`. Paket-, Browser- und
Image-Abhängigkeiten müssen für diese Jobs verfügbar sein.

Wählen Sie einen Namespace und einen neuen privaten Quellprojektnamen, der noch
nicht existiert. Die öffentliche HTTPS-Wizard-Quelle oder ihr Fork muss dieselben
freigegebenen nativen CI-Erzeugerbytes wie der akzeptierte Controller-Snapshot
enthalten. Die Quellübertragung prüft öffentliches DNS und bindet Git an die geprüfte
Auflösung. Ein privater Quellendpunkt, erfundener Beleg oder veränderter CI-Erzeuger
ist keine Abkürzung zur Abnahme. Der Review-Host muss frei sein, das angegebene
Zertifikat und den Schlüssel besitzen und auf diese Installation auflösen. Beta
kann deaktiviert bleiben. Führen Sie eine unabhängige System-Quelleinrichtung
separat durch; dieser Lebenszyklus erfordert keine weitere System-Migrationspipeline.

Das Werkzeug läuft mit Node 24 auf dem Linux-Host des Betreibers und benötigt
Docker-Zugriff auf den lokalen Unix-Socket. Vor dem Lesen der nativen
Authentifizierung prüft es die vom Betreiber angegebene exakte Controller-Image-ID.
Entnehmen Sie diese ID unabhängig geprüften Deployment-/Image-Belegen. Ersetzen
Sie sie nicht durch ein beliebiges aktuelles Image, nur damit die Prüfung besteht.

## Private Eingabe und Befehle

Bewahren Sie Eingabe und Bericht außerhalb des Checkouts auf. Erstellen Sie ein
privates Betreiberverzeichnis und eine JSON-Eingabe mit Modus 0600 in dieser Form.
Ersetzen Sie sämtliche Beispielwerte:

```json
{
  "version": 1,
  "syncUrl": "https://sync.example.com",
  "gitlabUrl": "https://gitlab.example.com",
  "controllerImageId": "sha256:<64 verified hexadecimal characters>",
  "settings": {
    "version": 1,
    "namespace": "operator-team",
    "wizard": {
      "mode": "import",
      "project": "wizard-preview-source",
      "origin": "https://github.com/REPLACE_OWNER/REPLACE_REPOSITORY.git"
    },
    "review": {
      "enabled": true,
      "host": "review.example.com",
      "ssl": "/ssl/live/review.example.com/fullchain.pem",
      "sslKey": "/ssl/live/review.example.com/privkey.pem"
    },
    "beta": {"enabled": false, "host": "", "ssl": "", "sslKey": ""}
  },
  "reportPath": "/root/private-preview-acceptance/report.json",
  "timeBudgetMilliseconds": 3600000
}
```

Prüfen Sie zuerst den nativen Voraussetzungenplan:

```sh
node tests/e2e/guided-preview-live.js --check-only /root/private-preview-acceptance/input.json
```

Der reine Prüfmodus validiert das aufbewahrte Installationspaar, die
Production-Identität und die native DNS-/Zertifikats-/Quellen-/Runner-Vorprüfung.
Er importiert kein Repository, startet keine Quellpipeline, übernimmt keine
Bindung und stellt Review nicht bereit. Die native Authentifizierung kann während
der Vorprüfung ihre üblichen kurzlebigen API-Zugangsdaten erstellen und widerrufen.

Starten Sie die echte Abnahme bewusst, nachdem Sie ausgewählte Instanz, Quelle,
Namespace und Review-Host geprüft haben:

```sh
node tests/e2e/guided-preview-live.js --apply /root/private-preview-acceptance/input.json
```

Die Zugangsdaten gelangen aus der gespeicherten Konfiguration des ausgewählten
Controllers in den Prozessspeicher. Das GitLab-Administrator-API-Token erhält
einen eindeutigen Abnahmenamen, wird ausschließlich über die Anfrageeingabe
übergeben und nach Abschluss oder Fehler widerrufen. Weder Token noch Passwort
oder privater Schlüssel sind in Befehlsargumenten oder der Eingabedatei erforderlich.
Rohe Unterprozessfehler, Job-Traces und HTTP-Antwortinhalte werden aus Berichten
ausgeschlossen. Der Bericht ist privat, weil er betreiberspezifische Projekt- und
Job-IDs erfasst.

## Prüfzusicherungen und aufbewahrte Ergebnisse

Die Anwendung verlangt eine anfängliche verwaltete Registrierung und noch nicht
vorhandene Zielprojekte. Der echte native Import erstellt frische Projekt-IDs auf
der eigenen Instanz und eine normale Push-Pipeline des Standardbranches. Das
Werkzeug wartet auf die erfolgreichen erforderlichen Jobs `build:source`,
`test:browser`, `build:wizard` und `test:wizard` auf echten Runnern. Es liest ihre
echten Artefakte und verwendet den nativen Nachweisvertrag, um Quellcommit,
Pipeline-/Image-Identität, freigegebene Erzeugerprüfsummen und Projekt-Merge-Schranken
zu prüfen, bevor die Übernahme akzeptiert wird.

Der Adapter setzt die Einrichtung über dieselbe authentifizierte API fort. Er
erstellt einen eigenen Branch und MR, wartet auf die normalen erforderlichen
nativen Prüfungen dieses MRs und startet dann die tatsächlichen manuellen
Review-Deploy- und Stop-Jobs. Er prüft die geroutete HTTPS-Seite, den laufenden
Kandidatencontainer und die exakten Eigentums-/Generationslabels. Stop muss diesen
Container entfernen und die passende gestoppte Generation sowie ihre Untergrenze erhalten.

Derselbe MR wird anschließend über die gewöhnlichen Pipeline- und Diskussionsschranken
des Projekts zusammengeführt, festgelegt auf seinen geprüften Quell-SHA. Es werden
keine Schranken umgangen, keine CI übersprungen und keine zusätzlichen Pipelines
ausgelöst. Der daraus folgende Push auf den Standardbranch muss die vier erforderlichen
nativen Jobs und passende unveränderliche Build-/Browser-Artefakte bestehen. Wenn
Beta aktiviert ist, startet der Adapter die manuellen Beta-Deploy- und Stop-Jobs
dieser Pipeline und prüft ihre HTTPS-Seite, ihren Container und die passende
gestoppte Generation. Die vollständige isolierte Prüfschranke aktiviert Beta;
die optionale Betreibereingabe darf es deaktiviert lassen. Erforderlich sind genau
die Build-Kontexte des importierten Standardbranches, des MRs und des Standardbranches
nach dem Merge; eine zusätzliche System-Migration oder Production-Promotion gehört nicht dazu.

Die exakten Hauptkonfigurationsbytes und die laufende unveränderliche
Production-Image-ID müssen durchgehend unverändert bleiben. Die
Source-Primary-Bindung und die gewünschten Vorschau-Einstellungen der Einrichtung
bleiben bewusst konfiguriert. Quellprojekte, der zusammengeführte MR und
Pipeline-Nachweise bleiben zur Prüfung verfügbar; der normale Merge fordert die
Löschung des Quellbranches an. Kanonische Quelle und akzeptierte Historie bleiben
erhalten. Die Review-/Beta-Stop-Bereinigung wird unabhängig versucht, wenn eine
Bereitstellungs- oder Seitenprüfung scheitert oder eine Deploy-Antwort verloren
geht. Die abschließende Prüfung auf unveränderte Production und der Widerruf
temporärer Token laufen auch dann, wenn die Vorschau-Bereinigung scheitert.

Ein bestandener Anwendungsbericht enthält `acceptancePassed: true`. Lesen Sie seine
einzelnen Phasenergebnisse und echten Projekt-/Pipeline-/Job-IDs, bevor Sie die
Abnahme festhalten. Ein unterbrochener oder fehlgeschlagener Lauf bleibt
unvollständig, auch wenn einige native Jobs bestanden wurden. Prüfen Sie vor einer
Reparatur den gespeicherten geführten Einrichtungsstatus, die Quellprojekte und die
exakte Review-Generation. Bereinigte Nachweise der vollständigen Prüfschranke
bewahren die nativen Identitäten von Quelle, MR, Merge, manuellen Jobs und
gestoppten Generationen über Wiederherstellung und Berichtsbereinigung hinweg;
Zugangsdaten, Plattform-URLs und rohe Antworten werden ausgeschlossen. Fehlende
oder fehlgeschlagene Lebenszyklusphasen können keine Nachfolgerveröffentlichung
freigeben. Die kalte Wiederherstellung erstellt einen zweiten eigenen Kandidaten:
Geführte Phasen gehören zum ursprünglichen Host, Migrations-/Speicherphasen zum
wiederhergestellten Host. Die Veröffentlichung hält beide Nachweise in einem
Artefakt fest und bettet den ursprünglichen geführten Beleg unter
`guidedPreviewReceipt` ein. Sie prüft die Zusammengehörigkeit ihrer Testläufe, Quellrevision,
CI-Projekt/-Pipeline/-Job, vorbereitetes Image-Paar und den wiederhergestellten
kanonischen Bindungsnachweis; sie kennzeichnet ursprüngliche geführte Phasen nicht
als Arbeit auf dem wiederhergestellten Host um. Falls ein Stop-Job fehlgeschlagen
ist, verwenden Sie das bestehende native Stop-/Abgleichverfahren für diese eigene
Generation. Entfernen Sie niemals eine aktive Umgebungssperre und wiederholen Sie
die Einrichtung nicht mit einem anderen Quellnamen, um einen Eigentumskonflikt zu umgehen.

Falls die Erstellung temporärer Token ihre Abschlussantwort verliert, versucht
das Werkzeug die Bereinigung des exakt reservierten Namens
`guided-preview-acceptance-<operation>` und meldet die Bereinigung als ungewiss,
selbst wenn kein aktives Token beobachtet wird. Die ursprüngliche native Anfrage
kann später noch abgeschlossen werden. Prüfen und widerrufen Sie auf einer
Betreiberinstanz dieses exakt der Operation zugeordnete Token über die nativen
GitLab-Steuerungen, bevor Sie die Bereinigung als abgeschlossen ansehen. Die
isolierte Prüfschranke entfernt ihre eigene Datenbank beim Abbau.
