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

These seven committed receipts use the legacy proof-v1 format. They document
useful lifecycle evidence but are neither authenticated nor sufficiently bound
for Seed Studio release or runtime availability. Every offered stable Seed must
be re-proofed under proof-v2 before the Studio is enabled.

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

## Pod and Seed Creator

The Leaf exports a sanitized `dauva.dev/seed-creator-analysis/v1` document for
an explicitly trusted existing Server. It never includes bind-source paths or
secret values.

`npm run creator:generate -- --analysis <analysis.json>` recognizes a matching
proven Seed and writes only a review receipt, so existing recipes are never
duplicated. Registry maintainers can test deterministic reconstruction with
`--reference-seed <seed-id>`. For a genuinely new game, add a validated
`--answers <request.json>` document using
`dauva.dev/seed-creator-request/v1`; the Creator writes a draft Pod, draft
Seed, review report, and proof plan under `dist/creator/`.

Creator output is a proposal, never a publication. A new Pod still needs at
least two meaningful related Seeds. Every unresolved source, image, port,
volume, agreement, setting, secret, health, resource, and update choice must
be reviewed before the draft enters `registry/`, and the exact manifest must
then pass a disposable Leaf proof before promotion.

For automation, pass `--analysis -` and stream the authenticated Leaf response
over standard input. This keeps transient production analysis out of the
repository and local shell history.

When a container no longer exists, a retained Compose definition can still be
used as recipe evidence:

```text
docker compose config --format json |
  npm run --silent creator:analyze-compose -- --reference-seed <seed-id> |
  npm run --silent creator:generate -- --analysis - --reference-seed <seed-id>
```

The Compose analyzer emits only service names, image references, environment
key names, container targets, and ports. Environment values, bind sources,
secret payloads, and generated identifiers are discarded. This path can
reconstruct or create a draft, but it never claims that live data exists or is
safe to adopt.
