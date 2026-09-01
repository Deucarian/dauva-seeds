# Dauva event source conventions

`registry/dauva-events.json` is the reviewed, machine-readable catalog for
Dauva event applications, components, environments, and known event types. It
is validated by `schemas/dauva-event-catalog-v1.schema.json` and embedded in the
compiled Registry so consumers can resolve stable metadata without inventing
provider-specific identities.

The catalog describes identity and discovery metadata. The Portal database is
the operational registry and retains archived entries so historical events
remain readable. Display names, icons, repository mappings, and ownership may
change; UUIDs and slugs do not.

## Adding a source

1. Add or reuse one application and component in the catalog. A repository may
   map to more than one component only when the runtime boundary is genuinely
   distinct.
2. Add each stable dotted event type with its category, source, and a safe
   description. Types describe facts in past tense, such as
   `workout.session.completed`; they never name a destination.
3. Increment this package's semantic minor version, compile the Registry, and
   review the resulting digest.
4. Add the identical application/component mapping to the Portal operational
   seed. Deploy that registry before enabling the producer.
5. Give the producer a component-bound ingest credential through its deployment
   secret store. Never put the credential in this repository.
6. Emit through a transactional outbox when the source business transaction is
   outside the Portal database.

## Canonical producer rules

- Use schema `1.0` and a registered application, component, and environment.
- Provide a stable source event ID and source delivery ID before the first
  request. A transport timeout is unknown; retry the exact body and delivery ID.
- Keep titles, messages, attributes, subjects, tags, and action URLs bounded and
  safe for every destination. Never include tokens, passwords, raw stack traces,
  query-string credentials, private hostnames, or personal data not required by
  the authorized audience.
- Use a stable deduplication key for the same real-world fact. Do not collapse
  distinct conclusions, attempts, state transitions, or incidents.
- State at least one audience. Authorization is data, not a UI convention.
- Set `suppressExternalDelivery` for useful history that should stay quiet, such
  as successful CI or a user's completed workout.
- Carry correlation, trace, span, incident, fingerprint, causation, origin
  destination, and recursion depth when they exist. Derived notifications must
  never loop back into their origin.

## GitHub Actions

Organization workflows call
`Deucarian/.github/.github/workflows/report-dauva-event.yml`. The caller maps its
repository to registered coordinates and supplies a delivery ID containing the
repository ID, workflow run ID, and run attempt. All terminal conclusions enter
Activity. Only failures are externally actionable by default.

The workflow signs the exact compact JSON body and uses the same identity for
bounded retries. A 20-second request timeout does not prove rejection; the
Portal's durable deduplication makes a later identical callback safe.

## Runtime services

Services such as Workout first insert a local outbox row in the same transaction
as the session transition. A background worker claims it with a lease and sends
the signed canonical event. A lost response, process restart, or expired lease
resumes the same row and delivery ID. Only an accepted response marks it
delivered; bounded retries eventually produce an observable local dead letter.

Leaf, control-plane, installation, Sprouting, backup, restore, update,
migration, adoption, and deletion sources must additionally follow the durable
asynchronous-operation policy. An event may describe accepted/queued progress
immediately, but only authoritative durable terminal state may describe final
completion, failure, cancellation, or expiry.
