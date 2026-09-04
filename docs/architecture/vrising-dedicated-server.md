# V Rising Dedicated Server discovery and runtime decision

Reviewed on 2026-09-04 for the first V Rising Pod. The affected repositories
are `dauva-seeds` for the Pod, Seed recipes, runtime layer, proof policy, and
registry publication, plus `dauva-api` for optional protected Seed inputs and
later administrator edits. Garden already renders profile fields from Registry
data, so `dauva-flutter` needs no game-specific screen. The current Leaf update,
backup, restore, scheduling, dynamic-port, and proof-v2 contracts are reused.

## Verified upstream facts

The source of truth is Stunlock Studios' current
[1.1.x PC Dedicated Server instructions](https://github.com/StunlockStudios/vrising-dedicated-server-instructions/blob/56a17748f55f4662247b31890fee8f16a8a78720/1.1.x-pc/INSTRUCTIONS.md).
The reviewed revision says that the dedicated server is Windows-only, uses
Steam AppID `1829350` from the default branch, and must be offline when
SteamCMD updates it. It recommends a daily restart.

The runtime starts `VRisingServer.exe` through Wine with
`-persistentDataPath /vrising/data`. Consequently, settings and administrator
state live below `/vrising/data/Settings`, current saves live below
`/vrising/data/Saves/v4`, and the Steam installation lives in
`/vrising/server`. Dauva backs up both declared volumes before managed updates;
this deliberately trades backup size for an exact install-and-world rollback.

V Rising uses separate UDP game and query ports. Both are dynamically allocated
and configured 1:1 through `VR_GAME_PORT` and `VR_QUERY_PORT`. The private PvE
recipe disables both EOS and Steam listing by default. The public-listing input
controls both flags together, while direct connections remain possible.

## Runtime audit

Four maintained public Wine images were inspected at fixed source revisions:

- `TrueOsiris/docker-vrising` at
  `cce267ba7c83eab33b0485cea063d22edfad7ee5` runs as root, updates on every
  start, and has no health or administrator-file contract.
- `fboulnois/vrising-docker` at
  `edb395d2c6c8ba0d773d9273941058b965c52d7d` runs unprivileged but also updates
  on every start and has no health or protected administrator input.
- `Didstopia/vrising-server` at
  `0477053314f18bb9119b9830707e4875deb659c8` couples updates to redeployment,
  enables RCON with a default credential, and documents an immediate-kill
  shutdown path that may not save.
- `zkoesters/docker-vrising-server` at
  `f0a8c30c7f594b1be11b998323fee6769e334dd2` has the best base contract: Debian
  12, WineHQ 10, an AVX preflight, uid/gid 1000 game execution, opt-out startup
  updates, and graceful `taskkill` plus `wineserver -w` shutdown.

The accepted base is the linux/amd64 manifest
`docker.io/zkoesters/vrising-server@sha256:5d39d8a859eb92f1d8dac4f1e35acd3ac1b003f7f93d46e1e22d38d3a6373f58`
from multi-platform index
`sha256:9355096b4b02277ca5e7aa1a0a53581fae5094d67a5db62b84f2b34349b41912`.
It is wrapped rather than used directly because it lacks a container health
check and a secret-to-`adminlist.txt` materialization contract.

The exact derived linux/amd64 image manifest is
`ghcr.io/deucarian/dauva-vrising-runtime@sha256:98c7e877c173dd7aa5435c6b8ea3a97de2848cb1beeaae9c340ad6d422b45595`.
The attested tag index is
`sha256:d600d8f79040aeef67eeb60576fa02d7bb4e86d5655df5251543d64d2e2040cc`;
Seeds intentionally pin the platform manifest rather than its mutable tag or
attestation index.

The Dauva layer disables every upstream automatic update/restart/announcement,
keeps RCON disabled, validates the supported difficulty and player range, and
adds a process-plus-current-log health check. Managed updates use
`/home/steam/steamcmd/steamcmd.sh` as uid/gid `1000:1000`, target
`/vrising/server`, validate AppID `1829350`, restart, and require the Leaf's
existing health-gated automatic rollback.

The ordinary Dauva Server name is injected into `VR_NAME`, so Garden's standard
name field remains the single display-name control instead of adding a duplicate
Seed input. A daily 04:00 restart is deliberately not embedded in the runtime:
the existing schedule contract can perform an ordered restart, but V Rising has
no enabled narrow player-warning channel while RCON is disabled. Add the daily
schedule only after Dauva has a reviewed V Rising-specific warning operation;
an unmanaged container timer or host cron job is not an acceptable substitute.

## Administrator and password handling

`initial-administrators` is an administrator-owned protected value containing
semicolon-separated `Name=SteamID64` entries. Only canonical 17-digit SteamID64
values in the individual-account range are accepted. The runtime reads and
validates the existing fixed target `/vrising/data/Settings/adminlist.txt`,
deduplicates while preserving existing entries, adds missing supplied IDs, and
atomically replaces that one file with a final newline. It never prints IDs,
labels, join passwords, or file contents. Invalid input fails before mutation.

Garden may later send a replacement protected value through normal Server
settings; blank means preserve the current protected value. The additive file
reconciliation means adding administrators never recreates or overwrites the
world. Players still enable the client console and run `adminauth`, as required
by Stunlock.

The join password is a second administrator-owned protected value, explicitly
optional and mapped to `VR_PASSWORD`. A separate password-protection switch
makes later disabling unambiguous: a blank masked field preserves the stored
secret, while switching protection off sends an empty game password. Switching
it on requires a 4 to 128 character protected value. Supporting that honest
optional state requires one small Seed contract extension: `secret.required`,
defaulting to `true` for backward compatibility. Generated secrets cannot be
optional. The API/Leaf path carries an omitted optional value as an encrypted
empty string; ordinary records and responses remain secret-free.

## Registry shape and release posture

The established Registry format has no Seed inheritance or composition
primitive. The PvE and PvP recipes therefore remain explicit complete manifests,
with a focused parity test enforcing that only identity, explanatory copy, and
`VR_PRESET` differ. `vrising-pve` is the recommended private co-op recipe;
`vrising-pvp` is visibly competitive and is never implied to be recommended.

Both enter as `candidate` version `1.0.0-rc.1`. Stable promotion requires a real
proof-v2 receipt for the exact manifest and amd64 runtime, including image,
health, ports, backup/restore, runtime build, managed update/rollback, graceful
stop, restart, persistence, and cleanup. Publication success additionally
requires protected review and an authenticated deployment receipt for the exact
merged `develop` registry revision.
