# Dauva incidents and observability

Status: canonical architecture contract

Owner: Dauva hosting ecosystem
Schema: Dauva Incident `1.0`

## Purpose

Long-running Server operations must leave durable, safe evidence. A user,
administrator, or developer must not have to reconstruct a failure from a
generic sentence, a disconnected browser request, or uncorrelated host logs.

The Dauva API is the source of truth for operations and incidents. Portal,
Leaf, Seed, provisioner, and optional crash-reporting adapters contribute
context without becoming the incident database.

## Structured failure contract

A failed operation carries an additive `failure` object:

- stable `code` and precise `stage`;
- `retryable`, `severity`, and `unexpected`;
- a safe user message and developer-safe technical details;
- occurrence time and Portal, API, Leaf, Server, and Seed versions;
- safe Leaf, Server, and Seed context;
- safety state, what changed, retained-Server safety/running state, rollback
  state, manual-intervention flag, and next useful action;
- W3C trace/span IDs plus a vendor-neutral correlation ID.

The schema version is `1.0`. Existing v1 responses remain valid because every
new field is optional. New failure codes and stages are additive. Consumers
must preserve unknown fields and must not replace a Leaf failure with a less
precise generic message.

Stable adoption restore-point codes include separate create, source-read,
storage-access, archive-write, archive-verification, connectivity, protocol,
and retained-source-resume outcomes. Adoption adds refused, cutover-failed,
and rollback-failed outcomes.

## Durable model

The control plane persists:

1. one operation identity and idempotency key;
2. an append-only ordered timeline of queued, running, stage, completion, and
   failure events;
3. the bounded result or sanitized failure;
4. one incident occurrence linked to the operation;
5. a grouped incident record keyed by a safe fingerprint;
6. optional problem reports that reference the existing incident.

An incident reference uses the human-copyable form
`DVI-YYYYMMDD-XXXXXXXX`. Repeated matching failures increment the occurrence
count and update the last-seen evidence without rewriting earlier timeline
events.

Problem reports accept optional bounded notes. They never require raw logs,
host paths, archives, credentials, or diagnostic bundles, and they do not
create public GitHub issues automatically.

## Redaction boundary

Before data leaves a Leaf or enters the incident store, Dauva removes bearer
credentials, tokens, passwords, secrets, host filesystem paths, long
runtime-only identifiers, control characters, and unbounded exception text.
Server and Leaf names may be included only where already safe Portal
identities; Docker IDs and host paths are replaced or one-way represented.

Raw logs remain on their normal bounded log surface. Optional Sentry or
Bugsnag adapters may receive crashes and unhandled exceptions after the same
redaction policy, but they are never authoritative and their identifiers do
not replace the Dauva incident reference.

## User and administrator experience

A failed Portal operation says:

- what happened;
- what was and was not changed;
- whether the retained Server is safe and running, or whether that state is
  unknown;
- whether rollback completed;
- the next useful action;
- the copyable incident reference.

When applicable the actions are **Try again**, **View Leaf**, and
**Send problem report**. An unknown outcome never claims that the old Server
is running or that rollback succeeded.

The admin incident inbox groups matching open failures, shows occurrence
count and severity, and opens the immutable operation timeline with
developer-safe diagnostics, versions, safety state, and trace correlation.

## Notification policy

- A first ordinary retryable/transient failure is persisted but does not
  create attention noise.
- The third matching open occurrence is surfaced as repeated failure.
- A non-retryable failure is surfaced as action required.
- Unexpected/unhandled errors, corrupt or failed verification, critical
  safety states, and rollback failure are surfaced immediately.
- A notification level is emitted once per open incident level. The inbox
  remains available even when e-mail or a crash adapter is not configured.

## Trace and log correlation

Portal requests send W3C `traceparent`, `X-Correlation-ID`, and the Portal
version. ASP.NET and Leaf preserve W3C Activity IDs, return correlation/trace
headers, and place IDs in structured failure/timeline records. Outbound Leaf
v1 commands may add `traceparent` and `correlationId`; completions echo them.

This is OpenTelemetry-compatible propagation, not a dependency on a specific
collector. Exporters and storage backends remain replaceable.

## Satisfactory acceptance case

The 2026-07 Satisfactory restore-point incident motivates the contract:

- two user actions became six concurrent restore-point requests because an
  API client used its default 100-second timeout and retried a state-changing
  POST three times;
- Leaf completed six valid approximately 1.966 GB backups/plans and returned
  `499` after the callers disconnected;
- the old Satisfactory Server resumed and remained running;
- approximately 11.8 GB of valid duplicate restore points remained.

The timeout, idempotency, response-loss reuse, and retained-source resume fix
is a separate coordinated change. The incident feature must not silently
alter that behavior.

With this contract, a response loss is recorded as a precise
`dauva.leaf.connectivity` failure at `restore-point-response`, with operation,
incident, trace, Leaf, Seed, and safety context. A failure returned by Leaf is
instead preserved as create, source-read, storage, write, verification, or
resume. The two user-visible failures group into one incident and retain both
operation timelines. No UI may collapse them to “Leaf unavailable or cannot
create restore points.”

## Safe verification

Acceptance uses unit, serialization, schema, redaction, UI parsing, protocol
conformance, and non-destructive dry-run tests. It must not perform a real
Server cutover, delete retained workloads, or upload raw logs.
