# Seed release history

The update tooling copies the current stable Seed here before it prepares a new
release candidate. Historical releases remain part of the compiled, hashed
Registry so an installed Server can roll back without accepting an arbitrary
manifest.

Files use `<seed-id>@<version>.json`. They are immutable after publication.
