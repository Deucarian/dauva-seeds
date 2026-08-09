import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateProofContractDigest,
  canonicalJson,
  readJson,
  repositoryRoot,
  sha256,
} from "./registry-lib.mjs";
import { renderStudioExport } from "./studio-export-engine.mjs";
import { expectedProofCheckStatuses } from "./proof-check-policy.mjs";
import path from "node:path";

const digest = (character) => `sha256:${character.repeat(64)}`;
const signature = "A".repeat(86);
const timestamp = "2026-08-03T12:00:00.000Z";
const completedAt = "2026-08-03T12:10:00.000Z";

test("stable reproof export is deterministic and never rewrites stable manifests", async () => {
  const registry = await readJson(path.join(repositoryRoot, "dist", "registry.json"));
  const seed = await readJson(path.join(repositoryRoot, "registry", "seeds", "minecraft-paper.json"));
  const pod = await readJson(path.join(repositoryRoot, "registry", "pods", "minecraft.json"));
  const agreements = seed.inputs
    .filter((input) => input.type === "agreement")
    .map((input) => ({
      key: input.key,
      url: input.url,
      revision: input.revision,
      actorId: "11111111-1111-4111-8111-111111111111",
      accepted: true,
      acceptedAt: timestamp,
    }));
  const check = (code, status = "passed") => ({
    code,
    status,
    startedAt: timestamp,
    completedAt,
    evidenceDigests: [],
  });
  const receiptPayload = {
    proofId: "123e4567-e89b-42d3-a456-426614174000",
    runId: "223e4567-e89b-42d3-a456-426614174001",
    attemptId: "323e4567-e89b-42d3-a456-426614174002",
    revisionId: "423e4567-e89b-42d3-a456-426614174003",
    runStatementDigest: digest("1"),
    seed: {
      id: seed.id,
      testedVersion: seed.version,
      intendedStableVersion: seed.version,
      manifestDigest: sha256(canonicalJson(seed)),
      proofContractDigest: calculateProofContractDigest(seed),
    },
    proofPlanDigest: digest("2"),
    baseRegistryDigest: registry.registryDigest,
    proofBundleDigest: digest("3"),
    policyVersion: "1.0.0",
    validatorVersion: "0.11.0",
    runner: {
      leafId: "proof-leaf-1",
      leafKeyId: digest("4"),
      agentVersion: "0.9.0",
      runtimeVersion: "9.0.8",
      operatingSystem: "linux",
      architecture: "amd64",
    },
    startedAt: timestamp,
    completedAt,
    expiresAt: "2026-09-02T12:10:00.000Z",
    result: "passed",
    checks: [...expectedProofCheckStatuses(seed)].map(([code, status]) =>
      check(code, status),
    ),
    agreements,
    evidence: [],
    cleanup: {
      status: "passed",
      completedAt,
      journalDigest: digest("5"),
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
  const receipt = {
    schemaVersion: "dauva.dev/seed-proof/v2",
    receiptPayload,
    receiptDigest: sha256(canonicalJson(receiptPayload)),
    leafAttestation: { algorithm: "Ed25519", keyId: digest("4"), signature },
    apiAttestation: { algorithm: "Ed25519", keyId: digest("6"), signature },
  };
  const request = {
    document: {
      podJson: canonicalJson(pod),
      seeds: [{ clientKey: seed.id, json: canonicalJson(seed) }],
    },
    mode: "reproof",
    baseRegistryDigest: registry.registryDigest,
    validationTime: timestamp,
    receipts: [receipt],
  };

  const first = await renderStudioExport(request);
  const second = await renderStudioExport(request);

  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.deepEqual(first.files.map((file) => file.path), [
    "dist/registry.json",
    "package-lock.json",
    "package.json",
    `proofs/minecraft-paper-1.0.0-amd64-${receiptPayload.proofId}.json`,
  ]);
  assert.equal(first.semanticVersions[0].from, "0.14.0");
  assert.equal(first.semanticVersions[0].to, "0.14.1");

  await assert.rejects(
    () =>
      renderStudioExport({
        ...request,
        mode: "update",
        semanticImpact: "patch",
      }),
    /required '1\.0\.1' release candidate/,
  );
});
