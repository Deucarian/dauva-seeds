# Dauva native server platform

Status: **Phase 4 control plane complete; Leaf fleet rollout included in this release**

Last updated: 2026-07-27

This document is the canonical product and architecture design for Dauva's
native game-server platform. Keep it current when the Seed format, registry,
Leaf Agent, storage model, or migration plan changes. Important implementation
decisions that outlive this design should also receive a short ADR.

If this document moves to a future Dauva umbrella repository, leave a link here
to the new canonical location instead of maintaining two copies.

## Summary

Dauva owns the full product model and control plane for creating and managing
Servers. Pterodactyl is no longer a runtime dependency. Existing trusted
Compose Servers remain controllable through the Leaf while they are adopted or
recreated from native Seeds.

The platform has two separate distribution concerns:

1. The **Dauva Seed Registry** stores small, versioned Pod and Seed manifests.
2. An **OCI image registry** stores the container images referenced by Seeds.

Large game installations, saves, mods, and backups do not belong in the Seed
Registry. Active data lives on the selected Leaf; backups live on separate
backup or object storage.

## Goals

- Create, start, stop, restart, inspect, update, back up, restore, and safely
  delete Servers without depending on Pterodactyl.
- Make every installable Server type a curated, versioned, reproducible Seed.
- Keep the portal and public API provider-neutral.
- Support one Debian Leaf first and multiple Leaves later.
- Allocate ports, storage, CPU, and memory safely and predictably.
- Record required license and EULA acceptance server-side.
- Preserve existing Servers while the native Branch is introduced.
- Keep provider-specific credentials and runtime details outside the client.
- Let a non-technical administrator add a supported Server without needing to
  understand Docker, ports, images, storage paths, Seeds, Branches, or Leaves.

## Non-technical product contract

Adding a Server is a guided product flow, not an infrastructure form. The
default path is:

**Choose game → choose recommended variant → name Server → choose simple
gameplay options → accept linked agreements → Sprout**

The Seed provides safe defaults for placement, ports, storage, CPU, memory,
images, protocols, health checks, updates, and backups. Dauva selects a
compatible Leaf automatically. Technical configuration may exist behind an
explicit advanced section, but it must never be required for a supported,
proofed Seed.

The portal implements this contract as a four-step Sprout Wizard: choose a
game, name and configure it, accept any required agreements, and review before
Sprouting. Each Pod declares a recommended Seed for this default path. Other
Seeds, resource controls, game-specific overrides, and autostart remain
available as optional choices rather than mandatory infrastructure decisions.

Every Server-creation and lifecycle feature must meet these rules:

- use player-facing language and explain unfamiliar Dauva terms in context;
- recommend one Seed and one resource preset instead of requiring comparison;
- ask only questions whose answers cannot be derived safely;
- show required disk space, memory, agreements, and likely installation time
  in ordinary language before Sprouting;
- link each license, terms document, or EULA next to its required checkbox and
  record acceptance server-side;
- show visible installation progress and a useful next action when a step
  fails;
- clean up or safely resume partial work after a failed Sprouting operation;
- hide ports, container images, mount paths, environment variables, protocols,
  and Leaf placement from the default flow;
- reserve typed confirmation for destructive actions such as permanent Server
  deletion, not ordinary creation;
- provide a human-readable summary before confirmation and a clear success
  screen with connection details afterward.

A supported Seed is not product-complete if an administrator must consult
external setup instructions, edit a file, select a port, or understand the
underlying container runtime to create its Server. Acceptance testing for every
new Pod or Seed must therefore include the complete default flow from the
perspective of a first-time, non-technical administrator.

## Initial non-goals

- Running arbitrary administrator-supplied container images.
- Reimplementing Kubernetes.
- A public community marketplace in the first release.
- Live migration or automatic high availability between Leaves.
- Building a full browser file manager or SFTP replacement before native
  provisioning is reliable.
- Converting Pterodactyl Eggs into trusted Seeds automatically.

## Product language

| Term | Meaning |
| --- | --- |
| Seed Library | The catalog administrators see in Dauva. |
| Seed Registry | The versioned technical source behind the Seed Library. |
| Pod | One game family containing related Server variants, such as Minecraft. |
| Seed | A complete, approved, reproducible recipe for one Server type. |
| Server | One installed runtime instance with its own data and settings. |
| Sprouting | Provisioning a Server from a Seed. |
| Branch | A replaceable runtime provider used by the Dauva control plane. |
| Leaf | A machine that can host Servers. |
| Leaf Agent | The restricted Dauva service that manages runtime resources on a Leaf. |
| Withered | A failed Sprouting operation or inactive runtime condition, made explicit by accompanying text. |

A Pod is catalog metadata, not a running workload or genre. Genres are Seed
labels used for discovery and filtering. A Seed produces a Server.
A Server can contain multiple runtime components, such as a primary game
container and a backup sidecar.

## What is and is not a Seed

The current Pterodactyl-backed catalog contains candidate profiles derived from
Eggs. Those profiles are not native Dauva Seeds while their installation
behavior still depends on an Egg.

Likewise, a running Server is not copied wholesale into the registry. Its
sanitized and repeatable recipe becomes a Seed.

Seed material includes:

- exact container images;
- runtime components and their relationship;
- ports and protocols;
- persistent volume roles;
- supported inputs and secrets;
- resource requirements and presets;
- agreements;
- health and readiness checks;
- graceful stop behavior;
- update and backup capabilities.

Instance data never becomes Seed material:

- worlds and saves;
- passwords, tokens, and private keys;
- player lists and administrator assignments;
- installed user mods;
- logs;
- generated identifiers;
- actual backups.

## Current baseline

The Debian host was inspected read-only on 2026-07-24.

The current real game Servers are:

- Minecraft, with a separate backup sidecar;
- Valheim;
- Core Keeper;
- Satisfactory;
- Factorio;
- Enshrouded, intentionally stopped at the time of inspection.

These Servers run directly through Docker Compose. Pterodactyl Panel and Wings
are active, but Wings had zero game-server containers and zero server volume
directories at the time of inspection. No live game-server migration out of
Pterodactyl is therefore required before native development starts.

The existing API already provides useful foundations:

- provider-neutral public routes and models;
- `IGameServerProvider` as a replaceable runtime boundary;
- managed instance persistence and reconciliation;
- status and power actions;
- autostart behavior;
- safe deletion;
- a Docker client used for existing Compose-managed Servers.

The API now persists the selected resource preset, resolved non-secret options,
Seed version, Seed manifest digest, and compiled registry digest for every
native Server. Agreement acceptance is stored in a separate audit record with
the Server, Seed, agreement, accepting user, URL, revision, and timestamp.

Seed v1 is implemented as JSON Schema plus stricter policy validation. The
registry contains nine game-family Pods and eighteen sanitized Seeds: two
meaningful variants per Pod. Factorio Stable, Valheim BepInEx, both
Satisfactory branches, and both Enshrouded runtimes passed fresh native
lifecycle proofs and joined the original stable Seeds. Minecraft Paper then
passed its EULA-gated Paper 26.2 lifecycle proof with persistent world data,
ordered restart, and native RCON backups. All twelve original Seeds are stable.
Terraria, Project Zomboid, and Garry's Mod add six stable Seeds. All six passed
fresh disposable lifecycle proofs on the Debian Leaf; their exact
release-candidate versions, manifest digests, agreement revisions, checks, and
proof expiry are retained in committed receipts.

The separately deployable Leaf Agent now owns every privileged host operation.
The API has no Docker socket and Pterodactyl is removed. Newly Sprouted Servers
always use a compatible healthy Leaf. Existing trusted Compose Servers remain
discoverable and controllable through a restricted legacy Leaf contract; they
are never adopted, restarted, moved, or deleted automatically.

## Target architecture

```mermaid
flowchart LR
    Portal["Dauva Portal<br/>Seed Library"] --> API["Dauva API<br/>Control plane"]
    Registry["Dauva Seed Registry<br/>Pods and versioned Seeds"] --> API
    API --> Database["Desired state, instances,<br/>agreements and audit"]
    API --> AgentA["Dauva Leaf Agent A"]
    API --> AgentB["Dauva Leaf Agent B"]
    AgentA --> RuntimeA["Container runtime"]
    AgentB --> RuntimeB["Container runtime"]
    AgentA --> Data["Active Server storage"]
    AgentA --> Images["OCI image registry"]
    AgentA --> Backups["Backup filesystem or object storage"]
```

### Dauva Portal

The portal renders the Seed Library, configuration forms, agreements, progress,
runtime status, and safe lifecycle actions. It never receives provider
credentials or direct Docker access.

### Dauva API

The API is the authoritative control plane. It:

- resolves an exact Seed version and digest;
- validates options and agreements;
- selects a compatible Leaf by capabilities, memory, storage, and free ports;
- persists desired state before provisioning;
- sends idempotent commands to the Branch;
- reconciles desired and observed state;
- stores audit and failure details;
- serves a provider-neutral response to clients.

### Dauva Seed Registry

The initial registry should be Git-backed and compiled by CI into a validated,
immutable index. A database-backed registry service is unnecessary for the
first release.

The API caches the last known valid registry revision. A broken or unreachable
new revision must not remove already installed Seeds or prevent existing
Servers from being managed.

The registry can later be distributed as signed OCI artifacts and support
multiple trusted sources. The Seed Library remains the user-facing name.

The control plane exposes read-only administrator routes for the compiled
Registry, individual Pods, and individual Seeds. Registry mutation remains a
reviewed Git workflow: a portal request cannot silently rewrite trusted Seed
material.

Every Seed records:

- its upstream delivery kind (`oci`, `steamcmd`, `linuxgsm`, or `dauva`);
- official homepage and reviewed source repository;
- permitted image registries and upstream application identifier;
- trust level and review date;
- storage estimates and backup expectation;
- update discovery policy;
- required Leaf capabilities;
- proof policy and current compiled proof summary.

OCI, SteamCMD, and LinuxGSM source adapters normalize upstream metadata into a
draft Seed. They do not bypass curation, digest pinning, agreement review, or
proof promotion.

### Dauva Leaf Agent

The Leaf Agent owns privileged host operations:

- pulling approved images;
- creating networks, containers, and volumes;
- allocating and reserving ports;
- applying CPU and memory limits;
- starting, stopping, and inspecting components;
- collecting logs and health state;
- invoking backup, restore, and update operations;
- deleting runtime resources only after an authorized control-plane command;
- reporting capacity and observed state.

The API container does not receive the Docker socket or active Server storage.
All runtime discovery and mutation, including control of trusted legacy
Compose Servers, crosses the authenticated Leaf contract.

The first extracted Agent uses a control-plane-initiated private HTTP
connection with a unique 256-bit-or-stronger bearer credential. The Agent:

- exposes no unauthenticated management route;
- verifies its Leaf ID, Registry digest, Seed version, and Seed manifest digest;
- advertises the restricted capabilities it implements;
- accepts only declarative commands compiled from a trusted Seed;
- owns the Docker socket and approved storage roots so the API no longer needs
  new direct runtime privileges;
- returns provider-neutral lifecycle results;
- can run a disposable proof without adding a permanent Server record.

### Lifecycle operations

The control plane provides one Server lifecycle model:

- component-aware logs with bounded tail sizes;
- console commands only through a Seed-declared protocol, private RCON port,
  and generated or administrator-owned secret—never a host shell;
- consistent persistent-volume backups, retention, restore, and exact-target
  deletion;
- transactional restore staging so a failed restore keeps the previous data;
- Seed updates and trusted-history rollback, each preceded by a safety backup;
- daily or weekly schedules evaluated in `Europe/Amsterdam`;
- Leaf capacity and health reporting;
- read-only migration discovery for native workloads and trusted legacy
  candidates.

Backups are stored outside the active Server tree. A Leaf reports whether the
backup root resolves to a separate filesystem. Local backups are useful for
operator mistakes but are explicitly shown as not disaster-safe. Large or
important Servers should use a roomy separate disk, mounted backup target, or
future object-storage adapter. The first production Leaf defaults to three
retained archives per Server because its data SSD currently has about 223 GB
free and the media disks are already heavily occupied.

### Multi-Leaf placement

`PORTAL_LEAVES_JSON` configures a fleet without changing the Portal contract.
Each entry has an immutable ID, display name, private URL, bearer token, and
enabled flag. The API rejects unexpected Leaf identities and Registry digests.
Sprouting selects only a healthy Leaf that advertises every required
capability and has sufficient memory, disk headroom, and port capacity.
Existing Server IDs retain their Leaf identity, so later fleet changes cannot
silently move a Server.

### Seed releases

The Registry keeps the current stable Seed plus immutable historical releases.
Preparing a new candidate archives the previous stable manifest before it can
be replaced. Rollback accepts only a historical manifest whose ID, version, and
digest match the recorded deployment. The optional `console` contract is
validated against an existing component, private TCP RCON port, and declared
secret.

TLS termination is not required on the private Compose network. Connections
that leave a private host or overlay network must use HTTPS or mTLS. Bearer
authentication is the first single-Leaf transport, not the final multi-Leaf
enrollment design.

### OCI image registry

Seeds reference images by immutable digest. Mutable tags such as `latest` and
`stable` can be shown as channels but cannot be the stored runtime identity.

Game binaries should not automatically be baked into very large images.
SteamCMD-based Seeds may use a small trusted runtime image and install game
content into persistent Leaf storage on first Sprouting. A Leaf-local download
cache can be added later.

## Seed v1 requirements

A Seed v1 manifest must be declarative and contain at least:

- `schemaVersion`;
- immutable Seed `id`;
- semantic `version`;
- `podId`;
- one or more discovery `genres`;
- localized title and description;
- supported operating systems and CPU architectures;
- one or more runtime components;
- an immutable image digest per component;
- a primary component;
- ports with protocol, purpose, exposure, and allocation rules;
- volumes with a role such as `data`, `save`, `cache`, or `backup`;
- resource minimums, maximums, and presets;
- typed configuration inputs;
- secret inputs that never receive defaults in the manifest;
- agreements with canonical URL and agreement revision;
- health and readiness checks;
- graceful stop timeout and behavior;
- update, backup, and restore capabilities;
- required restricted runtime capabilities.

Each Seed declares exactly one `podId`. A Pod groups one or more related
Server variants for the same game family, and has no arbitrary per-Pod Seed
limit. The compiled catalog derives membership from the Seeds so Pod and Seed
manifests cannot maintain conflicting lists.

Executable installation behavior belongs in reviewed, signed images. The
registry must not permit arbitrary host shell scripts, privileged containers,
host PID or network namespaces, Docker socket mounts, or unrestricted host
paths.

### Multi-component Servers

A Seed can describe a small workload rather than only one container.

The initial example is Minecraft:

- primary component: the Minecraft Server;
- companion component: the backup worker;
- shared read-only or read-write volumes as explicitly declared;
- a secret file for RCON authentication;
- companion lifecycle tied to the primary Server.

Each component receives Dauva ownership labels and the immutable Server and Seed
identities. Creating the same Server command twice must not create duplicates.

## Storage model

The implemented initial Leaf layout is:

```text
/mnt/data/dauva/
  servers/<server-id>/
    .dauva-owned.json
    volumes/
      data/
      backups/
```

The exact host paths are Agent implementation details and do not appear in
public Seed manifests. Seeds declare logical volume roles; the Agent resolves
those roles to approved storage roots.

On the first Debian Leaf this root lives on `/mnt/data`, the dedicated 1 TB
SSD-backed Docker/data filesystem, not on the 120 GB operating-system SSD or
the nearly full media disks. At the 2026-07-26 capacity review it had about
241 GB available. Container layers already live on the same filesystem through
`/var/lib/docker`, which avoids duplicating multi-gigabyte installations onto
the OS disk.

The initial placement is deliberately conservative:

| Data | Initial location | Reason |
| --- | --- | --- |
| OCI layers and runtime cache | `/var/lib/docker` on the data SSD | large, reusable, and already managed by Docker |
| active saves/config/install volumes | `/mnt/data/dauva/servers` | low-latency persistent storage with the most suitable free capacity |
| disposable proof data | `/mnt/data/dauva-proof/servers` | isolated ownership and easy verified cleanup |
| local companion backups | approved backup volumes under the Server root | first-line recovery only; not disaster recovery |
| future durable backups | separate physical disk or object storage | survives loss of the runtime SSD |

The media merger pool is not used for active game data: it was above 80%
utilization and is optimized for media capacity rather than game-server
latency. A local backup stored on the data SSD is explicitly not called an
off-host or disaster-recovery backup.

Storage rules:

- active saves use persistent Leaf storage;
- disposable download caches are separately identifiable and garbage
  collectable;
- secret inputs are excluded from Seed manifests and ordinary Server records;
- the current single-Leaf implementation supplies secrets ephemerally while
  Sprouting and only to the runtime component that requires them;
- deletion distinguishes runtime cleanup from backup retention;
- updates can require a successful pre-update backup;
- backup retention and quotas are control-plane policy, not arbitrary Seed
  values;
- a future Leaf can advertise storage classes such as `fast`, `bulk`, and
  `backup`.
- the portal shows expected download, installed, and mutable size before
  Sprouting a large Seed;
- the Agent rejects a new Sprout when the approved storage root cannot retain
  the configured free-space reserve after the selected disk allocation.

## Port allocation

Seeds declare logical ports, not fixed public host ports.

Every port declaration includes:

- component;
- internal container port;
- TCP, UDP, or both;
- public or private exposure;
- purpose such as game, query, RCON, voice, or file transfer;
- whether two protocols must share the same public number;
- any environment input that receives the allocated value.

The Leaf Agent allocates ports atomically from configured pools and persists
the complete allocation before starting components. Partial allocation failure
must leave no leaked reservations.

The native Docker Branch now supports single dynamic ports and contiguous
paired allocations. Valheim proved a two-port public UDP pair, while Factorio
proved that a private administration port is not published to the host.

## Agreements and secrets

Required agreements remain unchecked in the portal and are independently
validated by the API.

For every accepted agreement, Dauva stores:

- Server and Seed identity;
- Seed version and manifest digest;
- agreement identifier, canonical URL, and revision;
- accepting user;
- timestamp;
- the explicit accepted value.

Passwords and tokens are never stored in the registry, ordinary instance
options, or Server responses. In the current single-Leaf implementation they
exist only during the Sprouting request and are supplied to the intended
runtime container as required by the game. Durable protected secret storage is
still required before updates, migration, or multi-Leaf reconciliation can
recreate a Server without asking the administrator again.

## Instance identity and persistence

Every managed Server must persist:

- Dauva Server ID;
- display name;
- Seed ID, version, and manifest digest;
- Pod ID;
- Branch and Leaf identity;
- selected resource preset and resolved limits;
- allocated ports;
- logical volume assignments;
- desired autostart mode;
- provisioning and runtime state;
- accepted agreement references;
- created-by and audit timestamps;
- last actionable error.

Installed Servers continue using their pinned Seed version until an explicit
update operation succeeds. Publishing a new Seed version never silently
changes an existing Server.

## Seed sources, updates, and proof promotion

Source discovery and runtime identity are separate:

1. A mutable upstream tag or release feed is checked on schedule.
2. A changed digest creates a reviewable patch release candidate.
3. The previous stable manifest remains untouched.
4. License links, changelog, image source, and policy changes are reviewed.
5. The candidate is Sprouted on a disposable Leaf allocation.
6. Proof verifies pinned images, health stability, all declared public ports,
   backup evidence when claimed, graceful stop, restart, persistent storage,
   and complete cleanup.
7. A passed receipt is stored with Leaf ID, time, agreement revisions, Seed
   digest, Registry digest, non-secret evidence, and receipt digest.
8. Guarded promotion changes that exact candidate to stable.

Automatic checks are allowed. Automatic installation into an existing Server
is not. Existing Servers receive an update offer and remain pinned until an
administrator explicitly requests an update. A new image digest is never
silently substituted at container start.

Proof credentials and required administrator secrets are supplied only for the
disposable request. They are neither written to the Seed nor copied into the
receipt. An upstream image with a known cleartext secret logging path is
rejected during source review even if it otherwise starts successfully.

## Lifecycle and reconciliation

Sprouting is an idempotent, observable workflow:

1. Resolve and validate the exact Seed.
2. Validate options, secrets, resources, and agreements.
3. Persist the desired Server in a pending state.
4. Select the Branch and Leaf.
5. Reserve ports and storage.
6. Pull and verify images.
7. Create all components.
8. Start components in dependency order when requested.
9. Wait for readiness.
10. Mark the Server ready or Withered with an actionable failure.

The browser request ends after step 3 with `202 Accepted`. Steps 4 through 10
run in a durable API worker and are never coupled to the portal's HTTP timeout.
The worker scans both new `pending` records and interrupted `provisioning`
records without a provider identity, including after an API restart. The
portal polls transitional Servers every four seconds and can be closed or
reloaded without cancelling the Sprout.

Retries reuse the same Server ID and reservations. A failure after partial
creation must either reconcile forward or clean up only resources owned by that
Server. A Leaf retry adopts an already complete runtime only when every
component, Seed version, manifest digest, and Registry digest still match.
Otherwise it removes only resources carrying the matching Dauva ownership
identity before rebuilding.

Deletion remains name-confirmed in the API. Runtime resources are removed
before the database record. Backup deletion or retention is an explicit policy
and must not be an accidental side effect.

Once the exact deletion name has been confirmed, provider cleanup and record
cleanup continue independently of the browser request lifetime. A disconnected
portal must not leave a stopped container, Server record, or owned storage
behind after a confirmed deletion.

## Security invariants

- The portal never talks directly to a Leaf runtime.
- Registry inputs are untrusted until schema, policy, signature, and digest
  validation succeeds.
- Images are pinned by digest and come from allowed registries.
- Seeds cannot request privileged mode or arbitrary host mounts.
- The Agent accepts only authenticated, authorized, idempotent commands.
- Agent credentials are unique per Leaf and revocable.
- Secrets are not written to logs, manifests, labels, or command responses.
- Resource limits and storage quotas are enforced on the Leaf.
- Ownership labels prevent Dauva from mutating unrelated containers.
- Destructive operations are auditable.

## Runtime capabilities now owned by Dauva

The Leaf fleet and control plane now provide:

- container and image lifecycle;
- installation behavior;
- port allocation;
- volume creation;
- CPU and memory enforcement;
- runtime state and power actions;
- live console and logs;
- backups and restore;
- scheduled tasks;
- reinstall and update flows;
- node capacity and placement;
- multi-node communication.

Dauva also owns the product-facing catalog, agreements, authentication,
protected instance options, deployment history, high-level status, autostart,
and safe deletion. Browser file management, signed Registry distribution, and
an object-storage backup adapter remain later additions; none is required for
the lifecycle in this release.

## Delivery plan

### Phase 0: contract and registry — complete

- Define and validate Seed v1.
- Convert the six real Compose Servers into draft manifests.
- Treat the existing Pterodactyl-derived profiles as candidates, not native
  Seeds.
- Add Seed version and digest persistence.
- Add complete agreement audit persistence.
- Compile a deterministic Seed Library index in CI.

### Phase 1: Minecraft vertical slice — complete

- Create a native Minecraft Fabric Seed from the proven live configuration.
- Include the backup companion component.
- Pin all images by digest.
- Support one TCP allocation, persistent data, RCON secret handling, EULA,
  resources, health, start, stop, restart, and delete.
- Sprout a disposable test Server without touching the existing Minecraft
  Server.

Acceptance criteria:

- no Pterodactyl API or Egg was involved;
- the API and Docker resources retain a stable Dauva Server identity;
- an API restart preserved control and state;
- failed availability and stopped-health states were actionable and covered by
  regression tests;
- create, healthy status, stop, start, restart, and name-confirmed delete all
  succeeded through the live portal;
- deleting the test Server removed its two containers, private network, owned
  storage, instance record, and agreement audit record;
- the existing Minecraft Server and the other five existing game Servers
  remained uninterrupted.

The acceptance Server used an automatically allocated port in the configured
native pool and was removed after the test. Candidate Seeds were enabled only
for the acceptance window and disabled again after promotion of Minecraft
Fabric `1.0.0` to stable.

### Phase 2: current Server set — complete

Converted, validated, and lifecycle-proven:

1. Valheim;
2. Core Keeper;
3. Factorio;
4. Satisfactory;
5. Enshrouded.

This phase has added dynamic UDP and contiguous paired-port allocation,
UID/GID-aware volume ownership, ephemeral secret handoff, graceful shutdown,
Seed-specific Unix stop signals, crash-only automatic restarts, and larger
owned storage behavior. Heavy proofs ran serially to stay within the current
Leaf's memory capacity.

Live acceptance evidence:

- Factorio completed create, running status, stop, start, restart, and delete
  with a dynamic public UDP port and an internal-only RCON port.
- Core Keeper completed create, running status, stop, start, and delete with
  data and cache volumes on the dedicated data disk. The Hard variant's
  Seed-specific `SIGINT` shutdown completed in three seconds, persisted
  `worlds/0.world.gzip`, stayed stopped, and loaded that exact save on restart.
- Valheim completed create, running status, graceful stop, start, and
  delete-while-running with a contiguous public UDP pair.
- Satisfactory Stable and Experimental each survived their SteamCMD first-run
  retry, became healthy, exposed their TCP/UDP ports, stopped intentionally,
  stayed stopped, and restarted.
- Enshrouded Proton and Wine each completed a fresh roughly 9 GB install,
  reached host-online state, exposed the intended UDP port, stopped, and
  restarted. Wine reused its explicit persistent installation and is the
  recommended default; Proton deliberately revalidates its container-layer
  installation on cold starts.
- Minecraft Paper 26.2 reached healthy and `Done` with `eula=true`, a dynamic
  TCP allocation, and its pinned backup companion. Its world survived an
  ordered stop and restart, the companion wrote a fresh RCON backup after
  recovery, and every disposable resource was removed.
- Every test used a digest-pinned image and enforced CPU and memory limits.
- Secret values were absent from ordinary instance options, and each required
  agreement produced exactly one server-side acceptance record.
- Confirmed running deletion completed container, record, and owned-storage
  cleanup even when the original portal request no longer needed to remain
  connected.

### Phase 3: operational completeness — complete

- daily OCI tag resolution and reviewable Seed update candidates (implemented);
- proof receipts and guarded candidate promotion (implemented);
- source, trust, storage, update, proof, and Leaf capability metadata
  (implemented);
- deterministic proof expiry in the compiled Registry and portal
  (implemented);
- recommended Seeds per Pod and the non-technical four-step Sprout Wizard
  (implemented);
- extracted authenticated Leaf Agent and Registry read API (implemented);
- Terraria, Project Zomboid, and Garry's Mod Pods and six proven Seeds
  (implemented);
- continuously refreshed logs and Seed-gated console (implemented);
- backup, restore, retention, and UI (implemented);
- installed-Server update and trusted-history rollback (implemented);
- scheduled tasks (implemented);
- registry signing and trusted sources;
- Leaf capacity reporting and placement (implemented);
- protected API-side option storage (implemented);
- remove direct Docker access from the API (implemented).

### Phase 4: migration and retirement — in progress

- Adopt or recreate existing Compose Servers one at a time.
- Back up and validate before changing ownership.
- Keep restricted legacy discovery and control through the Leaf during
  migration.
- Pterodactyl is removed after verification that no managed Server depended on
  it.
- Multi-Leaf configuration, health, and placement are implemented; enrolling a
  second physical Leaf remains an operator action.

## Initial decisions

These are the current working decisions and should change only deliberately:

1. The Seed Registry is Git-backed first; a custom registry service comes
   later only if needed.
2. OCI images and large game data are not stored in the Seed Registry.
3. A Seed is curated and reproducible, not an arbitrary Docker launch form.
4. A running Server is source material for a Seed, never copied into the
   registry with its private data.
5. Seeds support multiple components.
6. Existing Servers remain untouched while disposable native Servers prove
   each Seed before it becomes stable.
7. Pterodactyl is not a Dauva Branch or runtime dependency.
8. Docker is the first runtime because it is already present on the Debian
   Leaf; the contract must not permanently depend on Docker-specific client
   behavior.
9. The control plane pushes authenticated commands over a private HTTP network
   for the first Leaf; remote Leaves require a protected transport.
10. Candidate Seeds may be run only by the proof flow or an explicit
    non-production candidate setting.
11. A source image with known cleartext secret logging is ineligible for the
    curated Registry.
12. The first host keeps active data on the dedicated data SSD. Backups use a
    separately mounted configurable root and are labeled local until the host
    confirms that root is a distinct filesystem.
13. Every Pod declares a proven recommended Seed. The API falls back to the
    first available compatible Seed only when an older Registry has no explicit
    recommendation.

## Open design questions

- Which remote backup target should follow the local backup root: NAS or
  S3-compatible object storage?
- When should Git-compiled Seed bundles also be published as signed OCI
  artifacts?
- Which file-management capability is actually required after logs, backups,
  and configuration editing exist in Dauva?
