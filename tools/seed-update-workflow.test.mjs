import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/seed-updates.yml", import.meta.url);
const validationWorkflowUrl = new URL(
  "../.github/workflows/validate.yml",
  import.meta.url,
);

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
  assert.match(candidateStep, /npm run compile\r?\n/);
  assert.match(candidateStep, /npm run compile -- --check/);
  assert.doesNotMatch(candidateStep, /npm run check/);

  const prepare = candidateStep.indexOf("npm run updates:prepare");
  const validate = candidateStep.indexOf("npm run validate");
  const compile = candidateStep.search(/npm run compile\r?\n/);
  const verify = candidateStep.indexOf("npm run compile -- --check");
  assert.ok(prepare < validate);
  assert.ok(validate < compile);
  assert.ok(compile < verify);
});

test("draft candidate pull requests prove the stable base without treating RCs as stable fixtures", async () => {
  const workflow = await readFile(validationWorkflowUrl, "utf8");
  const ordinaryProfile = workflow.indexOf(
    "reason=ordinary-or-reviewable-pull-request",
  );
  const trustedClassifier = workflow.indexOf(
    "stable-base/tools/ci-validation-profile.mjs",
  );
  assert.ok(ordinaryProfile >= 0);
  assert.ok(ordinaryProfile < trustedClassifier);
  assert.match(workflow, /stable-base\/tools\/ci-validation-profile\.mjs/);
  assert.match(
    workflow,
    /name: Prove the immutable stable base[\s\S]*?npm run check/,
  );
  const candidateStep = workflow.match(
    /name: Validate and compile-check the generated candidate([\s\S]*?)working-directory: proposed/,
  )?.[1];
  assert.ok(candidateStep);
  assert.match(candidateStep, /npm run validate/);
  assert.match(candidateStep, /npm run compile -- --check/);
  assert.doesNotMatch(candidateStep, /npm run check/);
  assert.match(workflow, /steps\.profile\.outputs\.profile == 'full'/);
});
