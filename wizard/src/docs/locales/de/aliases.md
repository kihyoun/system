# Kanonische Wizard-Aliase

Eine Installation kann ausdrücklich zusätzliche DNS-Namen reservieren, die dauerhaft
auf ihren konfigurierten Wizard-Ursprung weiterleiten. Mit `WIZARD_HOST=www.example.com`
und `WIZARD_DOMAIN_MODE=2` leitet der Alias `example.com` sowohl
`http://example.com/a?x=1` als auch `https://example.com/a?x=1` auf
`https://www.example.com/a?x=1` weiter. Die Weiterleitungen verwenden HTTP 308 und
behalten den ursprünglichen Pfad und die Abfrageparameter bei. Das Ziel stammt aus
der gespeicherten Konfiguration, niemals aus dem eingehenden Host-Header. Aus einem
`www`-Präfix wird kein Alias abgeleitet.

| Einstellung | Bedeutung |
| --- | --- |
| `WIZARD_ALIASES` | Optionale, durch Leerzeichen getrennte exakte DNS-Namen. Ein leerer oder fehlender Wert deaktiviert Alias-Routen. |
| `WIZARD_ALIAS_SSL` | Optionaler Zertifikatspfad innerhalb von NGINX unter `/ssl`. Standardwert ist `WIZARD_SSL`. |
| `WIZARD_ALIAS_SSL_KEY` | Optionaler Pfad zum privaten Schlüssel unter `/ssl`. Standardwert ist `WIZARD_SSL_KEY`. Beide Überschreibungen müssen zusammen gesetzt werden. |

Der Wizard muss aktiviert sein und einen exakten kanonischen Host mit dem Domainmodus
`0` (HTTP-Ziel) oder `2` (HTTPS-Ziel) haben. Ein Alias bedient sowohl HTTP als auch
HTTPS, selbst wenn das kanonische Ziel HTTP verwendet. Deshalb braucht Alias-TLS
weiterhin ein Zertifikat. Das ausgewählte Zertifikat muss **jeden Alias** abdecken,
und sein Schlüssel muss passen. Konfiguriere DNS sowie Zertifikatsausstellung und
-erneuerung nach der Installationsanleitung für öffentliche Server, bevor du Aliase
aktivierst; diese Einstellung beschafft keine Zertifikate. Bewahre den vollständigen
Certbot-Konto- und Erneuerungsverzeichnisbaum wie im Handbuch beschrieben auf.

Namen müssen aus gültigen DNS-Labels bestehen, ohne Protokollschemata, Ports,
IP-Literale, Platzhalter oder abschließende Punkte. Beim Vergleich wird Groß- und
Kleinschreibung ignoriert. Doppelte Aliase und eine Schleife zum kanonischen Host
werden abgelehnt. Zugewiesene GitLab-, Registry- und Sync-Namen sind reserviert,
einschließlich der geltenden Platzhaltermodi. Auch Namen aktivierter Production-,
Beta- und Review-Projekte sind reserviert, einschließlich der optionalen Umgebungen
des verwalteten Wizards. Ein Platzhalterdienst `*.apps.example.com` reserviert seine
Subdomains, aber nicht `apps.example.com` selbst. Eine leere Alias-Konfiguration
belässt die vorhandenen Domainmodi und Routing-Verträge der Installation unverändert.

## Über den unterstützten Konfigurationsablauf einrichten

Rufe im Wizard die aktuell gespeicherte Konfiguration ab und lade eine private
ZIP-Sicherung herunter. Entpacke sie in ein privates Verzeichnis und bewahre
`.docker.env` und `.projects.env/` zusammen auf. Verwende das Hilfsprogramm aus dem
geprüften Checkout, um eine neue Konfigurationsdatei zu erzeugen. Node ist bereits
im Controller-Image enthalten; das Hilfsprogramm kann auch auf einem Arbeitsplatz
mit installiertem Node ausgeführt werden.

```sh
private_config_dir="$HOME/private-bootstrapper-config"
node nginx/wizard-aliases.js configure \
  --config "$private_config_dir/.docker.env" \
  --projects "$private_config_dir/.projects.env" \
  --alias example.com \
  --output "$private_config_dir/candidate.docker.env"
```

Wiederhole `--alias HOST` für jeden weiteren Namen. Wenn die Aliase ein anderes
Zertifikat verwenden, ergänze sowohl `--certificate /ssl/live/aliases.example.com/fullchain.pem`
als auch `--key /ssl/live/aliases.example.com/privkey.pem`. Bestehende Überschreibungen
bleiben erhalten, wenn diese Argumente fehlen. Verwende zum Entfernen aller
Weiterleitungen `--clear` statt der `--alias`-Argumente.

Das Hilfsprogramm prüft die Cube-Signatur, Host-Konflikte und die Syntax der
Zertifikatspfade, bevor es exklusiv eine Ausgabedatei mit Modus 0600 erstellt. Es
ändert nur seine Alias-Zuweisungen und bewahrt den Cube sowie alle anderen Bytes
der Konfiguration. Es ersetzt weder die Eingabe noch gibt es Zugangsdaten aus,
schreibt eine aktive NGINX-Konfiguration oder startet Dienste neu. Halte sowohl
die alte Konfiguration als auch die erzeugte Datei privat. Verwende einen aktuellen,
vollständigen Projektexport, damit die Prüfung die zugewiesenen Projektnamen der
Installation berücksichtigen kann.

Wähle im Wizard **Öffnen** und anschließend `candidate.docker.env`. Behalte
`.docker.env` im Dateinamen, damit Öffnen die Datei als Hauptkonfiguration erkennt.
Prüfe die kanonischen Wizard-Einstellungen und bestehenden Projekte. Wähle dann
**Sichern**, um die aktualisierte JSON-/ZIP-Datei aufzubewahren, und
**Synchronisieren → Übertragen**, um sie anzuwenden. Rufe die Konfiguration erneut
ab, bevor du sie in einem anderen Browser oder einem älteren Formular bearbeitest.

Diese Einstellungen verwenden die vorhandene Unterstützung des Wizards für
zusätzliche `runtimeOptions`. Abrufen/Öffnen bewahrt dort unbekannte Schlüssel der
Hauptumgebung. JSON-Sichern/Öffnen und ZIP/Übertragen führen sie weiter, auch nach
anderen Formularänderungen. Es gibt kein eigenes Alias-Formularfeld. Setze bei
einer bewussten JSON-Bearbeitung die Werte unter `main.runtimeOptions`, zum Beispiel:

```json
{
  "WIZARD_ALIASES": "example.com",
  "WIZARD_ALIAS_SSL": "/ssl/live/example.com/fullchain.pem",
  "WIZARD_ALIAS_SSL_KEY": "/ssl/live/example.com/privkey.pem"
}
```

Ersetze eine vollständige Konfigurationssicherung nicht durch diesen Ausschnitt.
Das normale Übertragen und Projektänderungen prüfen Konflikte, bevor sie die
gespeicherte Konfiguration ändern. Starten/Neuladen prüft das gespeicherte
Alias-Routing erneut, bevor Vorlagen ersetzt werden.

## Erzeugung, Neustart und Wiederherstellung

`nginx/start.sh` erstellt bei jedem Start und Neuladen
`zz-wizard-aliases.conf.template` aus der gespeicherten Haupt- und Projektkonfiguration
neu. Wenn Aliase deaktiviert sind, überschreibt es diese Vorlage mit leerem Inhalt,
sodass eine früher erzeugte Route nach dem Entfernen nicht bestehen bleiben kann.
Auch die Wiederherstellungsphase nur für die Registry leert die Vorlage. Der
normale Start baut sie neu auf, sobald der Wizard verfügbar ist. Ein privates
Hilfsprogramm oder eine aufbewahrte Vorlage ist nicht erforderlich.

Konfigurationssicherungen bleiben von Dienstdatensicherungen getrennt. Bewahre
die aktualisierte Wizard-JSON-/ZIP-Datei mit dem passenden abgeschlossenen
Harvest/Seed auf. Stelle beides nach dem Wiederherstellungsablauf in frischem
aktivem Speicher wieder her. Seed bewahrt Zertifikate und Dienstzustand; die
separate Konfiguration stellt die Alias-Einstellungen wieder her. Ein Seed ohne
passende Konfiguration ist keine vollständige Installationssicherung. Für den
Normalbetrieb muss das Sicherungsmedium nicht angeschlossen sein.

## Eine konfigurierte Installation prüfen

Führe die native Prüfung neben den üblichen Prüfungen der konfigurierten Dienste
auch mit dem vom Betreiber angegebenen Alias-Ursprung aus:

```sh
sudo python3 bootstrapper/verify-runtime.py check \
  --persistence-env /etc/system-bootstrapper/persistence.env \
  --baseline "$private_config_dir/pre-start-baseline.json" \
  --output "$private_config_dir/runtime-check.json" \
  --redirect-from https://example.com
```

Verwende die normalen Baseline-, Checkout- und Zugangsdatenargumente des Prüfers
für den ausgeführten Vorgang. Wenn die Installation einen Alias benötigt, behalte
`--redirect-from` im Aufruf für die Bereitschaftsprüfung bei. Prüfe HTTP und HTTPS,
einen kodierten Pfad mit Abfrageparametern sowie das öffentliche TLS-Vertrauen.
Wiederhole dies nach dem repositoryeigenen NGINX-Neuladen, einem Dienstneustart
und einer entbehrlichen Wiederherstellung aus Konfiguration und Seed. Die
mitgelieferten Plattformtests führen diese Lebenszyklusprüfungen mit allgemeinen
Testdomains und einer lokalen ACME-Ausgabestelle durch.

Beide virtuellen Alias-Hosts bedienen `/.well-known/acme-challenge/` direkt aus
`/ssl/acme-http01`. Eine vorhandene Challenge liefert ihren Inhalt ohne Weiterleitung;
eine fehlende Challenge liefert 404 ohne Location-Header. Prüfe die
Zertifikatserneuerung mit dem dokumentierten Webroot-/Deploy-Hook-Verfahren,
einschließlich der Prüfung und des Neuladens der NGINX-Konfiguration. Eine
Weiterleitungsantwort allein belegt nicht, dass Ausstellung oder Erneuerung von
Zertifikaten funktionieren.
