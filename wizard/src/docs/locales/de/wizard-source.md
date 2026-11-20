# Das Wizard-Repository aus festgelegtem Quellcode initialisieren

Dies ist der bisherige Ablauf für verwalteten Quellcode. Ein ausdrücklich
übernommenes [quellcodeführendes Repository](../project-bootstrap/wizard-source-primary/README.md)
entwickelt direkt über eigene Merge Requests und importiert keinen Quellcode.
Allgemeine `.system-bootstrapper/build-v1/`-Erzeuger, die ein solches Repository
eingecheckt hat, werden aus bisherigen Quellcode-Schnappschüssen ausgeschlossen:
Die Aktivierung des verwalteten Builds installiert ihr eigenes geprüftes Rezept
in diesem reservierten Namensraum.

Das registrierte Wizard-Projekt repräsentiert die bestehende Oberfläche. Die
Quellcode-Initialisierung ist ein eigener, ausdrücklicher Vorgang; automatische
Registrierung, Start, Abrufen und Konfigurations-Übertragen importieren niemals
Anwendungsquellcode.

## Die Aktion verwenden

1. Führe zueinander passende System- und Wizard-Versionen aus, schließe die
   Standardregistrierung des Wizards ab, verbinde dich mit Sync und rufe die Projektliste ab.
2. Klappe das verwaltete Wizard-Projekt auf und wähle **Wizard-Quellcode initialisieren**.
3. Prüfe **Repository**, **Quellcoderevision** und **Dateien** in der Vorschau.
4. Wähle **Quellcode importieren**. Der authentifizierte asynchrone Vorgang meldet
   den Abschluss oder einen behebbaren Konflikt. Nach einer unterbrochenen Anfrage
   ermöglichen Schließen und erneutes Öffnen des Dialogs eine Wiederholung.

Akzeptiert wird nur das private Repository, das die Registrierung dieser Instanz
erstellt hat. Eigentumsmarkierung, Identität, Standardbranch und deaktivierte
verwaltete CI müssen übereinstimmen. Neue Quellcodepfade und eine Herkunftsmarkierung
werden atomar mit `[skip ci]` eingecheckt. Bestehende Pfade werden niemals
überschrieben. Eine Wiederholung prüft übereinstimmende Inhalte, Ausführbarkeitsmodi
und Import-Commit-Nachweise, bevor Erfolg gemeldet wird. Eine Änderung durch einen
Maintainer erfordert eine Prüfung statt eines destruktiven Zurücksetzens.

Die README des Grundgerüsts bleibt unverändert. Die ursprüngliche Quellcode-README
wird unter `.system-bootstrapper/SOURCE_README.md` abgelegt. Die ursprüngliche
Upstream-Datei `.gitlab-ci.yml` bleibt bytegetreu erhalten, aber der CI-Pfad von
GitLab zeigt weiter auf die deaktivierte `.system-bootstrapper/ci.yml`. Es wird
keine Pipeline gestartet. Der bekannte sichere Wert `SKIP_PREFLIGHT_CHECK=true`
wird separat unter `.system-bootstrapper/preflight.env` bereitgestellt; lokale
Dotenv-Dateien sind ausgeschlossen.

Die laufende Oberfläche, das Routing und die Production-URL bleiben unverändert.
Beta und Review bleiben deaktiviert. Die Quellcode-Initialisierung startet keine
Builds oder Deployments; die [Aktivierung des verwalteten Builds](WIZARD_BUILD.md)
ist eine eigene ausdrückliche Aktion. Review-/Beta-Deployment und
[Production-Freigabe](../project-bootstrap/wizard-production/README.md) sind
separate ausdrückliche Vorgänge. Ein Quellcodeimport gibt kein Image frei.

## Das unveränderliche Quellcodepaket bauen

Initialisiere vor dem Bau des System-Images das festgelegte Wizard-Submodul:

```sh
git submodule update --init wizard
bash project-bootstrap/wizard-source/prepare.sh
```

Das normale oberste `start.sh` ruft die Vorbereitung auf, bevor Compose das
System-Image baut. Manuelle System-Image-Builds müssen zuerst denselben Befehl
ausführen. Der Image-Build prüft das erzeugte Manifest und die Datei-Hashes;
er schlägt fehl, wenn die Vorbereitung ausgelassen wurde. Checke die erzeugte
`snapshot.json` nicht ein.

Die Vorbereitung liest Git-Objekte am Wizard-Gitlink, der im HEAD des Systems
eingecheckt ist. Veränderte Checkout-Dateien, unversionierte Dateien und ein
anderer ausgecheckter Wizard-Branch können den Schnappschuss nicht ändern.
Sie bewahrt Binärbytes und Ausführbarkeitsmodi, lehnt Symlinks und verschachtelte
Submodule ab und schließt Dotenv-Dateien, übliche Zugangsdaten-Dateinamen, Seeds,
Abhängigkeitsverzeichnisse und Build-Ausgaben aus. Prüfe eingecheckten
Anwendungsquellcode wie üblich; Dateinamenfilter sind kein Geheimnisscanner für
beliebigen Quellcode.

Node auf dem Host ist optional. Ist es nicht verfügbar, baut die Vorbereitung
das geprüfte Laufzeitrezept `bootstrapper` als `system-bootstrapper-source-tools:local`
und führt dessen Node-/Git-Werkzeuge mit deaktiviertem Netzwerk und schreibgeschützten
Quellcode-/Git-Objekt-Mounts aus. Bei verknüpften Git-Worktrees müssen die referenzierten
Metadatenverzeichnisse zugänglich bleiben. Im Paketierungscontainer wird kein
Docker-Socket eingebunden.

## Zustand und Wiederaufnahme

Die bestehende private Wizard-Projektkonfiguration enthält den versionierten
Beleg `wizardWorkflow`: Vorgang, Quellcode-Revision, Manifest-Hash, Phase,
Import-Commit und sichere Fehlermeldung. Registrierung und Repository-Identität
bleiben erhalten. Die bestehende Erhaltung serverseitig verwalteter Projekte
trägt den vollständigen Beleg über Übertragen und Neustart hinweg weiter. Eine
Wiederholung prüft nach einer verlorenen Antwort das Repository, statt einen
weiteren Import-Commit auszulösen. Quellcode-Revision-Upgrades nach einem
reservierten Import erfordern einen separaten geprüften Vorgang.

Wenn der Quellcode-Schnappschuss fehlt, bereite ihn vor und baue das passende
System-Image erneut. Prüfe bei Eigentums-, Pfad- oder CI-Konflikten zuerst das
Repository und die lokale Registrierung. Lösche/erstelle kein Repository neu
und setze keine Zugangsdaten zurück, um die Initialisierung durchzusetzen.

## Isolierte Prüfung

Führe nach dem Kompilieren von Sync und Erzeugen des Schnappschusses aus:

```sh
node tests/wizard/source-package.js
node tests/wizard/source-workflow.js
ruby tests/wizard/source-import.rb
```

Der Pakettest erstellt entbehrliche Git-Repositories. Der Ablauftest verwendet
eine temporäre private Konfiguration und einen simulierten Rails-Transport.
Der Ruby-Adaptertest verwendet eine GitLab-API-Fixture im Arbeitsspeicher. Diese
Tests kontaktieren niemals das laufende GitLab und verändern die Plattform nicht.
Führe die Wizard-Prüfungen mit den in `wizard/package.json` deklarierten
Node-/npm-Versionen aus: `npm ci`, `npm run lint`, `npm test`, `npm run build`
und `npm run test:config-export`. Das verwaltete Build-Rezept wählt das passende
Quellcode-Werkzeugkettenprofil; historische Reservierungen behalten ihre exakten
Rezept-Hashes.
