#!/usr/bin/env python3
"""Bundle repository guides for the offline Wizard reader. Run with --check in CI.

The Markdown stays byte-for-byte intact in source order. Edit the original guides,
then run python3 docs/export-wizard-docs.py and commit both repositories' changes.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "wizard/src/docs/content.json"


def slug(text):
    return re.sub(r"[^\w\- ]", "", text.lower().replace("`", "")).replace(" ", "-")


def headings(markdown):
    """Find real headings, never shell comments inside fenced examples."""
    fence = None
    offset = 0
    counts = {}
    for line in markdown.splitlines(keepends=True):
        marker = re.match(r"^\s*(`{3,}|~{3,})", line)
        if marker:
            char = marker[1][0]
            fence = None if fence == char else char if fence is None else fence
        if fence is None and (match := re.match(r"^(#{1,6}) (.+?)\s*$", line)):
            anchor = slug(match[2])
            count = counts.get(anchor, 0)
            counts[anchor] = count + 1
            yield (offset, len(match[1]), match[2], anchor + (f"-{count}" if count else ""))
        offset += len(line)


def build():
    chapters = []
    sources = {}
    images = {}

    def add(path, chapter_id, title, group, prerequisite, outcome, start=0, end=None):
        raw = (ROOT / path).read_text()
        sources[path] = hashlib.sha256(raw.encode()).hexdigest()
        markdown = raw[start:end]
        chapters.append(dict(id=chapter_id, title=title, group=group, source=path, sourceStart=start,
                             markdown=markdown, prerequisite=prerequisite, outcome=outcome,
                             headings=[dict(title=h[2], anchor=h[3], level=h[1]) for h in headings(markdown)]))
        for image in re.findall(r"!\[[^\]]*\]\(([^)]+)\)", markdown):
            target = ((ROOT / path).parent / image).resolve()
            if target.is_file() and target.is_relative_to(ROOT):
                key = target.relative_to(ROOT).as_posix()
                mime = "image/png" if target.suffix == ".png" else "image/jpeg"
                images[key] = f"data:{mime};base64," + base64.b64encode(target.read_bytes()).decode()

    chapters.append(dict(id="getting-started", title="0. Getting Started", group="Start here", source="docs/HANDBOOK.md",
        prerequisite="An Ubuntu computer or WSL2 console, sudo access and a tested public release. For a public server, also prepare your domain and DNS.",
        outcome="You know which installation path to follow and how configuration, service data and recovery fit together.",
        headings=[], markdown="""## Your first platform, step by step

The **Bootstrapper** runs your platform. The **Wizard** configures it in your browser. **Sync** connects the two. You do not need Kubernetes experience.

1. [Install the platform](#docs/installation). Use local HTTP on a trusted Ubuntu/WSL2 computer, or choose the public-server HTTPS path.
2. [Connect and configure](#docs/configuration). Open **Wizard**, choose the pencil beside **Connect**, enter your own Sync address and credentials, then **Submit → Synchronize → Fetch**.
3. Review the settings, keep a private **Backup**, then **Push**. Push applies the configuration and restarts services automatically.
4. [Set up a runner](#docs/runners), then [create your first project](#docs/projects). Wait for its build and deployment jobs before opening its domain.

> **Tip:** Start with local HTTP to learn the workflow. Use the full public-server guide before exposing services to the internet.

## Keep two kinds of backup

**Open / Backup** and **Fetch / Push** manage configuration, including secrets. **Harvest / Seed** protects persistent service data. A configuration ZIP does not contain GitLab databases or repositories. See [Recovery](#docs/recovery) before relying on a backup.

## Check your starting point

Run this in your Ubuntu console:

```bash
uname -m
git --version
```

The public release targets `x86_64` / `linux/amd64`. The installation chapter includes Git and Docker preparation, exact release inputs, credential discovery and the expected checks at each stage.

> **Info:** Example domains and release placeholders belong to your own deployment. A standalone Wizard does not start Sync, GitLab or runners.
"""))

    handbook = (ROOT / "docs/HANDBOOK.md").read_text()
    sections = [h for h in headings(handbook) if h[1] <= 2]
    meta = [
        ("installation-paths", "1.1 Choose an installation path", "Installation", "Choose fresh installation, Seed recovery or retained-volume reuse.", "You select the path that matches your host and existing data."),
        ("installation", "1. Installation · local Ubuntu / WSL2", "Installation", "Ubuntu or WSL2, sudo access, internet, enough GitLab resources and accepted release source/image identities.", "The platform starts, Sync connects, saved configuration is verified and GitLab becomes healthy."),
        ("public-installation", "1.2 Public server · domain and HTTPS", "Installation", "A fresh Ubuntu host, sudo/SSH access, DNS control, public ports and accepted release identities.", "HTTPS routes work, credentials are saved and certificate renewal is verified."),
        ("measurements", "1.3 Installation and recovery timings", "Installation", "Your installation inputs and a declared readiness checklist; recovery also needs matching configuration and a Seed.", "You can repeat the documented timing method and distinguish its verification scopes."),
        ("operations", "6. Operations · host maintenance", "Operations", "A trusted administration host, explicit maintenance authority, private SSH inputs, backups and accepted tools.", "The reviewed host maintenance completes with runtime and storage checks, or safely defers while busy."),
        ("recovery", "7. Recovery · retained live volume", "Recovery", "A retained filesystem, matching saved configuration, image/source manifest and accepted host-tools checkout.", "The replacement host reuses the existing data and verifies the original runtime identities."),
        ("configuration", "3. Configuration · main actions", "Configuration", "A running Bootstrapper and your own Sync address and credentials. Fetch before editing saved settings.", "You can distinguish browser edits, configuration transfer, restart and persistent-data recovery."),
        ("runners", "4. GitLab runners", "Projects and runners", "Healthy GitLab 16 or newer, saved configuration and host capacity for the selected runner count.", "The shared runner pool is registered and its individual managers are online in GitLab."),
        ("projects", "5. Projects and environments", "Projects and runners", "Connect and Fetch first; prepare your GitLab namespace, application domains and a suitable runner.", "An editable private project is created and its successful build/deployment reaches the selected environment."),
        ("troubleshooting", "6.1 Troubleshooting", "Operations", "Identify the failing step; retain private logs and configuration and check the selected storage mode.", "You can choose a targeted check without overwriting configuration, data or operation checkpoints."),
        ("evolution", "8. Evolving a running system", "Evolution", "Accepted source, isolated candidate resources, representative existing state, a matching recovery checkpoint and promotion authority.", "A reviewed successor passes migration checks, is deliberately promoted and has verified recovery inputs."),
    ]
    for index, section in enumerate(sections):
        cid, title, group, pre, result = meta[index]
        add("docs/HANDBOOK.md", cid, title, group, pre, result, section[0], sections[index+1][0] if index+1 < len(sections) else None)

    chapters.insert(5, dict(id="foundations", title="2. Foundations", group="Configuration", source="docs/HANDBOOK.md", headings=[],
        prerequisite="Read Getting Started and choose an installation path.", outcome="You understand the services, state boundaries and the order of everyday configuration tasks.", markdown="""## The pieces of your platform

| Component | Responsibility |
| --- | --- |
| Bootstrapper | Starts and coordinates containers and persistent storage |
| Wizard | Browser interface for configuration, runners and projects |
| Sync | Authenticated API between the Wizard and the Bootstrapper |
| GitLab | Source repositories, merge requests and pipelines |
| Runner managers | Execute pipeline jobs in a shared runner pool |
| Registry | Stores the container images built by pipelines |
| NGINX | Routes each configured domain to its service or environment |

## A safe configuration cycle

**Connect → Fetch → edit → Backup → Push → reconnect → Fetch.** Fetch loads saved settings, or marked suggestions on first setup. Review suggestions before transfer. Push applies settings and restarts services automatically.

> **Warning:** Backup files contain credentials. Keep them private. Configuration backups and completed service-data Seeds are separate recovery inputs.

## What survives a change

Source and images describe the infrastructure. Persistent service data contains repositories, databases, registry content and secrets. Saved configuration takes precedence over first-install examples. [Working storage](#docs/storage) explains local data, optional live volumes and independent backup media.

## Build, verify, promote

A source import installs source. A build produces a candidate. Review and Beta are optional environments. Production promotion is a separate deliberate operation with exact image evidence and a rollback checkpoint. Follow [Evolution](#docs/evolution) for the full platform and the linked Wizard guides for interface delivery.
"""))

    guides = [
        ("Prepare-Host.md", "host-preparation", "1.4 Host preparation and releases", "Installation"),
        ("docs/WIZARD_ALIASES.md", "aliases", "3.1 Canonical Wizard aliases", "Configuration"),
        ("docs/PROJECT_BOOTSTRAP_GUIDE.md", "project-guide", "5.1 Create an application · detailed guide", "Projects and runners"),
        ("docs/PROJECT_BOOTSTRAP.md", "project-contract", "5.2 Project bootstrap reference", "Projects and runners"),
        ("gitlab-runner/README.md", "runner-persistence", "4.1 Runner persistence", "Projects and runners"),
        ("docs/PERSISTENT_VOLUME.md", "storage", "7.1 Working data and independent backups", "Recovery"),
        ("docs/RECOVERY_CONTRACT.md", "seed-recovery", "7.2 Configuration and Seed recovery", "Recovery"),
        ("docs/GITLAB_GITHUB_BACKUP.md", "git-mirror", "8.1 GitLab primary and GitHub mirror", "Evolution"),
        ("docs/WIZARD_SOURCE.md", "wizard-source", "8.2 Initialize Wizard source", "Evolution"),
        ("docs/WIZARD_BUILD.md", "wizard-build", "8.3 Build and verify Wizard", "Evolution"),
        ("project-bootstrap/wizard-environments/README.md", "wizard-environments", "8.4 Wizard Review and Beta", "Evolution"),
        ("project-bootstrap/wizard-production/README.md", "wizard-production", "8.5 Wizard Production and rollback", "Evolution"),
        ("project-bootstrap/wizard-upgrade/README.md", "wizard-upgrade", "8.6 Upgrade managed Wizard", "Evolution"),
        ("project-bootstrap/wizard-source-primary/README.md", "wizard-source-primary", "8.7 One source-primary repository", "Evolution"),
        ("project-bootstrap/wizard-build/README.md", "wizard-build-reference", "8.8 Managed build reference", "Evolution"),
        ("bootstrapper/README.md", "controller-reference", "9. Controller and recovery reference", "Reference"),
        ("tests/README.md", "verification", "9.1 Component and platform checks", "Reference"),
        ("tests/e2e/README.md", "candidate-testing", "9.2 Disposable platform acceptance", "Reference"),
    ]
    contexts = {
        "host-preparation": ("Ubuntu with sudo, Docker access, selected working storage and trusted release source/image identities.", "The selected release starts with the intended images, storage mode and host integration."),
        "aliases": ("A configured canonical Wizard hostname, DNS for every alias and certificates covering HTTPS aliases.", "Alias requests redirect to the canonical Wizard while preserving paths, queries and certificate challenges."),
        "project-guide": ("Connect and Fetch; select a GitLab namespace, unique lowercase/digit Project Key, template and environment domains.", "The private repository and managed pipeline are created; successful jobs deploy each automatic environment."),
        "project-contract": ("A configured GitLab instance and Sync connection; choose a new unoccupied repository identity.", "You understand template provisioning, retry behavior, ownership and the separate Wizard workflow."),
        "runner-persistence": ("Selected persistent working storage and a configured runner pool. Fetch before changing its scale or token.", "Runner managers retain their individual identities across container recreation and scale changes."),
        "storage": ("Choose local working data or an explicitly mounted live volume, and a separate backup target when needed.", "Live paths, storage guards, certificate state and independent Seed media match your selected layout."),
        "seed-recovery": ("A completed verified Seed, matching private configuration, compatible GitLab image and fresh live storage.", "Service data is restored before writers start, then authenticated runtime and retained data are verified."),
        "git-mirror": ("Choose the canonical GitLab project, resolve source history and prepare an existing optional GitHub mirror plus private credentials.", "Reviewed merged code is mirrored while GitLab state and service-data recovery retain their separate contracts."),
        "wizard-source": ("Matching System/Wizard versions, an owned managed Wizard scaffold and the prepared pinned source package.", "The exact source is explicitly imported without starting a pipeline or replacing the running interface."),
        "wizard-build": ("Imported Wizard source, matching controller recipe, registry and a trusted runner with sufficient build resources.", "Required build/browser evidence verifies an immutable candidate image without promoting Production."),
        "wizard-environments": ("A verified candidate, reserved Review/Beta hosts, matching certificates and an explicitly provisioned helper.", "Manual candidate environments can be deployed and removed without replacing the Production Wizard."),
        "wizard-production": ("Exact accepted candidate evidence, explicit promotion authority and a retained previous immutable image/checkpoint.", "A reviewed plan switches the Wizard deliberately and preserves an inspectable rollback path."),
        "wizard-upgrade": ("An owned managed project, accepted upgrade source, current repository head and a reserved CI slot.", "The reviewed migration preserves user changes and upgrades source or managed recipes through an ordinary merge request."),
        "wizard-source-primary": ("An existing private Wizard source project, registry, native checks and retained ownership/recovery inputs.", "One adopted repository supplies source, reviews, builds and immutable delivery evidence."),
        "wizard-build-reference": ("A supported imported Wizard source revision, matching managed recipe and trusted Docker build/browser runner.", "The recipe's activation, required gates, toolchain and trust-store contracts can be verified."),
        "controller-reference": ("A clean accepted checkout, exact source/image identities, chosen persistence selector and the operation's private inputs.", "You can select the documented controller install, initialization, promotion or recovery-export operation and verify its receipts."),
        "verification": ("An accepted checkout with exact submodules, Docker and the capacity/isolation required by the selected check.", "The applicable component or platform checks produce reproducible evidence with explicit live-test boundaries."),
        "candidate-testing": ("Trusted candidate code, an explicit capacity lease, isolated disposable state and required fixture/image inputs.", "The candidate is checked against declared startup, migration and recovery boundaries, with owned cleanup recorded."),
    }
    for path, cid, title, group in guides:
        pre, result = contexts[cid]
        add(path, cid, title, group, pre, result)
    chapters.sort(key=lambda c: [int(x) for x in re.match(r"^(\d+)(?:\.(\d+))?", c["title"]).groups(default="-1")])
    return dict(chapters=chapters, sources=sources, images=images)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when the committed Wizard content differs")
    args = parser.parse_args()
    content = json.dumps(build(), ensure_ascii=False, indent=2) + "\n"
    if args.check:
        if not OUTPUT.is_file() or OUTPUT.read_text() != content:
            parser.exit(1, "Wizard docs are stale. Run python3 docs/export-wizard-docs.py and commit the generated content.\n")
        print("Wizard documentation matches repository sources.")
    else:
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        OUTPUT.write_text(content)
        print(f"Exported {len(json.loads(content)['chapters'])} chapters to {OUTPUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
