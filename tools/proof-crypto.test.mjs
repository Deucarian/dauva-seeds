import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { canonicalJson, readJson, repositoryRoot } from "./registry-lib.mjs";
import {
  apiStatementDigest,
  createAttestation,
  ed25519PrivateKeyFromSeed,
  proofApiDomain,
  receiptDigest,
  verifyAttestation,
} from "./proof-crypto.mjs";

const vector = await readJson(
  path.join(repositoryRoot, "test-vectors", "seed-studio-crypto-v1.json"),
);
const privateKey = ed25519PrivateKeyFromSeed(
  Buffer.from(vector.privateSeedHex, "hex"),
);
const publicKey = Buffer.from(vector.publicKeyHex, "hex");

test("shared JCS and Ed25519 vector remains byte exact", () => {
  assert.equal(canonicalJson(vector.value), vector.canonicalJson);
  assert.equal(receiptDigest(vector.value), vector.digest);
  assert.deepEqual(
    createAttestation({
      domain: vector.domain,
      digest: vector.digest,
      privateKey,
      publicKey,
    }),
    vector.attestation,
  );
  assert.equal(
    verifyAttestation({
      domain: vector.domain,
      digest: vector.digest,
      attestation: vector.attestation,
      publicKey,
    }),
    true,
  );
});

test("domain separation and payload changes invalidate attestations", () => {
  assert.equal(
    verifyAttestation({
      domain: proofApiDomain,
      digest: vector.digest,
      attestation: vector.attestation,
      publicKey,
    }),
    false,
  );
  const changedDigest = receiptDigest({ ...vector.value, z: 0.003 });
  assert.equal(
    verifyAttestation({
      domain: vector.domain,
      digest: changedDigest,
      attestation: vector.attestation,
      publicKey,
    }),
    false,
  );
});

test("API statement digest binds the complete Leaf attestation", () => {
  const digest = apiStatementDigest(vector.digest, vector.attestation);
  const changed = apiStatementDigest(vector.digest, {
    ...vector.attestation,
    keyId: `sha256:${"0".repeat(64)}`,
  });
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(digest, changed);
});
