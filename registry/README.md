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

The current Compose-managed Servers were used as reference implementations
for Minecraft, Valheim, Core Keeper, Satisfactory, Factorio, and Enshrouded.
Terraria, Project Zomboid, and Garry's Mod were then added from curated public
container sources. Each of the nine Pods contains two meaningful variants.
Factorio Stable, Valheim BepInEx, Satisfactory Experimental, and both
Enshrouded runtimes passed fresh install, port, stop, restart, persistence, and
deletion proofs on the native Docker Branch. Satisfactory Stable `1.0.1`
additionally passed its exact runtime-version, backup-first managed-update,
forced-failure rollback, persistence, and cleanup proof. Its original `1.0.0`
recipe remains immutable in release history. Enshrouded Wine keeps its roughly
9 GB game install in explicit persistent storage and is the recommended
Enshrouded Seed. Enshrouded Proton persists saves but revalidates the large
install on cold starts.

Core Keeper Hard also passed a fresh Hard-world proof. Its Seed-specific
`SIGINT` shutdown completed in three seconds, wrote the world save to the
data-disk volume, stayed stopped, and loaded that same save after restart.

Minecraft Paper passed its EULA-gated Paper 26.2 proof with digest-pinned
primary and backup images, a dynamic port, a persistent world, an ordered
restart, two RCON backups, and complete cleanup. Terraria Vanilla and TShock,
Project Zomboid Private and Community, and Garry's Mod Construct and Flatgrass
also passed the complete disposable Leaf lifecycle. All eighteen current Seeds
are stable.

Each component also declares one mutable OCI tag under `imageUpdate`. The tag
is discovery metadata only: Servers always run the digest-pinned `image`.
Scheduled checks prepare reviewable patch-versioned candidates, never mutate
existing Servers, never merge automatically, and never pre-accept agreements.

Runtime game versions and Seed recipe versions are separate. Satisfactory
Stable declares Steam app `1690800`, the public Stable channel, a bounded
app-manifest detector, and a trusted SteamCMD update strategy with an explicit,
bounded `/home/steam` container home. The allocated game and messaging ports
are configured and published 1:1; they must not be silently remapped to
different container ports.
