# GitLab als Primärsystem mit optionalem GitHub-Codespiegel verwenden

Der abgesicherte Sicherungshelfer überträgt einen geschützten
Standardbranch-Commit aus GitLab auf einen ausdrücklich zugeordneten
GitHub-Branch. Die Nutzung ist optional: Das Hinzufügen des Helfers zu einem
Checkout ändert keine Remotes, aktiviert keine Synchronisierung und migriert
keine Projektmetadaten. Wählen Sie ein primäres Repository und integrieren Sie
den Helfer in dessen ausgewählte CI-Konfiguration, bevor Sie ihn aktivieren.

## Rollen für Entwicklung und Aufgabenverfolgung

Wählen Sie die GitLab-Projekte für System und Wizard sowie einen zentralen
Issue-Tracker. Ein Betreiber kann seine Issues im Systemprojekt zusammenhalten
und Wizard-Änderungen im Wizard-Projekt prüfen. Halten Sie die ausgewählten
Identitäten in Agentenanweisungen und externer Projektverfolgung fest; das
Produkt benötigt weder den GitLab-Host noch die Issue-Historie eines bestimmten
Maintainers.

Erstellen Sie nach der Aktivierung Arbeit in diesem GitLab-Tracker, legen Sie
Branches vom vorgesehenen GitLab-Standardbranch an und öffnen Sie den Merge
Request im betroffenen Quellprojekt. Referenzieren Sie projektübergreifende
Issues mit ihrer projektqualifizierten GitLab-Referenz. Führen Sie die
vorgeschriebenen Projektprüfungen aus, prüfen Sie den endgültigen Diff und
mergen Sie dort. Die geschützte Standardbranch-Pipeline überträgt anschließend
diesen exakten gemergten Commit auf den zugeordneten GitHub-Branch. GitHub ist
ein öffentlicher Codespiegel und kein zweites Merge-Ziel. Mitwirkende und
Agenten verwenden denselben Ablauf für Issues, Branches, Prüfung und Merge.

Die Verfügbarkeit von GitHub ist keine Voraussetzung für Quellcodeprüfungen,
Merge-Request-Arbeit oder private Auslieferung. Scheitert der aktivierte
Spiegeljob, bleibt seine Pipeline sichtbar fehlgeschlagen und der Job kann
wiederholt werden. Erforderliche Nachweise für Quellcodeprüfungen und
Auslieferung bleiben unabhängig nutzbar; verbergen Sie den Spiegelfehler nicht
mit `allow_failure` und verlangen Sie keinen Erfolg dieses Jobs, bevor interne
Arbeit fortgesetzt wird. Konfigurieren Sie Merge-Berechtigungen und erforderliche
Quellcodeprüfungen entsprechend.

Ein erfolgreicher Spiegeljob gibt die Produktionsumgebung nicht frei.
Insbesondere bleibt die Wizard-Produktion eine gesonderte bewusste Aktion mit
geprüften Pipeline-, Quellcode- und unveränderlichen Image-Nachweisen. Das
Verlegen der Entwicklung erweitert den vorhandenen Wizard-Ausrollmechanismus
nicht zu einer automatischen Bereitstellung der gesamten Plattform.

## Die Historie vor jeder Aktivierung klären

Zeichnen Sie für System und Wizard jeweils eine ausdrückliche Zuordnung auf:

| Einstellung | Bedeutung |
| --- | --- |
| Quellprojekt | Exakte GitLab-Identität `owner/project` |
| Quellbranch | Geschützter GitLab-Standardbranch des Projekts |
| Sicherungsrepository | Vorhandenes `git@github.com:owner/repository.git` |
| Sicherungsbranch | Explizites Ziel; es muss nicht denselben Namen wie der Quellbranch haben |

Ein über den verwalteten Quellcodeimport initialisierter Wizard beginnt mit
Gerüst-/Import-Commits statt der Upstream-GitHub-Abstammung. Ein solches
Repository kann den bestehenden Upstream-Branch nicht einfach per Fast-Forward
aktualisieren. Prüfen Sie entweder eine Migration nach GitLab unter Erhalt der
Historie oder einen gesonderten Sicherungsbranch mit vereinbartem Ausgangspunkt.
Dieselbe Abstammungsprüfung gilt für jedes Paar aus Quelle und Ziel. Verwenden
Sie kein Force-Push, erzeugen Sie keinen automatischen Merge und wechseln Sie
das Sicherungsziel nicht stillschweigend. Der Helfer verlangt einen vorhandenen
Zielbranch mit kompatibler Abstammung.

### Quellprojekte und verwaltete Auslieferungsprojekte

Besitzt das verwaltete Wizard-Repository eine unabhängige private Historie,
kann ein sauberes primäres Quellprojekt die öffentliche Quellcode-Abstammung
erhalten, während das bestehende verwaltete Repository weiterhin die Anwendung
erstellt und ausliefert. Dies sind getrennte Rollen, auch wenn beide Projekte
im selben GitLab liegen. Halten Sie die verwaltete Auslieferungshistorie privat:
Das Mergen ihrer Vorfahren in einen öffentlichen Quellbranch würde auch diese
Commits veröffentlichen, selbst wenn die resultierenden Dateien identisch
aussehen. Bewahren Sie beim Einrichten des sauberen Quellprojekts das vorhandene
Projekt, Referenzen, Belege, verwaltete Rezepte und
Bereitstellungsgenerations-Untergrenzen auf.

Die Übergabe von Quelle zu Auslieferung ist ausdrücklich und geprüft. Prüfen
Sie für den freigegebenen gemergten `sourceCommit`, dass die erforderlichen
Jobs `build:source` und `test:browser` für diesen exakten SHA erfolgreich
waren. Zeichnen Sie diese Jobidentitäten, den Quell-SHA, die aktuelle
Auslieferungsbasis und den resultierenden `deliveryCommit` in externer
Aufgabenverfolgung oder privaten Betreiberaufzeichnungen auf. Der Gesamterfolg
der Pipeline ist nicht die Quellcode-Schranke: Ein Ausfall des optionalen
GitHub-Spiegels kann die Pipeline fehlgeschlagen lassen, obwohl diese
erforderlichen Jobs erfolgreich waren. Weder ein GitHub-Lesezugriff noch ein
erfolgreicher Spiegeljob ist für den privaten Auslieferungsbuild, dessen Tests
oder die geprüfte Übergabe erforderlich.

Übertragen Sie ausschließlich die geprüften Anwendungsänderungen aus diesem
Quellcommit, prüfen Sie abweichende Zieldateien und verwenden Sie den normalen
Branch-/MR-Prozess des Ziels oder den abgesicherten verwalteten Vorgang.
Ersetzen Sie niemals dessen verwaltete CI, Eigentumsmarkierungen oder Historie
durch einen Neuimport des gesamten Quellbaums, um einen Konflikt zu umgehen.
Prüfen Sie die übertragenen Dateien gegen die ausgewählte Quellcoderevision und
führen Sie Auslieferungsbuild und Browsertests aus. Der Produktionsnachweis
identifiziert den tatsächlichen Auslieferungscommit und Image-Digest; die
Übergabezuordnung verbindet ihn mit dem geprüften Quellcommit. Dieses Verfahren
impliziert weder eine automatische Quelle-zu-Auslieferung-Synchronisierung noch
eine automatische Systembereitstellung.

Halten Sie die öffentliche Upstream-Submodul-URL portabel. Wählen Sie innerhalb
eines GitLab-primären System-Checkouts vor dem Aktualisieren ausdrücklich die
passende private Wizard-Quelle:

```sh
git config submodule.wizard.url '<operator-selected GitLab Wizard clone URL>'
git submodule update --init wizard
```

Verwenden Sie eine authentifizierte Clone-URL ohne eingebettete Zugangsdaten.
`git submodule
sync` ersetzt eine lokale Überschreibung durch `.gitmodules`;
wenden Sie die private Zuordnung daher erneut an, falls eine Synchronisierung
erforderlich ist. In der System-CI deaktiviert `prepare:wizard-source` den
automatischen Submodul-Checkout des Runners mit `GIT_SUBMODULE_STRATEGY: none`.
`gitlab/prepare-wizard-source.js` initialisiert und prüft anschließend den
exakten Gitlink anhand der konfigurierten privaten Auswahl, bevor der Quellcode
gepackt wird. Eine erst nach diesem Vorbereitungsschritt angewandte
Überschreibung käme zu spät. Prüfen Sie, dass das ausgewählte Wizard-Repository
den exakten System-Gitlink enthält. Der Entwicklungs- und Testpfad darf keinen
erfolgreichen GitHub-Lesezugriff benötigen, um fortzufahren.

## Vereinbarung des Helfers

`gitlab/github-backup.sh` läuft in einem Checkout, dessen `origin` auf das
vorgesehene primäre GitLab-Projekt zeigt. Die CI-Integration stellt seine
festgelegte Node-24-Laufzeit, Git, OpenSSH-Client/-Agent und eine POSIX-Shell
mit `mkdir` und `rmdir` bereit. Bewahren Sie die zugehörige
`github-backup-transport.js` neben dem Shell-Helfer auf. Die Konfiguration
kommt aus dem geschützten CI-Job:

| Variable | Erforderlicher Wert |
| --- | --- |
| `GITHUB_BACKUP_ENABLED` | `true`, um den konfigurierten Sicherungsjob ausdrücklich zu aktivieren |
| `GITHUB_BACKUP_SOURCE_PROJECT` | Genehmigter exakter `CI_PROJECT_PATH` |
| `GITHUB_BACKUP_REMOTE` | Genehmigtes GitHub-SSH-Repository ohne Zugangsdaten |
| `GITHUB_BACKUP_BRANCH` | Genehmigter vorhandener Sicherungsbranch |
| `GITHUB_BACKUP_TIMEOUT_SECONDS` | Optionales Zeitlimit je Transport, Ganzzahl 1–300; Standard 30 |
| `GITHUB_SSH_KNOWN_HOSTS` | Geschützte Dateivariable mit unabhängig geprüften GitHub-SSH-Hostschlüsseln |

GitLab liefert `GITLAB_CI`, `CI_PIPELINE_SOURCE`, `CI_PROJECT_PATH`,
`CI_DEFAULT_BRANCH`, `CI_COMMIT_BRANCH`, `CI_COMMIT_REF_PROTECTED` und
`CI_COMMIT_SHA`. Ausschließlich eine geschützte Standardbranch-**Push**-Pipeline
kommt infrage. MR-, API-, manuelle/Web- und Tag-Pipelines replizieren nicht.
Der Checkout muss dem vollständigen festgelegten SHA entsprechen, und dieser
Commit muss weiterhin zum frisch abgerufenen Quell-Standardbranch gehören.
Konfigurieren Sie die Berechtigungen geschützter Branches so, dass nur geprüfte
Merges sie erreichen; ein Shell-Skript kann nicht nachweisen, dass eine Prüfung
stattgefunden hat.

Der Helfer ruft die vollständige Quellabstammung ab und vervollständigt dabei
auch flache CI-Clones. Der Runner benötigt deshalb Lesezugriff auf das
Primärsystem und Schreibzugriff auf die zugeordnete Sicherung. Er verändert
weder `origin` noch Checkout oder lokale Branches. Temporäre Referenzen unter
`refs/system-backup/` werden bei normalem Beenden und Signalen entfernt.
Diese Arbeitsreferenzen sind ersetzbar; auf den Zielbranch wird niemals ein
Force-Push angewandt.

Jeder Aufruf überträgt **denselben gemergten Commit** mit einem normalen Git-Push:

- Ein Ziel hinter dem festgelegten Commit wird ausschließlich per Fast-Forward
  weitergesetzt.
- Ein identisches Ziel ist ein idempotenter Erfolg.
- Ein Ziel, das einen älteren wartenden Commit bereits enthält, ist erfolgreich,
  ohne zurückgesetzt zu werden.
- Ein abweichendes Ziel, ein fehlender Branch oder ein entfernter Quellcommit
  scheitert sichtbar.
- Abgewiesene Pushes und ungewisse Antworten werden erneut abgerufen und
  ausgewertet, mit höchstens drei Push-Versuchen. Wiederholen Sie den CI-Job,
  nachdem ein Zugriffsfehler behoben wurde.

Push deaktiviert ausdrücklich geerbtes `push.followTags`; ausschließlich der
konfigurierte Branch wird übertragen. Jeder Fetch/Push läuft unter der
Node-Transportgrenze mit einem Echtzeitlimit. Unter Unix besitzt er eine
Prozessgruppe, sendet TERM und nach zwei Sekunden KILL, auch wenn der
Gruppenleiter zuerst beendet wurde. Unter Windows adressiert der Offline-Test
mit `taskkill` ausschließlich seine eigene aufgezeichnete Kind-PID bzw. deren
Prozessbaum. Ein Abbruch verwendet dieselbe Prozessbaumbereinigung. Der CI-Job
muss als äußere Sicherheitsgrenze ein endliches Job-Zeitlimit mit
Runner-Prozessbereinigung behalten. Ein Zeitlimitfehler gibt die Checkout-Sperre
frei; ein nicht abfangbares Beenden von Host oder Prozess erfordert weiterhin
die unten beschriebene Prüfung des unterbrochenen Eigentümers.

Eine lokale Checkout-Sperre weist überlappende Aufrufe mit derselben
Git-Objektdatenbank ab. Ein nicht abfangbares Beenden kann diese Sperre
hinterlassen; prüfen Sie den Eigentümer, bevor Sie
`.git/system-github-backup.lock` entfernen (verwenden Sie bei verknüpften
Worktrees das gemeinsame Git-Verzeichnis). **Dies ist keine verteilte Sperre.**
Der CI-Job muss außerdem über alle geeigneten Pipelines hinweg dieselbe
repositorybezogene `resource_group` verwenden. Normale Git-Referenzaktualisierungen
bleiben atomar, auch wenn zwei unabhängige Checkouts konkurrieren. Ein älterer
Job kann nach einem neueren sicher ausgeführt werden. Siehe
[GitLab-Ressourcengruppen](https://docs.gitlab.com/ci/resource_groups/).

Der Helfer unterdrückt Transportausgaben, deaktiviert Shell-Tracing und lokale
Git-Hooks und protokolliert nur feste Ergebnismeldungen. Transportausgaben
werden verworfen, Terminal-/Zugangsdatenmanager-Rückfragen deaktiviert und SSH
verwendet BatchMode mit strenger Hostschlüsselprüfung. Der Job muss geprüfte
`known_hosts` vorab bereitstellen; unbekannte Schlüssel führen zum Fehler
statt zu einer Rückfrage oder Umgehung der Prüfung. Der Kernhelfer liest keine
Variable mit privatem Schlüssel, gibt keine Remote-URL aus und installiert keine
Zugangsdaten. Der CI-Wrapper liest den ausgewählten privaten Schlüssel und
startet einen eigenen temporären SSH-Agenten. Diese Einrichtung muss
geschützte/maskierte Zugangsdaten und geprüfte Hostschlüssel verwenden;
aktivieren Sie kein CI-Debug-Tracing und geben Sie in umgebenden Befehlen keine
Geheimnisse aus. Behalten Sie die vorhandene geschützte Identität
`GITHUB_SSH_PRIVATE_KEY` bei, sofern keine gesonderte Autorisierung vorliegt.

## In die ausgewählte CI-Konfiguration integrieren

Der System-Job `deploy:github` verwendet diesen Helfer nach seinen erforderlichen
Prüfungen. Er ist ausdrücklich optional und verwendet den ausgewählten
Standardbranch, eine unterstützte festgelegte Node-Laufzeit, die geprüfte Datei
`GITHUB_SSH_KNOWN_HOSTS` und die vorhandene geschützte SSH-Identität.
Konfigurieren Sie vor der Aktivierung sämtliche zugeordneten Werte. Der Job wird
durch `github-backup-$CI_PROJECT_ID` serialisiert; sein Fehlschlag bleibt ein
fehlgeschlagenes Pipeline-Ergebnis.

Der System-Job `build` veröffentlicht die eigenständige Laufzeitbasis nach den
erforderlichen Laufzeitprüfungen als `$CI_REGISTRY_IMAGE:$CI_COMMIT_REF_SLUG` in
seiner eigenen GitLab-Registry. Der vollständige Nachfolgecontroller wird
separat vom Kandidaten-Abnahmejob mit unveränderlichem Digest und
Abnahmenachweisen im Repository `/successor` desselben Projekts veröffentlicht.
Folgen Sie dem [Freigabeleitfaden für Nachfolger](../bootstrapper/README.md#promoting-a-tested-successor-controller),
um dieses vollständige Image bereitzustellen. Keine der Veröffentlichungen
benötigt Docker-Hub-Publikationszugangsdaten, aktiviert eine Produktionsfreigabe
oder umgeht die ressourcenintensiven System-Kandidatenprüfungen. Die
GitHub-Spiegelung bleibt unabhängig optional.

Der bisherige verwaltete Wizard wählt `.system-bootstrapper/ci.yml` für
Build/Tests und alle installierten optionalen Umgebungsjobs. Seine aufbewahrte
Upstream-`.gitlab-ci.yml` ist nicht aktiv. Ein primäres Quellrepository verwendet
stattdessen die eingecheckte `.gitlab/primary.yml`. Es führt immer
`build:source` (Installation nach Lockfile, Lint, Unit-Tests, TypeScript,
Produktionsbuild und Konfigurationsexport-Bundle) und `test:browser` gegen
dieses exakte Build-Artefakt mit Playwright Chromium und einer
Loopback-Vorschau aus. Diese beiden Quellcodeprüfungen benötigen keinen Zugriff
auf Host-Docker.

Mit `WIZARD_DELIVERY_ENABLED=true` führt dieselbe Pipeline des primären
Quellrepositorys zusätzlich die erforderlichen Jobs `build:wizard` und
`test:wizard` mit ihrem eingecheckten generischen Build-Rezept aus. Diese Jobs
benötigen einen vertrauenswürdigen Docker-Runner, veröffentlichen das
unveränderliche Image in der Registry desselben Projekts und prüfen genau
dieses Image. Konfigurierte optionale Review-/Beta-Jobs verwenden anschließend
dasselbe Projekt; die Produktionsumgebung bleibt eine gesonderte kontrollierte
Freigabe. Folgen Sie beim Ersetzen eines bestehenden verwalteten
Auslieferungsprojekts dem [Übernahmeleitfaden für ein primäres Quellrepository](../project-bootstrap/wizard-source-primary/README.md).
Löschen Sie das alte Projekt nicht, bevor seine produktiven Abhängigkeiten und
benötigten Wiederherstellungsdaten migriert wurden.

Installationen mit getrennten Quell- und Auslieferungsprojekten können diesen
Schalter ungesetzt lassen. Behalten Sie den verwalteten CI-Pfad und das Rezept
ihres privaten Auslieferungsprojekts unverändert bei. Aktivieren Sie die
aufbewahrte Upstream-Pipeline nicht bloß, um ihre alten Publikationsjobs zu
erhalten.

Nur eine geeignete geschützte Standardbranch-Pipeline erreicht `deploy:github`.
Der Publikationsjob behält seine geschützte Aktivierungsschranke, serialisierte
Ressourcengruppe und sichtbaren Fehlschlag bei. Die Auslieferung eines primären
Quellrepositorys prüft alle erforderlichen nativen Quellcode-/Image-Prüfungen
unabhängig: Ein allein ausstehender, laufender, fehlgeschlagener oder abgebrochener
öffentlicher Spiegel verhindert weder private Umgebungs- noch Produktionsfreigabe.
Quellcode-Merges beachten weiterhin die Schranken des Projekts für erfolgreiche
Pipelines und geklärte Diskussionen.

Verwenden Sie die vorhandene geschützte Identität `GITHUB_SSH_PRIVATE_KEY`;
eine Dateivariable ist vorzuziehen, vorhandene maskierte mehrzeilige Werte
bleiben jedoch unterstützt. Hinterlegen Sie SSH-Hostschlüssel nach unabhängiger
Prüfung in `GITHUB_SSH_KNOWN_HOSTS`, niemals über einen Schlüsselscan zur
Laufzeit. Die System-CI kann mit `WIZARD_PRIMARY_REPOSITORY_URL` ihren exakten
Gitlink aus dem vom Betreiber ausgewählten Wizard-Projekt auf demselben
HTTPS-Ursprung wie `CI_SERVER_URL` mit dem Job-Token abrufen. Autorisieren Sie
das Systemprojekt über GitLabs Job-Token-Berechtigungen zum Lesen dieses
Wizard-Projekts. Die URL ist eine nicht geheime Auswahl und muss auch normalen
MR-Pipelines verfügbar sein; wäre nur diese Variable geschützt, blieben diese
Pipelines beim öffentlichen Rückfall. Das Job-Token bleibt prozesslokal und
Weiterleitungen werden verweigert. Die öffentliche `.gitmodules`-Zuordnung
bleibt für frische öffentliche rekursive Checkouts verfügbar. Vor dem Abrufen
gleicht die Quellauswahl die zwischengespeicherte `remote.origin.url` eines
vorhandenen oder neu initialisierten Wizard-Submoduls mit der gewählten internen
URL ohne Zugangsdaten ab und prüft dann den exakten Gitlink. Ein zuvor
zwischengespeichertes öffentliches Remote kann deshalb die ausgewählte interne
Quelle nicht stillschweigend überschreiben. Das `origin` des
System-Superprojekts bleibt unverändert.

Der Upstream-Wizard besitzt außerdem `deploy:system`, das den System-Gitlink
aktualisiert und einen alten fest codierten GitLab-Host verwendet. Aktivieren
Sie es nicht blind erneut. Die interne Reihenfolge ist Wizard-Merge/Prüfungen
und Verfügbarkeit des exakten Commits im GitLab-Quellprojekt, dann eine bewusste
Aktualisierung des System-Gitlinks und Systemprüfungen im normalen
Prüfverfahren. Die öffentliche Spiegelung hat eine gesonderte
Wiederherstellungsreihenfolge: Stellen Sie sicher, dass der referenzierte
Wizard-Commit auf seinem GitHub-Spiegel vorhanden ist, bevor Sie behaupten,
der Systemspiegel unterstütze einen frischen öffentlichen rekursiven Checkout.
Ein verzögerter öffentlicher Spiegel blockiert weder interne Gitlink-Arbeit
noch private Auslieferung. Es wird weder ein automatischer System-Merge noch
eine Produktionsbereitstellung eingeführt. Produktion bleibt eine bewusste,
vom Betreiber bestätigte [Freigabeaktion](../project-bootstrap/wizard-production/README.md).

### Den Wizard in einem einzigen Systemrelease ausliefern

Eine ausdrücklich ausgewählte Alternative bündelt Oberflächen- und
Systemänderungen in einem System-Merge-Request. Bewahren Sie den geprüften
Wizard-Commit auf einer eigenen Quellreferenz auf, legen Sie diesen exakten
Gitlink im System-MR fest und beziehen Sie seinen vollständigen Vergleich in
die Prüfung ein. Dies setzt den Wizard-Standardbranch nicht weiter und erzeugt
keine nativen Wizard-Pipelinenachweise. Die Systempipeline führt
Quellcode- und Browserprüfungen des Wizards, die vollständige Plattformabnahme
und die Veröffentlichung beider Images gemeinsam aus. Der gemergte
Standardbranch erhält seine eigenen erforderlichen Prüfungen. Für diesen Weg
ist weder eine zwischengeschaltete Systempipeline noch eine zweite
Wizard-Pipeline erforderlich.

Aktivieren Sie für öffentliche rekursive Checkouts zusätzlich zur normalen
GitHub-Spiegelkonfiguration diese weiteren **geschützten** System-CI-Variablen:

| Variable | Wert |
| --- | --- |
| `WIZARD_GITHUB_SOURCE_PUBLISH_ENABLED` | `true`, um die exakte Abhängigkeit vor dem Systemspiegel zu veröffentlichen |
| `WIZARD_GITHUB_BACKUP_REMOTE` | GitHub-SSH-Ziel, das der eingecheckten Wizard-HTTPS-URL aus `.gitmodules` entspricht |
| `WIZARD_GITHUB_SSH_PRIVATE_KEY` | Dateivariable mit einer autorisierten Publikationsidentität für das Wizard-Repository |

Verwenden Sie die autorisierte Publikationsidentität des Wizard-Repositorys;
ein System-Deploy-Key bedeutet keinen Zugriff auf ein anderes Repository.
Die vorhandene unabhängig geprüfte GitHub-Hostschlüsseldatei muss auch für
dieses Ziel gelten. Der Wrapper hält die beiden Identitäten getrennt und
entfernt seine privaten Kopien und den SSH-Agenten beim Beenden.

`gitlab/publish-wizard-source.js` liest den exakten Gitlink aus dem geschützten
System-Standardbranch-Push, beschafft ihn aus der kanonischen Wizard-Quelle
derselben Instanz mit dem Job-Token und veröffentlicht
`system-release/<Wizard commit>`. Eine atomare Nur-Erstellen-Sperre verweigert
das Ändern einer vorhandenen Referenz, auch eines Vorfahren. Ein erneuter
Versuch prüft denselben Commit. Der Helfer ruft diese exakte Referenz anonym
aus dem öffentlichen HTTPS-Repository ab, bevor der normale Systemspiegel läuft.
Keiner der Wizard-Standardbranches wird verändert. Bewahren Sie diese
Quellreferenzen auf, solange ein veröffentlichtes Release oder eine
Wiederherstellungseingabe sie benötigt.

Der Beleg `test-results/github/wizard-source.json` aus derselben Pipeline
zeichnet ausschließlich Quell-, Ziel- und Jobidentitäten auf. Der optionale
[Updater für gepaarte Releases](../bootstrapper/README.md#deliberately-updating-the-accepted-controller-and-wizard-together)
verlangt diesen erfolgreichen Publikationsnachweis, die vollständige
freigegebene Systempipeline und das unveränderte Docker-Hub-Image-Paar-Artefakt.
Sein standardmäßiger Modus nur für den Controller behält die ursprüngliche
Spiegelrichtlinie bei. Die Produktionsfreigabe bleibt bewusst; die
Wizard-Bindung des primären Quellrepositorys und ihre gewöhnlichen nativen
Freigaberegeln bleiben gesondert und unverändert.

## Die ausgewählte Primär-/Sicherungsbeziehung aktivieren

1. Prüfen Sie den tatsächlichen GitLab-Ablauf für Review, erforderliche
   Prüfungen und Bereitstellung auf Ihrer eigenen Infrastruktur, bevor Sie
   seine Rolle ändern.
2. Vereinbaren Sie Zuordnungen und klären Sie die obige Voraussetzung zur
   Historie. Bewahren Sie bisherige Referenzen auf und zeichnen Sie einen
   Kontakt und ein Verfahren für den Rückfall auf. Pausieren Sie konkurrierende
   Schreibvorgänge während des Wechsels; GitHub wird ausschließlich Sicherung
   und kein weiteres Merge-Ziel.
3. Prüfen Sie GitHub Actions, Bereitstellungen, Webhooks und Rückspiegelungen.
   Deaktivieren oder isolieren Sie Reaktionen auf Sicherungs-Pushes **vor** der
   Aktivierung ausdrücklich. Ein byteidentischer Commit kann keine neue
   Skip-Markierung erhalten, ohne seine Identität zu verändern. Prüfen Sie den
   Wizard-zu-System-Job separat, um eine Rückkopplung zu verhindern.
4. Aktualisieren Sie Remotes, Agentenanleitungen und Issue-/MR-Behandlung
   bewusst auf das neue Primärsystem. Übertragen Sie aktive Arbeit mit dem
   folgenden Verfahren; Git-Pushes verschieben keine Issue-Metadaten.
   Issue-Migration ist von diesem Helfer getrennt.
5. Prüfen und aktivieren Sie ausschließlich die vorgesehenen geschützten
   Sicherungsjobs mit autorisierten Zugangsdaten und geprüftem
   Known-Hosts-Material. Führen Sie vor einer ausdrücklich kontrollierten
   Integrationsprüfung die Offline-Regressionen aus.
6. Mergen Sie eine harmlose GitLab-Änderung über den geprüften Ablauf.
   Vergleichen Sie den exakten resultierenden SHA auf GitHub, testen Sie einen
   sichtbaren Fehler mit Wiederholung und prüfen Sie, dass kein Rück-Push und
   keine unbeabsichtigte Bereitstellung stattfanden. Halten Sie den bisherigen
   Ablauf wiederherstellbar, bis eine Wegwerf-Wiederherstellungsprobe bestanden
   ist.

## Aktive Arbeit übertragen, ohne ihren Ursprung zu verlieren

Inventarisieren Sie aktive Issues und Pull Requests, bevor Sie den Tracker
wechseln. Nehmen Sie die ursprüngliche Repository-Identität, Elementtyp/-nummer,
URL, Titel, Beschreibung, Zustand, Labels, Zuständigkeit, Zeitstempel,
relevante Diskussion und Abnahmekriterien auf. Bewahren Sie dieses Inventar,
Zuordnungen alter zu neuen Kennungen und Wechselprüfungen in externer
Aufgabenverfolgung oder privaten Betreiberaufzeichnungen auf, nicht in der
Quellcodedokumentation. Nehmen Sie niemals Tokens, private Protokolle oder
Bereitstellungszugangsdaten in einen Issue-Export auf.

Suchen Sie für jedes aktive Issue vor dem Erstellen eines Ersatzes am Ziel
nach dessen exakter ursprünglicher URL. Nehmen Sie diese URL und die
ursprüngliche Identität in die Beschreibung des neuen Elements auf, erhalten
Sie seine Anforderungen und schreiben Sie kopierte Kommentare ihrem
ursprünglichen Autor und Zeitstempel zu, statt sie als neue Äußerungen des
Importierenden darzustellen. Prüfen Sie den resultierenden Text und die Links.
Zeichnen Sie die Ziel-URL am alten Element auf, bevor Sie es als verschoben
schließen. Wiederholen Sie anhand der aufgezeichneten Zuordnung und
Quellidentität, damit eine unterbrochene Übertragung keine Duplikate erzeugt.

Geschlossene historische Diskussionen dürfen im alten Tracker lesbar bleiben.
Halten Sie diese Entscheidung ausdrücklich fest; ein Git-Quellcodespiegel
migriert diese Historie nicht. Bewahren Sie einen Betreiberexport auf, falls
diese Aufzeichnungen ohne den alten Dienst zugänglich bleiben müssen. Bereits
gemergte Commits und historische Commit-Nachrichten müssen nicht umgeschrieben
werden, um alte Issue-Referenzen zu ersetzen. Neue Diskussionen verwenden den
ausgewählten GitLab-Tracker. Deaktivieren Sie, soweit unterstützt, das Anlegen
neuer Issues und konkurrierende Merge-Wege auf dem Spiegel und veröffentlichen
Sie das neue Ziel für Beiträge extern.

Ein offener Pull Request erfordert, dass Branch, Ziel und Prüfzustand separat
geprüft werden, bevor ein GitLab-Merge-Request neu angelegt wird. Ursprüngliche
Prüfungen sind historischer Kontext und keine neue Freigabe eines geänderten
Diffs. Importieren Sie einen Branch nicht durch Überschreiben verwalteter
Dateien oder Umschreiben der vorhandenen Zielhistorie.

## Den Wechsel auf betreibereigener Infrastruktur prüfen

Verwenden Sie für jedes Quellprojekt eine harmlose Änderung und private
Prüfaufzeichnungen:

1. Erstellen Sie ein GitLab-Issue mit einer eindeutigen Markierung. Legen Sie
   einen Branch und Merge Request mit Verweis darauf an; prüfen Sie beim
   Wizard den projektübergreifenden Link zum zentralen Issue. Prüfen Sie, dass
   Agenten das Issue lesen und den Merge Request einreichen/prüfen können.
2. Belegen Sie, dass eine MR-Pipeline den Codespiegel nicht veröffentlichen und
   eine fehlgeschlagene erforderliche Prüfung die Merge-/Auslieferungsschranke
   nicht passieren kann. Prüfen und mergen Sie den korrigierten Diff über die
   vorgesehenen Berechtigungen des geschützten Branchs.
3. Zeichnen Sie den resultierenden vollständigen GitLab-Commit-SHA auf.
   Bestätigen Sie, dass die geeignete Standardbranch-Pipeline erfolgreich ist
   und GitHub genau diesen Commit enthält, ohne synthetische Merge-Commits,
   Rück-Pushes oder Produktionsänderungen. Vergleichen Sie die endgültige
   Branch-Spitze, wenn keine neueren Merges warten; ältere wartende Jobs dürfen
   ein Ziel nicht zurücksetzen, das ihren Commit bereits enthält.
4. Führen Sie den Spiegeljob erneut aus, um Idempotenz zu belegen. Prüfen Sie
   verweigerten Schreibzugriff in einer isolierten Zuordnung mit eigenen
   Testzugangsdaten, bestätigen Sie den sichtbaren Fehler, stellen Sie den
   Zugriff wieder her und wiederholen Sie. Beschädigen Sie für diesen Test
   niemals einen gemeinsam verwendeten Produktionsschlüssel und erzeugen Sie
   keine abweichende Historie auf dem öffentlichen Branch.
5. Prüfen Sie bei System den GitLab-primären Checkout mit seiner internen
   Submodulzuordnung. Bestätigen Sie, dass erforderliche Arbeit und private
   Wizard-Auslieferung bei nicht verfügbarem GitHub laufen können; verwenden
   Sie exakte erfolgreiche Nachweise erforderlicher Jobs statt des gesamten
   Pipeline-Erfolgs. Der aktivierte Spiegeljob bleibt bis zur Wiederholung
   sichtbar fehlgeschlagen. Prüfen Sie nach Spiegelung des referenzierten
   Wizard-Commits einen frischen öffentlichen rekursiven Checkout separat,
   bevor Sie den öffentlichen Systemspiegel als wiederherstellungsbereit
   melden.
6. Erfassen Sie einen abgeschlossenen Harvest und passenden Konfigurationsexport
   nach der bestehenden Wiederherstellungsvereinbarung. Prüfen Sie in einer
   Wegwerf-Wiederherstellung Testbenutzer, Repository-Spitze,
   Issue-Beschreibungsmarkierung, Entwurfs-MR-/Diskussionsmetadaten und eine
   verschlüsselte CI-Einstellung und führen Sie anschließend einen Runner-Job
   aus. Lassen Sie Spiegel-Schreibvorgänge der Wiederherstellung deaktiviert,
   bis wiederhergestellter Zustand und Zuordnungen geprüft wurden.

Das eingecheckte Kaltwiederherstellungsszenario erstellt zusätzlich zu Benutzer,
Repository-/Issue-Identität, verschlüsselter CI-Variable und Registry-Daten
einen Quellbranch und Entwurfs-MR mit Diskussion und Antwort. Es prüft nach der
Wiederherstellung den exakten Quellcommit, MR-Identität, Titel, Beschreibung,
Zustand, Autor und Erstellungszeit sowie Identitäten, Texte, Autoren,
Zeitstempel und Klärungszustand beider Notizen. Die Issue-Prüfung vergleicht
die Beschreibungsmarkierung, nicht Titel oder Zustand. Der MR bleibt offen mit
leeren Merge-Commit-/Zeitfeldern; dies ist also kein Nachweis der
Wiederherstellung eines bereits gemergten MR. Der Test lässt den
Standardbranch unverändert. Ein erfolgreicher Offline-Vertragstest allein
belegt weder eine erfolgreiche tatsächliche Kaltwiederherstellung noch einen
produktiven Wechsel oder eine erfolgreiche Produktionsausrollung; führen Sie
das [Wegwerf-Wiederherstellungsszenario](../tests/e2e/README.md) mit ausreichend
Kapazität aus.

## Abdeckung und Grenzen der Wiederherstellung

Der Helfer sichert einen konfigurierten Branch und erreichbare Git-Objekte.
Er spiegelt keine Tags, anderen Branches, Löschungen, Git-LFS-Nutzdaten oder
Submodul-Repositories; definieren Sie diese Richtlinien ausdrücklich, bevor
Sie eine umfassendere Abdeckung behaupten. Er sichert keine Issues, MRs,
Diskussionen, Benutzer, CI-Geheimnisse, Registry-Images, Artefakte oder
Dienstkonfiguration.

Das vorhandene [persistente Volume](PERSISTENT_VOLUME.md) und die
[kalte Harvest-/Seed-Wiederherstellung](RECOVERY_CONTRACT.md) der Plattform
behandeln Dienstzustand getrennt von diesem Codespiegel. GitLabs aufbewahrte
Bäume `config` und `data` enthalten seine Konfiguration/Geheimnisse,
Datenbank, Repositories und lokale Registry-/Artefaktdaten. Issues,
MR-Diskussionen, Benutzer und CI-Einstellungen hängen von diesem GitLab-Zustand
ab, nicht nur von Git-Commits. Harvest erfasst diese Bäume bei sauber gestopptem
GitLab; der gesonderte Wizard-Konfigurationsexport liefert die
Bootstrapper-Einstellungen. Ein aufbewahrtes produktives Volume kann auch ohne
Anwenden eines älteren Seeds weiterverwendet werden.

Die Wahl von GitLab als Primärsystem erfordert keinen zweiten Sicherungsdienst.
Gleichen Sie jeden vom Betreiber konfigurierten externen Objektspeicher mit der
tatsächlichen lokalen Abdeckung des Seeds ab. Schützen Sie Geheimnisse und
bewahren Sie die passende Version/Edition und Image-Identität auf, die die
Wiederherstellungsvereinbarung verlangt. Prüfen Sie die
[Sicherungsabdeckung](https://docs.gitlab.com/administration/backup_restore/backup_gitlab/)
und [Wiederherstellungsvoraussetzungen](https://docs.gitlab.com/administration/backup_restore/restore_gitlab/)
der Installation und proben Sie auf einem isolierten Wegwerfsystem. Der Helfer
zur Branch-Übertragung führt weder Harvest/Seed noch native
GitLab-Sicherungs-/Wiederherstellungsvorgänge aus.

## Offline-Regressionsprüfungen

Führen Sie `node tests/gitlab/github-backup.js` aus, wo Git und eine POSIX-`sh`
verfügbar sind. Setzen Sie unter Windows `GITHUB_BACKUP_TEST_SHELL` auf
`usr/bin/sh.exe` von Git for Windows. Der Test erstellt und entfernt
ausschließlich seine eigenen temporären lokalen Repositories.
`GITHUB_BACKUP_OFFLINE_FIXTURE=1` erlaubt ein vorhandenes absolutes lokales
Bare-Ziel statt GitHub-SSH; dies gilt ausschließlich für diese Offline-Tests,
niemals für Produktions-CI. Der Test prüft die Übertragung exakter SHAs,
Wiederholungen, Commits außerhalb ihrer Reihenfolge, Eignungsschranken,
Divergenz, fehlende Historie, Sperrkonflikte, konkurrierende Checkouts,
geerbte Tag-Konfiguration, hängende Transportnachkommen, Abbruch und die
Unterdrückung geheimer Ausgaben. Er kontaktiert niemals einen Remote-Dienst.
