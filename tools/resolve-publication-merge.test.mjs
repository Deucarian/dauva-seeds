import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePublicationMerge } from "./resolve-publication-merge.mjs";

const publicationId = "423e4567-e89b-42d3-a456-426614174003";
const event = {
  repository: { id: 1311366821, full_name: "Deucarian/dauva-seeds" },
  ref: "refs/heads/develop",
  before: "a".repeat(40),
  after: "b".repeat(40),
};
const pull = {
  number: 42,
  body: `<!-- dauva-seed-publication:${publicationId} -->`,
  merged_at: "2026-08-10T14:00:00Z",
  merge_commit_sha: "b".repeat(40),
  base: { ref: "develop" },
  head: { ref: "automation/seed-publication/develop/0123456789abcdef" },
};

test("exact protected publication merge is resolved", () => {
  assert.deepEqual(resolvePublicationMerge(event, [pull]), {
    publicationId,
    commitSha: "b".repeat(40),
    previousCommitSha: "a".repeat(40),
    targetRef: "refs/heads/develop",
    pullRequestNumber: 42,
  });
});

test("ordinary merge is a safe no-op", () => {
  assert.equal(resolvePublicationMerge(event, [{ ...pull, body: "ordinary change" }]), null);
});

test("crossed target or duplicate marker fails closed", () => {
  assert.throws(() => resolvePublicationMerge(event, [{ ...pull, base: { ref: "main" } }]));
  assert.throws(() => resolvePublicationMerge(event, [{ ...pull, body: `${pull.body}\n${pull.body}` }]));
});
