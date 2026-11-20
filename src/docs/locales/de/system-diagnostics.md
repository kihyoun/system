# Systemdiagnose

Öffne **Systemdiagnose** im verbundenen Wizard. Das Öffnen liest konfigurierte
Ziele und Namen verfügbarer verwalteter Runner ein; es führt weder eine
Netzwerkprüfung noch einen Image-Download aus. Die Aktionen benötigen eine
angemeldete Sync-Verbindung und starten keine CI. Bestehende Wartungssperren
können eine Aktion vorübergehend blockieren. Die Prüfungen erzeugen keine
Pipelines, ändern keine Konfiguration, starten keine Dienste neu und bereinigen
oder löschen weder Caches noch Images.

## Registry-Verbindung prüfen

Wähle die konfigurierte GitLab-Registry oder die Registry des Helper-Images und
drücke **Verbindung prüfen**. Ziele stammen aus der gespeicherten
Serverkonfiguration, niemals aus einer beliebigen Browser-URL. Schema und
expliziter Port bleiben erhalten. Bei einer HTTP-GitLab-Registry ohne expliziten
Port verwendet der erzeugte GitLab-Listener Port 5050. Bei derselben Registry
verwendet die Helper-Prüfung das konfigurierte GitLab-Schema, ansonsten HTTPS.
Eigene Einstellungen des Daemons für unsichere Registries werden nicht abgeleitet.

Das Ergebnis benennt das **Netzwerk des Sync-Controller-Prozesses**. DNS verwendet
die Namensauflösung und Hosts-Datei des Servers. Weitere Schritte prüfen die erste
aufgelöste Adresse und verwenden den ursprünglichen Hostnamen für HTTP und TLS.
Andere Adressen werden nicht geprüft. Diese Beobachtungen belegen keine
Erreichbarkeit aus dem Browser, einem Runner-Container, einem CI-Job oder dem
Docker-Daemon. Private konfigurierte Registry-Adressen werden unterstützt; ein
pauschaler Ausschluss privater Adressen würde normale lokale Installationen
verhindern.

| Prüfung | Was ein erfolgreiches Ergebnis belegt | Grenze |
| --- | --- | --- |
| DNS | Die Namensauflösung des Controllers lieferte eine Adresse. | Andere Netzwerke können anders auflösen. |
| TCP | Eine Verbindung erreichte diese Adresse und den konfigurierten Port. | Ein Timeout belegt weder eine Sperre noch ein fehlendes Image. |
| TLS | Zertifikatskette und Hostname bestehen die Vertrauensprüfung des Controllers. | Docker kann einen anderen Zertifikatsspeicher verwenden. HTTP-Ziele überspringen TLS. |
| Registry-HTTP | Der Endpunkt lieferte die erwartete Registry-Antwort unter `/v2/`. | Zugangsdaten, Berechtigungen und Image-Verfügbarkeit bleiben ungeprüft. |

Nach einem fehlgeschlagenen Schritt erscheinen abhängige Schritte als **nicht
geprüft**, mit Dauer null. Die Zeitangaben beschreiben die beobachteten Schritte.
Eine erwartete HTTP-401-Authentifizierungsanforderung gilt als erfolgreiche
Erreichbarkeitsprüfung; sie meldet den Runner nicht an. Eine 200-Antwort muss
zusätzlich die Registry-API kennzeichnen. Andere HTTP-Statuscodes einschließlich
Weiterleitungen und 401 ohne erkannte Authentifizierungsanforderung erscheinen
als eigene Antwortbefunde. Weiterleitungen werden niemals verfolgt. Antworttexte,
Authentifizierungsanforderungen, Tokens, Zertifikatsschlüssel und rohe
Serverfehler werden nicht zurückgegeben.

## Genau das Helper-Image testweise herunterladen

**Helper-Image testweise herunterladen** ist eine separate Aktion. Wähle zuerst
einen laufenden verwalteten Runner-Manager. Vor dem Start zeigt der Dialog die
genaue unveränderliche Helper-Image-Referenz. Ihr Standard stammt aus
`gitlab/security-release.json`; Betreiber können
`GITLAB_RUNNER_HELPER_IMAGE` in der Serverkonfiguration setzen. Das Image muss
einen expliziten SHA-256-Digest behalten. Ein Client kann kein anderes Image und
keinen Docker-Endpunkt übergeben.

Sync prüft den gewählten Manager und seine Registrierung. Unterstützte verwaltete
Runner-Pools binden den Host-Socket `/var/run/docker.sock` ein; Sync prüft diese
Einbindung und die Docker-Host-Einstellung des Runners, bevor genau dieser
Host-Daemon den Download erhält. Außerdem sind genau eine Docker-Registrierung
und eine zur Konfiguration passende Helper-Image-Referenz erforderlich. Ein
angehaltener Manager, eine geänderte Helper-Referenz, ein entfernter Docker-Endpunkt,
eine mehrdeutige Konfiguration oder nicht unterstützte Umgebungsvariablen für
Docker-Zugangsdaten und Hosts führen zum Abbruch. Der Betreiber muss diese
Konfiguration prüfen; die Funktion ersetzt einen anderen Runner-Daemon nicht
stillschweigend durch den Controller-Daemon.

Der Helper-Download erfolgt anonym und prüft keine runnerspezifischen
Zugangsdaten. Abweichende Zugangsdaten müssen Betreiber gesondert prüfen. Erfolg
bestätigt, dass dieser Daemon genau diesen Helper-Download abgeschlossen hat;
CI-Start, Job-Netzwerk, Anmeldung an einer anderen Registry und Verfügbarkeit
eines anderen Images bleiben ungeprüft. Eine erfolgreiche HTTP-Prüfung vom
Controller und ein fehlgeschlagener Daemon-Download können beide zutreffen.
Downloadfehler sind feste sichere Kennungen statt roher Daemon-Ausgaben; allein
belegen sie weder eine IP-Sperre noch einen Zugangsdatenfehler oder fehlenden Digest.

**Der Download kann Schichten herunterladen und Speicherplatz im Cache des
gewählten Daemons belegen.** Vorhandene Schichten können wiederverwendet werden.
Es wird nichts bereinigt oder gelöscht. Bei Timeout oder überschrittenem
Ausgabelimit kann der Daemon weiterarbeiten und teilweise geladene Schichten
behalten. Prüfe vor einem weiteren Versuch den Daemon-Zustand.

## Grenzen und reproduzierbare Prüfung

Sync erlaubt höchstens zwei gleichzeitige Diagnoseanfragen einschließlich
Zielprüfung und jeweils einen Download. Jeder DNS-, TCP-, TLS- und HTTP-Schritt
hat ein Zeitlimit von drei Sekunden. Docker-Metadaten werden höchstens drei
Sekunden und bis zu 256 KiB Ausgabe gelesen. Die Downloadbeobachtung endet nach
45 Sekunden oder 1 MiB Ausgabe; ein einzelner Stream-Datensatz ist auf 64 KiB
begrenzt. HTTP-Antwortheader sind auf 16 KiB begrenzt, Antworttexte werden
verworfen. Höchstens 100 verfügbare Managernamen werden zurückgegeben. Sync
speichert keine Diagnoseergebnisse dauerhaft oder auf Datenträgern. Antworten
verwenden `Cache-Control: no-store`, und der Wizard hält nur die aktuellen
Ergebnisse bis zum Schließen des Dialogs. Die Anfragegrenze begrenzt
Beobachtungen, nicht einen nach einer Client-Trennung weiterlaufenden Daemon-Vorgang.

Führe aus einem Checkout mit dokumentierter Node-Laufzeit und installierten
Sync-Abhängigkeiten die kontrollierten Tests aus:

```sh
npm --prefix sync run build
node --test tests/sync/system-diagnostics.js
```

Die Tests prüfen Anmeldung, erlaubte Ziele, geordnete Fehler, übersprungene
Schritte, Registry-Authentifizierungsanforderungen, HTTP-Weiterleitungen,
Socket- und Image-Identität des Runners, Konfigurationsabweichungen, Geheimnisschutz,
Parallelitätsgrenzen, Ausgabelimits und Timeouts. Ein Fall kombiniert erfolgreiche
HTTP-Erreichbarkeit mit einem fehlgeschlagenen Daemon-Download. Die Testumgebung
verwendet lokale Listener und einen isolierten simulierten Docker-Socket; echte
Image-Downloads oder eine laufende Plattform sind nicht erforderlich.
