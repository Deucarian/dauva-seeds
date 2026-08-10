import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalJson, sha256 } from "./registry-lib.mjs";
import {
  createDeploymentReceipt,
  deterministicUuid,
} from "./publication-workflow-client.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("deployment receipt is deterministic, canonical, and schema-valid", async () => {
  const context = {
    publicationId: "423e4567-e89b-42d3-a456-426614174003",
    environment: "develop",
    targetRef: "refs/heads/develop",
    runId: 31380000001,
    runAttempt: 1,
  };
  const receipt = createDeploymentReceipt({
    context,
    commitSha: "b".repeat(40),
    previousCommitSha: "a".repeat(40),
    health: {
      apiCommitSha: "b".repeat(40),
      registryDigest: sha256("registry"),
      registryFileDigest: sha256("registry-file"),
    },
    deployedAtUtc: "2026-08-10T14:00:00.000Z",
    verifiedAtUtc: "2026-08-10T14:00:01.000Z",
  });
  const schema = JSON.parse(
    await readFile(path.join(root, "schemas", "seed-registry-deployment-receipt-v1.schema.json"), "utf8"),
  );
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);

  assert.equal(ajv.compile(schema)(receipt), true);
  assert.equal(
    receipt.deploymentDigest,
    sha256(canonicalJson(receipt.deploymentPayload)),
  );
  assert.equal(
    receipt.deploymentPayload.deploymentId,
    deterministicUuid(`${context.publicationId}\n${"b".repeat(40)}\n${context.runId}\n1`),
  );
});

test("deployment identity changes with the durable workflow attempt", () => {
  const one = deterministicUuid("publication\ncommit\nrun\n1");
  const two = deterministicUuid("publication\ncommit\nrun\n2");
  assert.match(one, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(one, two);
});
