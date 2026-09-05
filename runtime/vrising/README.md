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
