# Runner-Persistenz

Der vorbereitete native Einstieg `operations/dist/lifecycle/entry.js runner-start CHECKOUT` ruft den gemeinsamen `RunnerLifecycleService` auf.
Dieser liest das `PERSISTENT_DIR` der Plattform und erzeugt einen Compose-Dienst
für jeden Runner-Manager. Manager `runner_docker_1` bindet ein:

- `PERSISTENT_DIR/runners/runner/1/config` nach `/etc/gitlab-runner`;
- `PERSISTENT_DIR/runners/runner/1/home` nach `/home/gitlab-runner`.

Projekt-Pools verwenden stattdessen `runners/<project>_runner/<index>/`. Jeder
Manager behält seine eigene `config.toml`, Runner-System-ID und sein Home-Verzeichnis.
Die im Runner-Image deklarierten Volumes erzeugen deshalb keinen anonymen Speicher.
Skaliere den Vorlagendienst nicht direkt: Seine Bind-Mounts können einzelne Manager
nicht unterscheiden.

Jeder Pool verwendet einen GitLab-Runner-Datensatz und einen Authentifizierungstoken.
Seine Manager haben unterschiedliche System-IDs; GitLab führt sie im Abschnitt
**Runner managers** des Runners statt als separate Runner-Datensätze auf. Die
je Manager gespeicherte Konfiguration hält diese Identitäten über Neustarts stabil.

Anzahlen von null bis 50 werden unterstützt. Beim Verkleinern werden überzählige
Container entfernt, ihre Verzeichnisse aber behalten; Vergrößern verwendet diese
Verzeichnisse wieder. Auch `runner-stop` behält Registrierung und Daten bei. Führe
`runner-unregister` nur ausdrücklich aus, wenn die Registrierung bewusst entfernt
werden soll. Die erzeugte Compose-Datei ist vorübergehend; ihre Pfade sind
deterministisch und werden bei jedem Aufruf neu aufgebaut.

Wenn du diese Befehle innerhalb des Bootstrappers aufrufst, binde das
`PERSISTENT_DIR` des Hosts unter demselben absoluten Pfad im Container ein. Die
Runner-Verzeichnisse werden dort vorbereitet, bevor der Docker-Daemon des Hosts
sie einbindet. Die Plattform muss vor dem Start prüfen, ob das persistente Volume
eingehängt ist. Eine Migration von anonymen Volumes muss die Konfiguration und
das Home-Verzeichnis jedes bestehenden Managers in dessen zugehöriges Verzeichnis
kopieren, bevor sein Container ersetzt wird.

`provision.js` schreibt die Hauptkonfiguration unter `SYSTEM_CONFIG_DIR`, wenn
dies gesetzt ist (der Controller verwendet `/state`). Dadurch bleibt der bisherige
Konfigurations-Symlink beim atomaren Speichern eines neu bereitgestellten
Runner-Tokens erhalten.

Die Registrierung übergibt den Token über Dockers benannte Umgebungsoption; er ist niemals Teil der Prozessargumente. Die Endpunktmigration kopiert eine private Datei mit Modus 600 und benennt sie im verwalteten Runner atomar um. Fehlgeschlagene Kopien erhalten die vorherige Konfiguration. Eine unterbrochene entfernte Kopie/Umbenennung behält ihre eindeutig benannte temporäre Datei und die Wiederherstellungssperre beim Start, bis die Eigentümerschaft geklärt ist.

Führe die Lebenszyklus-Regression auch im gebauten Controller-Image aus, da sich
seine BusyBox-Werkzeuge von denen des Debian-Komponententest-Images unterscheiden.
Setze `BOOTSTRAPPER_IMAGE` auf genau das Controller-Image, das du gebaut hast:

```sh
docker run --rm --network none --read-only --tmpfs /tmp:exec \
  -v "$PWD:/work:ro" -w /work --entrypoint node \
  "$BOOTSTRAPPER_IMAGE" tests/gitlab-runner/persistence.js
```

Dies verwendet das tatsächliche temporäre Dateisystem der Laufzeit ohne Docker-Zugriff
oder aktiven Zustand. Bauen Sie das Operations-Paket vor Ausführung der Kompatibilitätsbefehle.
Die Runner-Einrichtung teilt die dauerhafte Controller-Lease; ein geerbtes Upgrade muss
seine genaue Operationsidentität liefern und der lebende Vorfahr des Runner-Befehls bleiben.

Die native Bereitstellung nutzt die gemeinsame GitLab-Controller-Zugangskennung und die REST-API. Ein bestehender Instanz-Runner wird nur nach Prüfung seiner Richtlinie und einer exakt zugeordneten Manager-Konfiguration samt Token oder eines privat gespeicherten Zugangsnachweises übernommen. Der Nachweis liegt unter `/srv/gitlab/config/system-bootstrapper-auth/runner.json` im GitLab-Konfigurationsvolume, das Harvest/Seed einschließt. Er muss privat bleiben und gehört nicht in ein Konfigurations-ZIP. Bestehende konfigurierte Runner-Tokens bleiben unterstützt. Ein normaler Start setzt einen nicht verfügbaren Token niemals zurück.

Wenn der alte Token nicht wiederhergestellt werden kann, rotiere ausdrücklich die exakte Runner-ID im vorbereiteten Mount-Namensraum des Controllers:

```sh
node operations/dist/lifecycle/entry.js runner-rotate "$PWD" RUNNER_ID ROTATION_OPERATION
```

Ersetze `RUNNER_ID` durch die numerische ID des bestehenden Instanz-Runners und `ROTATION_OPERATION` durch eine neue Operations-ID aus 48 kleingeschriebenen hexadezimalen Zeichen. Bewahre diese ID bis zum Abschluss der Wiederherstellung auf und verwende bei jedem erneuten Versuch **denselben** Wert. Der Controller benötigt seine normalen `PERSISTENT_DIR`-, GitLab-Konfigurations- und `SYSTEM_CONFIG_DIR`-Mounts. Der Befehl teilt die persistente Startsperre und die Runner-Registrierungssperre. Er stoppt die exakt zugeordneten bestehenden Manager-Container des Hauptpools, setzt den Token einmal zurück, aktualisiert den privaten Nachweis, die Manager-Tokens und die Hauptkonfiguration und lässt die Manager gestoppt. Plane den Vorgang für ein Zeitfenster, in dem Jobs unterbrochen werden dürfen. Runner-Datensatz, Konfigurationsfelder und Manager-System-IDs bleiben erhalten; die Manager werden nicht abgemeldet. Starte nach Erfolg über `node operations/dist/lifecycle/entry.js runner-start "$PWD" main` neu.

Eine unterbrochene Anfrage behält ihre exakte Docker-Exec-ID und privaten Antwortdateien. Wiederhole nach einem regulär zurückgegebenen Fehler ohne beibehaltene Startsperre dieselbe Operation. Wenn die Startsperre nach einer Unterbrechung erhalten blieb, verwende:

```sh
node operations/dist/lifecycle/entry.js runner-reconcile "$PWD" STARTUP_OPERATION ROTATION_OPERATION
```

`STARTUP_OPERATION` besteht aus `startup-`, gefolgt von der Operation im privaten Nachweis `SYSTEM_CONFIG_DIR/.storage-operation-lock/startup-owner.json`. Diese Datei enthält Eigentumsmetadaten, keine Zugangsdaten. Verwende für eine unterbrochene erstmalige Runner-Bereitstellung als letztes Argument den wörtlichen Wert `provision` statt einer Rotationsoperation. Der Abgleich prüft das passende Runner-Journal und den exakten Docker-Exec und verlangt anhand von Boot-, PID-Start- und PID-Namensraumidentität den Nachweis, dass der vorherige Eigentümer beendet ist. Er verwendet die bestehende Sperre weiter und löscht keine fremde Speicher-/Upgradesperre. Alte Nachweise ohne Prozessbeleg und Namensraumwechsel innerhalb desselben Boots werden weiterhin abgelehnt. Er stellt die gespeicherte Antwort wieder her, statt einen weiteren Reset auszuführen. Solange eine Operation aussteht, wird eine andere abgelehnt. Endet curl ohne vollständige Antwort oder verschwindet der aufgezeichnete Exec vor der Ergebniswiederherstellung, bricht der Befehl sicher ab und behält den Nachweis. Stelle vor einem erneuten Versuch einen passenden Harvest/Seed-Snapshot wieder her; das Löschen des ausstehenden Journals oder ein blinder weiterer Reset ist keine Wiederherstellung. Widersprüchliche oder unlesbare Manager-Konfiguration wird ebenfalls abgelehnt, statt übernommen oder überschrieben.
