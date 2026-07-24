# Dauva Seeds

`Deucarian/dauva-seeds` is the canonical source for Dauva's versioned Pods,
Seeds, registry schemas, validation rules, and native Server platform design.

The Seed Registry contains small, curated, reproducible manifests. It does not
store live worlds, saves, secrets, backups, or large game installations.

## Start here

- [Native server platform design](docs/architecture/dauva-native-server-platform.md)
- [Registry layout](registry/README.md)

## Planned layout

```text
docs/
  architecture/
registry/
  pods/
  seeds/
schemas/
tools/
```

The first delivery milestone is a native Minecraft Fabric Seed with a backup
companion component, Sprouted on the current Debian Leaf without using a
Pterodactyl Egg or API.

## Current status

The repository and canonical design have been created. Seed v1 and the
validator are the next implementation step.
