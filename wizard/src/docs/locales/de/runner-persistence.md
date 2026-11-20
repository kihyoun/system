# Runner-Persistenz

`start.sh` liest das `PERSISTENT_DIR` der Plattform und erzeugt einen Compose-Dienst
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
Verzeichnisse wieder. Auch `stop.sh` behält Registrierung und Daten bei. Führe
`unregister.sh` nur ausdrücklich aus, wenn die Registrierung bewusst entfernt
werden soll. Die erzeugte Compose-Datei ist vorübergehend; ihre Pfade sind
deterministisch und werden bei jedem Aufruf neu aufgebaut.

Wenn du diese Skripte innerhalb des Bootstrappers aufrufst, binde das
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

Führe die Lebenszyklus-Regression auch im gebauten Controller-Image aus, da sich
seine BusyBox-Werkzeuge von denen des Debian-Komponententest-Images unterscheiden.
Setze `BOOTSTRAPPER_IMAGE` auf genau das Controller-Image, das du gebaut hast:

```sh
docker run --rm --network none --read-only --tmpfs /tmp:exec \
  -v "$PWD:/work:ro" -w /work --entrypoint node \
  "$BOOTSTRAPPER_IMAGE" tests/gitlab-runner/persistence.js
```

Dies verwendet das tatsächliche `mktemp` der Laufzeit, ohne Docker-Zugriff oder
aktiven Zustand.
