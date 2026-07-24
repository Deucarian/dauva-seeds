# Registry

This directory will hold reviewed Pod and Seed manifests after the Seed v1
schema and validation policy are accepted.

Rules already fixed by the canonical design:

- Pods group related Seeds but are not runtime workloads.
- Seeds are versioned, curated, and reproducible.
- Container images are pinned by immutable digest.
- Secrets, live data, saves, and backups never enter the registry.
- Arbitrary host scripts, privileged containers, Docker socket mounts, and
  unrestricted host paths are forbidden.
- A Seed may contain a primary component and restricted companion components.

The six current Compose-managed Servers are reference implementations for the
first draft Seeds: Minecraft, Valheim, Core Keeper, Satisfactory, Factorio, and
Enshrouded.
