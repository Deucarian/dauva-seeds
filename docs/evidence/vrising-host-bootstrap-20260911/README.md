# V Rising missing-host first Apply qualification

Manual disposable-runtime evidence, **not a signed Seed proof**. No new Seed
recipe or image is promoted. This specifically closes the case missed by the
earlier two-file qualification: an existing persistent world and gameplay file,
but no persistent `ServerHostSettings.json`.

- Canonical Leaf: `c775afcf4f3fff9a03444b6eb93be861fe4bc1ef` (0.11.2).
- Tested Linux helper SHA-256: `e5f1e393eb27f83ad77fad6b265c13d640c1abfa441586a147a021e036f76aec`.
- Exact existing image: `ghcr.io/deucarian/dauva-vrising-runtime@sha256:09ca6c70c19be749f0a55f278400a6c68a414122d8f9a8929c3f6a94b4914b0e`.
- Installed game: `1.1.14.100531`.
- Private disposable appliance and worlds; no host game ports. No owner saves
  were used, overwritten, migrated or removed. Existing working Wine prefixes
  and container identities were retained.

Both baselines loaded their existing `dauva-world` with the original launcher
and no host override; the baseline evidence records the absence and startup
hash. Both first Apply operations used a real 60-second countdown and normal
save/stop/create-host/apply/start/verify workflow:

- PvE: `2a544f933b0f551e97f97911795f8dc4`, completed 11:13:15 UTC.
- PvP: `9dccc0e30cb65fc3a95dfb469f92ef8f`, completed 11:14:23 UTC.

The game itself reported `TeleportBoundItems=false`, 14 player slots, both
listing flags enabled and the correct PvE/PvP mode. Real A2S responses confirmed
GameID 1604030, 14 slots and password flag 1. After another ordinary stop/start,
both worlds reloaded and all those observations remained correct. Baseline,
first-Apply and second-restart observations are attached separately. The same
container was used throughout each case. No game image/container replacement
was performed by the settings workflow.

Local Go tests/vet and Registry parity passed. Fixtures additionally cover
running/stopped states, nonempty secret keep/change/clear, protected fields,
private ownership, incomplete/malformed defaults, lost native host after start,
and fake-clock 10/20/100-second lost-acceptance/stop/reconnect/repeated-click
boundaries. Fixtures are not presented as real-game evidence.

RCON was disabled: Dauva's countdown worked and in-game announcement delivery
was correctly reported unavailable. These checks do not prove retail-client
waygate interaction, wrong-password rejection, or external lobby reachability.
The desktop Leaf still needs the exact released host/guest update and a fresh
production editor read; this qualification alone is not live activation.
