# ADR 0001: outbound device-code Leaf enrollment

Status: accepted

Date: 2026-07-25

## Context

Dauva must manage Servers on machines owned by self-hosters and, later, on
Dauva-operated hosting. Requiring inbound firewall rules, public Docker, SSH
credentials, or a vendor-specific hosting API would make onboarding fragile
and couple the control plane to one infrastructure model.

The privileged runtime boundary must move out of the Portal API. Each machine
needs a unique, revocable identity and an explicit human approval step that is
easy to understand from the existing Flutter portal.

## Decision

One persistent **Dauva Leaf Agent** runs on each user-facing Tree. The protocol
and stored device entity retain the internal name `Leaf` for compatibility.

Enrollment follows an OAuth-style device-code flow:

1. The agent generates an Ed25519 machine key pair locally.
2. It asks the Dauva API for a one-time device code and short user code.
3. The operator signs in to the Portal, enters the short code, names the Leaf,
   and approves it.
4. The agent exchanges the device code once for a unique revocable Leaf
   credential.
5. The private key and credential remain in a root-readable Leaf state
   directory.

After enrollment, the Agent initiates outbound HTTPS requests. The first
vertical slice uses short heartbeats with leased commands. A future streaming
transport may reduce latency, but it must preserve the same Agent identity,
command, idempotency, and reconciliation contracts.

No inbound Agent, Docker, or SSH administration port is required. The Portal
never talks directly to the Leaf.

The same protocol is used for:

- a user-owned Linux server;
- a user-owned desktop or home lab;
- a Dauva-owned managed-hosting Leaf;
- a later Windows service implementation.

Managed hosting may add a scheduling and billing gateway, but it must enroll
ordinary Leaves rather than introduce a second provisioning model.

## Security properties

- Device codes expire after ten minutes and are single-use.
- Short user codes contain no credential material.
- Long credentials are random, hashed at rest in the control plane, unique per
  Leaf, and revocable.
- Agent commands are leased, idempotent, and completed with explicit results.
- The Agent validates command type, Seed image digests, resource boundaries,
  paths, ports, and Dauva ownership labels before touching the runtime.
- Server secrets use application-level RSA-OAEP-SHA256 encryption to the
  enrolled Tree's machine key before they are added to commands. The private
  key never leaves the Leaf Agent state directory.

## Consequences

Self-hosters install one small service once instead of downloading a different
script for every Server. Sprouting becomes a portal action after the Leaf is
online.

The control plane needs Leaf, enrollment, capacity, command, and observed-state
records. It also needs clear offline and command-expiry behavior.

Linux x64 and ARM64 plus a Windows AMD64 development package are built from the
same Go source. The Leaf Agent has no web build; the web and Windows Flutter
builds remain Portal clients.
