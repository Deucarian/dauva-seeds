# Game settings are part of every Dauva game integration

This is a mandatory onboarding and release requirement for **every game and
every Seed variant**, not an optional V Rising feature. A container that boots
is not a complete Dauva integration. Owners must be able to inspect and change
the game's supported server and gameplay settings through the shared Garden
Settings panel, with changes that persist through subsequent normal restarts.

## Coverage and honest boundaries

`contracts/native-game-settings-v1.json` maps all 10 current game families and
20 Seed variants to 12 trusted Leaf profiles. Both Enshrouded runtimes and both
Terraria runtimes have separate profiles; other variants share their game's
adapter. `npm run validate` (and therefore CI and deployment's `npm run check`)
rejects missing mappings, ambiguous primary components, stale mappings and
primary images outside the profile's trusted repositories.

This inventory is **source coverage metadata**, not signed runtime proof. It
does not alter released Seed manifests or authenticate a new image digest.
Existing lifecycle receipts do not prove that settings work in the real game.
Do not invent a receipt, turn a fixture test into a real-game qualification,
or remove an older runtime's capability gate to make the editor appear ready.

Supported settings means every safely representable field from installed
native files, plus reviewed launch options and supported game API settings.
Keep networking, paths, execution, authentication infrastructure and existing
world identity protected. Label world-creation-only fields honestly. Explain
missing generated files, unavailable game API access and unsafe/unsupported
structures; do not silently discard them or expose arbitrary file/shell access.
For example, Satisfactory advanced settings need an owner-provided game API
token and trusted certificate; this does not authorize claiming their server.

## Adding a game or a new runtime image

1. Research the exact image and game version's official configuration and
   startup behavior. Record precedence: defaults, presets, saved files,
   environment, arguments and API. List public/private visibility, join/admin
   passwords, player limits, gameplay and world settings where the game
   supports them. A game without a public-listing control must say so.
2. Add or extend the trusted profile in `dauva-leaf/internal/gamesettings`.
   Bind only known image repositories, paths, environment names and API
   functions. Discover generated values and supply types, masking, bounds,
   choices, help and read-only reasons to the existing shared Garden editor.
   A separate hand-written screen per game is not the default approach.
3. Implement persistence, not merely an environment or JSON substitution.
   Account for startup generators, presets and shutdown-time rewrites. Disable
   overrides or synchronize them without losing untouched effective values.
   Preserve file ownership, other configuration, world volumes and identity.
4. Use the shared durable operation: stable identity before the first request,
   encrypted configuration backup, explicit restart consent, graceful stop,
   re-read after shutdown, safe replacement, write, stopped readback, optional
   start, post-start native/API readback and retained recovery data on failure.
   Observe unknown outcomes using the same identity. A transport timeout must
   never create a failed operation or a second settings mutation.
5. Add a full workflow fixture to `settingsFixtures()` in
   `internal/gamesettings/verification_test.go`. Leaf CI requires every trusted
   profile to have one. Exercise running and stopped saves, another restart,
   untouched values, secret keep/change/clear, visibility where supported,
   startup rewrites, malformed/missing files and protected values. Include
   fake-clock 10-, 20- and 100-second boundaries, lost acceptance, reconnect,
   repeated clicks and stale observations using the existing shared tests.
6. Add every Seed variant and its trusted image to
   `contracts/native-game-settings-v1.json`. Run the registry checks and the
   cross-repository check against the reviewed Leaf checkout:

   ```text
   npm run check
   npm run settings:check-leaf -- ../dauva-leaf
   ```

   The second command runs the Leaf settings tests against this exact catalog
   contract. It rejects invented profile/image mappings and missing workflow
   fixtures. It needs Go on PATH (or `DAUVA_GO_EXECUTABLE`); it needs no Docker,
   credentials or game server. Record both repository revisions in the review.
   Registry CI enforces mapping coverage; Leaf CI enforces profile fixtures.
   The cross-repository command is an explicit integration/release check, not
   an implied cross-repository CI job with access to private repositories.
7. Qualify **each exact new image/variant** on a disposable server, never an
   owner's active world. Use supported hardware and a persistent test world.
   Change a gameplay value, player limit, visibility and password where
   supported; verify native/API values, real client/query behavior, same-world
   save/load and a second restart. Test password clear and incorrect-password
   rejection. Read generated configuration after startup has actually finished.
   Where no game API/query can confirm an option, record the weaker evidence
   and a manual check; a running process or environment echo is not proof.
8. Increment semantic versions of changed packages/runtimes. Any changed Seed
   recipe/image needs a new Seed version and the normal authenticated proof,
   promotion and release flow. Publish compatible API/Leaf builds through
   their signed release paths. Existing servers require a backed-up, explicit
   compatible runtime update when necessary; never recreate a legacy runtime
   that depends on unqualified repairs in its writable layer.

## What success means in Garden

- **Saved configuration verified:** Leaf read back the actual saved bytes and
  startup options, including when the server stays stopped. The game has not
  applied a stopped save until it starts.
- **Post-start configuration verified:** requested native values are present in
  the actual files, without defaults or environment masking a mismatch. Game
  API fields are confirmed through the game API. Launch-only fields confirm
  startup configuration, not successful argument consumption.
- **Game ready:** a distinct game health/query/client result. Do not infer
  connection readiness, lobby visibility or gameplay behavior from a successful
  file write. Some images have no real health check.

Backups in this settings workflow contain configuration, not the whole world.
Unknown observations retain the same durable operation; only authoritative
terminal outcomes may be shown as completed or failed. Secret values must not
enter public snapshots, operation messages, logs or browser persistence.

## Current release boundary (2026-09-06)

The shared Garden editor and API path already exist. Leaf 0.10.2 adds stopped
readback and native-file verification that cannot be fooled by startup
environment/default overlays. All-profile fixture coverage is not all-game
real-runtime qualification. The new V Rising runtime still needs its separate
exact-image qualification and promotion; its legacy runtime gate remains.
Physical sleep/wake testing is unrelated to this contract and is deferred.
