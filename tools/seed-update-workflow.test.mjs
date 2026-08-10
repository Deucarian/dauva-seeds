import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/seed-updates.yml", import.meta.url);

test("the Seed update workflow proves the stable Registry before candidate mutation", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const stableCheck = workflow.indexOf(
    "- name: Verify the stable Registry before preparing candidates",
  );
  const prepareCandidates = workflow.indexOf("- name: Prepare reviewable candidates");

  assert.notEqual(stableCheck, -1);
  assert.notEqual(prepareCandidates, -1);
  assert.ok(stableCheck < prepareCandidates);
  assert.match(
    workflow.slice(stableCheck, prepareCandidates),
    /run: npm run check/,
  );
});

test("candidate validation does not rerun stable-fixture tests after mutation", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const prepareCandidates = workflow.indexOf("- name: Prepare reviewable candidates");
  const publishCandidates = workflow.indexOf("- name: Publish candidate pull request");
  const candidateStep = workflow.slice(prepareCandidates, publishCandidates);

  assert.match(candidateStep, /npm run updates:prepare/);
  assert.match(candidateStep, /npm run validate/);
  assert.match(candidateStep, /npm run compile -- --check/);
  assert.doesNotMatch(candidateStep, /npm run check/);
  assert.doesNotMatch(candidateStep, /npm run compile(?:\r?\n|$)/);
});
