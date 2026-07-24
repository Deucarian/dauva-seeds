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
- All six existing Compose Server types have sanitized Seed manifests.
- Minecraft Fabric `1.0.0` is stable and contains a primary Server plus a
  backup companion.
- The other five Seeds remain draft until their native lifecycle and
  multi-port behavior have been tested.
- Dauva rejects mutable images, fixed secrets, saves, arbitrary host paths,
  privileged runtime access, and Docker socket mounts.
- A disposable Fabric Server completed create, health, stop, start, restart,
  and name-confirmed delete on the Debian Leaf without using Pterodactyl.
- New Servers Sprout through Dauva's native Docker Branch by default;
  Pterodactyl remains an optional migration fallback.

Compiled registry output is committed at `dist/registry.json`.
