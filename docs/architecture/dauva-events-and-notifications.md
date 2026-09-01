# Dauva Events & Notifications architecture

This is the canonical cross-repository architecture for Dauva's event,
Activity, incident, subscription, destination, and delivery platform. The
versioned machine catalog is `registry/dauva-events.json`. The Portal API owns
the operational event registry and durable dispatcher; other applications are
producers through signed ingest.

## Separate concepts

- **Event** — one immutable structured fact. It has no provider-specific
  routing behavior.
- **Incident** — the existing correlated, actionable Dauva problem: reference,
  fingerprint, occurrence count, status, safety, retryability, operation
  timeline, technical detail, and trace context. Not every failed event is an
  incident.
- **Activity** — an authorized user projection of events with read and follow
  state, filters, pagination, details, and live attention.
- **Subscription** — a provider-neutral rule selecting authorized events for
  attention or external delivery.
- **Destination** — one configured Portal, email, native push, Discord, Teams,
  or generic webhook target.
- **Delivery** — the durable state of sending one event to one destination.
  States are pending, processing, retrying, delivered, and dead-letter.

An event is stored once. Audiences are separate rows; Dauva never creates one
copy per administrator.

## Stable registry identity

Applications and components have stable UUIDs and slugs, separate display
metadata, active/archive state, repositories, environments, ownership, icon,
and timestamps. Current hierarchy:

- `jorishoef-portal`: `api`, `flutter-web`;
- `workout`: `api`, `web`;
- `dauva`: `control-plane`, `leaf`, `seed-registry`, `seed-studio`.

Display names may change. UUIDs/slugs do not. Archived metadata remains
resolvable for history. Repository and source names are mappings, not
application identity. Valid environments are `local`, `ci`, `development`,
`acceptance`, and `production`.

Register a new application in the catalog and Portal operational seed before
enabling its producer. Existing users need no preference migration because
default following is open-ended.

## Canonical event v1.0

Required fields are registry coordinates, environment, source, dotted type,
category, status, severity, code, bounded title/message, occurrence time, and
at least one audience. The contract also supports server event ID, source event
and delivery IDs, subject, deduplication key, fingerprint, incident,
correlation/trace/span IDs, safe action, bounded attributes/tags, causation,
origin destination, recursion depth, test marker, and external-suppression
marker.

Unknown additive JSON fields are ignored by v1 consumers. Incompatible meaning
requires a new schema version and an overlap period. Unknown event types remain
displayable and followable; consumers route on stable fields, never message
text.

Example:

```json
{
  "schemaVersion": "1.0",
  "sourceEventId": "1839123:2",
  "sourceDeliveryId": "github-123-1839123-2",
  "applicationId": "workout",
  "componentId": "api",
  "environment": "production",
  "source": "github-actions",
  "type": "ci.workflow-run.completed",
  "category": "ci",
  "status": "failed",
  "severity": "error",
  "code": "github.workflow-run.failure",
  "title": "Workout API deployment failed",
  "message": "The production workflow completed with failure.",
  "subject": { "type": "repository", "id": "Deucarian/jorishoef-workout-api", "title": "Deploy Workout API" },
  "occurredAtUtc": "2026-09-01T11:42:00Z",
  "deduplicationKey": "github:Deucarian/jorishoef-workout-api:1839123:2:failure",
  "action": { "label": "Open GitHub run", "url": "https://github.com/Deucarian/jorishoef-workout-api/actions/runs/1839123" },
  "attributes": { "branch": "main", "attempt": "2" },
  "tags": ["ci", "github", "failure"],
  "audience": [{ "kind": "role", "value": "admin" }]
}
```

### Taxonomy

Types describe facts in past tense: `ci.workflow-run.completed`,
`world.status.changed`, `service.request.failed`,
`workout.session.completed`, and
`incident.opened/repeated/escalated/resolved/reopened`.
Categories are broad stable views such as `ci`, `incident`, `worlds`,
`workout`, `security`, and `notification`.

Severities are `debug`, `info`, `warning`, `error`, and `critical`. Severity
describes impact. Status describes outcome or lifecycle, commonly `succeeded`,
`failed`, `degraded`, `action-required`, `repeated`, `recovered`, or
`resolved`. Provider conclusions map to status; they do not create new severity
enums.

## Authentication and idempotency

External sources use `POST /api/integrations/events/v1` with:

```text
X-Dauva-Application
X-Dauva-Component
X-Dauva-Delivery
X-Dauva-Timestamp
X-Dauva-Key-Id
X-Dauva-Signature-256
```

HMAC-SHA-256 covers the exact bytes:

```text
timestamp + "\n" + delivery + "\n" + application + "\n" + component + "\n" + body
```

Credentials bind one application/component/key ID. Verification uses a
five-minute replay window, constant-time comparison, a 64 KiB maximum, rate
limiting, exact header/body binding, and safe responses. Rejected requests do
not create Activity. Add a new key before disabling the old one during
rotation.

Application, component, source, and source delivery/source event/deduplication
identity form durable unique boundaries. Producers allocate identity before the
first request. A 10-, 20-, or 100-second client/proxy timeout means unknown,
never failed. Retry the exact mutation identity. A duplicate returns successful
idempotent acknowledgement.

## Publishing and outboxes

Portal-owned sources call `IDauvaEventPublisher`. It validates the registry,
schema, bounds, audience, action URL, tags, and redaction, then commits event,
audience, tags, and one outbox message in one database transaction.

An application with a separate database uses its own transactional outbox.
Workout writes its session transition and canonical payload together, then a
leased worker sends the exact payload to Portal ingest. This keeps producer
availability independent from Portal transport availability without adding an
external broker.

Workers claim rows atomically with expiring leases. Only the current lease
owner may confirm success, retry, or failure. Late responses cannot move state
backwards. Retries use bounded exponential backoff with stable jitter. Outbox
and destination attempts have finite budgets and observable dead-letter state.
Restarts resume pending, retrying, or expired leased work.

## Authorization, following, and read state

Authorization precedes matching, search, filters, metadata, pagination, SSE,
and diagnostics. Audiences select authenticated users, a user UUID, role, or
permission. A subscription never broadens an event audience.

User following defaults to `AllExcept` across applications, components,
environments, sources, types, categories, statuses, severities, subjects, and
tags. Sparse exclusions are stored only for explicit mutes and always win.
`OnlySelected` is an advanced deliberate restriction.

Consequences:

- a new app/component/type is followed automatically;
- a muted item is excluded from Following, unread attention, live attention,
  and that user's external destinations;
- the same event remains searchable in authorized **All activity**;
- read state is per user and does not change follow state;
- disabling a destination always prevents sends;
- default following never invents or verifies a channel.

Subscription precedence is:

1. event audience authorization;
2. destination enabled and configured;
3. subscription enabled and scoped to the authorized user/role/admin target;
4. explicit event/user exclusions;
5. positive selectors (`OnlySelected` requires a match);
6. status/severity default policy;
7. delivery mode/quiet-hours policy when configured.

Selectors use OR within one dimension and AND across dimensions. Separate
rules express cross-dimension OR and deduplicate to one event/destination
delivery.

Immediate rules are eligible when their durable delivery row is created.
Digest rules defer each selected row to the next UTC hour boundary. Optional
`HH:mm` quiet hours are evaluated in the subscription time zone, including
overnight intervals and daylight-saving gaps. Critical, action-required,
escalated, and repeated-incident events bypass both delays. This version keeps
one canonical event per delivery; it does not combine multiple events into one
provider message. That preserves event-scoped retries, receipts, and
idempotency while leaving aggregate digest rendering as an explicit future
extension.

Example rules:

```json
{
  "name": "Production failures except Workout CI",
  "scopeMode": "AllExcept",
  "selectors": { "environment": ["production"], "status": ["failed", "degraded"] },
  "exclusions": { "component": ["workout/api"], "category": ["ci"] },
  "deliveryMode": "immediate"
}
```

```json
{
  "name": "Workout only",
  "scopeMode": "OnlySelected",
  "selectors": { "application": ["workout"] },
  "exclusions": { "status": ["succeeded"] }
}
```

## Seeded policy

- Portal Activity: all authorized events, `AllExcept`, enabled.
- Actionable status: failed, degraded, action-required, or repeated events are
  eligible for every enabled applicable user destination.
- Warning/error severity: warning, error, and critical are eligible through a
  separate deduplicated rule.
- Critical incident: incident category plus critical severity, immediate.
- CI success and other explicitly quiet events: durable Portal Activity with
  external suppression.
- CI failure: Activity plus enabled applicable external destinations.
- First ordinary retryable incident: `incident.opened` Activity only.
- Third unresolved occurrence: `incident.repeated`, externally actionable.
- Non-retryable/critical/unexpected/verification/rollback failure: immediate.
- Resolved incident: Activity with status recovered; later matching regression
  becomes `incident.reopened` and can attract attention again.

## Destinations

`IDauvaDestinationAdapter` keeps routing independent from sources. Implemented
adapters:

- Portal durable Activity plus authorized SSE projection;
- existing SMTP email;
- existing native push;
- Discord embed payload;
- Microsoft Teams Adaptive Card payload;
- generic versioned JSON webhook.

Generic webhook envelopes carry schema, event and delivery identities,
registry coordinates, classification, safe presentation, subject, occurrence,
incident/correlation/trace data, action, and bounded attributes. Optional
outbound HMAC covers:

```text
timestamp + "\n" + delivery-id + "\n" + exact-body
```

The request includes `X-Dauva-Timestamp`, `X-Dauva-Delivery`, and
`X-Dauva-Signature-256`. Receivers deduplicate by delivery ID.

Webhook-family destinations require HTTPS; userinfo and secret-shaped action
queries are rejected. In production and development, localhost, loopback,
private, carrier-grade NAT, link-local, unique-local, multicast, documentation,
and unresolved targets are blocked. DNS is resolved and the validated public IP
is pinned for the connection, redirects/cookies are disabled, timeout is 15
seconds, and response reads/errors are bounded. Protected destination config is
never returned by APIs or logged as a full URL.

Origin destination ID and notification depth prevent feedback. A failed
destination never receives an event derived from itself, depth-three webhook
delivery is suppressed, and failures cannot stop other destinations or event
storage.

## Activity and operations

Activity supports cursor-stable server filters for application, component,
environment, source, type, category, status, severity, incident presence,
date range, read state, followed/all, subject, and safe text. Metadata comes
from authorized rows. Details expose safe attributes, tags, incident,
correlation/trace/span, read/follow state, and admin-only delivery summaries.
SSE is an attention projection only; reconnect always pages durable history.
Users can turn an Activity view with provider-neutral event selectors into an
`OnlySelected` immediate or digest rule; the rule applies to their currently
enabled destinations without copying application/type allowlists globally.

Admin health reports pending outbox count/oldest age, pending/retrying/dead
delivery counts, destination health, and recent safe failures. Manual retry
reuses the existing dead-letter delivery ID.

Structured logs include accepted/rejected/deduplicated event identity,
subscription/delivery counts, success, retry, and dead letter. They never
include credentials, bodies, raw external responses, or full webhook URLs.

## Incident integration

The existing incident store remains authoritative. It publishes transition
events linked by incident UUID/reference/fingerprint and preserves operation
timeline, occurrence, safety, retryability, redaction, and trace data. The
event dispatcher does not turn every failure into an incident. CI failures,
for example, remain standalone events unless a source explicitly creates an
incident.

## Migration and compatibility

Additive idempotent schema creation adds registry, event/audience/tag/read,
follow, subscription/destination/link, delivery, and outbox tables and indexes.
Legacy game-world Activity becomes canonical history with its visibility and
read state retained. Historical rows set external suppression and receive no
pending outbox, so migration cannot resend them. Existing disabled world
preferences become sparse exclusions; enabled email/native registrations
become protected destinations. Legacy endpoints and SSE DTOs remain compatible
projections while clients migrate. Legacy GitHub receipt rows remain an
idempotency guard.

Roll forward is preferred. Older binaries ignore additive tables. Do not delete
legacy tables until every deployed client and rollback build is outside the
retention window. Do not replay backfill or replace an uncertain identity.

## Integration guides

### Add a source

Follow [source conventions](dauva-event-source-conventions.md): register
metadata/type, add Portal seed mapping, provision a component-bound secret,
authenticate and parse provider input, map to a bounded event, and publish. No
subscription, Flutter, or destination adapter changes are required.

GitHub repositories call
`Deucarian/.github/.github/workflows/report-dauva-event.yml@main`, using a stable
run delivery ID and the repository secret `DAUVA_EVENT_INGEST_SECRET`. The
Portal API, Portal Flutter, and Workout API callers demonstrate two independent
applications.

### Add a destination

Define a stable kind, protected configuration shape, and one adapter implementing
the provider-neutral destination interface. Keep provider payload formatting in
that adapter. Register it with DI, add safe validation/test behavior, and add
adapter/retry/redaction/recursion tests. Source adapters remain unchanged.

### Verify

Tests cover schema/registry rejection, HMAC/binding/replay/size, additive JSON,
default future apps/types, every exclusion dimension, `OnlySelected`,
authorization before filtering, disabled targets/rules, independent channels,
transactional persistence, restart/lease/retry/dead letter/idempotency, stale
responses, test delivery, bounded errors, provider payloads, recursion, SSRF,
incident escalation/resolution/reopen, GitHub mappings/conclusions, migration,
and Flutter filter/follow/destination behavior. Named 10-, 20-, and 100-second
transport boundaries use controllable clocks rather than real waits.
