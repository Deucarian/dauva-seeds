import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = (name) =>
  readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");

test("publication entry workflows are environment-fixed and API-dispatched", async () => {
  const develop = await workflow("seed-studio-publication-develop.yml");
  const production = await workflow("seed-studio-publication-production.yml");
  for (const document of [develop, production]) {
    assert.match(document, /repository_dispatch:/);
    assert.doesNotMatch(document, /workflow_dispatch:/);
    assert.doesNotMatch(document, /contents:\s*write/);
    assert.doesNotMatch(document, /pull-requests:\s*write/);
    assert.match(document, /concurrency:/);
    assert.match(document, /client_payload\.publication_id/);
    assert.match(document, /client_payload\.publication_attempt/);
    assert.match(document, /client_payload\.attempt_token/);
    assert.match(document, /publication_attempt_token:\s*\$\{\{ github\.event\.client_payload\.attempt_token \}\}/);
    assert.match(document, /cancel-in-progress: false/);
    assert.match(
      document,
      /group: seed-publication-(?:develop|production)-\$\{\{ github\.event\.client_payload\.publication_id \}\}/,
    );
    assert.doesNotMatch(document, /group:.*publication_attempt/);
    assert.match(
      document,
      /Deucarian\/dauva-seeds\/\.github\/workflows\/_seed-studio-publication\.yml@main/,
    );
  }
  assert.match(develop, /environment: develop/);
  assert.match(develop, /target_ref: refs\/heads\/develop/);
  assert.match(develop, /api_origin: https:\/\/develop\.jorishoef\.nl/);
  assert.match(production, /environment: production/);
  assert.match(production, /target_ref: refs\/heads\/main/);
  assert.match(production, /api_origin: https:\/\/jorishoef\.nl/);
});

test("reusable publication and deployment foundations cannot mutate or activate", async () => {
  for (const name of [
    "_seed-studio-publication.yml",
    "_seed-registry-deploy.yml",
  ]) {
    const document = await workflow(name);
    assert.match(document, /workflow_call:/);
    assert.match(document, /--phase foundation/);
    assert.match(document, /publication-preconditions\.mjs/);
    assert.match(document, /branches\/\$branch\/protection/);
    assert.doesNotMatch(document, /contents:\s*write/);
    assert.doesNotMatch(document, /pull-requests:\s*write/);
    assert.doesNotMatch(document, /id-token:\s*write/);
    assert.doesNotMatch(document, /git\s+push/);
    assert.doesNotMatch(document, /gh\s+pr\s+create/);
  }
});

test("reusable publication workflow masks and validates exact attempt correlation", async () => {
  const document = await workflow("_seed-studio-publication.yml");
  assert.match(document, /publication_attempt:\s*\n\s*required: true\s*\n\s*type: number/);
  assert.match(
    document,
    /secrets:\s*\n\s*publication_attempt_token:\s*\n\s*required: true/,
  );
  const workflowCallInputs = document.slice(
    document.indexOf("    inputs:"),
    document.indexOf("    secrets:"),
  );
  assert.doesNotMatch(workflowCallInputs, /publication_attempt_token/);
  assert.match(document, /echo "::add-mask::\$DAUVA_SEED_PUBLICATION_ATTEMPT_TOKEN"/);
  assert.match(document, /publication-claim-contract\.mjs/);
  assert.match(document, /--publication-id "\$\{\{ inputs\.publication_id \}\}"/);
  assert.match(
    document,
    /--publication-attempt "\$\{\{ inputs\.publication_attempt \}\}"/,
  );
  assert.match(document, /--run-id "\$GITHUB_RUN_ID"/);
  assert.match(document, /--run-attempt "\$GITHUB_RUN_ATTEMPT"/);
  assert.equal(
    document.indexOf("::add-mask::") <
      document.indexOf("publication-claim-contract.mjs"),
    true,
  );
  assert.doesNotMatch(document, /id-token:\s*write/);
});
