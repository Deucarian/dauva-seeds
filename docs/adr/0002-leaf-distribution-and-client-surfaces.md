# ADR 0002: Leaf distribution and client surfaces

Status: accepted

Date: 2026-07-25

## Context

Dauva has two very different jobs:

1. help a person design and manage a Server;
2. perform privileged runtime work on that person's machine.

Putting both jobs in the Flutter application would make web builds incapable
of doing the real work, give the Windows Portal unnecessary host privileges,
and couple the Server creator to one desktop operating system.

Self-hosters also need to understand what happens after a Seed has Sprouted.
A different generated installer for every Server would duplicate runtime
logic, scatter credentials, and make updates difficult.

## Decision

The existing Flutter Portal contains one nested **Dauva Servers** application.
It owns the visual character-creator flow, Leaf pairing, progress, and
lifecycle controls. The same Flutter source continues to produce web and
Windows Portal clients.

The separate private `Deucarian/dauva-leaf` repository owns one persistent
host Agent. Its artifacts are Linux `amd64` and `arm64` binaries plus a
systemd unit, and a Windows `amd64` binary plus a background-task installer.
It has no web build.

A self-hoster installs the Agent once, enrolls the machine once, and leaves it
running. Sprouting does not download another administrator script. The control
plane sends a normalized, leased Sprout command; the Agent creates the
versioned, labeled Server resources and reports the result.

The first install may be delivered as a checksum-protected archive or a signed
bootstrap package. A public installer must verify a signed release before
installing it. The private GitHub releases used during development are not the
long-term public distribution channel.

A Windows Leaf uses the same Agent protocol and Docker-backed executor as
Linux. The development package registers the Agent as a highest-privilege
startup task under `SYSTEM`; a signed Windows Service wrapper can replace that
packaging detail before public distribution. It is not the Flutter Portal
executable. The Portal remains an unprivileged visual client.

## Repository ownership

| Repository | Owns |
| --- | --- |
| `jorishoef-portal-flutter` | Web/Windows Portal, nested Dauva Servers UX |
| `jorishoef-portal-api` | Leaf enrollment, desired state, commands, reconciliation |
| `dauva-seeds` | Product language, schemas, Pods, Seeds, architecture |
| `dauva-leaf` | Privileged Agent, runtime validation, packaging |

## Consequences

- Portal releases cannot accidentally gain Docker privileges.
- One Agent update improves every Server on a Leaf.
- The self-hosted and future managed-hosting paths use the same Leaf protocol.
- Public Agent signing, update policy, rollback, and compatibility windows are
  explicit product work.
- Linux and Windows use one command contract while keeping platform-specific
  capacity probes, shutdown behavior, and installers explicit.
