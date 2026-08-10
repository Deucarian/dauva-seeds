import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createPublicKey } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import yazl from "yazl";
import {
  apiStatementDigest,
  createAttestation,
  ed25519KeyId,
  ed25519PrivateKeyFromSeed,
  proofApiDomain,
  proofLeafDomain,
  receiptDigest,
} from "./proof-crypto.mjs";
import {
  applyVerifiedRelease,
  inspectReleaseArchive,
  recoverInterruptedApply,
  validateArchiveEntryPath,
  verifyReleaseApplication,
} from "./release-apply-lib.mjs";
import {
  createSignedPublicationStatement,
  createSignedReleaseBundle,
} from "./release-engine.mjs";
import {
  calculateRegistryDigest,
  calculateProofContractDigest,
  canonicalJson,
  sha256,
} from "./registry-lib.mjs";

const execute = promisify(execFile);
const validationTime = "2026-08-10T10:00:00.000Z";
const expiresAt = "2026-11-10T10:00:00.000Z";
const studioKey = keyFromHex(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
);
const leafKey = keyFromHex("01".repeat(32));
const apiKey = keyFromHex("02".repeat(32));

test("verified apply is transactional, target-bound, and leaves an uncommitted diff", async (t) => {
  const fixture = await createFixture(t);
  const verified = await verifyReleaseApplication(fixture.options);
  assert.equal(
    verified.statement.publicationPayload.targetRef,
    "refs/heads/develop",
  );
  const result = await applyVerifiedRelease({
    ...fixture.options,
    checkRunner: async () => {},
  });
  assert.equal(result.publicationId, fixture.publicationId);
  assert.equal(result.registryDigest, fixture.expectedRegistryDigest);
  assert.equal(
    JSON.parse(await readFile(path.join(fixture.repositoryPath, "package.json"), "utf8"))
      .version,
    "0.1.1",
  );
  assert.equal(
    await readFile(
      path.join(fixture.repositoryPath, "registry", "seeds", "example.json"),
      "utf8",
    ),
    renderJson(seedDocument("1.0.0", "stable")),
  );
  const { stdout } = await execute("git", ["status", "--porcelain"], {
    cwd: fixture.repositoryPath,
  });
  assert.match(stdout, /package\.json/);
  assert.match(stdout, /\?\? registry\//);
  assert.deepEqual(
    await recoverInterruptedApply({ repositoryPath: fixture.repositoryPath }),
    { recovered: false },
  );
});

test("a failed repository check restores every original byte", async (t) => {
  const fixture = await createFixture(t);
  const originalPackage = await readFile(
    path.join(fixture.repositoryPath, "package.json"),
  );
  await assert.rejects(
    applyVerifiedRelease({
      ...fixture.options,
      checkRunner: async () => {
        throw new Error("simulated check failure");
      },
    }),
    /simulated check failure/,
  );
  assert.deepEqual(
    await readFile(path.join(fixture.repositoryPath, "package.json")),
    originalPackage,
  );
  await assert.rejects(
    readFile(path.join(fixture.repositoryPath, "registry", "seeds", "example.json")),
    { code: "ENOENT" },
  );
  const { stdout } = await execute("git", ["status", "--porcelain"], {
    cwd: fixture.repositoryPath,
  });
  assert.equal(stdout, "");
});

test("verification rejects a stale base, dirty target, revoked root, and crossed environment", async (t) => {
  const stale = await createFixture(t);
  await writeFile(path.join(stale.repositoryPath, "unrelated.txt"), "later\n");
  await execute("git", ["add", "unrelated.txt"], { cwd: stale.repositoryPath });
  await execute("git", ["commit", "-m", "advance base"], { cwd: stale.repositoryPath });
  await assert.rejects(verifyReleaseApplication(stale.options), /HEAD does not match/);

  const dirty = await createFixture(t);
  await writeFile(path.join(dirty.repositoryPath, "package.json"), "{}\n");
  await assert.rejects(verifyReleaseApplication(dirty.options), /local changes/);

  const revoked = await createFixture(t);
  const roots = JSON.parse(await readFile(revoked.verificationRootsPath, "utf8"));
  const root = roots.keys.find((entry) => entry.purpose === "studio_export");
  root.status = "revoked";
  root.revokedAt = "2026-08-10T09:00:00.000Z";
  await writeFile(revoked.verificationRootsPath, `${JSON.stringify(roots)}\n`);
  await assert.rejects(verifyReleaseApplication(revoked.options), /inactive/);

  const crossed = await createFixture(t);
  await assert.rejects(
    verifyReleaseApplication({ ...crossed.options, environment: "production" }),
    /incorrectly scoped|environment or target/,
  );
});

test("archive path validation rejects traversal, Windows paths, controls, and symlinks", () => {
  for (const invalid of [
    "../registry/seeds/example.json",
    "registry\\seeds\\example.json",
    "C:/registry/seeds/example.json",
    "/registry/seeds/example.json",
    "registry/seeds/example.json\u0000",
    "registry//seeds/example.json",
    "tools/apply-release-bundle.mjs",
  ]) {
    assert.throws(() => validateArchiveEntryPath(invalid), /unsafe|allowlist/);
  }
  assert.throws(
    () => validateArchiveEntryPath("registry/seeds/example.json", 0o120777 << 16),
    /symbolic link/,
  );
  assert.equal(
    validateArchiveEntryPath("registry/seeds/example.json"),
    "registry/seeds/example.json",
  );
});

test("archive inspection rejects duplicate and compressed entries", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dauva-release-archive-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const duplicatePath = path.join(root, "duplicate.zip");
  await writeFile(
    duplicatePath,
    await createRawArchive([
      { path: "bundle.json", content: "{}\n", compress: false },
      { path: "bundle.json", content: "{}\n", compress: false },
    ]),
  );
  await assert.rejects(inspectReleaseArchive(duplicatePath), /duplicate path/);

  const compressedPath = path.join(root, "compressed.zip");
  await writeFile(
    compressedPath,
    await createRawArchive([
      { path: "bundle.json", content: "{}\n", compress: true },
    ]),
  );
  await assert.rejects(inspectReleaseArchive(compressedPath), /store mode/);
});

test("recovery refuses a journal that redirects cleanup outside the Git transaction root", async (t) => {
  const fixture = await createFixture(t);
  const { stdout } = await execute("git", ["rev-parse", "--absolute-git-dir"], {
    cwd: fixture.repositoryPath,
  });
  const journalDirectory = path.join(stdout.trim(), "dauva-release-apply");
  await mkdir(journalDirectory, { recursive: true });
  const externalDirectory = path.join(path.dirname(fixture.repositoryPath), "must-remain");
  await mkdir(externalDirectory);
  await writeFile(path.join(externalDirectory, "marker"), "safe\n");
  await writeFile(
    path.join(journalDirectory, "active.json"),
    renderJson({
      schemaVersion: "dauva.dev/seed-release-apply-journal/v1",
      repositoryPath: fixture.repositoryPath,
      publicationId: "423e4567-e89b-42d3-a456-426614174003",
      transactionRoot: externalDirectory,
      entries: [{ path: "package.json", existed: true }],
    }),
  );
  await assert.rejects(
    recoverInterruptedApply({ repositoryPath: fixture.repositoryPath }),
    /invalid; refusing unsafe recovery/,
  );
  assert.equal(await readFile(path.join(externalDirectory, "marker"), "utf8"), "safe\n");
});

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dauva-release-apply-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repositoryPath = path.join(root, "repository");
  await mkdir(path.join(repositoryPath, "dist"), { recursive: true });
  await mkdir(path.join(repositoryPath, "registry", "seeds"), { recursive: true });
  await mkdir(path.join(repositoryPath, "proofs"), { recursive: true });
  const baseRegistry = registryDocument("base");
  const nextRegistry = registryDocument("next");
  const basePackage = packageDocument("0.1.0");
  const nextPackage = packageDocument("0.1.1");
  const baseLock = lockDocument("0.1.0");
  const nextLock = lockDocument("0.1.1");
  await writeFile(
    path.join(repositoryPath, "dist", "registry.json"),
    renderJson(baseRegistry),
  );
  await writeFile(path.join(repositoryPath, "package.json"), renderJson(basePackage));
  await writeFile(path.join(repositoryPath, "package-lock.json"), renderJson(baseLock));
  await execute("git", ["init", "-b", "develop"], { cwd: repositoryPath });
  await execute("git", ["config", "user.name", "Dauva Test"], { cwd: repositoryPath });
  await execute("git", ["config", "user.email", "dauva@example.invalid"], {
    cwd: repositoryPath,
  });
  await execute(
    "git",
    ["remote", "add", "origin", "https://github.com/Deucarian/dauva-seeds.git"],
    { cwd: repositoryPath },
  );
  await execute("git", ["add", "."], { cwd: repositoryPath });
  await execute("git", ["commit", "-m", "base"], { cwd: repositoryPath });
  const { stdout: baseCommitOutput } = await execute("git", ["rev-parse", "HEAD"], {
    cwd: repositoryPath,
  });
  const baseGitCommit = baseCommitOutput.trim();
  const stableSeed = seedDocument("1.0.0", "stable");
  const candidateSeed = seedDocument("1.0.0-rc.1", "candidate");
  const receipt = proofReceipt(baseRegistry.registryDigest, candidateSeed);
  const proofPath = `proofs/example-1.0.0-rc.1-amd64-${receipt.receiptPayload.proofId}.json`;
  const files = [
    releaseFile(
      "registry/seeds/example.json",
      null,
      Buffer.from(renderJson(stableSeed)),
    ),
    releaseFile(
      proofPath,
      null,
      Buffer.from(renderJson(receipt)),
    ),
    releaseFile(
      "dist/registry.json",
      Buffer.from(renderJson(baseRegistry)),
      Buffer.from(renderJson(nextRegistry)),
    ),
    releaseFile(
      "package.json",
      Buffer.from(renderJson(basePackage)),
      Buffer.from(renderJson(nextPackage)),
    ),
    releaseFile(
      "package-lock.json",
      Buffer.from(renderJson(baseLock)),
      Buffer.from(renderJson(nextLock)),
    ),
  ];
  const release = createSignedReleaseBundle({
    bundleId: "123e4567-e89b-42d3-a456-426614174000",
    workspaceId: "223e4567-e89b-42d3-a456-426614174001",
    revisionGroupId: "323e4567-e89b-42d3-a456-426614174002",
    createdAt: validationTime,
    validationTime,
    baseGitCommit,
    baseRegistryDigest: baseRegistry.registryDigest,
    engineVersion: "0.15.0",
    semanticVersions: [
      {
        package: "@deucarian/dauva-seeds",
        from: "0.1.0",
        to: "0.1.1",
        impact: "patch",
      },
    ],
    proofReceipts: [receipt],
    files,
    studioPrivateKey: studioKey.privateKey,
    studioPublicKey: studioKey.publicKey,
  });
  const archivePath = path.join(root, "bundle.zip");
  const archiveBytes = await createArchive(release);
  await writeFile(archivePath, archiveBytes);
  const publicationId = "423e4567-e89b-42d3-a456-426614174003";
  const statement = createSignedPublicationStatement({
    publicationPayload: {
      publicationId,
      exportId: release.envelope.bundlePayload.bundleId,
      exportDigest: release.envelope.exportDigest,
      archiveDigest: sha256(archiveBytes),
      sourceEnvironment: "develop",
      repositoryId: 1311366821,
      repository: "Deucarian/dauva-seeds",
      targetRef: "refs/heads/develop",
      baseGitCommit,
      baseRegistryDigest: baseRegistry.registryDigest,
      expectedRegistryDigest: nextRegistry.registryDigest,
      createdAtUtc: validationTime,
      claimBeforeUtc: "2026-08-10T11:00:00.000Z",
    },
    studioPrivateKey: studioKey.privateKey,
    studioPublicKey: studioKey.publicKey,
  });
  const statementPath = path.join(root, "publication.json");
  await writeFile(statementPath, renderJson(statement));
  const verificationRootsPath = path.join(root, "roots.json");
  await writeFile(
    verificationRootsPath,
    renderJson({
      schemaVersion: "dauva.dev/seed-studio-verification-roots/v1",
      keys: [
        rootKey("studio_export", studioKey, [
          "env:develop",
          "repo:deucarian.dauva-seeds",
          "target:develop",
        ]),
        rootKey("proof_leaf", leafKey, ["env:develop", "leaf:proof-leaf-1"]),
        rootKey("proof_api", apiKey, ["env:develop"]),
      ],
    }),
  );
  return {
    repositoryPath,
    publicationId,
    expectedRegistryDigest: nextRegistry.registryDigest,
    verificationRootsPath,
    options: {
      archivePath,
      statementPath,
      repositoryPath,
      environment: "develop",
      verificationRootsPath,
      validationTime,
    },
  };
}

function proofReceipt(baseRegistryDigest, candidateSeed) {
  const payload = {
    proofId: "623e4567-e89b-42d3-a456-426614174005",
    runId: "723e4567-e89b-42d3-a456-426614174006",
    attemptId: "823e4567-e89b-42d3-a456-426614174007",
    revisionId: "923e4567-e89b-42d3-a456-426614174008",
    runStatementDigest: digest("1"),
    seed: {
      id: "example",
      testedVersion: "1.0.0-rc.1",
      intendedStableVersion: "1.0.0",
      manifestDigest: sha256(canonicalJson(candidateSeed)),
      proofContractDigest: calculateProofContractDigest(candidateSeed),
    },
    proofPlanDigest: digest("4"),
    baseRegistryDigest,
    proofBundleDigest: digest("5"),
    policyVersion: "1.0.0",
    validatorVersion: "0.15.0",
    runner: {
      leafId: "proof-leaf-1",
      leafKeyId: ed25519KeyId(leafKey.publicKey),
      agentVersion: "0.6.71",
      runtimeVersion: "docker-29.0.0",
      operatingSystem: "linux",
      architecture: "amd64",
    },
    startedAt: validationTime,
    completedAt: "2026-08-10T10:10:00.000Z",
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
      "backup",
      "restore",
      "console",
      "update",
      "cleanup",
    ].map((code) => ({
      code,
      status: ["backup", "restore", "console", "update"].includes(code)
        ? "not_applicable"
        : "passed",
      startedAt: validationTime,
      completedAt: "2026-08-10T10:10:00.000Z",
      evidenceDigests: [],
    })),
    agreements: [],
    evidence: [],
    cleanup: {
      status: "passed",
      completedAt: "2026-08-10T10:10:00.000Z",
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
  const digestValue = receiptDigest(payload);
  const leafAttestation = createAttestation({
    domain: proofLeafDomain,
    digest: digestValue,
    privateKey: leafKey.privateKey,
    publicKey: leafKey.publicKey,
  });
  return {
    schemaVersion: "dauva.dev/seed-proof/v2",
    receiptPayload: payload,
    receiptDigest: digestValue,
    leafAttestation,
    apiAttestation: createAttestation({
      domain: proofApiDomain,
      digest: apiStatementDigest(digestValue, leafAttestation),
      privateKey: apiKey.privateKey,
      publicKey: apiKey.publicKey,
    }),
  };
}

function seedDocument(version, status) {
  return {
    schemaVersion: "dauva.dev/seed/v1",
    id: "example",
    version,
    status,
    podId: "example",
    source: {},
    trust: {},
    compatibility: {
      operatingSystems: ["linux"],
      architectures: ["amd64"],
      leafCapabilities: [],
    },
    components: [],
    volumes: [],
    ports: [],
    resources: {},
    storage: {},
    inputs: [],
    secrets: [],
    lifecycle: {},
    capabilities: {
      backup: false,
      restore: false,
      update: false,
      console: false,
    },
    updatePolicy: {},
    proofPolicy: {
      requiredChecks: [
        "images-pinned",
        "healthy",
        "ports",
        "graceful-stop",
        "stopped-remains-stopped",
        "restart",
        "persistence",
        "cleanup",
      ],
    },
  };
}

function releaseFile(filePath, previousContent, content) {
  return {
    path: filePath,
    preApply: previousContent
      ? { expectedDigest: sha256(previousContent) }
      : { expectedAbsent: true },
    content,
  };
}

function registryDocument(label) {
  const document = {
    schemaVersion: "dauva.dev/registry/v1",
    generatedBy: label,
    pods: [],
    seeds: [],
    releases: [],
  };
  return { ...document, registryDigest: calculateRegistryDigest(document) };
}

function packageDocument(version) {
  return { name: "@deucarian/dauva-seeds", version, private: true };
}

function lockDocument(version) {
  return {
    name: "@deucarian/dauva-seeds",
    version,
    lockfileVersion: 3,
    packages: { "": { name: "@deucarian/dauva-seeds", version } },
  };
}

function keyFromHex(hex) {
  const privateKey = ed25519PrivateKeyFromSeed(Buffer.from(hex, "hex"));
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return { privateKey, publicKey: Buffer.from(spki).subarray(-32) };
}

function rootKey(purpose, key, subjects) {
  return {
    purpose,
    keyId: ed25519KeyId(key.publicKey),
    publicKey: key.publicKey.toString("base64url"),
    subjects,
    status: "active",
    addedAt: "2026-08-10T09:00:00.000Z",
    revokedAt: null,
  };
}

function createArchive(release) {
  const archive = new yazl.ZipFile();
  archive.addBuffer(Buffer.from(`${JSON.stringify(release.envelope)}\n`), "bundle.json", {
    compress: false,
    mtime: new Date("1980-01-01T00:00:00.000Z"),
    mode: 0o100600,
  });
  for (const file of release.files) {
    archive.addBuffer(file.content, file.path, {
      compress: false,
      mtime: new Date("1980-01-01T00:00:00.000Z"),
      mode: 0o100600,
    });
  }
  archive.end();
  return streamToBuffer(archive.outputStream);
}

function createRawArchive(entries) {
  const archive = new yazl.ZipFile();
  for (const entry of entries) {
    archive.addBuffer(Buffer.from(entry.content), entry.path, {
      compress: entry.compress,
      mtime: new Date("1980-01-01T00:00:00.000Z"),
      mode: 0o100600,
    });
  }
  archive.end();
  return streamToBuffer(archive.outputStream);
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}
