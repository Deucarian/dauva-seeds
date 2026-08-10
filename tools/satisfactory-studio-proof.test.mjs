import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  calculateProofContractDigest,
  canonicalJson,
  readJson,
  repositoryRoot,
  sha256,
} from "./registry-lib.mjs";
import {
  createProofPlan,
  deriveGovernedProofFixtures,
} from "./creator-engine.mjs";
import { expectedProofCheckStatuses } from "./proof-check-policy.mjs";
import { renderStudioExport } from "./studio-export-engine.mjs";

const seed = await readJson(
  path.join(repositoryRoot, "registry", "seeds", "satisfactory.json"),
);
const pod = await readJson(
  path.join(repositoryRoot, "registry", "pods", "satisfactory.json"),
);
const registry = await readJson(
  path.join(repositoryRoot, "dist", "registry.json"),
);
const digest = (character) => `sha256:${character.repeat(64)}`;
const startedAt = "2026-08-03T12:00:00.000Z";
const completedAt = "2026-08-03T12:10:00.000Z";
const expiresAt = "2026-11-01T12:10:00.000Z";
const signature = "A".repeat(86);

test("Satisfactory Studio plan carries every manifest proof requirement", () => {
  const { plan } = createProofPlan({
    seed,
    baseRegistryDigest: registry.registryDigest,
    proofBundleDigest: digest("1"),
    revisionId: "123e4567-e89b-42d3-a456-426614174000",
    planId: "223e4567-e89b-42d3-a456-426614174001",
    architecture: "amd64",
    fixtures: deriveGovernedProofFixtures(seed),
  });

  const planned = new Set(plan.checks.map((check) => check.kind));
  for (const requiredCheck of seed.proofPolicy.requiredChecks) {
    assert.equal(
      planned.has(requiredCheck),
      true,
      `missing ${requiredCheck}`,
    );
  }
  for (const capabilityCheck of ["backup", "restore", "update"]) {
    assert.equal(planned.has(capabilityCheck), true);
  }
});

test("Satisfactory exact proof receipt exports and a missing required check fails closed", async () => {
  const receipt = createReceipt();
  const request = {
    document: {
      podJson: canonicalJson(pod),
      seeds: [{ clientKey: seed.id, json: canonicalJson(seed) }],
    },
    mode: "reproof",
    baseRegistryDigest: registry.registryDigest,
    validationTime: startedAt,
    receipts: [receipt],
  };

  const exported = await renderStudioExport(request);
  assert.equal(
    exported.files.some(
      (file) =>
        file.path ===
        `proofs/satisfactory-1.0.1-amd64-${receipt.receiptPayload.proofId}.json`,
    ),
    true,
  );

  const incomplete = structuredClone(receipt);
  incomplete.receiptPayload.checks = incomplete.receiptPayload.checks.filter(
    (check) => check.code !== "rollback",
  );
  incomplete.receiptDigest = sha256(canonicalJson(incomplete.receiptPayload));
  await assert.rejects(
    () => renderStudioExport({ ...request, receipts: [incomplete] }),
    /required proof check 'rollback' is missing/,
  );
});

function createReceipt() {
  const checks = [...expectedProofCheckStatuses(seed)].map(([code, status]) => ({
    code,
    status,
    startedAt,
    completedAt,
    evidenceDigests: [],
  }));
  const receiptPayload = {
    proofId: "323e4567-e89b-42d3-a456-426614174002",
    runId: "423e4567-e89b-42d3-a456-426614174003",
    attemptId: "523e4567-e89b-42d3-a456-426614174004",
    revisionId: "623e4567-e89b-42d3-a456-426614174005",
    runStatementDigest: digest("2"),
    seed: {
      id: seed.id,
      testedVersion: seed.version,
      intendedStableVersion: seed.version,
      manifestDigest: sha256(canonicalJson(seed)),
      proofContractDigest: calculateProofContractDigest(seed),
    },
    proofPlanDigest: digest("3"),
    baseRegistryDigest: registry.registryDigest,
    proofBundleDigest: digest("4"),
    policyVersion: "1.1.0",
    validatorVersion: "0.14.0",
    runner: {
      leafId: "proof-leaf-1",
      leafKeyId: digest("5"),
      agentVersion: "0.7.0",
      runtimeVersion: "docker-29.0.0",
      operatingSystem: "linux",
      architecture: "amd64",
    },
    startedAt,
    completedAt,
    expiresAt,
    result: "passed",
    checks,
    agreements: seed.inputs
      .filter((input) => input.type === "agreement")
      .map((input) => ({
        key: input.key,
        url: input.url,
        revision: input.revision,
        actorId: "proof-admin",
        accepted: true,
        acceptedAt: startedAt,
      })),
    evidence: [],
    cleanup: {
      status: "passed",
      completedAt,
      journalDigest: digest("6"),
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
  return {
    schemaVersion: "dauva.dev/seed-proof/v2",
    receiptPayload,
    receiptDigest: sha256(canonicalJson(receiptPayload)),
    leafAttestation: {
      algorithm: "Ed25519",
      keyId: digest("5"),
      signature,
    },
    apiAttestation: {
      algorithm: "Ed25519",
      keyId: digest("7"),
      signature,
    },
  };
}
