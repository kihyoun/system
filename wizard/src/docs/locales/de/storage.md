# Arbeitsdaten und unabhängige Seed-Sicherungen

Die Plattform unterscheidet zwei Speicherrollen:

| Rolle | Zweck | Verfügbarkeit |
| --- | --- | --- |
| Produktive Arbeitsdaten (`PERSISTENT_DIR`) | GitLab-/Datenbank-/Registry-Daten, Konfiguration, Zertifikate und Runner-Zustand. | Während des Plattformbetriebs erforderlich. |
| Seed-Sicherung (`SEED_DIR`) | Geprüfte Kaltsicherungen, die Harvest erstellt und die bei einer ausdrücklichen Wiederherstellung gelesen werden. | Nur für Harvest oder die Wiederherstellung erforderlich. |

Eine neue Ubuntu-/WSL-Installation verwendet ihre eigene Systemfestplatte für
produktive Daten. Eine externe Festplatte, ein USB-Stick oder ein Cloud-Volume
ist keine Voraussetzung. Ein Seed auf einem getrennten Medium ermöglicht die
Wiederherstellung nach Verlust dieser Systemfestplatte. Die
Konfigurationssicherung bleibt ein gesonderter Wizard-Export; Quellcode und Images
bleiben deklarierte Wiederherstellungseingaben. Ein Seed ist keine laufend
synchronisierte Datenbankkopie.

## Pfade und Auswahldateien

Ohne Speicherauswahl verwendet eine neue Installation:

```sh
PERSISTENCE_MODE=local
PERSISTENT_MOUNT=/
PERSISTENT_DIR=/var/lib/system-bootstrapper/platform
```

Die optionale, root gehörende Datei `/etc/system-bootstrapper/persistence.env`
wählt eine eigene Verzeichnisstruktur. Verwenden Sie unter WSL Linux-Speicher und
kein unter Windows eingehängtes Verzeichnis wie `/mnt/c`. Die lokale Vorprüfung
prüft kanonische Pfade, Berechtigungen, beschreibbaren freien Speicher und das
erforderliche Unix-Dateisystemverhalten. Schützen Sie die Datei mit Modus 0600.

Für produktive Daten auf einem angeschlossenen Dateisystem wählen Sie diesen
Modus ausdrücklich:

```sh
PERSISTENCE_MODE=volume
PERSISTENT_MOUNT=/mnt/bootstrapper-data
PERSISTENT_DIR=/mnt/bootstrapper-data/platform
PERSISTENT_UUID=REPLACE_WITH_EXISTING_FILESYSTEM_UUID
```

Eine vorhandene Auswahldatei mit `PERSISTENT_MOUNT` ohne Modus behält die bisherige
Volume-Vereinbarung bei. Ein fehlendes oder nicht passendes ausgewähltes
Datenvolume stoppt den Start; es gibt keinen Rückfall auf ein neues Verzeichnis
auf der Root-Festplatte. Weder ein Moduswechsel noch das Bearbeiten eines Pfads
migriert vorhandene Daten. Stoppen Sie schreibende Prozesse und erstellen Sie vor
Änderungen der Struktur bewusst eine geprüfte Kopie. Vorhandene
Docker-Volume-Metadaten müssen ebenfalls bewusst abgeglichen werden, wenn sich
ein ausgewähltes Bind-Ziel ändert.

## Sicherungsmedien unabhängig auswählen

Ergänzen Sie das Sicherungsziel bei Bedarf in derselben privaten Auswahldatei:

```sh
SEED_MOUNT=/media/bootstrapper-backup
SEED_DIR=/media/bootstrapper-backup/seed
SEED_UUID=REPLACE_WITH_BACKUP_FILESYSTEM_UUID
```

Hängen Sie dieses vorhandene Dateisystem bewusst ein und erstellen Sie vor
Harvest oder der Wiederherstellung sein Verzeichnis `seed`. `SEED_MOUNT`
verlangt das vorgesehene eingehängte Ziel; eine fehlende Einhängung ist ein Fehler
und keine Erlaubnis, ein ähnlich aussehendes Sicherungsverzeichnis auf der
Root-Festplatte anzulegen. `SEED_UUID` ergänzt eine Identitätsprüfung. Eine
Installation im lokalen Modus benötigt ein ausdrücklich eingehängtes externes
Seed-Ziel auf einem anderen Dateisystem. Dadurch wird verhindert, dass die
einzige Wiederherstellungskopie auf jener VM-Festplatte gesichert wird, die sie
wiederherstellen soll. Bisherige Volume-Installationen dürfen ein getrenntes
Seed-Verzeichnis auf demselben ausdrücklich ausgewählten Datenvolume behalten;
bei Verlust dieses Volumes gehen dennoch beide Kopien verloren.

Die Wurzelverzeichnisse für produktive Daten und Seed müssen kanonisch und
voneinander getrennt sein. Keines darf das andere enthalten. Ausbrechende
symbolische Links, überlappende Wurzelverzeichnisse und unerwartete verschachtelte
Einhängungen werden abgewiesen. Produktive Daten und Seed dürfen auf
unterschiedlichen Dateisystemen liegen. Ihre Speicherprüfungen sind unabhängig:
Ein nicht verfügbares Sicherungsziel darf den normalen Start, den
Docker-Lebenszyklus, das Abrufen/Übertragen von Konfiguration oder die
Zertifikatserneuerung nicht blockieren.

Controller und GitLab behalten keine `/seed`-Einhängungen. Ein ausdrücklicher
Vorgang startet einen vorübergehenden Helfer aus dem exakten Controller-Image,
prüft die Host-Pfade und die Mount-Identität und bindet den Sicherungsspeicher nur
für diesen Vorgang ein. Harvest prüft Ziel und freien Speicher, bevor es GitLab
stoppt. Eine gemeinsame Sperre im produktiven Konfigurationsverzeichnis
serialisiert die Vorgänge auch bei Auswahl eines anderen Sicherungsziels;
eine zweite Sperre schließt die Zertifikatserneuerung aus. Trennen Sie das
Sicherungsmedium erst, wenn Vorgang und Helfer abgeschlossen sind.

## Verzeichnisstruktur der produktiven Daten

Die folgende Struktur ist in beiden Modi relativ zu `PERSISTENT_DIR`:

```text
platform/
├── configuration/        # Main settings, project receipts and Sync auth
├── wizard-public/        # Derived public operator/privacy details only
├── gitlab/
│   ├── config/           # GitLab secrets and service configuration
│   ├── logs/
│   └── data/             # Repositories, database, registry and artifacts
├── ssl/                  # Served certificates and HTTP-01 webroot
├── templates/            # Proxy and managed environment fragments
├── synctemplates/
├── runners/
│   └── <pool>/<index>/
│       ├── config/       # Runner auth and stable manager system ID
│       └── home/
└── host/
    └── letsencrypt/      # Full Certbot account/archive/live/renewal tree
```

Optionale Inhalte in `recovery/` können Image-Archive und ein
Wiederherstellungsmanifest enthalten. Quellcode kann frisch abgerufen werden;
er ist kein erforderlicher produktiver Dienstzustand. Erhalten Sie beim Kopieren
von Dienstdaten numerische Eigentümer, Dateimodi und symbolische Links und
schützen Sie Konfiguration, Zugangsdaten und Zertifikatsschlüssel mit
restriktiven Berechtigungen.

Benannte Compose-Datenvolumes verwenden explizite Bind-Ziele des lokalen
Treibers unterhalb von `PERSISTENT_DIR`; Runner-Manager binden ihre eigenen
Verzeichnisse ein. Prüfen Sie tatsächliche Quellen und Dateisysteme, statt
Volume-Namen zu vertrauen. Der Controller hängt die Konfiguration unter `/state`
ein und verwendet `SYSTEM_CONFIG_DIR=/state`; Kompatibilitätslinks lassen
Shell-Skripte und Sync dieselben gespeicherten Einstellungen und Belege lesen.
Angehängte Einstellungen haben Vorrang vor Dateien, die in ein Image eingebaut
wurden.

Jeder Runner-Manager behält eine eigene System-ID und teilt sich dabei den
GitLab-Runner-Datensatz seines Pools. Beim Herunterskalieren bleiben seine
Verzeichnisse zur Wiederverwendung erhalten. Caches und Arbeitsverzeichnisse
können neu erstellt werden und sind keine Eingaben für die Wiederherstellung
von Konfiguration und Seed.

Der Controller leitet ausschließlich die sechs öffentlichen Website-Einstellungen
nach `wizard-public/privacy-instance.json` ab; der Wizard hängt dieses Verzeichnis
schreibgeschützt ein. Private Konfiguration, Sync-Zugangsdaten und GitLab-Tokens
werden niemals dorthin kopiert. Fehlende öffentliche Einstellungen verwenden
gekennzeichnete Beispiele; gespeicherte leere Werte bleiben leer. Die Datei kann
aus der Konfiguration neu erstellt werden.

## Zertifikate und Hostintegration

Speichern Sie den vollständigen Certbot-Baum unter `host/letsencrypt`:
Kontoschlüssel, `archive`, `live`, Erneuerungskonfiguration und Hooks. Die
symbolischen Links unter `live` allein reichen nicht aus. Installieren Sie
Certbot gesondert und führen Sie anschließend
`sudo bash bootstrapper/install-volume-host.sh` aus dem ausgewählten Checkout
aus. Der aus Kompatibilitätsgründen so benannte Installer behandelt beide Modi
für produktive Daten. Der Volume-Modus behält seine fstab-/Docker-Mount-Abhängigkeit;
der lokale Modus ergänzt keine Voraussetzung für externen Speicher. Keiner der
Modi ergänzt eine Abhängigkeit von entfernbaren Seed-Medien.

Die Hostintegration verbindet `/etc/letsencrypt` mit dem aufbewahrten produktiven
Zustand, installiert den Zertifikats-Deploy-Hook und die Erneuerungssperre und
bindet Webroot-Pfade neu an `PERSISTENT_DIR/ssl/acme-http01`. NGINX stellt dieses
Verzeichnis unter `/ssl/acme-http01` bereit. Widersprüchliche aktive
Certbot-Zustände auf Host und produktivem Speicher müssen abgeglichen werden.
Der Installer aktiviert `certbot.timer`, wenn verfügbar. Sobald NGINX erreichbar
ist:

```sh
sudo system-certbot renew --dry-run
```

Verwenden Sie diesen Wrapper auch für manuelle Erneuerungen. Verändern Sie den
Zertifikatszustand nicht durch unverwaltete Certbot-Prozesse, während Harvest
oder eine Wiederherstellung läuft.

## Einen Host aus einem externen Seed ersetzen

Bewahren Sie einen abgeschlossenen Seed, seine passende gesonderte
Wizard-Konfigurationssicherung und die aufgezeichneten Quellcode-/Image-Eingaben
auf, bevor Sie einen Rechner mit lokalen produktiven Daten löschen. Das Löschen
dieses Rechners löscht die lokalen Arbeitsdaten. Das Anschließen einer älteren
Sicherung macht sie nicht zu einer Momentaufnahme späterer Änderungen.

Folgen Sie auf dem neuen Host der [Wiederherstellung von Konfiguration und Seed](RECOVERY_CONTRACT.md):
Wählen Sie ein frisches lokales Verzeichnis, schließen Sie das Sicherungsziel
an, prüfen Sie den abgeschlossenen Seed und stellen Sie ihn wieder her, bevor
schreibende Prozesse starten. Starten Sie anschließend die Dienste. Die
ursprünglichen produktiven Verzeichnisse sind keine Wiederherstellungseingaben.
Entfernen Sie nach erfolgreicher Wiederherstellung und Prüfung den vorübergehenden
Helfer und trennen Sie das Sicherungsmedium; normaler Betrieb und TLS-Erneuerung
laufen aus den neuen lokalen produktiven Daten weiter.

Ein bereits befülltes Datenvolume aufzubewahren und erneut anzuschließen ist ein
gesonderter Komfortweg, der unten beschrieben wird. Dies belegt keine
Wiederherstellung aus einem externen Seed.

## Eine VM ersetzen und dabei produktive Daten behalten

1. Stoppen Sie schreibende Prozesse sauber, bevor Sie Speicher abtrennen. Behalten
   Sie das Volume beim Löschen der VM ausdrücklich; formatieren Sie es nicht und
   initialisieren Sie kein anderes Dateisystem darüber.
2. Stellen Sie einen kompatiblen Ubuntu-Host bereit, schließen Sie das Volume an
   und hängen Sie sein vorhandenes Dateisystem ein. Laden Sie die vorgesehene
   Systemrevision mit festgelegten Submodulen. Installieren Sie Docker mit
   `sudo bash bootstrapper/install.sh`; installieren Sie Certbot gesondert.
3. Erstellen Sie `/etc/system-bootstrapper/persistence.env` mit
   `PERSISTENCE_MODE=volume` und den aufbewahrten Mount-/Verzeichnis-/UUID-Angaben
   neu. Prüfen Sie Einhängung/UUID und gespeicherte Konfiguration. Führen Sie die
   oben beschriebene Hostintegration aus. Wenden Sie keinen älteren Seed auf die
   aufbewahrten produktiven Daten an.
4. Stellen Sie die exakt erforderlichen Image-Referenzen bereit. Erstellen Sie
   eigene Controller-Images aus dem vorgesehenen Quellcode neu, rufen Sie
   öffentliche Images in den aufgezeichneten Versionen oder Digests ab und
   behalten Sie unveränderliche private Wizard-Festlegungen bei. Optionale
   verwaltete Review-/Beta-Helfer benötigen einen eigenen sauberen Neuaufbau und
   eine ausdrückliche erneute Bereitstellung, falls ihr bisheriges lokales Image
   fehlt; siehe [Leitfaden für verwaltete Umgebungen](../project-bootstrap/wizard-environments/README.md).
5. Führen Sie `sudo bash start.sh` aus diesem Checkout aus. Es prüft den Speicher,
   erstellt den Controller und startet Dienste mit der aufbewahrten
   Konfiguration. Container-IPs, Netzwerke und Proxy-Konfiguration werden neu
   erstellt. Ändern Sie DNS, wenn sich die Host-Adresse geändert hat, und
   behalten Sie dabei die konfigurierten Domainnamen bei.
6. Prüfen Sie Wizard/Sync, GitLab, Registry-Authentifizierung, Runner-Manager und
   TLS-Erneuerung. Gleichen Sie jede aufbewahrte Einhängung und jedes Gerät eines
   benannten Volumes mit dem angeschlossenen Dateisystem ab.

Ein alternativer archivbasierter Weg ist `bootstrapper/recover-volume.sh`.
Er benötigt das vom Betreiber vorbereitete `PERSISTENT_DIR/recovery/images.json`,
die referenzierten gzip-Image-Archive mit SHA-256-Werten, öffentliche
Image-Referenzen und eine aufbewahrte Auswahldatei; diese privaten
Wiederherstellungsartefakte werden nicht durch einen Quellcode-Checkout geliefert.
Setzen Sie `PERSISTENCE_ENV_FILE` auf diese Auswahldatei und rufen Sie das Skript
aus dem vorgesehenen Checkout auf. `--verify` prüft Speicher und
Archivprüfsummen, ohne Dienste zu starten. Ohne diese Option lädt es Archive,
ruft fehlende öffentliche Referenzen ab, installiert die Hostintegration und
startet ohne Neuaufbau. Betrachten Sie ein nicht verfügbares lokales Tag oder
ein nicht deklariertes Archiv niemals als Wiederherstellungsgarantie.

### Die optionalen Image-Archive vorbereiten

Bereiten Sie diese Eingaben bewusst auf einem Host vor, auf dem die vorgesehenen
Images verfügbar sind, bevor Sie sich auf einen archivbasierten Ersatz verlassen.
Erstellen Sie ein privates Verzeichnis `PERSISTENT_DIR/recovery/images/`.
Leiten Sie für jedes eigene Image
`docker image save <recorded-image-reference> | gzip` in eine Datei in diesem
Verzeichnis, prüfen Sie den Erfolg beider Befehle und zeichnen Sie anschließend
die `sha256sum` der komprimierten Datei auf. Behalten Sie das ursprüngliche
Image-Tag im Archiv bei oder versehen Sie das Image vor dem Speichern ausdrücklich
mit dem Selektor, den die gespeicherte Hauptkonfiguration verwendet. Erhalten
Sie bei unveränderlichen Helfer-Image-IDs den exakten ursprünglichen Image-Inhalt.

Schreiben Sie `PERSISTENT_DIR/recovery/images.json` mit diesen beiden Listen.
Ersetzen Sie die Platzhalter durch die tatsächliche Prüfsumme des Archivs und
öffentliche Image-Referenzen:

```json
{
  "archives": [
    {
      "file": "images/controller.tar.gz",
      "sha256": "<64 hexadecimal characters from sha256sum>"
    }
  ],
  "publicImages": [
    {
      "reference": "nginx@sha256:<recorded digest>",
      "tag": "nginx:retained"
    }
  ]
}
```

Nehmen Sie jedes erforderliche eigene Archiv und alle öffentlichen GitLab-,
Runner- und Proxy-Images auf und verwenden Sie Referenzen, die mit der
aufbewahrten Installation kompatibel sind. Jeder öffentliche Eintrag wird bei
Fehlen abgerufen und erhält seinen deklarierten lokalen Alias; das verändert
die gespeicherte Konfiguration nicht. Stellen Sie sicher, dass die ausgewählte
Referenz oder ihr Alias dieser Konfiguration entspricht. Das private
Wizard-Image kann ein exakter Registry-Digest bleiben und während des Starts
aus der aufbewahrten Registry wiederhergestellt werden. Schützen Sie Manifest
und Archive, bewahren Sie eine unabhängige Aufzeichnung ihrer erwarteten
Prüfsummen auf und prüfen Sie sie vor dem Start mit
`recover-volume.sh --verify`. Image-Archive ersetzen weder das produktive
Dateisystem noch die vollständige gespeicherte Konfiguration oder den
Certbot-Zustand.

Bevor Sie produktive Daten bewusst zwischen lokalen und Volume-Strukturen
verschieben, stoppen Sie schreibende Prozesse, kopieren Sie die Daten konsistent
und bewahren Sie eine Rückfallkopie auf. Das Ändern einer Auswahldatei kopiert
oder migriert keine Daten. Erstellen Sie Docker-Volume-Metadaten erst neu,
nachdem Sie deren exakte Identität und Ziel geprüft haben. Löschen Sie keine
unbeteiligten Volumes und führen Sie kein globales Docker-Prune aus.
