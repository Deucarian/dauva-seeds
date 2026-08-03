import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  calculateProofContractDigest,
  canonicalJson,
  compiledRegistry,
  readJson,
  readManifestDirectory,
  repositoryRoot,
  sha256,
} from "./registry-lib.mjs";
import { validateProofReceipt } from "./creator-engine.mjs";

const dayMs = 24 * 60 * 60 * 1000;

export async function renderStudioExport({
  document,
  mode,
  baseRegistryDigest,
  validationTime,
  receipts,
}) {
  if (!["new", "update", "reproof"].includes(mode)) throw new Error("Export mode is invalid.");
  const now = requireTimestamp(validationTime, "validationTime");
  const [podEntries, seedEntries, proofEntries, historyEntries] = await Promise.all([
    readManifestDirectory("registry/pods"),
    readManifestDirectory("registry/seeds"),
    readManifestDirectory("proofs"),
    readManifestDirectory("registry/history", { allowMissing: true }),
  ]);
  const basePods = podEntries.map((entry) => entry.value);
  const baseSeeds = seedEntries.map((entry) => entry.value);
  const baseProofs = proofEntries.map((entry) => entry.value);
  const history = historyEntries.map((entry) => entry.value);
  const currentRegistry = compiledRegistry(basePods, baseSeeds, baseProofs, history);
  if (currentRegistry.registryDigest !== baseRegistryDigest) {
    throw new Error("The export base Registry is stale.");
  }
  const pod = JSON.parse(document.podJson);
  const candidateSeeds = document.seeds.map((entry) => JSON.parse(entry.json));
  if (candidateSeeds.length === 0 || candidateSeeds.some((seed) => seed.podId !== pod.id)) {
    throw new Error("Export document does not form one complete Pod overlay.");
  }
  const receiptByTarget = new Map();
  for (const receipt of receipts) {
    validateProofReceipt(receipt);
    if (receipt.receiptDigest !== sha256(canonicalJson(receipt.receiptPayload))) {
      throw new Error("Export receipt digest is invalid.");
    }
    const payload = receipt.receiptPayload;
    const key = `${payload.seed.id}:${payload.runner.architecture}`;
    if (receiptByTarget.has(key)) throw new Error(`Export has duplicate receipt target '${key}'.`);
    if (Date.parse(payload.expiresAt) < now + 7 * dayMs) {
      throw new Error(`Export receipt '${payload.proofId}' has less than seven full days remaining.`);
    }
    receiptByTarget.set(key, receipt);
  }
  const promotedSeeds = [];
  for (const seed of candidateSeeds) {
    const architectures = seed.compatibility.architectures;
    const matching = architectures.map((architecture) => {
      const receipt = receiptByTarget.get(`${seed.id}:${architecture}`);
      if (!receipt) throw new Error(`Seed '${seed.id}' lacks an exact '${architecture}' receipt.`);
      return receipt;
    });
    if (matching.some((receipt) =>
      receipt.receiptPayload.seed.testedVersion !== seed.version ||
      receipt.receiptPayload.seed.manifestDigest !== sha256(canonicalJson(seed)) ||
      receipt.receiptPayload.seed.proofContractDigest !== calculateProofContractDigest(seed) ||
      receipt.receiptPayload.baseRegistryDigest !== baseRegistryDigest)) {
      throw new Error(`Seed '${seed.id}' receipt binding is stale.`);
    }
    const expectedAgreements = seed.inputs
      .filter((input) => input.type === "agreement")
      .map((input) => ({ key: input.key, url: input.url, revision: input.revision }))
      .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    if (matching.some((receipt) => {
      const agreements = receipt.receiptPayload.agreements;
      return agreements.length !== expectedAgreements.length || agreements.some((agreement, index) =>
        agreement.key !== expectedAgreements[index].key ||
        agreement.url !== expectedAgreements[index].url ||
        agreement.revision !== expectedAgreements[index].revision ||
        agreement.accepted !== true);
    })) {
      throw new Error(`Seed '${seed.id}' receipt agreements are incomplete or stale.`);
    }
    const stableVersion = matching[0].receiptPayload.seed.intendedStableVersion;
    if (matching.some((receipt) => receipt.receiptPayload.seed.intendedStableVersion !== stableVersion)) {
      throw new Error(`Seed '${seed.id}' receipts disagree on the stable version.`);
    }
    promotedSeeds.push(mode === "reproof" ? seed : { ...seed, version: stableVersion, status: "stable" });
  }
  if (receiptByTarget.size !== promotedSeeds.reduce((count, seed) => count + seed.compatibility.architectures.length, 0)) {
    throw new Error("Export contains a receipt outside the immutable revision.");
  }

  const basePod = basePods.find((item) => item.id === pod.id);
  if (mode === "reproof") {
    if (!basePod || canonicalJson(basePod) !== canonicalJson(pod) ||
        promotedSeeds.some((seed) => {
          const existing = baseSeeds.find((item) => item.id === seed.id);
          return !existing || canonicalJson(existing) !== canonicalJson(seed);
        })) {
      throw new Error("A reproof export may not rewrite Pod or Seed bytes.");
    }
  }
  const promotedPod = mode === "reproof" ? pod : { ...pod, status: "stable" };
  const nextPods = basePods.filter((item) => item.id !== pod.id);
  nextPods.push(promotedPod);
  const nextSeeds = [...baseSeeds];
  const nextHistory = [...history];
  const targetFiles = [];
  if (mode !== "reproof" && (!basePod || canonicalJson(basePod) !== canonicalJson(promotedPod))) {
    targetFiles.push(await releaseFile(`registry/pods/${pod.id}.json`, renderJson(promotedPod)));
  }
  for (const seed of promotedSeeds) {
    const index = nextSeeds.findIndex((item) => item.id === seed.id);
    const existing = index >= 0 ? nextSeeds[index] : null;
    if (mode !== "reproof") {
      if (existing && (existing.status !== "stable" || /-rc\./.test(existing.version))) {
        throw new Error(`Existing Seed '${seed.id}' is not a stable history source.`);
      }
      if (existing && canonicalJson(existing) !== canonicalJson(seed)) {
        const historyPath = `registry/history/${existing.id}@${existing.version}.json`;
        targetFiles.push(await releaseFile(historyPath, renderJson(existing), true));
        nextHistory.push(existing);
      }
      targetFiles.push(await releaseFile(`registry/seeds/${seed.id}.json`, renderJson(seed)));
    }
    if (index >= 0) nextSeeds[index] = seed;
    else nextSeeds.push(seed);
  }
  for (const receipt of receipts) {
    const payload = receipt.receiptPayload;
    const receiptPath = `proofs/${payload.seed.id}-${payload.seed.testedVersion}-${payload.runner.architecture}-${payload.proofId}.json`;
    targetFiles.push(await releaseFile(receiptPath, renderJson(receipt), true));
  }
  const nextProofs = [...baseProofs, ...receipts];
  const compiled = compiledRegistry(nextPods, nextSeeds, nextProofs, nextHistory);
  targetFiles.push(await releaseFile("dist/registry.json", renderJson(compiled)));

  const packageDocument = await readJson(path.join(repositoryRoot, "package.json"));
  const lockDocument = await readJson(path.join(repositoryRoot, "package-lock.json"));
  const oldVersion = packageDocument.version;
  const newVersion = nextPatchVersion(oldVersion);
  packageDocument.version = newVersion;
  lockDocument.version = newVersion;
  lockDocument.packages[""].version = newVersion;
  targetFiles.push(await releaseFile("package.json", renderJson(packageDocument)));
  targetFiles.push(await releaseFile("package-lock.json", renderJson(lockDocument)));
  targetFiles.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return {
    files: targetFiles,
    semanticVersions: [{
      package: "@deucarian/dauva-seeds",
      from: oldVersion,
      to: newVersion,
      impact: "patch",
    }],
    compiledRegistryDigest: compiled.registryDigest,
  };
}

async function releaseFile(relativePath, content, requireAbsent = false) {
  const fullPath = path.join(repositoryRoot, ...relativePath.split("/"));
  let existing;
  try {
    existing = await readFile(fullPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (requireAbsent && existing) {
    if (existing.equals(Buffer.from(content))) {
      throw new Error(`Create-only release path '${relativePath}' already exists.`);
    }
    throw new Error(`Immutable release path '${relativePath}' conflicts with existing bytes.`);
  }
  return {
    path: relativePath,
    preApply: existing
      ? { expectedDigest: sha256(existing) }
      : { expectedAbsent: true },
    contentBase64: Buffer.from(content).toString("base64"),
  };
}

function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function nextPatchVersion(version) {
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(version ?? "");
  if (!match) throw new Error("Registry package version is not semantic.");
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function requireTimestamp(value, label) {
  if (typeof value !== "string" ||
      !/^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a millisecond UTC timestamp.`);
  }
  return Date.parse(value);
}
