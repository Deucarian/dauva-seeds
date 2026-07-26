# Registry

This directory contains the reviewed Pod and Seed manifests compiled into
`../dist/registry.json`.

Rules already fixed by the canonical design:

- A Pod represents one game family and groups at least two related Seed
  variants. Seeds join a Pod through `podId`; there is no upper one-Seed limit
  or duplicated Seed list in the Pod manifest.
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
Each Pod now contains two meaningful variants. Factorio Stable, Valheim
BepInEx, both Satisfactory branches, and both Enshrouded runtimes passed fresh
install, port, stop, restart, persistence, and deletion proofs on the native
Docker Branch. Enshrouded Wine keeps its roughly 9 GB game install in explicit
persistent storage and is the recommended Enshrouded Seed. Enshrouded Proton
persists saves but revalidates the large install on cold starts.

Core Keeper Hard also passed a fresh Hard-world proof. Its Seed-specific
`SIGINT` shutdown completed in three seconds, wrote the world save to the
data-disk volume, stayed stopped, and loaded that same save after restart.

Minecraft Paper passed its EULA-gated Paper 26.2 proof with digest-pinned
primary and backup images, a dynamic port, a persistent world, an ordered
restart, two RCON backups, and complete cleanup. All twelve current Seeds are
stable.

Each component also declares one mutable OCI tag under `imageUpdate`. The tag
is discovery metadata only: Servers always run the digest-pinned `image`.
Scheduled checks prepare reviewable patch-versioned candidates, never mutate
existing Servers, never merge automatically, and never pre-accept agreements.
