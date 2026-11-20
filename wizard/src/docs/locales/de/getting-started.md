## Ihre erste Plattform, Schritt für Schritt

Der **Bootstrapper** betreibt Ihre Plattform. Der **Wizard** konfiguriert sie im Browser. **Sync** verbindet beide. Kubernetes-Erfahrung ist nicht erforderlich.

1. [Schnellinstallation](#docs/quickstart) auf einem frischen Ubuntu-24.04-/26.04-LTS-x86_64-Host mit sudo, curl, Internet, mindestens 8 GiB RAM und 40 GiB freiem Speicher. Oder wählen Sie die [manuelle Ubuntu-/WSL2-Installation](#docs/installation) oder den HTTPS-Weg für öffentliche Server.
2. [Verbinden und konfigurieren](#docs/configuration). Öffnen Sie **Wizard**, wählen Sie den Stift neben **Verbinden**, geben Sie Ihre eigene Sync-Adresse und Zugangsdaten ein und anschließend **Übernehmen → Synchronisieren → Abrufen**.
3. Prüfen Sie die Einstellungen, erstellen Sie über **Sichern** eine private Sicherung und führen Sie **Übertragen** aus. Übertragen wendet die Konfiguration an und startet die Dienste automatisch neu.
4. [Runner einrichten](#docs/runners), dann [Ihr erstes Projekt erstellen](#docs/projects). Warten Sie auf dessen Build- und Deployment-Jobs, bevor Sie seine Domain öffnen.

> **Tipp:** Beginnen Sie mit lokalem HTTP, um den Ablauf kennenzulernen. Lesen Sie die vollständige Anleitung für öffentliche Server, bevor Sie Dienste im Internet zugänglich machen.

## Zwei Arten von Backups aufbewahren

**Öffnen / Sichern** und **Abrufen / Übertragen** verwalten Konfiguration einschließlich Geheimnissen. **Harvest / Seed** schützt persistente Dienstdaten. Eine Konfigurations-ZIP enthält keine GitLab-Datenbanken oder Repositorys. Lesen Sie [Wiederherstellung](#docs/recovery), bevor Sie sich auf ein Backup verlassen.

## Ausgangspunkt prüfen

Führen Sie dies in Ihrer Ubuntu-Konsole aus:

```bash
uname -m
git --version
```

Das öffentliche Release ist für `x86_64` / `linux/amd64` vorgesehen. Die Schnellinstallation lädt das getestete Release und startet den ersten Wizard; folgen Sie den geschützten Erstzugriffshinweisen und setzen Sie anschließend im Browser fort. Downloads und Initialisierung benötigen Zeit. Das manuelle Installationskapitel beschreibt Git, Docker, Release-Eingaben und Prüfungen. Vorhandene Installationen und Seed-Wiederherstellung verwenden ihre getrennten dokumentierten Wege.

> **Info:** Beispieldomains und Release-Platzhalter müssen zu Ihrer eigenen Bereitstellung passen. Ein eigenständiger Wizard startet weder Sync noch GitLab oder Runner.
