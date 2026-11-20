# Verwalteter Wizard-Build-Kandidat

Der Build-Ablauf aktiviert Prüfungen und ein unveränderliches Registry-
Kandidatenartefakt nach ausdrücklicher Vorschau/Aktivierung. Er bewahrt den
laufenden Production-Wizard; Review-/Beta-Deployment und Production-Freigabe
sind separate Vorgänge. Die Upstream-Wizard-CI und das Dockerfile bleiben neben
verwalteten Dateien verfügbar.

Neue Quellcodeimporte verwenden das zum Quellcode passende versionierte Rezept.
Vite-Schnappschüsse wählen das Node-24-/Vite-Profil. Historische Node-13-/CRA-/
Jest-Rezepte bleiben nur verfügbar, damit bestehende Reservierungen und
Nachweise ihre exakten Hashes behalten. Die Controller-Laufzeit verwendet die
unterstützte Node-24-Werkzeugkette.

`recipe.js` liefert eine deterministische Version/einen Hash, verwaltete CI
und Dateien unter `.system-bootstrapper/build-v1/`. Die verwalteten Dockerfiles
verwenden eigene Kontext-Ausschlussdateien, um Git-Metadaten, Dotenv-
Überschreibungen und private Inhalte auszuschließen. Moderne Prüfungen führen
Lint, Vitest, TypeScript-/Vite-Build und Konfigurationsexport aus. Das Legacy-Profil
liefert CRA nur die bekannte sichere Preflight-Einstellung des Quellcodeimporters
und setzt `CI=true` für Jest. Unabhängige Browserprüfungen kontrollieren die
dargestellte Oberfläche, den Projekte-Tab und die verschachtelte SPA-Route,
blockieren externe Ressourcen und speichern Nachweise.

Jeder CI-Job erstellt seinen eigenen benannten, per Digest festgelegten
BuildKit-Builder und entfernt diesen Builder/Cache sowie seine eigenen
Image-Referenzen beim Beenden. Kandidatencontainer und ihr internes Netzwerk
werden separat benannt und entfernt. Globales Docker-Prune, ein Daemon-Neustart
oder Änderungen an Plattformdiensten gehören nicht zu diesen Prüfungen.
Hartes Beenden kann zugehörige Ressourcen zurücklassen; prüfe vor einer gezielten
Wiederaufnahme die Namen des exakten Jobs und bereinige niemals fremde
Plattformressourcen.

## Aktivierung und Wiederaufnahme

Das Sync-Modul stellt Vorschau-, Aktivierungs- und Statusfunktionen bereit.
Der Server bewahrt den Quellcode-Importbeleg und speichert ein separates
Version-1-Objekt `build`. Es verlangt den exakten angezeigten Rezept-Hash,
abgeschlossene verwaltete Quellcoderegistrierung und eine konfigurierte lokale
Registry. Temporäre GitLab-API-Zugangsdaten bleiben im bestehenden Rails-Adapter
und werden durch dessen äußeren Ensure-Block widerrufen.

Der Adapter prüft Repository-Eigentum, Quellcodemarkierung, Standardbranch und
das erwartete deaktivierte Grundgerüst. Die Rezeptinstallation ist ein
abgesicherter `[skip ci]`-Commit. Sie lehnt belegte/bearbeitete Dateien ab und
prüft vor jedem Pipeline-Start den Elterncommit des installierten Commits,
auch bei unterbrochenen Wiederholungen.

Die Erstellung der ersten Pipeline verwendet eine sitzungsbezogene
PostgreSQL-Advisory-Sperre und eine dauerhafte nicht geheime Projektvariable
namens `SYSTEM_WIZARD_PIPELINE_<operation>` mit Geltungsbereich `*`, die Vorgang
und Aktivierungscommit enthält. Andere Projektvariablen werden niemals geändert.
Die Absicht wird vor dem Senden der Pipeline-Anfrage erstellt. Eine ungewisse
Antwort oder ein Prozessabbruch nach der Absichtserstellung erlaubt bei
Wiederholungen nur das Nachschlagen. Es wird kein zweiter blinder Pipeline-POST gesendet.

Falls die ursprüngliche Pipeline später erscheint, ermittelt Aktualisieren
ihre Identität wieder. Falls keine Pipeline erscheint, meldet der Beleg
`requires-reconciliation`. Dazu gehört auch das bewusste Absturzfenster nach
dem Speichern der Absicht, aber vor dem Senden des POST. Ein Administrator
muss vor jeder ausdrücklichen Reparatur den aufgezeichneten Vorgang, das
Repository und die Pipeline-Historie prüfen. Lösche/setze den Prüfpunkt nicht
allein deshalb zurück, weil eine Aktualisierung keine Pipeline liefert.
Automatische Wiederholungen sind bewusst begrenzt, um bei ungewissem externem
Ausgang die Garantie gegen Duplikate zu bewahren.

Eine Statusaktualisierung installiert niemals Dateien und erstellt keine
Pipeline. Ein Kandidat wird erst verifiziert, wenn SHA/Referenz/Quelle der
aufgezeichneten Pipeline und beide erforderlichen nicht optionalen Jobs
erfolgreich sind und ihre Artefakte bei Quellcode-Commit, Pipeline-Identität und
exaktem SHA-256-Digest der konfigurierten Registry übereinstimmen. Browser- und
Build-Prüfaussagen müssen vorhanden sein. Eine fehlgeschlagene Verifizierung
entfernt veraltete Angaben zu verifizierten Artefakten und behält Vorgangs-/
Pipeline-Identitäten für die Untersuchung bei.

## Prüfbedingungen

Fixtures sind `tests/gitlab/wizard-build.rb`, `tests/wizard/build-recipe.js`
und `tests/wizard/build-workflow.js`; das gemeinsame Testmanifest wählt die
isolierten Prüfungen aus. Frische Installation anhand der Lockdatei, tatsächliche
Prüfungen mit der gewählten Werkzeugkette, Kandidaten-HTTP-/Browserprüfungen
und echte GitLab-/Runner-/Registry-Ausführung sind separate Integrationsbedingungen.
Zwischengespeicherte Build-Abhängigkeiten und Fixtures allein belegen nicht den
vollständigen Ablauf. Bewahre passende Quellcode-/Pipeline-/Image-Nachweise
privat auf und prüfe vor einer Kandidatenfreigabe die native Job-Bereinigung.

## Unterstütztes Wizard-Werkzeugkettenprofil

Das bisherige Rezept `build-v1` bleibt für seine aufgezeichneten Hashes und
historischen GitLab-Nachweise bytegetreu erhalten. Neue Quellcodeimporte,
deren verifizierter Schnappschuss Vite verwendet, wählen die Familie Node 24 /
Vite 8 (`node24-vite8-quickstart-v5` für neue Reservierungen): Node 24.22.0/npm 11.19.1,
Installation anhand der Lockdatei, Lint, Vitest, TypeScript-/Vite-Build und
Playwright-1.64.1-Browserprüfungen. Beide Profile verwenden dieselben begrenzten
Jobnamen und denselben Artefakt-/Digest-Vertrag; moderne Artefakte melden
`unitTests`, `testRunner: vitest`, `lint` und `typecheck`, statt eine Ausführung
von Jest zu behaupten.

Ein reservierter Build wählt immer seinen exakten bekannten Rezept-Hash.
Unbekannte Hashes werden abgelehnt. Review-/Beta-Reservierungen bewahren den
passenden Build-Rezept-Hash; das unveränderliche Hilfsprogramm prüft, dass er
weiterhin zur kanonischen Build-Reservierung passt. Das moderne Profil schreibt
daher keine alten GitLab-Rezepte um und macht aktuelle Deployment-Prüfpunkte
nicht stillschweigend ungültig. Das Quellcode-/Werkzeugketten-Upgrade eines
bestehenden importierten Projekts vor Ort erfordert weiterhin eine separat
geprüfte Migration; ein neuer Schnappschussimport kann das unterstützte Profil
direkt verwenden.

## Exakte Standard-Tag-Bereinigung

Die aufgezeichneten Rezepte `legacy` und `node24-vite8` bleiben für ihre bestehenden
Belege und historischen Nachweise bytegetreu verfügbar. Sie haben eine bekannte
Einschränkung bei der Bereinigung: Ein Browser-Image ohne Tag wird von Docker
als `:latest` aufgezeichnet, und der ältere Bereinigungsvergleich kann dessen
Job-Tag zurücklassen, obwohl Erfolg gemeldet wird.

Aktuelle nicht reservierte Builds verwenden `legacy-ca-v4` oder
`node24-vite8-quickstart-v5`. Diese übernehmen die korrigierte Bereinigungsimplementierung
aus den versionierten Cleanup-v2-Profilen; das moderne Profil übernimmt außerdem
die unten beschriebenen Navigationsprüfungen. Die Bereinigung ergänzt `:latest`
nur, wenn die letzte Komponente des Repository-Pfads kein Tag hat; ein
Registry-Port bleibt erhalten, und ausdrückliche Tags und Digest-Referenzen
werden nicht verändert. Das Entfernen zielt nur auf genau dieses Tag/diese
Referenz, ohne Prune oder erzwungenes Image-Entfernen. Ihre unterschiedlichen
Rezept-Hashes machen die Änderung ausdrücklich.

Die Installation dieses Controllers schreibt weder einen bestehenden kanonischen
Build noch seinen Beleg um. Ein bereits reserviertes Rezept wählt weiter seinen
exakten historischen Hash. Verwende einen passenden Controller/ein Hilfs-Image,
das alte und korrigierte Profile erkennt. Überführe ein aktives kanonisches
Projekt über die abgesicherte [Migration nur für Build/Umgebungen](../wizard-upgrade/README.md#build-and-environment-recipes-without-reimporting-source)
auf ein korrigiertes Profil und prüfe die native Job-Bereinigung. Die Migration
muss aktuelle Quellcodeänderungen, die Quellcode-Importmarkierung, Untergrenzen
gestoppter Umgebungen und andere Konfiguration bewahren. Die vollständige
Quellcode-Importmigration ist keine Abkürzung für eine reine Bereinigungsänderung.

## Kompatibilität mit der Übersichtsnavigation

Das Profil `node24-vite8-overview-v3` behält exakt die moderne Cleanup-v2-
Werkzeugkette, CI, erforderlichen Jobnamen und den Artefaktvertrag bei. Nur sein
Browserskript ändert sich: Wenn die obersten Tabs **Übersicht** / **Wizard**
vorhanden sind, prüft es zunächst die Überschrift **Erste Schritte** und den
ausgewählten Übersicht-Tab und öffnet dann Wizard, bevor es Verbinden, Projekte,
Konfigurations-ZIP-/Cube-Prüfung und die verschachtelte SPA-Ausweichroute prüft.
Es prüft, dass der Wechsel zur Übersicht und zurück den ausgewählten Projekte-Tab
bewahrt und die Aktion **Wizard öffnen** funktioniert. Bildschirmfotos von
Übersicht und Arbeitsbereich bleiben erhalten. Früherer moderner Quellcode ohne
diese Tabs behält seinen direkten Browserpfad zum Arbeitsbereich.

Frühere Profile einschließlich beider Cleanup-v2-Profile bleiben anhand ihrer
exakten reservierten Hashes auswählbar. Ein neuer Controller ersetzt kein
installiertes Rezept und schreibt seinen Beleg nicht um. Führe vor der
Auslieferung von Quellcode, der die standardmäßige Übersicht ergänzt, die
abgesicherte Migration nur für Build/Umgebungen mit einem ausdrücklichen
`buildProfile` von `node24-vite8-overview-v3` oder `node24-vite8-ca-v4` und passendem unveränderlichem Hilfs-Image
aus. Behalte das gewählte Profil in den privaten Betreiberoptionen für eine
spätere Übernahme oder Wiederholung; die Production-Freigabe bleibt ein eigener
bewusster Vorgang.

## Geprüftes öffentliches CA-Vertrauen

Die Rezepte `legacy-ca-v4` und `node24-vite8-ca-v4` ergänzen die verwalteten Dateien
um das geprüfte öffentliche Mozilla-CA-Paket des Repositories und ein per
Prüfsumme verifiziertes Aktualisierungsskript. Build- und Browser-Images
installieren dieses Paket offline; Node verwendet OpenSSL-CA-Vertrauen, sodass
seine eingebettete historische CA-Liste kein entferntes Vertrauen wieder
einführt. Das moderne Profil verwendet außerdem die geprüfte Node-Basis aus
dem erzeugten Rezept. Version und Rezept-Hash binden diese Änderungen an ihre
exakten Eingaben.

Bestehende Reservierungen behalten ihre ursprünglichen Bytes und Nachweise.
Aktualisiere ein bereits verwaltetes Projekt über die abgesicherte Migration
nur für Build/Umgebungen mit einem ausdrücklichen `buildProfile` von
`node24-vite8-ca-v4` und dem akzeptierten unveränderlichen Hilfs-Image; baue und
prüfe danach die Job-Images neu. Ein Controller-Austausch allein aktualisiert
das Rezept eines reservierten Projekts nicht. Diese Aktualisierung gilt für
erzeugte Images und CI-Jobs; sie ist kein Wartungsbefehl für den
Host-Vertrauensspeicher. Prüfe installationsspezifische eigene CAs separat.

## Schnellinstallation und integrierte Docs

Das Profil `node24-vite8-quickstart-v5` übernimmt die exakte CA-v4-Werkzeugkette,
CI-Prüfungen, Bereinigung und öffentlichen Vertrauensdateien. Nur sein Browserskript
ändert sich passend zur aktuellen Oberfläche: **So funktioniert’s**, die drei Übersichtskarten,
die Scroll-/Fokusaktion **System Bootstrapper installieren**, der exakte Befehl zur
**Schnellinstallation** und die integrierte Handbuchnavigation. Es bewahrt die Projekte-
Auswahl beim Wechsel zwischen Übersicht, Docs und Wizard, prüft Konfigurations-ZIP und
exakten Cube sowie die verschachtelte SPA-Ausweichroute und den direkten Einstieg
`/configuration`. Bildschirmfotos von Übersicht, Docs und Wizard bleiben als Browsernachweise verfügbar.

Dieses Profil setzt die aktuelle Quellcodeoberfläche voraus; es interpretiert frühere
reservierte Rezepte nicht neu. Liefere seine verwalteten Dateien zusammen mit dem
passenden Quellcode aus und übernimm dann ausdrücklich
`"buildProfile": "node24-vite8-quickstart-v5"` über den passenden Ablauf für verwaltete
Importe oder quellcodeführende Projekte. Abgesicherte Upgrades lehnen ein Downgrade
dieses Profils auf ältere Browserprüfungen ab.

Um das exakte Smoke-Skript gegen einen isolierten lokalen Build auszuführen, setze
`WIZARD_BASE_URL` auf dessen HTTP-Ursprung und `WIZARD_EVIDENCE_DIR` auf ein privates
Ausgabeverzeichnis. Die Standardwerte im verwalteten Container bleiben `http://wizard-candidate`
und `/evidence`; alle Anfragen außerhalb des gewählten Ursprungs werden blockiert.
