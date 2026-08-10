import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import yauzl from "yauzl";
import { validateProofReceipt } from "./creator-engine.mjs";
import {
  apiStatementDigest,
  ed25519KeyId,
  proofApiDomain,
  proofLeafDomain,
  verifyAttestation,
} from "./proof-crypto.mjs";
import {
  assertRegistryDigest,
  calculateProofContractDigest,
  canonicalJson,
  parseJsonStrict,
  readJson,
  repositoryRoot,
  sha256,
} from "./registry-lib.mjs";
import {
  verifySignedPublicationStatement,
  verifySignedReleaseBundle,
} from "./release-engine.mjs";

const maxArchiveBytes = 300 * 1024 * 1024;
const maxEntries = 513;
const maxExpandedBytes = 256 * 1024 * 1024;
const maxBundleBytes = 5 * 1024 * 1024;
const maxFileBytes = 50 * 1024 * 1024;
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
const archivePathPattern =
  /^(?:registry\/(?:pods|seeds)\/[a-z0-9]+(?:-[a-z0-9]+)*\.json|registry\/history\/[a-z0-9]+(?:-[a-z0-9]+)*@[0-9]+\.[0-9]+\.[0-9]+\.json|proofs\/[a-z0-9]+(?:-[a-z0-9]+)*-[0-9]+\.[0-9]+\.[0-9]+(?:-rc\.[1-9][0-9]*)?-(?:amd64|arm64)-[0-9a-f-]{36}\.json|dist\/registry\.json|package\.json|package-lock\.json)$/;
const environmentTargets = Object.freeze({
  develop: "refs/heads/develop",
  production: "refs/heads/main",
});

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const verificationRootsSchema = await readJson(
  path.join(repositoryRoot, "schemas", "seed-studio-verification-roots-v1.schema.json"),
);
const validateVerificationRoots = ajv.compile(verificationRootsSchema);

export async function inspectReleaseArchive(archivePath) {
  const archiveStats = await stat(archivePath);
  if (!archiveStats.isFile() || archiveStats.size < 1 || archiveStats.size > maxArchiveBytes) {
    throw new Error("Release archive has an invalid size.");
  }
  const archiveBytes = await readFile(archivePath);
  const entries = await readZipEntries(archivePath);
  const bundleBytes = entries.get("bundle.json");
  if (!bundleBytes) throw new Error("Release archive is missing 'bundle.json'.");
  entries.delete("bundle.json");
  const envelope = parseJsonStrict(bundleBytes.toString("utf8"), "bundle.json");
  const files = [...entries.entries()].map(([entryPath, content]) => ({
    path: entryPath,
    content,
  }));
  files.sort((left, right) => compareText(left.path, right.path));
  return {
    archiveDigest: sha256(archiveBytes),
    envelope,
    files,
  };
}

export async function verifyReleaseApplication({
  archivePath,
  statementPath,
  repositoryPath,
  environment,
  verificationRootsPath = path.join(
    repositoryPath,
    "trust",
    "seed-studio-verification-roots.json",
  ),
  validationTime,
}) {
  const targetRef = environmentTargets[environment];
  if (!targetRef) throw new Error("Environment must be 'develop' or 'production'.");
  requireTimestamp(validationTime, "validationTime");
  const statement = parseJsonStrict(
    await readFile(statementPath, "utf8"),
    statementPath,
  );
  const roots = await readVerificationRoots(verificationRootsPath);
  const studioKey = requireVerificationKey({
    roots,
    purpose: "studio_export",
    keyId: statement?.studioAttestation?.keyId,
    validationTime,
    requiredSubjects: [
      `env:${environment}`,
      "repo:deucarian.dauva-seeds",
      `target:${targetRef.slice("refs/heads/".length)}`,
    ],
  });
  verifySignedPublicationStatement({
    statement,
    studioPublicKey: studioKey,
    validationTime,
  });
  const payload = statement.publicationPayload;
  if (payload.sourceEnvironment !== environment || payload.targetRef !== targetRef) {
    throw new Error("Publication environment or target does not match the apply profile.");
  }
  if (Date.parse(payload.createdAtUtc) > Date.parse(validationTime)) {
    throw new Error("Publication was created in the future.");
  }

  const archive = await inspectReleaseArchive(archivePath);
  if (archive.archiveDigest !== payload.archiveDigest) {
    throw new Error("Release archive digest does not match the publication statement.");
  }
  if (archive.envelope.studioAttestation?.keyId !== statement.studioAttestation.keyId) {
    throw new Error("Release bundle and publication statement use different Studio keys.");
  }
  verifySignedReleaseBundle({
    envelope: archive.envelope,
    files: archive.files,
    studioPublicKey: studioKey,
    validationTime,
  });
  const bundlePayload = archive.envelope.bundlePayload;
  if (
    payload.exportId !== bundlePayload.bundleId ||
    payload.exportDigest !== archive.envelope.exportDigest ||
    payload.baseGitCommit !== bundlePayload.baseGitCommit ||
    payload.baseRegistryDigest !== bundlePayload.baseRegistryDigest
  ) {
    throw new Error("Publication statement does not bind this exact release bundle.");
  }

  await verifyProofReceipts({
    files: archive.files,
    summaries: bundlePayload.proofReceipts,
    roots,
    environment,
    validationTime,
    repositoryPath,
    baseRegistryDigest: bundlePayload.baseRegistryDigest,
  });
  await verifyRepositoryPreconditions({
    repositoryPath,
    payload,
    files: archive.files,
    bundlePayload,
  });
  return {
    statement,
    archive,
    targetRef,
  };
}

export async function applyVerifiedRelease({
  archivePath,
  statementPath,
  repositoryPath,
  environment,
  verificationRootsPath,
  validationTime,
  checkRunner = runRepositoryCheck,
}) {
  const journalPath = await applyJournalPath(repositoryPath);
  if (await fileExists(journalPath)) {
    throw new Error(
      "An apply journal already exists. Recover it explicitly before retrying.",
    );
  }
  const verified = await verifyReleaseApplication({
    archivePath,
    statementPath,
    repositoryPath,
    environment,
    verificationRootsPath,
    validationTime,
  });
  const publicationId = verified.statement.publicationPayload.publicationId;
  const transactionRoot = path.join(path.dirname(journalPath), publicationId);
  const stagedRoot = path.join(transactionRoot, "staged");
  const backupRoot = path.join(transactionRoot, "backup");
  const entries = verified.archive.files.map((file) => ({
    path: file.path,
    existed: false,
  }));
  await mkdir(stagedRoot, { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  for (const file of verified.archive.files) {
    const stagedPath = resolveAllowedPath(stagedRoot, file.path);
    await mkdir(path.dirname(stagedPath), { recursive: true });
    await writeFile(stagedPath, file.content, { flag: "wx", mode: 0o600 });
  }
  const journal = {
    schemaVersion: "dauva.dev/seed-release-apply-journal/v1",
    repositoryPath: path.resolve(repositoryPath),
    publicationId,
    transactionRoot,
    entries,
  };
  const journalHandle = await open(journalPath, "wx", 0o600);
  await journalHandle.writeFile(`${JSON.stringify(journal)}\n`);
  await journalHandle.sync();
  await journalHandle.close();

  try {
    for (const entry of entries) {
      const targetPath = resolveAllowedPath(repositoryPath, entry.path);
      const stagedPath = resolveAllowedPath(stagedRoot, entry.path);
      const backupPath = resolveAllowedPath(backupRoot, entry.path);
      entry.existed = await fileExists(targetPath);
      await persistJournal(journalPath, journal);
      await mkdir(path.dirname(targetPath), { recursive: true });
      if (entry.existed) {
        await mkdir(path.dirname(backupPath), { recursive: true });
        await rename(targetPath, backupPath);
      }
      await rename(stagedPath, targetPath);
    }
    await checkRunner(repositoryPath);
    await verifyAppliedFiles({
      repositoryPath,
      files: verified.archive.files,
      fileMetadata: verified.archive.envelope.bundlePayload.files,
      expectedRegistryDigest:
        verified.statement.publicationPayload.expectedRegistryDigest,
    });
    await rm(transactionRoot, { recursive: true, force: true });
    await rm(journalPath, { force: true });
    return {
      schemaVersion: "dauva.dev/seed-release-apply-result/v1",
      publicationId,
      exportId: verified.statement.publicationPayload.exportId,
      exportDigest: verified.archive.envelope.exportDigest,
      environment,
      targetRef: verified.targetRef,
      baseGitCommit: verified.archive.envelope.bundlePayload.baseGitCommit,
      registryDigest:
        verified.statement.publicationPayload.expectedRegistryDigest,
      appliedFiles: verified.archive.files.map((file) => file.path),
      appliedAtUtc: validationTime,
    };
  } catch (error) {
    await rollbackApplyJournal(journalPath, repositoryPath);
    throw error;
  }
}

export async function recoverInterruptedApply({ repositoryPath }) {
  const journalPath = await applyJournalPath(repositoryPath);
  if (!(await fileExists(journalPath))) return { recovered: false };
  await rollbackApplyJournal(journalPath, repositoryPath);
  return { recovered: true };
}

export function validateArchiveEntryPath(entryPath, externalFileAttributes = 0) {
  if (
    typeof entryPath !== "string" ||
    entryPath.length < 1 ||
    entryPath.length > 300 ||
    /[\u0000-\u001f\u007f]/.test(entryPath) ||
    entryPath.includes("\\") ||
    entryPath.startsWith("/") ||
    /^[A-Za-z]:/.test(entryPath) ||
    entryPath.endsWith("/") ||
    entryPath.split("/").some((segment) => segment === "" || segment === "." || segment === "..") ||
    (entryPath !== "bundle.json" && !archivePathPattern.test(entryPath))
  ) {
    throw new Error(`Release archive path '${entryPath}' is unsafe or outside the allowlist.`);
  }
  const unixMode = (externalFileAttributes >>> 16) & 0xffff;
  if ((unixMode & 0o170000) === 0o120000) {
    throw new Error(`Release archive path '${entryPath}' is a symbolic link.`);
  }
  return entryPath;
}

async function readZipEntries(archivePath) {
  const zip = await openZip(archivePath);
  const entries = new Map();
  let expandedBytes = 0;
  let entryCount = 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try {
        zip.close();
      } catch {
        // The original validation error is authoritative.
      }
      reject(error);
    };
    zip.on("error", fail);
    zip.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(entries);
    });
    zip.on("entry", (entry) => {
      void (async () => {
        entryCount += 1;
        if (entryCount > maxEntries) throw new Error("Release archive has too many entries.");
        validateArchiveEntryPath(entry.fileName, entry.externalFileAttributes);
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
          throw new Error("Encrypted ZIP entries are not allowed.");
        }
        if (entry.compressionMethod !== 0) {
          throw new Error("Release archive entries must use deterministic store mode.");
        }
        const entryLimit = entry.fileName === "bundle.json" ? maxBundleBytes : maxFileBytes;
        if (entry.uncompressedSize < 1 || entry.uncompressedSize > entryLimit) {
          throw new Error(`Release archive entry '${entry.fileName}' has an invalid size.`);
        }
        expandedBytes += entry.uncompressedSize;
        if (expandedBytes > maxExpandedBytes) {
          throw new Error("Release archive expands beyond the allowed size.");
        }
        if (entries.has(entry.fileName)) {
          throw new Error(`Release archive contains duplicate path '${entry.fileName}'.`);
        }
        const stream = await openZipEntry(zip, entry);
        const chunks = [];
        let length = 0;
        for await (const chunk of stream) {
          length += chunk.length;
          if (length > entryLimit) {
            throw new Error(`Release archive entry '${entry.fileName}' exceeds its size limit.`);
          }
          chunks.push(chunk);
        }
        if (length !== entry.uncompressedSize) {
          throw new Error(`Release archive entry '${entry.fileName}' has a size mismatch.`);
        }
        entries.set(entry.fileName, Buffer.concat(chunks, length));
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}

async function readVerificationRoots(verificationRootsPath) {
  const roots = await readJson(verificationRootsPath);
  if (!validateVerificationRoots(roots)) {
    const details = (validateVerificationRoots.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message}`)
      .join("; ");
    throw new Error(`Verification roots are invalid: ${details}`);
  }
  return roots;
}

function requireVerificationKey({
  roots,
  purpose,
  keyId,
  validationTime,
  requiredSubjects,
}) {
  const candidates = roots.keys.filter(
    (key) => key.purpose === purpose && key.keyId === keyId,
  );
  if (candidates.length !== 1) {
    throw new Error(`Verification root '${keyId ?? "missing"}' is unknown or ambiguous.`);
  }
  const key = candidates[0];
  if (
    key.status !== "active" ||
    key.revokedAt !== null ||
    Date.parse(key.addedAt) > Date.parse(validationTime) ||
    requiredSubjects.some((subject) => !key.subjects.includes(subject))
  ) {
    throw new Error(`Verification root '${key.keyId}' is inactive or incorrectly scoped.`);
  }
  const publicKey = Buffer.from(key.publicKey, "base64url");
  if (publicKey.length !== 32 || ed25519KeyId(publicKey) !== key.keyId) {
    throw new Error(`Verification root '${key.keyId}' has invalid public-key material.`);
  }
  return publicKey;
}

async function verifyProofReceipts({
  files,
  summaries,
  roots,
  environment,
  validationTime,
  repositoryPath,
  baseRegistryDigest,
}) {
  const proofFiles = files.filter((file) => file.path.startsWith("proofs/"));
  if (proofFiles.length !== summaries.length) {
    throw new Error("Release proof files do not match the signed proof summaries.");
  }
  const receipts = proofFiles.map((file) => ({
    path: file.path,
    value: parseJsonStrict(file.content.toString("utf8"), file.path),
  }));
  for (const summary of summaries) {
    const matches = receipts.filter(
      ({ value }) => value?.receiptPayload?.proofId === summary.proofId,
    );
    if (matches.length !== 1) {
      throw new Error(`Proof '${summary.proofId}' is missing or duplicated.`);
    }
    const { path: receiptPath, value: receipt } = matches[0];
    const payload = receipt.receiptPayload;
    const expectedPath = `proofs/${payload.seed.id}-${payload.seed.testedVersion}-${payload.runner.architecture}-${payload.proofId}.json`;
    if (
      receiptPath !== expectedPath ||
      receipt.receiptDigest !== sha256(canonicalJson(payload)) ||
      summary.seedId !== payload.seed.id ||
      summary.testedVersion !== payload.seed.testedVersion ||
      summary.architecture !== payload.runner.architecture ||
      summary.receiptDigest !== receipt.receiptDigest ||
      summary.expiresAt !== payload.expiresAt ||
      Date.parse(payload.expiresAt) < Date.parse(validationTime) + sevenDaysMs
    ) {
      throw new Error(`Proof '${summary.proofId}' has stale or inconsistent binding.`);
    }
    if (payload.baseRegistryDigest !== baseRegistryDigest) {
      throw new Error(`Proof '${summary.proofId}' targets a different base Registry.`);
    }
    const seedPath = `registry/seeds/${payload.seed.id}.json`;
    const renderedSeed = files.find((file) => file.path === seedPath);
    const stableSeed = parseJsonStrict(
      renderedSeed
        ? renderedSeed.content.toString("utf8")
        : await readFile(resolveAllowedPath(repositoryPath, seedPath), "utf8"),
      seedPath,
    );
    const testedSeed = proofTestedSeed(stableSeed, payload.seed);
    validateProofReceipt(receipt, testedSeed);
    if (
      payload.seed.manifestDigest !== sha256(canonicalJson(testedSeed)) ||
      payload.seed.proofContractDigest !== calculateProofContractDigest(testedSeed) ||
      !stableSeed.compatibility?.architectures?.includes(payload.runner.architecture)
    ) {
      throw new Error(`Proof '${summary.proofId}' is not bound to the released Seed.`);
    }
    const agreements = (testedSeed.inputs ?? [])
      .filter((input) => input.type === "agreement")
      .map((input) => ({
        key: input.key,
        url: input.url,
        revision: input.revision,
        accepted: true,
      }))
      .sort((left, right) => compareText(left.key, right.key));
    if (
      agreements.length !== payload.agreements.length ||
      agreements.some((agreement, index) =>
        canonicalJson(agreement) !== canonicalJson(payload.agreements[index]),
      )
    ) {
      throw new Error(`Proof '${summary.proofId}' has stale agreement binding.`);
    }
    const leafKey = requireVerificationKey({
      roots,
      purpose: "proof_leaf",
      keyId: receipt.leafAttestation?.keyId,
      validationTime,
      requiredSubjects: [`env:${environment}`, `leaf:${payload.runner.leafId}`],
    });
    if (
      !verifyAttestation({
        domain: proofLeafDomain,
        digest: receipt.receiptDigest,
        attestation: receipt.leafAttestation,
        publicKey: leafKey,
      })
    ) {
      throw new Error(`Proof '${summary.proofId}' has an invalid Leaf attestation.`);
    }
    const apiKey = requireVerificationKey({
      roots,
      purpose: "proof_api",
      keyId: receipt.apiAttestation?.keyId,
      validationTime,
      requiredSubjects: [`env:${environment}`],
    });
    if (
      !verifyAttestation({
        domain: proofApiDomain,
        digest: apiStatementDigest(receipt.receiptDigest, receipt.leafAttestation),
        attestation: receipt.apiAttestation,
        publicKey: apiKey,
      })
    ) {
      throw new Error(`Proof '${summary.proofId}' has an invalid API attestation.`);
    }
  }
}

function proofTestedSeed(stableSeed, seedBinding) {
  if (
    stableSeed.id !== seedBinding.id ||
    stableSeed.status !== "stable" ||
    stableSeed.version !== seedBinding.intendedStableVersion
  ) {
    throw new Error(`Released Seed '${seedBinding.id}' does not match its proof target.`);
  }
  if (seedBinding.testedVersion === stableSeed.version) return stableSeed;
  if (
    new RegExp(`^${escapeRegex(stableSeed.version)}-rc\\.[1-9][0-9]*$`).test(
      seedBinding.testedVersion,
    )
  ) {
    return {
      ...stableSeed,
      version: seedBinding.testedVersion,
      status: "candidate",
    };
  }
  throw new Error(`Released Seed '${seedBinding.id}' has an unrelated tested version.`);
}

async function verifyRepositoryPreconditions({
  repositoryPath,
  payload,
  files,
  bundlePayload,
}) {
  const resolvedRepository = path.resolve(repositoryPath);
  const head = (await runCommand("git", ["rev-parse", "HEAD"], resolvedRepository)).trim();
  if (head !== payload.baseGitCommit) {
    throw new Error("Repository HEAD does not match the signed base Git commit.");
  }
  const remote = (
    await runCommand("git", ["remote", "get-url", "origin"], resolvedRepository)
  ).trim();
  if (normalizeGitHubRepository(remote) !== payload.repository.toLowerCase()) {
    throw new Error("Repository origin does not match the signed publication repository.");
  }
  const status = await runCommand(
    "git",
    ["status", "--porcelain=v1", "-z", "--", ...files.map((file) => file.path)],
    resolvedRepository,
  );
  if (status.length > 0) {
    throw new Error("One or more release targets already have local changes.");
  }
  const baseRegistry = parseJsonStrict(
    await readFile(path.join(resolvedRepository, "dist", "registry.json"), "utf8"),
    "dist/registry.json",
  );
  if (assertRegistryDigest(baseRegistry) !== payload.baseRegistryDigest) {
    throw new Error("Repository Registry digest does not match the signed base Registry.");
  }
  const metadataByPath = new Map(
    bundlePayload.files.map((metadata) => [metadata.path, metadata]),
  );
  for (const file of files) {
    const metadata = metadataByPath.get(file.path);
    if (!metadata) throw new Error(`Release metadata is missing '${file.path}'.`);
    const targetPath = resolveAllowedPath(resolvedRepository, file.path);
    await rejectSymlinkPath(resolvedRepository, file.path);
    const exists = await fileExists(targetPath);
    if (metadata.preApply.expectedAbsent === true) {
      if (exists) throw new Error(`Release target '${file.path}' must be absent.`);
    } else {
      if (!exists) throw new Error(`Release target '${file.path}' is unexpectedly absent.`);
      if (sha256(await readFile(targetPath)) !== metadata.preApply.expectedDigest) {
        throw new Error(`Release target '${file.path}' has changed since export.`);
      }
    }
    if (
      (file.path.startsWith("registry/history/") || file.path.startsWith("proofs/")) &&
      metadata.preApply.expectedAbsent !== true
    ) {
      throw new Error(`Immutable release target '${file.path}' is not create-only.`);
    }
  }
  await verifyAppliedFiles({
    repositoryPath: resolvedRepository,
    files,
    fileMetadata: bundlePayload.files,
    expectedRegistryDigest: payload.expectedRegistryDigest,
    useArchiveContent: true,
  });
  await verifySemanticVersionFiles({
    repositoryPath: resolvedRepository,
    files,
    semanticVersions: bundlePayload.semanticVersions,
  });
}

async function verifyAppliedFiles({
  repositoryPath,
  files,
  fileMetadata,
  expectedRegistryDigest,
  useArchiveContent = false,
}) {
  const metadataByPath = new Map(fileMetadata.map((metadata) => [metadata.path, metadata]));
  for (const file of files) {
    const content = useArchiveContent
      ? file.content
      : await readFile(resolveAllowedPath(repositoryPath, file.path));
    const expectedDigest = metadataByPath.get(file.path)?.postApplyDigest;
    if (sha256(content) !== expectedDigest) {
      throw new Error(`Applied file '${file.path}' does not match its signed digest.`);
    }
  }
  const registryFile = files.find((file) => file.path === "dist/registry.json");
  if (!registryFile) throw new Error("Release is missing the compiled Registry.");
  const registryContent = useArchiveContent
    ? registryFile.content
    : await readFile(resolveAllowedPath(repositoryPath, registryFile.path));
  const registry = parseJsonStrict(registryContent.toString("utf8"), registryFile.path);
  if (assertRegistryDigest(registry) !== expectedRegistryDigest) {
    throw new Error("Applied Registry does not match the signed expected Registry digest.");
  }
}

async function verifySemanticVersionFiles({
  repositoryPath,
  files,
  semanticVersions,
}) {
  const versionChange = semanticVersions.find(
    (entry) => entry.package === "@deucarian/dauva-seeds",
  );
  if (!versionChange || semanticVersions.length !== 1) {
    throw new Error("Release must contain exactly one Dauva Seeds version change.");
  }
  const packageFile = files.find((file) => file.path === "package.json");
  const lockFile = files.find((file) => file.path === "package-lock.json");
  if (!packageFile || !lockFile) throw new Error("Release lacks package version files.");
  const basePackage = parseJsonStrict(
    await readFile(path.join(repositoryPath, "package.json"), "utf8"),
    "package.json",
  );
  const baseLock = parseJsonStrict(
    await readFile(path.join(repositoryPath, "package-lock.json"), "utf8"),
    "package-lock.json",
  );
  const packageDocument = parseJsonStrict(packageFile.content.toString("utf8"), packageFile.path);
  const lockDocument = parseJsonStrict(lockFile.content.toString("utf8"), lockFile.path);
  if (
    basePackage.version !== versionChange.from ||
    baseLock.version !== versionChange.from ||
    baseLock.packages?.[""]?.version !== versionChange.from ||
    packageDocument.name !== "@deucarian/dauva-seeds" ||
    packageDocument.version !== versionChange.to ||
    lockDocument.version !== versionChange.to ||
    lockDocument.packages?.[""]?.version !== versionChange.to ||
    !matchesSemverImpact(versionChange.from, versionChange.to, versionChange.impact)
  ) {
    throw new Error("Release package versions do not match the signed semantic decision.");
  }
  const basePackageWithoutVersion = structuredClone(basePackage);
  const nextPackageWithoutVersion = structuredClone(packageDocument);
  delete basePackageWithoutVersion.version;
  delete nextPackageWithoutVersion.version;
  const baseLockWithoutVersions = structuredClone(baseLock);
  const nextLockWithoutVersions = structuredClone(lockDocument);
  delete baseLockWithoutVersions.version;
  delete nextLockWithoutVersions.version;
  delete baseLockWithoutVersions.packages?.[""]?.version;
  delete nextLockWithoutVersions.packages?.[""]?.version;
  if (
    canonicalJson(basePackageWithoutVersion) !== canonicalJson(nextPackageWithoutVersion) ||
    canonicalJson(baseLockWithoutVersions) !== canonicalJson(nextLockWithoutVersions)
  ) {
    throw new Error("Release package manifests may change only their semantic version.");
  }
}

function matchesSemverImpact(from, to, impact) {
  const parse = (value) => value.split(".").map(Number);
  const [fromMajor, fromMinor, fromPatch] = parse(from);
  const [toMajor, toMinor, toPatch] = parse(to);
  if (impact === "patch") {
    return toMajor === fromMajor && toMinor === fromMinor && toPatch === fromPatch + 1;
  }
  if (impact === "minor") {
    return toMajor === fromMajor && toMinor === fromMinor + 1 && toPatch === 0;
  }
  return toMajor === fromMajor + 1 && toMinor === 0 && toPatch === 0;
}

async function rollbackApplyJournal(journalPath, expectedRepositoryPath) {
  const journal = parseJsonStrict(await readFile(journalPath, "utf8"), journalPath);
  const expectedTransactionRoot = path.join(
    path.dirname(journalPath),
    journal?.publicationId ?? "invalid",
  );
  if (
    journal?.schemaVersion !== "dauva.dev/seed-release-apply-journal/v1" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      journal.publicationId ?? "",
    ) ||
    !Array.isArray(journal.entries) ||
    journal.entries.length < 1 ||
    journal.entries.length > 512 ||
    path.resolve(journal.transactionRoot ?? "") !== expectedTransactionRoot ||
    path.resolve(journal.repositoryPath ?? "") !== journal.repositoryPath ||
    (expectedRepositoryPath &&
      path.resolve(journal.repositoryPath) !== path.resolve(expectedRepositoryPath))
  ) {
    throw new Error("Apply journal is invalid; refusing unsafe recovery.");
  }
  const entryPaths = new Set();
  for (const entry of journal.entries) {
    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof entry.existed !== "boolean" ||
      entryPaths.has(entry.path)
    ) {
      throw new Error("Apply journal is invalid; refusing unsafe recovery.");
    }
    validateArchiveEntryPath(entry.path);
    entryPaths.add(entry.path);
  }
  for (const entry of [...journal.entries].reverse()) {
    const targetPath = resolveAllowedPath(journal.repositoryPath, entry.path);
    const backupPath = resolveAllowedPath(
      path.join(journal.transactionRoot, "backup"),
      entry.path,
    );
    const backupExists = await fileExists(backupPath);
    if (backupExists) {
      const backupDetails = await lstat(backupPath);
      if (!backupDetails.isFile() || backupDetails.isSymbolicLink()) {
        throw new Error("Apply journal backup is invalid; refusing unsafe recovery.");
      }
      await rm(targetPath, { force: true });
      await mkdir(path.dirname(targetPath), { recursive: true });
      await rename(backupPath, targetPath);
    } else if (entry.existed === false) {
      await rm(targetPath, { force: true });
    }
  }
  await rm(journal.transactionRoot, { recursive: true, force: true });
  await rm(journalPath, { force: true });
}

async function persistJournal(journalPath, journal) {
  const temporaryPath = `${journalPath}.next`;
  await writeFile(temporaryPath, `${JSON.stringify(journal)}\n`, {
    flag: "w",
    mode: 0o600,
  });
  await rename(temporaryPath, journalPath);
}

async function applyJournalPath(repositoryPath) {
  const gitDirectory = (
    await runCommand("git", ["rev-parse", "--absolute-git-dir"], repositoryPath)
  ).trim();
  const transactionDirectory = path.join(gitDirectory, "dauva-release-apply");
  await mkdir(transactionDirectory, { recursive: true });
  return path.join(transactionDirectory, "active.json");
}

async function rejectSymlinkPath(repositoryPath, relativePath) {
  let current = path.resolve(repositoryPath);
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    try {
      const details = await lstat(current);
      if (details.isSymbolicLink()) {
        throw new Error(`Release target '${relativePath}' traverses a symbolic link.`);
      }
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

function resolveAllowedPath(root, relativePath) {
  validateArchiveEntryPath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relativePath.split("/"));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Release path '${relativePath}' escapes its root.`);
  }
  return resolved;
}

async function runRepositoryCheck(repositoryPath) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await runCommand(npmCommand, ["run", "check"], repositoryPath, { inherit: true });
}

function runCommand(command, argumentsList, cwd, { inherit = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argumentsList, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    if (!inherit) {
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(inherit ? "" : Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const details = inherit
        ? ""
        : Buffer.concat(stderr).toString("utf8").trim().slice(0, 2000);
      reject(
        new Error(
          `${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}${
            details ? `: ${details}` : ""
          }`,
        ),
      );
    });
  });
}

function normalizeGitHubRepository(remote) {
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/i.exec(
    remote,
  );
  return match?.[1]?.toLowerCase() ?? "";
}

function openZip(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      archivePath,
      {
        lazyEntries: true,
        decodeStrings: true,
        validateEntrySizes: true,
        strictFileNames: true,
        autoClose: true,
      },
      (error, zip) => (error ? reject(error) : resolve(zip)),
    );
  });
}

function openZipEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) =>
      error ? reject(error) : resolve(stream),
    );
  });
}

async function fileExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
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

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
