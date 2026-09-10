# Shared planned restarts and announcement adapters

Status: implementation candidate, 2026-09-10. Not production qualification.

Every game and Seed variant uses one Leaf-owned countdown policy, for settings
applies and ordinary Garden planned restarts. It does not intercept crashes,
operating-system shutdowns, external Docker commands or emergency operations.
Other future planned maintenance entry points must join the same durable policy;
do not bolt a browser timer onto a lifecycle call.

## Protocol and safety

- The review chooses an integer delay of 0–86400 seconds (default 300). Zero is
  immediate; a stopped settings target does not wait to disconnect nonexistent
  players. Ordinary restart requires a running target.
- `restartScheduling` and `plannedRestart` are separately observed Leaf
  capabilities. Old clients omit optional request fields at their defaults;
  an old Leaf must not receive new restart options and silently restart now.
- `restartDelaySeconds` and `restartOnly` are part of the immutable request
  fingerprint, including encrypted outbound commands. `restartOnly` requires
  explicit restart consent and an empty changes map.
- The Leaf persists `stopNotBeforeUtc` when it accepts the operation. API queued
  time is not a countdown: no deadline is invented before Leaf acceptance.
- Initial notice, every whole minute, then 60, 30, 20, 10 through 1 seconds.
  Align ticks to the saved deadline, not to completion of each network request.
  Late recovery skips elapsed warnings, never sends a catch-up burst or resets
  the deadline. Closing Garden does not cancel accepted work.
- Persist a notice claim before sending. Native chat has no end-to-end
  idempotency receipt, so a lost acknowledgment remains `delivery-unknown`.
  Do not duplicate the claimed warning. Announcement errors are not settings
  failure and cannot stop the countdown from reaching its next durable phase.
- A native command acknowledgment is not evidence a player displayed/read it.
  Show `unavailable` when there is no adapter, and show that fact in the review.
- Only fixed commands built from the validated seconds number are allowed.
  No arbitrary shell/console strings, user-selected hosts, public administration
  listeners, secret command arguments or implicit plugin installation.
- A settings apply keeps encrypted configuration recovery and native/game-owned
  readback. An ordinary planned restart stops/starts the **same container** and
  never invokes environment replacement, file writing, world selection or
  retained-container cleanup. A forced stop must not be called graceful.
- Runtime health, configuration verification and client readiness remain
  separate claims. Never use a synthetic workflow to qualify an exact image.

## Transport inventory

All rows have the shared durable countdown. Minecraft, V Rising, Factorio,
Project Zomboid, Garry's Mod and both Terraria variants have native adapters in this candidate. RCON
adapters require existing credentials, a configured port and an observed private
container address. They never enable RCON, publish a port or change credentials.
Source/protocol tests are not real-player qualification. Other rows remain
**Dauva-only** until their adapter and exact runtime are qualified.

| Game / variants | Native or optional route investigated | Candidate status |
| --- | --- | --- |
| Minecraft Paper / Fabric | Installed itzg local `rcon-cli say`; no extra plugin | Fixed-command adapter and bounded Docker-protocol tests. No real client-display qualification in this work. |
| V Rising PvE / PvP | Built-in RCON `announce` | Candidate adapter with configuration/packet tests. Existing Seeds disable RCON, so no warnings become available silently. Live legacy settings/world remain protected. Exact game response/client display still needs qualification. |
| Factorio latest / stable | Built-in RCON and normal `/shout` chat; no Lua `/c` commands | Existing private credentials only. One exact catalog image passed disposable real-server acknowledgment, same-container restart, fresh startup and a second acknowledgment. This does not qualify every release or client display. |
| Project Zomboid private / community | Native RCON `servermsg` | Candidate adapter reads the current native RCON credentials, never the join password. Published settings persistence evidence is not chat evidence. |
| Garry's Mod Construct / Flatgrass | Source RCON `say` | Candidate adapter requires existing native RCON credentials and the observed configured game port. A2S readback is not command-access proof. |
| Terraria vanilla | Fixed `say` over the exact owned container's already-open non-terminal stdin | Adapter implemented and disposable exact-image console submission/restart tested. Socket submission is reported as `submitted`, not proof of game execution or player display. Never change vanilla to TShock silently. |
| Terraria TShock | Same safe console route; native broadcast REST API also investigated | Console adapter implemented and exact-image disposable test passed. REST would need a separate private authenticated adapter; not enabled here. The existing TShock Seed is the opt-in variant. |
| Valheim vanilla / BepInEx | Optional **ValheimRcon** adds global `say` | Candidate only, not installed/qualified. Vanilla must explicitly opt into a modded Seed; test BepInEx/game/plugin/client compatibility. |
| Satisfactory stable / experimental | Investigate **Ficsit Remote Monitoring** and its chat/API facilities | Broader mod, not a minimal announcement-only dependency. No decision to include; verify SML, dedicated-server support, client requirements and exact game compatibility. |
| Core Keeper normal / hard | Mod support exists, but no reviewed announcement plugin was identified | Dauva-only. Do not infer server-only compatibility from a mod loader existing. |
| Enshrouded native / Wine | No reviewed native broadcast or announcement-plugin route identified in this investigation | Dauva-only; do not advertise a speculative adapter. |

Terraria requires observed `OpenStdin=true`, `StdinOnce=false`, `Tty=false`.
The adapter never changes those settings or recreates a game to enable them.
Current provisioners do not opt containers into stdin; an existing deployment
without it therefore remains **Dauva-only**, even though the adapter exists.
The disposable tests enable stdin only on their newly created test containers.
Successful socket writing is `submitted`; cancellation closes the upgraded
connection within the bounded deadline without closing persistent game stdin.

The shared review is used by both Care and admin Restart. The legacy power API
remains for compatibility; this candidate does not claim to intercept external
callers, all older clients or separate future maintenance entry points.

## Primary sources reviewed

- [itzg command transport](https://github.com/itzg/docker-minecraft-server/blob/master/docs/sending-commands/commands.md)
  and [RCON configuration](https://github.com/itzg/docker-minecraft-server/blob/master/docs/configuration/server-properties.md).
- [V Rising 1.1 PC hosting/RCON configuration](https://github.com/StunlockStudios/vrising-dedicated-server-instructions/blob/master/1.1.x-pc/INSTRUCTIONS.md).
  Historical commands alone are not current-build qualification.
- [Factorio console](https://wiki.factorio.com/Console) and
  [Factorio image](https://github.com/factoriotools/factorio-docker).
- [Project Zomboid RCON client author's command implementation](https://github.com/JMWhitworth/zomboid_rcon)
  and [Source RCON protocol](https://developer.valvesoftware.com/wiki/Source_RCON_Protocol).
  These establish protocol/command candidates, not qualification of Dauva's exact images.
- [TShock broadcast API](https://tshock.readme.io/v4.3.24/reference/v2serverbroadcast)
  (versioned reference; verify current source before implementation) and
  [TShock commands source](https://github.com/Pryaxis/TShock/blob/general-devel/TShockAPI/Commands.cs).
  Current [REST source](https://github.com/Pryaxis/TShock/blob/general-devel/TShockAPI/Rest/RestManager.cs)
  requires broadcast permission; do not rely on older documentation suggesting
  otherwise. [Vanilla image stdin guidance](https://hub.docker.com/r/brammys/terraria).
- [ValheimRcon author repository](https://github.com/Tristan-dvr/ValheimRcon):
  BepInEx configuration, nonempty password, IP filtering and global `say`.
  Its broader command surface requires a narrow Dauva adapter and private access.
  Redistribution licensing was not established by this investigation; that is
  another explicit gate before bundling or publishing this optional plugin.
- [Ficsit Remote Monitoring author repository](https://github.com/porisius/FicsitRemoteMonitoring),
  [modding-team overview](https://docs.ficsit.app/satisfactory-modding/latest/Development/OpenSourceExamples.html),
  [server installation constraints](https://docs.ficsit.app/satisfactory-modding/v3.8.0/ForUsers/DedicatedServerSetup.html).
- [Core Keeper modding team's multiplayer guidance](https://github.com/CoreKeeperMods/Core-Keeper-Docs/blob/main/playing-with-mods/installing-mods/for-multiplayer.md):
  mismatched mods/versions can prevent joining; server-only assumptions need evidence.

## Qualification before promotion

See [the disposable runtime observations](evidence/restart-announcements-20260910.json)
for exact container digests, candidate binary fingerprint and limits. The three
tests observe fresh post-restart startup logs and submit a second warning;
they do not have a connected player or certify downloaded game-build versions.
They are evidence for transport and non-replacing restart, not signed Seed proof.

Use a disposable persistent world, never an owner's live V Rising data or its
recovery copies. Record exact game/image/plugin/Leaf versions. Test actual player
visibility at minute marks and 30/20/10…1, graceful saving, delayed/failed chat,
Leaf process recovery, reconnect, duplicate clicks and client reconnection after
restart. Test all Seed variants independently. Keep management ports private.
Pin reviewed plugin artifacts and document license, required clients and update
compatibility. Explicitly approve any new modded Seed; no auto-install fallback.

Roll out compatible Leaf/helper first, then API and Garden. Windows validation
is Windows 11 only. These source changes do not upgrade a game image or qualify
the legacy V Rising settings path.
