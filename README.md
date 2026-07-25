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
- All six existing Compose Server types have sanitized Seed manifests.
- Minecraft Fabric, Factorio, Core Keeper, and Valheim are stable `1.0.0`
  Seeds after disposable native lifecycle tests.
- Satisfactory and Enshrouded remain candidate Seeds until the Leaf receives
  its RAM upgrade and their heavier runtime behavior is tested end to end.
- Dauva rejects mutable images, fixed secrets, saves, arbitrary host paths,
  privileged runtime access, and Docker socket mounts.
- Disposable Fabric, Factorio, Core Keeper, and Valheim Servers completed
  native create, status, power, and name-confirmed delete flows on the Debian
  Leaf without using Pterodactyl.
- New Servers Sprout through Dauva's native Docker Branch by default;
  Pterodactyl remains an optional migration fallback.

Compiled registry output is committed at `dist/registry.json`.
