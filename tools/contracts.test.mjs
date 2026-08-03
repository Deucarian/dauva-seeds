import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readJson, repositoryRoot } from "./registry-lib.mjs";

const schemaDirectory = path.join(repositoryRoot, "schemas");
const documents = Object.fromEntries(
  await Promise.all(
    [
      "pod-v1.schema.json",
      "seed-v1.schema.json",
      "seed-proof-plan-v1.schema.json",
      "seed-proof-bundle-v1.schema.json",
      "seed-proof-v2.schema.json",
      "seed-release-bundle-v1.schema.json",
      "seed-studio-api-v1.openapi.json",
      "seed-studio-leaf-v2.openapi.json",
    ].map(async (name) => [name, await readJson(path.join(schemaDirectory, name))]),
  ),
);

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(documents["pod-v1.schema.json"]);
ajv.addSchema(documents["seed-v1.schema.json"]);
const validatePlan = ajv.compile(documents["seed-proof-plan-v1.schema.json"]);
ajv.addSchema(documents["seed-proof-bundle-v1.schema.json"]);
const validateProof = ajv.compile(documents["seed-proof-v2.schema.json"]);
const validateBundle = ajv.compile(
  documents["seed-release-bundle-v1.schema.json"],
);

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const uuid2 = "223e4567-e89b-42d3-a456-426614174001";
const uuid3 = "323e4567-e89b-42d3-a456-426614174002";
const digest = (character) => `sha256:${character.repeat(64)}`;
const timestamp = "2026-08-03T10:00:00.000Z";
const laterTimestamp = "2026-08-03T10:10:00.000Z";
const expiresAt = "2026-11-01T10:10:00.000Z";
const signature = "A".repeat(86);

const proofPlan = {
  schemaVersion: "dauva.dev/seed-proof-plan/v1",
  planId: uuid,
  revisionId: uuid2,
  seedId: "example",
  seedVersion: "1.0.0-rc.1",
  architecture: "amd64",
  manifestDigest: digest("a"),
  proofContractDigest: digest("b"),
  baseRegistryDigest: digest("c"),
  proofBundleDigest: digest("d"),
  policyVersion: "1.0.0",
  engineVersion: "0.11.0",
  deadlineSeconds: 3600,
  checks: [
    { kind: "images-pinned" },
    { kind: "healthy", stabilitySeconds: 20 },
    { kind: "ports", portIds: ["game"] },
    { kind: "graceful-stop" },
    { kind: "stopped-remains-stopped" },
    { kind: "restart" },
    { kind: "persistence", volumeId: "data", fixtureId: "save-marker" },
    { kind: "cleanup" },
  ],
};

const check = (code) => ({
  code,
  status: "passed",
  startedAt: timestamp,
  completedAt: laterTimestamp,
  evidenceDigests: [],
});
const receiptPayload = {
  proofId: uuid,
  runId: uuid2,
  attemptId: uuid3,
  revisionId: uuid2,
  runStatementDigest: digest("e"),
  seed: {
    id: "example",
    testedVersion: "1.0.0-rc.1",
    intendedStableVersion: "1.0.0",
    manifestDigest: digest("a"),
    proofContractDigest: digest("b"),
  },
  proofPlanDigest: digest("f"),
  baseRegistryDigest: digest("c"),
  proofBundleDigest: digest("d"),
  policyVersion: "1.0.0",
  validatorVersion: "0.11.0",
  runner: {
    leafId: "proof-leaf-1",
    leafKeyId: digest("1"),
    agentVersion: "0.6.0",
    runtimeVersion: "docker-29.0.0",
    operatingSystem: "linux",
    architecture: "amd64",
  },
  startedAt: timestamp,
  completedAt: laterTimestamp,
  expiresAt,
  result: "passed",
  checks: [
    "images-pinned",
    "healthy",
    "ports",
    "graceful-stop",
    "stopped-remains-stopped",
    "restart",
    "persistence",
    "cleanup",
  ].map(check),
  agreements: [],
  evidence: [],
  cleanup: {
    status: "passed",
    completedAt: laterTimestamp,
    journalDigest: digest("2"),
    resources: {
      containers: 0,
      networks: 0,
      volumes: 0,
      ports: 0,
      directories: 0,
      backups: 0,
      secrets: 0,
    },
  },
};
const proofReceipt = {
  schemaVersion: "dauva.dev/seed-proof/v2",
  receiptPayload,
  receiptDigest: digest("3"),
  leafAttestation: {
    algorithm: "Ed25519",
    keyId: digest("1"),
    signature,
  },
  apiAttestation: {
    algorithm: "Ed25519",
    keyId: digest("4"),
    signature,
  },
};

const file = (filePath, character, absent = false) => ({
  path: filePath,
  preApply: absent
    ? { expectedAbsent: true }
    : { expectedDigest: digest(character) },
  postApplyDigest: digest(character),
  sizeBytes: 128,
});
const releaseBundle = {
  schemaVersion: "dauva.dev/seed-release-bundle/v1",
  bundlePayload: {
    bundleId: uuid,
    workspaceId: uuid2,
    revisionGroupId: uuid3,
    createdAt: timestamp,
    baseGitCommit: "a".repeat(40),
    baseRegistryDigest: digest("c"),
    engineVersion: "0.11.0",
    semanticVersions: [
      {
        package: "@deucarian/dauva-seeds",
        from: "0.9.1",
        to: "0.11.0",
        impact: "minor",
      },
    ],
    proofReceipts: [
      {
        seedId: "example",
        testedVersion: "1.0.0-rc.1",
        architecture: "amd64",
        proofId: uuid,
        receiptDigest: digest("3"),
        expiresAt,
      },
    ],
    files: [
      file("registry/seeds/example.json", "5", true),
      file("dist/registry.json", "6"),
      file("package.json", "7"),
      file("package-lock.json", "8"),
    ],
  },
  exportDigest: digest("9"),
  studioAttestation: {
    algorithm: "Ed25519",
    keyId: digest("4"),
    signature,
  },
};

test("contract schemas accept the frozen valid fixtures", () => {
  assert.equal(validatePlan(proofPlan), true, JSON.stringify(validatePlan.errors));
  assert.equal(
    validateProof(proofReceipt),
    true,
    JSON.stringify(validateProof.errors),
  );
  assert.equal(
    validateBundle(releaseBundle),
    true,
    JSON.stringify(validateBundle.errors),
  );
});

test("contract schemas reject commands, extension fields, and unsafe paths", () => {
  const commandPlan = structuredClone(proofPlan);
  commandPlan.checks[0] = { kind: "shell", command: "echo unsafe" };
  assert.equal(validatePlan(commandPlan), false);

  const extendedReceipt = structuredClone(proofReceipt);
  extendedReceipt.receiptPayload.shellCommand = "echo unsafe";
  assert.equal(validateProof(extendedReceipt), false);

  const traversingBundle = structuredClone(releaseBundle);
  traversingBundle.bundlePayload.files[0].path = "../registry/seeds/example.json";
  assert.equal(validateBundle(traversingBundle), false);
});

test("OpenAPI contracts expose only the approved Studio and Leaf operations", async () => {
  const api = documents["seed-studio-api-v1.openapi.json"];
  const leaf = documents["seed-studio-leaf-v2.openapi.json"];
  const requiredApiPaths = [
    "/reference",
    "/workspaces",
    "/workspaces/{workspaceId}",
    "/workspaces/{workspaceId}/rebase",
    "/workspaces/{workspaceId}/archive",
    "/workspaces/{workspaceId}/restore",
    "/workspaces/{workspaceId}/validate",
    "/workspaces/{workspaceId}/approvals",
    "/workspaces/{workspaceId}/revisions",
    "/workspaces/{workspaceId}/revisions/{revisionId}",
    "/workspaces/{workspaceId}/revisions/{revisionId}/supersede",
    "/workspaces/{workspaceId}/image-resolutions",
    "/workspaces/{workspaceId}/proof-runs",
    "/proof-runs/{runId}",
    "/proof-runs/{runId}/events",
    "/proof-runs/{runId}/cancel",
    "/workspaces/{workspaceId}/exports",
    "/exports/{exportId}",
    "/exports/{exportId}/download",
  ];
  assert.deepEqual(Object.keys(api.paths).sort(), requiredApiPaths.sort());
  assert.equal(
    Object.keys(api.paths).some((route) => /publish|merge|deploy/i.test(route)),
    false,
  );
  assert.deepEqual(api.security, [{ portalSession: [] }]);
  assert.deepEqual(api.components.securitySchemes.portalSession, {
    type: "apiKey",
    in: "cookie",
    name: "jorishoef.portal",
    description:
      "Authenticated Portal session. Every mutation additionally requires the X-CSRF-Token header and an exact same-origin Origin header.",
  });
  for (const item of Object.values(api.paths)) {
    for (const method of ["post", "put", "patch", "delete"]) {
      if (!item[method]) continue;
      const parameterReferences = (item[method].parameters ?? []).map(
        (parameter) => parameter.$ref,
      );
      assert.equal(
        parameterReferences.includes("#/components/parameters/IdempotencyKey"),
        true,
        `${method.toUpperCase()} is missing Idempotency-Key`,
      );
      assert.equal(
        parameterReferences.includes("#/components/parameters/CsrfToken"),
        true,
        `${method.toUpperCase()} is missing CSRF protection`,
      );
    }
  }
  assert.deepEqual(Object.keys(leaf.paths).sort(), [
    "/v2/seed-proof-runs",
    "/v2/seed-proof-runs/{runId}/attempts/{attemptId}",
    "/v2/seed-proof-runs/{runId}/attempts/{attemptId}/cancel",
    "/v2/seed-proof-runs/{runId}/attempts/{attemptId}/events",
    "/v2/seed-proof-runs/{runId}/attempts/{attemptId}/finalize",
  ]);

  for (const document of [api, leaf]) {
    for (const reference of collectExternalReferences(document)) {
      await access(path.resolve(schemaDirectory, reference));
    }
  }
});

function collectExternalReferences(value) {
  if (Array.isArray(value)) return value.flatMap(collectExternalReferences);
  if (value === null || typeof value !== "object") return [];
  const references = [];
  for (const [key, nested] of Object.entries(value)) {
    if (key === "$ref" && typeof nested === "string" && nested.startsWith("./")) {
      references.push(nested.slice(2).split("#", 1)[0]);
    } else {
      references.push(...collectExternalReferences(nested));
    }
  }
  return [...new Set(references)];
}
