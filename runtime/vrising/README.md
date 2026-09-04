# Dauva V Rising runtime

This image is a narrow, auditable layer on top of the pinned
`zkoesters/vrising-server` Wine image. Dauva owns update timing, backups,
rollback, restart scheduling, and dynamic port assignment; the upstream
runtime owns Wine and the V Rising process lifecycle.

The layer adds three contracts required by the V Rising Seeds:

- a container health check backed by the live game process and the current
  startup-complete log marker;
- fail-closed mapping for public-listing and difficulty settings; and
- atomic, additive `adminlist.txt` reconciliation from semicolon-separated
  `Name=SteamID64` entries, without printing IDs or secret values.

The only writable targets are the two declared Seed mounts:
`/vrising/server` for installed Steam files and `/vrising/data` for settings,
saves, logs, and administrator state. The image does not update game files on
startup and does not enable RCON.
