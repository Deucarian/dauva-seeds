import assert from "node:assert/strict";
import test from "node:test";
import { compiledRegistry, proofReleasesVersion } from "./registry-lib.mjs";

test("a release candidate proof follows its stable promotion", () => {
  assert.equal(proofReleasesVersion("1.0.0-rc.1", "1.0.0"), true);
  assert.equal(proofReleasesVersion("1.0.1-rc.1", "1.0.0"), false);
  assert.equal(proofReleasesVersion("1.0.0-beta.1", "1.0.0"), false);
});

test("compiled proof summaries retain the exact proved version", () => {
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
    seedId: "example",
    seedVersion: "1.0.0-rc.1",
    result: "passed",
    provedAt: "2026-07-26T00:00:00Z",
    leaf: "test-leaf",
  };

  const registry = compiledRegistry([], [seed], [proof]);

  assert.equal(registry.seeds[0].proof.state, "proven");
  assert.equal(registry.seeds[0].proof.provedVersion, "1.0.0-rc.1");
  assert.equal(registry.seeds[0].proof.expiresAt, "2026-10-24T00:00:00.000Z");
  assert.match(registry.seeds[0].proof.receiptDigest, /^sha256:[a-f0-9]{64}$/);
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
