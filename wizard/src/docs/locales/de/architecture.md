# Architektur, Ursprung und Weiterentwicklung

System Bootstrapper entstand 2019 aus dem Wunsch seines Autors, Webprojekte auf
einer bezahlbaren selbst gehosteten Plattform zu entwickeln, ohne deren Dienste
immer wieder zusammenzustellen. Architektur und Grundprinzipien entstanden vor
KI-Programmieragenten. KI kann die Entwicklung unterstützen; sie hat die
Architektur nicht hervorgebracht.

**Der Quellcode ist die DNA; die laufende Infrastruktur ist eine rekonstruierbare
Instanz davon.** Infrastrukturdefinitionen lassen sich aus Quellcode reproduzieren.
Für den Wiederaufbau einer Installation werden auch gespeicherte Konfiguration,
Geheimnisse und persistente Dienstdaten einschließlich Datenbanken und Repositorys benötigt.

Die Plattform verbindet GitLab Community Edition, dessen Container-Registry,
GitLab-Runner-Manager, NGINX-Routing, eine authentifizierte Sync-API und einen
React-Konfigurations-Wizard. Shell-Skripte und Docker Compose koordinieren ihren Lebenszyklus.

## Interne Sync-API

Sync verwendet NestJS mit dem Express-Adapter. Fachliche Module trennen
Authentifizierung, Konfiguration, Projektabläufe, Betriebsaufgaben und Diagnose;
ein gemeinsames Laufzeitmodul stellt den Vorgangsstatus und die bestehende
Speichersperre bereit. Controller bearbeiten HTTP-Anfragen, und injizierte Dienste
koordinieren die Werkzeuge des Repositorys.

Die öffentliche API auf Port `8071`, Konfigurations- und Seed-Formate sowie
Betriebsabläufe bleiben kompatibel. Es kommen weder eine Datenbank noch ein
separater Deployment-Dienst hinzu. Anwendungsvorlagen bleiben Angular-, React-
und allgemeine Webprojekte; NestJS wird im internen Sync-Dienst verwendet.
Die [Testanleitung](../tests/README.md) beschreibt die isolierten Prüfbefehle.

## Wegweiser für den Betrieb

Anwendungsvorlagen behalten unabhängige Repositorys und Review-, Beta- sowie
Production-Umgebungen. Die [Projektanleitung](PROJECT_BOOTSTRAP_GUIDE.md) beschreibt
Erstellung, bearbeitbaren Quellcode und CI. System und Wizard teilen dagegen das
System-Repository und seine Kandidatenpipeline. Der Wizard ist ein reguläres
Quellverzeichnis; seine ursprüngliche Repositoryhistorie bleibt über den Importmerge
erreichbar. Neue Commits enthalten keinen separaten Wizard-Gitlink.

Die optionale [System-Kandidaten-Beta](SYSTEM_CANDIDATE_REVIEW.md) verwendet das
exakte Wizard-Image eines bereits geprüften System-Kandidaten unter einer festen
HTTPS-Adresse. Die Einrichtung wählt ein bestehendes gemeinsames Projekt und
reserviert nur Konfiguration. Sie erzeugt weder einen zusätzlichen Build noch eine
weitere vollständige Plattformpipeline. Production-Freigabe bleibt getrennt und
bewusst. Normale Projekt-Review-Apps bleiben unterstützt; neue System-Review-Bindungen
und -Deployments entfallen. Bestehende System-Review-Ressourcen benötigen vor der
expliziten Beta-Migration ihren ursprünglichen eigenen Stop und die Bereinigung.

Historische Quellbelege, JSON-/ZIP-Konfiguration, Bindungen, Generationsuntergrenzen,
Tombstones und passende Seeds bleiben gültige Wiederherstellungseingaben. Bewahre
ihren aufgezeichneten Aufbau und ihre Identitäten. Deute einen alten Wizard-Commit
niemals als gemeinsamen Quellbaum um und importiere nicht über Benutzeränderungen.
Die [Quellanleitung](WIZARD_SOURCE.md) beschreibt beide Aufbauten. GitLab kann die
Entwicklungsplattform mit optionalem [GitHub-Quellcodespiegel](GITLAB_GITHUB_BACKUP.md)
bleiben; gespiegelter Quellcode allein sichert keine GitLab-Dienstdaten.

Der wegwerfbare Beta-Abnahmetest führt Einrichtung, Bindung, Containerlebenszyklus,
TLS und Bereinigung tatsächlich aus. Die Kandidatenautorisierung verwendet
explizite Vertragsfixtures, solange die übergeordnete Pipeline läuft. Sie behauptet
keine abgeschlossene native Autorisierungspipeline; siehe die
[Verifikationsgrenze](../tests/e2e/GUIDED_PREVIEW_ACCEPTANCE.md).

Persistente Dienstdaten liegen unter `PERSISTENT_DIR`, normalerweise
`/var/lib/system-bootstrapper/platform` auf der Ubuntu-/WSL-Systemplatte. Eine zweite
Platte oder ein Backupmedium ist für Start und Betrieb nicht erforderlich. Ein explizit
volumegebundener Live-Aufbau bleibt unterstützt und fällt bei fehlendem Volume nicht
auf anderen Speicher zurück. Der Wizard exportiert die Konfiguration getrennt;
[Harvest/Seed](RECOVERY_CONTRACT.md) erstellt und restauriert vollständige Dienstdaten-
Schnappschüsse auf unabhängig ausgewähltem Backupspeicher. Das Löschen der VM löscht
ihre lokalen Arbeitsdaten: Bewahren Sie vor dem Vertrauen auf Wiederherstellung einen
vollständigen externen Seed und passende Konfiguration auf. Ein erhaltenes Live-
Dateisystem lässt sich auch ohne Seed-Wiederherstellung weiterverwenden.

Am 7. November 2026 benötigte eine frische öffentliche Release-Installation ohne Seed
**10 min 58 s**, die Wiederherstellung eines externen Seeds in frischen lokalen
Arbeitsspeicher **16 min 22 s**. Diese beobachteten, betreiberbegleiteten Zeiten haben
unterschiedliche Prüfumfänge; sie sind weder Zeitgarantie noch direkter Leistungsvergleich.
[Messkontext und wiederholbares Verfahren](HANDBOOK.md#measured-installation-and-recovery-times)
erläutern Hardware, Voraussetzungen und Zeitgrenzen.

[Komponenten- und Integrationsprüfungen](../tests/README.md) liegen im Repository.
Die Kandidaten-Testumgebung betreibt kurzlebige Plattforminstanzen mit isolierten Ressourcen.
Das [Weiterentwicklungskapitel](HANDBOOK.md#5-evolving-a-running-system) beschreibt
das vollständige Verfahren zur Entwicklung, Prüfung und bewussten Freigabe eines
unterstützten Nachfolgers einschließlich Bestandsmigration und Wiederherstellung.

## Warum dieses Projekt existiert

Eine Entwicklungsplattform erfordert mehr als GitLab zu installieren oder einige Container zu starten. GitLab, Runner, Registry, Anwendungsumgebungen, Netzwerke, Domains und Reverse-Proxys müssen zusammenspielen.

System Bootstrapper beschreibt diesen Aufbau in einem Repository. Docker-Container stellen Dienste bereit; Skripte und Konfiguration verbinden sie zu einer Entwicklungsplattform. Ausgangspunkt ist ein Ubuntu-Host mit den erforderlichen Zugängen und Ressourcen. Das Bootstrapping soll daraus mit möglichst wenig manueller Einrichtung eine nutzbare Umgebung machen.

Die Installation ist jedoch erst der Anfang. Abhängigkeiten ändern sich, Dienste entwickeln sich weiter, und eine funktionierende Umgebung kann schwer aktualisierbar werden. Das zentrale Ziel ist, ihre Erneuerung zu einem normalen, prüfbaren Entwicklungsablauf zu machen.

## Die Plattform mit ihren eigenen Werkzeugen weiterentwickeln

Die laufende Generation **A** stellt die Entwicklungsplattform für Generation
**B** bereit. Dies gilt für die Infrastruktur einschließlich Controller und
unterstützter GitLab-/Runner-Übergänge sowie für den Wizard. Werkzeuge für
Initialisierung, Prüfung, Freigabe und Wiederherstellung liegen im Repository,
damit andere Betreiber denselben Ablauf mit eigener Infrastruktur und eigenen Eingaben nutzen können.

Der Ablauf:

1. **B mit A entwickeln.** Eine Änderung an Plattformquellcode, Image-Pins oder
   Werkzeugen über einen Branch und einen GitLab-Merge-Request vorschlagen.
2. **Den Kandidaten bauen und prüfen.** CI prüft den eingecheckten Quellcode und
   baut das vollständige Kandidaten-Image. Laufzeitänderungen benötigen Komponentenprüfungen
   und einen kurzlebigen, isolierten Plattformtest; reine Dokumentationsänderungen
   nutzen den kurzen Dokumentationspfad.
3. **Den unterstützten Übergang prüfen.** Für ein Upgrade repräsentative vorhandene
   Dienstdaten, erforderliche Migrationen, Runner-/Registry-Verhalten und Wiederherstellung
   prüfen. Der Start eines leeren Kandidaten allein beweist keine Upgrade-Sicherheit.
4. **Prüfen und zusammenführen.** Erforderliche Freigabeprüfungen bleiben aktiv.
   Der zusammengeführte Standardbranch-Stand erhält eigene passende Prüfungen;
   ein Merge ersetzt Production nicht automatisch.
5. **Die akzeptierte Version freigeben.** Das eingecheckte
   [Controller-Freigabewerkzeug](../bootstrapper/README.md#promoting-a-tested-successor-controller)
   und für die deklarierte GitLab-Migration das
   [Upgrade-Verfahren](HANDBOOK.md#migrate-gitlab-through-the-accepted-controller) verwenden.
   Sie binden den Vorgang an akzeptierte Quellcode-/Image-Nachweise und bewahren
   Checkpoints und Wiederherstellungsmaßnahmen.
6. **B auf den nächsten Zyklus vorbereiten.** Laufende Dienste prüfen und
   [passende Wiederherstellungseingaben](HANDBOOK.md#export-bs-matching-recovery-inputs)
   exportieren; akzeptierten Quellcode und Images aufbewahren. B stellt dann die
   Entwicklungsplattform und Werkzeuge für die nächste geprüfte Änderung bereit.

Diese Vorgänge sind bewusst getrennt: Die Controller-Freigabe migriert GitLabs
Datenbank nicht selbst. Ein GitLab-Upgrade mit einem Knoten verursacht Ausfallzeit
und nutzt einen kompatiblen kalten Checkpoint zur Wiederherstellung. Ein anderes
NGINX-Ziel oder das Zurücksetzen eines Images kann keine Datenbankmigration rückgängig
machen. Akzeptierter Checkout, Images, Zugangsdaten und Wiederherstellungseingaben
müssen während GitLabs Ausfall unabhängig vom aktualisierten Dienst zugänglich bleiben.

Das [deklarierte Release-Profil](../gitlab/security-release.json) und seine Tests definieren
die unterstützte Migration. Neue Versionen oder Komponentenänderungen benötigen weiterhin
eigene Abnahmekriterien und erfolgreiche Prüfungen; vorhandene Werkzeuge belegen nicht,
dass jedes mögliche Upgrade sicher ist.

## Vision: automatisierte rekursive Selbstverbesserung

Der nächste Schritt erweitert die entwicklergesteuerte Erneuerung zu einer Rückkopplung,
die Verbesserungen erkennt, Änderungen vorschlägt, anhand expliziter Ziele bewertet
und vom verbesserten System aus wiederholt. Auch die dafür verwendeten Werkzeuge
könnten sich weiterentwickeln. Der Neubau oder Austausch einer Generation allein
beweist keine Verbesserung.

KI-Agenten können Entwicklung und Review im selben Ablauf unterstützen. Die automatische
Auswahl beliebiger Verbesserungen und deren rekursive Freigabe ist keine implementierte
autonome Fähigkeit. Heutige Werkzeuge automatisieren begrenzte Vorgänge; sie wählen weder
eigene Ziele noch erteilen sie sich selbst Production-Freigaben.

Der System Cube hält auch die theoretische Möglichkeit modularer Kommunikation fest.
Die `$`-Öffnung in seiner ASCII-Signatur, aufgegriffen durch Port `8071`, symbolisiert
eine künftige Öffnung zur Außenwelt, um einen Seed einzubringen und mit anderen
Bootstrapper-Instanzen zu kommunizieren. Im beabsichtigten Modell könnte jedes System
eine Schnittstelle zur Umgebung anbieten und weitere kommunizierende Systeme enthalten,
was rekursive Zusammensetzung erlauben würde.

Die aktuelle Sync-API implementiert dieses umfassendere Kommunikationsmodell nicht.
Kommunikation zwischen Bootstrappern und verschachtelte modulare Zusammensetzung müssen
noch spezifiziert und nachgewiesen werden; allein das Lauschen auf Port `8071` begründet
kein solches Protokoll.

## Ein Host, mehrere Plattformgenerationen

Nicht jeder Kandidat benötigt eine eigene VM. Die kurzlebige Plattform-Testumgebung kann auf einem ausreichend ausgestatteten Host neben Production laufen, mit eigenem Docker-Daemon, Containern, Netzwerken und Zustand. Kandidateninstanzen bestehen für den Test und werden danach entfernt; eine dauerhafte zweite Plattform ist nicht erforderlich.

Anwendungs-Review-/Beta-Umgebungen nutzen den zentralen NGINX-Dienst und getrennte
Production-, Beta- und Review-Proxys mit dynamischem Anwendungsrouting über
`VIRTUAL_HOST`. Diese Umgebungen sind von der vollständigen Plattform-Testumgebung
getrennt. Ein erfolgreicher Kandidatentest leitet nicht automatisch einen vollständigen
Nachfolger nach Production; jede unterstützte Freigabe folgt ihrem deklarierten
Migrations- und Wiederherstellungsverfahren.

Ein einzelner Host hält den Infrastrukturbedarf klein, bleibt aber eine gemeinsame Ressource und Fehlerdomäne. Container teilen den Host-Kernel; sie sind keine unabhängigen virtuellen Maschinen. Updates von Ubuntu, Kernel und Docker Engine auf Hostebene benötigen einen eigenen Wartungsweg.

![Historische Plattformarchitektur](../overview.png)

*Historischer Plattformaufbau. Das [Weiterentwicklungskapitel](HANDBOOK.md#5-evolving-a-running-system) beschreibt das aktuell unterstützte Erneuerungs- und Wiederherstellungsverfahren.*

## Was eine erfolgreiche Erneuerung nachweisen muss

Ein Kandidat ist nicht schon bereit, weil seine Container starten. Die [Plattform- und Migrationsprüfungen](HANDBOOK.md#53-validate-existing-state-migration-not-only-first-startup) müssen das durch die Änderung geforderte Verhalten nachweisen:

- GitLab ist erreichbar und kann das Plattformrepository hosten.
- Ein Runner kann eine Pipeline ausführen und ein Image bauen.
- Die Registry kann dieses Image annehmen und bereitstellen.
- Domainrouting erreicht die richtige Umgebung.
- Eine Kandidatenumgebung kann neben Production bestehen und ohne Auswirkungen auf Production entfernt werden.
- Upgrades funktionieren mit repräsentativen Bestandsdaten, nicht nur mit einer leeren Installation.
- Ein fehlgeschlagenes Deployment hat einen geprüften Wiederherstellungsweg.

Containerdefinitionen sind reproduzierbar; GitLab-Repositorys, Datenbanken, Registry-Daten, Konfiguration und Geheimnisse benötigen weiterhin bewusste Persistenz und Schutz. Ein Image-Update allein garantiert keine sichere Migration, und das Zurücksetzen eines Images macht eine Datenbankmigration möglicherweise nicht rückgängig.

## Repository-Wegweiser

| Pfad | Zweck in der vorhandenen Implementierung |
| --- | --- |
| `start.sh`, `stop.sh` | Zentrale Lebenszyklus-Einstiegspunkte. |
| `bootstrapper/` | Basis-Image, Hostinitialisierung, Wiederherstellung, Laufzeitprüfung sowie akzeptierte Controller-Freigabe-/Exportwerkzeuge. |
| `system/` | Zentrale Compose-Definition und Orchestrierungsskripte. |
| `gitlab/` | GitLab-Lebenszyklus/-Konfiguration und unterstützte Upgrade-, Checkpoint- und Rollback-Werkzeuge. |
| `gitlab-runner/` | Runner-Konfiguration, Registrierung und Lebenszyklusskripte. |
| `nginx/` | Konfiguration und Lebenszyklusskripte des zentralen Reverse-Proxys. |
| `nginx-proxy/` | Konfiguration der Production-, Beta- und Review-Proxys. |
| `sync/` | Modulare NestJS-API für Konfiguration, Projektabläufe, Betriebsaufgaben und Diagnose. |
| `wizard/` | Regulärer Wizard-Anwendungscode mit erhaltener ursprünglicher Historie. |
| `.gitlab-ci.yml` | Kurzer Dokumentationspfad; erforderliche Komponenten-, Image- und kurzlebige Plattformprüfungen; Image-Veröffentlichung und optionaler GitHub-Spiegel. |
| [tests/](../tests/README.md) | Komponentenübersicht, isolierte Testbefehle und explizite Grenzen für Live-Integration. |
| [Prepare-Host.md](../Prepare-Host.md) | Hostinstallation, Auswahl von Dienst-Images und Start. |

## Eine Installation bauen und prüfen

Wählen Sie den lokalen oder öffentlichen Installationsweg im [Handbuch](HANDBOOK.md) und folgen Sie
zur Installation der [Hostvorbereitung](../Prepare-Host.md). Wählen Sie Dienstversionen
und konfigurieren Sie persistenten Speicher explizit. Der [Wiederherstellungsvertrag](RECOVERY_CONTRACT.md)
beschreibt Konfiguration-plus-Seed-Wiederherstellung; der
[Persistenzleitfaden](PERSISTENT_VOLUME.md) behandelt die Wiederverwendung erhaltener Live-Daten.

Verwenden Sie kurzlebige Umgebungen für Wiederherstellungs- und Kandidatentests.
Der Bootstrapper bindet den Docker-Socket ein und kann Dienste, Netzwerke, Ports und persistente
Volumes seines Hosts ändern. Führen Sie die dokumentierten [Prüfbefehle](../tests/README.md)
aus und prüfen Sie die Ergebnisse vor einer Image-Freigabe. Hostbetriebssystem-/Kernelwartung
und GitLab-Datenbankupgrades über Hauptversionen haben eigene Verfahren.

## Leitprinzip

**Jede stabile Generation soll die Werkzeuge bereitstellen, um die nächste zu
entwickeln, zu prüfen und auszuliefern.** Ihre eigene Weiterentwicklung folgt dem
überprüfbaren Softwareentwicklungsablauf, den sie ihren Nutzern bereitstellt.
