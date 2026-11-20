# Schnellinstallation auf einem frischen Ubuntu-Host

Führen Sie den Befehl auf Ihrem eigenen **frischen Ubuntu-24.04- oder 26.04-LTS-amd64-Host**
mit root/sudo, curl, standardmäßigem Python 3, Internetzugang, **mindestens 8 GiB RAM**,
40 GiB freiem Speicher im System-/Live-Daten-Dateisystem und 1 GiB für Quellcode aus.
Reservieren Sie mehr Platz für Repositorys, Registry-Images, Builds und Backups.
Ports 80 und 443 müssen frei sein. SSH-Zugang oder lokale Konsole müssen verfügbar bleiben.
Die Speichervorprüfung erlaubt auf einem Host mit 8 GiB bis zu 512 MiB vom Kernel
oder der Firmware reservierten Speicher (7,5 GiB gemeldeter Speicher).

```bash
curl -fsSL https://github.com/kihyoun/system/releases/latest/download/quickstart.sh | sudo bash
```

Der Befehl lädt das repositoryeigene Installationsprogramm herunter und führt es als root aus.
Sie können die `quickstart.sh` des Releases vor dem Ausführen prüfen. Das veröffentlichte
Skript ist an sein eigenes Release-Tag gebunden, auch wenn sich `latest` während der
Installation ändert. Es lädt die öffentlichen versionierten Metadaten samt Prüfsumme,
den exakten System-Quellcode/-Baum und festgelegten Wizard-Quellcode sowie anschließend
die passenden öffentlichen Images anhand ihrer Digests. Weder privates GitLab-Konto,
Job-Artefakt, Docker-Hub-Anmeldung noch lokale Versionsliste sind erforderlich.
Öffentliche Registries und GitHub können anonyme Anfragen begrenzen.

Das Installationsprogramm prüft Betriebssystem, Architektur, Berechtigungen, Ressourcen,
Ports und vorhandene Installationspfade, bevor es Hostpakete ändert. Es übergibt die
Abhängigkeiten an `bootstrapper/install.sh` und den Start an `bootstrapper/install-release.py`;
es baut weder Ersatz-Images noch startet es GitLab vor der Browserkonfiguration.
Das native Release-Installationsprogramm prüft erneut unveränderten Quellcode, Image-Labels,
unveränderliche Digests, akzeptierte Image-IDs, denselben Kandidatenversuch und frischen persistenten Zustand.

Paketinstallation, Quellcodedownloads, Image-Downloads und erster Start können jeweils
mehrere Minuten dauern. Netzwerk und Hostressourcen bestimmen die Dauer. Ein Zeitlimit
beim Warten auf Betriebsbereitschaft bewahrt Checkout und Zustand zur Untersuchung.
Entfernen Sie diesen Zustand nicht und wiederholen Sie den Vorgang nicht als Neuinstallation;
folgen Sie der vollständigen Installationsanleitung, um den nativen Vorgang zu prüfen und fortzusetzen.

## Erster Zugriff

Das Installationsprogramm gibt die bereite Wizard-Adresse und lokale Anweisungen zum
Lesen des individuell erzeugten Sync-Benutzernamens/-Passworts aus. Zugangsdaten verbleiben
in der nur für root zugänglichen Datei:

```bash
sudo cat /var/lib/system-bootstrapper/platform/configuration/sync-auth.env
```

Öffnen Sie auf dem Host `http://127.0.0.1/configuration`; die erste Sync-Adresse lautet
`http://127.0.0.1/sync`. Verwenden Sie von einer entfernten Arbeitsstation einen geschützten SSH-Tunnel:

```bash
ssh -N -L 8080:127.0.0.1:80 <your-user>@<your-host>
```

Öffnen Sie anschließend `http://127.0.0.1:8080/configuration` und setzen Sie die Sync-Verbindungsadresse
auf `http://127.0.0.1:8080/sync`. Lesen Sie Zugangsdaten lokal auf dem Host und geben Sie sie
über den Tunnel ein. Das anfängliche HTTP lauscht auf Port 80 des Hosts und bietet kein
öffentliches TLS. Behalten Sie den Administrationszugang und lesen Sie die vollständige
Anleitung für öffentliche Server, bevor Sie konfigurierte Dienste freigeben oder Zugangsdaten
über ein nicht vertrauenswürdiges Netzwerk senden.

Setzen Sie im vorhandenen Wizard fort: Konfigurieren Sie GitLab-/Registry-/Wizard-/Sync-
Adressen und Dienstports, prüfen Sie Speicher und Image-Auswahl und führen Sie dann Push aus.
Die Konfigurationsübertragung startet die konfigurierte Plattform. Wählen Sie einen GitLab-
SSH-Bind-Port, der Ihren administrativen SSH-Dienst verfügbar hält; das Installationsprogramm
schreibt weder SSH- noch Firewallkonfiguration um.

## Vorhandene Installationen und erweiterte Einrichtung

Die Schnellinstallation weist gespeicherte Konfiguration, erhaltenen Live-Zustand,
vorhandene System-Container/-Volumes und einen vorhandenen Checkout unter
`/opt/system-bootstrapper` zurück. Sie verschiebt oder löscht sie niemals. Auch eine
fehlgeschlagene Teilinstallation bleibt erhalten. Nutzen Sie [Hostvorbereitung](../Prepare-Host.md),
[Handbuch](HANDBOOK.md), [Wiederherstellung](RECOVERY_CONTRACT.md) oder
[persistenten Speicher](PERSISTENT_VOLUME.md) für vorhandene Installationen, WSL,
eigene Pfade, DNS/öffentliches HTTPS, Seed-Wiederherstellung, erhaltene Volumes,
Migrationen und erweiterte Hostkonfiguration.

Die Schnellinstallation installiert nach `/opt/system-bootstrapper`, mit gewöhnlichen
lokalen Live-Daten unter `/var/lib/system-bootstrapper/platform`. Der Hostselektor lautet
`/etc/system-bootstrapper/persistence.env`. Sie führt weder automatische DNS-Einrichtung,
Zertifikatsausstellung, Seed-Vorgänge, Datenmigration noch Production-Freigabe aus.
Auch eine öffentliche Release-Veröffentlichung ändert keine vorhandene Plattform.

[Release-Richtlinie und exakter Quellcode-Checkout](RELEASES.md) beschreiben den öffentlichen
Metadatenvertrag, die Installation einer expliziten Version sowie Update-/Rollback-Anforderungen.
