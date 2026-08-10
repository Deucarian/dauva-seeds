import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readJson, repositoryRoot } from "./registry-lib.mjs";

const servicePath = path.join(repositoryRoot, "tools", "seed-engine-service.mjs");
const schemaDirectory = path.join(repositoryRoot, "schemas");
const seedSchema = await readJson(path.join(schemaDirectory, "seed-v1.schema.json"));
const studioApi = await readJson(
  path.join(schemaDirectory, "seed-studio-api-v1.openapi.json"),
);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(seedSchema);
const validateCatalogSeed = ajv.compile({
  $id: "https://dauva.dev/schemas/seed-studio-catalog-seed.json",
  ...studioApi.components.schemas.CatalogSeedSummary,
});
const revisionId = "123e4567-e89b-42d3-a456-426614174000";
const groupId = "223e4567-e89b-42d3-a456-426614174001";

test("Seed engine service shares the exact Registry reference and clone bytes", async () => {
  const reference = await invoke({ action: "reference" });
  const cloned = await invoke({ action: "clone", seedId: "minecraft-paper" });
  const first = await invoke({
    action: "candidate-digest",
    document: cloned.document,
  });
  const second = await invoke({
    action: "candidate-digest",
    document: cloned.document,
  });

  assert.match(reference.registryDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(reference.pods.length, 9);
  assert.equal(reference.seeds.length, 18);
  assert.equal(reference.seeds.every((seed) => seed.status === "stable"), true);
  assert.equal(
    reference.seeds.every((seed) => validateCatalogSeed(seed)),
    true,
    JSON.stringify(validateCatalogSeed.errors),
  );
  assert.deepEqual(
    Object.keys(reference.seeds[0]),
    ["description", "id", "podId", "status", "title", "version"],
  );
  assert.deepEqual(reference.seeds.find((seed) => seed.id === "minecraft-paper"), {
    id: "minecraft-paper",
    podId: "minecraft",
    version: "1.0.0",
    status: "stable",
    title: {
      de: "Minecraft Paper",
      en: "Minecraft Paper",
      nl: "Minecraft Paper",
    },
    description: {
      de: "Ein leistungsorientierter Minecraft-Paper-Server mit automatischen Backups.",
      en: "A performance-focused Minecraft Paper Server with automatic backups.",
      nl: "Een prestatiegerichte Minecraft Paper-Server met automatische back-ups.",
    },
  });
  assert.deepEqual(first, second);
  assert.match(first.digest, /^sha256:[a-f0-9]{64}$/);
});

test("Seed engine service creates guided existing-Pod and new-Pod working documents", async () => {
  const existing = await invoke({
    action: "create-draft",
    starter: {
      kind: "existing_pod_variant",
      podId: "minecraft",
      seedId: "minecraft-guided",
      displayName: "Minecraft Guided",
    },
  });
  const existingAgain = await invoke({
    action: "create-draft",
    starter: {
      kind: "existing_pod_variant",
      podId: "minecraft",
      seedId: "minecraft-guided",
      displayName: "Minecraft Guided",
    },
  });
  assert.deepEqual(existing, existingAgain);
  const existingPod = JSON.parse(existing.document.podJson);
  const existingSeed = JSON.parse(existing.document.seeds[0].json);
  assert.equal(existingPod.id, "minecraft");
  assert.equal(existingPod.recommendedSeedId, "minecraft-paper");
  assert.equal(existingSeed.id, "minecraft-guided");
  assert.equal(existingSeed.version, "1.0.0-rc.1");
  assert.equal(existingSeed.status, "draft");
  assert.deepEqual(existingSeed.metadata.title, {
    de: "Minecraft Guided",
    en: "Minecraft Guided",
    nl: "Minecraft Guided",
  });

  const created = await invoke({
    action: "create-draft",
    starter: {
      kind: "new_pod",
      podId: "example-game",
      podDisplayName: "Example Game",
      seedId: "example-game-vanilla",
      seedDisplayName: "Example Game Vanilla",
    },
  });
  const newPod = JSON.parse(created.document.podJson);
  const newSeed = JSON.parse(created.document.seeds[0].json);
  assert.equal(newPod.id, "example-game");
  assert.equal(newPod.status, "draft");
  assert.equal("recommendedSeedId" in newPod, false);
  assert.equal(newSeed.id, "example-game-vanilla");
  assert.deepEqual(newSeed.source, {});
  assert.deepEqual(newSeed.trust, {});
  assert.equal(newSeed.components[0].image, "");
  assert.equal(newSeed.components[0].imageUpdate.reference, "");
});

test("Seed engine service rejects unsafe or ambiguous guided starters", async () => {
  await assert.rejects(
    () =>
      invoke({
        action: "create-draft",
        starter: {
          kind: "existing_pod_variant",
          podId: "minecraft",
          seedId: "minecraft-guided",
          displayName: "Minecraft Guided",
          templateSeedId: "valheim",
        },
      }),
    /does not belong to Pod 'minecraft'/,
  );
  await assert.rejects(
    () =>
      invoke({
        action: "create-draft",
        starter: {
          kind: "new_pod",
          podId: "minecraft",
          podDisplayName: "Duplicate Minecraft",
          seedId: "minecraft-guided",
          seedDisplayName: "Minecraft Guided",
        },
      }),
    /Pod 'minecraft' already exists/,
  );
  await assert.rejects(
    () =>
      invoke({
        action: "create-draft",
        starter: {
          kind: "new_pod",
          podId: "example-game",
          podDisplayName: "Example Game",
          seedId: "example-game-vanilla",
          seedDisplayName: "Example Game Vanilla",
          reviewedAt: "2026-08-03",
        },
      }),
    /invalid shape/,
  );
});

test("Seed engine service freezes engine-owned typed proof plans", async () => {
  const reference = await invoke({ action: "reference" });
  const cloned = await invoke({ action: "clone", seedId: "minecraft-paper" });
  const seed = JSON.parse(cloned.document.seeds[0].json);
  const planIds = seed.compatibility.architectures.map(
    (architecture, index) => ({
      seedId: seed.id,
      architecture,
      planId:
        index === 0
          ? "323e4567-e89b-42d3-a456-426614174002"
          : "423e4567-e89b-42d3-a456-426614174003",
    }),
  );
  const frozen = await invoke({
    action: "freeze",
    document: cloned.document,
    baseRegistryDigest: reference.registryDigest,
    revisionId,
    revisionGroupId: groupId,
    planIds,
    frozenAt: "2026-08-03T12:00:00.000Z",
    authorId: "11111111-1111-4111-8111-111111111111",
    semanticImpact: "reproof",
  });

  assert.equal(frozen.proofPlans.length, seed.compatibility.architectures.length);
  assert.equal(frozen.proofPlanDigests.length, seed.compatibility.architectures.length);
  assert.equal(
    frozen.proofPlans.every((plan) =>
      plan.checks.every((check) => !("command" in check)),
    ),
    true,
  );
});

test("Seed engine service enforces release targets and renders a new identity as an immutable candidate", async () => {
  const reference = await invoke({ action: "reference" });
  assert.equal(reference.policyVersion, "1.1.0");
  const guided = await invoke({
    action: "create-draft",
    starter: {
      kind: "existing_pod_variant",
      podId: "minecraft",
      seedId: "minecraft-guided",
      displayName: "Minecraft Guided",
    },
  });
  const guidedSeed = JSON.parse(guided.document.seeds[0].json);
  const planIds = guidedSeed.compatibility.architectures.map(
    (architecture, index) => ({
      seedId: guidedSeed.id,
      architecture,
      planId:
        index === 0
          ? "323e4567-e89b-42d3-a456-426614174002"
          : "423e4567-e89b-42d3-a456-426614174003",
    }),
  );
  const frozen = await invoke({
    action: "freeze",
    document: guided.document,
    baseRegistryDigest: reference.registryDigest,
    revisionId,
    revisionGroupId: groupId,
    planIds,
    frozenAt: "2026-08-03T12:00:00.000Z",
    authorId: "11111111-1111-4111-8111-111111111111",
    semanticImpact: "patch",
    meaningfulVariantSeedIds: [],
    candidateNumber: 1,
  });
  const immutableSeed = JSON.parse(frozen.canonicalDocument.seeds[0].json);
  assert.equal(immutableSeed.version, "1.0.0-rc.1");
  assert.equal(immutableSeed.status, "candidate");

  const cloned = await invoke({ action: "clone", seedId: "minecraft-paper" });
  const updateSeed = JSON.parse(cloned.document.seeds[0].json);
  updateSeed.lifecycle.stopTimeoutSeconds += 1;
  const editableClone = {
    ...cloned.document,
    seeds: [{
      clientKey: updateSeed.id,
      json: JSON.stringify(updateSeed),
    }],
  };
  const updateFrozen = await invoke({
    action: "freeze",
    document: editableClone,
    baseRegistryDigest: reference.registryDigest,
    revisionId,
    revisionGroupId: groupId,
    planIds: [{
      seedId: "minecraft-paper",
      architecture: "amd64",
      planId: "323e4567-e89b-42d3-a456-426614174002",
    }],
    frozenAt: "2026-08-03T12:00:00.000Z",
    authorId: "11111111-1111-4111-8111-111111111111",
    semanticImpact: "patch",
    candidateNumber: 1,
  });
  const updateCandidate = JSON.parse(
    updateFrozen.canonicalDocument.seeds[0].json,
  );
  assert.equal(updateCandidate.version, "1.0.1-rc.1");
  assert.equal(updateCandidate.status, "candidate");

  const admission = await invoke({
    action: "validate",
    document: updateFrozen.canonicalDocument,
    profile: "proof-admission",
    semanticImpact: "patch",
    candidateNumber: 1,
    meaningfulVariantSeedIds: [],
  });
  assert.equal(admission.valid, true, JSON.stringify(admission.issues));

  const editableAdmission = await invoke({
    action: "validate",
    document: editableClone,
    profile: "proof-admission",
    semanticImpact: "patch",
    candidateNumber: 1,
    meaningfulVariantSeedIds: [],
  });
  assert.equal(editableAdmission.valid, false);
  assert.equal(
    editableAdmission.issues.some(
      (issue) => issue.code === "seed.version.candidate-target",
    ),
    true,
  );
});

test("Seed engine service rejects invalid or mismatched working Seed client keys", async () => {
  const cloned = await invoke({ action: "clone", seedId: "minecraft-paper" });
  await assert.rejects(
    () =>
      invoke({
        action: "candidate-digest",
        document: {
          ...cloned.document,
          seeds: [{ ...cloned.document.seeds[0], clientKey: "minecraft-fabric" }],
        },
      }),
    /clientKey must equal its parsed Seed id/,
  );
  await assert.rejects(
    () =>
      invoke({
        action: "candidate-digest",
        document: {
          ...cloned.document,
          seeds: [{ ...cloned.document.seeds[0], clientKey: "a" }],
        },
      }),
    /clientKey is invalid/,
  );
});

test("Seed engine service rejects duplicate request members before dispatch", async () => {
  await assert.rejects(
    () => invokeRaw('{"action":"reference","action":"clone"}'),
    /duplicate object member/i,
  );
});

async function invoke(request) {
  const { stdout } = await invokeRaw(JSON.stringify(request));
  const envelope = JSON.parse(stdout);
  assert.equal(envelope.ok, true);
  return envelope.result;
}

async function invokeRaw(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [servicePath], {
      cwd: repositoryRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = { stdout: stdout.join(""), stderr: stderr.join("") };
      if (code === 0) {
        resolve(result);
        return;
      }
      reject(new Error(result.stderr.trim() || `Seed engine exited with code ${code}.`));
    });
    child.stdin.end(input, "utf8");
  });
}
