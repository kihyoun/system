# System Bootstrapper-Handbuch

Wählen Sie den vollständigen Installationsweg für Ihre Umgebung:

- [Schnellinstallation](QUICKSTART.md): ein Befehl auf einem frischen unterstützten Ubuntu-Host,
  anschließend Konfiguration im Browser.

- [Lokales Ubuntu / WSL2 mit HTTP](#0-getting-started): Erproben Sie die Plattform auf Ihrem
  eigenen Rechner, ohne öffentliches DNS oder Zertifikat.
- [Öffentlicher Ubuntu-Server mit Ihrer Domain und HTTPS](#public-server-own-domain-and-https):
  Bereiten Sie DNS vor, stellen Sie Zertifikate mit Certbot aus und konfigurieren Sie die Dienste.
- [Ersatzhost aus einem externen Seed](RECOVERY_CONTRACT.md#restore-an-external-seed-into-a-fresh-local-installation):
  Stellen Sie ein abgeschlossenes Backup in neuem lokalem Arbeitsdatenspeicher wieder her.
- [Ersatzhost mit einem erhaltenen Datenvolume](#replace-a-host-while-retaining-its-data-volume):
  Verwenden Sie eine bestehende Installation weiter, statt sie erneut zu initialisieren.
- [Gemessene Installations- und Wiederherstellungszeiten](#measured-installation-and-recovery-times):
  Beobachtete Dauer, jeweiliger Prüfumfang und eine wiederholbare Messmethode.
- [Ein laufendes System weiterentwickeln](#5-evolving-a-running-system): Nutzen Sie eine Generation,
  um einen geprüften Nachfolger zu bauen und zu testen, und geben Sie ihn mit einem Wiederherstellungsweg frei.
