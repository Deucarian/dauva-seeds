#!/usr/bin/env node

import path from "node:path";
import {
  canonicalDocument,
  creatorEngineVersion,
  creatorPolicyVersion,
  freezeSeedRevision,
  validateProofReceipt,
  validateWorkspace,
} from "./creator-engine.mjs";
import {
  assertRegistryDigest,
  calculateProofContractDigest,
  canonicalJson,
  parseJsonStrict,
  readJson,
  readManifestDirectory,
  repositoryRoot,
  sha256,
} from "./registry-lib.mjs";
import { renderStudioExport } from "./studio-export-engine.mjs";
import { validateReleaseBundleEnvelope } from "./release-engine.mjs";

const maximumRequestBytes = 2 * 1024 * 1024;

try {
  const requestText = await readStandardInput();
  const request = parseJsonStrict(requestText, "Seed engine request");
  const result = await dispatch(request);
  process.stdout.write(`${canonicalJson({ ok: true, result })}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown Seed engine failure.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function dispatch(request) {
  switch (request?.action) {
    case "reference":
      return reference();
    case "clone":
      return clone(request.seedId);
    case "candidate-digest":
      return candidateDigest(request.document);
    case "validate":
      return validate(request);
    case "freeze":
      return freeze(request);
    case "validate-proof-v2":
      return validateProofReceipt(request.receipt);
    case "render-export":
      return renderStudioExport(request);
    case "validate-release-bundle":
      return validateReleaseBundleEnvelope(request.bundle);
    default:
      throw new Error("Seed engine action is not supported.");
  }
}

async function reference() {
  const registry = await readJson(path.join(repositoryRoot, "dist", "registry.json"));
  assertRegistryDigest(registry);
  return {
    engineVersion: creatorEngineVersion,
    policyVersion: creatorPolicyVersion,
    registryDigest: registry.registryDigest,
    pods: registry.pods,
  };
}

async function clone(seedId) {
  requireIdentifier(seedId, "seedId");
  const { pods, seeds } = await loadRegistryInputs();
  const seed = seeds.find((candidate) => candidate.id === seedId);
  if (!seed) throw new Error(`Seed '${seedId}' does not exist in the base Registry.`);
  const pod = pods.find((candidate) => candidate.id === seed.podId);
  if (!pod) throw new Error(`Pod '${seed.podId}' does not exist in the base Registry.`);
  return {
    document: {
      podJson: canonicalJson(pod),
      seeds: [{ clientKey: seed.id, json: canonicalJson(seed) }],
    },
  };
}

function candidateDigest(document) {
  const parsed = parseWorkingDocument(document);
  return canonicalDocument(parsed);
}

async function validate(request) {
  const parsed = parseWorkingDocument(request.document);
  const { pods, seeds, proofs } = await loadRegistryInputs();
  const result = validateWorkspace({
    pod: parsed.pod,
    seeds: parsed.seeds,
    basePods: pods,
    baseSeeds: seeds,
    proofs,
    profile: request.profile,
    validationTime: request.validationTime,
    meaningfulVariantSeedIds: request.meaningfulVariantSeedIds ?? [],
  });
  return {
    ...result,
    engineVersion: creatorEngineVersion,
    policyVersion: creatorPolicyVersion,
    candidateDigest: sha256(canonicalJson(parsed)),
  };
}

function freeze(request) {
  const parsed = parseWorkingDocument(request.document);
  requireUuid(request.revisionId, "revisionId");
  requireUuid(request.revisionGroupId, "revisionGroupId");
  const planIds = new Map(
    (request.planIds ?? []).map((entry) => [
      `${entry.seedId}:${entry.architecture}`,
      entry.planId,
    ]),
  );
  const proofPlans = [];
  const proofBundles = [];
  const proofPlanDigests = [];
  const proofContractDigests = [];
  const manifestDigests = [
    { id: parsed.pod.id, digest: sha256(canonicalJson(parsed.pod)) },
  ];

  for (const seed of parsed.seeds) {
    manifestDigests.push({ id: seed.id, digest: sha256(canonicalJson(seed)) });
    proofContractDigests.push({
      id: seed.id,
      digest: calculateProofContractDigest(seed),
    });
    for (const architecture of seed.compatibility.architectures) {
      const key = `${seed.id}:${architecture}`;
      const planId = planIds.get(key);
      requireUuid(planId, `planId for ${key}`);
      const frozen = freezeSeedRevision({
        seed,
        pod: parsed.pod,
        baseRegistryDigest: request.baseRegistryDigest,
        revisionId: request.revisionId,
        revisionGroupId: request.revisionGroupId,
        planId,
        architecture,
        frozenAt: request.frozenAt,
        authorId: request.authorId,
        semanticImpact: request.semanticImpact,
      });
      proofPlans.push(frozen.proofPlan);
      proofBundles.push({
        seedId: seed.id,
        architecture,
        bundle: frozen.proofBundle,
      });
      proofPlanDigests.push({ id: key, digest: frozen.revision.proofPlanDigest });
    }
  }
  sortNamedDigests(manifestDigests);
  sortNamedDigests(proofContractDigests);
  sortNamedDigests(proofPlanDigests);
  proofPlans.sort(compareSeedArchitecture);
  proofBundles.sort(compareSeedArchitecture);
  return {
    documentDigest: sha256(canonicalJson(parsed)),
    canonicalDocument: {
      podJson: canonicalJson(parsed.pod),
      seeds: parsed.seeds
        .map((seed) => ({ clientKey: seed.id, json: canonicalJson(seed) }))
        .sort((left, right) => compareText(left.clientKey, right.clientKey)),
    },
    manifestDigests,
    proofContractDigests,
    proofPlanDigests,
    proofPlans,
    proofBundles,
    engineVersion: creatorEngineVersion,
    policyVersion: creatorPolicyVersion,
  };
}

async function loadRegistryInputs() {
  const [podEntries, seedEntries, proofEntries] = await Promise.all([
    readManifestDirectory(path.join("registry", "pods")),
    readManifestDirectory(path.join("registry", "seeds")),
    readManifestDirectory("proofs"),
  ]);
  return {
    pods: podEntries.map((entry) => entry.value),
    seeds: seedEntries.map((entry) => entry.value),
    proofs: proofEntries.map((entry) => entry.value),
  };
}

function parseWorkingDocument(document) {
  if (!document || typeof document.podJson !== "string" || !Array.isArray(document.seeds)) {
    throw new Error("Working document is malformed.");
  }
  if (document.podJson.length > 512 * 1024 || document.seeds.length > 32) {
    throw new Error("Working document exceeds the engine limits.");
  }
  const pod = parseJsonStrict(document.podJson, "working Pod JSON");
  const seeds = document.seeds.map((entry, index) => {
    if (typeof entry?.clientKey !== "string" || typeof entry?.json !== "string") {
      throw new Error(`Working Seed ${index} is malformed.`);
    }
    if (entry.json.length > 512 * 1024) {
      throw new Error(`Working Seed ${index} exceeds the engine limit.`);
    }
    return parseJsonStrict(entry.json, `working Seed '${entry.clientKey}' JSON`);
  });
  return { pod, seeds };
}

async function readStandardInput() {
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > maximumRequestBytes) {
      throw new Error("Seed engine request exceeds 2 MiB.");
    }
    chunks.push(chunk);
  }
  if (length === 0) throw new Error("Seed engine request is empty.");
  return Buffer.concat(chunks).toString("utf8");
}

function requireIdentifier(value, label) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value ?? "")) {
    throw new Error(`${label} is invalid.`);
  }
}

function requireUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value ?? "")) {
    throw new Error(`${label} must be a lowercase UUID.`);
  }
}

function sortNamedDigests(items) {
  items.sort((left, right) => compareText(left.id, right.id));
}

function compareSeedArchitecture(left, right) {
  return compareText(
    `${left.seedId}:${left.architecture}`,
    `${right.seedId}:${right.architecture}`,
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
