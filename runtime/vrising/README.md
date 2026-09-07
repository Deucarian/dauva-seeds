# Dauva V Rising runtime

This image is a narrow, auditable layer on top of the pinned
`zkoesters/vrising-server` Wine image. Dauva owns update timing, backups,
rollback, restart scheduling, and dynamic port assignment; the upstream
runtime owns Wine and the V Rising process lifecycle.

The layer adds the following contracts required by the V Rising Seeds:

- a container health check backed by the live game process and the current
  startup-complete log marker;
- fail-closed mapping for public-listing and difficulty settings; and
- atomic, additive `adminlist.txt` reconciliation from semicolon-separated
  `Name=SteamID64` entries, without printing IDs or secret values.
- Wine cryptography registration is checked as the game user before launch.
  An incomplete first boot is repaired with `wineboot --update`; failure blocks
  launch. A random-source exception in the active game log fails health.

Game data is written to the two declared Seed mounts:
`/vrising/server` for installed Steam files and `/vrising/data` for settings,
saves, logs, and administrator state. The image does not update game files on
startup and does not enable RCON. Wine also maintains its per-user runtime
prefix in the container; this is separate from the persistent world volume.

## Health correction (runtime 1.2.3)

A fresh disposable 1.2.2 runtime on an internal-only network timed out during
Steam game-server logon and emitted fatal Steam networking initialization
errors. It nevertheless reported startup complete and wrote new autosaves.
The old process/startup-marker health check incorrectly reported it healthy;
the actual A2S_INFO query remained unavailable. Version 1.2.3 rejects those
specific fatal game messages even when startup and save markers follow them.
Generic DNS/transient connection errors alone do not trigger this rejection.
The fixture checks every fatal marker before/after startup and recovery with a
fresh clean log. Health still does not substitute for an actual connection query.

This correction does not make offline Steam networking work, qualify either
replacement Seed, enable Studio, or update an existing owner's image. The
separate proof runner needs governed, bounded Steam connectivity as well as
installation bootstrap; copying Steam files alone is insufficient.

## Native settings contract (introduced in runtime 1.2.2)

Real settings/recreation testing on September 6 found that Wine registry
inspection could start a headless wineserver before the upstream asynchronous
Xvfb launch. Unity then exited with `Failed to create batch mode window`.
The launcher now establishes a confirmed Xvfb display before the first Wine
invocation, exports DISPLAY consistently and waits for registry inspection to
finish. It verifies an initial Steam installation, with at most two sequential
attempts in the same directory after an unsuccessful installer process exits.
No existing installation is automatically updated and an incomplete install
cannot fall through into game launch.

The image advertises DAUVA_SETTINGS_PROFILE_VERSION=1. Once a compatible Leaf
has preserved the effective host/game settings in the persistent Settings
directory, DAUVA_NATIVE_SETTINGS=true makes those files authoritative. The
wrapper disables compilation and non-platform VR_* overrides, including the
preset inputs, without editing Steam-owned defaults or presets. Port, world
identity, RCON and security controls remain platform-owned.

Both persistent files must exist before native mode can start. Initial Server
creation retains the existing validated option mapping. Wrapper tests stub the
final launcher to verify precedence without downloading or starting V Rising.

This source change does not publish or promote a Seed. Build and qualify the
runtime, publish its actual image digest, then prepare and prove a new pinned
Seed before promotion. Never substitute a local image ID for a registry digest.
No live V Rising Server was restarted or modified for this feature.
