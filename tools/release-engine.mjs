import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readJson, repositoryRoot, sha256 } from "./registry-lib.mjs";
import {
  createAttestation,
  exportDigest,
  publicationStatementDomain,
  releaseBundleDomain,
  verifyAttestation,
} from "./proof-crypto.mjs";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const seedSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-v1.schema.json"),
);
const bundleSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-release-bundle-v1.schema.json"),
);
const publicationSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-studio-publication-v1.schema.json"),
);
ajv.addSchema(seedSchema);
const validateBundleSchema = ajv.compile(bundleSchema);
const validatePublicationSchema = ajv.compile(publicationSchema);

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const allowedPathPattern =
  /^(?:registry\/(?:pods|seeds)\/[a-z0-9]+(?:-[a-z0-9]+)*\.json|registry\/history\/[a-z0-9]+(?:-[a-z0-9]+)*@[0-9]+\.[0-9]+\.[0-9]+\.json|proofs\/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[1-9][0-9]*)?-(?:amd64|arm64)-[0-9a-f-]{36}\.json|dist\/registry\.json|package\.json|package-lock\.json)$/;
const dayMs = 24 * 60 * 60 * 1000;
const maximumPublicationClaimMs = 60 * 60 * 1000;

export function validateReleaseBundleEnvelope(bundle) {
  assertBundleSchema(bundle);
  return { valid: true };
}

export function createSignedPublicationStatement({
  publicationPayload,
  studioPrivateKey,
  studioPublicKey,
}) {
  requireTimestamp(publicationPayload?.createdAtUtc, "createdAtUtc");
  requireTimestamp(publicationPayload?.claimBeforeUtc, "claimBeforeUtc");
  requirePublicationClaimWindow(publicationPayload);
  const publicationDigest = exportDigest(publicationPayload);
  const envelope = {
    schemaVersion: "dauva.dev/seed-publication/v1",
    publicationPayload,
    publicationDigest,
    studioAttestation: createAttestation({
      domain: publicationStatementDomain,
      digest: publicationDigest,
      privateKey: studioPrivateKey,
      publicKey: studioPublicKey,
    }),
  };
  assertPublicationSchema(envelope);
  return envelope;
}

export function verifySignedPublicationStatement({
  statement,
  studioPublicKey,
  validationTime,
}) {
  assertPublicationSchema(statement);
  requireTimestamp(validationTime, "validationTime");
  const calculatedDigest = exportDigest(statement.publicationPayload);
  if (calculatedDigest !== statement.publicationDigest) {
    throw new Error("Publication digest does not match publicationPayload.");
  }
  if (
    !verifyAttestation({
      domain: publicationStatementDomain,
      digest: statement.publicationDigest,
      attestation: statement.studioAttestation,
      publicKey: studioPublicKey,
    })
  ) {
    throw new Error("Publication Studio attestation is invalid.");
  }
  requirePublicationClaimWindow(statement.publicationPayload);
  if (Date.parse(statement.publicationPayload.createdAtUtc) > Date.parse(validationTime)) {
    throw new Error("Publication was created after the validation time.");
  }
  if (Date.parse(statement.publicationPayload.claimBeforeUtc) <= Date.parse(validationTime)) {
    throw new Error("Publication claim deadline has passed.");
  }
  return statement.publicationDigest;
}

export function createSignedReleaseBundle({
  bundleId,
  workspaceId,
  revisionGroupId,
  createdAt,
  validationTime,
  baseGitCommit,
  baseRegistryDigest,
  engineVersion,
  semanticVersions,
  proofReceipts,
  files,
  studioPrivateKey,
  studioPublicKey,
  minimumRemainingDays = 7,
}) {
  for (const [label, value] of [
    ["bundleId", bundleId],
    ["workspaceId", workspaceId],
    ["revisionGroupId", revisionGroupId],
  ]) {
    if (!uuidPattern.test(value ?? "")) {
      throw new Error(`${label} must be a lowercase UUID.`);
    }
  }
  requireTimestamp(createdAt, "createdAt");
  requireTimestamp(validationTime, "validationTime");
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseGitCommit ?? "")) {
    throw new Error("baseGitCommit must be a full lowercase Git object ID.");
  }
  requireDigest(baseRegistryDigest, "baseRegistryDigest");
  if (!Number.isInteger(minimumRemainingDays) || minimumRemainingDays < 7) {
    throw new Error("minimumRemainingDays must be at least seven full days.");
  }

  const receiptSummaries = [...proofReceipts]
    .map((receipt) => summarizeReceipt(receipt, validationTime, minimumRemainingDays))
    .sort(compareReceiptSummary);
  const renderedFiles = [...files]
    .map(normalizeReleaseFile)
    .sort((left, right) => compareText(left.path, right.path));
  if (new Set(renderedFiles.map((file) => file.path)).size !== renderedFiles.length) {
    throw new Error("Release file paths must be unique.");
  }
  const orderedVersions = [...semanticVersions].sort((left, right) =>
    compareText(left.package, right.package),
  );
  const bundlePayload = {
    bundleId,
    workspaceId,
    revisionGroupId,
    createdAt,
    baseGitCommit,
    baseRegistryDigest,
    engineVersion,
    semanticVersions: orderedVersions,
    proofReceipts: receiptSummaries,
    files: renderedFiles.map(({ content, ...metadata }) => metadata),
  };
  const digest = exportDigest(bundlePayload);
  const envelope = {
    schemaVersion: "dauva.dev/seed-release-bundle/v1",
    bundlePayload,
    exportDigest: digest,
    studioAttestation: createAttestation({
      domain: releaseBundleDomain,
      digest,
      privateKey: studioPrivateKey,
      publicKey: studioPublicKey,
    }),
  };
  assertBundleSchema(envelope);
  return {
    envelope,
    files: renderedFiles.map((file) => ({
      path: file.path,
      content: Buffer.from(file.content),
    })),
  };
}

export function verifySignedReleaseBundle({
  envelope,
  files,
  studioPublicKey,
  validationTime,
  minimumRemainingDays = 7,
}) {
  assertBundleSchema(envelope);
  requireTimestamp(validationTime, "validationTime");
  const calculatedDigest = exportDigest(envelope.bundlePayload);
  if (calculatedDigest !== envelope.exportDigest) {
    throw new Error("Release bundle exportDigest does not match bundlePayload.");
  }
  if (
    !verifyAttestation({
      domain: releaseBundleDomain,
      digest: envelope.exportDigest,
      attestation: envelope.studioAttestation,
      publicKey: studioPublicKey,
    })
  ) {
    throw new Error("Release bundle Studio attestation is invalid.");
  }
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  if (fileByPath.size !== files.length) {
    throw new Error("Release archive contains duplicate paths.");
  }
  for (const metadata of envelope.bundlePayload.files) {
    const file = fileByPath.get(metadata.path);
    if (!file) throw new Error(`Release archive is missing '${metadata.path}'.`);
    const content = toBuffer(file.content);
    if (content.length !== metadata.sizeBytes) {
      throw new Error(`Release file '${metadata.path}' has the wrong size.`);
    }
    if (sha256(content) !== metadata.postApplyDigest) {
      throw new Error(`Release file '${metadata.path}' has the wrong digest.`);
    }
    fileByPath.delete(metadata.path);
  }
  if (fileByPath.size > 0) {
    throw new Error(
      `Release archive contains unlisted file '${fileByPath.keys().next().value}'.`,
    );
  }
  const minimumExpiry = Date.parse(validationTime) + minimumRemainingDays * dayMs;
  for (const receipt of envelope.bundlePayload.proofReceipts) {
    if (Date.parse(receipt.expiresAt) < minimumExpiry) {
      throw new Error(
        `Proof '${receipt.proofId}' has less than ${minimumRemainingDays} full days remaining.`,
      );
    }
  }
  return envelope.exportDigest;
}

function summarizeReceipt(receipt, validationTime, minimumRemainingDays) {
  if (receipt?.schemaVersion !== "dauva.dev/seed-proof/v2") {
    throw new Error("Release bundles accept only proof-v2 receipts.");
  }
  const payload = receipt.receiptPayload;
  if (receipt.receiptDigest !== exportDigest(payload)) {
    throw new Error(`Proof '${payload?.proofId ?? "unknown"}' has an invalid digest.`);
  }
  const minimumExpiry = Date.parse(validationTime) + minimumRemainingDays * dayMs;
  if (Date.parse(payload.expiresAt) < minimumExpiry) {
    throw new Error(
      `Proof '${payload.proofId}' has less than ${minimumRemainingDays} full days remaining.`,
    );
  }
  return {
    seedId: payload.seed.id,
    testedVersion: payload.seed.testedVersion,
    architecture: payload.runner.architecture,
    proofId: payload.proofId,
    receiptDigest: receipt.receiptDigest,
    expiresAt: payload.expiresAt,
  };
}

function normalizeReleaseFile(file) {
  if (!allowedPathPattern.test(file?.path ?? "")) {
    throw new Error(`Release path '${file?.path ?? "missing"}' is outside the allowlist.`);
  }
  const content = toBuffer(file.content);
  if (content.length < 1 || content.length > 50 * 1024 * 1024) {
    throw new Error(`Release file '${file.path}' has an invalid size.`);
  }
  const preApply = file.preApply;
  const hasDigest = digestPattern.test(preApply?.expectedDigest ?? "");
  const expectsAbsence = preApply?.expectedAbsent === true;
  if (hasDigest === expectsAbsence) {
    throw new Error(
      `Release file '${file.path}' must declare one pre-apply digest or expected absence.`,
    );
  }
  return {
    path: file.path,
    preApply: hasDigest
      ? { expectedDigest: preApply.expectedDigest }
      : { expectedAbsent: true },
    postApplyDigest: sha256(content),
    sizeBytes: content.length,
    content,
  };
}

function assertBundleSchema(value) {
  if (validateBundleSchema(value)) return;
  const details = (validateBundleSchema.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
  throw new Error(`Release bundle is not canonical: ${details}`);
}

function assertPublicationSchema(value) {
  if (validatePublicationSchema(value)) return;
  const details = (validatePublicationSchema.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message}`)
    .join("; ");
  throw new Error(`Publication statement is not canonical: ${details}`);
}

function compareReceiptSummary(left, right) {
  return compareText(
    `${left.seedId}@${left.testedVersion}@${left.architecture}@${left.proofId}`,
    `${right.seedId}@${right.testedVersion}@${right.architecture}@${right.proofId}`,
  );
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireTimestamp(value, label) {
  if (
    typeof value !== "string" ||
    !/^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(`${label} must be a millisecond UTC timestamp.`);
  }
}

function requirePublicationClaimWindow(payload) {
  const lifetime = Date.parse(payload.claimBeforeUtc) - Date.parse(payload.createdAtUtc);
  if (lifetime <= 0 || lifetime > maximumPublicationClaimMs) {
    throw new Error(
      "claimBeforeUtc must be after createdAtUtc and no more than one hour later.",
    );
  }
}

function requireDigest(value, label) {
  if (!digestPattern.test(value ?? "")) {
    throw new Error(`${label} must use lowercase sha256:<64 hex>.`);
  }
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw new TypeError("Release file content must be bytes or UTF-8 text.");
}
