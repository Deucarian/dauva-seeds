import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readJson, readManifestDirectory, repositoryRoot } from "./registry-lib.mjs";
import { nativeSettingsContractIssues, missingWorkflowTests } from "./native-settings-contract.mjs";

const contract = await readJson(path.join(repositoryRoot, "contracts/native-game-settings-v1.json"));
const seeds = (await readManifestDirectory("registry/seeds")).map((entry) => entry.value);

test("every current game and variant has a native settings contract", () => {
  assert.deepEqual(nativeSettingsContractIssues(contract, seeds), []);
  assert.equal(new Set(seeds.map((seed) => seed.podId)).size, 10);
  assert.equal(seeds.length, 20);
});

test("new and draft Seeds cannot silently omit settings support", () => {
  for (const status of ["draft", "candidate", "stable"]) {
    assert.match(nativeSettingsContractIssues(contract, [...seeds, {...seeds[0], id: "new-game", status}]).join("\n"), /new-game: add a tested Leaf/);
  }
});

test("image substitution requires a matching trusted profile", () => {
  const changed = structuredClone(seeds);
  changed[0].components.find((c) => c.role === "primary").image = "ghcr.io/untrusted/game@sha256:" + "a".repeat(64);
  assert.match(nativeSettingsContractIssues(contract, changed).join("\n"), /no matching trusted settings profile/);
});

test("malformed, duplicate and stale mappings fail closed", () => {
  for (const change of [
    (c) => { c.profiles = []; },
    (c) => { c.leafCapability = "unknown"; },
    (c) => { c.profiles.push(c.profiles[0]); },
    (c) => { c.profiles[0].images = []; },
    (c) => { c.profiles[0].seeds.push("removed-game"); },
    (c) => { c.profiles[0].images[0] += ":latest"; },
    (c) => { c.profiles[0] = null; },
    (c) => { delete c.requiredWorkflowTests; },
    (c) => { c.requiredWorkflowTests = []; },
    (c) => { c.requiredWorkflowTests.push(c.requiredWorkflowTests[0]); },
    (c) => { c.requiredWorkflowTests = ["Test.*"]; },
  ]) {
    const changed = structuredClone(contract);
    change(changed);
    assert.ok(nativeSettingsContractIssues(changed, seeds).length > 0);
  }
});

test("renaming or adding primary components cannot bypass settings identity", () => {
  const changed = structuredClone(seeds);
  changed[0].components.find((c) => c.role === "primary").id = "other";
  assert.match(nativeSettingsContractIssues(contract, changed).join("\n"), /identity server/);
});

test("named runtime regressions must actually exist in the reviewed Leaf checkout", () => {
  const output = contract.requiredWorkflowTests.join("\n") + "\nok package 1.0s\n";
  assert.deepEqual(missingWorkflowTests(contract, output), []);
  assert.deepEqual(missingWorkflowTests(contract, output.replace("TestMinecraftWorldReadbackBoundariesAndLostAcceptance\n", "")), ["TestMinecraftWorldReadbackBoundariesAndLostAcceptance"]);
  assert.deepEqual(missingWorkflowTests(contract, ""), contract.requiredWorkflowTests);
});
