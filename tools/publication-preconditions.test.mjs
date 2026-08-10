import assert from "node:assert/strict";
import test from "node:test";
import { inspectPublicationPreconditions } from "./publication-preconditions.mjs";
import { ed25519KeyId } from "./proof-crypto.mjs";

const root = (purpose, subjects, byte) => {
  const publicKey = Buffer.alloc(32, byte);
  return {
    purpose,
    keyId: ed25519KeyId(publicKey),
    publicKey: publicKey.toString("base64url"),
    subjects,
    status: "active",
    addedAt: "2026-08-10T10:00:00.000Z",
    revokedAt: null,
  };
};
const valid = {
  phase: "activation",
  environment: "develop",
  targetRef: "refs/heads/develop",
  apiOrigin: "https://develop.jorishoef.nl",
  activation: "enabled-v1",
  repository: {
    id: 1311366821,
    full_name: "Deucarian/dauva-seeds",
    archived: false,
    disabled: false,
  },
  protection: {
    required_pull_request_reviews: {
      required_approving_review_count: 1,
      dismiss_stale_reviews: true,
    },
    required_status_checks: { strict: true, contexts: ["validate"] },
    enforce_admins: { enabled: true },
    required_conversation_resolution: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
  },
  verificationRoots: {
    keys: [
      root("studio_export", [
        "env:develop",
        "repo:deucarian.dauva-seeds",
        "target:develop",
      ], 1),
      root("proof_api", ["env:develop"], 2),
      root("proof_leaf", ["env:develop", "leaf:proof-1"], 3),
    ],
  },
};

test("activation accepts only an exact protected and trusted environment", () => {
  assert.deepEqual(inspectPublicationPreconditions(valid), {
    ready: true,
    environment: "develop",
    targetRef: "refs/heads/develop",
    issues: [],
  });
});

test("Phase 1 remains non-activating even with future configuration present", () => {
  const result = inspectPublicationPreconditions({ ...valid, phase: "foundation" });
  assert.equal(result.ready, false);
  assert.deepEqual(result.issues, ["phase1.non-activating"]);
});

test("crossed environments and unavailable protection fail closed", () => {
  const result = inspectPublicationPreconditions({
    ...valid,
    targetRef: "refs/heads/main",
    apiOrigin: "https://jorishoef.nl",
    protection: { status: 403 },
    verificationRoots: { keys: [] },
  });
  assert.equal(result.ready, false);
  assert.ok(result.issues.includes("target-ref.crossed"));
  assert.ok(result.issues.includes("api-origin.crossed"));
  assert.ok(result.issues.includes("branch-protection.unavailable"));
  assert.ok(result.issues.includes("trust.studio-export-root-missing"));
});

test("missing review, status, admin, conversation, and immutable-ref controls fail", () => {
  const result = inspectPublicationPreconditions({
    ...valid,
    protection: {
      required_pull_request_reviews: {
        required_approving_review_count: 0,
        dismiss_stale_reviews: false,
      },
      required_status_checks: { strict: false, contexts: [] },
      enforce_admins: { enabled: false },
      required_conversation_resolution: { enabled: false },
      allow_force_pushes: { enabled: true },
      allow_deletions: { enabled: true },
    },
  });
  assert.equal(result.ready, false);
  assert.ok(result.issues.length >= 6);
});
