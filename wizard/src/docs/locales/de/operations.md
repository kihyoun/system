## Optionale wöchentliche Host-Wartung von einem vertrauenswürdigen Codex-Host

Ein Betreiber kann einen vertrauenswürdigen, dauerhaft laufenden Administrationshost
autorisieren, die folgende Ubuntu-Wartung wöchentlich auszuführen. Codex ist
optional; die Plattform hängt nicht davon ab. Dies aktualisiert Host-Pakete und
startet nur dann neu, wenn `/var/run/reboot-required` existiert. Dienst-Images,
Quellcode, gespeicherte Konfiguration und Seed werden nicht verändert. Halte
wiederherstellbare Sicherungen und Zugang zur Provider-Konsole bereit.

Stelle private Betreiberangaben bereit: Zielhostname, administrativer SSH-Port
(2222 für [Public 7](#public-7-separate-administrative-and-gitlab-ssh)), Schlüsselpfad
und unabhängig geprüfte Hostschlüsseldatei; akzeptierter sauberer Remote-Checkout
der Werkzeuge mit Revision; Persistenzauswahl und erwarteter Mount/UUID; privates
Stammverzeichnis für Belege; optional den Dateiselektor des administrativen
`read_api`-Tokens für den Prüfer. Halte die erlaubten Paketquellen und
Neustartrichtlinien fest. Schreibe niemals Zugangsdaten in den Aufgabentext oder
öffentliche Dokumentation.

Führe jeden Durchlauf wie folgt aus; bewahre Belege außerhalb des Quellcode-Checkouts auf:

1. Verwende SSH mit `BatchMode=yes`, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes`
   und der angegebenen `UserKnownHostsFile`, dem Port und Schlüssel. Prüfe den
   Remote-Checkout, den persistenten Mount/UUID und freien Speicherplatz. Halte
   `/proc/sys/kernel/random/boot_id`, Kernel, zurückgehaltene Pakete und bereits
   fehlgeschlagene Units fest. Verschiebe den Vorgang bei unerwarteter Identität,
   Speicherzustand, Paketsperre, `dpkg --audit`-Befund oder einem nicht abgeschlossenen
   Plattformvorgang.
2. Erfasse vom akzeptierten Remote-Checkout eine neue private Baseline und führe
   vor Änderungen `bootstrapper/verify-runtime.js check` dagegen aus. Verwende
   die [dokumentierten Optionen](../bootstrapper/README.md#reviewed-replacement-host-initialization).
   Behalte Hashes der gespeicherten Konfiguration/Authentifizierung und exakte
   Image-Identitäten unverändert. Aktualisiere Paketindizes mit `sudo apt-get update`
   und prüfe anschließend `sudo apt-get -s --with-new-pkgs --no-remove upgrade`.
   Beachte Paketsperren und die stufenweise Ubuntu-Verteilung. Erzwinge keine
   zurückgestellten Aktualisierungen, entferne keine Pakete und führe kein
   Ubuntu-Release-Upgrade aus. Docker-/containerd-, OpenSSH- und Firewall-Pakete
   erfordern besondere Prüfung. Melde den Zustand und beende den Ablauf, wenn
   weder Aktualisierung noch Neustart nötig ist.
3. Authentifiziere dich vor jeder Installation, die Dienste neu starten kann,
   bei Sync und prüfe `/status`: `needRestart`, `harvestInProgress`,
   `runnerSetupInProgress`, `defaultWizardSetupInProgress` und
   `projectOperationInProgress` müssen ausdrücklich false sein. Bestehende native
   Vorgangs-Leases einschließlich Umgebungs-Leases müssen fehlen. Führe die
   eingecheckte GitLab-Prüfung aus:

   ```bash
   sudo docker exec -i system_gitlab_1 gitlab-rails runner - < gitlab/upgrade-preflight.rb
   ```

   Ihr JSON muss die akzeptierte CE-Version, `runningJobs: 0` und
   `unfinishedBackgroundMigrations: 0` zeigen; Exitcode null allein reicht nicht.
   Bei Auslastung lass die Jobs weiterlaufen und verschiebe diese Wartung ohne
   Aktualisierungen oder Neustart.
4. Stimme die Ausfallzeit mit anderen Betreibern ab und stoppe den zugehörigen
   öffentlichen Web-Proxy. Verwende im bestehenden GitLab-Container
   `gitlab-ctl stop` getrennt für `sshd`, `nginx`, `gitlab-workhorse`, `puma` und
   `sidekiq`. Bestätige ihren Stillstand und wiederhole die Vorprüfung, bevor
   Datenbanken gestoppt werden. Ein zwischenzeitlich gestarteter Job bedeutet:
   dieselben GitLab-Dienste/den Proxy wieder aufnehmen und verschieben; Runner
   und Controller bleiben unberührt. Stoppe erst nach diesem abschließenden
   Nachweis von null Jobs den Haupt-Runner-Pool über
   `docker exec system_bootstrapper_1 node /system/operations/dist/lifecycle/entry.js runner-stop /system main`
   und bewahre dabei die Registrierungen. Halte die ursprünglichen Neustartrichtlinien
   von Controller/GitLab privat fest und führe dann
   `docker update --restart=no system_bootstrapper_1 system_gitlab_1` aus, damit
   ein paketbedingter Docker-Neustart diese schreibenden Dienste nicht wiederbelebt
   ([Semantik der Neustartrichtlinien](https://docs.docker.com/engine/containers/start-containers-automatically/)).
   Stoppe den beibehaltenen Controller mit `docker stop --time 30 system_bootstrapper_1`
   und warte, bis ausstehende GitLab-Docker-Exec-Aufrufe abgeschlossen sind.
   Verwende hier nicht den Host-CLI-Befehl `stop`: Er entfernt den Controller,
   statt ihn für diesen Wartungsablauf zu erhalten. Stoppe alle GitLab-Dienste mit `gitlab-ctl stop`, prüfe,
   dass jeder runit-Dienst gestoppt ist, und führe dann
   `docker stop --time 60 system_gitlab_1` aus; verlange Exitcode null und keinen OOM.
5. Installiere nur den geprüften Plan und behalte veränderte Paketkonfigurationsdateien:

   ```bash
   sudo env DEBIAN_FRONTEND=noninteractive apt-get -y --with-new-pkgs --no-remove \
     -o Dpkg::Options::=--force-confold upgrade
   ```

   Prüfe `dpkg --audit` und den Abschluss des Paketmanagers erneut. Bewahre die
   Docker-Abhängigkeit vom eingehängten Volume, SSH-Socket-Überschreibungen und
   Firewall-Richtlinien. Stelle vor einem autorisierten Neustart oder expliziten
   Containerstart genau die aufgezeichneten Neustartrichtlinien wieder her.
   Starte nur neu, wenn die Markierungsdatei existiert. Starte andernfalls die
   beibehaltenen GitLab-/Controller-Container, damit der native Start Runner
   und Routing abgleicht. Behalte bei Fehlern den gestoppten Zustand und die
   Richtlinienbelege für die Wiederherstellung; starte nicht blind neu. Baue
   nichts neu, stelle keinen Seed wieder her, patche keinen Quellcode und ändere
   keine Image-Selektoren. Siehe [APT-Upgrade-Optionen](https://manpages.ubuntu.com/manpages/noble/man8/apt-get.8.html)
   und [stufenweise Ubuntu-Verteilung](https://ubuntu.com/server/docs/explanation/software/about-apt-upgrade-and-phased-updates/).
6. Warte nach einem Neustart auf eine neue SSH-Verbindung mit festgelegter
   Identitätsprüfung und eine geänderte Boot-ID. Verlange den ursprünglichen
   Mount und den automatischen Docker-/Controller-Start. Führe sowohl mit als
   auch ohne Neustart den nativen Prüfer gegen die ursprüngliche Baseline mit
   `--timeout 1200` und der optionalen Tokendatei für einen frischen
   Runner-Kontaktnachweis aus. Prüfe `dpkg --audit`, fehlgeschlagene Units,
   SSH/Firewall und Docker-Bindings separat: Verwaltungsport 2222 bleibt auf
   erlaubte Quellen beschränkt, GitLab-SSH 22 öffentlich, HTTP/HTTPS 80/443
   unverändert und die direkte Registry 5050 auf Loopback. Halte Fehler sowie
   verschobene/stufenweise verteilte Pakete korrekt fest.

Wenn cloud-init während einer Umbenennung keine primäre Schnittstelle findet,
prüfe das Journal, `ip -br link`, Netplans tatsächliche `match`-/`set-name`-Werte
und die udev-Eigenschaften. Korrigiere zuerst eine falsche Netzwerkdefinition.
Prüfe bei einem bestätigten zeitlichen Startkonflikt, dass die installierte Unit
`cloud-init-main.service` ist und systemd `udevadm wait` unterstützt, bevor du
`/etc/systemd/system/cloud-init-main.service.d/10-wait-for-primary-interface.conf` ergänzt:

```ini
[Unit]
Wants=systemd-udev-trigger.service
After=systemd-udev-trigger.service
[Service]
ExecStartPre=/usr/bin/udevadm wait --timeout=30 --initialized=yes /sys/class/net/REPLACE_WITH_CONFIGURED_INTERFACE
```

Ersetze den Schnittstellenselektor durch den in Netplan konfigurierten endgültigen
Namen, lade systemd neu und prüfe den nächsten Start. Dies wartet auf genau dieses
initialisierte Gerät; es fügt kein globales udev-Settle hinzu und rechtfertigt
kein `cloud-init clean` auf einer bestehenden Installation. Siehe
[udevadm wait](https://www.freedesktop.org/software/systemd/man/latest/udevadm.html).

Teste für eine Planung zuerst die Codex-Authentifizierung in einem schreibgeschützten
Durchlauf und die SSH-Verbindung mit festgelegter Identität vom tatsächlichen
Cron-Konto aus. Die private Aufgabendatei sollte auf diesen Abschnitt verweisen
und die Eingaben, Autorisierung und Fehlerrichtlinien bereitstellen. Erstelle ihr
Verzeichnis mit Modus 0700 sowie Eingaben/Berichte mit Modus 0600. Gib jedem
Remote-Durchlauf ein neues Belegverzeichnis und archiviere sein Ergebnis;
`latest.md` ist nur eine Zusammenfassung. Der folgende optionale Eintrag in der
**Crontab des root-Benutzers** läuft sonntags um 03:00 auf einem Host mit
Cron-Zeitzone UTC. Ersetze CLI, Checkout und private Pfade durch deine absoluten
Pfade; prüfe die Zeitzone des Schedulers, statt anzunehmen, dass `TZ` Cron verändert.

```cron
0 3 * * 0 umask 077; /usr/bin/flock -n /private/maintenance/weekly.lock /usr/bin/timeout --kill-after=2m 90m /absolute/path/codex exec -C /path/to/reviewed/checkout --sandbox danger-full-access -c 'approval_policy="never"' --color never -o /private/maintenance/latest.md - < /private/maintenance/task.txt >> /private/maintenance/cron.log 2>&1
```

Dies gewährt ausdrücklich unbeaufsichtigten Shell-/Netzwerkzugriff: Verwende nur
eine vertrauenswürdige Aufgabe, einen vertrauenswürdigen Checkout und Host. Die
Sperre verhindert überlappende Cron-Durchläufe; sie ist keine Plattform-Lease.
Ein Timeout belegt nicht, dass ein entfernter APT-Vorgang gestoppt wurde. Prüfe
seinen Zustand vor der Wiederaufnahme; beende niemals Paketmanager und lösche
keine Sperren, um eine Wiederholung zu erzwingen. Cron startet einen separaten
Agentendurchlauf und speichert lokale Berichte; eine Nachricht in einem bestehenden
Chat ist damit nicht zugesagt. Prüfe Zeit, Exit-Ergebnis und Protokoll jedes
Durchlaufs: Eine alte `latest.md` belegt keinen neuen erfolgreichen Durchlauf.
Siehe die offizielle [Dokumentation zum nicht interaktiven Codex-Modus](https://learn.chatgpt.com/docs/non-interactive-mode).

### Host-Kompatibilität und Container-Protokolle

Verwenden Sie [Container-Kompatibilität und begrenzte Protokolle](HOST_OPERATIONS.md),
bevor Sie MongoDB-Images auswählen oder Kernel-Wartung planen und wenn Sie die
Docker-Protokollaufbewahrung konfigurieren oder prüfen. Der Leitfaden behandelt
Ubuntus Upstream-Kernel-Nachweise, CPU-/Image-Fehlerdiagnosen, Rotation nach Größe
und Dateianzahl, erhaltene Einstellungen und bewusste Neuerstellung.
