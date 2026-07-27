# Dauva Seeds

`Deucarian/dauva-seeds` is the canonical source for Dauva's versioned Pods,
Seeds, registry schemas, validation rules, and native Server platform design.

The Seed Registry contains small, curated, reproducible manifests. It does not
store live worlds, saves, secrets, backups, or large game installations.

## Start here

- [Native server platform design](docs/architecture/dauva-native-server-platform.md)
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
- Every Pod names one proven recommended Seed. Dauva uses that recommendation
  in the beginner-friendly Sprout flow while keeping other variants available
  behind an optional choice.
- All six existing Compose Server types have sanitized Seed manifests. Terraria,
  Project Zomboid, and Garry's Mod have now joined them, giving the Registry
  nine Pods and eighteen stable Seeds with two meaningful variants per Pod.
- Factorio Stable, Valheim BepInEx, both Satisfactory branches, and both
  Enshrouded runtimes passed disposable native lifecycle proofs. Together with
  the original proven Seeds, they are stable `1.0.x` recipes.
- Enshrouded Wine is recommended because its roughly 9 GB game install,
  saves, logs, and local backups all live on explicit data-disk storage.
  Enshrouded Proton persists saves but revalidates its large install on cold
  starts.
- Minecraft Paper passed its EULA-gated native lifecycle proof with Paper
  26.2, a healthy primary container, dynamic port, persistent world, ordered
  restart, and two real RCON backups.
- Terraria Vanilla, TShock, Project Zomboid Private and Community, and Garry's
  Mod Construct and Flatgrass passed fresh disposable Leaf proofs. Their
  receipts retain the exact release-candidate version and manifest digest that
  was tested when the Seed is promoted to stable.
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

Existing Servers never move automatically. A candidate must pass health, port,
backup, stop, restart, persistence, and cleanup checks before
`npm run seed:promote` accepts its matching proof receipt. Agreements stay
unchecked: a required EULA or terms revision must have explicit acceptance in
the proof receipt and in Dauva's server-side audit.

`npm run seed:create` turns a curated OCI, SteamCMD, LinuxGSM, or Dauva source
into a draft that still requires human review. `npm run seed:proof` asks an
authenticated Leaf for a disposable lifecycle receipt. The Registry API makes
Pods, Seeds, sources, trust, storage, update policy, and receipts available to
the admin portal without exposing Docker or Pterodactyl details.
