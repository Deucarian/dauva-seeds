# Existing V Rising settings compatibility qualification

This is **manual disposable-runtime evidence, not a signed Seed proof**. No new
Seed recipe or image is promoted. The adapter changes the startup handling of
the exact already-released 1.1.0 container, after encrypted configuration backup.

- Canonical Leaf implementation: `fc17b70` (0.11.1).
- Linux helper SHA-256: `4e6f9ffc7e2d88f946352ff90e9df7aa760b70aeb4694acbe31774636e66f17e`.
- Image: `ghcr.io/deucarian/dauva-vrising-runtime@sha256:09ca6c70c19be749f0a55f278400a6c68a414122d8f9a8929c3f6a94b4914b0e`.
- Downloaded game version: `1.1.14.100531`.
- Disposable appliance only, persistent test data, private Docker networks,
  download egress, **no host game ports**. The owner's world was never used.
- Original startup SHA-256: `f07119701636a31e1983290179cf4cbd5c87609159e4b82a1d89c4d1ee9beed3`.
- Qualified patched SHA-256: `26f3a7676a73fb8a2bab042fb66d189ceb1626398bbe70e4a78d02add51a08c7`.

## Important negative evidence

The preliminary file-only PvE operation `baa0bc8707de5a67a53c2214a1e3b664`
reported completion, but was **disproven** by the game's own startup settings.
Disabling wrapper generators does not disable the game's `VR_*` overrides.
Do not count `pve/observed-gameplay.json` as successful qualification. The
released candidate must include the backed-up, pinned startup compatibility
block and verify its presence after startup.

The first PvP download failed in SteamCMD, and Wine's interrupted initialization
left its cryptographic provider registry missing. The subsequent settings
operation `2c0cd83c17d150e3b89d297946c1f808` correctly failed after the save/stop
grace expired, **without writing settings**, and restored the running state.
The disposable Wine prefix was archived, then `wineboot --update` initialized
its missing providers. No game files, settings, launcher or existing world were
changed by this separate test-environment repair. The archive hash is recorded
in the repair receipt. This is not a claim that 1.1.0 has reliable fresh-install
behavior; the adapter specifically preserves existing repaired containers.

## PvE

Corrected first Apply: `6711c19deaf55680bb47cf34a2f9d932`.
Password clear/private listing: `c0dce995b621540a8983947ce77976e7`.
Both completed through a real 60-second countdown and normal save/stop/start.
The same container and `dauva-world` were retained. A subsequent ordinary
restart answered A2S with GameID 1604030, 12 player slots, password flag 1 and
PvE keywords. After password clear and disabling both listings, another
ordinary restart loaded AutoSave 11 and 274280 entities; actual game startup
settings reported 12 slots, both listings false and TeleportBoundItems false.

## PvP

After repairing the disposable Wine baseline and proving an ordinary cold
save/load, first Apply `ff56e9c714245eea8a8e005764dc600e` completed normally.
The actual startup dump confirmed 12 slots, both listing flags true and
TeleportBoundItems false. A2S confirmed GameID 1604030, 12 slots, password flag 1
and PvP keywords, including after an additional ordinary restart.

Password clear `5730ab2f561b5dc4a9782c6205810747` completed and A2S changed to
password flag 0, again surviving an additional ordinary restart. Private
listing apply `dd859b6a528c58b8a7900a756454a461` completed; the following ordinary
restart loaded AutoSave 6 and 274802 entities with both listing flags false,
password absent, 12 slots and TeleportBoundItems false. Every successful Apply
used the 60-second countdown. The same original container and world persisted.

## Evidence limits

A2S confirms a real game query response, player limit, password-presence flag
and game mode. Native readback and the game's own startup dump confirm the
other selected configuration values. This does not prove waygate interaction,
incorrect-password rejection inside the retail client, or discoverability from
an external public lobby. Those require separate client/network checks.

RCON was disabled. Dauva's durable countdown was tested; in-game warnings were
correctly reported unavailable. A health status captured after an intentional
test stop is not a startup failure; see the completed lifecycle receipts and
timestamped startup evidence. No live game settings were changed as a test.

Both-variant running/stopped password keep/change/clear, protected fields,
unchanged world/Wine files and fake-clock 10/20/100-second lost-response,
reconnect and duplicate-acceptance cases also pass the Leaf fixtures. Fixtures
are complementary evidence, not a substitute for the observations above.
