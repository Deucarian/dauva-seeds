import assert from "node:assert/strict";
import test from "node:test";
import { ed25519PrivateKeyFromSeed, receiptDigest } from "./proof-crypto.mjs";
import {
  createSignedPublicationStatement,
  createSignedReleaseBundle,
  verifySignedPublicationStatement,
  verifySignedReleaseBundle,
} from "./release-engine.mjs";

const privateSeed = Buffer.from(
  "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
  "hex",
);
const publicKey = Buffer.from(
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  "hex",
);
const privateKey = ed25519PrivateKeyFromSeed(privateSeed);
const digest = (character) => `sha256:${character.repeat(64)}`;
const proofPayload = {
  proofId: "123e4567-e89b-42d3-a456-426614174000",
  seed: { id: "example", testedVersion: "1.0.0-rc.1" },
  runner: { architecture: "amd64" },
  expiresAt: "2026-11-01T10:00:00.000Z",
};
const proof = {
  schemaVersion: "dauva.dev/seed-proof/v2",
  receiptPayload: proofPayload,
  receiptDigest: receiptDigest(proofPayload),
};
const input = {
  bundleId: "123e4567-e89b-42d3-a456-426614174000",
  workspaceId: "223e4567-e89b-42d3-a456-426614174001",
  revisionGroupId: "323e4567-e89b-42d3-a456-426614174002",
  createdAt: "2026-08-03T10:00:00.000Z",
  validationTime: "2026-08-03T10:00:00.000Z",
  baseGitCommit: "a".repeat(40),
  baseRegistryDigest: digest("a"),
  engineVersion: "0.11.0",
  semanticVersions: [
    {
      package: "@deucarian/dauva-seeds",
      from: "0.9.1",
      to: "0.11.0",
      impact: "minor",
    },
  ],
  proofReceipts: [proof],
  files: [
    {
      path: "registry/seeds/example.json",
      preApply: { expectedAbsent: true },
      content: "{}\n",
    },
    {
      path: "dist/registry.json",
      preApply: { expectedDigest: digest("b") },
      content: "{}\n",
    },
    {
      path: "package.json",
      preApply: { expectedDigest: digest("c") },
      content: "{}\n",
    },
    {
      path: "package-lock.json",
      preApply: { expectedDigest: digest("d") },
      content: "{}\n",
    },
  ],
  studioPrivateKey: privateKey,
  studioPublicKey: publicKey,
};

const publicationPayload = {
  publicationId: "423e4567-e89b-42d3-a456-426614174003",
  exportId: input.bundleId,
  exportDigest: digest("9"),
  archiveDigest: digest("8"),
  sourceEnvironment: "develop",
  repositoryId: 1311366821,
  repository: "Deucarian/dauva-seeds",
  targetRef: "refs/heads/develop",
  baseGitCommit: input.baseGitCommit,
  baseRegistryDigest: input.baseRegistryDigest,
  expectedRegistryDigest: digest("7"),
  createdAtUtc: input.createdAt,
  claimBeforeUtc: "2026-08-03T11:00:00.000Z",
};

test("signed release rendering and verification are byte deterministic", () => {
  const first = createSignedReleaseBundle(input);
  const second = createSignedReleaseBundle(input);
  assert.deepEqual(first, second);
  assert.equal(
    verifySignedReleaseBundle({
      envelope: first.envelope,
      files: first.files,
      studioPublicKey: publicKey,
      validationTime: input.validationTime,
    }),
    first.envelope.exportDigest,
  );
});

test("publication statements are deterministic, target-bound, and expiring", () => {
  const first = createSignedPublicationStatement({
    publicationPayload,
    studioPrivateKey: privateKey,
    studioPublicKey: publicKey,
  });
  const second = createSignedPublicationStatement({
    publicationPayload,
    studioPrivateKey: privateKey,
    studioPublicKey: publicKey,
  });
  assert.deepEqual(first, second);
  assert.equal(
    verifySignedPublicationStatement({
      statement: first,
      studioPublicKey: publicKey,
      validationTime: "2026-08-03T10:30:00.000Z",
    }),
    first.publicationDigest,
  );
  assert.throws(
    () =>
      verifySignedPublicationStatement({
        statement: first,
        studioPublicKey: publicKey,
        validationTime: "2026-08-03T11:00:00.000Z",
      }),
    /deadline has passed/,
  );
  assert.throws(
    () =>
      createSignedPublicationStatement({
        publicationPayload: {
          ...publicationPayload,
          targetRef: "refs/heads/main",
        },
        studioPrivateKey: privateKey,
        studioPublicKey: publicKey,
      }),
    /not canonical/,
  );
  assert.throws(
    () =>
      createSignedPublicationStatement({
        publicationPayload: {
          ...publicationPayload,
          claimBeforeUtc: "2026-08-03T11:00:00.001Z",
        },
        studioPrivateKey: privateKey,
        studioPublicKey: publicKey,
      }),
    /no more than one hour/,
  );
  assert.throws(
    () =>
      verifySignedPublicationStatement({
        statement: first,
        studioPublicKey: publicKey,
        validationTime: "2026-08-03T09:59:59.999Z",
      }),
    /created after/,
  );
});

test("release verification rejects tampering, extra files, and stale proof", () => {
  const release = createSignedReleaseBundle(input);
  const tamperedFiles = structuredClone(release.files);
  tamperedFiles[0].content = Buffer.from("tampered\n");
  assert.throws(
    () =>
      verifySignedReleaseBundle({
        envelope: release.envelope,
        files: tamperedFiles,
        studioPublicKey: publicKey,
        validationTime: input.validationTime,
      }),
    /wrong (?:size|digest)/,
  );
  assert.throws(
    () =>
      verifySignedReleaseBundle({
        envelope: release.envelope,
        files: [...release.files, { path: "unexpected", content: "x" }],
        studioPublicKey: publicKey,
        validationTime: input.validationTime,
      }),
    /unlisted file/,
  );
  assert.throws(
    () =>
      createSignedReleaseBundle({
        ...input,
        validationTime: "2026-10-27T10:00:00.000Z",
      }),
    /less than 7 full days/,
  );
});

test("release rendering rejects non-v2 proof and non-allowlisted paths", () => {
  assert.throws(
    () =>
      createSignedReleaseBundle({
        ...input,
        proofReceipts: [{ schemaVersion: "dauva.dev/seed-proof/v1" }],
      }),
    /only proof-v2/,
  );
  const files = structuredClone(input.files);
  files[0].path = "../registry/seeds/example.json";
  assert.throws(
    () => createSignedReleaseBundle({ ...input, files }),
    /outside the allowlist/,
  );
});
