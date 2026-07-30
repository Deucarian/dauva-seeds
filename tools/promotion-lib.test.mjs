import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPromotionProof,
  candidateManifestDigest,
} from "./promotion-lib.mjs";

const candidate = {
  id: "example",
  version: "1.2.3-rc.1",
  status: "candidate",
  capabilities: {
    update: false,
  },
  inputs: [],
  components: [
    {
      image: `docker.io/example/server@sha256:${"a".repeat(64)}`,
    },
  ],
};

function matchingProof() {
  return {
    schemaVersion: "dauva.dev/seed-proof/v1",
    seedId: candidate.id,
    seedVersion: candidate.version,
    result: "passed",
    checks: {
      imagesPinned: true,
      healthy: true,
    },
    agreements: [],
    evidence: {
      seedManifest: candidateManifestDigest(candidate),
    },
  };
}

test("promotion accepts a proof bound to the exact candidate manifest", () => {
  assert.doesNotThrow(() => assertPromotionProof(candidate, matchingProof()));
});

test("promotion rejects a same-id and version proof with another manifest digest", () => {
  const proof = matchingProof();
  proof.evidence.seedManifest = `sha256:${"b".repeat(64)}`;

  assert.throws(
    () => assertPromotionProof(candidate, proof),
    /not bound to the exact example 1\.2\.3-rc\.1 candidate manifest/,
  );
});

test("promotion rejects a same-id and version proof without a manifest digest", () => {
  const proof = matchingProof();
  delete proof.evidence.seedManifest;

  assert.throws(
    () => assertPromotionProof(candidate, proof),
    /not bound to the exact example 1\.2\.3-rc\.1 candidate manifest/,
  );
});
