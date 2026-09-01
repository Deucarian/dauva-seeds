import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRegistryDigest,
  canonicalJson,
  compiledRegistry,
  normalizeTextLineEndings,
  parseJsonStrict,
  proofReleasesVersion,
  seedReleasesForProof,
  verifyRegistryDigest,
} from "./registry-lib.mjs";

test("deterministic text checks accept platform line endings", () => {
  assert.equal(normalizeTextLineEndings("Dauva\r\nSeed\r"), "Dauva\nSeed\n");
  assert.equal(normalizeTextLineEndings("Dauva\nSeed\n"), "Dauva\nSeed\n");
});

test("strict JSON parsing rejects duplicate object members at every depth", () => {
  assert.deepEqual(parseJsonStrict('{"safe":{"value":1}}'), {
    safe: { value: 1 },
  });
  assert.throws(
    () => parseJsonStrict('{"safe":{"value":1,"value":2}}', "fixture"),
    /fixture: duplicate object member 'value'/,
  );
});

test("canonical JSON is deterministic and rejects unsafe values", () => {
  assert.equal(
    canonicalJson({ z: 0.002, a: [true, null, "Dauva"] }),
    '{"a":[true,null,"Dauva"],"z":0.002}',
  );
  assert.throws(() => canonicalJson(Number.NaN), /finite numbers/);
  assert.throws(
    () => canonicalJson(Number.MAX_SAFE_INTEGER + 1),
    /safe integers/,
  );
  assert.throws(() => canonicalJson({ missing: undefined }), /undefined/);
  assert.throws(() => canonicalJson("\ud800"), /well-formed Unicode/);
});

test("a release candidate proof follows its stable promotion", () => {
  assert.equal(proofReleasesVersion("1.0.0-rc.1", "1.0.0"), true);
  assert.equal(proofReleasesVersion("1.0.1-rc.1", "1.0.0"), false);
  assert.equal(proofReleasesVersion("1.0.0-beta.1", "1.0.0"), false);
});

test("proof receipts remain bound to an immutable historical Seed during an update", () => {
  const current = { id: "example", version: "1.0.1-rc.1" };
  const historical = { id: "example", version: "1.0.0" };

  assert.deepEqual(
    seedReleasesForProof(
      "example",
      "1.0.0-rc.1",
      [current],
      [historical],
    ),
    [historical],
  );
  assert.deepEqual(
    seedReleasesForProof("example", "1.0.1-rc.1", [current], [historical]),
    [current],
  );
  assert.deepEqual(
    seedReleasesForProof("example", "2.0.0", [current], [historical]),
    [],
  );
});

test("legacy proof summaries remain visible without claiming exact binding", () => {
  const seed = {
    id: "example",
    version: "1.0.0",
    status: "stable",
    source: {
      kind: "oci",
      repository: "https://example.com/source",
    },
    proofPolicy: {
      expiresAfterDays: 90,
    },
  };
  const proof = {
    schemaVersion: "dauva.dev/seed-proof/v1",
    seedId: "example",
    seedVersion: "1.0.0-rc.1",
    result: "passed",
    provedAt: "2026-07-26T00:00:00Z",
    leaf: "test-leaf",
  };

  const registry = compiledRegistry([], [seed], [proof]);

  assert.equal(registry.seeds[0].proof.state, "legacy");
  assert.equal(registry.seeds[0].proof.provedVersion, "1.0.0-rc.1");
  assert.equal(registry.seeds[0].proof.expiresAt, "2026-10-24T00:00:00.000Z");
  assert.equal(registry.seeds[0].proof.binding, "legacy-unverified");
  assert.match(registry.seeds[0].proof.receiptDigest, /^sha256:[a-f0-9]{64}$/);
});

test("proof-v2 coverage is exact per architecture and selected without a clock", () => {
  const seed = {
    id: "example",
    version: "1.0.0",
    status: "stable",
    source: { kind: "oci", repository: "https://example.com/source" },
    compatibility: { architectures: ["amd64", "arm64"] },
  };
  const proof = (architecture, completedAt, proofId, receiptCharacter) => ({
    schemaVersion: "dauva.dev/seed-proof/v2",
    receiptPayload: {
      proofId,
      seed: {
        id: "example",
        testedVersion: "1.0.0-rc.1",
        intendedStableVersion: "1.0.0",
      },
      runner: { architecture, leafId: `leaf-${architecture}` },
      result: "passed",
      completedAt,
      expiresAt: "2026-12-01T00:00:00.000Z",
    },
    receiptDigest: `sha256:${receiptCharacter.repeat(64)}`,
  });
  const olderAmd64 = proof(
    "amd64",
    "2026-08-01T00:00:00.000Z",
    "123e4567-e89b-42d3-a456-426614174000",
    "a",
  );
  const newerAmd64 = proof(
    "amd64",
    "2026-08-02T00:00:00.000Z",
    "223e4567-e89b-42d3-a456-426614174001",
    "b",
  );
  const arm64 = proof(
    "arm64",
    "2026-08-01T00:00:00.000Z",
    "323e4567-e89b-42d3-a456-426614174002",
    "c",
  );

  const complete = compiledRegistry(
    [],
    [seed],
    [olderAmd64, arm64, newerAmd64],
  );
  assert.equal(complete.seeds[0].proof.state, "proven");
  assert.equal(complete.seeds[0].proof.binding, "exact");
  assert.deepEqual(
    complete.seeds[0].proof.architectures.map((item) => item.receiptDigest),
    [`sha256:${"b".repeat(64)}`, `sha256:${"c".repeat(64)}`],
  );

  const incomplete = compiledRegistry([], [seed], [newerAmd64]);
  assert.equal(incomplete.seeds[0].proof.state, "unproven");
  assert.deepEqual(incomplete.seeds[0].proof.missingArchitectures, ["arm64"]);
});

test("historical Seed releases remain digest-pinned in the Registry", () => {
  const current = {
    id: "example",
    version: "1.1.0",
    status: "stable",
    source: { kind: "oci", repository: "https://example.com/source" },
  };
  const historical = {
    ...current,
    version: "1.0.0",
  };

  const registry = compiledRegistry([], [current], [], [historical]);

  assert.equal(registry.releases.length, 1);
  assert.equal(registry.releases[0].version, "1.0.0");
  assert.match(
    registry.releases[0].manifestDigest,
    /^sha256:[a-f0-9]{64}$/,
  );
  assert.equal(registry.releases[0].proof.state, "unproven");
});

test("Registry digests are recalculated instead of trusted", () => {
  const registry = compiledRegistry([], [], []);
  assert.equal(verifyRegistryDigest(registry), true);
  assert.equal(assertRegistryDigest(registry), registry.registryDigest);

  const tampered = structuredClone(registry);
  tampered.source.repository = "attacker/example";
  assert.equal(verifyRegistryDigest(tampered), false);
  assert.throws(() => assertRegistryDigest(tampered), /digest mismatch/);
});

test("the compiled Registry carries the versioned Dauva event catalog", () => {
  const eventCatalog = {
    schemaVersion: "dauva.dev/event-catalog/v1",
    contractVersion: "1.0",
    environments: ["production"],
    applications: [],
    eventTypes: [],
  };
  const registry = compiledRegistry([], [], [], [], eventCatalog);

  assert.deepEqual(registry.eventCatalog, eventCatalog);
  assert.equal(verifyRegistryDigest(registry), true);
});
