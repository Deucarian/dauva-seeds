# Candidate manual qualification — September 7, 2026

Status: both disposable variants completed their settings checks and were
stopped. This is operator-observed candidate evidence, **not authenticated Seed
proof, published-image qualification or permission to alter a live world**.

## Exact identity

- Runtime version: `1.0.0`.
- Executable source: `f543cbac708bb0fb335daf70285b298afe566104`.
  Subsequent README/CI/evidence changes do not change executable image source.
- Source archive SHA-256:
  `145f8c23f3e7d8a9e3e5f1f375f4630cf171b196768299158dc302cb839eff70`.
- Local diagnostic image SHA-256:
  `b67a58e1445210970d57538c01243cbc509cf4daf81a34d6dd5a7af2c607350c`.
  This is a local image identity, not a registry publication or upstream release.
- Steam app `380870`, installed build `24909836` in both installations.
- Case identities: private `24d768f186835e63ab35791b1e9e846d`, community
  `9d33c8764ae95eebaf91fb7e8af22237`.
- Redacted operator evidence archive SHA-256:
  `f1c61fd8e62ec7aaa2ef7ab47ed775222fcf913d6fdd254cc07b1b77eaf1f9f4`.
  Kept outside the repository with the disposable test data. It contains native
  snapshots, selected actual-game responses and lifecycle receipts, not raw
  environment files, credentials, settings requests, logs or game worlds.

## Observations

Each variant used a separate persistent disposable world, sequentially, on an
unenrolled test VM with no live-world mounts or published host game ports.
Both generated 414 native settings fields without reader warnings. Both actual
launch files retained `-Xmx4096m`, `-Xms128m` and `-XX:+UseZGC`.

For each variant the settings operation changed MaxPlayers to 12, PVP to false,
Public to true, the disposable join password, and sandbox MultiHitZombies to
true. The actual game's RCON `showoptions` response confirmed MaxPlayers/PVP/
Public after the settings-triggered restart and after a second ordinary stop/
start. Native readback retained the sandbox change and masked password presence.
A separate completed operation cleared the password and restored Public=false;
post-start native readback reported password absence, and actual game readback
confirmed Public=false with MaxPlayers=12 and PVP=false still intact.

| Preserved, untouched option | Private | Community |
| --- | --- | --- |
| Open (whitelist access) | false | true |
| PauseEmpty | true | false |

Final lifecycle stop receipts are completed for both variants. Private final
game readback is timestamped `07:34:04Z`; community final readback `07:53:08Z`.
Community has separate archived first/second/clear response snapshots. Private
has its latest response plus the operator transcript of the earlier checks;
missing historical files were not reconstructed as original evidence.

## Explicit limits and follow-up

- Sandbox behavior was checked at the native configuration boundary, not by
  playing with a client. Join-password authentication, incorrect-password
  rejection and public Internet listing were not tested with a client.
- `showoptions` is actual game readback, but not a signature or Studio proof.
- The legacy launcher variable `PUBLIC_SERVER` controls `Open`, not `Public`.
  Native settings correctly expose these separately. The catalog's creation
  input mapping needs a separately versioned/proven correction; preserving the
  compatibility launcher must not silently change its existing semantics.
- Earlier OOM, archive-line-ending and missing-initial-heap failures remain
  negative evidence for their own exact candidate hashes, not this image.
- Registry tests (118), 10-family/20-Seed validation, compiled parity, cross-Leaf
  contract checks, and dependency/launcher fixtures passed. Fixtures are not
  real-game proof; their CI workflow has no image-publication step.
- Publication still requires an authorized registry identity, exact-image
  qualification, new Seed versions, authenticated proof and governed promotion.
  Stable Seed manifests and owner worlds have not changed.
