# Den importierten Wizard bauen und prüfen

Die Aktivierung verwalteter CI baut und prüft nach der
[Quellcode-Initialisierung](WIZARD_SOURCE.md) einen Kandidaten. Die Build-Aktivierung
bewahrt den laufenden Wizard. Review/Beta verwenden eigene
[manuelle Umgebungsjobs](../project-bootstrap/wizard-environments/README.md);
Production verwendet den abgesicherten [Freigabebefehl des Betreibers](../project-bootstrap/wizard-production/README.md).

## Vorschau und Aktivierung

Das vollständige Vorgehen im Browser findest du unter
[Den Wizard manuell bauen und prüfen](HANDBOOK.md#build-and-check-the-wizard-manually).
Voraussetzungen sind ein vorbereitetes Quellcodepaket im passenden System-Image,
das registrierte verwaltete Projekt, eine verfügbare Projekt-Registry und ein
geprüfter Runner, der das Tag `docker` akzeptiert und Docker-/Buildx- sowie
Registry-Zugriff hat. Prüfe vor dem Start die Reserven an physischem Speicherplatz
und RAM; dieser Ablauf baut Anwendungs- und Browser-Images und sollte auf einem
Host mit begrenzten Ressourcen nicht mit anderen Infrastruktur-Builds konkurrieren.
Ein zusätzlicher Projekt-Runner ist nicht nötig, wenn der gemeinsame Runner
diese Bedingungen bereits erfüllt.

Verwende passende System-/Wizard-Versionen, schließe die Quellcode-Initialisierung
ab und konfiguriere die GitLab-Registry der Plattform. Verbinde dich mit Sync,
rufe das verwaltete Projekt ab und klappe seine Zeile auf. Wähle **Wizard erstellen und prüfen**, um das zugehörige Repository, den importierten Commit und die
Version des verwalteten Rezepts zu prüfen.

Das Öffnen dieser Vorschau ändert weder Repository-Dateien noch Pipelines.
**Build-Pipeline aktivieren** bestätigt ausdrücklich den angezeigten Rezept-Hash.
Der asynchrone Vorgang installiert das separate verwaltete Rezept, bewahrt
Upstream-Veröffentlichungsdateien und startet die aufgezeichnete erste Pipeline
oder nimmt sie wieder auf. Production bleibt unverändert. Eine ausstehende
Vorschau kann sicher geschlossen werden; während der Aktivierungsanfrage ist
das Schließen deaktiviert. **Status aktualisieren** ruft die aufgezeichnete
Pipeline/Prüfungen über denselben Vertrag zur Job-Statusabfrage ab.

## Status und sichere Fortsetzung

| Zustand | Aktion |
| --- | --- |
| Aktivierung reserviert / Rezept installiert | Status aktualisieren oder eine neue Vorschau prüfen und die Aktivierung ausdrücklich fortsetzen. |
| Pipeline läuft | Pipeline prüfen oder Status später aktualisieren. |
| Erforderliche Prüfungen fehlgeschlagen | Fehlgeschlagene Jobs in GitLab prüfen oder wiederholen und dann denselben Vorgang aktualisieren. |
| Kandidat verifiziert | Der Controller hat erforderliche Prüfungen und passende unveränderliche Artefaktnachweise verifiziert; Production ist unverändert. |
| Pipeline-Ergebnis erfordert Abgleich | Nur aktualisieren. Ein Administrator muss vor der Reparatur den dauerhaften Vorgang/Prüfpunkt und GitLab prüfen. Niemals den Prüfpunkt blind löschen. |
| Verifizierung fehlgeschlagen | Frühere Artefaktangaben werden ausgeblendet. Fehler prüfen und aktualisieren; vor einer ausdrücklichen sicheren Fortsetzung eine neue Vorschau prüfen. |

**Aktivierung fortsetzen** wird nach einer neuen Vorschau nur im Zustand
ausstehend, Rezept installiert oder Verifizierung fehlgeschlagen angeboten.
Eine Statusanfrage oder ein Fehler entwertet die vorherige Vorschaubestätigung;
**Vorschau aktualisieren** beschafft eine neue. Eigentums-, Sollinhalts- und
dauerhafte Pipeline-Prüfungen des Servers bleiben maßgeblich. Eine Schaltfläche
umgeht sie nicht. Bei ungewisser Erstellung wird niemals eine zweite blinde
Aktivierung angeboten.

Die Image-Referenz wird nur für `candidate-verified` angezeigt, nicht allein bei
einem erfolgreichen Pipeline-Status oder einem früher zwischengespeicherten
Artefakt. Eine fehlgeschlagene Verifizierung blendet sie sofort aus. Ein normaler
Quellcodeimport darf nicht zur Aktualisierung eines bereits aktivierten
Build-Rezepts verwendet werden.

## Pipeline und Kandidatennachweise prüfen

Verwende im Dialog **Pipeline öffnen**, um den aufgezeichneten Vorgang zu prüfen,
statt eine neue Pipeline über GitLab zu starten. Die verwaltete CI-Konfiguration
ist `.system-bootstrapper/ci.yml`; die bewahrte Upstream-Datei `.gitlab-ci.yml`
wird durch diese Aktion nicht aktiviert.

| Job | Arbeit und Nachweise |
| --- | --- |
| `build:wizard` | Installiert die eingecheckte Lockdatei, führt die gewählten Werkzeugkettenprüfungen aus, veröffentlicht den Kandidaten und speichert Quellcode-Commit, Pipeline-ID und unveränderlichen Registry-Digest in `build-evidence.json`. |
| `test:wizard` | Lädt dieses unveränderliche Image, prüft HTTP sowie Browserdarstellung/Projekte/SPA-Navigation und speichert die passende Identität in `wizard-evidence.json`; `browser-evidence/` enthält Browserergebnisse und ein Bildschirmfoto. |

Jeder Job hat ein Zeitlimit von 30 Minuten. Die konfigurierte Artefaktaufbewahrung
beträgt sieben Tage. Ein Browser-Bildschirmfoto allein prüft nicht die
Quellcode-/Image-Identität; eine erfolgreiche Image-Veröffentlichung allein belegt
keine bestandenen Browserprüfungen. Beide erforderlichen Jobs und ihre passenden
Artefaktangaben müssen verifiziert sein, bevor der Controller **Geprüftes Kandidaten-Image** anzeigt. Die Referenz verwendet `registry/repository@sha256:…`;
ein veränderliches Tag ist kein gleichwertiger Nachweis.

Aktualisiere den Status nach einer Job-Wiederholung in derselben Pipeline.
Erzeuge nach abgelaufenen Nachweisen oder fehlgeschlagener Verifizierung kein
Ersatzartefakt und lösche keinen Vorgangsprüfpunkt. Prüfe den gemeldeten Fehler
und verwende ausschließlich die abgesicherte Fortsetzung aus einer neuen
Vorschau oder fordere einen Administratorabgleich an. Halte Pipeline-/Commit-/Image-
Identität bei der Aufbewahrung von Abnahmenachweisen fest; halte Konfiguration,
Zugangsdaten und Tokens aus Berichten heraus.

Das Build-Rezept enthält nur Build- und Test-Stufen. Die Installation des separaten
Umgebungsrezepts ergänzt manuelle Review-/Beta-Jobs. Keines der Rezepte aktiviert
einen Production-Deployment-Job; die Production-Freigabe erfordert einen
expliziten Betreiberplan und eine Bestätigung.

## Controller-API

Alle Routen erfordern die bestehende Sync-Bearer-Authentifizierung:

| Route | Vertrag |
| --- | --- |
| `GET /projects/wizard/build` | Schreibgeschützte Repository-/Quellcode-/Rezeptvorschau und gespeicherter Build-Zustand. |
| `POST /projects/wizard/build` | Ausdrückliche Aktivierung mit `{recipeHash}`; liefert einen asynchronen Job. |
| `GET /projects/wizard/build/status` | Sichere asynchrone Aktualisierung oder `not-activated`, ohne eine Pipeline zu erzeugen. |
| `GET /projects/jobs/:id` | Bestehender Abfrageendpunkt; der Abschluss liefert `{build,message}`. |

Runner-/Startvorgänge und andere Projektänderungen sind abgesichert. Wiederholte
Anfragen für den eigenen aktiven Build-Vorgang liefern dessen bestehenden Job.
Eine Statusaktualisierung installiert keine Dateien und erzeugt keine Pipelines.

## Werkzeugkettenprofile

Neue Quellcodeimporte mit Vite wählen das Profil `node24-vite8-quickstart-v5`: die
festgelegte Node-24-/npm-Werkzeugkette, Installation per Lockdatei, Lint, Vitest,
TypeScript-/Vite-Build, Konfigurationsexportprüfungen und Playwright-Browserprüfungen.
Browsernachweise enthalten die dargestellte Oberfläche, Projekte, SPA-Navigation,
eine Konfigurations-ZIP und die exakte Cube-Prüfung. Die genau festgelegten Versionen
stehen in `wizard/package.json` und im verwalteten Rezept.

Dieses Profil behält die Bereinigung exakter Tags und das öffentliche CA-Vertrauen
der Build-/Browser-Images aus dem geprüften Mozilla-Paket mit Prüfsumme bei, das mit
dem System-Quellcode geliefert wird. Node verwendet diesen aktualisierten OpenSSL-
Vertrauensspeicher. Die Aktualisierung läuft beim Bauen oder Vorbereiten von Job-Images,
ohne zur Laufzeit ein neues Vertrauenspaket herunterzuladen oder den Vertrauensspeicher
des Hosts zu verändern.

Die Browserprüfungen kontrollieren **So funktioniert’s**, die drei Übersichtskarten,
die Scroll-/Fokusaktion **System Bootstrapper installieren** und den exakten Befehl
zur **Schnellinstallation**. Sie öffnen das integrierte Handbuch, bewahren den ausgewählten
Projekte-Arbeitsbereich beim Wechsel zwischen Übersicht, Docs und Wizard, validieren
Konfigurations-ZIP/Cube und prüfen verschachtelte SPA-Routen sowie direkte
`/configuration`-Routen. Dieses Profil setzt die aktuelle Oberfläche voraus. Bestehende
Overview-v3- und CA-v4-Reservierungen behalten ihre historischen Prüfungen für
**Erste Schritte** / **Wizard öffnen**.

Verwende für einen vorhandenen verwalteten Import das abgesicherte Upgrade nur für
Build/Umgebungen mit `"buildProfile": "node24-vite8-quickstart-v5"` zusammen mit dem
passenden Quellcode. Ein übernommenes quellcodeführendes Projekt verwendet stattdessen
seinen [nativen Quellcode-Merge und die Bindungsaktualisierung](../project-bootstrap/wizard-source-primary/README.md#refresh-an-existing-source-primary-build-recipe).
Jedes frühere Profil behält seinen exakten historischen Hash. Das entsprechende aktuelle
Legacy-Profil ist `legacy-ca-v4`.

Reservierte historische Rezepte bleiben anhand ihres exakten Hashs verifizierbar,
einschließlich älterer Node-13-/CRA-/Jest-Rezepte. Historische Kompatibilität macht
diese veraltete Werkzeugkette nicht für ein neues Projekt geeignet. Ein Upgrade
eines importierten Projekts erfordert die abgesicherte
[Quellcode-/Werkzeugkettenmigration](../project-bootstrap/wizard-upgrade/README.md);
eine Änderung des Controller-Images schreibt keine bestehende Reservierung um.
Ein Upgrade nur für Build/Umgebungen ist verfügbar, wenn der Quellcode bereits
modern ist und lokale Entwicklung erhalten bleiben muss. Eine bestehende
Rezeptreservierung wird durch ein Controller-Upgrade nicht stillschweigend
aktualisiert; verwende die ausdrückliche versionierte Migration, um betroffene
Job-Images neu zu bauen.

## Prüfung

Die isolierten API-, Rezept- und Adapter-Fixtures prüfen ausdrückliche
Bestätigung, Fortsetzung, Fehler-/Statusdarstellung, Eigentum und Änderungsschutz:

```sh
node tests/wizard/build-recipe.js
node tests/wizard/build-workflow.js
ruby tests/gitlab/wizard-build.rb
```

Diese Fixtures kontaktieren das laufende GitLab nicht. Vollständige
Integrationsprüfungen benötigen zusätzlich ein echtes zugehöriges Projekt,
erfolgreiche erforderliche Jobs, passende unveränderliche Registry-Artefakte,
Browsernachweise und die Bereinigung der zu den Jobs gehörenden Ressourcen.
Prüfe vor einer Freigabe die tatsächlichen Pipeline-Ergebnisse; ein
Kandidatenartefakt allein ist kein Production-Rollout. Halte Tokens und private
Konfiguration aus Berichten heraus.
