# Registry

This directory contains the reviewed Pod and Seed manifests compiled into
`../dist/registry.json`.

Rules already fixed by the canonical design:

- Pods group related Seeds but are not runtime workloads.
- Seeds are versioned, curated, and reproducible.
- Container images are pinned by immutable digest.
- Secrets, live data, saves, and backups never enter the registry.
- Arbitrary host scripts, privileged containers, Docker socket mounts, and
  unrestricted host paths are forbidden.
- A Seed may contain a primary component and restricted companion components.

The six current Compose-managed Servers were used as reference implementations
for Minecraft, Valheim, Core Keeper, Satisfactory, Factorio, and Enshrouded.
Minecraft Fabric is stable after a successful native lifecycle test; the other
five Seeds remain draft.
