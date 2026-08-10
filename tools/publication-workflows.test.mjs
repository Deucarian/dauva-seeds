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
    assert.match(document, /cancel-in-progress: false/);
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
