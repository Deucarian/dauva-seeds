# Dauva Seeds

`Deucarian/dauva-seeds` is the canonical source for Dauva's versioned Pods,
Seeds, registry schemas, validation rules, and native Server platform design.

The Seed Registry contains small, curated, reproducible manifests. It does not
store live worlds, saves, secrets, backups, or large game installations.

## Start here

- [Native server platform design](docs/architecture/dauva-native-server-platform.md)
- [Internal Seed Studio specification](docs/architecture/internal-seed-studio.md)
- [Registry layout](registry/README.md)

## Layout

```text
docs/
  architecture/
registry/
  pods/
  seeds/
schemas/
tools/
```

## Current status

The first vertical slice is live:

- Seed v1 schemas, policy validation, and deterministic compilation are in
  place.
- Every Pod represents one game family and can contain multiple Seed variants;
  cross-game discovery uses explicit Seed genres instead of genre-shaped Pods.
- Every Pod names one recommended Seed. Seven of the eighteen stable Seeds
  currently have legacy proof receipts; all Seeds need exact Studio-v2 proof,
  including the five recommended Seeds that have no receipt today, before the
  internal Seed Studio can enter production use. Dauva uses each recommendation
  in the beginner-friendly Sprout flow while keeping other variants available
  behind an optional choice.
- All six existing Compose Server types have sanitized Seed manifests. Terraria,
  Project Zomboid, and Garry's Mod have now joined them, giving the Registry
  nine Pods and eighteen Seed recipes with two meaningful variants per Pod.
- Factorio Stable, Valheim BepInEx, Satisfactory Experimental, and both
  Enshrouded runtimes passed disposable native lifecycle proofs.
  Satisfactory Stable `1.0.1` additionally passed its exact runtime-version,
  backup-first managed-update, forced-failure rollback, persistence, and
  cleanup proof; immutable `1.0.0` remains in release history.
- Enshrouded Wine is recommended because its roughly 9 GB game install,
  saves, logs, and local backups all live on explicit data-disk storage.
  Enshrouded Proton persists saves but revalidates its large install on cold
  starts.
- Minecraft Paper passed its EULA-gated native lifecycle proof with Paper
  26.2, a healthy primary container, dynamic port, persistent world, ordered
  restart, and two real RCON backups.
- Terraria Vanilla, TShock, Project Zomboid Private and Community, and Garry's
  Mod Construct and Flatgrass passed fresh disposable Leaf proofs. Their v1
  receipts are retained as legacy evidence, but are not authenticated or
  sufficiently bound to satisfy the Seed Studio v2 release gates.
- Dauva rejects mutable images, fixed secrets, saves, arbitrary host paths,
  privileged runtime access, and Docker socket mounts.
- Disposable Factorio, Core Keeper Normal and Hard, Valheim, Satisfactory, and Enshrouded
  variants completed native install, status, port, stop, restart, persistence,
  and cleanup proofs on the Debian Leaf without using Pterodactyl.
- New Servers Sprout through Dauva's native Docker Branch by default;
  Pterodactyl remains an optional migration fallback.
- The native Branch is now an independently deployed, bearer-authenticated
  Leaf Agent. It checks Leaf identity, capabilities, Registry digest, Seed
  version, and manifest digest before any lifecycle operation.

Compiled registry output is committed at `dist/registry.json`.

## Seed updates

Every component keeps its immutable runtime image and a separate reviewed OCI
tag used only for update discovery. `npm run updates:check` resolves those tags
without changing a Seed. The daily GitHub workflow opens a pull request with
patch-versioned release candidates when digests change.
The same candidate batch increments the actual Seed Library package version;
build metadata is never used as a substitute for that release number.

Existing Servers never move automatically. Legacy v1 promotion is frozen while
the authenticated proof-v2 contract is introduced. A candidate must pass its
exact health, port, backup, stop, restart, persistence, cleanup, agreement, and
signature gates before the replacement promotion path may emit stable output.

Seed versions identify Dauva recipes, not game releases. A managed Server may
therefore report Satisfactory 1.2 while using Satisfactory Stable Seed 1.0.1.
The Seed's runtime-version contract reports the actual Steam build and Stable
channel separately. Ordinary restarts do not install updates; update-capable
Seeds require an explicit backup-first update and verified rollback path.

`npm run seed:create` turns a curated OCI, SteamCMD, LinuxGSM, or Dauva source
into a private `.seed-studio/drafts/` document that still requires human
review. It refuses output below `registry/`, `proofs/`, or `dist/`. The legacy
synchronous `seed:proof` path remains historical tooling and cannot issue a
proof-v2 receipt. The Registry API makes Pods, Seeds, sources, trust, storage,
update policy, and receipts available without exposing Docker or Pterodactyl
details.
