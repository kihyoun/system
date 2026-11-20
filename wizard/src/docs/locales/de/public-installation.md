## Öffentlicher Server: eigene Domain und HTTPS

Dieser Weg installiert eine **neue** Plattform auf einem Ubuntu-24.04-LTS-Server mit sudo-
Zugriff, ausreichend lokalem Speicherplatz und einer von Ihnen kontrollierten Domain. Ein ausdrücklich eingebundenes
Live-Volume ist optional. Die Wiederverwendung von GitLab-Daten erfordert stattdessen das [Ersatzhostverfahren](#replace-a-host-while-retaining-its-data-volume).
Planen Sie Arbeitsspeicher, CPU und Speicherplatz für GitLab sowie die vorgesehenen Runner-Jobs
ein; die Docker-Installationsprüfung weist diese Kapazität nicht nach.

Das Beispiel verwendet `www.example.com` für den Wizard, `sync.example.com` für Sync,
`gitlab.example.com` für GitLab und `registry.example.com` für die Registry.
Ersetzen Sie diese Namen, die Serveradresse, das Administratorkonto und die Kontakt-E-Mail
überall. Auf dem bloßen Namen `example.com` wird in diesem Beispiel kein Dienst
konfiguriert; allein ein Zertifikat zu beschaffen richtet keine Route für einen Alias ein.

### Öffentlich 1. DNS, Ports und Host vorbereiten

Erstellen Sie diese DNS-Einträge bei Ihrem DNS-Anbieter. `203.0.113.10` ist eine Dokumentations-
adresse: Verwenden Sie die tatsächliche öffentliche IPv4-Adresse Ihres Servers.

| DNS-Name | Typ | Wert |
| --- | --- | --- |
| `www.example.com` | A | `203.0.113.10` |
| `sync.example.com` | A | `203.0.113.10` |
| `gitlab.example.com` | A | `203.0.113.10` |
| `registry.example.com` | A | `203.0.113.10` |

Veröffentlichen Sie AAAA-Einträge nur, wenn dieser Server die Namen tatsächlich über IPv6 bedient.
Entfernen Sie veraltete IPv6-Einträge vor dem Anfordern von Zertifikaten. Prüfen Sie alle vier Namen
von einem Rechner außerhalb des Servers, beispielsweise mit `dig +short A NAME` und
`dig +short AAAA NAME`. Sie müssen auf diesen Host auflösen; warten Sie die Verteilung der DNS-
Änderungen ab, bevor Sie fortfahren.

Konfigurieren Sie die **externe Firewall des Anbieters** für diesen neuen Server:

| Eingehender Verkehr | Erste Zertifikatsausstellung | Erste Wizard-Einrichtung | Fertige HTTPS-Installation |
| --- | --- | --- | --- |
| Ihr SSH-Port, normalerweise TCP 22 | Von Ihrer Administrationsadresse erlauben | Weiterhin erlauben | Weiterhin erlauben |
| TCP 80 | Öffentlich für HTTP-01 erlauben | Öffentlichen Zugriff sperren | Öffentlich für Weiterleitungen und HTTP-01-Erneuerung erlauben |
| TCP 443 | Geschlossen halten | Bis zur HTTPS-Konfiguration geschlossen halten | Öffentlich erlauben |
| TCP 8071, 5050 und 2222 | Keine öffentliche Regel erforderlich | Keine öffentliche Regel erforderlich | Für dieses Beispiel keine öffentliche Regel erforderlich |

Wenden Sie dieselben Einschränkungen in jeder Host-Firewall an. Halten Sie Ihre funktionierende SSH-Sitzung
während Regeländerungen offen. Der spätere SSH-Tunnel sichert Ihre Browserverbindung;
er beschränkt **nicht** den Port-80-Listener des Bootstrappers. Die externe Regel
ist daher während der vorübergehenden HTTP-Einrichtung erforderlich. Von Docker veröffentlichte Bridge-
Ports umgehen die normalen INPUT-Regeln von UFW und erfordern gesonderte Beachtung.
Das optionale Verfahren für [getrennte SSH-Ports](#public-7-separate-administrative-and-gitlab-ssh)
erläutert diese Grenze; dieses Erststartbeispiel beschränkt GitLab-SSH und
den direkten Registry-Port auf Loopback.

Verbinden Sie sich per SSH und führen Sie diese Befehle auf dem Server aus:

```bash
sudo apt-get update
sudo apt-get install -y git certbot dnsutils openssl
certbot --version
SYSTEM_REVISION='REPLACE_WITH_40_CHARACTER_RELEASE_COMMIT'
git clone https://github.com/kihyoun/system.git
cd system
git checkout --detach "$SYSTEM_REVISION"
git submodule update --init --recursive
CONTROLLER_RELEASE='docker.io/your-namespace/system@sha256:REPLACE_WITH_64_HEX_DIGEST'
WIZARD_RELEASE='docker.io/your-namespace/wizard@sha256:REPLACE_WITH_64_HEX_DIGEST'
sudo bash bootstrapper/install.sh
```

Wählen Sie Quellcodeversion und beide öffentlichen Image-Digests aus einem freigegebenen
Release, wie unter [Auswahl eines öffentlichen Releases](../Prepare-Host.md#install-a-tested-public-release) beschrieben.
Verwenden Sie weder einen ungetesteten Branch noch ein Laufzeitbasis-Image oder einen beweglichen `latest`-Tag.
Der neue Host lädt den vollständigen Controller und Wizard, statt
diese Images lokal zu bauen.

Nutzen Sie Certbot **ab Version 2.3.0**, das `reconfigure` unterstützt; das Ubuntu-24.04-
[Paket bietet diese Schnittstelle](https://packages.ubuntu.com/noble/certbot).
Die folgende Host-Integration ruft
`/usr/bin/certbot` und `certbot.timer` auf; dieses Rezept verwendet daher das Distributions-
paket statt einer separaten Snap-Installation. Führen Sie
`bootstrapper/prepare-local.sh` nicht aus: Öffentliches DNS und eine vertrauenswürdige HTTPS-Registry ersetzen
dessen Änderungen an lokaler Hosts-Datei und unsicherer Registry.

### Öffentlich 2. Arbeitsdatenspeicher wählen und Zertifikatsintegration installieren

Diese Neuinstallation speichert Live-Daten auf dem Systemlaufwerk des Servers. Erstellen Sie einen
ausdrücklichen Selektor, damit Zertifikatsintegration und Lebenszykluswerkzeuge dasselbe
Arbeitsverzeichnis verwenden:

```bash
sudo install -d -m 0700 /etc/system-bootstrapper
sudo tee /etc/system-bootstrapper/persistence.env >/dev/null <<'EOF'
PERSISTENCE_MODE=local
PERSISTENT_MOUNT=/
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
EOF
sudo chmod 0600 /etc/system-bootstrapper/persistence.env
sudo bash bootstrapper/install-volume-host.sh
sudo systemctl stop certbot.timer
```

Trotz seines Kompatibilitätsnamens unterstützt `install-volume-host.sh` lokalen Speicher.
Es prüft den Arbeitsdatenspeicher, verbindet `/etc/letsencrypt` mit
`PERSISTENT_DIR/host/letsencrypt` und installiert den Sperr-Wrapper `system-certbot`
sowie den Zertifikats-Deploy-Hook. Es erzeugt keine Docker- oder Erneuerungsabhängigkeit von
einem externen Seed-Ziel. Gleichen Sie widersprüchliche aktive Certbot-Verzeichnisbäume ab, statt
Zertifikatszustand zu löschen. Der Timer wird vorübergehend gestoppt, während unten die
Erneuerungsmethode geändert wird.

Verwenden Sie für einen bewusst volumegestützten Live-Aufbau stattdessen `PERSISTENCE_MODE=volume`
und den tatsächlichen Einhängepunkt bzw. die UUID aus der [Persistenzanleitung](PERSISTENT_VOLUME.md).
Formatieren Sie kein bestehendes Volume. Ein fehlendes ausgewähltes Live-Volume blockiert den Start.

### Öffentlich 3. Erstes Zertifikat vor dem Plattformstart beschaffen

Zu diesem Zeitpunkt **darf nichts Host-Port 80 belegen**. Prüfen Sie `sudo ss -ltnp` und
klären Sie vorhandene Host-Webserver oder Container bewusst. Halten Sie öffentliches TCP
80 für diesen Schritt offen. Certbots eigenständiger Server kann dann HTTP-01 beantworten,
ohne zuvor NGINX oder ein Zertifikat zu benötigen:

```bash
sudo system-certbot certonly --standalone --non-interactive --agree-tos \
  --email YOUR_CONTACT_EMAIL --cert-name example.com \
  -d www.example.com -d sync.example.com \
  -d gitlab.example.com -d registry.example.com
sudo system-certbot certificates --cert-name example.com
sudo env RENEWED_LINEAGE=/etc/letsencrypt/live/example.com \
  /usr/local/sbin/system-install-certificate
```

Verwenden Sie eine echte Kontakt-E-Mail. Das Zertifikat muss alle vier Dienstnamen aufführen und
von der produktiven CA stammen, nicht von einer Staging-CA. Scheitert die Ausstellung,
prüfen Sie DNS-/AAAA-Einträge, die Erreichbarkeit von TCP 80 und eine mögliche Portbelegung, bevor Sie
es erneut versuchen; fordern Sie zur Routing-Diagnose nicht wiederholt neue Zertifikate an.

`--cert-name example.com` legt den Namen des Zertifikatslinien-Verzeichnisses fest; die bloße
Domain wird dadurch nicht ins Zertifikat aufgenommen. Der installierte Deploy-Hook kopiert Zertifikat
und privaten Schlüssel nach `PERSISTENT_DIR/ssl/live/example.com/`. Der ausdrückliche Befehl
stellt auch diese erste Kopie bereit, bevor ein Proxy existiert.

| Zweck | Pfad |
| --- | --- |
| Vollständiger aufbewahrter Certbot-Zustand | `PERSISTENT_DIR/host/letsencrypt/`, auf dem Host als `/etc/letsencrypt` zugänglich |
| Quellzertifikat und Schlüssel auf dem Host | `/etc/letsencrypt/live/example.com/fullchain.pem` und `privkey.pem` |
| Bereitgestellte Kopien auf dem Datenvolume | `PERSISTENT_DIR/ssl/live/example.com/fullchain.pem` und `privkey.pem` |
| Im Wizard einzugebende Pfade innerhalb von NGINX | `/ssl/live/example.com/fullchain.pem` und `/ssl/live/example.com/privkey.pem` |

Bewahren Sie den gesamten Certbot-Verzeichnisbaum einschließlich `archive`, Konto- und Erneuerungszustand auf.
Nur seine `live`-Symlinks zu kopieren reicht nicht aus. Der Wizard stellt kein
Zertifikat aus und NGINX liest einen Host-Pfad unter `/etc/letsencrypt` nicht direkt.

### Öffentlich 4. Ersten Start über einen SSH-Tunnel konfigurieren

**Sperren Sie öffentliches TCP 80 erneut in der Anbieter-Firewall, bevor Sie den
Bootstrapper starten.** Lassen Sie TCP 443 vorerst geschlossen. Starten Sie die Neuinstallation im Projektverzeichnis auf dem
Server:

```bash
sudo env GITLAB_SSH_BIND=127.0.0.1:2222 GITLAB_REGISTRY_BIND=127.0.0.1:5050 \
  python3 bootstrapper/install-release.py \
  --controller "$CONTROLLER_RELEASE" --wizard "$WIZARD_RELEASE" \
  --persistence-env /etc/system-bootstrapper/persistence.env
sudo docker ps
sudo docker logs system_bootstrapper_1
```

Das Installationsprogramm prüft Quellcode, exakten Controller und passenden Wizard,
lädt die öffentlichen Images und startet ohne Quellcode-Build. Seine Neuinstallations-
prüfungen lehnen vorhandene GitLab-Daten oder Hauptkonfiguration ab. Ein öffentliches Release
berechtigt nicht dazu, eine vorhandene Datenbank auf eine andere GitLab-Version umzustellen: Nutzen Sie
für diesen Übergang das Upgrade-Verfahren. GitLab-SSH bleibt auf Loopback-Port 2222,
sodass es nicht den Administrationsport des Hosts belegen kann. Registry-Clients nutzen ihren
HTTPS-Namen auf Port 443; direkter Host-Port 5050 bleibt privat.

Öffnen Sie auf **Ihrem eigenen Rechner** ein weiteres Terminal und lassen Sie diesen Tunnel laufen:

```bash
ssh -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8080:127.0.0.1:80 ADMIN_USER@SERVER_IP
```

Verwenden Sie Ihr SSH-Konto, die Serveradresse und bei Bedarf `-p PORT`. Öffnen Sie
`http://localhost:8080/`, wählen Sie **Wizard** und öffnen Sie über das Stiftsymbol **Verbindung bearbeiten** den Dialog. Verwenden Sie als
**Serveradresse** **`http://localhost:8080/sync`**. Lesen Sie die erzeugten Sync-Zugangsdaten
auf dem Server mit dem privaten Befehl in [Abschnitt 0.4](#04-find-the-signature-server-address-and-actual-credentials) aus.
Bestätigen Sie die Verbindung und wählen Sie **Synchronisieren → Abrufen**. Bei einer neuen Instanz
liefert Abrufen Vorschläge: Prüfen und ersetzen Sie diese anhand der Tabelle.

| Abschnitt / Wizard-Feld | Wert für dieses öffentliche Beispiel |
| --- | --- |
| Allgemein → Start: `SEED_DIR` | Leer bis zur Wahl eines separaten Seed-Backup-Ziels |
| Allgemein → Start: `GITLAB_HOST` | `gitlab.example.com` |
| Allgemein → Start: `GITLAB_REGISTRY_HOST` | `registry.example.com` |
| Allgemein → Start: GitLab-Runner / Runner-Authentifizierungstoken | Anfangs `0` / leer; nach GitLabs Betriebsbereitschaft registrieren |
| Allgemein → SSL: `GITLAB_DOMAIN_MODE`, `GITLAB_REGISTRY_DOMAIN_MODE` | Für beide **SSL-verschlüsselt**, Wert `2` |
| Allgemein → SSL: `GITLAB_SSL`, `GITLAB_REGISTRY_SSL` | Für beide `/ssl/live/example.com/fullchain.pem` |
| Allgemein → SSL: `GITLAB_SSL_KEY`, `GITLAB_REGISTRY_SSL_KEY` | Für beide `/ssl/live/example.com/privkey.pem` |
| Allgemein → Sync: Synchronisierungsserver aktivieren / `SYNC_HOST` | Aktivieren / `sync.example.com` |
| Allgemein → Sync: `SYNC_USER`, `SYNC_PASS` | Ihr eigener, vom Standard abweichender Benutzername und ein starkes Passwort |
| Allgemein → Sync: `SYNC_DOMAIN_MODE` | **SSL-verschlüsselt**, Wert `2` |
| Allgemein → Sync: `SYNC_SSL`, `SYNC_SSL_KEY` | `/ssl/live/example.com/fullchain.pem`, `/ssl/live/example.com/privkey.pem` |
| Allgemein → Wizard: Wizard aktivieren / `WIZARD_HOST` | Aktivieren / `www.example.com` |
| Allgemein → Wizard: `WIZARD_DOMAIN_MODE` | **SSL-verschlüsselt**, Wert `2` |
| Allgemein → Wizard: `WIZARD_SSL`, `WIZARD_SSL_KEY` | `/ssl/live/example.com/fullchain.pem`, `/ssl/live/example.com/privkey.pem` |

Um zusätzliche Namen wie `example.com` an diesen Wizard weiterzuleiten, konfigurieren Sie
[kanonische Wizard-Aliasse](WIZARD_ALIASES.md). Lassen Sie jeden Alias auf diesen Proxy zeigen
und nehmen Sie ihn ins ausgewählte Zertifikat auf. Aliasse sind ausdrücklich gespeicherte
Konfiguration; allein die Wahl von `www.example.com` erzeugt keine Weiterleitung der bloßen
Domain. Testen Sie nach Übertragen sowohl HTTP als auch HTTPS mit Pfad und Abfrage.

Die Felder benötigen die **vollständigen Containerpfade** einschließlich `/ssl`; eine neben
dem Eingabefeld angezeigte Pfadergänzung ersetzt dieses Präfix nicht. Verwenden Sie
in den `*_HOST`-Feldern Hostnamen ohne Schema. Die erzeugten externen GitLab- und
Registry-URLs müssen `https://gitlab.example.com` und
`https://registry.example.com` lauten, ohne `:5050`. Die historische Datei
`system/.docker.env.example` enthält `/live/...`-Pfade ohne das Mount-Präfix `/ssl`;
diese Pfade sind im HTTP-Modus inaktiv und dürfen beim Aktivieren von HTTPS nicht unverändert
übernommen werden. Prüfen Sie **Allgemein → Website** und
ersetzen Sie die öffentlichen Betreiberbeispiele vor der Veröffentlichung Ihrer Website.

Wählen Sie **Sichern → bootstrapper.json** oder **Sichern → bootstrapper.zip** und bewahren Sie die Datei privat auf. Nutzen Sie dann
**Synchronisieren → Übertragen**. Ein erfolgreiches Übertragen wendet die Konfiguration an und startet
die Plattform neu; der vorübergehende Tunnelendpunkt `/sync` funktioniert nicht mehr, sobald das konfigurierte
HTTPS-Routing übernimmt. Rufen Sie für diese Neuinstallation nicht Seed auf.

### Öffentlich 5. HTTPS prüfen und dann öffentlichen Verkehr erlauben

Halten Sie SSH-Zugriff und externe Einschränkung während des Dienststarts aufrecht. Auf dem Server:

```bash
sudo docker ps
sudo docker exec system_web_1 nginx -t
curl --resolve www.example.com:443:127.0.0.1 -I https://www.example.com/
curl --resolve gitlab.example.com:443:127.0.0.1 -I https://gitlab.example.com/users/sign_in
curl --resolve registry.example.com:443:127.0.0.1 -I https://registry.example.com/v2/
```

Warten Sie, bis GitLab `healthy` meldet. Der Wizard muss HTTP 200 zurückgeben, GitLabs
Anmeldeseite muss erreichbar sein und eine nicht authentifizierte Registry-Anfrage liefert normalerweise
HTTP 401 mit einer Authentifizierungsaufforderung. Nutzen Sie nicht `curl -k`: Ein
abweichender Hostname oder ein nicht vertrauenswürdiges Zertifikat muss korrigiert werden.

Erlauben Sie nun **öffentliches TCP 80 und 443** in Anbieter- und Host-Firewall. Öffnen Sie von Ihrem
Rechner `https://www.example.com/`. Verbinden Sie den Wizard mit
**`https://sync.example.com`** und den gespeicherten Sync-Zugangsdaten; führen Sie dann Abrufen aus und
prüfen Sie gespeicherte Hostnamen, Modi und Projekte. HTTP-Anfragen an die vier Dienst-
namen sollten auf HTTPS umleiten, während HTTP-01-Challenge-Dateien weiterhin
auf Port 80 verfügbar bleiben. Schließen Sie den vorübergehenden SSH-Tunnel, sobald er nicht mehr benötigt wird.

Lesen Sie auf dem Server das anfängliche GitLab-`root`-Passwort gemäß
[Abschnitt 0.11](#011-open-gitlab-and-sign-in-for-the-first-time) aus, melden Sie sich unter
`https://gitlab.example.com/` an und ändern Sie es. Folgen Sie für einen Runner
[Kapitel 2](#2-setting-up-gitlab-runners) mit den öffentlichen Wizard- und Sync-URLs:
Setzen Sie die Anzahl auf `1`, lassen Sie das Token leer, führen Sie Übertragen aus, warten Sie auf die Registrierung und prüfen Sie
den Online-Manager unter **Admin → CI/CD → Runners**. Git-Klone und Registry-
Zugriff verwenden in diesem Beispiel HTTPS; die öffentliche Freigabe von GitLab-SSH benötigt eine separate,
bewusste Port- und Firewall-Konfiguration. Lesen Sie
[Öffentlich 7](#public-7-separate-administrative-and-gitlab-ssh) nach Abschluss der HTTPS-
und Erneuerungseinrichtung.

### Öffentlich 6. Unbeaufsichtigte Erneuerung auf den laufenden Proxy umstellen

Die erste Ausstellung speicherte **standalone** als Authentifikator. Bliebe diese Einstellung
unverändert, würde eine spätere Erneuerung mit NGINX um Port 80 konkurrieren. Der aktuelle
Modus-2-Proxy bedient HTTP-01 aus dem gemeinsamen Webroot; der anfängliche Startproxy
bietet diese Route nicht für jeden konfigurierten Host. Die aktuellen normalen HTTP-Routen
bedienen ebenfalls das gemeinsame Webroot, sodass eine bestehende Anwendung vor dem
Wechsel zu HTTPS ein Zertifikat erhalten kann. Das [HTTPS-Verfahren für Anwendungen](PROJECT_BOOTSTRAP_GUIDE.md#give-an-application-a-trusted-https-hostname)
beschreibt eine unabhängige Zertifikatslinie für die Anwendung und den Umgang mit Browserdaten.

Erstellen Sie auf dem Server einen harmlosen Test im tatsächlichen Webroot:

```bash
sudo bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  chmod 0711 "$PERSISTENT_DIR/ssl"
  install -d -m 0755 "$PERSISTENT_DIR/ssl/acme-http01" \
    "$PERSISTENT_DIR/ssl/acme-http01/.well-known" \
    "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge"
  printf "%s\n" bootstrapper-acme-check > "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/bootstrapper-check"
  chmod 0644 "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/bootstrapper-check"
'
```

Die native Speichervorbereitung ergänzt das Durchquerungsrecht für die eingebundene `/ssl`-Wurzel
und erstellt das öffentliche ACME-Webroot. Dieser Test erstellt auch die öffentlichen Challenge-
Unterverzeichnisse und das Token; er lässt die Zertifikatslinien-Verzeichnisse unter `ssl/live` und die Rechte
privater Schlüssel unverändert. Ändern Sie die Rechte des Zertifikatsbaums nicht rekursiv.

Rufen Sie von **außerhalb** des Servers
`http://www.example.com/.well-known/acme-challenge/bootstrapper-check` auf und wiederholen Sie dies
für `sync`, `gitlab` und `registry`. Alle vier müssen `bootstrapper-acme-check`
mit HTTP 200 ohne Weiterleitung zurückgeben. Zum Beispiel:

```bash
for name in www sync gitlab registry; do
  curl --fail --silent --show-error "http://$name.example.com/.well-known/acme-challenge/bootstrapper-check"
done
```

Wiederholen Sie denselben Challenge-Test für jeden konfigurierten Wizard-Alias. Dessen normale
Weiterleitung muss den HTTP-01-Challenge-Pfad direkt erreichbar lassen.

Führen Sie nach erfolgreichem Test auf dem Server aus:

```bash
sudo bash -c '
  set -euo pipefail
  source /etc/system-bootstrapper/persistence.env
  /usr/local/sbin/system-certbot reconfigure --cert-name example.com \
    --authenticator webroot --webroot-path "$PERSISTENT_DIR/ssl/acme-http01"
  /usr/local/sbin/system-certbot renew --cert-name example.com --dry-run --run-deploy-hooks
  RENEWED_LINEAGE=/etc/letsencrypt/live/example.com /usr/local/sbin/system-install-certificate
  cmp /etc/letsencrypt/live/example.com/fullchain.pem "$PERSISTENT_DIR/ssl/live/example.com/fullchain.pem"
  cmp /etc/letsencrypt/live/example.com/privkey.pem "$PERSISTENT_DIR/ssl/live/example.com/privkey.pem"
  docker exec system_web_1 nginx -t
  curl --fail --silent --show-error --output /dev/null \
    --resolve www.example.com:443:127.0.0.1 https://www.example.com/
  rm "$PERSISTENT_DIR/ssl/acme-http01/.well-known/acme-challenge/bootstrapper-check"
  systemctl enable --now certbot.timer
'
systemctl list-timers certbot.timer
```

`reconfigure` testet gegen den Staging-Dienst der CA und speichert dann die erfolgreiche
Webroot-Methode für künftige Erneuerungen. `install-volume-host.sh` bindet bei einer Wiederherstellung bestehende
**webroot**-Pfade neu ein; es wandelt eine Standalone-Zertifikatslinie nicht für Sie in eine
Webroot-Erneuerung um. Schließen Sie die Einrichtung nicht ab, wenn Neukonfiguration oder Trockenlauf
fehlschlagen. Meldet eine Sperre eine aktive oder unterbrochene Erneuerung oder Harvest, klären Sie den
zugehörigen Vorgang, statt dessen Sperre zu löschen, während er möglicherweise noch läuft.

Der obige Trockenlauf führt Deploy-Hooks ausdrücklich mit dem **aktiven vertrauenswürdigen
Zertifikat** aus, nicht mit dem Staging-Zertifikat. Der Hook kopiert die erneuerten Dateien,
führt `nginx -t` aus und lädt den bestehenden Proxy neu. Achten Sie darauf, ob ein Hook einen
Status ungleich null zurückgibt: Certbot kann diesen Fehler melden, ohne die Erneuerung selbst
scheitern zu lassen. Normale Erfolgsmeldungen von `nginx -t` verwenden stderr und zeigen allein keinen
Fehler an. Der direkte Aufruf des Installationsprogramms prüft zusätzlich den installierten Deploy-
Vorgang bei laufendem Proxy; `cmp` bestätigt, dass beide bereitgestellten Dateien der
aktiven Zertifikatslinie entsprechen, ohne ihren Inhalt auszugeben. Beheben Sie jeden tatsächlichen Hook-Fehler,
bevor Sie die Erneuerung als betriebsbereit ansehen. Der Block stoppt bei einem fehlgeschlagenen
Befehl, bevor der Timer aktiviert wird. Ein einfaches `renew --dry-run` lässt Deploy-Hooks aus
und ist keine vollständige Bereitstellungsprüfung. Untersuchen Sie Fehler mit
`sudo journalctl -u certbot.service` und `/var/log/letsencrypt/letsencrypt.log`;
prüfen Sie regelmäßig Timer und Ablaufdatum des ausgelieferten Zertifikats. Halten Sie TCP 80 und
korrektes DNS für künftige HTTP-01-Erneuerungen verfügbar. Nach dieser Webroot-Einrichtung sind weder regelmäßige Proxy-
Abschaltungen noch manuelle Zertifikatskopien erforderlich.

Lesen Sie Certbots Originalanleitungen zu
[Standalone-Ausstellung](https://eff-certbot.readthedocs.io/en/stable/using.html#standalone),
[Änderungen der Erneuerungskonfiguration](https://eff-certbot.readthedocs.io/en/stable/using.html#modifying-the-renewal-configuration-of-existing-certificates)
und [Deploy-Hooks beim Testen](https://eff-certbot.readthedocs.io/en/stable/using.html#testing).

### Öffentlich 7. Administrations-SSH und GitLab-SSH trennen

Dieses optionale Verfahren stellt eine bestehende HTTPS-Installation auf diesen Aufbau um:

| Dienst | Host-Port | Vorgesehener eingehender Zugriff |
| --- | --- | --- |
| Ubuntu-Administration | TCP 2222 | Nur die vertrauenswürdige öffentliche Quelladresse des Administrators |
| GitLab-SSH | TCP 22 | Öffentlich; GitLab authentifiziert Repository-Benutzer |
| HTTP und HTTPS | TCP 80 und 443 | Öffentlich wie oben konfiguriert |
| Direkter Registry-Listener | `127.0.0.1:5050` | Nur Loopback; externe Registry-Clients verwenden HTTPS 443 |

`ssh -p 2222 root@server.example.com` erreicht das Administrationskonto des Hosts;
verwenden Sie Ihr sudo-Konto, wenn die root-Anmeldung deaktiviert ist. Eine Repository-URL wie
`git@gitlab.example.com:namespace/project.git` erreicht GitLab auf dessen Standard-
port 22. GitLabs Konto `git` bietet keine root-Administrationsshell.
Registrieren Sie öffentliche SSH-Schlüssel für Repositorys beim vorgesehenen GitLab-Benutzer oder als Deploy-Key;
`authorized_keys` des Hosts und GitLab-Berechtigungen sind getrennt. Die beiden SSH-Dienste
haben auch getrennte Host-Schlüssel. Prüfen Sie Fingerabdrücke unabhängig, statt
nach den Portänderungen einen unerwarteten Schlüssel zu akzeptieren.

Der Bootstrapper konfiguriert weder den SSH-Daemon noch die Firewalls des Hosts. Die
folgenden Betriebssystembeispiele verwenden die lokal zugewiesene Server-IPv4
`203.0.113.10` und die vertrauenswürdige Administratorquelle `198.51.100.25/32`; ersetzen Sie beide.
Binden Sie bei einem Server hinter NAT eine tatsächlich dem Host zugewiesene Adresse und passen Sie
die externen Weiterleitungsregeln an. Halten Sie die aktuelle authentifizierte Sitzung offen und
während der gesamten Änderung eine Wiederherstellung über die Anbieterkonsole bereit.

#### Neuen Administrationslistener vorbereiten und testen

Erlauben Sie zunächst TCP 2222 von der vertrauenswürdigen Quelle in Anbieter-Firewall und UFW,
während die Regel für den funktionierenden Administrationsport erhalten bleibt. Behalten Sie die bestehenden
80-/443-Regeln bei. Verwenden Sie eine standardmäßig ablehnende Eingangsrichtlinie ohne weiter gefasste Freigabe für
2222. Ist UFW inaktiv, erlauben Sie den funktionierenden SSH-Weg, **bevor** Sie es aktivieren;
prüfen Sie bestehende Regeln, statt die Firewall zurückzusetzen:

```bash
sudo ufw allow from 198.51.100.25/32 to any port 2222 proto tcp
sudo ufw status numbered
sudo systemctl status ssh.socket ssh.service --no-pager
sudo systemctl cat ssh.socket
sudo systemctl show ssh.service -p KillMode
sudo ss -lntp
```

Ubuntu verwendet üblicherweise [SSH-Socket-Aktivierung](https://discourse.ubuntu.com/t/sshd-now-uses-socket-based-activation-ubuntu-22-10-and-later/30189).
Unter Ubuntu 24.04 liest ein Generator `sshd_config`; ältere migrierte oder angepasste
Installationen können auch Socket-Drop-ins haben. Prüfen Sie sowohl die SSH-Konfiguration
als auch die wirksamen Units. Ein Neuladen des Daemons allein ersetzt keine lauschenden Sockets.

Führen Sie in `/etc/ssh/sshd_config.d/` die gewünschten Listener mit vorhandenen
`Port`-/`ListenAddress`-Einträgen zusammen. Behalten Sie während der Vorbereitung die Administration auf 22 bei und ergänzen Sie
auf 2222 ausschließlich die ausdrückliche IPv4 des Servers:

```text
Port 22
Port 2222
ListenAddress 203.0.113.10:22
ListenAddress 203.0.113.10:2222
```

Gleichen Sie bei einer socketaktivierten Installation die Listener in einem lokalen Drop-in ab,
beispielsweise `/etc/systemd/system/ssh.socket.d/zz-bootstrapper-admin.conf`. Erstellen Sie
bei Bedarf das Verzeichnis und bearbeiten Sie die Datei; prüfen Sie bestehende Drop-ins und die
wirksame Unit, damit eine spätere Überschreibung keine unerwünschten Listener wiederherstellt:

```ini
[Socket]
ListenStream=
ListenStream=203.0.113.10:22
ListenStream=203.0.113.10:2222
```

Die leere Zuweisung löscht geerbte Listener. Verwenden Sie auf 2222 keinen Platzhalter,
solange Docker GitLab-SSH noch auf `127.0.0.1:2222` veröffentlicht: Diese Bindungen kollidieren.
Lassen Sie die Authentifizierungsrichtlinie unverändert und prüfen Sie sie mit `sudo sshd -t`, bevor
Sie etwas anwenden. Prüfen Sie sowohl `sudo sshd -T` als auch die wirksame Socket-Unit.

Der folgende Socket-Austausch setzt voraus, dass der installierte SSH-Dienst
`KillMode=process` meldet; dies erhält bestehende Sitzungsprozesse, wenn sein Haupt-
daemon stoppt. Siehe [systemd-Prozessbehandlung](https://www.freedesktop.org/software/systemd/man/latest/systemd.kill.html).
Ist dies nicht der Fall, nutzen Sie die Anbieterkonsole, statt anzunehmen, dass die SSH-Sitzung
bestehen bleibt. Nach erfolgreicher Konfigurationsprüfung:

```bash
sudo systemctl daemon-reload
sudo systemctl stop ssh.socket ssh.service
sudo systemctl start ssh.socket
sudo systemctl status ssh.socket --no-pager
sudo ss -lntp
```

Prüfen Sie bei dienstbasiertem SSH dieselbe Daemon-Konfiguration und starten Sie stattdessen
`ssh.service` neu. Bestätigen Sie die tatsächlichen Listener, bevor Sie fortfahren. Deaktivieren Sie von einer
**neuen Clientverbindung** an der vertrauenswürdigen Quelle die Wiederverwendung von Verbindungen und
verlangen Sie Schlüsselauthentifizierung:

```bash
ssh -S none -o PreferredAuthentications=publickey \
  -p 2222 root@server.example.com
```

Prüfen Sie den erwarteten Host-Fingerabdruck und dass der vorgesehene Administrations-/sudo-
Zugriff funktioniert. Entfernen Sie weder den alten Listener noch dessen Firewall-Zugriff, bis diese neue
Verbindung erfolgreich ist. Entfernen Sie jede breite Freigaberegel für 2222, die die
Quellbeschränkung aushebeln würde. Behandeln Sie auch IPv6 ausdrücklich: Dieses Beispiel bindet Administrations-
SSH ausschließlich an IPv4, statt einen unbeschränkten IPv6-Listener bestehen zu lassen.

#### Port 22 an GitLab übergeben und gespeicherte Konfiguration abgleichen

Entfernen Sie in Daemon-Konfiguration und Socket-Überschreibung den vorbereiteten Port-22-
Listener, sodass nur `Port 2222`, `ListenAddress 203.0.113.10:2222` und der
zugehörige Socket-Listener bleiben. Behalten Sie die leere Rücksetzung `ListenStream=` bei. Wiederholen Sie
`sshd -t`, die passende Neustartfolge und die obige Prüfung einer neuen Schlüsselanmeldung.
Bestätigen Sie mit `ss -lntp`, dass **sowohl IPv4- als auch IPv6-Port 22 frei von Host-SSH sind**.
Erlauben Sie dann öffentliches TCP 22 in der Anbieter-Firewall; die Administrationsbeschränkung
gilt weiterhin für TCP 2222.

Nach Prüfung des für andere Dienste benötigten Zugriffs drücken die folgenden UFW-Befehle
die Host-Richtlinie dieses Aufbaus aus. Setzen Sie bestehende Regeln nicht zurück. Entfernen Sie breitere
2222-Freigaben einschließlich IPv6-Regeln; das Ergänzen einer quellenspezifischen Freigabe
schränkt eine bestehende Freigabe von überall nicht ein. Ist UFW inaktiv, aktivieren Sie es
erst, nachdem der funktionierende Administrationsweg über 2222 erlaubt und wie oben neu
getestet wurde:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 198.51.100.25/32 to any port 2222 proto tcp
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Wiederholen Sie nach dem Anwenden der Regeln die neue administrative Schlüsselanmeldung. Halten Sie die IPv6-
Richtlinie im Einklang mit den tatsächlich bedienten Adressen; ergänzen Sie keine breite IPv6-
2222-Freigabe zu diesem ausschließlich IPv4 verwendenden Administrationsbeispiel.

Ändern Sie in der gespeicherten Datei `$PERSISTENT_DIR/configuration/.docker.env` nur die SSH-
Bindung und behalten Sie die private Registry-Bindung bei:

```bash
export GITLAB_SSH_BIND='22'
export GITLAB_REGISTRY_BIND='127.0.0.1:5050'
```

Erhalten Sie den exakten Cube/Header, festgelegte Images, Geheimnisse und alle anderen Einstellungen. Eine
einmalige Shell-Überschreibung ersetzt keine gespeicherte Konfiguration. Planen Sie den GitLab-
Neustart bei inaktiven Jobs; dieser Vorgang erstellt den Container unter Beibehaltung
desselben Images und der persistenten Daten neu. Führen Sie vom Host aus die bestehenden Einstiegspunkte
innerhalb des freigegebenen Controllers aus:

```bash
sudo docker exec -w /system/gitlab system_bootstrapper_1 bash -e ./start.sh
sudo docker exec -w /system/nginx system_bootstrapper_1 bash -e ./start.sh reload
```

Das Neuladen von NGINX erzeugt die HTTPS-/Registry-Upstreams neu, falls sich GitLabs Container-IP
geändert hat. Dies ist eine Konfigurationsänderung ohne Image-Build, Seed-Wiederherstellung oder
Datenbankversionsmigration. Warten Sie auf GitLabs Betriebsbereitschaft und prüfen Sie Wizard, Sync,
HTTPS- und Registry-Zugriff erneut. Laden Sie die gespeicherten Einstellungen in einem bereits geöffneten
Wizard vor dessen nächstem Übertragen mit Abrufen, damit ein altes Formular die vorherige Bindung nicht wiederherstellt.

Von Docker veröffentlichte Bridge-Ports können die INPUT-Regeln von UFW umgehen; eine standardmäßig ablehnende
Eingangsrichtlinie schützt allein keinen veröffentlichten Container-Port. Öffentliches GitLab-
22 ist hier beabsichtigt. Halten Sie andere Bindungen, besonders 5050, auf Loopback; prüfen Sie
`docker port system_gitlab_1` und testen Sie die Erreichbarkeit von außen. Erhalten Sie Dockers
Firewall-Verwaltung: Setzen Sie seine Optionen `iptables`/`ip6tables` nicht auf false. Siehe
[Docker und UFW](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw)
und die [Socket-Unit-Referenz](https://www.freedesktop.org/software/systemd/man/latest/systemd.socket.html).

Bestätigen Sie abschließend, dass die Host-Schlüsselanmeldung weiterhin 2222 verwendet, und testen Sie den Repository-Zugriff
als vorgesehener GitLab-Benutzer:

```bash
git ls-remote git@gitlab.example.com:namespace/project.git HEAD
```

Dies prüft den Lesezugriff auf Repositorys, nicht die Push-Berechtigung. Die
[native Laufzeitprüfung](../bootstrapper/README.md#reviewed-replacement-host-initialization)
prüft die anderen Anwendungs-/Speicherzusagen der Plattform; sie ersetzt nicht
diese SSH- und Firewall-Prüfungen.
