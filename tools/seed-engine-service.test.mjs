import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { repositoryRoot } from "./registry-lib.mjs";

const servicePath = path.join(repositoryRoot, "tools", "seed-engine-service.mjs");
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
  assert.deepEqual(first, second);
  assert.match(first.digest, /^sha256:[a-f0-9]{64}$/);
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
