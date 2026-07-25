# Registry

This directory contains the reviewed Pod and Seed manifests compiled into
`../dist/registry.json`.

Rules already fixed by the canonical design:

- A Pod represents one game family and groups one or more related Seed
  variants. Seeds join a Pod through `podId`; there is no one-Seed limit or
  duplicated Seed list in the Pod manifest.
- Genres are Seed labels for discovery and filtering; they never define Pod
  ownership.
- Seeds are versioned, curated, and reproducible.
- Container images are pinned by immutable digest.
- Secrets, live data, saves, and backups never enter the registry.
- Arbitrary host scripts, privileged containers, Docker socket mounts, and
  unrestricted host paths are forbidden.
- A Seed may contain a primary component and restricted companion components.

The six current Compose-managed Servers were used as reference implementations
for Minecraft, Valheim, Core Keeper, Satisfactory, Factorio, and Enshrouded.
Minecraft Fabric, Factorio, Core Keeper, and Valheim are stable after
successful disposable native lifecycle tests. Satisfactory and Enshrouded
remain candidates until their heavier runtime and memory behavior is proven.
