# Den gebündelten Wizard vor der System-Freigabe prüfen

Wenn eine System-Änderung einen neuen Wizard-Gitlink festlegt, kann die System-Pipeline
genau diesen Wizard auf dem vorhandenen verwalteten Review-HTTPS-Host bereitstellen.
Dies dient der Oberflächenabnahme vor der Production-Freigabe. Es migriert weder
Production noch beweist eine funktionierende Seite die Sicherheit der gesamten Plattform.

Die optionalen Jobs `deploy:wizard-review` und `stop:wizard-review` verwenden die beiden
unveränderlichen Images, die `test:platform-candidate` bereits gebaut und veröffentlicht hat.
Eine zweite Wizard-Pipeline oder ein zusätzlicher Build ist nicht nötig. Alle erforderlichen
System-Prüfungen bleiben erforderlich. Der Review-Job läuft aus dem vorgeschlagenen System-Checkout;
der Production-Controller muss nicht zuerst aktualisiert werden.

## Voraussetzungen

Verwenden Sie einen vertrauenswürdigen MR desselben Projekts gegen den geschützten Standardbranch;
die üblichen Merge-Bedingungen für erfolgreiche Pipelines und abgeschlossene Diskussionen bleiben aktiv.
Die vollständigen Kandidaten-, Browser- und Komponentenprüfungen müssen vor der verwalteten Bereitstellung bestehen.
Provisionieren Sie die vorhandene [Wizard-Review-Umgebung](../project-bootstrap/wizard-environments/README.md)
einschließlich ihres exakten Hosts, DNS, Zertifikats, ihrer Vorlagen und SSL-Volumes.
Beenden und bereinigen Sie eine vorhandene Review-Belegung, bevor Sie den gemeinsamen Host neu zuweisen.
Beta und die kanonische native Wizard-Auslieferungsreservierung bleiben unverändert.

Setzen Sie diese nicht geheimen Projektvariablen als rohe, ungeschützte Werte mit dem
Umgebungsbereich `*`, damit MR-Jobs desselben Projekts sie lesen können:

| Variable | Wert |
| --- | --- |
| `SYSTEM_REVIEW_ENABLED` | `true` |
| `SYSTEM_REVIEW_OPERATION` | Die 48 Hexadezimalzeichen der vorhandenen serververwalteten Umgebungsreservierung |
| `WIZARD_REVIEW_HOST` | Ihr exakter aktivierter Review-HTTPS-Host |

Fork-Pipelines, gewöhnliche Branch-Pushes und reine Dokumentationsänderungen erzeugen diese Jobs nicht.
Die Variablen wählen Jobs und zeigen deren URL; sie erlauben keine beliebigen Projekte oder Images.

## Einen Kandidaten ausdrücklich binden

Lesen Sie nach erfolgreichem Kandidatenjob dessen `test-results/successor/release.json`.
Erstellen Sie auf dem Administrationshost eine private Eingabedatei. Ersetzen Sie jedes
Beispiel durch Werte des tatsächlichen Projekts, MRs und Release-Artefakts:

```json
{
  "operation": "REPLACE_WITH_EXISTING_48_HEX_RESERVATION",
  "projectId": 42,
  "projectPath": "example/system",
  "namespaceId": 7,
  "defaultBranch": "master",
  "mrIid": 12,
  "pipelineId": 100,
  "sourceCommit": "REPLACE_WITH_40_HEX_SYSTEM_REVISION",
  "candidateJobId": 300,
  "helperImage": "sha256:REPLACE_WITH_64_HEX_RELEASE_IMAGE_ID",
  "wizardImageId": "sha256:REPLACE_WITH_64_HEX_WIZARD_IMAGE_ID",
  "wizardImageRef": "registry.example.test/example/system/successor-wizard@sha256:REPLACE_WITH_64_HEX_DIGEST",
  "wizardRevision": "REPLACE_WITH_40_HEX_WIZARD_GITLINK"
}
```

Verwenden Sie `helperImage = release.imageId` und die passenden Wizard-Felder. Laden Sie die
Controller-Registry-Referenz des Releases mit gesondert verwaltetem Betreiberzugang und
prüfen Sie anschließend deren lokale Image-ID. Bewahren Sie das Image auf, solange die Umgebung
besteht, auch für das Beenden nach Ablauf der Artefakte. Zugangsdaten bleiben außerhalb
des Checkouts und werden nicht an das Hilfswerkzeug übergeben.

Speichern Sie die Eingabe mit Modus `0600` unter einem absoluten, vom Betreiber gewählten Pfad:

```sh
docker run --rm --network none --read-only --memory 256m --cpus 1 --pids-limit 128 \
  --tmpfs /tmp:rw,nosuid,noexec,size=16m \
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock \
  --mount type=bind,source=/PRIVATE/ABSOLUTE/candidate.json,target=/input.json,readonly \
  --entrypoint node sha256:EXACT_RELEASE_IMAGE_ID \
  /system/project-bootstrap/system-review/bind.js plan /input.json
```

Prüfen Sie den zurückgegebenen Plan mit Projekt/MR/Pipeline/Quellcode, beiden Images und
vorhandener Reservierung. Wiederholen Sie den Befehl mit `apply /input.json PLAN_HASH`,
um die genaue Auswahl im Konfigurationsverzeichnis des kanonischen Controllers zu speichern.
Das Werkzeug verwendet den bestehenden Umgebungs-Mutex und weist geänderte Pläne,
belegte Umgebungen oder konkurrierende Konfiguration zurück. Frühere Bindungsnachweise bleiben
privat erhalten. Routen, quellcodeführendes CI-Manifest, Production-Image-Auswahl und
Dienstdaten werden nicht geändert.

## Bereitstellen, prüfen und beenden

Starten Sie den manuellen Job `deploy:wizard-review` in derselben MR-Pipeline und öffnen
Sie seine GitLab-Umgebungs-URL. Das Hilfswerkzeug prüft über das kanonische GitLab unabhängig
den tatsächlich laufenden Job, aktuellen MR-Stand und die neueste MR-Pipeline, erforderliche
erfolgreiche Jobs, eingefrorene Kandidatennachweise, System-Gitlink und genaue lokale
Quellcode-/Job-/Image-Labels. Jobbezogene Registry-Zugangsdaten laden nur die beiden Images
vorab; sie gelangen nie in Hilfswerkzeug, Konfigurationsnachweis oder Kandidatencontainer.

Der vorhandene verwaltete Umgebungslebenszyklus übernimmt Zustands-, DNS- und Zertifikatsprüfungen,
ein internes Netzwerk, die gemeinsame Review-Belegung, Routenwechsel, Rollback,
Generationsuntergrenzen, Eigentümerschaft und Sperrmarkierungen beendeter Hosts.
Der Kandidat hat keine Konfigurations- oder Dienstdaten-Einbindung. Production läuft durchgehend weiter.

Beenden Sie die Umgebung mit `stop:wizard-review` aus derselben ursprünglichen Pipeline.
Der Stop prüft seinen laufenden Job und die genaue aufbewahrte Bindung, benötigt jedoch
weder aktuellen MR-Stand noch abrufbare Kandidatenartefakte oder Registry-Zugriff. Daher
kann auch ein geschlossener oder zusammengeführter MR bereinigt werden. Bewahren Sie das
Hilfs-Image bis zum Beenden und zur eigentumsgeprüften Bereinigung auf. Andere Projekte,
MRs oder Pipelines können die ausgewählte Belegung weder ersetzen noch beenden. Entfernen
Sie vor der verwalteten Bereitstellung auf demselben Host eine separat provisionierte
vorübergehende Vorschauroute und ihre exakt zugeordneten Ressourcen.

Schließen Sie nach der persönlichen Oberflächenabnahme alle erforderlichen System-Prüfungen
und Reviews ab, mergen Sie regulär, prüfen Sie die zusammengeführte Pipeline und verwenden
Sie das vorhandene bewusste Production-Freigabeverfahren. Ein Review-Deployment erteilt keine Production-Freigabe.
