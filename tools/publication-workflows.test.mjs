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

test("reusable workflows activate only behind exact trust and OIDC boundaries", async () => {
  const publication = await workflow("_seed-studio-publication.yml");
  const deployment = await workflow("_seed-registry-deploy.yml");
  for (const document of [publication, deployment]) {
    assert.match(document, /workflow_call:/);
    assert.match(document, /--phase activation/);
    assert.match(document, /publication-preconditions\.mjs/);
    assert.match(document, /branches\/\$branch\/protection/);
    assert.match(document, /id-token:\s*write/);
    assert.doesNotMatch(document, /--phase foundation/);
  }
  assert.match(publication, /actions\/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1/);
  assert.match(publication, /git push origin "HEAD:refs\/heads\/\$BRANCH"/);
  assert.match(publication, /gh pr create/);
  assert.doesNotMatch(publication, /gh pr (?:merge|review)/);
  assert.match(deployment, /runs-on: \[self-hosted, Linux, X64, dauva-seed-deploy\]/);
  assert.match(deployment, /sudo --non-interactive \/usr\/local\/sbin\/dauva-seed-registry-deploy/);
  assert.doesNotMatch(deployment, /ssh|DEPLOY_SSH|KNOWN_HOSTS/);
  assert.match(deployment, /publication-workflow-client\.mjs deployment/);
  assert.doesNotMatch(deployment, /git\s+push|gh\s+pr\s+(?:create|merge|review)/);
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
  assert.match(document, /publication-workflow-client\.mjs claim/);
  assert.match(document, /--publication-id "\$\{\{ inputs\.publication_id \}\}"/);
  assert.match(
    document,
    /--publication-attempt "\$\{\{ inputs\.publication_attempt \}\}"/,
  );
  assert.match(document, /id-token:\s*write/);
});

test("deployment entry points never deploy ordinary merges", async () => {
  for (const name of [
    "seed-registry-deploy-develop.yml",
    "seed-registry-deploy-production.yml",
  ]) {
    const document = await workflow(name);
    assert.match(document, /resolve-publication-merge\.mjs/);
    assert.match(document, /if: needs\.identify\.outputs\.publication_id != ''/);
    assert.match(document, /cancel-in-progress: false/);
    assert.match(document, /_seed-registry-deploy\.yml@main/);
  }
});
