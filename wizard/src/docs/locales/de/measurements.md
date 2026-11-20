## Gemessene Installations- und Wiederherstellungszeiten

Zwei betreute Durchläufe am **7. November 2026** verwendeten Ubuntu **26.04.1 AMD64**,
**8 vCPUs**, etwa **32 GB RAM** und ein **225-GB-Systemlaufwerk** je
Host. Beide nutzten GitLab **19.5.3**, **vier Runner-Manager** und die System-Quellcode-
version `c12a00cebe27b5d7601052448480c12494b95c19` mit ihrem festgelegten Wizard-
Submodul. Live-Dienstdaten verwendeten `PERSISTENCE_MODE=local` auf dem Systemlaufwerk.

| Szenario | Erster SSH-Befehl (UTC) | Geprüft betriebsbereit (UTC) | Dauer |
| --- | --- | --- | --- |
| Neuinstallation ohne Seed oder externes Laufwerk | 18:39:13.884 | 18:50:12.231 | **10 min 58 s** (658.347 s) |
| Externer Seed in neuen lokalen Arbeitsdatenspeicher wiederhergestellt | 18:57:12.746 | 19:13:35.166 | **16 min 22 s** (982.420 s) |

Die Neuinstallation übernahm nur Domain- und Runner-Anzahl-Einstellungen. Sie hatte keine
vorherige Datenbank, Dienstdaten, Projekte oder alten Instanz-Zugangsdaten. Vertrauenswürdige
Zertifikate wurden neu ausgestellt. Der vollständige Controller und der passende Wizard wurden
aus getesteten öffentlichen Release-Images geladen, ohne sie auf dem Host zu bauen.

Die Wiederherstellung kopierte und prüfte etwa **3,1 GB Seed-Nutzdaten** in leeren
internen Arbeitsdatenspeicher unter Verwendung der passenden, separat gespeicherten Wizard-
Konfiguration. Der Seed enthielt GitLab-Datenbanken, Repositorys, Registry,
Geheimnisse und Zertifikats-/Erneuerungszustand. Der gespeicherte Controller-Selektor wurde
bewusst auf das freigegebene öffentliche Release geändert; andere Einstellungen und
Zugangsdaten blieben erhalten. Der exakte aufbewahrte private Wizard und ein optionales
historisches CI-Helfer-Image wurden aus der wiederhergestellten Registry bezogen. Separate
Image-Archive oder Host-Builds dieser Images wurden nicht verwendet. Der Backup-Speicher wurde
vor dem Plattformstart ausgehängt.

Dies sind drei unterschiedliche Speicherabläufe:

- **Neuinitialisierung:** Neuen Dienstzustand im lokalen Arbeitsdatenspeicher erstellen;
  weder Seed noch externes Medium sind erforderlich.
- **Seed-Wiederherstellung:** Ein abgeschlossenes Backup prüfen und in neuen Arbeitsdatenspeicher
  kopieren, dann aus dieser lokalen Kopie arbeiten. Normalbetrieb, Konfigurations-
  änderungen und Zertifikatserneuerung benötigen kein angeschlossenes Backup-Medium.
- **Wiederverwendung eines erhaltenen Live-Volumes:** Das bestehende Live-Dateisystem einbinden und
  weiterverwenden, ohne einen Seed zu kopieren. Dieser separate Ersatzhostweg wurde
  in diesen Durchläufen **nicht gemessen**.

Harvest/Seed verwendet separat ausgewählten Backup-Speicher für Dienstdaten. Wizard-
Öffnen/Sichern und Sync-Übertragen/Abrufen verwalten Konfiguration unabhängig davon; ein Seed
ersetzt das passende Konfigurationsbackup nicht. Siehe [Speicheranleitung](PERSISTENT_VOLUME.md)
und [Wiederherstellungsvertrag](RECOVERY_CONTRACT.md).

### Messgrenzen und Betriebsbereitschaft

Die Uhr lief vom ersten SSH-Befehl bis zum erklärten Bereitschaftspunkt mit
UTC-Zeitstempeln und verstrichenen Sekunden. Vor der Messung verfügte jeder Durchlauf bereits über eine
bereitgestellte VM, deren Adresse und DNS, SSH-Berechtigung, Internetzugang und die
Konfigurationsparameter des Betreibers. Die Wiederherstellung hatte zusätzlich einen angeschlossenen abgeschlossenen
Seed und das passende Konfigurationsbackup. VM-Bereitstellung, DNS-Verteilung und
SSH-Schlüsselbereitstellung waren ausgeschlossen.

Die erfassten Arbeiten umfassten Host-Voraussetzungen und Docker-Installation, Checkout und
Submoduleinrichtung, Image-Downloads, Konfiguration, Dienststart, Zertifikats-
integration und Erneuerungsprüfung. Vorbereitung durch den Betreiber während des Durchlaufs,
Wartezeiten und wiederholte Prüfaufrufe blieben in der Messung: Beim neuen Aufbau wurde eine anfängliche Prüfung des kürzlichen Runner-
Kontakts wiederholt, bei der Wiederherstellung eine Metadatenprüfung.
Dies waren betreute Verfahren, keine Messungen eines unbeaufsichtigten
Installationsprogramms.

Die Bereitschaft der Neuinstallation verlangte vertrauenswürdige öffentliche Antworten von Wizard, GitLab und Registry,
authentifiziertes Sync im Leerlauf, abgeschlossene Zertifikatserneuerungseinrichtung mit erfolgreichem
Trockenlauf und die Bestätigung aller vier aktuellen Runner-Manager als online in GitLab.
Die Wiederherstellung verlangte zusätzlich Prüfungen des erhaltenen Zustands, exakte Wiederherstellung des historischen CI-Helfers
und Widerruf temporärer Registry-Zugangsdaten. Öffentliche Routen und
authentifiziertes Sync waren in diesem Durchlauf bereits nach etwa **13 min 20 s** erfolgreich geprüft;
die zusätzlichen Wiederherstellungsprüfungen endeten nach **16 min 22 s**. Historische
Runner-Manager-Einträge allein zählten nicht als aktuelle Manager.

Prüfungen nach dem Bereitschaftspunkt einschließlich späterer Image-/Speicher- und abschließender Bereinigungs-
prüfungen lagen außerhalb dieser Zeitspannen. Keiner der Durchläufe startete eine zusätzliche vollständige
Systemtest-Pipeline. Der damalige Bereitschaftsumfang bestätigte keine Weiterleitungen kanonischer
Wizard-Aliasse; nehmen Sie diese ausdrücklich auf, wenn Ihre
Bereitstellung sie benötigt. Diese Beobachtungen belegen nicht, dass jede Anwendung oder CI-Arbeitslast
getestet wurde.

Die beiden Durchläufe erledigten unterschiedliche Arbeiten und Prüfungen und sind daher weder ein kontrollierter
A/B-Benchmark noch ein direkter Leistungsvergleich. Host-Leistung, Netzwerk- und
Image-Caches, Registry-Verfügbarkeit, Zertifikatsausstellung, Betreiberinteraktion,
Datenmenge und gewählte Abnahmeprüfungen beeinflussen die Dauer. Diese Werte
sind Beobachtungen, keine Garantie für Installationszeiten.

### Messung mit eigenen Parametern wiederholen

1. Erfassen Sie Host-Betriebssystem/Architektur, CPU, RAM, Laufwerk und Speichermodus, freigegebenen
   Quellcode und Image-Digests, GitLab-Version und gewünschte Anzahl an Runner-Managern.
   Stellen Sie eigene Domains, DNS, SSH-Zugriff, Firewall-Regeln und private
   Konfiguration bereit. Erfassen Sie zur Wiederherstellung außerdem Nutzdatengröße
   und Identität des abgeschlossenen Seeds und prüfen Sie, ob dessen separates Konfigurationsbackup passt.
   Wählen Sie ein leeres Live-Ziel; überschreiben Sie niemals eine laufende Installation, um
   eine Neuinstallation zu messen.
2. Legen Sie die erforderlichen Prüfungen vor Beginn fest. Erfassen Sie auf einem Administrationsrechner
   UTC und starten Sie unmittelbar vor dem ersten SSH-
   Befehl eine monotone Stoppuhr. Lassen Sie sie während Betreibereingaben, Wartezeiten und Wiederholungen laufen, einschließlich
   Fehlern, die innerhalb des Versuchs behoben werden. Erfassen Sie UTC
   und verstrichene Zeit jedes Meilensteins privat; setzen Sie die Uhr nach einer fehlgeschlagenen Prüfung nicht zurück.
3. Folgen Sie bei einer Neuinitialisierung der [öffentlichen HTTPS-Anleitung](#public-server-own-domain-and-https)
   mit `bootstrapper/install.sh`, `bootstrapper/install-release.py` und
   `bootstrapper/install-volume-host.sh` aus dem geprüften Release-Checkout.
   Verwenden Sie die unveränderlichen Controller- und passenden Wizard-Image-Auswahlen des Releases.
   Konfigurieren Sie über Wizard-Abrufen, Sichern und Übertragen; stellen Sie vier Manager ein, wenn Sie
   die Anzahl dieses Durchlaufs nachbilden. Schließen Sie die erste Zertifikatsausstellung und die
   dokumentierte Webroot-Erneuerungs-/Deploy-Hook-Prüfung mit `system-certbot` ab.
4. Folgen Sie zur Wiederherstellung der [externen Seed-Wiederherstellung](RECOVERY_CONTRACT.md#restore-an-external-seed-into-a-fresh-local-installation),
   einschließlich nativer Speichervorbereitung und
   `bootstrapper/seed-operation.sh restore --check-only` vor der tatsächlichen
   Wiederherstellung mit passendem Konfigurationsbackup. Lassen Sie GitLab gestoppt, bis
   die Wiederherstellungsprüfung endet. Hängen Sie nach Abschluss des Helfers das
   Backup-Medium vor dem Start aus, um die Speichertrennung dieses Durchlaufs nachzubilden.
   Installieren Sie die Host-Zertifikatsintegration und starten Sie über `start.sh`. Die
   [native Wiederherstellung des privaten Wizards](RECOVERY_CONTRACT.md#pulling-a-restored-private-wizard-image)
   erhält dessen gespeicherten Digest und bereinigt den begrenzten temporären Registry-Zugriff.
5. Prüfen Sie öffentliche Wizard-, GitLab- und Registry-Zugriffe mit vertrauenswürdigem TLS, authentifizierten
   Sync-Abrufen und Leerlaufstatus, Zertifikatserneuerung/-bereitstellung sowie den Online-Status jedes aktuellen
   Managers in GitLab. Die Anleitung enthält Routing- und Erneuerungs-
   befehle; die [Runner-Einrichtung](#2-setting-up-gitlab-runners) erklärt den gemeinsamen Pool
   und die Manager-Identitäten. Prüfen Sie bei einer Wiederherstellung auch erhaltene Repositorys,
   Registry-Inhalt und die erwarteten gespeicherten Einstellungen. Legen Sie zusätzliche
   Prüfungen verwalteter Images oder Anwendungen fest und beziehen Sie deren Wiederherstellung sowie die Bereinigung temporärer
   Zugangsdaten in Ihre Bereitschaftsgrenze ein. Bei Abläufen mit der
   [nativen Laufzeitprüfung](../bootstrapper/README.md#reviewed-replacement-host-initialization)
   übergeben Sie deren private API-Token-Datei zur Prüfung kürzlichen Manager-Kontakts und
   `--redirect-from`, wenn ein kanonischer Wizard-Alias erforderlich ist. Eine übersprungene Prüfung
   muss als übersprungen gekennzeichnet bleiben.
6. Erfassen Sie bei der letzten erforderlichen erfolgreichen Prüfung die Bereitschafts-UTC und verstrichenen
   Sekunden und stoppen Sie die Stoppuhr. Erfassen Sie spätere Prüfungen und Bereinigungen getrennt.
   Bewahren Sie Zugangsdaten, Konfigurationsexporte, Rechneradressen und Rohprotokolle in
   privaten Betreiberaufzeichnungen auf. Veröffentlichen Sie nur bereinigten Kontext, Mess-
   grenzen und Ergebnisse. Ein gescheiterter oder unterbrochener Versuch ist ein separates Ergebnis,
   kein ausgelassener Zeitraum in einer erfolgreichen Zeitspanne.
