import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyValidationProfile,
  parseNameStatus,
} from "./ci-validation-profile.mjs";

const packageDocument = { name: "@deucarian/dauva-seeds", version: "0.14.5" };
const lockDocument = {
  name: "@deucarian/dauva-seeds",
  version: "0.14.5",
  packages: { "": { name: "@deucarian/dauva-seeds", version: "0.14.5" } },
};
const candidatePackage = { ...packageDocument, version: "0.14.6" };
const candidateLock = structuredClone(lockDocument);
candidateLock.version = "0.14.6";
candidateLock.packages[""].version = "0.14.6";
const changes = parseNameStatus(
  [
    "M\tdist/registry.json",
    "M\tpackage.json",
    "M\tpackage-lock.json",
    "A\tregistry/history/minecraft-paper@1.0.0.json",
    "M\tregistry/seeds/minecraft-paper.json",
  ].join("\n"),
);
const event = {
  repository: { full_name: "Deucarian/dauva-seeds" },
  pull_request: {
    draft: true,
    base: { ref: "main" },
    head: {
      ref: "automation/seed-image-updates",
      repo: { full_name: "Deucarian/dauva-seeds" },
    },
  },
};

function classify(overrides = {}) {
  return classifyValidationProfile({
    event,
    changes,
    basePackage: packageDocument,
    candidatePackage,
    baseLock: lockDocument,
    candidateLock,
    ...overrides,
  });
}

test("an exact draft update PR receives the candidate validation profile", () => {
  assert.deepEqual(classify(), {
    profile: "candidate",
    reason: "draft-generated-candidate",
    baseVersion: "0.14.5",
    candidateVersion: "0.14.6",
  });
});

test("ready, ordinary, and cross-repository pull requests run the full suite", () => {
  assert.equal(
    classify({ event: { ...event, pull_request: { ...event.pull_request, draft: false } } })
      .profile,
    "full",
  );
  assert.equal(
    classify({
      event: {
        ...event,
        pull_request: { ...event.pull_request, head: { ...event.pull_request.head, ref: "feature" } },
      },
    }).profile,
    "full",
  );
  assert.equal(
    classify({
      event: {
        ...event,
        pull_request: {
          ...event.pull_request,
          head: { ...event.pull_request.head, repo: { full_name: "fork/dauva-seeds" } },
        },
      },
    }).profile,
    "full",
  );
});

test("unexpected files, statuses, and incomplete candidate batches fail closed", () => {
  assert.equal(
    classify({ changes: [...changes, { status: "M", filePath: "tools/validate-registry.mjs" }] })
      .profile,
    "blocked",
  );
  assert.equal(
    classify({ changes: changes.filter(({ filePath }) => filePath !== "dist/registry.json") })
      .profile,
    "blocked",
  );
  assert.equal(
    classify({ changes: changes.map((change) => change.filePath.startsWith("registry/history/") ? { ...change, status: "M" } : change) })
      .profile,
    "blocked",
  );
  assert.equal(parseNameStatus("R100\told\tnew")[0].status, "invalid");
});

test("package and lock changes are restricted to the next patch version", () => {
  assert.equal(
    classify({ candidatePackage: { ...candidatePackage, scripts: { check: "echo bypass" } } })
      .profile,
    "blocked",
  );
  assert.equal(
    classify({ candidatePackage: { ...candidatePackage, version: "0.15.0" } }).profile,
    "blocked",
  );
  const modifiedLock = structuredClone(candidateLock);
  modifiedLock.packages[""].dependencies = { unsafe: "1.0.0" };
  assert.equal(classify({ candidateLock: modifiedLock }).profile, "blocked");
});
